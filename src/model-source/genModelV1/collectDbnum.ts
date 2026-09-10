/**
 * `show_dbnum` 整库入口（plan P3-c / P3-f；服务端整库入口见收口计划 §17）。
 *
 * 两条路，优先走第一条：
 *
 * 1. **服务端整库入口**（`collectDbnumViaServer`，spec §4.5.3，读透 / kv-mem 形态）：
 *    `POST dbnums/{dbnum}/model/ensure` 起任务 → 轮询 `GET tasks/{id}` 到终态 →
 *    `GET dbnums/{dbnum}/model/roots` 拿权威根清单 → 只取 `records`。生成的编排全在服务端。
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

import {
  fromV1Refno,
  genModelV1DbnumModelEnsure,
  genModelV1DbnumModelRoots,
  genModelV1TaskGet,
  isGenModelV1ApiError,
} from '@/api/genModelV1Api';

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

export type CollectDbnumOptions = {
  onProgress?: (progress: CollectDbnumProgress) => void;
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
const serverEntrySupportByApi = new WeakMap<DbnumServerEntryApi, ServerEntrySupport>();

/** 诊断 / 单测用：这个 api 的服务端对整库入口的已知态。 */
export function dbnumServerEntrySupport(api: DbnumServerEntryApi = defaultDbnumServerEntryApi): ServerEntrySupport {
  return serverEntrySupportByApi.get(api) ?? 'unknown';
}

/** `GET /tasks/{id}` 的终态（spec §4.4）。 */
const TERMINAL_TASK_STATES = new Set(['succeeded', 'partial', 'failed', 'yielded']);

export type CollectDbnumResult = {
  dbnum: number;
  sites: CollectDbnumSite[];
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });
}

/**
 * 等服务端那一发整库生成跑完（spec §4.4 的任务终态），一边把 `completed/expected_roots` 报成进度。
 *
 * 只查**自己刚发起的那一个 `task_id`**（收口计划 §12 禁的是 `/tasks` 列表轮询与 WS 订阅，不是这个）。
 * 任务查不到（服务端重启过、任务只活在进程内）就不再等：手里已经生成的那部分照样能取记录。
 */
async function waitForDbnumTask(
  api: DbnumServerEntryApi,
  taskId: string,
  expectedRoots: number,
  pollIntervalMs: number,
  waitTimeoutMs: number,
  onProgress: CollectDbnumOptions['onProgress'],
): Promise<{ state: string; completed: number; error: string | null }> {
  const deadline = Date.now() + waitTimeoutMs;
  let state = 'running';
  let completed = 0;
  for (;;) {
    await sleep(pollIntervalMs);
    let entry;
    try {
      entry = await api.task(taskId);
    } catch (error) {
      if (isGenModelV1ApiError(error) && error.code === 'not_found') return { state: 'unknown', completed, error: null };
      throw error;
    }
    state = String(entry.state ?? '');
    completed = Number(entry.units_done ?? 0) || 0;
    const total = Number(entry.total_units ?? expectedRoots) || expectedRoots;
    onProgress?.({ phase: 'generate', siteIndex: 1, siteCount: 1, site: null, rootsDone: completed, rootsTotal: total, root: null });
    if (TERMINAL_TASK_STATES.has(state)) {
      const failure = entry.result && typeof entry.result === 'object' ? (entry.result as Record<string, unknown>).error : null;
      return { state, completed, error: typeof failure === 'string' ? failure : null };
    }
    if (Date.now() >= deadline) return { state, completed, error: null };
  }
}

/**
 * 服务端整库入口（spec §4.5.3，读透 / kv-mem 形态）：`dbnums/{dbnum}/model/ensure` 起任务 → 轮询到终态 →
 * `dbnums/{dbnum}/model/roots` 拿权威根清单 → 只取 `records`。生成的编排全在服务端，前端一根也不催。
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
    onProgress, maxRefnos = DEFAULT_DBNUM_REFNOS_BUDGET, maxTotalRoots = DEFAULT_DBNUM_ROOTS_BUDGET,
    taskPollIntervalMs = 2_000, taskWaitTimeoutMs = 2 * 60 * 60 * 1_000,
  } = options;
  if (dbnumServerEntrySupport(api) === 'no') return null;

  let receipt;
  try {
    receipt = await api.ensureDbnum(dbnum);
  } catch (error) {
    if (!isGenModelV1ApiError(error)) throw error;
    // 旧构建整条路由不存在：认一次，此后同一个 api 直接走老路
    if (error.code === 'not_found') {
      serverEntrySupportByApi.set(api, 'no');
      return null;
    }
    // 这个库以 rocksdb 为准（摄入形态，服务端 409 指路 rebuild）：本次退回逐 SITE，但**不**把服务端整体
    // 记成「没有」——同一进程里别的库仍可能是 memory 形态
    if (error.code === 'conflict') return null;
    throw error;
  }
  serverEntrySupportByApi.set(api, 'yes');

  const expectedRoots = Number(receipt.expected_roots) || 0;
  onProgress?.({ phase: 'generate', siteIndex: 1, siteCount: 1, site: null, rootsDone: 0, rootsTotal: expectedRoots, root: null });
  const task = await waitForDbnumTask(
    api, String(receipt.task_id), expectedRoots, taskPollIntervalMs, taskWaitTimeoutMs, onProgress,
  );
  if (task.state === 'failed' && task.completed === 0) {
    throw new Error(`gen-model 整库生成失败 dbnum=${dbnum}${task.error ? `: ${task.error}` : ''}`);
  }

  const listed = await api.dbnumRoots(dbnum);
  const allRoots: string[] = [];
  for (const row of listed.roots ?? []) {
    const key = fromV1Refno(String(row?.generation_root ?? ''));
    if (key && !allRoots.includes(key)) allRoots.push(key);
  }
  const rootBudget = Number.isFinite(maxTotalRoots) ? Math.max(0, Math.floor(maxTotalRoots)) : allRoots.length;
  const roots = allRoots.slice(0, rootBudget);
  const truncatedRoots = allRoots.slice(roots.length);

  const collected = await records.collectRoots(roots, {
    onRootDone: ({ done, total, root }) =>
      onProgress?.({ phase: 'roots', siteIndex: 1, siteCount: 1, site: null, rootsDone: done, rootsTotal: total, root }),
  });

  const allRefnos = refnosOfRecords(collected.items);
  const refnos = Number.isFinite(maxRefnos) ? allRefnos.slice(0, Math.max(0, Math.floor(maxRefnos))) : allRefnos;
  // SITE 清单只用来给汇总文案报个数：这一路不按 SITE 推进，树读不出来也不该让整库显示失败
  let sites: CollectDbnumSite[] = [];
  try {
    sites = await listSitesOfDbnum(tree, dbnum);
  } catch {
    sites = [];
  }
  return {
    dbnum,
    sites,
    refnos,
    generationRoots: collected.generationRoots,
    pending: collected.pending,
    empty: collected.empty,
    truncatedRoots,
    errors: collected.errors,
    skippedSites: [],
    budgetLimited: truncatedRoots.length > 0 || refnos.length < allRefnos.length,
  };
}

export async function collectDbnumRefnos(
  tree: TreeSource,
  records: GenModelV1ModelRecordSource,
  dbnum: number,
  options: CollectDbnumOptions = {},
  api: DbnumServerEntryApi = defaultDbnumServerEntryApi,
): Promise<CollectDbnumResult> {
  const viaServer = await collectDbnumViaServer(tree, records, dbnum, options, api);
  if (viaServer) return viaServer;
  const {
    onProgress, maxRoots = 4096, maxContainerDepth = 4, maxRefnos = DEFAULT_DBNUM_REFNOS_BUDGET, maxTotalRoots = DEFAULT_DBNUM_ROOTS_BUDGET,
  } = options;
  const sites = await listSitesOfDbnum(tree, dbnum);
  const result: CollectDbnumResult = {
    dbnum, sites, refnos: [], generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [], budgetLimited: false,
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
      onRootDone: ({ done, total, root }) => onProgress?.({ phase: 'roots', ...base, rootsDone: done, rootsTotal: total, root }),
    });
    if (Number.isFinite(rootsBudgetLeft) && collected.generationRoots.length >= rootsBudgetLeft && collected.truncatedRoots.length > 0) {
      result.budgetLimited = true;
    }
    for (const refno of refnosOfRecords(collected.items)) {
      if (seen.has(refno)) continue;
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
