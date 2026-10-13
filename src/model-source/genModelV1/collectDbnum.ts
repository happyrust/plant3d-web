/**
 * `show_dbnum` 整库显示（ADR 0069）：该库 `tree/roots` 下的 SITE 逐个按祖先查 `model/records`。
 *
 * 不发起 `dbnums/{n}/model/ensure`，不轮询任务，不把「没生成」补成生成。查空的 SITE 就是空。
 * 构件预算（缺省 50 000）照旧；`?show_dbnum_full=1` 由调用方传 `Infinity`。
 * 每个 SITE 收完经 `onRefnosReady` 交一批，调用方照旧对账。
 *
 * 整库生成（`genModelV1DbnumModelGenerate`）留给以后显式的「重新生成模型（整库）」，显示路径不调用。
 */
import { refnosOfRecords } from './modelRecords';

import type { GenModelV1ModelRecordSource } from './modelRecordSource';
import type { TreeSource } from '../ports';

export type CollectDbnumSite = { refno: string; name: string };

export type CollectDbnumProgress = {
  /** `sites`：开始查一个 SITE；`roots`：这个 SITE 的记录收完 */
  phase: 'sites' | 'roots';
  /** 1-based */
  siteIndex: number;
  siteCount: number;
  site: CollectDbnumSite | null;
  rootsDone: number;
  rootsTotal: number;
  root: string | null;
};

/** 整库缺省的生成根预算：显示只查，不按根数截断（调用方要「安全概览」自己传有限的 `maxTotalRoots`）。 */
export const DEFAULT_DBNUM_ROOTS_BUDGET = Number.POSITIVE_INFINITY;
/** 整库缺省的构件预算：一次点击最多装这么多构件 refno；`?show_dbnum_full=1` 传 `Infinity` 才全量。 */
export const DEFAULT_DBNUM_REFNOS_BUDGET = 50_000;

/** 每个 SITE 收完记录后交给调用方的一包。 */
export type CollectDbnumReadyBatch = {
  /** 这一批记录里出现过的生成根（`a_b`） */
  roots: string[];
  /** 其中有几何记录的构件 refno（`a_b`，与之前批次去重、已按 `maxRefnos` 切过） */
  refnos: string[];
  rootsDone: number;
  rootsTotal: number;
};

export type CollectDbnumOptions = {
  onProgress?: (progress: CollectDbnumProgress) => void;
  /**
   * 每个 SITE 查完就交一批构件，调用方可以边收边装。会被 await。
   * 收尾仍以结果的 `refnos` 对账。
   */
  onRefnosReady?: (batch: CollectDbnumReadyBatch) => void | Promise<void>;
  /** 收够这么多构件 refno 就停（缺省 `DEFAULT_DBNUM_REFNOS_BUDGET`）；`Infinity` = 全量 */
  maxRefnos?: number;
  /** 整库最多收下多少个生成根（缺省不限）；有限值 = 「安全概览」 */
  maxTotalRoots?: number;
  signal?: AbortSignal;
};

export type CollectDbnumResult = {
  dbnum: number;
  sites: CollectDbnumSite[];
  /** `false` 表示整库模型结果有效，但用于汇总的 tree/SITE 摘要读取失败；不能解释成“确实没有 SITE”。 */
  siteSummaryAvailable: boolean;
  /** 有几何记录的构件 refno（`a_b`，去重，按 SITE 顺序） */
  refnos: string[];
  generationRoots: string[];
  /** 409 `conflict`（该库正被整库任务占用）的 SITE——稍后再显示，不生成 */
  pending: string[];
  /** 一条记录都没有的 SITE */
  empty: string[];
  truncatedRoots: string[];
  errors: Record<string, string>;
  /** 因 `maxRefnos` / `maxTotalRoots` 没查的 SITE */
  skippedSites: string[];
  /** 撞到预算而停：结果是「安全概览」，不是整库 */
  budgetLimited: boolean;
};

function pushAllUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function finiteBudget(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Number.POSITIVE_INFINITY;
}

/** 该库在当前 MDB 里的 SITE（虚拟根的直接子节点里 `dbnum` 相等的那些）。空名退回 refno。 */
export async function listSitesOfDbnum(tree: TreeSource, dbnum: number): Promise<CollectDbnumSite[]> {
  const root = await tree.worldRoot();
  if (!root.success || !root.node) throw new Error(root.error_message || 'gen-model tree/roots 不可用');
  const children = await tree.children(root.node.refno, 1_000_000);
  if (!children.success) throw new Error(children.error_message || 'gen-model tree/roots 不可用');
  return children.children
    .filter((node) => node.dbnum === dbnum)
    .map((node) => ({ refno: node.refno, name: node.name || node.refno }));
}

/** 服务代次变化时清掉的挂钩。显示路径不再记「服务端有没有整库生成入口」，保留空函数给组装点。 */
export function resetDbnumServerEntrySupport(): void {
  // 整库显示不再走 dbnums/{n}/model/ensure，没有按 api 对象记的支持位。
}

/**
 * 整库显示：该库每个 SITE 按祖先查一次记录，串行，进同一份记录缓存。
 * 不 generate。撞到构件 / 生成根预算就停，没轮到的 SITE 记进 `skippedSites`。
 */
export async function collectDbnumRefnos(
  tree: TreeSource,
  records: GenModelV1ModelRecordSource,
  dbnum: number,
  options: CollectDbnumOptions = {},
): Promise<CollectDbnumResult> {
  const {
    onProgress,
    onRefnosReady,
    maxRefnos = DEFAULT_DBNUM_REFNOS_BUDGET,
    maxTotalRoots = DEFAULT_DBNUM_ROOTS_BUDGET,
    signal,
  } = options;
  const refnoBudget = finiteBudget(maxRefnos);
  const rootBudget = finiteBudget(maxTotalRoots);
  const sites = await listSitesOfDbnum(tree, dbnum);
  const result: CollectDbnumResult = {
    dbnum,
    sites,
    siteSummaryAvailable: true,
    refnos: [],
    generationRoots: [],
    pending: [],
    empty: [],
    truncatedRoots: [],
    errors: {},
    skippedSites: [],
    budgetLimited: false,
  };
  const seen = new Set<string>();

  for (let index = 0; index < sites.length; index++) {
    const site = sites[index]!;
    if (result.refnos.length >= refnoBudget || result.generationRoots.length >= rootBudget) {
      result.skippedSites.push(site.refno);
      result.budgetLimited = true;
      continue;
    }
    const base = { siteIndex: index + 1, siteCount: sites.length, site };
    onProgress?.({ phase: 'sites', ...base, rootsDone: 0, rootsTotal: 0, root: null });
    const collected = await records.collectByAncestor(site.refno, {
      signal,
      onRootDone: ({ done, total, root }) => onProgress?.({
        phase: 'roots', ...base, rootsDone: done, rootsTotal: total, root,
      }),
    });
    const room = rootBudget - result.generationRoots.length;
    const acceptedRoots = Number.isFinite(room)
      ? collected.generationRoots.slice(0, Math.max(0, room))
      : collected.generationRoots;
    if (acceptedRoots.length < collected.generationRoots.length) {
      result.budgetLimited = true;
      pushAllUnique(result.truncatedRoots, collected.generationRoots.slice(acceptedRoots.length));
    }
    const batchRefnos: string[] = [];
    for (const refno of refnosOfRecords(collected.items)) {
      if (seen.has(refno)) continue;
      if (result.refnos.length >= refnoBudget) {
        result.budgetLimited = true;
        break;
      }
      seen.add(refno);
      result.refnos.push(refno);
      batchRefnos.push(refno);
    }
    pushAllUnique(result.generationRoots, acceptedRoots);
    pushAllUnique(result.pending, collected.pending);
    pushAllUnique(result.empty, collected.empty);
    pushAllUnique(result.truncatedRoots, collected.truncatedRoots);
    Object.assign(result.errors, collected.errors);
    if (onRefnosReady) {
      await onRefnosReady({
        roots: acceptedRoots,
        refnos: batchRefnos,
        rootsDone: result.generationRoots.length,
        rootsTotal: result.generationRoots.length,
      });
    }
  }
  return result;
}
