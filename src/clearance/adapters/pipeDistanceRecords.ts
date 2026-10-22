import type { PipeDistanceResult } from '@/composables/usePipeDistanceStore';
import type { ComputationPoint } from '@/measurement/domain/measurementResult';
import type { Vec3 } from '@/types/vec3';

import {
  clearanceRecordId,
  createClearanceRecord,
  normalizeClearanceRefno,
  type ClearanceInputs,
  type ClearanceRecord,
} from '@/clearance/domain/clearanceRecord';
import {
  accuracyClassForMethod,
  createComputationProvenance,
  type ComputationWarning,
} from '@/measurement/domain/computationProvenance';

/**
 * #64：批量管间净距（PipeDistanceDrawer）→ ClearanceRecord。
 *
 * 批量与交互同一份身份：`inputs = {source, target, 'any'}`，同 id 同一条记录，
 * 抽屉的隐藏 / 选择 / stale / 持久化语义与 ClearanceStore 完全一致，不再持有第二份结果真相。
 * 坐标只在边界处换算一次：`PipeDistanceResult.designPoints` 是 E3D 世界 mm，进记录转 design-world 米（D3）。
 * - `surface`（服务端 surface_to_surface）→ `surface-to-surface` / `exact-surface`
 * - `axis-estimate`（本地网格拟合轴线的中心距兜底）→ `pca-axis` / `approximate-axis`，
 *   附 `axis_fit_estimate` 警告——永远不得标成外表面净距（验收口径见 usePipeDistanceStore 注释）。
 */

const MM_PER_M = 1000;

export function mmPointToM(point: Vec3): ComputationPoint {
  return Object.freeze([point[0] / MM_PER_M, point[1] / MM_PER_M, point[2] / MM_PER_M]) as ComputationPoint;
}

/** 批量管间净距的记录域：BRAN↔BRAN 的 component-to-component 记录（墙/柱与点选构件净距不在此列）。 */
export function isPipeClearanceRecord(record: ClearanceRecord): boolean {
  return record.kind === 'component-to-component'
    && record.sourceNoun === 'BRAN'
    && record.targetNoun === 'BRAN'
    && record.inputs.targetKind === 'any';
}

export function pipeDistanceInputs(sourceRefno: string, targetRefno: string): ClearanceInputs {
  return {
    sourceRefno: normalizeClearanceRefno(sourceRefno),
    targetRefno: normalizeClearanceRefno(targetRefno),
    targetKind: 'any',
  };
}

export const AXIS_ESTIMATE_WARNING: ComputationWarning = Object.freeze({
  code: 'axis_fit_estimate',
  message: '模型拟合中心距估算，非外表面净距，不能用作净距验收',
});

function sesnoText(sesno: number | null | undefined): string | null {
  return sesno === null || sesno === undefined ? null : `sesno:${sesno}`;
}

/**
 * `PipeDistanceResult`（含旧快照里 legacy 形状的一条结果）→ ClearanceRecord。
 * `designPoints` 必须存在——没有世界毫米坐标的结果本来就不该被持久化（旧 store 保存时也拒收）。
 */
export function pipeDistanceResultToClearanceRecord(
  result: PipeDistanceResult,
  computedAt: Date,
): ClearanceRecord {
  const designPoints = result.designPoints;
  if (!designPoints) {
    throw new TypeError(`pipe distance result ${result.id} has no design points`);
  }
  const inputs = pipeDistanceInputs(result.pipeA, result.pipeB);
  const axisEstimate = result.measurementKind === 'axis-estimate';
  const method = axisEstimate ? 'pca-axis' as const : 'surface-to-surface' as const;
  const sourceSesno = result.modelVersion?.sourceSesno ?? null;
  const targetSesno = result.modelVersion?.targetSesno ?? null;
  const provenance = createComputationProvenance({
    method,
    accuracyClass: accuracyClassForMethod(method),
    coordinateSpace: 'design-world',
    sourceModelVersion: sesnoText(sourceSesno) ?? sesnoText(targetSesno),
    source: { entityId: inputs.sourceRefno, refno: inputs.sourceRefno },
    target: { entityId: inputs.targetRefno, refno: inputs.targetRefno },
    warnings: axisEstimate ? [AXIS_ESTIMATE_WARNING] : [],
  });
  const start = mmPointToM(designPoints.start);
  const end = mmPointToM(designPoints.end);
  return createClearanceRecord({
    id: clearanceRecordId(inputs),
    kind: 'component-to-component',
    inputs,
    sourceNoun: 'BRAN',
    targetNoun: 'BRAN',
    provenance,
    snapshot: {
      distanceM: result.distance / MM_PER_M,
      intersects: result.distance <= 0,
      sourcePoint: start,
      targetPoint: end,
      vector: [end[0] - start[0], end[1] - start[1], end[2] - start[2]],
      sourceLeafRefno: inputs.sourceRefno,
      targetLeafRefno: inputs.targetRefno,
      targetLeafNoun: 'BRAN',
      targetFace: null,
      perpendicular: null,
      witness: 'closest-points',
    },
    modelVersion: { sourceSesno, targetSesno },
    status: result.status === 'stale' ? 'stale' : 'current',
    computedAt: computedAt.toISOString(),
  });
}

/** 叶子构件类型的叫法（列表悬停「最近处」用）；没列到的照写类型码。 */
const LEAF_NOUN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  TUBI: '直管', BEND: '弯管', ELBO: '弯头', TEE: '三通', OLET: '支管台', CROS: '四通', REDU: '异径管', VALV: '阀门',
  FLAN: '法兰', GASK: '垫片', WELD: '焊缝', CAP: '管帽', COUP: '管箍', FBLI: '盲板', INST: '仪表',
});

/**
 * 外表面净距的最近处（相交时是相交处）落在两侧哪个构件上：服务端给了两侧命中的叶子，隐式直管的叶子就是 BRAN 本身。
 * 源侧只有 refno，类型由 `nounOf` 查。没有服务端叶子可说的记录（网格拟合估算、旧版快照迁来的）给空串。
 */
export function pipeClearanceLeavesText(record: ClearanceRecord, nounOf: (refno: string) => string | null | undefined): string {
  const snapshot = record.snapshot;
  if (!snapshot || record.provenance.method !== 'surface-to-surface' || snapshot.targetLeafNoun === 'BRAN') return '';
  const leaf = (refno: string, owner: string, noun: string | null) => {
    if (normalizeClearanceRefno(refno) === normalizeClearanceRefno(owner)) return '直管';
    const code = String(noun || nounOf(refno) || '').toUpperCase();
    return code ? `${LEAF_NOUN_LABELS[code] ?? code} ${refno}` : refno;
  };
  const source = leaf(snapshot.sourceLeafRefno, record.inputs.sourceRefno, null);
  const target = leaf(snapshot.targetLeafRefno, record.inputs.targetRefno, snapshot.targetLeafNoun);
  return `${snapshot.intersects ? '相交处' : '最近处'}：${source} ↔ ${target}`;
}
