/**
 * `show_dbnum` 整库入口（plan P3-c / P3-f；服务端整库入口见收口计划 §17）。
 *
 * 两条路，优先走第一条：
 *
 * 1. **服务端整库入口**（`collectDbnumViaServer`，spec §4.5.3，读透 / kv-mem 形态）：
 *    `POST dbnums/{dbnum}/model/ensure` 起任务 → 每拍轮询 `GET tasks/{id}`（进度）+ `GET dbnums/{dbnum}/model/roots?ready=1`
 *    （哪些根的投影已提交）→ 新就绪的根**立刻**取 `records` 并经 `onRefnosReady` 交给调用方装进视口 → 任务终态后收尾。
 *    生成的编排全在服务端（e3d-model 流水线按片提交），前端边就绪边取——**实时**（plan 2026-09-10 §12）。
 *    旧 §4.5.3 构建（roots 行没有 `ready`）退化为「等终态再整取」。
 * 2. **逐 SITE 老路**（服务端没有那条路由、或这个库以 rocksdb 为准时自动退回）：下面这段。
 *
 * 逐 SITE 老路 = `tree/roots` 里该库（`dbnum`）的全部 SITE 逐个 `ensureAndCollect`（走记录源，进同一份缓存），
 * 回构件 refno 集给调用方分批装进 DTX。
 *
 * - 一个 SITE 一次 ensure：摄入形态的服务端直接把 SITE 解成几百个生成根（`generation_roots`），或回 `422 container` 由记录层
 *   展开 ZONE 逐个 ensure；读透形态服务端直接解出全部根。
 * - SITE 之间**串行**：每个 SITE 内部已经并发取 records，再并发 SITE 只会让服务端「忙根 409」（plan R1）。
 * - **预算**：`maxTotalRoots`（跨 SITE 累计的生成根数）与 `maxRefnos`（构件数）。records 改成多根打包（收口计划 P9-3，≤64 根一次）
 *   之后生成根数不再是瓶颈，`maxTotalRoots` 缺省**不限**（`DEFAULT_DBNUM_ROOTS_BUDGET = Infinity`；2026-09-07 起曾是 200 根的
 *   「安全概览」），缺省只守 `maxRefnos = 50 000`——一次点击不该把整个大库拖进浏览器；`?show_dbnum_full=1` 连它也不设。
 *   撞到任一预算：超出的根记进 `truncatedRoots`、没轮到的 SITE 记进 `skippedSites`，`budgetLimited=true` 让调用方提示。
 * - 其它上限：每个 SITE 的 ensure 根数 / 深度比单节点显示宽（4096 / 4）。
 */
import { refnosOfRecords } from './modelRecords';

import type { GenModelV1ModelRecordSource } from './modelRecordSource';
import type { TreeSource } from '../ports';
import type { DbnumModelRootsResponse } from '@/api/genModelV1Api';
import type { GenModelV1DbnumModelCapability } from '@/composables/useGenModelV1Health';

import {
  fromV1Refno,
  genModelV1DbnumModelEnsure,
  genModelV1DbnumModelRoots,
  genModelV1TaskGet,
  isGenModelV1ApiError,
} from '@/api/genModelV1Api';
import {
  getGenModelV1ServiceGeneration,
} from '@/model-source/genModelV1/serviceLifecycle';

export type CollectDbnumSite = { refno: string; name: string };

export type CollectDbnumProgress = {
  /**
   * - `sites`：开始处理一个 SITE（逐 SITE 老路）；
   * - `roots`：又收完一个生成根的记录（两条路都发）；
   * - `generate`：服务端整库生成的进度（`rootsDone/rootsTotal` = 任务的 `completed/expected_roots`），只有服务端整库入口发。
   */
  phase: 'sites' | 'roots' | 'generate';
  /** 1-based；服务端整库入口没有 SITE 维度，恒 1 */
  siteIndex: number;
  siteCount: number;
  /** 服务端整库入口下为 `null`——这一路不按 SITE 推进 */
  site: CollectDbnumSite | null;
  rootsDone: number;
  rootsTotal: number;
  root: string | null;
};

/** 整库缺省的生成根预算：records 多根打包之后不限（P9-3）；调用方要「安全概览」自己传一个有限的 `maxTotalRoots`。 */
export const DEFAULT_DBNUM_ROOTS_BUDGET = Number.POSITIVE_INFINITY;
/** 整库缺省的构件预算：一次点击最多装这么多构件 refno；`?show_dbnum_full=1` 传 `Infinity` 才全量。 */
export const DEFAULT_DBNUM_REFNOS_BUDGET = 50_000;

/** 服务端整库入口每收完一批就绪根就交给调用方的一包（plan 2026-09-10 §12「实时生成」的客户端半边）。 */
export type CollectDbnumReadyBatch = {
  /** 这一批刚收完记录的生成根（`a_b`） */
  roots: string[];
  /** 其中有几何记录的构件 refno（`a_b`，与之前批次去重、已按 `maxRefnos` 切过），调用方拿去装 DTX */
  refnos: string[];
  /** 累计已收记录的根数 / 该库预期根数 */
  rootsDone: number;
  rootsTotal: number;
};

export type CollectDbnumOptions = {
  onProgress?: (progress: CollectDbnumProgress) => void;
  /**
   * 服务端整库入口的实时回调：服务端流水线每提交一片，这边就取那些根的记录并把构件交给调用方，**不等任务终态**。
   * 会被 await——调用方装完这一批再取下一批，DTX 装载不重叠。收尾那一批（含旧 §4.5.3 构建「等终态整取」的那一份）
   * 也从这里给；逐 SITE 老路不发，那条路的构件只在结果的 `refnos` 里。调用方装完要以结果的 `refnos` 对一遍账。
   */
  onRefnosReady?: (batch: CollectDbnumReadyBatch) => void | Promise<void>;
  maxRoots?: number;
  maxContainerDepth?: number;
  /** 收够这么多构件 refno 就停（缺省 `DEFAULT_DBNUM_REFNOS_BUDGET`）；`Infinity` = 全量 */
  maxRefnos?: number;
  /** 整库最多为多少个生成根取 records（缺省 `DEFAULT_DBNUM_ROOTS_BUDGET` = 不限）；有限值 = 「安全概览」 */
  maxTotalRoots?: number;
  /** 服务端整库生成的轮询间隔（缺省 2 s） */
  taskPollIntervalMs?: number;
  /** 轮询多久还没终态就不再等、按现状取记录（缺省 2 h：整库按小时计） */
  taskWaitTimeoutMs?: number;
  signal?: AbortSignal;
  onFallback?: (fallback: CollectDbnumFallback) => void;
  /** 生产组装点注入；低层单测缺省保持能力 unknown、任务 404 视为同一服务内逐出。 */
  lifecycle?: CollectDbnumLifecycle;
};

export type CollectDbnumFallbackReason = 'server_unsupported' | 'database_routed';

export type CollectDbnumFallback = {
  reason: CollectDbnumFallbackReason;
  message: string;
};

export type CollectDbnumLifecycle = {
  capability(): GenModelV1DbnumModelCapability;
  generation(): number;
  assertGeneration(captured: number): void;
  refreshAfterTaskNotFound(): Promise<number>;
  noteRequestFailure(error: unknown): void;
};

/** 服务端整库入口用到的三发（spec §4.5.3 + §4.4）；测试注入假实现。 */
export type DbnumServerEntryApi = {
  ensureDbnum: typeof genModelV1DbnumModelEnsure;
  dbnumRoots: typeof genModelV1DbnumModelRoots;
  task: typeof genModelV1TaskGet;
};

export const defaultDbnumServerEntryApi: DbnumServerEntryApi = {
  ensureDbnum: genModelV1DbnumModelEnsure,
  dbnumRoots: genModelV1DbnumModelRoots,
  task: genModelV1TaskGet,
};

type ServerEntrySupport = 'unknown' | 'yes' | 'no';

/**
 * 按 api 对象记「这个服务端有没有整库入口」：旧构建整条路由不存在（404 `not_found`），认一次就够，
 * 之后每次整库显示直接走逐 SITE 老路、不再白打一发。做法与 `modelRecords` 记「认不认识
 * `generation_roots`」同一套（生产只有 `defaultDbnumServerEntryApi` 一个对象）。
 */
let serverEntrySupportByApi = new WeakMap<
  DbnumServerEntryApi,
  { generation: number; support: ServerEntrySupport }
>();

/** 诊断 / 单测用：这个 api 的服务端对整库入口的已知态。 */
export function dbnumServerEntrySupport(api: DbnumServerEntryApi = defaultDbnumServerEntryApi): ServerEntrySupport {
  const remembered = serverEntrySupportByApi.get(api);
  return remembered?.generation === getGenModelV1ServiceGeneration() ? remembered.support : 'unknown';
}

export function resetDbnumServerEntrySupport(): void {
  serverEntrySupportByApi = new WeakMap();
}

/** `GET /tasks/{id}` 的终态（spec §4.4）。 */
const TERMINAL_TASK_STATES = new Set(['succeeded', 'partial', 'failed', 'yielded']);

const PASSIVE_LIFECYCLE: CollectDbnumLifecycle = {
  capability: () => 'unknown',
  generation: getGenModelV1ServiceGeneration,
  assertGeneration: (captured) => {
    if (captured !== getGenModelV1ServiceGeneration()) {
      throw new Error(`gen-model 服务代次已变化（${captured} → ${getGenModelV1ServiceGeneration()}）`);
    }
  },
  refreshAfterTaskNotFound: async () => getGenModelV1ServiceGeneration(),
  noteRequestFailure: (error) => { void error; },
};

function isFixedRouteUnsupported(error: unknown, includeInvalidResponse = false): boolean {
  if (!isGenModelV1ApiError(error)) return false;
  if ([404, 405, 501].includes(error.status)) return true;
  return includeInvalidResponse && error.code === 'invalid_response';
}

export type CollectDbnumResult = {
  dbnum: number;
  sites: CollectDbnumSite[];
  /** `false` 表示整库模型结果有效，但用于汇总的 tree/SITE 摘要读取失败；不能解释成“确实没有 SITE”。 */
  siteSummaryAvailable: boolean;
  /** 有几何记录的构件 refno（`a_b`，去重，按 SITE 顺序） */
  refnos: string[];
  generationRoots: string[];
  pending: string[];
  empty: string[];
  truncatedRoots: string[];
  errors: Record<string, string>;
  /** 因 `maxRefnos` / `maxTotalRoots` 没处理的 SITE */
  skippedSites: string[];
  /** 撞到 `maxTotalRoots` / `maxRefnos` 预算而停：结果是「安全概览」，不是整库 */
  budgetLimited: boolean;
  /** 走逐 SITE 兼容链时说明原因；整库入口成功时缺省。 */
  fallback?: CollectDbnumFallback;
};

function pushAllUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

/** 该库在当前 MDB 里的 SITE（虚拟根的直接子节点里 `dbnum` 相等的那些）。 */
export async function listSitesOfDbnum(tree: TreeSource, dbnum: number): Promise<CollectDbnumSite[]> {
  const root = await tree.worldRoot();
  if (!root.success || !root.node) throw new Error(root.error_message || 'gen-model tree/roots 不可用');
  const children = await tree.children(root.node.refno, 1_000_000);
  if (!children.success) throw new Error(children.error_message || 'gen-model tree/roots 不可用');
  return children.children
    .filter((node) => node.dbnum === dbnum)
    .map((node) => ({ refno: node.refno, name: node.name || node.refno }));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('整库收集已取消'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('整库收集已取消'));
    };
    function done(): void {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type RootsRow = DbnumModelRootsResponse['roots'][number];

/** 服务端 `roots` 的一行 → `a_b`；空的丢掉。 */
function rootKeys(rows: RootsRow[] | undefined): string[] {
  const keys: string[] = [];
  for (const row of rows ?? []) {
    const key = fromV1Refno(String(row?.generation_root ?? ''));
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** 这个服务端的 `roots` 认不认 `ready`（spec §4.5.3 第 3 稿）：行上有布尔 `ready`，或回显了 `only_ready`。 */
function rootsSupportReady(listed: DbnumModelRootsResponse): boolean {
  return listed.only_ready === true || (listed.roots ?? []).some((row) => typeof row?.ready === 'boolean');
}

/**
 * 服务端整库入口（spec §4.5.3，读透 / kv-mem 形态；plan 2026-09-10 §12「实时生成」）：
 * `dbnums/{dbnum}/model/ensure` 起任务 → 每拍 `tasks/{id}`（进度，只查自己这一个）+ `roots?ready=1`（哪些根的投影已提交）
 * → 新就绪的根**立刻**取 `records`、经 `onRefnosReady` 交给调用方装视口 → 任务终态后收尾。生成的编排全在服务端，
 * 前端一根也不催，也不等整库生成完才开始画。
 *
 * - 旧 §4.5.3 构建（`roots` 行没有 `ready`）：退化为等终态再整取，探能力那一发回的就是全清单，不再多打。
 * - 任务查不到：立即强制 health；started_at/保守 legacy 代次已变就终止旧收集，同代才按任务被逐出收尾。
 * - 预算：`maxTotalRoots` 在每批边界上判、`maxRefnos` 在构件上判，撞到就不再取后面的根，其余根记 `truncatedRoots`。
 * - 终态时仍没就绪的根：任务 `failed / partial` 记进 `errors`，超时未终态记进 `pending`。
 *
 * 服务端没有这条路（旧构建 404）或这个库以 rocksdb 为准（409）时回 `null`，由 `collectDbnumRefnos` 退回逐 SITE 老路。
 */
export async function collectDbnumViaServer(
  tree: TreeSource,
  records: GenModelV1ModelRecordSource,
  dbnum: number,
  options: CollectDbnumOptions = {},
  api: DbnumServerEntryApi = defaultDbnumServerEntryApi,
): Promise<CollectDbnumResult | null> {
  const {
    onProgress, onRefnosReady, maxRefnos = DEFAULT_DBNUM_REFNOS_BUDGET, maxTotalRoots = DEFAULT_DBNUM_ROOTS_BUDGET,
    taskPollIntervalMs = 2_000, taskWaitTimeoutMs = 2 * 60 * 60 * 1_000,
    signal, onFallback, lifecycle = PASSIVE_LIFECYCLE,
  } = options;
  const capability = lifecycle.capability();
  const fallback = (reason: CollectDbnumFallbackReason, message: string): null => {
    onFallback?.({ reason, message });
    return null;
  };
  if (capability === 'unsupported') {
    return fallback('server_unsupported', '服务端明确声明不支持整库入口，已走逐 SITE 兼容路径');
  }
  if (capability !== 'supported' && dbnumServerEntrySupport(api) === 'no') {
    return fallback('server_unsupported', '服务端版本不支持整库入口，已走逐 SITE 兼容路径');
  }

  let receipt;
  const supportGeneration = getGenModelV1ServiceGeneration();
  try {
    receipt = await api.ensureDbnum(dbnum, { signal });
  } catch (error) {
    lifecycle.noteRequestFailure(error);
    if (!isGenModelV1ApiError(error)) throw error;
    // capabilities 明确 true 时，404 可能只是这个 dbnum 不存在，不能把整台服务永久记成 no。
    if (isFixedRouteUnsupported(error) && capability !== 'supported') {
      if (supportGeneration === getGenModelV1ServiceGeneration()) {
        serverEntrySupportByApi.set(api, { generation: supportGeneration, support: 'no' });
      }
      return fallback('server_unsupported', '服务端版本不支持整库入口，已走逐 SITE 兼容路径');
    }
    // 这个库以 database 为准：本次退回逐 SITE，但**不**把服务端整体
    // 记成「没有」——同一进程里别的库仍可能是 memory 形态
    if (error.code === 'conflict') {
      return fallback('database_routed', '该库当前以 database 为准，已走逐 SITE 兼容路径');
    }
    throw error;
  }
  if (supportGeneration === getGenModelV1ServiceGeneration()) {
    serverEntrySupportByApi.set(api, { generation: supportGeneration, support: 'yes' });
  }

  const expectedRoots = Number(receipt.expected_roots) || 0;
  const taskId = String(receipt.task_id);
  const taskGeneration = lifecycle.generation();
  const rootBudget = Number.isFinite(maxTotalRoots) ? Math.max(0, Math.floor(maxTotalRoots)) : Number.POSITIVE_INFINITY;
  const refnoBudget = Number.isFinite(maxRefnos) ? Math.max(0, Math.floor(maxRefnos)) : Number.POSITIVE_INFINITY;
  const report = (phase: 'generate' | 'roots', rootsDone: number, root: string | null, rootsTotal = expectedRoots) =>
    onProgress?.({ phase, siteIndex: 1, siteCount: 1, site: null, rootsDone, rootsTotal, root });

  const collectedRoots = new Set<string>();
  const generationRoots: string[] = [];
  const pending: string[] = [];
  const empty: string[] = [];
  const errors: Record<string, string> = {};
  const refnos: string[] = [];
  const seenRefnos = new Set<string>();
  let refnoBudgetHit = false;
  const budgetExhausted = () => refnoBudgetHit || collectedRoots.size >= rootBudget;

  /** 一批就绪根：按根预算切 → 取记录进缓存 → 构件按 refno 预算切 → 交给调用方。 */
  async function collectReady(readyRoots: string[]): Promise<void> {
    if (budgetExhausted()) return;
    const fresh = readyRoots.filter((root) => !collectedRoots.has(root));
    const take = fresh.slice(0, Math.max(0, rootBudget - collectedRoots.size));
    if (take.length === 0) return;
    const result = await records.collectRoots(take, {
      signal,
      onRootDone: ({ done, root }) => report('roots', collectedRoots.size + done, root),
    });
    lifecycle.assertGeneration(taskGeneration);
    for (const root of take) collectedRoots.add(root);
    pushAllUnique(generationRoots, result.generationRoots);
    pushAllUnique(pending, result.pending);
    pushAllUnique(empty, result.empty);
    Object.assign(errors, result.errors);
    const batchRefnos: string[] = [];
    for (const refno of refnosOfRecords(result.items)) {
      if (seenRefnos.has(refno)) continue;
      if (refnos.length >= refnoBudget) {
        refnoBudgetHit = true;
        break;
      }
      seenRefnos.add(refno);
      refnos.push(refno);
      batchRefnos.push(refno);
    }
    if (onRefnosReady) {
      await onRefnosReady({ roots: take, refnos: batchRefnos, rootsDone: collectedRoots.size, rootsTotal: expectedRoots });
    }
  }

  report('generate', 0, null);
  const deadline = Date.now() + taskWaitTimeoutMs;
  let state = 'running';
  let completed = 0;
  let taskError: string | null = null;
  let taskReachedTerminal = false;
  let taskEvicted = false;
  let rootsUnavailable = false;
  // 服务端认不认 `ready`：第一次问过就知道；不认的话那一发回的就是全清单，收尾直接用，不再多打一次
  let readyMode: 'unknown' | 'yes' | 'no' = 'unknown';
  let fullList: DbnumModelRootsResponse | null = null;
  for (;;) {
    await sleep(taskPollIntervalMs, signal);
    let terminal = false;
    try {
      const entry = await api.task(taskId, { signal });
      lifecycle.assertGeneration(taskGeneration);
      state = String(entry.state ?? '');
      completed = Number(entry.units_done ?? 0) || 0;
      report('generate', completed, null, Number(entry.total_units ?? expectedRoots) || expectedRoots);
      if (TERMINAL_TASK_STATES.has(state)) {
        terminal = true;
        taskReachedTerminal = true;
        const failure = entry.result && typeof entry.result === 'object' ? (entry.result as Record<string, unknown>).error : null;
        taskError = typeof failure === 'string' ? failure : null;
      }
    } catch (error) {
      lifecycle.noteRequestFailure(error);
      if (!(isGenModelV1ApiError(error) && error.code === 'not_found')) throw error;
      await lifecycle.refreshAfterTaskNotFound();
      lifecycle.assertGeneration(taskGeneration);
      state = 'unknown';
      taskEvicted = true;
      taskReachedTerminal = true;
      terminal = true;
    }
    if (Date.now() >= deadline) {
      terminal = true;
    }
    // 实时半边：服务端报了进度（或任务已经查不到）才去问哪些根就绪，一根都没成时不白打
    if (!rootsUnavailable && !taskEvicted && readyMode !== 'no' && !budgetExhausted() && completed > 0) {
      try {
        const listed = await api.dbnumRoots(dbnum, { ready: true, taskId, signal });
        lifecycle.assertGeneration(taskGeneration);
        if (rootsSupportReady(listed)) {
          readyMode = 'yes';
          await collectReady(rootKeys((listed.roots ?? []).filter((row) => row?.ready !== false)));
        } else {
          readyMode = 'no';
          fullList = listed;
        }
      } catch (error) {
        lifecycle.noteRequestFailure(error);
        if (!isFixedRouteUnsupported(error, true)) throw error;
        rootsUnavailable = true;
        // POST 已经创建任务：这里只停止 roots 读取，继续等 task 终态，绝不并发起逐 SITE ensure。
        if (capability !== 'supported' && supportGeneration === getGenModelV1ServiceGeneration()) {
          serverEntrySupportByApi.set(api, { generation: supportGeneration, support: 'no' });
        }
      }
    }
    if (terminal) break;
  }
  if (state === 'failed' && completed === 0 && collectedRoots.size === 0) {
    throw new Error(`gen-model 整库生成失败 dbnum=${dbnum}${taskError ? `: ${taskError}` : ''}`);
  }
  if (rootsUnavailable) {
    if (!taskReachedTerminal) {
      throw new Error(
        `gen-model 整库任务 ${taskId} 尚未终态，但 roots 路由不可用；为避免重复生成，未启动逐 SITE 兼容链`,
      );
    }
    return fallback(
      'server_unsupported',
      '服务端 roots 能力不可用；已等待现有整库任务终态，再走逐 SITE 兼容路径',
    );
  }

  // 收尾：全清单对账。认 `ready` 的服务端把最后就绪的那批收掉；不认的（旧构建）整份当就绪，records 自己会对没生成的根
  // 409 → 退回逐根 → 记 errors。
  let listed = fullList;
  if (!listed) {
    try {
      listed = await api.dbnumRoots(dbnum, {
        ...(!taskEvicted ? { taskId } : {}),
        signal,
      });
      lifecycle.assertGeneration(taskGeneration);
    } catch (error) {
      lifecycle.noteRequestFailure(error);
      if (!isFixedRouteUnsupported(error, true)) throw error;
      if (capability !== 'supported' && supportGeneration === getGenModelV1ServiceGeneration()) {
        serverEntrySupportByApi.set(api, { generation: supportGeneration, support: 'no' });
      }
      if (!taskReachedTerminal) {
        throw new Error(
          `gen-model 整库任务 ${taskId} 尚未终态，但 roots 路由不可用；为避免重复生成，未启动逐 SITE 兼容链`,
        );
      }
      return fallback(
        'server_unsupported',
        '服务端 roots 能力不可用；已等待现有整库任务终态，再走逐 SITE 兼容路径',
      );
    }
  }
  const allRoots = rootKeys(listed.roots);
  // 以这一次最终响应自己的 ready 形状为准。任务未终态且旧接口没有 ready 信息时，
  // 不能把全根清单当成已就绪，否则 records 的 not_generated 退路会并发触发逐根 ensure。
  const finalListSupportsReady = rootsSupportReady(listed);
  const readyRows = finalListSupportsReady
    ? (listed.roots ?? []).filter((row) => row?.ready !== false)
    : taskReachedTerminal
      ? listed.roots
      : [];
  await collectReady(rootKeys(readyRows));

  const truncatedRoots: string[] = [];
  for (const root of allRoots) {
    if (collectedRoots.has(root)) continue;
    if (budgetExhausted()) {
      truncatedRoots.push(root);
    } else if (TERMINAL_TASK_STATES.has(state)) {
      errors[root] = `gen-model 整库生成没有产出这根（任务 ${state}）`;
    } else if (!pending.includes(root)) {
      pending.push(root);
    }
  }

  // SITE 清单只用来给汇总文案报个数：这一路不按 SITE 推进，树读不出来也不该让整库显示失败
  let sites: CollectDbnumSite[] = [];
  let siteSummaryAvailable = true;
  try {
    sites = await listSitesOfDbnum(tree, dbnum);
  } catch {
    siteSummaryAvailable = false;
    sites = [];
  }
  return {
    dbnum,
    sites,
    siteSummaryAvailable,
    refnos,
    generationRoots,
    pending,
    empty,
    truncatedRoots,
    errors,
    skippedSites: [],
    budgetLimited: truncatedRoots.length > 0 || refnoBudgetHit,
  };
}

export async function collectDbnumRefnos(
  tree: TreeSource,
  records: GenModelV1ModelRecordSource,
  dbnum: number,
  options: CollectDbnumOptions = {},
  api: DbnumServerEntryApi = defaultDbnumServerEntryApi,
): Promise<CollectDbnumResult> {
  let fallback: CollectDbnumFallback | undefined;
  const viaServer = await collectDbnumViaServer(tree, records, dbnum, {
    ...options,
    onFallback: (value) => {
      fallback = value;
      options.onFallback?.(value);
    },
  }, api);
  if (viaServer) return viaServer;
  const {
    onProgress, maxRoots = 4096, maxContainerDepth = 4, maxRefnos = DEFAULT_DBNUM_REFNOS_BUDGET, maxTotalRoots = DEFAULT_DBNUM_ROOTS_BUDGET,
  } = options;
  const sites = await listSitesOfDbnum(tree, dbnum);
  const result: CollectDbnumResult = {
    dbnum, sites, siteSummaryAvailable: true,
    refnos: [], generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [], budgetLimited: false,
    ...(fallback ? { fallback } : {}),
  };
  const seen = new Set<string>();
  for (let index = 0; index < sites.length; index++) {
    const site = sites[index]!;
    const rootsBudgetLeft = maxTotalRoots - result.generationRoots.length;
    if (result.refnos.length >= maxRefnos || rootsBudgetLeft <= 0) {
      result.skippedSites.push(site.refno);
      result.budgetLimited = true;
      continue;
    }
    const base = { siteIndex: index + 1, siteCount: sites.length, site };
    onProgress?.({ phase: 'sites', ...base, rootsDone: 0, rootsTotal: 0, root: null });
    const collected = await records.ensureAndCollect(site.refno, {
      maxRoots,
      maxContainerDepth,
      maxRecordsRoots: Number.isFinite(rootsBudgetLeft) ? rootsBudgetLeft : undefined,
      signal: options.signal,
      onRootDone: ({ done, total, root }) => onProgress?.({ phase: 'roots', ...base, rootsDone: done, rootsTotal: total, root }),
    });
    if (Number.isFinite(rootsBudgetLeft) && collected.generationRoots.length >= rootsBudgetLeft && collected.truncatedRoots.length > 0) {
      result.budgetLimited = true;
    }
    for (const refno of refnosOfRecords(collected.items)) {
      if (seen.has(refno)) continue;
      if (result.refnos.length >= maxRefnos) {
        result.budgetLimited = true;
        break;
      }
      seen.add(refno);
      result.refnos.push(refno);
    }
    pushAllUnique(result.generationRoots, collected.generationRoots);
    pushAllUnique(result.pending, collected.pending);
    pushAllUnique(result.empty, collected.empty);
    pushAllUnique(result.truncatedRoots, collected.truncatedRoots);
    Object.assign(result.errors, collected.errors);
  }
  return result;
}
