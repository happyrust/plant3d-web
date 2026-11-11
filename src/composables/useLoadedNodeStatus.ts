/**
 * 已加载节点表（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` C2；CONTEXT「已加载节点表」）：
 * 页面里记下「场景里每个显示过的节点，装的时候是哪一版」，并给模型树的行提供它现在的新旧状态。
 *
 * - 节点装完（`useModelGeneration.showModelByRefno` 收口时）登记：库、节点、当时库的模型水位与库文件最新会话；
 * - 登记之后在后台问一次状态（`resolveNodeModelStatus`），不挡出图；同时在问的不超过 2 个节点；
 * - 表里有节点时每分钟强制重拉一次 `/dbnums`（轻量形态，服务端毫秒级）；后端跑完数据批次（任务流）时立刻重拉。
 *   某个库的水位变了，只对这个库里已加载的节点重问一次；
 * - 它是这个页面的记忆，不是事实来源：页面一刷新就没了，「有没有生成过」也不看它。
 *
 * 进程内单例：模型树和查看器各有一份 `useModelGeneration`，装的是同一个场景，共用这一张表。
 */
import { reactive, watch } from 'vue';

import type { DbnumRow } from '@/api/genModelV1Api';

import {
  describeNodeModelStatus,
  nodeModelStatusAction,
  nodeModelStatusIconKind,
  resolveNodeModelStatus,
  type ListNodeChangedSessions,
  type NodeModelStatus,
  type NodeModelVerdict,
} from '@/composables/nodeModelStatus';
import { useGenModelV1Health } from '@/composables/useGenModelV1Health';
import { subscribeGenModelV1FinishedBatches } from '@/composables/useGenModelV1UpdateNotice';
import { toRefnoKey } from '@/utils/refnoKey';

/** 表里有节点时 `/dbnums` 的重拉间隔（没有节点时沿用健康探针自己的 5 分钟） */
export const LOADED_NODE_DBNUMS_POLL_MS = 60_000;
/** 同时在问状态的节点数上限 */
export const LOADED_NODE_CHECK_CONCURRENCY = 2;

export type LoadedNodeEntry = {
  /** `a_b` */
  refno: string;
  dbnum: number;
  loadedAt: number;
  /** 装的时候这个库的模型水位；当时库状态没取到为 `null` */
  loadedModelSesno: number | null;
  /** 装的时候库文件的最新会话 */
  loadedFileLatestSesno: number | null;
  /** 最近一次判定；还没判过为 `null` */
  status: NodeModelStatus | null;
  checking: boolean;
};

export type LoadedNodeView = {
  /** 还没判出来时为 `null` */
  verdict: NodeModelVerdict | null;
  /** 行尾图标的画法；`null` = 沿用库一级的圆点 */
  iconKind: 'current' | 'stale' | 'reloadable' | null;
  /** 行尾提示里关于本节点的那几行 */
  title: string;
  /** 行上给的动作 */
  action: 'update' | 'reload' | null;
  checking: boolean;
};

const entries = reactive(new Map<string, LoadedNodeEntry>());
/** 每个节点最近一次发起判定的序号：判定回来时序号对不上（节点被撤、被重新登记）就丢掉 */
const checkTokens = new Map<string, number>();
/** 每个节点上一次判定时库的水位：变了才重问 */
const checkedAgainst = new Map<string, string>();
const inflight = new Map<string, AbortController>();
const queue: string[] = [];
let running = 0;
let tokenSeq = 0;
let stopWatching: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeBatches: (() => void) | null = null;

function rowOf(dbnum: number): DbnumRow | null {
  return (useGenModelV1Health().state.verdict.rows?.[dbnum] as DbnumRow | undefined) ?? null;
}

function watermarkKey(row: DbnumRow | null): string {
  if (!row) return 'no-row';
  return [row.model_sesno, row.file_latest_sesno, row.initialized, row.model_source_reason, row.write_state?.status]
    .map((value) => String(value ?? ''))
    .join(':');
}

/**
 * 问「某个会话之后谁改到了这个节点」的查询。这张表自己不引用数据源（模型树的行组件引用这张表，不该为此把整套
 * 数据源适配器拖进行组件的依赖里）：由显示流程（`useModelGeneration`，登记节点的那一方）在加载时接上。
 */
let changeQuery: ListNodeChangedSessions | null = null;

export function provideLoadedNodeChangeQuery(query: ListNodeChangedSessions | null): void {
  changeQuery = query;
}

const listChangedSessions: ListNodeChangedSessions = (query) => (
  changeQuery ? changeQuery(query) : Promise.reject(new Error('变化查询还没有接上'))
);

/** 重拉 `/dbnums`（健康探针对外给的这个入口总是绕过五分钟的共享缓存；在飞的共用）。 */
function refreshRows(): void {
  void useGenModelV1Health().refreshVerdict();
}

function startWatching(): void {
  if (stopWatching) return;
  const health = useGenModelV1Health();
  // `/dbnums` 每重拉一次 `lastCheckedAt` 就变：看看哪些库的水位动了
  stopWatching = watch(() => health.state.verdict.lastCheckedAt, () => recheckChanged());
  pollTimer = setInterval(() => {
    if (entries.size === 0) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    refreshRows();
  }, LOADED_NODE_DBNUMS_POLL_MS);
  unsubscribeBatches = subscribeGenModelV1FinishedBatches((batch) => {
    for (const entry of entries.values()) {
      if (entry.dbnum === batch.dbnum) {
        refreshRows();
        return;
      }
    }
  });
}

function stopWatchingIfIdle(): void {
  if (entries.size > 0) return;
  stopWatching?.();
  stopWatching = null;
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  unsubscribeBatches?.();
  unsubscribeBatches = null;
}

function schedule(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  // 在路上的那一次作废（节点被重新登记，或水位又变了）
  inflight.get(key)?.abort();
  inflight.delete(key);
  checkTokens.set(key, ++tokenSeq);
  entry.checking = true;
  if (!queue.includes(key)) queue.push(key);
  pump();
}

function pump(): void {
  while (running < LOADED_NODE_CHECK_CONCURRENCY && queue.length > 0) {
    const key = queue.shift()!;
    if (entries.has(key)) void run(key);
  }
}

async function run(key: string): Promise<void> {
  const entry = entries.get(key);
  if (!entry) return;
  const token = checkTokens.get(key);
  const row = rowOf(entry.dbnum);
  const against = watermarkKey(row);
  const controller = new AbortController();
  inflight.set(key, controller);
  running += 1;
  try {
    const status = await resolveNodeModelStatus({
      dbnum: entry.dbnum,
      refno: entry.refno,
      row,
      loadedModelSesno: entry.loadedModelSesno,
      listChangedSessions,
      signal: controller.signal,
    });
    const current = entries.get(key);
    if (!current || checkTokens.get(key) !== token) return;
    current.status = status;
    current.checking = false;
    checkedAgainst.set(key, against);
    // 判的这一会儿库的水位又变了（比如库状态刚取到）：按新的再判一次
    if (watermarkKey(rowOf(current.dbnum)) !== against) schedule(key);
  } finally {
    running -= 1;
    if (inflight.get(key) === controller) inflight.delete(key);
    pump();
  }
}

function recheckChanged(): void {
  for (const [key, entry] of entries) {
    if (checkedAgainst.get(key) === watermarkKey(rowOf(entry.dbnum))) continue;
    // 还没判过第一次的（在排队 / 在路上）不用再排
    if (entry.checking && !checkedAgainst.has(key) && (queue.includes(key) || inflight.has(key))) continue;
    schedule(key);
  }
}

/**
 * 节点装完了：登记进表并在后台问一次状态。`at` 是**开始装之前**读到的库水位——取早不取晚：
 * 装的过程中后端正好跑完一个批次时，宁可之后多提示一次「有更新可重载」，不能漏掉。
 * 同一个节点再登记（重载之后）覆盖原来那一行。
 */
export function noteLoadedNode(
  refno: string,
  dbnum: number,
  at: { modelSesno: number | null; fileLatestSesno: number | null },
): void {
  const key = toRefnoKey(refno);
  if (!key || !Number.isFinite(dbnum)) return;
  entries.set(key, {
    refno: key,
    dbnum,
    loadedAt: Date.now(),
    loadedModelSesno: at.modelSesno,
    loadedFileLatestSesno: at.fileLatestSesno,
    status: null,
    checking: false,
  });
  checkedAgainst.delete(key);
  startWatching();
  schedule(key);
}

function drop(key: string): void {
  inflight.get(key)?.abort();
  inflight.delete(key);
  checkTokens.delete(key);
  checkedAgainst.delete(key);
  const queued = queue.indexOf(key);
  if (queued >= 0) queue.splice(queued, 1);
  entries.delete(key);
}

/** 节点从场景撤下了（重载时发现它已被删）：撤表。 */
export function forgetLoadedNode(refno: string): void {
  drop(toRefnoKey(refno));
  stopWatchingIfIdle();
}

/** 场景清空 / 查看器卸载：整张表撤掉。 */
export function resetLoadedNodes(): void {
  for (const key of [...entries.keys()]) drop(key);
  stopWatchingIfIdle();
}

/** 人点一下：重问这个节点（先重拉一次 `/dbnums`，水位变了会连带重问同库的其它节点）。 */
export function recheckLoadedNode(refno: string): void {
  const key = toRefnoKey(refno);
  if (!entries.has(key)) return;
  refreshRows();
  schedule(key);
}

export function loadedNodeEntry(refno: string): LoadedNodeEntry | null {
  return entries.get(toRefnoKey(refno)) ?? null;
}

/** 行尾要画的东西；这个节点不在表里回 `null`。 */
export function loadedNodeView(refno: string): LoadedNodeView | null {
  const entry = entries.get(toRefnoKey(refno));
  if (!entry) return null;
  const status = entry.status;
  if (!status) return { verdict: null, iconKind: null, title: '本节点：正在核对新旧…', action: null, checking: entry.checking };
  const text = describeNodeModelStatus(status);
  return {
    verdict: status.verdict,
    iconKind: nodeModelStatusIconKind(status),
    title: [`本节点：${text.headline}`, text.detail].filter(Boolean).join('\n'),
    action: nodeModelStatusAction(status),
    checking: entry.checking,
  };
}

export function useLoadedNodeStatus() {
  return {
    provideChangeQuery: provideLoadedNodeChangeQuery,
    noteLoaded: noteLoadedNode,
    forget: forgetLoadedNode,
    reset: resetLoadedNodes,
    recheck: recheckLoadedNode,
    entry: loadedNodeEntry,
    view: loadedNodeView,
    /** 表里的全部节点（按登记顺序） */
    entries: (): LoadedNodeEntry[] => [...entries.values()],
  };
}
