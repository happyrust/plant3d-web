/** RVM 比对页的纯格式化：颜色、阶段名、差异类别、树上的状态。不发请求。 */

import { classifyReport, reasonBrief } from './rvmMismatchReason';

import type { RvmCounts, RvmMismatch } from '@/api/rvmCheckApi';

export type RvmVerdict = 'pass' | 'kind_differ' | 'fail';

/** 原因分类后多出的三种结论：无可比内容、工具故障、非几何问题 */
export type RvmDerivedVerdict = 'empty' | 'tool_error' | 'external';

export type VerdictTone = {
  verdict: RvmVerdict | RvmDerivedVerdict | 'pending';
  label: string;
  banner: string;
  chip: string;
  /** 横幅图标的圆底 */
  iconBg: string;
  /** 队列选中项左侧竖条 */
  accent: string;
};

const TONES: Record<VerdictTone['verdict'], Omit<VerdictTone, 'verdict'>> = {
  pass: {
    label: '通过',
    banner: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    iconBg: 'bg-emerald-100 text-emerald-700',
    accent: 'bg-emerald-600',
  },
  kind_differ: {
    label: '种类不一致',
    banner: 'border-amber-200 bg-amber-50 text-amber-800',
    chip: 'border-amber-200 bg-amber-50 text-amber-700',
    iconBg: 'bg-amber-100 text-amber-700',
    accent: 'bg-amber-500',
  },
  fail: {
    label: '不一致',
    banner: 'border-red-200 bg-red-50 text-red-800',
    chip: 'border-red-200 bg-red-50 text-red-700',
    iconBg: 'bg-red-100 text-red-700',
    accent: 'bg-red-600',
  },
  empty: {
    label: '无可比内容',
    banner: 'border-zinc-200 bg-zinc-50 text-zinc-700',
    chip: 'border-zinc-200 bg-zinc-50 text-zinc-600',
    iconBg: 'bg-zinc-100 text-zinc-500',
    accent: 'bg-zinc-400',
  },
  tool_error: {
    label: '工具故障',
    banner: 'border-stone-300 bg-stone-100 text-stone-800',
    chip: 'border-stone-300 bg-stone-100 text-stone-700',
    iconBg: 'bg-stone-200 text-stone-600',
    accent: 'bg-stone-500',
  },
  external: {
    label: '非几何问题',
    banner: 'border-slate-300 bg-slate-100 text-slate-800',
    chip: 'border-slate-300 bg-slate-100 text-slate-700',
    iconBg: 'bg-slate-200 text-slate-600',
    accent: 'bg-slate-500',
  },
  pending: {
    label: '进行中',
    banner: 'border-sky-200 bg-sky-50 text-sky-800',
    chip: 'border-sky-200 bg-sky-50 text-sky-700',
    iconBg: 'bg-sky-100 text-sky-700',
    accent: 'bg-sky-600',
  },
};

export function verdictTone(verdict: string | null | undefined): VerdictTone {
  const key = verdict && verdict !== 'pending' && verdict in TONES ? (verdict as VerdictTone['verdict']) : 'pending';
  return { verdict: key, ...TONES[key] };
}

const STAGES: Record<string, string> = {
  queued: '排队',
  resolve: '解析节点',
  generate_ours: '生成我们的 RVM',
  e3d_export: 'E3D 导出',
  compare: '比对',
};

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '等待';
  return STAGES[stage] ?? stage;
}

const CATEGORIES: Record<string, string> = {
  off: '位置偏差',
  kind_differ: '图元种类不同',
  only_baseline: '仅 E3D',
  only_generated: '仅生成',
  unkeyable_baseline: 'E3D 无法配对',
  unkeyable_generated: '生成无法配对',
  container_off: '管身偏差',
  container_only_baseline: '管身仅 E3D',
  container_only_generated: '管身仅生成',
};

export function categoryLabel(category: string): string {
  return CATEGORIES[category] ?? category;
}

export function formatDeltaMm(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '';
  if (value === 0) return '0';
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(3);
}

export function formatAabb(value: number[] | null | undefined): string {
  if (!value || value.length !== 6) return '';
  const corner = (index: number) => fmt(value[index] ?? 0);
  return `${corner(0)},${corner(1)},${corner(2)} → ${corner(3)},${corner(4)},${corner(5)}`;
}

function fmt(value: number): string {
  return Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
}

export function formatKinds(kinds: string[] | null | undefined): string {
  if (!kinds || kinds.length === 0) return '';
  return kinds.join(', ');
}

/** 图元种类是多重集，顺序无关：`['CYLI', 'BOX', 'CYLI']` → `BOX, CYLI×2`。 */
export function summarizeKinds(kinds: string[] | null | undefined): string {
  if (!kinds || kinds.length === 0) return '';
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => (count > 1 ? `${kind}×${count}` : kind))
    .join(', ');
}

const AXES = ['X', 'Y', 'Z'];

/** 两侧包围盒差得最多的那根轴；任一侧缺包围盒或完全一致时给 null。 */
function worstAxis(baseline: number[] | null | undefined, generated: number[] | null | undefined): string | null {
  if (!baseline || !generated || baseline.length !== 6 || generated.length !== 6) return null;
  let worst = 0;
  let worstIndex = -1;
  for (let index = 0; index < 6; index += 1) {
    const delta = Math.abs((generated[index] ?? 0) - (baseline[index] ?? 0));
    if (delta > worst) {
      worst = delta;
      worstIndex = index;
    }
  }
  return worstIndex < 0 ? null : (AXES[worstIndex % 3] ?? null);
}

/** 一行不一致的白话说明：差在哪、差多少。 */
export function describeMismatch(row: RvmMismatch): string {
  const delta = formatDeltaMm(row.max_axis_delta_mm);
  const baselineKinds = summarizeKinds(row.baseline_kinds);
  const generatedKinds = summarizeKinds(row.generated_kinds);
  switch (row.category) {
    case 'off': {
      const axis = worstAxis(row.baseline_aabb, row.generated_aabb);
      let text = delta ? `位置或尺寸偏差 ${delta} mm` : '位置或尺寸偏差';
      if (axis) text += `，最大在 ${axis} 向`;
      if (baselineKinds && generatedKinds && baselineKinds !== generatedKinds) {
        text += `；图元也不同（E3D ${baselineKinds}，生成 ${generatedKinds}）`;
      }
      return text;
    }
    case 'kind_differ':
      return `包围盒对得上，图元不同：E3D ${baselineKinds || '无'}，生成 ${generatedKinds || '无'}`;
    case 'only_baseline':
      return 'E3D 有这个构件，我们没有生成';
    case 'only_generated':
      return '我们生成了这个构件，E3D 导出里没有';
    case 'unkeyable_baseline':
      return 'E3D 一侧这件按名称配不上';
    case 'unkeyable_generated':
      return '生成一侧这件按名称配不上';
    case 'container_off':
      return delta ? `管身偏差 ${delta} mm` : '管身偏差';
    case 'container_only_baseline':
      return 'E3D 有这段管身，我们没有生成';
    case 'container_only_generated':
      return '我们多生成了这段管身';
    default:
      return categoryLabel(row.category);
  }
}

/** `rvm_compare` 给「仅生成」行的名称后面拼了配对键（三个以上空格隔开），只留路径。 */
export function mismatchDisplayName(name: string | null | undefined): string {
  const trimmed = String(name ?? '').trim();
  return trimmed.split(/\s{3,}/)[0] ?? trimmed;
}

const COUNT_LABELS: [keyof RvmCounts, string][] = [
  ['both', '配上'],
  ['off', '偏差'],
  ['only_baseline', '仅 E3D'],
  ['only_generated', '仅生成'],
  ['kind_differ', '种类不同'],
  ['container_off', '管身偏差'],
  ['container_only_baseline', '管身仅 E3D'],
  ['container_only_generated', '管身仅生成'],
  ['centreline_only_baseline', '中心线'],
];

/** 横幅右侧的计数摘要：只列非零项，`配上 66 · 偏差 11`。 */
export function countsSummary(counts: Partial<RvmCounts> | null | undefined): string {
  if (!counts) return '';
  return COUNT_LABELS
    .filter(([key]) => (counts[key] ?? 0) > 0)
    .map(([key, label]) => `${label} ${counts[key]}`)
    .join(' · ');
}

/** 横幅右侧的大号计数：只留非零项。 */
export function bannerCounts(counts: Partial<RvmCounts> | null | undefined): { label: string; value: number }[] {
  if (!counts) return [];
  return COUNT_LABELS
    .filter(([key]) => (counts[key] ?? 0) > 0)
    .map(([key, label]) => ({ label, value: counts[key] ?? 0 }));
}

/** 四段耗时加总：`用时 9 分 41 秒`；没有耗时给空串。 */
export function formatDurationMs(timings: Partial<Record<string, number>> | null | undefined): string {
  if (!timings) return '';
  const totalMs = Object.values(timings).reduce<number>((sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0);
  if (totalMs <= 0) return '';
  const seconds = Math.max(1, Math.round(totalMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `用时 ${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `用时 ${minutes} 分 ${rest} 秒`;
  return `用时 ${rest} 秒`;
}

/**
 * 不一致清单只有 E3D 名称，没有 refno。拿名称去搜模型树：
 * 有名构件（`/C-1`、`PIPE /C-1`）直接用；无名构件（`BEND 3 of BRANCH /C-1/B1`）退到最近的有名属主。
 */
export function mismatchLocateTarget(name: string | null | undefined): { name: string; viaOwner: boolean } | null {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;
  // `/*` 是 WORLD 的名字；生成侧给无名构件拼的 `/GENERATED/... of ...` 也不是真实名称。两者都搜不到东西
  const usable = (candidate: string) => /^\/[^\s*]+$/.test(candidate) && !candidate.startsWith('/GENERATED/');
  if (trimmed.startsWith('/')) return usable(trimmed) ? { name: trimmed, viaOwner: false } : null;
  const of = trimmed.lastIndexOf(' of ');
  if (of >= 0) {
    const owner = trimmed.slice(of + 4).trim();
    const slash = owner.indexOf('/');
    const ownerName = slash >= 0 ? owner.slice(slash).trim() : '';
    return usable(ownerName) ? { name: ownerName, viaOwner: true } : null;
  }
  const nounAndName = /^[A-Za-z]{2,6}\s+(\/\S+)$/.exec(trimmed);
  return nounAndName?.[1] && usable(nounAndName[1]) ? { name: nounAndName[1], viaOwner: false } : null;
}

// ---------------------------------------------------------------------------
// 模型树上的核对状态
// ---------------------------------------------------------------------------

export type RvmNodeVerdict = RvmVerdict | RvmDerivedVerdict | 'running' | 'queued';

export type RvmNodeStatus = {
  /** `a_b`，与模型树行 id 同一形状 */
  refno: string;
  verdict: RvmNodeVerdict;
  taskId: string | null;
  at: string | null;
  sesno: number | null;
  message: string;
  name: string | null;
  stage: string | null;
  /** 前两个主要原因的简写，如 `命名没配上 156 · 长度不同 5`；没有时为空串 */
  reasons: string;
};

/** 任务快照里用到的字段。`result` / `detail` 来自不同接口，形状只按需取。 */
export type RvmRunLike = {
  task_id: string;
  state: string;
  kind?: string;
  stage?: string | null;
  current_stage?: string | null;
  detail?: unknown;
  result?: unknown;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
};

export function rvmRefnoKey(refno: string | null | undefined): string {
  return String(refno ?? '').trim().replace(/^=/, '').replace(/[/,]/, '_');
}

export function isTerminalState(state: string | null | undefined): boolean {
  return state === 'succeeded' || state === 'partial' || state === 'failed' || state === 'yielded';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 一次任务快照落到树上是什么状态。认不出节点时给 null。 */
export function statusFromRun(run: RvmRunLike): RvmNodeStatus | null {
  const result = record(run.result);
  const detail = record(run.detail);
  const refno = rvmRefnoKey(text(result.refno) ?? text(detail.refno));
  if (!refno) return null;
  let verdict: RvmNodeVerdict;
  let reasons = '';
  if (!isTerminalState(run.state)) {
    verdict = 'running';
  } else if (run.result && typeof run.result === 'object') {
    // 树上不拉 e3d.log，「E3D 目录错误」只在打开结果时才分得出
    const classified = classifyReport(result as Parameters<typeof classifyReport>[0]);
    verdict = classified.nodeVerdict;
    reasons = reasonBrief(classified.summary);
  } else {
    verdict = 'fail';
  }
  return {
    refno,
    verdict,
    taskId: run.task_id,
    at: run.finished_at ?? run.started_at ?? run.created_at ?? null,
    sesno: int(result.sesno) ?? int(detail.sesno),
    message: text(result.message) ?? '',
    name: text(result.name) ?? text(detail.name),
    stage: run.stage ?? run.current_stage ?? text(result.stage),
    reasons,
  };
}

/** 任务历史 → 每个节点最新那次的结论。同一节点核对过多次时按入队时刻取最新一条。 */
export function latestStatusByRefno(runs: RvmRunLike[]): Record<string, RvmNodeStatus> {
  const sorted = runs
    .filter((run) => !run.kind || run.kind === 'rvm_check')
    .map((run) => ({ run, at: run.created_at ?? run.started_at ?? run.finished_at ?? '' }))
    .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
  const latest: Record<string, RvmNodeStatus> = {};
  for (const { run } of sorted) {
    const status = statusFromRun(run);
    if (status && !latest[status.refno]) latest[status.refno] = status;
  }
  return latest;
}

const NODE_LABELS: Record<RvmNodeVerdict, string> = {
  pass: '通过',
  kind_differ: '种类不一致',
  fail: '不一致',
  empty: '无可比内容',
  tool_error: '工具故障',
  external: '非几何问题',
  running: '核对中',
  queued: '排队中',
};

export function nodeVerdictLabel(verdict: RvmNodeVerdict): string {
  return NODE_LABELS[verdict];
}

export function formatAt(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function rvmStatusTitle(status: RvmNodeStatus): string {
  let title = `RVM 核对：${NODE_LABELS[status.verdict]}`;
  if (status.verdict === 'running' && status.stage) title += `（${stageLabel(status.stage)}）`;
  if (status.sesno != null) title += ` · 会话 ${status.sesno}`;
  if (status.at && status.verdict !== 'queued') title += ` · ${formatAt(status.at)}`;
  if (status.message) title += `\n${status.message}`;
  if (status.reasons) title += `\n主要原因：${status.reasons}`;
  return `${title}\n点击查看结果`;
}
