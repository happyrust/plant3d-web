import type { ComputationPoint } from '@/measurement/domain/measurementResult';

import {
  isComputationProvenance,
  type ComputationProvenance,
} from '@/measurement/domain/computationProvenance';

/**
 * Clearance 领域（2026-09-11 收敛计划 D1）：「两个工程对象之间可重算的最近关系」。
 * 第一个落地的种类是构件 × 墙（`docs/plans/2026-09-17-component-to-wall-surface-clearance-plan.md`，决策 d-428）。
 *
 * 与 Measurement 的边界：这里没有用户取的点，输入只有两个 refno；结果是快照，模型换版就 `stale`（D4），
 * 可以按同一 inputs 重算。长度一律 design-world 米（D3）——API 的 mm 在 service 边界一次转完。
 */

export const CLEARANCE_KINDS = Object.freeze(['component-to-wall', 'component-to-component'] as const);
export type ClearanceKind = typeof CLEARANCE_KINDS[number];

export const CLEARANCE_STATUSES = Object.freeze(['current', 'stale', 'failed'] as const);
export type ClearanceStatus = typeof CLEARANCE_STATUSES[number];

export const CLEARANCE_TARGET_KINDS = Object.freeze(['wall', 'any'] as const);
export type ClearanceTargetKind = typeof CLEARANCE_TARGET_KINDS[number];

/**
 * 命中墙面：直墙两侧对称只分得出 `side`；弧墙分 `inner`（凹）/ `outer`（凸）；`opening` 是洞壁
 * （门窗 / 套管孔等布尔掏出来的面，构件在洞里时命中的就是它，也是主面、带垂距；2026-09-18 口径）。
 */
export const CLEARANCE_FACE_KINDS = Object.freeze([
  'inner',
  'outer',
  'side',
  'opening',
  'top',
  'bottom',
  'end',
  'unknown',
] as const);
export type ClearanceFaceKind = typeof CLEARANCE_FACE_KINDS[number];

export const CLEARANCE_FACE_CONFIDENCES = Object.freeze(['pca', 'geometric', 'normal-only'] as const);
export type ClearanceFaceConfidence = typeof CLEARANCE_FACE_CONFIDENCES[number];

export const CLEARANCE_WITNESSES = Object.freeze(['closest-points', 'aabb-overlap-center'] as const);
export type ClearanceWitness = typeof CLEARANCE_WITNESSES[number];

export type ClearanceFace = Readonly<{
  kind: ClearanceFaceKind;
  /** 命中三角的法向（单位向量，指向源侧） */
  normal: ComputationPoint;
  confidence: ClearanceFaceConfidence;
}>;

export type ClearancePerpendicular = Readonly<{
  distanceM: number;
  from: ComputationPoint;
  to: ComputationPoint;
}>;

export type ClearanceSnapshot = Readonly<{
  distanceM: number;
  intersects: boolean;
  sourcePoint: ComputationPoint;
  targetPoint: ComputationPoint;
  /** `targetPoint − sourcePoint`（E / N / U） */
  vector: ComputationPoint;
  /** 两侧真正命中的叶子（`a_b`） */
  sourceLeafRefno: string;
  targetLeafRefno: string;
  targetLeafNoun: string;
  targetFace: ClearanceFace | null;
  perpendicular: ClearancePerpendicular | null;
  witness: ClearanceWitness;
}>;

/** 两侧参与叶子的模型会话号；跨库不可比，只用于「同一侧换版了没有」。 */
export type ClearanceModelVersion = Readonly<{
  sourceSesno: number | null;
  targetSesno: number | null;
}>;

export type ClearanceInputs = Readonly<{
  /** 本仓内部键 `a_b` */
  sourceRefno: string;
  targetRefno: string;
  targetKind: ClearanceTargetKind;
}>;

export type ClearanceRecord = Readonly<{
  id: string;
  kind: ClearanceKind;
  inputs: ClearanceInputs;
  sourceNoun: string;
  targetNoun: string;
  provenance: ComputationProvenance;
  /** `null` = 本次没算出距离（超 maxDistance）；旧快照在 `stale` 时仍保留 */
  snapshot: ClearanceSnapshot | null;
  modelVersion: ClearanceModelVersion;
  status: ClearanceStatus;
  createdAt: string;
  computedAt: string;
}>;

export type ClearanceRecordInput = Readonly<{
  id?: string;
  kind: ClearanceKind;
  inputs: ClearanceInputs;
  sourceNoun?: string;
  targetNoun?: string;
  provenance: ComputationProvenance;
  snapshot: ClearanceSnapshot | null;
  modelVersion: ClearanceModelVersion;
  status?: ClearanceStatus;
  createdAt?: string;
  computedAt: string;
}>;

const KIND_SET: ReadonlySet<string> = new Set(CLEARANCE_KINDS);
const STATUS_SET: ReadonlySet<string> = new Set(CLEARANCE_STATUSES);
const TARGET_KIND_SET: ReadonlySet<string> = new Set(CLEARANCE_TARGET_KINDS);
const FACE_KIND_SET: ReadonlySet<string> = new Set(CLEARANCE_FACE_KINDS);
const FACE_CONFIDENCE_SET: ReadonlySet<string> = new Set(CLEARANCE_FACE_CONFIDENCES);
const WITNESS_SET: ReadonlySet<string> = new Set(CLEARANCE_WITNESSES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `a/b` / `a_b`（允许两侧空白）→ 本仓内部键 `a_b`；非 refno 形状原样返回。 */
export function normalizeClearanceRefno(value: string): string {
  const match = /^\s*(\d+)\s*[/_]\s*(\d+)\s*$/.exec(value);
  return match ? `${match[1]}_${match[2]}` : value.trim();
}

/** 同一对 inputs 只对应一条记录：重算覆盖，不另起。 */
export function clearanceRecordId(inputs: Pick<ClearanceInputs, 'sourceRefno' | 'targetRefno'>): string {
  return `clearance:${normalizeClearanceRefno(inputs.sourceRefno)}:${normalizeClearanceRefno(inputs.targetRefno)}`;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function finiteNumber(value: unknown, field: string, { nonNegative = false } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonNegative && value < 0)) {
    throw new TypeError(`${field} must be a finite${nonNegative ? ' non-negative' : ''} number`);
  }
  return value;
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

function normalizeFace(value: unknown): ClearanceFace | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new TypeError('snapshot.targetFace must be an object or null');
  const kind = requiredText(value.kind, 'snapshot.targetFace.kind');
  if (!FACE_KIND_SET.has(kind)) throw new TypeError(`snapshot.targetFace.kind is invalid: ${kind}`);
  const confidence = requiredText(value.confidence, 'snapshot.targetFace.confidence');
  if (!FACE_CONFIDENCE_SET.has(confidence)) {
    throw new TypeError(`snapshot.targetFace.confidence is invalid: ${confidence}`);
  }
  return Object.freeze({
    kind: kind as ClearanceFaceKind,
    normal: normalizePoint(value.normal, 'snapshot.targetFace.normal'),
    confidence: confidence as ClearanceFaceConfidence,
  });
}

function normalizePerpendicular(value: unknown): ClearancePerpendicular | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new TypeError('snapshot.perpendicular must be an object or null');
  return Object.freeze({
    distanceM: finiteNumber(value.distanceM, 'snapshot.perpendicular.distanceM', { nonNegative: true }),
    from: normalizePoint(value.from, 'snapshot.perpendicular.from'),
    to: normalizePoint(value.to, 'snapshot.perpendicular.to'),
  });
}

function normalizeSnapshot(value: unknown): ClearanceSnapshot | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new TypeError('snapshot must be an object or null');
  const witness = requiredText(value.witness, 'snapshot.witness');
  if (!WITNESS_SET.has(witness)) throw new TypeError(`snapshot.witness is invalid: ${witness}`);
  if (typeof value.intersects !== 'boolean') throw new TypeError('snapshot.intersects must be a boolean');
  const distanceM = finiteNumber(value.distanceM, 'snapshot.distanceM', { nonNegative: true });
  if (value.intersects && distanceM !== 0) {
    throw new TypeError('snapshot.distanceM must be 0 when intersects is true');
  }
  return Object.freeze({
    distanceM,
    intersects: value.intersects,
    sourcePoint: normalizePoint(value.sourcePoint, 'snapshot.sourcePoint'),
    targetPoint: normalizePoint(value.targetPoint, 'snapshot.targetPoint'),
    vector: normalizePoint(value.vector, 'snapshot.vector'),
    sourceLeafRefno: normalizeClearanceRefno(requiredText(value.sourceLeafRefno, 'snapshot.sourceLeafRefno')),
    targetLeafRefno: normalizeClearanceRefno(requiredText(value.targetLeafRefno, 'snapshot.targetLeafRefno')),
    targetLeafNoun: typeof value.targetLeafNoun === 'string' ? value.targetLeafNoun.trim().toUpperCase() : '',
    targetFace: normalizeFace(value.targetFace),
    perpendicular: normalizePerpendicular(value.perpendicular),
    witness: witness as ClearanceWitness,
  });
}

function normalizeSesno(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = finiteNumber(value, field);
  if (!Number.isInteger(n)) throw new TypeError(`${field} must be an integer`);
  return n;
}

function normalizeModelVersion(value: unknown): ClearanceModelVersion {
  if (!isRecord(value)) throw new TypeError('modelVersion must be an object');
  return Object.freeze({
    sourceSesno: normalizeSesno(value.sourceSesno, 'modelVersion.sourceSesno'),
    targetSesno: normalizeSesno(value.targetSesno, 'modelVersion.targetSesno'),
  });
}

function normalizeInputs(value: unknown): ClearanceInputs {
  if (!isRecord(value)) throw new TypeError('inputs must be an object');
  const sourceRefno = normalizeClearanceRefno(requiredText(value.sourceRefno, 'inputs.sourceRefno'));
  const targetRefno = normalizeClearanceRefno(requiredText(value.targetRefno, 'inputs.targetRefno'));
  if (sourceRefno === targetRefno) throw new TypeError('inputs.sourceRefno and inputs.targetRefno must differ');
  const targetKind = requiredText(value.targetKind, 'inputs.targetKind');
  if (!TARGET_KIND_SET.has(targetKind)) throw new TypeError(`inputs.targetKind is invalid: ${targetKind}`);
  return Object.freeze({ sourceRefno, targetRefno, targetKind: targetKind as ClearanceTargetKind });
}

function normalizeIsoTime(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (Number.isNaN(Date.parse(text))) throw new TypeError(`${field} must be an ISO-8601 timestamp`);
  return text;
}

/**
 * 建一条记录并把合同钉死：`provenance` 必须满足 `ComputationProvenance`（缺 method / accuracyClass 直接拒收，
 * 09-11 M0 验收），快照里的数都是有限值、相交时距离为 0，refno 归一成 `a_b`。
 */
export function createClearanceRecord(input: ClearanceRecordInput): ClearanceRecord {
  if (!isRecord(input)) throw new TypeError('clearance record input must be an object');
  const kind = requiredText(input.kind, 'kind');
  if (!KIND_SET.has(kind)) throw new TypeError(`kind is invalid: ${kind}`);
  if (!isComputationProvenance(input.provenance)) {
    throw new TypeError('provenance must satisfy the computation provenance contract');
  }
  const status = input.status === undefined ? 'current' : requiredText(input.status, 'status');
  if (!STATUS_SET.has(status)) throw new TypeError(`status is invalid: ${status}`);
  const inputs = normalizeInputs(input.inputs);
  const computedAt = normalizeIsoTime(input.computedAt, 'computedAt');
  const createdAt = input.createdAt === undefined ? computedAt : normalizeIsoTime(input.createdAt, 'createdAt');
  const id = input.id === undefined ? clearanceRecordId(inputs) : requiredText(input.id, 'id');

  return Object.freeze({
    id,
    kind: kind as ClearanceKind,
    inputs,
    sourceNoun: typeof input.sourceNoun === 'string' ? input.sourceNoun.trim().toUpperCase() : '',
    targetNoun: typeof input.targetNoun === 'string' ? input.targetNoun.trim().toUpperCase() : '',
    provenance: input.provenance,
    snapshot: normalizeSnapshot(input.snapshot),
    modelVersion: normalizeModelVersion(input.modelVersion),
    status: status as ClearanceStatus,
    createdAt,
    computedAt,
  });
}

export function isClearanceRecord(value: unknown): value is ClearanceRecord {
  if (!isRecord(value)) return false;
  try {
    createClearanceRecord(value as unknown as ClearanceRecordInput);
    return typeof value.id === 'string' && value.id.length > 0;
  } catch {
    return false;
  }
}

/** 换个状态、其余不动（快照保留——D4 要求过期时不静默沿用，但也不丢）。 */
export function withClearanceStatus(record: ClearanceRecord, status: ClearanceStatus): ClearanceRecord {
  if (record.status === status) return record;
  return Object.freeze({ ...record, status });
}

/**
 * 模型是否换版：给出某侧「现在」的会话号，与记录里的比。跨库会话号不可比，所以按 refno 分侧、
 * 只在拿到该侧新会话号时才判；拿不到（`undefined`）视为不知道，不判 stale。
 */
export function clearanceModelChanged(
  record: ClearanceRecord,
  current: Readonly<{ sourceSesno?: number | null; targetSesno?: number | null }>,
): boolean {
  const sideChanged = (recorded: number | null, now: number | null | undefined): boolean => {
    if (now === undefined || now === null || recorded === null) return false;
    return now !== recorded;
  };
  return sideChanged(record.modelVersion.sourceSesno, current.sourceSesno)
    || sideChanged(record.modelVersion.targetSesno, current.targetSesno);
}
