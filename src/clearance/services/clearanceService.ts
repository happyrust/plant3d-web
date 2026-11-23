import type { ComputationPoint } from '@/measurement/domain/measurementResult';

import {
  fromV1Refno,
  genModelV1PipeClearance,
  genModelV1PointToSurface,
  genModelV1SurfaceClearance,
  type GenModelV1RequestOptions,
  type PipeClearanceResponse,
  type PointToSurfaceResponse,
  type SpatialPosition,
  type SurfaceClearanceResponse,
} from '@/api/genModelV1Api';
import {
  clearanceRecordId,
  createClearanceRecord,
  normalizeClearanceRefno,
  type ClearanceFaceConfidence,
  type ClearanceFaceKind,
  type ClearancePerpendicularMethod,
  type ClearanceRecord,
  type ClearanceSnapshot,
  type ClearanceTargetKind,
  type ClearanceWitness,
} from '@/clearance/domain/clearanceRecord';
import {
  assertPipeClearanceResponse,
  assertPointToSurfaceResponse,
  assertSurfaceClearanceResponse,
  enforceClearanceContract,
  mmToM,
  parseServerWarning,
  pointMmToM,
  unitVector,
  vectorMmToM,
} from '@/clearance/services/clearanceContract';
import {
  createComputationProvenance,
  type ComputationProvenance,
} from '@/measurement/domain/computationProvenance';

export { parseServerWarning } from '@/clearance/services/clearanceContract';

/**
 * Clearance service：唯一一处把 gen-model 净距接口（`surface-clearance` / `point-to-surface` / `pipe-clearance`）的
 * **E3D 世界 mm** 换成 design-world 米（09-11 D3：每个转换只发生一次，换算函数在 `clearanceContract`），并把响应
 * 铸成记录。入口（拾取流 / 空间查询抽屉）都从这里拿记录，不各自解析响应。
 */

export type ComputeClearanceInput = Readonly<{
  sourceRefno: string;
  targetRefno: string;
  /** 缺省 `wall`：目标不是墙族服务端回 422 */
  targetKind?: ClearanceTargetKind;
  perpendicular?: boolean;
  maxDistanceMm?: number;
}>;

export type ComputePointToSurfaceInput = Readonly<{
  targetRefno: string;
  /** design-world 米（与记录同口径）；发请求前在这里换回 mm */
  point: ComputationPoint;
  maxDistanceMm?: number;
}>;

export type ComputePipeToPipeInput = Readonly<{
  /** 两条 BRAN */
  sourceRefno: string;
  targetRefno: string;
  sourceSegment?: string;
  targetSegment?: string;
  sourceInsulationMm?: number;
  targetInsulationMm?: number;
}>;

/** 每次计算可带的取消信号（`clearanceRequestGate` 给的）。 */
export type ClearanceCallOptions = Readonly<{ signal?: AbortSignal }>;

/** 点到面的结果：查询点不属于任何模型，不是 `ClearanceRecord`。长度一律米。 */
export type PointToSurfaceRecord = Readonly<{
  targetRefno: string;
  targetNoun: string;
  queryPoint: ComputationPoint;
  /** `null` = `maxDistanceMm` 内没有面 */
  snapshot: Readonly<{
    distanceM: number;
    targetPoint: ComputationPoint;
    vector: ComputationPoint;
    normal: ComputationPoint | null;
    feature: 'face' | 'edge';
    targetLeafRefno: string;
    targetLeafNoun: string;
  }> | null;
  provenance: ComputationProvenance;
  targetSesno: number | null;
  computedAt: string;
}>;

export type ClearanceService = Readonly<{
  /** 选中构件 → 选中的墙（`targetKind = wall`） */
  computeComponentToWall(
    input: Omit<ComputeClearanceInput, 'targetKind'>,
    options?: ClearanceCallOptions,
  ): Promise<ClearanceRecord>;
  /** 任意一对（抽屉「净距标注」用，`targetKind = any`） */
  compute(input: ComputeClearanceInput, options?: ClearanceCallOptions): Promise<ClearanceRecord>;
  /** 点到构件外表面（`point-to-surface`）。 */
  computePointToSurface(input: ComputePointToSurfaceInput, options?: ClearanceCallOptions): Promise<PointToSurfaceRecord>;
  /** 两条 BRAN 直管身的解析净距（`pipe-clearance`）。 */
  computePipeToPipe(input: ComputePipeToPipeInput, options?: ClearanceCallOptions): Promise<ClearanceRecord>;
}>;

export type ClearanceServiceDeps = Readonly<{
  fetchSurfaceClearance?: typeof genModelV1SurfaceClearance;
  fetchPointToSurface?: typeof genModelV1PointToSurface;
  fetchPipeClearance?: typeof genModelV1PipeClearance;
  requestOptions?: GenModelV1RequestOptions;
  now?: () => Date;
}>;

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

const PERPENDICULAR_METHODS: ReadonlySet<string> = new Set(['ray', 'contact', 'edge']);

/** `7bcdd60df` 之前的服务端没有 `method`——那时垂距只有射线一种来源；认不出的值也按 `ray` 读，不让一格新字段拖垮整条记录。 */
function perpendicularMethod(value: string | undefined): ClearancePerpendicularMethod {
  return (value !== undefined && PERPENDICULAR_METHODS.has(value) ? value : 'ray') as ClearancePerpendicularMethod;
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
    vector: vectorMmToM(result.vector),
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
        method: perpendicularMethod(result.perpendicular.method),
      })
      : null,
    witness: witness(result.witness),
  });
}

/**
 * 响应 → 记录（纯函数，可单测）。`method` / `accuracy_class` 只认服务端字面 `surface_to_surface` /
 * `exact-surface`——别的值说明服务端换了口径，宁可抛出，也不把它标成精确（D2）；宽松模式也不放过这一条。
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
  const contractWarnings = enforceClearanceContract(() =>
    assertSurfaceClearanceResponse(response, { vertical: response.result?.vertical === true }));
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
    warnings: [...response.warnings.map(parseServerWarning), ...contractWarnings],
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

/** 点到面响应 → 结果（纯函数）。 */
export function pointToSurfaceToRecord(
  response: PointToSurfaceResponse,
  input: ComputePointToSurfaceInput,
  computedAt: Date,
): PointToSurfaceRecord {
  const contractWarnings = enforceClearanceContract(() => assertPointToSurfaceResponse(response));
  const targetRefno = normalizeClearanceRefno(input.targetRefno);
  const result = response.result;
  const snapshot = result
    ? Object.freeze({
      distanceM: mmToM(result.distance_mm),
      targetPoint: pointMmToM(result.target_point),
      vector: vectorMmToM(result.vector),
      normal: result.normal ? unitVector(result.normal) : null,
      feature: result.feature === 'edge' ? 'edge' as const : 'face' as const,
      targetLeafRefno: fromV1Refno(result.target_leaf_refno),
      targetLeafNoun: result.target_leaf_noun,
    })
    : null;
  const targetSesno = response.model?.target_sesno ?? null;
  return Object.freeze({
    targetRefno,
    targetNoun: response.target.noun,
    queryPoint: pointMmToM(response.query_point),
    snapshot,
    provenance: createComputationProvenance({
      method: 'point-to-triangle-mesh',
      accuracyClass: 'exact-surface',
      coordinateSpace: 'design-world',
      sourceModelVersion: targetSesno === null ? null : `tgt:${targetSesno}`,
      source: { entityId: 'query-point' },
      target: {
        entityId: targetRefno,
        refno: targetRefno,
        ...(snapshot ? { segmentRefno: snapshot.targetLeafRefno } : {}),
      },
      warnings: [...response.warnings.map(parseServerWarning), ...contractWarnings],
      errorBoundM: mmToM(response.error_bound_mm),
    }),
    targetSesno,
    computedAt: computedAt.toISOString(),
  });
}

/** `pipe-clearance` 记录与 `surface-clearance` 同一对 BRAN 时不能互相覆盖：id 另起前缀。 */
export function pipeClearanceRecordId(sourceRefno: string, targetRefno: string): string {
  return `pipe-clearance:${normalizeClearanceRefno(sourceRefno)}:${normalizeClearanceRefno(targetRefno)}`;
}

function pointFromPosition(point: SpatialPosition): ComputationPoint {
  return pointMmToM(point);
}

/**
 * 直管-直管解析净距 → 记录（纯函数）。`exact-analytic`（轴线真、外径名义）记 `pipe-centerline-analytic` /
 * `derived-nominal`；管端胶囊体下界 `approximate-capsule` 记 `pipe-capsule-bound` / `approximate-bounds`。
 */
export function pipeClearanceToRecord(
  response: PipeClearanceResponse,
  input: ComputePipeToPipeInput,
  computedAt: Date,
): ClearanceRecord {
  const contractWarnings = enforceClearanceContract(() => assertPipeClearanceResponse(response));
  const sourceRefno = normalizeClearanceRefno(input.sourceRefno);
  const targetRefno = normalizeClearanceRefno(input.targetRefno);
  const capsule = response.accuracy_class === 'approximate-capsule';
  const result = response.result;
  const snapshot: ClearanceSnapshot | null = result
    ? Object.freeze({
      distanceM: mmToM(result.distance_mm),
      intersects: result.intersects,
      sourcePoint: pointFromPosition(result.source_point),
      targetPoint: pointFromPosition(result.target_point),
      vector: vectorMmToM(result.vector),
      sourceLeafRefno: result.source_segment.refno,
      targetLeafRefno: result.target_segment.refno,
      targetLeafNoun: 'TUBI',
      targetFace: null,
      perpendicular: null,
      witness: 'closest-points',
    })
    : null;
  const penetrationWarning = result?.intersects && result.penetration_mm !== null
    ? [Object.freeze({ code: 'pipe_intersection', message: `两管相交，穿透 ${result.penetration_mm.toFixed(1)} mm` })]
    : [];
  const sourceVersion = response.source.model_version;
  const targetVersion = response.target.model_version;
  const provenance = createComputationProvenance({
    method: capsule ? 'pipe-capsule-bound' : 'pipe-centerline-analytic',
    accuracyClass: capsule ? 'approximate-bounds' : 'derived-nominal',
    coordinateSpace: 'design-world',
    sourceModelVersion: `src:${sourceVersion.dbnum}:${sourceVersion.sesno};tgt:${targetVersion.dbnum}:${targetVersion.sesno}`,
    source: {
      entityId: sourceRefno,
      refno: sourceRefno,
      ...(result ? { segmentRefno: result.source_segment.refno } : {}),
    },
    target: {
      entityId: targetRefno,
      refno: targetRefno,
      ...(result ? { segmentRefno: result.target_segment.refno } : {}),
    },
    warnings: [...response.warnings.map(parseServerWarning), ...penetrationWarning, ...contractWarnings],
    errorBoundM: mmToM(response.error_bound_mm),
  });
  return createClearanceRecord({
    id: pipeClearanceRecordId(sourceRefno, targetRefno),
    kind: 'component-to-component',
    inputs: { sourceRefno, targetRefno, targetKind: 'any' },
    sourceNoun: 'BRAN',
    targetNoun: 'BRAN',
    provenance,
    snapshot,
    modelVersion: { sourceSesno: sourceVersion.sesno, targetSesno: targetVersion.sesno },
    status: 'current',
    computedAt: computedAt.toISOString(),
  });
}

export function createClearanceService(deps: ClearanceServiceDeps = {}): ClearanceService {
  const fetchSurfaceClearance = deps.fetchSurfaceClearance ?? genModelV1SurfaceClearance;
  const fetchPointToSurface = deps.fetchPointToSurface ?? genModelV1PointToSurface;
  const fetchPipeClearance = deps.fetchPipeClearance ?? genModelV1PipeClearance;
  const now = deps.now ?? (() => new Date());
  const requestOptions = (options?: ClearanceCallOptions): GenModelV1RequestOptions | undefined =>
    options?.signal ? { ...deps.requestOptions, signal: options.signal } : deps.requestOptions;

  async function compute(input: ComputeClearanceInput, options?: ClearanceCallOptions): Promise<ClearanceRecord> {
    const targetKind: ClearanceTargetKind = input.targetKind ?? 'wall';
    const response = await fetchSurfaceClearance(
      {
        sourceRefno: input.sourceRefno,
        targetRefno: input.targetRefno,
        targetKind,
        perpendicular: input.perpendicular,
        maxDistanceMm: input.maxDistanceMm,
      },
      requestOptions(options),
    );
    return surfaceClearanceToRecord(response, { ...input, targetKind }, now());
  }

  async function computePointToSurface(
    input: ComputePointToSurfaceInput,
    options?: ClearanceCallOptions,
  ): Promise<PointToSurfaceRecord> {
    const [x, y, z] = input.point;
    const response = await fetchPointToSurface(
      {
        targetRefno: input.targetRefno,
        point: { x: x * 1000, y: y * 1000, z: z * 1000 },
        maxDistanceMm: input.maxDistanceMm,
      },
      requestOptions(options),
    );
    return pointToSurfaceToRecord(response, input, now());
  }

  async function computePipeToPipe(input: ComputePipeToPipeInput, options?: ClearanceCallOptions): Promise<ClearanceRecord> {
    const response = await fetchPipeClearance(
      {
        sourceRefno: input.sourceRefno,
        targetRefno: input.targetRefno,
        sourceSegment: input.sourceSegment,
        targetSegment: input.targetSegment,
        sourceInsulationMm: input.sourceInsulationMm,
        targetInsulationMm: input.targetInsulationMm,
      },
      requestOptions(options),
    );
    return pipeClearanceToRecord(response, input, now());
  }

  return Object.freeze({
    compute,
    computeComponentToWall(input, options) {
      return compute({ ...input, targetKind: 'wall' }, options);
    },
    computePointToSurface,
    computePipeToPipe,
  });
}

let defaultService: ClearanceService | null = null;

/** 进程内缺省实例（真 API）；测试用 `createClearanceService({ fetchSurfaceClearance })` 自己造。 */
export function defaultClearanceService(): ClearanceService {
  defaultService ??= createClearanceService();
  return defaultService;
}
