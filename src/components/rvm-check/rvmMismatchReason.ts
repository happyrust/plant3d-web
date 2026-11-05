/**
 * RVM 核对的「不一致原因」分类：每行差异归到一个原因，再汇总成节点结论。
 * 只用报告里已有的字段和 e3d.log 文本，纯函数，不发请求。原因文案和顺序集中在这里。
 */

import type { RvmCheckReport, RvmMismatch } from '@/api/rvmCheckApi';

export type RvmReason =
  | 'naming'
  | 'missing_template'
  | 'e3d_catalogue'
  | 'length'
  | 'shift'
  | 'unpaired'
  | 'only_e3d'
  | 'only_ours'
  | 'kind'
  | 'other';

export type RvmReasonInfo = {
  label: string;
  /** 标签样式 */
  chip: string;
  /** true：要我们（gen-model）这边去查；false：命名、E3D 自身或配对提示，不是几何问题 */
  ours: boolean;
};

/** 顺序就是「按原因」排序和汇总并列时的顺序：我们的问题在前 */
export const REASON_ORDER: RvmReason[] = [
  'length',
  'shift',
  'missing_template',
  'only_e3d',
  'only_ours',
  'kind',
  'other',
  'naming',
  'e3d_catalogue',
  'unpaired',
];

export const REASONS: Record<RvmReason, RvmReasonInfo> = {
  naming: { label: '命名没配上', chip: 'border-slate-300 bg-slate-50 text-slate-600', ours: false },
  missing_template: { label: '缺模板件', chip: 'border-orange-200 bg-orange-50 text-orange-700', ours: true },
  e3d_catalogue: { label: 'E3D 目录错误', chip: 'border-violet-200 bg-violet-50 text-violet-700', ours: false },
  length: { label: '长度不同', chip: 'border-red-200 bg-red-50 text-red-700', ours: true },
  shift: { label: '整体平移', chip: 'border-rose-200 bg-rose-50 text-rose-700', ours: true },
  unpaired: { label: '无法配对', chip: 'border-slate-200 bg-slate-50 text-slate-500', ours: false },
  only_e3d: { label: '仅 E3D', chip: 'border-red-200 bg-red-50 text-red-700', ours: true },
  only_ours: { label: '仅生成', chip: 'border-amber-200 bg-amber-50 text-amber-700', ours: true },
  kind: { label: '图元不同', chip: 'border-amber-200 bg-amber-50 text-amber-700', ours: true },
  other: { label: '其他', chip: 'border-border bg-muted text-muted-foreground', ours: true },
};

export function reasonInfo(reason: RvmReason): RvmReasonInfo {
  return REASONS[reason];
}

export type ReasonDetail = {
  reason: RvmReason;
  /** 这一行的白话说明；null 时沿用类别的通用说明 */
  text: string | null;
};

export type E3dLogInfo = {
  /** `Catalogue error for component` 和 `Invalid Item id` 里出现的构件名（含有名属主），形如 `/A-1` */
  errorNames: Set<string>;
  catalogueErrors: number;
  invalidItems: number;
};

export function parseE3dLog(text: string): E3dLogInfo {
  const errorNames = new Set<string>();
  let catalogueErrors = 0;
  let invalidItems = 0;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const catalogue = /Catalogue error for component\s+\S+\s+(\/[^\s,]+)/.exec(line);
    if (catalogue?.[1]) {
      errorNames.add(catalogue[1]);
      catalogueErrors += 1;
      continue;
    }
    const invalid = /Invalid Item id\s*\(\s*(.*?)\s*\)\s*$/.exec(line);
    if (invalid?.[1]) {
      invalidItems += 1;
      for (const name of namesInPath(invalid[1])) errorNames.add(name);
    }
  }
  return { errorNames, catalogueErrors, invalidItems };
}

/** `BOX 14 of SUBEQUIPMENT /X of EQUI /Y` → `/X`、`/Y`；`/X` → `/X` */
function namesInPath(path: string): string[] {
  const names: string[] = [];
  for (const segment of path.split(' of ')) {
    const match = /(^|\s)(\/[^\s*]+)/.exec(segment.trim());
    if (match?.[2]) names.push(match[2]);
  }
  return names;
}

export type ClassifyContext = {
  /** 报告里「仅 E3D」和「仅生成」一样多：一边一件，多半是同一批构件名字没对上 */
  balancedOnlySides: boolean;
  log: E3dLogInfo | null;
};

const ONLY_BASELINE = new Set(['only_baseline', 'container_only_baseline']);
const ONLY_GENERATED = new Set(['only_generated', 'container_only_generated']);
const OFF = new Set(['off', 'container_off']);
const AXES = ['X', 'Y', 'Z'] as const;
const LENGTH_TOLERANCE_MM = 1;
const SHIFT_AXIS_MM = 0.1;

function mm(value: number): string {
  return String(Number(value.toFixed(1)));
}

function isBox(value: number[] | null | undefined): value is number[] {
  return Array.isArray(value) && value.length === 6 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function sizes(box: number[]): number[] {
  return [0, 1, 2].map((axis) => (box[axis + 3] ?? 0) - (box[axis] ?? 0));
}

function centres(box: number[]): number[] {
  return [0, 1, 2].map((axis) => ((box[axis] ?? 0) + (box[axis + 3] ?? 0)) / 2);
}

function lengthText(baseline: number[], generated: number[]): string | null {
  const baseSize = sizes(baseline);
  const genSize = sizes(generated);
  const parts: string[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = (genSize[axis] ?? 0) - (baseSize[axis] ?? 0);
    if (Math.abs(delta) <= LENGTH_TOLERANCE_MM) continue;
    parts.push(`${AXES[axis]} 向 E3D ${mm(baseSize[axis] ?? 0)}、生成 ${mm(genSize[axis] ?? 0)}（生成${delta < 0 ? '短' : '长'} ${mm(Math.abs(delta))} mm）`);
  }
  return parts.length ? `长度不同：${parts.join('；')}` : null;
}

function shiftText(baseline: number[], generated: number[]): string {
  const base = centres(baseline);
  const gen = centres(generated);
  const deltas = [0, 1, 2].map((axis) => (gen[axis] ?? 0) - (base[axis] ?? 0));
  const distance = Math.hypot(...deltas);
  const axes = deltas
    .map((delta, axis) => ({ delta, axis }))
    .filter(({ delta }) => Math.abs(delta) >= SHIFT_AXIS_MM)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .map(({ delta, axis }) => `${delta < 0 ? '-' : '+'}${AXES[axis]} ${mm(Math.abs(delta))}`);
  const direction = axes.length ? `，生成相对 E3D 沿 ${axes.join('、')}` : '';
  return `尺寸一致，整体平移 ${mm(distance)} mm${direction}`;
}

const NAMING_PATH = /\bof WORLD? \/\*|^\/GENERATED\//;
const MISSING_TEMPLATE = /^PJOINT \d+ of PNODE .* of SCTN \//;

function hitsLog(name: string, log: E3dLogInfo | null): boolean {
  if (!log || log.errorNames.size === 0) return false;
  const trimmed = name.trim();
  if (log.errorNames.has(trimmed)) return true;
  return namesInPath(trimmed).some((candidate) => log.errorNames.has(candidate));
}

/** 一行差异的原因。规则按顺序匹配，匹配上就停。 */
export function classifyRow(row: RvmMismatch, ctx: ClassifyContext): ReasonDetail {
  const name = String(row.name ?? '').trim();
  const oneSided = ONLY_BASELINE.has(row.category) || ONLY_GENERATED.has(row.category);
  if (oneSided && ctx.balancedOnlySides && NAMING_PATH.test(name)) {
    return { reason: 'naming', text: '无名构件两边的路径写法不同（E3D 写 WORLD /*，生成写 /GENERATED/…），按名字配不上；不是几何问题' };
  }
  if (ONLY_BASELINE.has(row.category) && MISSING_TEMPLATE.test(name)) {
    return { reason: 'missing_template', text: 'E3D 有型钢节点模板里的 PJOINT，我们没有展开生成这一件' };
  }
  if (hitsLog(name, ctx.log)) {
    return { reason: 'e3d_catalogue', text: 'E3D 导出时这件报了目录错误（见 e3d.log），E3D 一侧的几何不可信' };
  }
  if (OFF.has(row.category) && isBox(row.baseline_aabb) && isBox(row.generated_aabb)) {
    const length = lengthText(row.baseline_aabb, row.generated_aabb);
    if (length) return { reason: 'length', text: length };
    return { reason: 'shift', text: shiftText(row.baseline_aabb, row.generated_aabb) };
  }
  if (row.category.startsWith('unkeyable_')) {
    return { reason: 'unpaired', text: '缺 noun / 属主 / 序号，按名字配不上；只是提示，不影响结论' };
  }
  if (ONLY_BASELINE.has(row.category)) return { reason: 'only_e3d', text: null };
  if (ONLY_GENERATED.has(row.category)) return { reason: 'only_ours', text: null };
  if (row.category === 'kind_differ') return { reason: 'kind', text: null };
  return { reason: 'other', text: null };
}

export type RvmClassifiedVerdict = 'pass' | 'kind_differ' | 'fail' | 'empty' | 'tool_error' | 'external';

export type ReasonSummary = { reason: RvmReason; count: number };

export type ClassifiedReport = {
  /** 键是 `report.mismatches` 里的下标 */
  rows: Map<number, ReasonDetail>;
  summary: ReasonSummary[];
  nodeVerdict: RvmClassifiedVerdict;
  /** 不算我们的问题的行数 */
  externalRows: number;
};

const TOOL_ERROR = /rvm_compare|compare\.json|认不出/;

type ReportLike = Partial<Pick<RvmCheckReport, 'verdict' | 'message' | 'stage' | 'mismatches' | 'mismatches_truncated'>> & {
  counts?: Partial<Record<string, number>> | null;
};

export function classifyReport(report: ReportLike | null | undefined, log: E3dLogInfo | null = null): ClassifiedReport {
  const counts = report?.counts ?? {};
  const mismatches = Array.isArray(report?.mismatches) ? report.mismatches : [];
  const onlyBaseline = counts.only_baseline ?? 0;
  const onlyGenerated = counts.only_generated ?? 0;
  const ctx: ClassifyContext = { balancedOnlySides: onlyBaseline > 0 && onlyBaseline === onlyGenerated, log };

  const rows = new Map<number, ReasonDetail>();
  const tally = new Map<RvmReason, number>();
  let externalRows = 0;
  mismatches.forEach((row, index) => {
    const detail = classifyRow(row, ctx);
    rows.set(index, detail);
    tally.set(detail.reason, (tally.get(detail.reason) ?? 0) + 1);
    if (!REASONS[detail.reason].ours) externalRows += 1;
  });
  const summary = REASON_ORDER
    .filter((reason) => tally.has(reason))
    .map((reason) => ({ reason, count: tally.get(reason) ?? 0 }))
    // 我们的问题排前面，同组内按行数
    .sort((left, right) => Number(REASONS[right.reason].ours) - Number(REASONS[left.reason].ours) || right.count - left.count);

  return { rows, summary, nodeVerdict: nodeVerdictOf(report, counts, mismatches.length, externalRows), externalRows };
}

function nodeVerdictOf(
  report: ReportLike | null | undefined,
  counts: Partial<Record<string, number>>,
  rowCount: number,
  externalRows: number,
): RvmClassifiedVerdict {
  const raw = report?.verdict === 'pass' || report?.verdict === 'kind_differ' ? report.verdict : 'fail';
  if (raw === 'pass') return 'pass';
  // 比对工具没跑通时计数也是 0，先认工具故障
  if (report?.stage === 'compare' && TOOL_ERROR.test(String(report?.message ?? ''))) return 'tool_error';
  const total = Object.values(counts).reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
  if (report?.counts && total === 0) return 'empty';
  // 清单被截断时看不到全部行，不下「不是我们的问题」的结论
  if (rowCount > 0 && externalRows === rowCount && !report?.mismatches_truncated) return 'external';
  return raw;
}

/** 汇总里前两个原因的简写：`命名没配上 156 · 长度不同 5` */
export function reasonBrief(summary: ReasonSummary[], limit = 2): string {
  return summary.slice(0, limit).map(({ reason, count }) => `${REASONS[reason].label} ${count}`).join(' · ');
}

export const VERDICT_HINTS: Partial<Record<RvmClassifiedVerdict, string>> = {
  empty: '两边都没有可比的几何（计数全是 0），不算不一致。',
  tool_error: '比对工具没跑通，这次结论不能当真，要先修比对工具。',
  external: '疑似不是我们的问题：差异全来自命名、E3D 目录错误或配对提示，不是几何问题。',
};
