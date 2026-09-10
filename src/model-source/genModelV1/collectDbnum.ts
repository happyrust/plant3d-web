/**
 * `show_dbnum` 整库入口（plan P3-c / P3-f）。
 *
 * gen-model 没有「按库拉全部几何」的端点：v1 下整库显示 = `tree/roots` 里该库（`dbnum`）的全部 SITE 逐个
 * `ensureAndCollect`（走记录源，进同一份缓存），回构件 refno 集给调用方分批装进 DTX。
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

export type CollectDbnumSite = { refno: string; name: string };

export type CollectDbnumProgress = {
  /** `sites`：开始处理一个 SITE；`roots`：该 SITE 里又收完一个生成根 */
  phase: 'sites' | 'roots';
  /** 1-based */
  siteIndex: number;
  siteCount: number;
  site: CollectDbnumSite;
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
};

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

export async function collectDbnumRefnos(
  tree: TreeSource,
  records: GenModelV1ModelRecordSource,
  dbnum: number,
  options: CollectDbnumOptions = {},
): Promise<CollectDbnumResult> {
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
