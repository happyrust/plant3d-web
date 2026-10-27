/**
 * gen-model 数据批次的「轻量联动」（2026-10-26 联动验证 `docs/verification/incremental-linkage-2026-10-26`；
 * 增量更新案例集合 K 组见 gen-model `docs/plans/2026-10-27-plant3d-web-incremental-linkage-test-cases.md`）。
 *
 * 订阅 `/api/v1/ws` tasks 主题里**所有**任务的 `task_finished`（不只是本会话登记的）：后端自己跑完的 DESI
 * 数据批次落在当前已装入的库 / 生成根上时，只在底部状态栏给一条可点的更新提示，由人决定何时重载受影响的生成根；
 * 不自动换场景、不打断进行中的标注 / 测量。收口计划 §12「只吃自己 ensure 出来的数据」仍然成立：这里不替用户换数据，
 * 只告诉他数据变了；点「重载」才走 `showModelByRefnos { refreshModel: true }` 把受影响的根换成最新记录。
 *
 * - 重载或忽略之前到达的相关批次并进同一条提示：根取并集，会话范围按库从最早的起点到最新的终点。只留最新一条的话，
 *   前一批动过、后一批没动的根永远换不上。
 * - `partial`（数据已应用、部分单元生成失败）照样提示；生成失败的根记录没换，不进重载名单。
 * - 批次里整根删掉的单元不在 `result.units` 里（删除走 DeleteCleanup，不出单元回执），另查
 *   `/tasks/{id}/changes`；场景里还挂着的进重载名单，重载时记录查空即从场景撤下。
 *
 * 信封形状见 gen-model `docs/specs/web-service-api.md` §5.3：`payload.result.batch { dbnum, db_type, start_sesno, end_sesno,
 * changed_elements }`、`payload.result.units[] { root_refno, status, kind }`。
 */
import { computed, ref } from 'vue';

import { fromV1Refno, genModelV1TaskChanges, type TaskChangesResponse } from '@/api/genModelV1Api';
import { subscribeGenModelV1TaskEvents, type GenModelV1TaskEnvelope } from '@/composables/useGenModelV1TaskFeed';

export type GenModelV1FinishedBatch = {
  taskId: string;
  /** `partial` = 数据已应用、部分单元生成失败 */
  state: 'succeeded' | 'partial';
  dbnum: number;
  dbType: string;
  startSesno: number | null;
  endSesno: number;
  changedElements: number;
  /** 批次里的模型工作单元根（`a_b`），含生成失败的 */
  roots: string[];
  /** `roots` 里这一轮生成失败的（`status = failed`）：记录没换，重载不碰 */
  failedRoots: string[];
  finishedAt: string | null;
};

/** 一个批次落在当前场景上的那一份（`evaluateGenModelV1UpdateNotice` 的结果）。 */
export type GenModelV1BatchImpact = GenModelV1FinishedBatch & {
  /** `roots` 里生成成功、且已装进场景的那些 */
  loadedRoots: string[];
  receivedAt: number;
};

export type GenModelV1NoticeSpan = { dbnum: number; startSesno: number | null; endSesno: number };

/** 状态栏上的那一条更新提示：重载或忽略之前到达的相关批次都并在这里。 */
export type GenModelV1UpdateNotice = {
  taskIds: string[];
  /** 每个库一段会话范围，按首次出现的顺序 */
  spans: GenModelV1NoticeSpan[];
  changedElements: number;
  roots: string[];
  /** 在并进来的某一批里生成成功过的根 */
  generatedRoots: string[];
  /** 生成失败、并进来的批次里也没再成功过的根：重载不换，场景里保留旧几何 */
  failedRoots: string[];
  /** 批次里删掉、场景里还挂着的单元根 */
  deletedRoots: string[];
  /** 重载名单：已在场景里且生成成功的根，加上 `deletedRoots` */
  loadedRoots: string[];
  /** 删除清单没查全（翻满上限还有游标，或某一页查询失败）：可能还有没被撤下的根 */
  deletionsIncomplete: boolean;
  receivedAt: number;
};

/**
 * 场景里现在装着什么：由 ViewerPanel 注入（见 `createGenModelV1LoadedProbe`）。`isRootLoaded(refno, dbnum)` 要按生成根问——
 * EQUI / BRAN 这类单元自己多半一个对象都没有，几何在成员名下，要沿属主链查（`resolveDtxObjectIdsByUnitRefno`）。
 */
export type GenModelV1LoadedProbe = {
  dbnums: () => Iterable<number>;
  isRootLoaded: (refno: string, dbnum: number) => boolean;
};

export type ShowModelByRefnosDetail = { refnos: string[]; refreshModel: true; flyTo: false };

export type GenModelV1ChangesPage = (
  taskId: string,
  cursor: string | null,
) => Promise<Pick<TaskChangesResponse, 'items' | 'next_cursor'> & { truncated?: boolean }>;

/** 删除清单查询的结果：拿到的根，以及清单是否完整。 */
export type GenModelV1DeletedRootsLookup = {
  roots: string[];
  /** 翻满上限仍有游标，或某一页查询失败：清单不完整，后面的删除项可能漏掉 */
  incomplete: boolean;
};

const CHANGES_PAGE_SIZE = 1000;
/** 服务端清单封顶 5000 条，五页就是全部 */
const MAX_CHANGES_PAGES = 5;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function union(base: readonly string[], extra: readonly string[]): string[] {
  const out = [...base];
  for (const item of extra) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/** `task_finished` 且 `state` 为 `succeeded` / `partial` 且带 `result.batch` 的信封 → 批次摘要；其它信封回 `null`。 */
export function parseGenModelV1FinishedBatch(envelope: GenModelV1TaskEnvelope): GenModelV1FinishedBatch | null {
  if (!envelope || envelope.type !== 'task_finished') return null;
  const payload = envelope.payload as
    | { state?: unknown; task_id?: unknown; result?: { batch?: Record<string, unknown>; units?: unknown } }
    | undefined;
  if (!payload || typeof payload !== 'object') return null;
  const state = payload.state === 'succeeded' ? 'succeeded' : payload.state === 'partial' ? 'partial' : null;
  if (!state) return null;
  const batch = payload.result?.batch;
  if (!batch || typeof batch !== 'object') return null;
  const dbnum = finiteNumber(batch.dbnum);
  const endSesno = finiteNumber(batch.end_sesno);
  if (dbnum === null || endSesno === null) return null;
  const taskId = typeof envelope.task_id === 'string' && envelope.task_id
    ? envelope.task_id
    : typeof payload.task_id === 'string'
      ? payload.task_id
      : '';
  const units = Array.isArray(payload.result?.units) ? payload.result!.units as unknown[] : [];
  const roots: string[] = [];
  const failedRoots: string[] = [];
  for (const unit of units) {
    if (!unit || typeof unit !== 'object') continue;
    const { root_refno: raw, status } = unit as { root_refno?: unknown; status?: unknown };
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const key = fromV1Refno(raw);
    if (!roots.includes(key)) roots.push(key);
    if (typeof status === 'string' && status.toLowerCase() === 'failed' && !failedRoots.includes(key)) {
      failedRoots.push(key);
    }
  }
  return {
    taskId,
    state,
    dbnum,
    dbType: typeof batch.db_type === 'string' ? batch.db_type : '',
    startSesno: finiteNumber(batch.start_sesno),
    endSesno,
    changedElements: finiteNumber(batch.changed_elements) ?? 0,
    roots,
    failedRoots,
    finishedAt: typeof envelope.ts === 'string' ? envelope.ts : null,
  };
}

/**
 * 这一批跟当前场景有没有关系：只看 DESI（SYST / DICT 等 meta 库不改几何）、要真有变化（只登录不改的
 * DBMDAT-only 会话 `changed_elements = 0`、没单元）、且要么该库已装入、要么批次里有根已在场景里。
 * 生成失败但在场景里的根也算「有关系」（要让人知道），只是不进 `loadedRoots`。
 */
export function evaluateGenModelV1UpdateNotice(
  batch: GenModelV1FinishedBatch,
  probe: GenModelV1LoadedProbe,
  now = Date.now(),
): GenModelV1BatchImpact | null {
  if (batch.dbType !== 'DESI') return null;
  if (batch.changedElements <= 0 && batch.roots.length === 0) return null;
  const inScene = batch.roots.filter((root) => probe.isRootLoaded(root, batch.dbnum));
  let dbnumLoaded = false;
  for (const dbnum of probe.dbnums()) {
    if (dbnum === batch.dbnum) { dbnumLoaded = true; break; }
  }
  if (!dbnumLoaded && inScene.length === 0) return null;
  return {
    ...batch,
    loadedRoots: inScene.filter((root) => !batch.failedRoots.includes(root)),
    receivedAt: now,
  };
}

function mergeSpan(
  spans: readonly GenModelV1NoticeSpan[],
  batch: Pick<GenModelV1FinishedBatch, 'dbnum' | 'startSesno' | 'endSesno'>,
): GenModelV1NoticeSpan[] {
  const out = spans.map((span) => ({ ...span }));
  const hit = out.find((span) => span.dbnum === batch.dbnum);
  if (!hit) {
    out.push({ dbnum: batch.dbnum, startSesno: batch.startSesno, endSesno: batch.endSesno });
    return out;
  }
  if (batch.startSesno !== null) {
    hit.startSesno = hit.startSesno === null ? batch.startSesno : Math.min(hit.startSesno, batch.startSesno);
  }
  hit.endSesno = Math.max(hit.endSesno, batch.endSesno);
  return out;
}

function emptyNotice(): GenModelV1UpdateNotice {
  return {
    taskIds: [],
    spans: [],
    changedElements: 0,
    roots: [],
    generatedRoots: [],
    failedRoots: [],
    deletedRoots: [],
    loadedRoots: [],
    deletionsIncomplete: false,
    receivedAt: 0,
  };
}

/** 把一批的影响并进提示。同一个任务重复到达（WS 重发）不重复计数。 */
export function mergeGenModelV1UpdateNotice(
  prev: GenModelV1UpdateNotice | null,
  impact: GenModelV1BatchImpact,
): GenModelV1UpdateNotice {
  const base = prev ?? emptyNotice();
  const alreadyCounted = impact.taskId !== '' && base.taskIds.includes(impact.taskId);
  const generatedRoots = union(
    base.generatedRoots,
    impact.roots.filter((root) => !impact.failedRoots.includes(root)),
  );
  return {
    taskIds: impact.taskId && !alreadyCounted ? [...base.taskIds, impact.taskId] : base.taskIds,
    spans: mergeSpan(base.spans, impact),
    changedElements: alreadyCounted ? base.changedElements : base.changedElements + impact.changedElements,
    roots: union(base.roots, impact.roots),
    generatedRoots,
    failedRoots: union(base.failedRoots, impact.failedRoots).filter((root) => !generatedRoots.includes(root)),
    deletedRoots: base.deletedRoots,
    loadedRoots: union(base.loadedRoots, impact.loadedRoots),
    deletionsIncomplete: base.deletionsIncomplete,
    receivedAt: impact.receivedAt,
  };
}

/** 把一批里删掉、场景里还挂着的单元根并进提示（`/tasks/{id}/changes` 查回来之后）。 */
export function mergeGenModelV1DeletedRoots(
  prev: GenModelV1UpdateNotice | null,
  batch: GenModelV1FinishedBatch,
  deletedRoots: readonly string[],
  now = Date.now(),
  incomplete = false,
): GenModelV1UpdateNotice | null {
  if (deletedRoots.length === 0 && !incomplete) return prev;
  const base = prev && batch.taskId !== '' && prev.taskIds.includes(batch.taskId)
    ? prev
    : mergeGenModelV1UpdateNotice(prev, { ...batch, loadedRoots: [], receivedAt: now });
  return {
    ...base,
    deletedRoots: union(base.deletedRoots, deletedRoots),
    loadedRoots: union(base.loadedRoots, deletedRoots),
    deletionsIncomplete: base.deletionsIncomplete || incomplete,
    receivedAt: now,
  };
}

const defaultChangesPage: GenModelV1ChangesPage = (taskId, cursor) =>
  genModelV1TaskChanges(taskId, { cursor, limit: CHANGES_PAGE_SIZE });

/**
 * 这一批里整根删掉、场景里还挂着的单元根：`/tasks/{id}/changes` 里 `op = deleted` 的元素，它就是自己的生成根，
 * 或它的生成根不在这批的单元回执里。成员被删、根重算的那种由重载时的记录差集撤下，不在这里。
 * 清单只有数据窗口落地了的批次有；查不到就当没有删除，不影响提示本身。
 *
 * 返回的 `incomplete` 表示清单没走完（翻满上限还有游标，或某一页查询失败）：调用方要把这个事实写进提示，
 * 否则排在后面的被删根会静默漏出重载名单，重载后残影还在。
 */
export async function lookupGenModelV1DeletedRootsInScene(
  batch: GenModelV1FinishedBatch,
  probe: GenModelV1LoadedProbe,
  fetchPage: GenModelV1ChangesPage = defaultChangesPage,
): Promise<GenModelV1DeletedRootsLookup> {
  if (!batch.taskId) return { roots: [], incomplete: false };
  const found: string[] = [];
  let cursor: string | null = null;
  let incomplete = false;
  for (let page = 0; page < MAX_CHANGES_PAGES; page += 1) {
    let resp: Awaited<ReturnType<GenModelV1ChangesPage>>;
    try {
      resp = await fetchPage(batch.taskId, cursor);
    } catch {
      // 网络错误 / 超时 / 5xx：这一页之后的删除项都看不到，标成不完整而不是当成「没有删除」
      return { roots: found, incomplete: true };
    }
    for (const item of resp.items ?? []) {
      if (!item || typeof item.op !== 'string' || !/^del/i.test(item.op)) continue;
      if (typeof item.refno !== 'string' || !item.refno.trim()) continue;
      const key = fromV1Refno(item.refno);
      const root = typeof item.root_refno === 'string' && item.root_refno.trim() ? fromV1Refno(item.root_refno) : null;
      if (root && root !== key && batch.roots.includes(root)) continue;
      if (!found.includes(key) && probe.isRootLoaded(key, batch.dbnum)) found.push(key);
    }
    if (resp.truncated) incomplete = true;
    if (resp.next_cursor === null || resp.next_cursor === undefined || resp.next_cursor === '') break;
    cursor = String(resp.next_cursor);
    // 最后一页仍有游标：服务端清单比我们翻得到的多
    if (page === MAX_CHANGES_PAGES - 1) incomplete = true;
  }
  return { roots: found, incomplete };
}

/** ViewerPanel 的场景探针：库是否已装入看当前激活的库；根是否在场景先问加载器记账，再沿属主链问 DTX 运行时索引。 */
export function createGenModelV1LoadedProbe(deps: {
  activeDbnum: () => number | null;
  isModelActuallyLoaded: (refno: string) => boolean;
  resolveUnitObjectIds: (dbnum: number, refno: string) => string[];
}): GenModelV1LoadedProbe {
  return {
    dbnums: () => {
      const dbnum = deps.activeDbnum();
      return dbnum !== null ? [dbnum] : [];
    },
    isRootLoaded: (refno, dbnum) =>
      deps.isModelActuallyLoaded(refno) || deps.resolveUnitObjectIds(dbnum, refno).length > 0,
  };
}

/** 状态栏那一行：单库写会话范围，跨库只列库号。 */
export function formatGenModelV1UpdateNoticeText(notice: GenModelV1UpdateNotice): string {
  const [only] = notice.spans;
  let head = '数据已更新';
  if (notice.spans.length === 1 && only) {
    const span = only.startSesno !== null && only.startSesno !== only.endSesno
      ? `${only.startSesno}→${only.endSesno}`
      : String(only.endSesno);
    head = `库 ${only.dbnum} 已更新到会话 ${span}`;
  } else if (notice.spans.length > 1) {
    head = `库 ${notice.spans.map((span) => span.dbnum).join('、')} 已更新`;
  }
  const parts = [`改 ${notice.changedElements} 项`];
  if (notice.loadedRoots.length > 0) parts.push(`场景内 ${notice.loadedRoots.length} 根受影响`);
  if (notice.failedRoots.length > 0) parts.push(`${notice.failedRoots.length} 根生成失败`);
  if (notice.deletionsIncomplete) parts.push('删除清单不完整');
  return `${head}（${parts.join('，')}）`;
}

/** 悬停说明：哪几个任务、哪些根、重载会做什么。 */
export function formatGenModelV1UpdateNoticeTitle(notice: GenModelV1UpdateNotice): string {
  const lines = [`gen-model 任务 ${notice.taskIds.join(', ') || '（未知）'}`];
  if (notice.spans.length > 1) {
    for (const span of notice.spans) {
      lines.push(`库 ${span.dbnum}：会话 ${span.startSesno ?? '?'}→${span.endSesno}`);
    }
  }
  lines.push(`批次里的生成根：${notice.roots.join(', ') || '（无模型工作单元）'}`);
  if (notice.deletedRoots.length > 0) {
    lines.push(`批次里删掉、场景里还在的：${notice.deletedRoots.join(', ')}（重载时撤下）`);
  }
  if (notice.failedRoots.length > 0) {
    lines.push(`生成失败、重载不换（场景里保留旧几何）：${notice.failedRoots.join(', ')}`);
  }
  if (notice.deletionsIncomplete) {
    lines.push('删除清单没查全（超过服务端单批上限或查询失败）：可能有已删构件没被撤下，重载后请核对场景');
  }
  lines.push(notice.loadedRoots.length > 0
    ? `点「重载」按最新记录替换场景里的 ${notice.loadedRoots.join(', ')}；不重新生成、不动相机`
    : '受影响的构件都不在场景里，不用重载');
  return lines.join('\n');
}

const notice = ref<GenModelV1UpdateNotice | null>(null);
let probe: GenModelV1LoadedProbe | null = null;
let unsubscribe: (() => void) | null = null;
const batchListeners = new Set<(batch: GenModelV1FinishedBatch) => void>();

/**
 * 提示条代次。`handleGenModelV1TaskEnvelopeForNotice` 里的删除清单查询是异步的，等它回来时提示可能已经被
 * 忽略、重载、换了探针或整体复位过；代次对不上就丢弃这次结果，否则提示会重新冒出来、改动数也会重复计。
 */
let noticeEpoch = 0;

function bumpNoticeEpoch(): void {
  noticeEpoch += 1;
}

export function setGenModelV1LoadedProbe(next: GenModelV1LoadedProbe | null): void {
  bumpNoticeEpoch();
  probe = next;
  // 查看器卸载（探针置 null）：提示条是全局的，留着它点了「重载」也没人接
  if (!next) notice.value = null;
}

/** 每一条解析出来的批次（不论跟场景有没有关系）都通知；模型生成对话框用它刷水位行。返回退订函数。 */
export function subscribeGenModelV1FinishedBatches(listener: (batch: GenModelV1FinishedBatch) => void): () => void {
  batchListeners.add(listener);
  return () => { batchListeners.delete(listener); };
}

/**
 * 处理一条 tasks 信封；导出给测试直接喂。同步部分并进单元回执里的根，返回的 Promise 在删除查询并进去之后才落定。
 *
 * 删除清单查询是异步的：await 回来后必须核对代次（期间可能被忽略 / 重载 / 换探针 / 复位），对不上就丢弃。
 */
export async function handleGenModelV1TaskEnvelopeForNotice(envelope: GenModelV1TaskEnvelope): Promise<void> {
  const batch = parseGenModelV1FinishedBatch(envelope);
  if (!batch) return;
  for (const listener of batchListeners) {
    try {
      listener(batch);
    } catch {
      // 单个监听方的异常不能打断事件流
    }
  }
  const current = probe;
  if (!current) return;
  const impact = evaluateGenModelV1UpdateNotice(batch, current);
  if (impact) notice.value = mergeGenModelV1UpdateNotice(notice.value, impact);
  if (batch.dbType !== 'DESI' || batch.changedElements <= 0) return;
  const epoch = noticeEpoch;
  const lookup = await lookupGenModelV1DeletedRootsInScene(batch, current);
  if (epoch !== noticeEpoch) return;
  // 跟场景无关的批次（库没装、根一个都不在场景）只查到了「清单不完整」也不能出提示：
  // 否则任何不相关库的 changes 查询失败都会在状态栏冒一条「数据已更新」。
  if (!impact && lookup.roots.length === 0) return;
  if (lookup.roots.length > 0 || lookup.incomplete) {
    notice.value = mergeGenModelV1DeletedRoots(notice.value, batch, lookup.roots, Date.now(), lookup.incomplete);
  }
}

/** 订阅任务流（幂等）；第一个订阅者会把 `/api/v1/ws` 拉起来。 */
export function startGenModelV1UpdateNotice(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeGenModelV1TaskEvents((envelope) => {
    // handler 现在是 async：探针同步抛错或响应体异常都会变成 rejection，这里必须兜住
    void handleGenModelV1TaskEnvelopeForNotice(envelope).catch((error) => {
      console.warn('[gen-model-v1] 处理更新通知信封失败', error);
    });
  });
}

export function stopGenModelV1UpdateNotice(): void {
  unsubscribe?.();
  unsubscribe = null;
}

export function dismissGenModelV1UpdateNotice(): void {
  bumpNoticeEpoch();
  notice.value = null;
}

/**
 * 「重载」：把提示里的重载名单按 `refreshModel` 重新装一遍（ViewerPanel 听 `showModelByRefnos`，只换记录与实例，
 * 不重新生成、不飞相机；删掉的根查空即撤下）。返回派发了哪些 refno；名单为空时不派发（改的是没显示的构件）。
 */
export function reloadGenModelV1UpdateNotice(
  dispatch: (detail: ShowModelByRefnosDetail) => void = (detail) => {
    window.dispatchEvent(new CustomEvent('showModelByRefnos', { detail }));
  },
): string[] {
  bumpNoticeEpoch();
  const current = notice.value;
  notice.value = null;
  if (!current || current.loadedRoots.length === 0) return [];
  const refnos = [...current.loadedRoots];
  dispatch({ refnos, refreshModel: true, flyTo: false });
  return refnos;
}

export function __resetGenModelV1UpdateNoticeForTests(): void {
  stopGenModelV1UpdateNotice();
  bumpNoticeEpoch();
  notice.value = null;
  probe = null;
  batchListeners.clear();
}

export function useGenModelV1UpdateNotice() {
  return {
    notice,
    hasNotice: computed(() => notice.value !== null),
    text: computed(() => (notice.value ? formatGenModelV1UpdateNoticeText(notice.value) : '')),
    title: computed(() => (notice.value ? formatGenModelV1UpdateNoticeTitle(notice.value) : '')),
    dismiss: dismissGenModelV1UpdateNotice,
    reload: reloadGenModelV1UpdateNotice,
  };
}
