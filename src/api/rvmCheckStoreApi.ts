/**
 * 库里的 RVM 核对结果：gen-model 的 `rvm_check_run`（一次比对一行）与 `rvm_check_mismatch`（一条差异一行）。
 * 页面单根和批量命令（`aios-database rvm-check`，含 `--unit zone`）跑完都写这两张表，这里是四个只读查询。
 *
 * 应答形状由 gen-model `src/rvm_check/store.rs` 的 `answer_on` 定，命令行 `rvm-check-query` 给的是同一份。
 * 表是 SCHEMALESS 的：2026-11-10 之前写进来的行没有 `unit` / `root_*`，单侧差异行没有包围盒和偏差，
 * 所以除主键外的字段一律按「可能缺」声明。
 */

import type { RvmCounts } from '@/api/rvmCheckApi';

import { genModelV1Fetch } from '@/api/genModelV1Api';

/** 各阶段耗时，秒 */
export type RvmStoreSeconds = {
  resolve: number;
  generate: number;
  e3d_export: number;
  compare: number;
};

/** `rvm_check_run` 的一行：一个整根，或 `--unit zone` 时的一个单元 */
export type RvmStoreRun = {
  /** 页面：任务号（`rvm-check-…`）；批量：`<batch_id>/<tag>/<w0_w1>` */
  run_id: string;
  /** `page` / `batch` */
  source: string;
  batch_id?: string | null;
  project?: string | null;
  e3d_project?: string | null;
  e3d_mdb?: string | null;
  /** `a/b` */
  refno: string;
  dbnum?: number | null;
  db_type?: string | null;
  sesno?: number | null;
  noun?: string | null;
  name?: string | null;
  /** `root` / `zone` / `fallback`；页面单根与老记录没有 */
  unit?: string | null;
  /** 所在的上级 SITE / APPLDW；页面单根与老记录没有，这时它自己就是上级根 */
  root_refno?: string | null;
  root_noun?: string | null;
  root_name?: string | null;
  /** `pass` / `kind_differ` / `fail` */
  verdict: string;
  /** 更细的终态：`pass` / `empty` / `kind_differ` / `fail` / `no-baseline` / `gen-failed` / `compare-failed` / `commit-guard` / `timeout` … */
  status: string;
  /** 停在或走完的阶段 */
  stage?: string | null;
  message?: string | null;
  counts?: Partial<RvmCounts> | null;
  /** 差异行数，不含只记账的 `info` 行 */
  mismatch_total?: number | null;
  mismatch_by_kind?: Record<string, number> | null;
  mismatch_by_category?: Record<string, number> | null;
  centreline_only_baseline?: number | null;
  e3d_export_by?: string | null;
  seconds?: Partial<RvmStoreSeconds> | null;
  gen_peak_private_mb?: number | null;
  artifact_dir?: string | null;
  files?: string[] | null;
  /** 生成侧 `report.json` 的账本计数；值是数字，或「noun → 数字」的表 */
  gen_ledger?: Record<string, unknown> | null;
  started_at?: string | null;
  finished_at?: string | null;
  finished_unix_ms: number;
};

/** `rvm_check_mismatch` 的一行 */
export type RvmStoreMismatch = {
  run_id: string;
  source?: string | null;
  batch_id?: string | null;
  /** 这条差异所在的根 / 单元，`a/b` */
  refno: string;
  root_refno?: string | null;
  dbnum?: number | null;
  seq: number;
  /** 比对器的分类，或 `stage_failure` / `centreline_only` */
  category: string;
  /** 原因种类，比 `category` 细一档 */
  reason_kind: string;
  /** 带数值的一句话 */
  reason?: string | null;
  /** `error` / `warning` / `info` */
  severity?: string | null;
  name?: string | null;
  noun?: string | null;
  max_axis_delta_mm?: number | null;
  baseline_kinds?: string[] | null;
  generated_kinds?: string[] | null;
  baseline_aabb?: number[] | null;
  generated_aabb?: number[] | null;
  finished_at?: string | null;
  finished_unix_ms?: number | null;
};

/** 没过的单元，汇总行里最多列 50 个 */
export type RvmStoreNotClean = {
  refno: string;
  noun?: string | null;
  name?: string | null;
  status: string;
};

/** 一批里一个上级根、一种跑法的合计 */
export type RvmStoreRollupRow = {
  batch_id: string;
  dbnum?: number | null;
  root_refno: string;
  root_noun?: string | null;
  root_name?: string | null;
  /** `root`：整根当一个单元比的那一行；`zone`：按 ZONE 拆开的各单元之和 */
  mode: string;
  runs: number;
  /** 单元种类 → 个数 */
  units: Record<string, number>;
  /** 终态 → 个数 */
  status: Record<string, number>;
  clean: boolean;
  not_clean_runs: number;
  not_clean: RvmStoreNotClean[];
  counts?: Partial<RvmCounts> | null;
  mismatch_total: number;
  seconds?: Partial<RvmStoreSeconds> | null;
  /** 各单元生成峰值里最大的那个 */
  gen_peak_private_mb?: number | null;
  finished_at?: string | null;
  finished_unix_ms: number;
};

export type RvmStoreRollup = {
  count: number;
  /** 这次汇总读了多少行运行记录 */
  scanned: number;
  /** 运行记录超过服务端一次汇总的上限，只汇总了最新的那部分 */
  truncated: boolean;
  roots: RvmStoreRollupRow[];
};

export type RvmStoreRuns = { count: number; runs: RvmStoreRun[] };

export type RvmStoreMismatches = { count: number; rows: RvmStoreMismatch[] };

export type RvmStoreReasonCount = {
  reason_kind: string;
  category: string;
  severity: string;
  n: number;
};

export type RvmStoreReasons = { count: number; kinds: RvmStoreReasonCount[] };

/** `rollup` / `history` 的条件；不给的不限 */
export type RvmStoreRunFilter = {
  batch_id?: string;
  /** 上级根：它自己那一行加它下面的全部单元 */
  root_refno?: string;
  refno?: string;
  unit?: string;
  dbnum?: number;
  verdict?: string;
  status?: string;
  source?: string;
  /** 只要 `finished_unix_ms` 早于它的（往回翻页） */
  before?: number;
  /** 缺省 50，上限 5000 */
  limit?: number;
};

/** `mismatches` / `reasons` 的条件；不给的不限 */
export type RvmStoreMismatchFilter = {
  run_id?: string;
  batch_id?: string;
  root_refno?: string;
  refno?: string;
  dbnum?: number;
  source?: string;
  category?: string;
  reason_kind?: string;
  noun?: string;
  severity?: string;
  /** 缺省 500，上限 5000 */
  limit?: number;
  offset?: number;
};

export type RvmStoreRequestOptions = { signal?: AbortSignal };

/** 服务端一次最多给多少行 */
export const RVM_STORE_MAX_LIMIT = 5000;

/** 汇总要扫整批运行记录，比缺省的 30 秒多留一些 */
const ROLLUP_TIMEOUT_MS = 60_000;

/** 批量结果按上级根汇总：每批、每个库、每个上级根、每种跑法一行，最新的批在前。只汇总批量行。 */
export function fetchRvmStoreRollup(
  filter: RvmStoreRunFilter = {},
  options: RvmStoreRequestOptions = {},
): Promise<RvmStoreRollup> {
  return genModelV1Fetch<RvmStoreRollup>('/api/v1/rvm-check/rollup', {
    query: filter,
    signal: options.signal,
    timeoutMs: ROLLUP_TIMEOUT_MS,
  });
}

/** 运行记录：一个根 / 单元一行，`finished_unix_ms` 倒序。 */
export function fetchRvmStoreRuns(
  filter: RvmStoreRunFilter = {},
  options: RvmStoreRequestOptions = {},
): Promise<RvmStoreRuns> {
  return genModelV1Fetch<RvmStoreRuns>('/api/v1/rvm-check/history', { query: filter, signal: options.signal });
}

/** 差异明细：先按运行完成时刻倒序，同一次运行内按 `seq`。 */
export function fetchRvmStoreMismatches(
  filter: RvmStoreMismatchFilter = {},
  options: RvmStoreRequestOptions = {},
): Promise<RvmStoreMismatches> {
  return genModelV1Fetch<RvmStoreMismatches>('/api/v1/rvm-check/mismatches', { query: filter, signal: options.signal });
}

/** 差异按「原因种类 × 分类 × 严重级别」计数，多的在前。`limit` / `offset` 不起作用。 */
export function fetchRvmStoreReasons(
  filter: RvmStoreMismatchFilter = {},
  options: RvmStoreRequestOptions = {},
): Promise<RvmStoreReasons> {
  return genModelV1Fetch<RvmStoreReasons>('/api/v1/rvm-check/reasons', { query: filter, signal: options.signal });
}
