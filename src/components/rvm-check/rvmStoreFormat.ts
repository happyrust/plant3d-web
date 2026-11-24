/**
 * 库内 RVM 核对结果（`rvm_check_run` / `rvm_check_mismatch`）的纯格式化：终态、单元种类、原因种类的中文名与说明、
 * 「某一步没跑完」归到哪一类、汇总行并成批次、原因计数的筛选、耗时与内存。不发请求。
 *
 * 终态与原因种类的取值以 gen-model 为准：`src/rvm_check/batch.rs` 的 `status`、`src/rvm_check/report.rs` 的
 * `reason`、`src/rvm_check/store.rs` 的 `classify_failure`。这里没列到的取值原样显示，不会丢。
 */

import { categoryLabel, mismatchLocateTarget, type RvmNodeVerdict } from './rvmCheckFormat';

import type { RvmCounts } from '@/api/rvmCheckApi';
import type { RvmStoreNotClean, RvmStoreReasonCount, RvmStoreRollupRow, RvmStoreRun, RvmStoreSeconds } from '@/api/rvmCheckStoreApi';

import { isGenModelV1ApiError } from '@/api/genModelV1Api';

// ---------------------------------------------------------------------------
// 终态
// ---------------------------------------------------------------------------

export type RvmStoreStatusInfo = {
  /** 库里的终态原值 */
  status: string;
  label: string;
  /** 图标与配色沿用核对页已有的那一套结论 */
  tone: RvmNodeVerdict;
  /** 只有通过、无可比内容（以及单步模式的已导出 / 已生成）算干净 */
  clean: boolean;
  hint: string;
};

const STATUSES: Record<string, Omit<RvmStoreStatusInfo, 'status'>> = {
  pass: { label: '通过', tone: 'pass', clean: true, hint: '两侧逐件对上，没有偏差、缺件、多件和种类不同' },
  empty: { label: '无可比内容', tone: 'empty', clean: true, hint: '两侧都没有可比的几何，不算不一致' },
  kind_differ: { label: '种类不一致', tone: 'kind_differ', clean: false, hint: '包围盒对得上，只是图元种类不同' },
  fail: { label: '不一致', tone: 'fail', clean: false, hint: '比对跑完了，有偏差、缺件或多件' },
  'no-baseline': { label: '缺基准', tone: 'tool_error', clean: false, hint: '没拿到 E3D 导出的基准 RVM，这个单元没法比' },
  'gen-failed': { label: '生成失败', tone: 'tool_error', clean: false, hint: '我们这一侧的生成没跑完' },
  timeout: { label: '生成超时', tone: 'tool_error', clean: false, hint: '生成超过时限，被终止了' },
  'commit-guard': { label: '内存护栏', tone: 'tool_error', clean: false, hint: '可提交内存余量越线，生成子进程被终止' },
  'compare-failed': { label: '比对失败', tone: 'tool_error', clean: false, hint: '两份 RVM 都在，比对这一步没跑完' },
  'resolve-failed': { label: '节点解析失败', tone: 'tool_error', clean: false, hint: '还没开始生成：节点解析这一步没过' },
  exported: { label: '已导出', tone: 'empty', clean: true, hint: '这一批只跑了导出基准这一步' },
  generated: { label: '已生成', tone: 'empty', clean: true, hint: '这一批只跑了生成这一步' },
};

/** 展示顺序：没过的在前，先是比对出的差异，再是没跑完的 */
const STATUS_ORDER = [
  'fail',
  'kind_differ',
  'no-baseline',
  'gen-failed',
  'timeout',
  'commit-guard',
  'compare-failed',
  'resolve-failed',
  'pass',
  'empty',
  'exported',
  'generated',
];

export function storeStatusInfo(status: string | null | undefined): RvmStoreStatusInfo {
  const key = String(status ?? '').trim();
  const known = STATUSES[key];
  if (known) return { status: key, ...known };
  return { status: key, label: key || '未知', tone: 'fail', clean: false, hint: '' };
}

export type RvmStoreStatusCount = RvmStoreStatusInfo & { count: number };

/** 「终态 → 个数」排成展示顺序，零的不要。 */
export function statusCounts(map: Record<string, number> | null | undefined): RvmStoreStatusCount[] {
  const rank = (status: string) => {
    const index = STATUS_ORDER.indexOf(status);
    return index < 0 ? STATUS_ORDER.length : index;
  };
  return Object.entries(map ?? {})
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => rank(left) - rank(right) || left.localeCompare(right))
    .map(([status, count]) => ({ ...storeStatusInfo(status), count }));
}

function sumCounts(counts: Partial<RvmCounts> | null | undefined): number {
  return Object.values(counts ?? {}).reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
}

/**
 * 一行运行记录该显示成哪个终态。批量行的 `status` 已经是细分终态，原样用；页面单根的 `status` 只有三色，
 * 没跑完的从它那条 `stage_failure` 的原因种类里认，两侧都空的认成无可比内容（与核对页同一口径）。
 */
export function runStatusKey(run: Pick<RvmStoreRun, 'status' | 'verdict' | 'source' | 'counts' | 'mismatch_by_category' | 'mismatch_by_kind'>): string {
  const status = run.status || run.verdict || '';
  if (status === 'fail' && run.source !== 'batch' && (run.mismatch_by_category?.stage_failure ?? 0) > 0) {
    const kind = Object.keys(run.mismatch_by_kind ?? {})[0] ?? '';
    if (kind && kind !== 'compare_nothing_paired') return FAILURE_CLASSES[failureClassOfReason(kind)].status;
  }
  if (status === 'pass' && run.counts && sumCounts(run.counts) === 0) return 'empty';
  return status;
}

// ---------------------------------------------------------------------------
// 名称、单元种类与跑法
// ---------------------------------------------------------------------------

/** 无名的根 / 单元在界面上的写法 */
export const UNNAMED = '（无名）';

/**
 * 根 / 单元的名称。无名的元素库里记的 `name` 就是它的 noun（如 `ZONE`），那不是名字，这里给 null，
 * 由调用方显示成「（无名）」或退到 refno。
 */
export function elementName(name: string | null | undefined, noun: string | null | undefined): string | null {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || trimmed.toUpperCase() === String(noun ?? '').trim().toUpperCase()) return null;
  return trimmed;
}

/** 单元种类；页面单根与 2026-11-10 之前的批量行没有这一格，那时一行就是一个整根。 */
export function unitKindLabel(unit: string | null | undefined): string {
  switch (unit) {
    case 'zone':
      return 'ZONE';
    case 'fallback':
      return '兜底';
    case 'root':
    case null:
    case undefined:
    case '':
      return '整根';
    default:
      return unit;
  }
}

export function unitKindHint(unit: string | null | undefined): string {
  switch (unit) {
    case 'zone':
      return '上级根下的一个 ZONE，单独导基准、单独生成、单独比';
    case 'fallback':
      return '上级根下不在任何 ZONE 里的子节点，单独成一个兜底单元';
    default:
      return '整个 SITE / APPLDW 当一个单元比';
  }
}

/** 汇总行的跑法 */
export function modeLabel(mode: string | null | undefined): string {
  return mode === 'zone' ? '按 ZONE' : '整根';
}

// ---------------------------------------------------------------------------
// 分类、严重级别
// ---------------------------------------------------------------------------

const STORE_CATEGORIES: Record<string, string> = {
  stage_failure: '没跑完',
  centreline_only: '只画中心线',
};

export function storeCategoryLabel(category: string | null | undefined): string {
  const key = String(category ?? '');
  return STORE_CATEGORIES[key] ?? categoryLabel(key);
}

export type RvmSeverityInfo = { severity: string; label: string; chip: string; rank: number };

const SEVERITIES: Record<string, Omit<RvmSeverityInfo, 'severity'>> = {
  error: { label: '错误', chip: 'border-red-200 bg-red-50 text-red-700', rank: 0 },
  warning: { label: '警告', chip: 'border-amber-200 bg-amber-50 text-amber-700', rank: 1 },
  info: { label: '提示', chip: 'border-slate-200 bg-slate-50 text-slate-600', rank: 2 },
};

export function severityInfo(severity: string | null | undefined): RvmSeverityInfo {
  const key = String(severity ?? '').trim() || 'error';
  const known = SEVERITIES[key];
  if (known) return { severity: key, ...known };
  return { severity: key, label: key, chip: 'border-border bg-muted text-muted-foreground', rank: 3 };
}

// ---------------------------------------------------------------------------
// 某一步没跑完：归到哪一类
// ---------------------------------------------------------------------------

export type RvmFailureClass = 'baseline' | 'generate' | 'timeout' | 'memory' | 'compare' | 'resolve' | 'other';

export type RvmFailureClassInfo = {
  label: string;
  /** 对应的终态；`other` 没有对应终态，留在不一致上 */
  status: string;
  hint: string;
};

export const FAILURE_CLASSES: Record<RvmFailureClass, RvmFailureClassInfo> = {
  baseline: { label: '缺基准', status: 'no-baseline', hint: 'E3D 一侧没给出基准 RVM：基准目录里没有，或 E3D 导出没落出文件' },
  generate: { label: '生成失败', status: 'gen-failed', hint: '我们这一侧的生成没跑完' },
  timeout: { label: '生成超时', status: 'timeout', hint: '生成超过时限，被终止了' },
  memory: { label: '内存护栏', status: 'commit-guard', hint: '可提交内存余量越线，生成子进程被终止' },
  compare: { label: '比对失败', status: 'compare-failed', hint: '两份 RVM 都在，比对这一步没跑完' },
  resolve: { label: '节点解析失败', status: 'resolve-failed', hint: '还没开始生成：节点解析这一步没过' },
  other: { label: '没跑完', status: 'fail', hint: '某一步没跑完，阶段认不出来，看原因那句话' },
};

const STATUS_FAILURE_CLASS: Record<string, RvmFailureClass> = {
  'no-baseline': 'baseline',
  'gen-failed': 'generate',
  timeout: 'timeout',
  'commit-guard': 'memory',
  'compare-failed': 'compare',
  'resolve-failed': 'resolve',
};

/** 终态本身就说明了没跑完的那一类；`pass` / `fail` 一类比对出的结论给 null。 */
export function failureClassOfStatus(status: string | null | undefined): RvmFailureClass | null {
  return STATUS_FAILURE_CLASS[String(status ?? '')] ?? null;
}

/** 从 `stage_failure` 行的原因种类认。 */
export function failureClassOfReason(reasonKind: string | null | undefined): RvmFailureClass {
  const kind = String(reasonKind ?? '');
  if (kind === 'generate_timeout') return 'timeout';
  if (kind === 'generate_commit_guard') return 'memory';
  if (kind.startsWith('generate_')) return 'generate';
  if (kind === 'baseline_missing' || kind.startsWith('e3d_')) return 'baseline';
  if (kind.startsWith('compare_')) return 'compare';
  if (kind.startsWith('resolve_') || kind === 'tree_not_ready') return 'resolve';
  return 'other';
}

/**
 * 一条 `stage_failure` 差异行是哪一类。知道它所在运行的终态时以终态为准（批量的 `compare-failed` 落库后
 * 原因种类是笼统的 `run_failed`，只有终态说得清）；不知道时退到原因种类。
 */
export function stageFailureClass(reasonKind: string | null | undefined, runStatus?: string | null): RvmFailureClass {
  return failureClassOfStatus(runStatus) ?? failureClassOfReason(reasonKind);
}

// ---------------------------------------------------------------------------
// 原因种类
// ---------------------------------------------------------------------------

export type RvmReasonKindInfo = {
  /** 库里的取值，如 `aabb_shifted` */
  kind: string;
  label: string;
  /** 一句话说明这类差异是什么 */
  hint: string;
};

const REASON_KINDS: Record<string, Omit<RvmReasonKindInfo, 'kind'>> = {
  aabb_shifted: { label: '整体偏移', hint: '尺寸一致，位置整体偏了；原因里给出三轴偏移量' },
  aabb_axes_swapped: { label: '轴长互换', hint: '两根轴的长度互换，局部标架转了 90°' },
  aabb_one_axis_size: { label: '单轴长度不同', hint: '只有一根轴的长度不同：端面偏移、长度算错一类' },
  generated_larger: { label: '生成体偏大', hint: '生成体整体包住基准，多出一块' },
  generated_smaller: { label: '生成体偏小', hint: '基准整体包住生成体，缺一块' },
  aabb_off: { label: '包围盒超差', hint: '不属于偏移、互换、单轴、偏大、偏小的一般超差' },
  container_tube_mismatch: { label: '容器管身账不平', hint: '包围盒在容差内，是容器组内隐式管的逐根账把它判成偏差的' },
  facet_vs_analytic: { label: '面片对解析图元', hint: '一侧写面片，另一侧写解析图元' },
  primitive_count_differs: { label: '图元条数不同', hint: '图元种类相同，条数不同' },
  primitive_kind_differs: { label: '图元种类不同', hint: '两侧的图元种类集合不同' },
  missing_implied_tube: { label: '缺隐式管身', hint: 'E3D 有这段隐式管身（TUBE n of …），我们没有生成' },
  missing_named_element: { label: '缺命名元素', hint: 'E3D 有这个命名元素（/NAME），我们没有生成' },
  missing_unnamed_element: { label: '缺无名元素', hint: 'E3D 有这个无名元素（NOUN n of 属主），我们没有生成' },
  extra_implied_tube: { label: '多出隐式管身', hint: '我们多生成了一段隐式管身，E3D 导出里没有' },
  extra_in_generated: { label: '生成侧多出', hint: '我们生成了这一件，E3D 导出里没有' },
  unkeyable_baseline: { label: 'E3D 件发不出主键', hint: 'E3D 一侧这件发不出配对主键，按名字配不上' },
  unkeyable_generated: { label: '生成件发不出主键', hint: '生成一侧这件发不出配对主键（属主无名）' },
  container_tube_off: { label: '容器内管身超差', hint: '容器组内有一根管身超差' },
  container_tube_missing_in_generated: { label: '容器内少一根', hint: '容器组内 E3D 多画了一条记录，我们没有对应的那一根' },
  container_tube_extra_in_generated: { label: '容器内多一根', hint: '容器组内我们多画了一根' },
  centreline_only: { label: '只画中心线', hint: 'E3D 只画了中心线、没画实体，不进判据，只记账' },
  generate_timeout: { label: '生成超时', hint: '生成超过时限，被终止了' },
  generate_commit_guard: { label: '内存护栏', hint: '可提交内存余量越线，生成子进程被终止' },
  generate_panic: { label: '生成崩溃', hint: '生成过程 panic' },
  generate_unbalanced: { label: '生成账没平', hint: '生成跑完了，但生成侧的账没有对平' },
  generate_no_rvm: { label: '没写出 RVM', hint: '生成结束了，但没有写出 RVM 文件' },
  generate_schema_missing: { label: '缺属性库', hint: '生成缺 attlib / schema' },
  generate_failed: { label: '生成失败', hint: '生成没跑完，看原因里的退出码和报错' },
  baseline_missing: { label: '缺基准', hint: '基准目录里没有这个单元的 RVM' },
  e3d_export_no_file: { label: 'E3D 没落出文件', hint: 'E3D 导出跑了，但没有落出 RVM 文件' },
  e3d_export_timeout: { label: 'E3D 导出超时', hint: 'E3D 导出超过时限' },
  e3d_launcher_missing: { label: '缺 E3D 启动脚本', hint: '找不到 E3D 的启动脚本' },
  e3d_not_started: { label: 'E3D 没启动', hint: 'E3D 会话没有启动起来' },
  e3d_export_failed: { label: '没拿到 E3D 基准', hint: 'E3D 一侧的基准没拿到，看原因那句话' },
  compare_panic: { label: '比对崩溃', hint: '比对过程 panic' },
  compare_unknown_bbox_frame: { label: '包围盒帧认不出', hint: '有记录的包围盒帧认不出来，比对停了' },
  compare_duplicate_key: { label: '主键重复', hint: '配对主键重复，比对停了' },
  compare_duplicate_name: { label: 'E3D 名称重复', hint: 'E3D 一侧名称重复，比对停了' },
  compare_nothing_paired: { label: '一件都没配上', hint: '比对跑完了，却一件都没配上：两侧的主键口径对不上' },
  compare_failed: { label: '比对失败', hint: '比对这一步没跑完' },
  resolve_refno_invalid: { label: '节点不在当前 MDB', hint: '这个 refno 在当前 MDB 里解析不出来' },
  tree_not_ready: { label: '模型树没准备好', hint: '服务端的模型树还没准备好' },
  resolve_failed: { label: '节点解析失败', hint: '节点解析这一步没过' },
  run_failed: { label: '没跑完', hint: '某一步没跑完，阶段认不出来，看原因那句话' },
};

export function reasonKindInfo(kind: string | null | undefined): RvmReasonKindInfo {
  const key = String(kind ?? '').trim();
  const known = REASON_KINDS[key];
  if (known) return { kind: key, ...known };
  return { kind: key, label: key || '未归类', hint: '' };
}

// ---------------------------------------------------------------------------
// 原因计数：按分类 / 严重级别 / 原因种类筛
// ---------------------------------------------------------------------------

export type RvmStoreFacetFilter = { category?: string; severity?: string; reason_kind?: string };

function matches(row: RvmStoreReasonCount, filter: RvmStoreFacetFilter): boolean {
  return (!filter.category || row.category === filter.category)
    && (!filter.severity || row.severity === filter.severity)
    && (!filter.reason_kind || row.reason_kind === filter.reason_kind);
}

/** 当前筛选条件下一共多少行差异。 */
export function facetTotal(kinds: RvmStoreReasonCount[], filter: RvmStoreFacetFilter = {}): number {
  return kinds.reduce((sum, row) => (matches(row, filter) ? sum + row.n : sum), 0);
}

export type RvmStoreFacetOption = { value: string; n: number };

/** 某一个筛选格的可选值与行数：其余两格的条件照常生效，它自己这一格不算。 */
export function facetOptions(
  kinds: RvmStoreReasonCount[],
  key: keyof RvmStoreFacetFilter,
  filter: RvmStoreFacetFilter = {},
): RvmStoreFacetOption[] {
  const others = { ...filter, [key]: undefined };
  const tally = new Map<string, number>();
  for (const row of kinds) {
    if (!matches(row, others)) continue;
    tally.set(row[key], (tally.get(row[key]) ?? 0) + row.n);
  }
  return [...tally.entries()]
    .map(([value, n]) => ({ value, n }))
    .sort((left, right) => right.n - left.n || left.value.localeCompare(right.value));
}

export type RvmStoreReasonTotal = {
  reason_kind: string;
  n: number;
  /** 这个原因种类下最重的级别 */
  severity: string;
  categories: string[];
};

/** 按原因种类合并（同一种类可能分在几个分类、级别下），多的在前。`reason_kind` 这一格的条件不算。 */
export function reasonTotals(kinds: RvmStoreReasonCount[], filter: RvmStoreFacetFilter = {}): RvmStoreReasonTotal[] {
  const others = { ...filter, reason_kind: undefined };
  const byKind = new Map<string, RvmStoreReasonTotal>();
  for (const row of kinds) {
    if (!matches(row, others)) continue;
    const entry = byKind.get(row.reason_kind) ?? { reason_kind: row.reason_kind, n: 0, severity: row.severity, categories: [] };
    entry.n += row.n;
    if (severityInfo(row.severity).rank < severityInfo(entry.severity).rank) entry.severity = row.severity;
    if (!entry.categories.includes(row.category)) entry.categories.push(row.category);
    byKind.set(row.reason_kind, entry);
  }
  return [...byKind.values()].sort((left, right) => right.n - left.n || left.reason_kind.localeCompare(right.reason_kind));
}

// ---------------------------------------------------------------------------
// 汇总行：并成批次、并成一个上级根
// ---------------------------------------------------------------------------

export type RvmStoreRollupTotals = {
  /** 汇总行数：一个上级根的每种跑法各一行 */
  rows: number;
  /** 不重复的上级根数 */
  roots: number;
  runs: number;
  modes: string[];
  dbnums: number[];
  units: Record<string, number>;
  status: Record<string, number>;
  notCleanRuns: number;
  /** 没过的单元；服务端每个汇总行最多给 50 个 */
  notClean: RvmStoreNotClean[];
  mismatchTotal: number;
  /** 四个阶段的耗时各自相加 */
  seconds: RvmStoreSeconds;
  /** 各单元生成峰值里最大的那个 */
  peakMb: number | null;
  finishedAt: string | null;
  finishedUnixMs: number;
};

function addInto(target: Record<string, number>, from: Record<string, number> | null | undefined): void {
  for (const [key, value] of Object.entries(from ?? {})) target[key] = (target[key] ?? 0) + value;
}

/** 若干汇总行的合计。计数（配上 / 偏差 …）不在这里相加：同一个根的两种跑法相加会重复计件。 */
export function rollupTotals(rows: RvmStoreRollupRow[]): RvmStoreRollupTotals {
  const totals: RvmStoreRollupTotals = {
    rows: rows.length,
    roots: 0,
    runs: 0,
    modes: [],
    dbnums: [],
    units: {},
    status: {},
    notCleanRuns: 0,
    notClean: [],
    mismatchTotal: 0,
    seconds: { resolve: 0, generate: 0, e3d_export: 0, compare: 0 },
    peakMb: null,
    finishedAt: null,
    finishedUnixMs: 0,
  };
  const roots = new Set<string>();
  for (const row of rows) {
    roots.add(row.root_refno);
    totals.runs += row.runs;
    if (!totals.modes.includes(row.mode)) totals.modes.push(row.mode);
    if (row.dbnum != null && !totals.dbnums.includes(row.dbnum)) totals.dbnums.push(row.dbnum);
    addInto(totals.units, row.units);
    addInto(totals.status, row.status);
    totals.notCleanRuns += row.not_clean_runs;
    totals.notClean.push(...(row.not_clean ?? []));
    totals.mismatchTotal += row.mismatch_total;
    totals.seconds.resolve += row.seconds?.resolve ?? 0;
    totals.seconds.generate += row.seconds?.generate ?? 0;
    totals.seconds.e3d_export += row.seconds?.e3d_export ?? 0;
    totals.seconds.compare += row.seconds?.compare ?? 0;
    if (row.gen_peak_private_mb != null) totals.peakMb = Math.max(totals.peakMb ?? 0, row.gen_peak_private_mb);
    if (row.finished_unix_ms >= totals.finishedUnixMs) {
      totals.finishedUnixMs = row.finished_unix_ms;
      totals.finishedAt = row.finished_at ?? null;
    }
  }
  totals.roots = roots.size;
  totals.dbnums.sort((left, right) => left - right);
  return totals;
}

export type RvmStoreBatch = RvmStoreRollupTotals & { batchId: string };

/** 汇总行按批次并起来，保持服务端给的顺序（最新的批在前）。 */
export function groupBatches(rows: RvmStoreRollupRow[]): RvmStoreBatch[] {
  const groups = new Map<string, RvmStoreRollupRow[]>();
  for (const row of rows) {
    const group = groups.get(row.batch_id);
    if (group) group.push(row);
    else groups.set(row.batch_id, [row]);
  }
  return [...groups.entries()].map(([batchId, group]) => ({ batchId, ...rollupTotals(group) }));
}

// ---------------------------------------------------------------------------
// 数值
// ---------------------------------------------------------------------------

export function sumSeconds(seconds: Partial<RvmStoreSeconds> | null | undefined): number {
  if (!seconds) return 0;
  return (seconds.resolve ?? 0) + (seconds.generate ?? 0) + (seconds.e3d_export ?? 0) + (seconds.compare ?? 0);
}

/** `2.5 秒` / `1 分 23 秒` / `2 小时 5 分`；没有或是 0 给 `—`。 */
export function formatSeconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  if (value < 60) return `${Number(value.toFixed(1))} 秒`;
  const total = Math.round(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分 ${total % 60} 秒`;
}

/** 生成峰值内存：`270 MB` / `9.1 GB`；没有给 `—`。 */
export function formatPeakMb(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.round(value)} MB`;
}

/** 计数格的取值；库里没有这一格时给 null。 */
export function countOf(counts: Partial<RvmCounts> | null | undefined, key: keyof RvmCounts): number | null {
  const value = counts?.[key];
  return typeof value === 'number' ? value : null;
}

export type RvmStoreCountColumn = { key: keyof RvmCounts; label: string; bad: boolean };

/** 汇总表和单元表里并排列出的五个计数；除「配上」外，非零的都是问题 */
export const STORE_COUNT_COLUMNS: RvmStoreCountColumn[] = [
  { key: 'both', label: '配上', bad: false },
  { key: 'off', label: '偏差', bad: true },
  { key: 'only_baseline', label: '仅 E3D', bad: true },
  { key: 'only_generated', label: '仅生成', bad: true },
  { key: 'kind_differ', label: '种类不同', bad: true },
];

/** 计数格的样式：0 淡掉，问题计数非零时标红加粗。 */
export function countCellClass(counts: Partial<RvmCounts> | null | undefined, column: RvmStoreCountColumn): string {
  if (!countOf(counts, column.key)) return 'text-muted-foreground';
  return column.bad ? 'font-semibold text-red-700' : '';
}

export function formatCount(value: number | null | undefined): string {
  return value == null ? '—' : value.toLocaleString('zh-CN');
}

// ---------------------------------------------------------------------------
// 差异行的构件名 → 能拿去模型树里找的名称
// ---------------------------------------------------------------------------

/**
 * 库里的差异行只有构件名，没有 refno。批量比对的名称写法比页面报告多几种：
 * `BOX 1 /EQUI-A`（配上的件：noun、序号、有名属主）、`/GENERATED/BEND 1 of BRAN /B1 BEND BEND 1 /B1`
 * （生成侧多出的无名件，末尾是有名属主）、`/GENERATED/NAME   /NAME`（生成侧多出的命名件，末尾是它自己）。
 * 页面报告认得的写法先交给 `mismatchLocateTarget`，认不出再取末尾那个名称。
 */
export function storeLocateTarget(name: string | null | undefined): { name: string; viaOwner: boolean } | null {
  const direct = mismatchLocateTarget(name);
  if (direct) return direct;
  const tokens = String(name ?? '').trim().split(/\s+/);
  const last = tokens[tokens.length - 1] ?? '';
  if (!/^\/[^\s*]+$/.test(last) || last.startsWith('/GENERATED/')) return null;
  const isSelf = tokens.length === 2 && tokens[0] === `/GENERATED${last}`;
  return { name: last, viaOwner: !isSelf };
}

// ---------------------------------------------------------------------------
// 生成侧账本
// ---------------------------------------------------------------------------

const LEDGER_LABELS: Record<string, string> = {
  visited: '访问',
  generated: '生成',
  skipped: '跳过',
  failed: '失败',
  evidence_pending: '待证据',
  centreline_only: '只画中心线',
  unknown_nouns: '不认识的 noun',
};

export type RvmLedgerEntry = { key: string; label: string; value: number; detail: string };

/** 生成侧 `report.json` 的账本计数里非零的格；值是「noun → 个数」的表时合计并把明细带上。 */
export function ledgerEntries(ledger: Record<string, unknown> | null | undefined): RvmLedgerEntry[] {
  const entries: RvmLedgerEntry[] = [];
  for (const [key, raw] of Object.entries(ledger ?? {})) {
    let value = 0;
    let detail = '';
    if (typeof raw === 'number') {
      value = raw;
    } else if (raw && typeof raw === 'object') {
      const parts = Object.entries(raw as Record<string, unknown>).filter((part): part is [string, number] => typeof part[1] === 'number' && part[1] > 0);
      value = parts.reduce((sum, [, count]) => sum + count, 0);
      detail = parts.map(([noun, count]) => `${noun} ${count}`).join('、');
    }
    if (value > 0) entries.push({ key, label: LEDGER_LABELS[key] ?? key, value, detail });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 读不到时怎么说
// ---------------------------------------------------------------------------

export type RvmStoreErrorText = { message: string; hint: string };

/** 把请求错误说成「出了什么事、先查哪里」。 */
export function describeStoreError(cause: unknown): RvmStoreErrorText {
  const message = cause instanceof Error ? cause.message : String(cause ?? '未知错误');
  if (!isGenModelV1ApiError(cause)) return { message, hint: '' };
  if (cause.code === 'network') {
    return { message, hint: '后端没有回应：确认 gen-model 服务（aios-database，缺省 8022 端口）在运行。' };
  }
  if (cause.status === 404 && !cause.hasEnvelope) {
    return { message, hint: '后端没有这个接口：它是旧构建，要换成带 /api/v1/rvm-check/rollup 的版本再起服务。' };
  }
  if (cause.status >= 500) {
    return { message, hint: '后端查库没成功：确认 SurrealDB 在运行、后端连得上它。' };
  }
  return { message, hint: '' };
}
