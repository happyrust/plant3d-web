import type { ComputationPoint } from '@/measurement/domain/measurementResult';

import {
  fromV1Refno,
  genModelV1SurfaceClearance,
  type GenModelV1RequestOptions,
  type SpatialPosition,
  type SurfaceClearanceResponse,
} from '@/api/genModelV1Api';
import {
  clearanceRecordId,
  createClearanceRecord,
  normalizeClearanceRefno,
  type ClearanceFaceConfidence,
  type ClearanceFaceKind,
  type ClearanceRecord,
  type ClearanceSnapshot,
  type ClearanceTargetKind,
  type ClearanceWitness,
} from '@/clearance/domain/clearanceRecord';
import {
  createComputationProvenance,
  type ComputationWarning,
} from '@/measurement/domain/computationProvenance';

/**
 * Clearance service：唯一一处把 gen-model `/api/v1/spatial/surface-clearance` 的 **E3D 世界 mm** 换成
 * design-world 米（09-11 D3：每个转换只发生一次），并把响应铸成 `ClearanceRecord`。
 * 入口（拾取流 / 空间查询抽屉）都从这里拿记录，不各自解析响应。
 */

export type ComputeClearanceInput = Readonly<{
  sourceRefno: string;
  targetRefno: string;
  /** 缺省 `wall`：目标不是墙族服务端回 422 */
  targetKind?: ClearanceTargetKind;
  perpendicular?: boolean;
  maxDistanceMm?: number;
}>;

export type ClearanceService = Readonly<{
  /** 选中构件 → 选中的墙（`targetKind = wall`） */
  computeComponentToWall(input: Omit<ComputeClearanceInput, 'targetKind'>): Promise<ClearanceRecord>;
  /** 任意一对（抽屉「净距标注」用，`targetKind = any`） */
  compute(input: ComputeClearanceInput): Promise<ClearanceRecord>;
}>;

export type ClearanceServiceDeps = Readonly<{
  fetchSurfaceClearance?: typeof genModelV1SurfaceClearance;
  requestOptions?: GenModelV1RequestOptions;
  now?: () => Date;
}>;

const MM_PER_M = 1000;

function mmToM(mm: number): number {
  return mm / MM_PER_M;
}

function pointMmToM(point: SpatialPosition): ComputationPoint {
  return Object.freeze([mmToM(point.x), mmToM(point.y), mmToM(point.z)]) as ComputationPoint;
}

function unitVector(point: SpatialPosition): ComputationPoint {
  return Object.freeze([point.x, point.y, point.z]) as ComputationPoint;
}

const FACE_KINDS: ReadonlySet<string> = new Set(['inner', 'outer', 'side', 'opening', 'top', 'bottom', 'end', 'unknown']);
const FACE_CONFIDENCES: ReadonlySet<string> = new Set(['pca', 'geometric', 'normal-only']);

function faceKind(value: string): ClearanceFaceKind {
  return (FACE_KINDS.has(value) ? value : 'unknown') as ClearanceFaceKind;
}

function faceConfidence(value: string): ClearanceFaceConfidence {
  return (FACE_CONFIDENCES.has(value) ? value : 'normal-only') as ClearanceFaceConfidence;
}

function witness(value: string): ClearanceWitness {
  return value === 'aabb-overlap-center' ? 'aabb-overlap-center' : 'closest-points';
}

/**
 * 服务端 warning 是一行文本，约定形如 `code: 说明`（`perpendicular_ray_missed: …`、`beyond_max_distance: …`）；
 * 没有这个前缀的归到 `server`。
 */
export function parseServerWarning(text: string): ComputationWarning {
  const match = /^([a-z][a-z0-9_]*)\s*:\s*(.+)$/is.exec(text.trim());
  if (match) {
    return Object.freeze({ code: match[1]!.toLowerCase(), message: match[2]!.trim() });
  }
  return Object.freeze({ code: 'server', message: text.trim() || 'unknown warning' });
}

function modelVersionText(model: SurfaceClearanceResponse['model']): string | null {
  const parts: string[] = [];
  if (model.source_sesno !== null && model.source_sesno !== undefined) parts.push(`src:${model.source_sesno}`);
  if (model.target_sesno !== null && model.target_sesno !== undefined) parts.push(`tgt:${model.target_sesno}`);
  return parts.length > 0 ? parts.join(';') : null;
}

function snapshotFromResponse(response: SurfaceClearanceResponse): ClearanceSnapshot | null {
  const result = response.result;
  if (!result) return null;
  return Object.freeze({
    distanceM: mmToM(result.distance_mm),
    intersects: result.intersects,
    sourcePoint: pointMmToM(result.source_point),
    targetPoint: pointMmToM(result.target_point),
    vector: Object.freeze([
      mmToM(result.vector.dx),
      mmToM(result.vector.dy),
      mmToM(result.vector.dz),
    ]) as ComputationPoint,
    sourceLeafRefno: fromV1Refno(result.source_leaf_refno),
    targetLeafRefno: fromV1Refno(result.target_leaf_refno),
    targetLeafNoun: result.target_leaf_noun,
    targetFace: result.target_face
      ? Object.freeze({
        kind: faceKind(result.target_face.kind),
        normal: unitVector(result.target_face.normal),
        confidence: faceConfidence(result.target_face.confidence),
      })
      : null,
    perpendicular: result.perpendicular
      ? Object.freeze({
        distanceM: mmToM(result.perpendicular.distance_mm),
        from: pointMmToM(result.perpendicular.from),
        to: pointMmToM(result.perpendicular.to),
      })
      : null,
    witness: witness(result.witness),
  });
}

/**
 * 响应 → 记录（纯函数，可单测）。`method` / `accuracy_class` 只认服务端字面 `surface_to_surface` /
 * `exact-surface`——别的值说明服务端换了口径，宁可抛出，也不把它标成精确（D2）。
 */
export function surfaceClearanceToRecord(
  response: SurfaceClearanceResponse,
  input: ComputeClearanceInput,
  computedAt: Date,
  previous?: ClearanceRecord | null,
): ClearanceRecord {
  if (response.method !== 'surface_to_surface' || response.accuracy_class !== 'exact-surface') {
    throw new TypeError(
      `surface-clearance 响应的 method / accuracy_class 不是预期口径: ${String(response.method)} / ${String(response.accuracy_class)}`,
    );
  }
  const sourceRefno = normalizeClearanceRefno(input.sourceRefno);
  const targetRefno = normalizeClearanceRefno(input.targetRefno);
  const targetKind: ClearanceTargetKind = input.targetKind ?? 'wall';
  const snapshot = snapshotFromResponse(response);
  const provenance = createComputationProvenance({
    method: 'surface-to-surface',
    accuracyClass: 'exact-surface',
    coordinateSpace: 'design-world',
    sourceModelVersion: modelVersionText(response.model),
    source: {
      entityId: sourceRefno,
      refno: sourceRefno,
      ...(snapshot ? { segmentRefno: snapshot.sourceLeafRefno } : {}),
    },
    target: {
      entityId: targetRefno,
      refno: targetRefno,
      ...(snapshot ? { segmentRefno: snapshot.targetLeafRefno } : {}),
    },
    warnings: response.warnings.map(parseServerWarning),
    errorBoundM: Number.isFinite(response.error_bound_mm) ? mmToM(response.error_bound_mm) : null,
  });
  const inputs = { sourceRefno, targetRefno, targetKind };
  return createClearanceRecord({
    id: clearanceRecordId(inputs),
    kind: targetKind === 'wall' ? 'component-to-wall' : 'component-to-component',
    inputs,
    sourceNoun: response.source.noun,
    targetNoun: response.target.noun,
    provenance,
    snapshot,
    modelVersion: {
      sourceSesno: response.model.source_sesno ?? null,
      targetSesno: response.model.target_sesno ?? null,
    },
    status: 'current',
    createdAt: previous?.createdAt ?? computedAt.toISOString(),
    computedAt: computedAt.toISOString(),
  });
}

export function createClearanceService(deps: ClearanceServiceDeps = {}): ClearanceService {
  const fetchSurfaceClearance = deps.fetchSurfaceClearance ?? genModelV1SurfaceClearance;
  const now = deps.now ?? (() => new Date());

  async function compute(input: ComputeClearanceInput): Promise<ClearanceRecord> {
    const targetKind: ClearanceTargetKind = input.targetKind ?? 'wall';
    const response = await fetchSurfaceClearance(
      {
        sourceRefno: input.sourceRefno,
        targetRefno: input.targetRefno,
        targetKind,
        perpendicular: input.perpendicular,
        maxDistanceMm: input.maxDistanceMm,
      },
      deps.requestOptions,
    );
    return surfaceClearanceToRecord(response, { ...input, targetKind }, now());
  }

  return Object.freeze({
    compute,
    computeComponentToWall(input) {
      return compute({ ...input, targetKind: 'wall' });
    },
  });
}

let defaultService: ClearanceService | null = null;

/** 进程内缺省实例（真 API）；测试用 `createClearanceService({ fetchSurfaceClearance })` 自己造。 */
export function defaultClearanceService(): ClearanceService {
  defaultService ??= createClearanceService();
  return defaultService;
}
