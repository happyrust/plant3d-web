/**
 * gen-model-v1 的模型变更同步（plan P5）：服务端把哪些生成根重算了，场景里已经加载的那些就重载。
 *
 * 两条线合成一条：
 * 1. WS `/api/v1/ws` 订阅 `tasks`——任何 `task_finished`（数据批次收口通常紧接着一页模型消化）都触发一次对齐；
 *    重连成功也对齐一次（spec §5.4：事件不重放，重连后先 REST 对齐）。
 * 2. REST `GET /api/v1/tasks?kind=model_drain` 定时对齐（默认 15 s）：**今天服务端的 `model_drain` 任务只进
 *    TaskRegistry、不发 WS 事件**（`task_started` / `task_finished` 只有 data_batch / room_recalc / batch_scheduler
 *    在发），根列表也只在任务的 `detail.roots[].target_refno` 里，所以真正把重载触发起来的是这条线。
 *    等 gen-model 给 `model_drain` 补上带 `kind` + 根列表的 WS 事件，第一条线就能独立工作，这里不用改。
 *
 * 对齐 = 找出「上次看过之后收口的 `model_drain`」→ `detail.roots[].target_refno`（`a/b`→`a_b`）∩ 记录源里已收过的
 * 生成根 → 清掉这些根的缓存 → 派 `showModelByRefnos { reload:true }`，由 `ViewerPanel` 统一接住走
 * `showModelByRefno(root, { reload:true })`（替换旧对象、重拉 GLB、ensure 不带 force）。
 *
 * 进程内单例；只在 `model_source=gen-model-v1` 下由徽标挂起，legacy 一次请求都不发。
 */
import { computed, reactive, readonly } from 'vue';

import type { GenModelV1ModelRecordSource } from '@/model-source/genModelV1';

import { fromV1Refno, genModelV1Tasks, isGenModelV1ApiError, type TaskEntryDto } from '@/api/genModelV1Api';
import { createGenModelV1TaskSocket, type GenModelV1TaskSocket, type GenModelV1TaskSocketStatus, type GenModelV1WsEnvelope } from '@/api/genModelV1Ws';
import { getModelSource } from '@/model-source';

export type GenModelV1ModelSyncState = {
  socket: GenModelV1TaskSocketStatus;
  /** 上一次对齐时刻 */
  lastReconcileAt: number | null;
  /** 水位：只处理 `finished_at` 晚于它的 drain；`null` = 还没推过水位，`''` = 推过但服务端还没有收口的 drain */
  watermark: string | null;
  /** 已处理过的 drain task_id（防重放） */
  seenTaskIds: string[];
  /** 累计触发重载的根数 */
  reloadedRoots: number;
  /** 最近一次重载的根 */
  lastReloaded: string[];
  events: number;
  gaps: number;
  error: string | null;
};

const TERMINAL_STATES = new Set(['succeeded', 'partial', 'failed', 'yielded']);
export const DEFAULT_RECONCILE_INTERVAL_MS = 15_000;
const SEEN_LIMIT = 500;

function initialState(): GenModelV1ModelSyncState {
  return {
    socket: 'idle',
    lastReconcileAt: null,
    watermark: null,
    seenTaskIds: [],
    reloadedRoots: 0,
    lastReloaded: [],
    events: 0,
    gaps: 0,
    error: null,
  };
}

const state = reactive<GenModelV1ModelSyncState>(initialState());
let socket: GenModelV1TaskSocket | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<string[]> | null = null;

function isTerminal(task: TaskEntryDto): boolean {
  return TERMINAL_STATES.has(String(task.state ?? '').toLowerCase());
}

/**
 * 一批 drain 任务里，水位之后、没处理过、已收口的那些的根（`a_b`，去重）。
 * `watermark === null` = 不设门（调用方自己决定要不要处理）；`''` = 全部算新。
 */
export function rootsFromFinishedDrains(
  tasks: TaskEntryDto[],
  watermark: string | null,
  seen: ReadonlySet<string>,
): { roots: string[]; taskIds: string[]; newWatermark: string | null } {
  const roots = new Set<string>();
  const taskIds: string[] = [];
  let newWatermark: string | null = watermark || null;
  for (const task of tasks) {
    if (task.kind !== 'model_drain' || !isTerminal(task)) continue;
    const finishedAt = task.finished_at ?? null;
    if (!finishedAt) continue;
    if (newWatermark === null || finishedAt > newWatermark) newWatermark = finishedAt;
    if (watermark && finishedAt <= watermark) continue;
    if (seen.has(task.task_id)) continue;
    taskIds.push(task.task_id);
    for (const root of task.detail?.roots ?? []) {
      const key = root?.target_refno ? fromV1Refno(String(root.target_refno)) : '';
      if (key) roots.add(key);
    }
  }
  return { roots: Array.from(roots), taskIds, newWatermark };
}

function recordSource(): GenModelV1ModelRecordSource | null {
  const source = getModelSource();
  if (source.kind !== 'gen-model-v1') return null;
  const records = source.records as Partial<GenModelV1ModelRecordSource>;
  return typeof records.collectedRoots === 'function' && typeof records.invalidateRoot === 'function'
    ? (records as GenModelV1ModelRecordSource)
    : null;
}

function dispatchReload(roots: string[]): void {
  if (typeof window === 'undefined' || roots.length === 0) return;
  window.dispatchEvent(new CustomEvent('showModelByRefnos', {
    detail: { refnos: roots, reload: true, flyTo: false, source: 'gen-model-v1:model_drain' },
  }));
}

/**
 * 一次对齐：读 drain 任务 → 与已加载根求交 → 清缓存 → 派重载。返回本次触发重载的根。
 * `primeOnly=true` 只推水位不重载（首次连上时用：之前收口的 drain 与本页面无关）。
 */
async function reconcile(primeOnly = false): Promise<string[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const resp = await genModelV1Tasks({ kind: 'model_drain', limit: 100 }, { timeoutMs: 15_000 });
      const seen = new Set(state.seenTaskIds);
      // watermark === null 表示还没推过水位（页面刚连上），'' 表示推过但服务端还没有任何收口的 drain
      const primed = state.watermark !== null;
      const { roots, taskIds, newWatermark } = rootsFromFinishedDrains(resp.tasks ?? [], primed ? state.watermark : null, seen);
      state.lastReconcileAt = Date.now();
      state.error = null;
      if (!primed || primeOnly) {
        // 之前收口的 drain 与本页面无关：只记水位，不重载
        state.watermark = newWatermark ?? '';
        return [];
      }
      if (newWatermark !== null && newWatermark > state.watermark!) state.watermark = newWatermark;
      if (taskIds.length > 0) {
        state.seenTaskIds = [...state.seenTaskIds, ...taskIds].slice(-SEEN_LIMIT);
      }
      if (roots.length === 0) return [];
      const records = recordSource();
      if (!records) return [];
      const loaded = new Set(records.collectedRoots());
      const hits = roots.filter((root) => loaded.has(root));
      if (hits.length === 0) return [];
      for (const root of hits) records.invalidateRoot(root);
      dispatchReload(hits);
      state.reloadedRoots += hits.length;
      state.lastReloaded = hits;
      console.info('[gen-model-v1][sync] model_drain 收口，重载已加载根', { hits, tasks: taskIds });
      return hits;
    } catch (error) {
      state.error = isGenModelV1ApiError(error) ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
      return [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function onEvent(envelope: GenModelV1WsEnvelope): void {
  state.events++;
  if (envelope.type === 'task_finished') {
    // 数据批次收口之后紧跟一页模型消化；drain 自己今天不发事件，这里只是把对齐提前到「有动静」的时候
    void reconcile();
  }
}

function start(intervalMs = DEFAULT_RECONCILE_INTERVAL_MS): void {
  if (timer) return;
  if (!socket) {
    socket = createGenModelV1TaskSocket({
      onEvent,
      onOpen: () => {
        // 首次：只推水位；重连：对齐一次（中间可能漏了事件）
        void reconcile(state.watermark === null);
      },
      onStatus: (status) => {
        state.socket = status;
      },
      onGap: (info) => {
        state.gaps += 1;
        console.warn('[gen-model-v1][sync] WS seq 空洞，走 REST 对齐', info);
        void reconcile();
      },
    });
  }
  socket.start();
  // 首拍推水位（WS 连不上也要有水位，否则第一次定时对齐会把历史 drain 当成新的）
  void reconcile(state.watermark === null);
  timer = setInterval(() => {
    void reconcile();
  }, intervalMs);
}

function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  socket?.stop();
  socket = null;
}

const summary = computed(() => {
  const ws = state.socket === 'open' ? 'WS 已连' : state.socket === 'connecting' ? 'WS 连接中' : state.socket === 'closed' ? 'WS 断开重连中' : 'WS 未连';
  const reload = state.reloadedRoots > 0 ? ` · 已重载 ${state.reloadedRoots} 根` : '';
  return `${ws}${reload}`;
});

export function useGenModelV1ModelSync() {
  return {
    state: readonly(state),
    summary,
    start,
    stop,
    reconcile,
    /** 测试用 */
    __reset(): void {
      stop();
      inflight = null;
      Object.assign(state, initialState());
    },
  };
}
