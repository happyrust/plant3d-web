import type { OutsideDiameterEvidence } from '@/composables/branParallelSpacing';
import type { ComputationPoint } from '@/measurement/domain/measurementResult';

/**
 * 连排相邻测量（`docs/plans/2026-10-19-pipe-row-adjacent-measurement-plan.md`）的记录级扩展。
 *
 * 挂在 `ClearanceRecord.pipeRow` 而不是快照里：`derived-gap` 记录允许 `snapshot: null`
 * （缺可靠外径 / 名义重叠时没有可画的真实端点），但排身份、测量截面和外径证据不能随快照一起丢。
 */

export const PIPE_ROW_ALIGN_MODES = Object.freeze(['center', 'bottom'] as const);
/** 归排依据：`center` 管中心成排；`bottom` 管底对齐（只改归排与排序，不改中心距口径）。 */
export type PipeRowAlignMode = typeof PIPE_ROW_ALIGN_MODES[number];

export const PIPE_ROW_METRICS = Object.freeze(['center-distance', 'derived-gap'] as const);
/** `center-distance` 截面中心距；`derived-gap` 平行圆柱模型推导间隔（有符号，非网格精算）。 */
export type PipeRowMetric = typeof PIPE_ROW_METRICS[number];

/** 测量截面：垂直于组代表管向、位于共同区段内的平面（design-world 米）。 */
export type PipeRowSection = Readonly<{
  /** 截面上靠近被测管的一点：相邻对两中心的中点（截面取在该对共同区段的中点） */
  point: ComputationPoint;
  /** 截面法向 = 组代表管向（单位向量） */
  normal: ComputationPoint;
  /** 共同区段沿法向的参数区间（米，dot 坐标） */
  axialStartM: number;
  axialEndM: number;
}>;

export type PipeRowSideOd = Readonly<{
  /** 该侧名义外径（米）；`missing` 时为 null */
  odM: number | null;
  evidence: OutsideDiameterEvidence;
}>;

export type ClearanceRecordPipeRow = Readonly<{
  alignMode: PipeRowAlignMode;
  metric: PipeRowMetric;
  /**
   * `derived-gap` 的有符号名义间隔（米）：正 = 间隙，0 = 名义接触，负 = 名义外径包络重叠；
   * 任一侧缺可靠外径或 `center-distance` 记录恒为 null。有符号值只活在这里——
   * `snapshot.distanceM` 的非负语义不变，不允许拿它冒充网格相交。
   */
  signedGapM: number | null;
  section: PipeRowSection;
  /** 所在排的身份（同一确认的同一排恒定）：`row:<排序后锚点 refno 串>@<区段>` */
  rowGroupId: string;
  sourceOd: PipeRowSideOd;
  targetOd: PipeRowSideOd;
}>;

const ALIGN_MODE_SET: ReadonlySet<string> = new Set(PIPE_ROW_ALIGN_MODES);
const METRIC_SET: ReadonlySet<string> = new Set(PIPE_ROW_METRICS);
const OD_EVIDENCE_SET: ReadonlySet<string> = new Set(['catalogue', 'bore-estimate', 'legacy-member', 'unverified', 'missing']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredTextIn(value: unknown, field: string, allowed?: ReadonlySet<string>): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  const text = value.trim();
  if (allowed && !allowed.has(text)) throw new TypeError(`${field} is invalid: ${text}`);
  return text;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return value;
}

function finiteOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return finiteNumber(value, field);
}

function normalizePoint(value: unknown, field: string): ComputationPoint {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || !value.every(component => typeof component === 'number' && Number.isFinite(component))
  ) {
    throw new TypeError(`${field} must be a finite three-component point`);
  }
  return Object.freeze([value[0], value[1], value[2]]) as ComputationPoint;
}

function normalizeSideOd(value: unknown, field: string): PipeRowSideOd {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  const odM = finiteOrNull(value.odM, `${field}.odM`);
  if (odM !== null && odM <= 0) throw new TypeError(`${field}.odM must be positive when present`);
  const evidence = requiredTextIn(value.evidence, `${field}.evidence`, OD_EVIDENCE_SET);
  if (evidence === 'missing' && odM !== null) {
    throw new TypeError(`${field}: odM must be null when evidence is missing`);
  }
  return Object.freeze({ odM, evidence: evidence as OutsideDiameterEvidence });
}

/**
 * 归一化连排扩展；`null`/`undefined` → `null`（旧记录没有这一格，保持原语义）。
 * `derived-gap` 必须给 `signedGapM`（可为 null = 缺证据），`center-distance` 必须为 null——
 * 中心距的值在 `snapshot.distanceM`，不在扩展里复制第二份。
 */
export function normalizePipeRowExtension(value: unknown): ClearanceRecordPipeRow | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new TypeError('pipeRow must be an object or null');
  const alignMode = requiredTextIn(value.alignMode, 'pipeRow.alignMode', ALIGN_MODE_SET) as PipeRowAlignMode;
  const metric = requiredTextIn(value.metric, 'pipeRow.metric', METRIC_SET) as PipeRowMetric;
  const signedGapM = finiteOrNull(value.signedGapM, 'pipeRow.signedGapM');
  if (metric === 'center-distance' && signedGapM !== null) {
    throw new TypeError('pipeRow.signedGapM must be null for center-distance records');
  }
  if (!isRecord(value.section)) throw new TypeError('pipeRow.section must be an object');
  const axialStartM = finiteNumber(value.section.axialStartM, 'pipeRow.section.axialStartM');
  const axialEndM = finiteNumber(value.section.axialEndM, 'pipeRow.section.axialEndM');
  if (!(axialEndM > axialStartM)) throw new TypeError('pipeRow.section axial range must be non-empty');
  const normal = normalizePoint(value.section.normal, 'pipeRow.section.normal');
  const norm = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(Math.abs(norm - 1) <= 1e-3)) throw new TypeError('pipeRow.section.normal must be a unit vector');
  return Object.freeze({
    alignMode,
    metric,
    signedGapM,
    section: Object.freeze({
      point: normalizePoint(value.section.point, 'pipeRow.section.point'),
      normal,
      axialStartM,
      axialEndM,
    }),
    rowGroupId: requiredTextIn(value.rowGroupId, 'pipeRow.rowGroupId'),
    sourceOd: normalizeSideOd(value.sourceOd, 'pipeRow.sourceOd'),
    targetOd: normalizeSideOd(value.targetOd, 'pipeRow.targetOd'),
  });
}

/** 外径本身是估算值的证据档：孔径估算，或旧服务端未标来源的成员外径（目录外径与通径估算不可分）。 */
export function isEstimatedOdEvidence(evidence: OutsideDiameterEvidence): boolean {
  return evidence === 'bore-estimate' || evidence === 'legacy-member';
}

/**
 * 推导间隔是否建立在估算外径上。精度档 `derived-nominal` 只说明「这是名义推导值」，说不出「外径本身也是估的」——
 * 显示时靠这里补 `≈`（plan §4.2：`≈` 只标估算外径，「推导」另由口径前缀与方法标签表达）。
 */
export function pipeRowGapEstimated(pipeRow: ClearanceRecordPipeRow | null | undefined): boolean {
  return !!pipeRow && pipeRow.metric === 'derived-gap'
    && (isEstimatedOdEvidence(pipeRow.sourceOd.evidence) || isEstimatedOdEvidence(pipeRow.targetOd.evidence));
}
