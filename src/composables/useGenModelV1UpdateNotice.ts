/**
 * gen-model 增量批次的「轻量联动」（2026-10-26 联动验证 `docs/verification/incremental-linkage-2026-10-26`）。
 *
 * 订阅 `/api/v1/ws` tasks 主题里**所有**任务的 `task_finished`（不只是本会话登记的）：后端自己跑完的 DESI
 * 数据批次落在当前已装入的库 / 生成根上时，只在底部状态栏给一条可点的提示，由人决定何时重载受影响的生成根；
 * 不自动换场景、不打断进行中的标注 / 测量。收口计划 §12「只吃自己 ensure 出来的数据」仍然成立：这里不替用户换数据，
 * 只告诉他数据变了；点「重载」才走 `showModelByRefnos { refreshModel: true }` 把受影响的根换成最新记录。
 *
 * 信封形状见 gen-model `docs/specs/web-service-api.md` §5.3：`payload.result.batch { dbnum, db_type, start_sesno, end_sesno,
 * changed_elements }`、`payload.result.units[] { root_refno, kind }`。
 */
import { computed, ref } from 'vue';

import { fromV1Refno } from '@/api/genModelV1Api';
import { subscribeGenModelV1TaskEvents, type GenModelV1TaskEnvelope } from '@/composables/useGenModelV1TaskFeed';

export type GenModelV1FinishedBatch = {
  taskId: string;
  dbnum: number;
  dbType: string;
  startSesno: number | null;
  endSesno: number;
  changedElements: number;
  /** 批次里的模型工作单元根（`a_b`） */
  roots: string[];
  finishedAt: string | null;
};

export type GenModelV1UpdateNotice = GenModelV1FinishedBatch & {
  /** `roots` 里当前已装进场景的那些；「重载」只重载这些 */
  loadedRoots: string[];
  receivedAt: number;
};

/**
 * 场景里现在装着什么：由 ViewerPanel 注入。`isRootLoaded(refno, dbnum)` 要按生成根问——EQUI / BRAN 这类单元自己多半
 * 一个对象都没有，几何在成员名下，要沿属主链查（`resolveDtxObjectIdsByUnitRefno`）。
 */
export type GenModelV1LoadedProbe = {
  dbnums: () => Iterable<number>;
  isRootLoaded: (refno: string, dbnum: number) => boolean;
};

export type ShowModelByRefnosDetail = { refnos: string[]; refreshModel: true; flyTo: false };

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `task_finished` 且 `state === succeeded` 且带 `result.batch` 的信封 → 批次摘要；其它信封回 `null`。 */
export function parseGenModelV1FinishedBatch(envelope: GenModelV1TaskEnvelope): GenModelV1FinishedBatch | null {
  if (!envelope || envelope.type !== 'task_finished') return null;
  const payload = envelope.payload as
    | { state?: unknown; result?: { batch?: Record<string, unknown>; units?: unknown } }
    | undefined;
  if (!payload || typeof payload !== 'object' || payload.state !== 'succeeded') return null;
  const batch = payload.result?.batch;
  if (!batch || typeof batch !== 'object') return null;
  const dbnum = finiteNumber(batch.dbnum);
  const endSesno = finiteNumber(batch.end_sesno);
  if (dbnum === null || endSesno === null) return null;
  const taskId = typeof envelope.task_id === 'string' && envelope.task_id
    ? envelope.task_id
    : typeof (payload as { task_id?: unknown }).task_id === 'string'
      ? String((payload as { task_id?: unknown }).task_id)
      : '';
  const units = Array.isArray(payload.result?.units) ? payload.result!.units as unknown[] : [];
  const roots: string[] = [];
  for (const unit of units) {
    const raw = (unit as { root_refno?: unknown } | null)?.root_refno;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const key = fromV1Refno(raw);
    if (!roots.includes(key)) roots.push(key);
  }
  return {
    taskId,
    dbnum,
    dbType: typeof batch.db_type === 'string' ? batch.db_type : '',
    startSesno: finiteNumber(batch.start_sesno),
    endSesno,
    changedElements: finiteNumber(batch.changed_elements) ?? 0,
    roots,
    finishedAt: typeof envelope.ts === 'string' ? envelope.ts : null,
  };
}

/**
 * 这一批跟当前场景有没有关系：只看 DESI（SYST / DICT 等 meta 库不改几何）、要真有变化（只登录不改的
 * DBMDAT-only 会话 `changed_elements = 0`、没单元）、且要么该库已装入、要么批次里有根已在场景里。
 */
export function evaluateGenModelV1UpdateNotice(
  batch: GenModelV1FinishedBatch,
  probe: GenModelV1LoadedProbe,
  now = Date.now(),
): GenModelV1UpdateNotice | null {
  if (batch.dbType !== 'DESI') return null;
  if (batch.changedElements <= 0 && batch.roots.length === 0) return null;
  const loadedRoots = batch.roots.filter((root) => probe.isRootLoaded(root, batch.dbnum));
  let dbnumLoaded = false;
  for (const dbnum of probe.dbnums()) {
    if (dbnum === batch.dbnum) { dbnumLoaded = true; break; }
  }
  if (!dbnumLoaded && loadedRoots.length === 0) return null;
  return { ...batch, loadedRoots, receivedAt: now };
}

const notice = ref<GenModelV1UpdateNotice | null>(null);
let probe: GenModelV1LoadedProbe | null = null;
let unsubscribe: (() => void) | null = null;
const batchListeners = new Set<(batch: GenModelV1FinishedBatch) => void>();

export function setGenModelV1LoadedProbe(next: GenModelV1LoadedProbe | null): void {
  probe = next;
}

/** 每一条解析出来的批次（不论跟场景有没有关系）都通知；模型生成对话框用它刷水位行。返回退订函数。 */
export function subscribeGenModelV1FinishedBatches(listener: (batch: GenModelV1FinishedBatch) => void): () => void {
  batchListeners.add(listener);
  return () => { batchListeners.delete(listener); };
}

/** 处理一条 tasks 信封；导出给测试直接喫。 */
export function handleGenModelV1TaskEnvelopeForNotice(envelope: GenModelV1TaskEnvelope): void {
  const batch = parseGenModelV1FinishedBatch(envelope);
  if (!batch) return;
  for (const listener of batchListeners) {
    try {
      listener(batch);
    } catch {
      // 单个监听方的异常不能打断事件流
    }
  }
  if (!probe) return;
  const next = evaluateGenModelV1UpdateNotice(batch, probe);
  // 同一库连着来几批只留最新一条；重载一次就是最新数据。不同库的提示也只留一条（状态栏只摆得下一条）。
  if (next) notice.value = next;
}

/** 订阅任务流（幂等）；第一个订阅者会把 `/api/v1/ws` 拉起来。 */
export function startGenModelV1UpdateNotice(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeGenModelV1TaskEvents(handleGenModelV1TaskEnvelopeForNotice);
}

export function stopGenModelV1UpdateNotice(): void {
  unsubscribe?.();
  unsubscribe = null;
}

export function dismissGenModelV1UpdateNotice(): void {
  notice.value = null;
}

/**
 * 「重载」：把提示里已在场景的根按 `refreshModel` 重新装一遍（ViewerPanel 听 `showModelByRefnos`，只换记录与实例，
 * 不重新生成、不飞相机）。返回派发了哪些 refno；没有已装入的受影响根时不派发（改的是没显示的构件）。
 */
export function reloadGenModelV1UpdateNotice(
  dispatch: (detail: ShowModelByRefnosDetail) => void = (detail) => {
    window.dispatchEvent(new CustomEvent('showModelByRefnos', { detail }));
  },
): string[] {
  const current = notice.value;
  notice.value = null;
  if (!current || current.loadedRoots.length === 0) return [];
  const refnos = [...current.loadedRoots];
  dispatch({ refnos, refreshModel: true, flyTo: false });
  return refnos;
}

export function __resetGenModelV1UpdateNoticeForTests(): void {
  stopGenModelV1UpdateNotice();
  notice.value = null;
  probe = null;
  batchListeners.clear();
}

export function useGenModelV1UpdateNotice() {
  return {
    notice,
    hasNotice: computed(() => notice.value !== null),
    dismiss: dismissGenModelV1UpdateNotice,
    reload: reloadGenModelV1UpdateNotice,
  };
}