import type { PipeRowGroup, PipeRowPair } from '@/clearance/domain/pipeRowGeometry';
import type { ClearanceRecordPipeRow, PipeRowAlignMode, PipeRowMetric } from '@/clearance/domain/pipeRowTypes';
import type { Vec3Mm } from '@/composables/branParallelSpacing';
import type { ComputationPoint } from '@/measurement/domain/measurementResult';

import {
  createClearanceRecord,
  normalizeClearanceRefno,
  withClearanceStatus,
  type ClearanceRecord,
  type ClearanceSourceAnnotation,
} from '@/clearance/domain/clearanceRecord';
import { formatAxialMm, isFormalPipeRowGroup } from '@/clearance/domain/pipeRowGeometry';
import { pipeRowGapEstimated } from '@/clearance/domain/pipeRowTypes';
import {
  accuracyClassForMethod,
  createComputationProvenance,
  type ComputationWarning,
} from '@/measurement/domain/computationProvenance';

/**
 * 连排相邻测量 → ClearanceRecord（`docs/plans/2026-10-19-pipe-row-adjacent-measurement-plan.md` §7）。
 *
 * 身份（§7.2）：`piperow:<模式>:<度量>:<无序锚点对>@<共同区段>`——
 * - 与交互式平行直段测量的 `clearance:<segA>:<segB>` 命名空间隔离，同一对直段两种来源互不覆盖；
 * - 锚点排序使对调 A/B 仍是同一条记录；区段进 id 使同一对管在不同弯折区段的多条测量并存；
 * - 「截面中心距」与「外径推导间隔」是两条独立记录，各自携带方法、证据与状态。
 *
 * 口径：几何模块给 mm（E3D 世界），只在边界一次换成 design-world 米（D3）。
 * `derived-gap` 的 `signedGapMm` 不超过名义接触容差（名义接触 / 包络重叠）或缺可靠外径时 `snapshot: null`——
 * 不伪造可画的表面端点、不滥用 `intersects`；有符号真值留在 `pipeRow.signedGapM`。
 */

const MM_PER_M = 1000;

/**
 * 名义接触的显示容差（mm）：|G| 不超过它就按「名义接触」呈现、不画尺寸线，列表与三维同一口径。
 * 只是显示口径，不是工程合格阈值（plan §4.2）。
 */
export const PIPE_ROW_NOMINAL_CONTACT_TOLERANCE_MM = 0.5;

function mmPointToM(point: Vec3Mm): ComputationPoint {
  return Object.freeze([point.x / MM_PER_M, point.y / MM_PER_M, point.z / MM_PER_M]) as ComputationPoint;
}

export function pipeRowRecordId(
  alignMode: PipeRowAlignMode,
  metric: PipeRowMetric,
  anchorA: string,
  anchorB: string,
  section: { axialStartMm: number; axialEndMm: number },
): string {
  const [a, b] = [anchorA, anchorB].sort();
  return `piperow:${alignMode}:${metric}:${a}:${b}@${formatAxialMm(section.axialStartMm)}-${formatAxialMm(section.axialEndMm)}`;
}

// 下面三条只出现在人工确认后生成的记录上：检测时带这些判定的排不出正式记录（§4.2 / §5.5 / §5.7）。
export const PIPE_ROW_AMBIGUOUS_WARNING: ComputationWarning = Object.freeze({
  code: 'pipe_row_ambiguous',
  message: '识别时存在同等合理的其他分组、排序沿区段不稳定或退化（共轴 / 仅凭两点成排），本排经人工确认后生成',
});
export const PIPE_ROW_INCOMPLETE_WARNING: ComputationWarning = Object.freeze({
  code: 'pipe_row_incomplete',
  message: '识别时同截面有成员缺可靠外径未能归排，分组完整性不可证，本排经人工确认后生成',
});
export const PIPE_ROW_ESTIMATED_GROUPING_WARNING: ComputationWarning = Object.freeze({
  code: 'pipe_row_estimated_grouping',
  message: '管底归排依据含估算外径，底点位置为估算，本排经人工确认后生成',
});
export const PIPE_ROW_OD_ESTIMATE_WARNING: ComputationWarning = Object.freeze({
  code: 'pipe_row_od_estimate',
  message: '至少一侧外径为孔径估算，推导间隔为估算值',
});
export const PIPE_ROW_OD_LEGACY_WARNING: ComputationWarning = Object.freeze({
  code: 'pipe_row_od_legacy',
  message: '至少一侧外径取自旧服务端成员外径（目录外径或通径估算，接口未标来源），推导间隔为估算值',
});
export const PIPE_ROW_OD_MISSING_WARNING: ComputationWarning = Object.freeze({
  code: 'pipe_row_od_missing',
  message: '缺少可靠外径，推导间隔不可得',
});
/** 直段含弯头/变径以外的成员（同轴阀、法兰）：推导间隔按管身外径模型算，构件外廓不在模型内。 */
export const PIPE_ROW_NON_PIPE_MEMBER_WARNING: ComputationWarning = Object.freeze({
  code: 'pipe_row_non_pipe_member',
  message: '直段内混有同轴阀 / 法兰等构件，推导间隔按管身外径推导，构件外廓不在模型内',
});

const IMPLICIT_NOUN = 'TUBI';

function hasNonPipeMembers(pair: PipeRowPair): boolean {
  return [pair.source, pair.target].some(member =>
    member.run.segments.some(segment => {
      const noun = String(segment.noun || '').trim().toUpperCase();
      return !segment.implicit && noun !== IMPLICIT_NOUN;
    }));
}

export type BuildPipeRowRecordsOptions = Readonly<{
  /** BRAN refno → 该 BRAN 中心线响应的 `source_version.sesno`；拿不到给 null */
  sesnoByBran: Readonly<Record<string, number | null>>;
  sourceAnnotation?: Readonly<{ id: string; type: string }> | null;
  computedAt: Date;
}>;

function annotationOf(
  context: Readonly<{ id: string; type: string }> | null | undefined,
): ClearanceSourceAnnotation | null {
  return context?.id && context.type ? { id: context.id, type: context.type } : null;
}

function pipeRowExtension(
  group: PipeRowGroup,
  pair: PipeRowPair,
  metric: PipeRowMetric,
): ClearanceRecordPipeRow {
  const section = pair.section;
  const sideOd = (member: PipeRowPair['source']) => ({
    odM: member.odMm === null ? null : member.odMm / MM_PER_M,
    evidence: member.odEvidence,
  });
  return {
    alignMode: group.alignMode,
    metric,
    signedGapM: metric === 'derived-gap' && pair.signedGapMm !== null ? pair.signedGapMm / MM_PER_M : null,
    section: {
      point: mmPointToM(section.origin),
      // 法向是单位方向，没有单位量纲，不做 mm→m 换算
      normal: Object.freeze([section.axisDirection.x, section.axisDirection.y, section.axisDirection.z]) as ComputationPoint,
      axialStartM: section.axialStartMm / MM_PER_M,
      axialEndM: section.axialEndMm / MM_PER_M,
    },
    rowGroupId: group.key,
    sourceOd: sideOd(pair.source),
    targetOd: sideOd(pair.target),
  };
}

function pairWarnings(group: PipeRowGroup, pair: PipeRowPair, metric: PipeRowMetric): ComputationWarning[] {
  const warnings: ComputationWarning[] = [];
  if (group.ambiguous) warnings.push(PIPE_ROW_AMBIGUOUS_WARNING);
  if (group.incomplete) warnings.push(PIPE_ROW_INCOMPLETE_WARNING);
  if (group.estimatedGrouping) warnings.push(PIPE_ROW_ESTIMATED_GROUPING_WARNING);
  if (metric === 'derived-gap') {
    const evidences = [pair.source.odEvidence, pair.target.odEvidence];
    if (pair.signedGapMm === null) {
      warnings.push(PIPE_ROW_OD_MISSING_WARNING);
    } else {
      if (evidences.includes('bore-estimate')) warnings.push(PIPE_ROW_OD_ESTIMATE_WARNING);
      if (evidences.includes('legacy-member')) warnings.push(PIPE_ROW_OD_LEGACY_WARNING);
    }
    if (hasNonPipeMembers(pair)) warnings.push(PIPE_ROW_NON_PIPE_MEMBER_WARNING);
  }
  return warnings;
}

/** 一对相邻管 → 「截面中心距」记录；快照端点是两条真实轴线与截面的交点。 */
function buildCenterDistanceRecord(
  group: PipeRowGroup,
  pair: PipeRowPair,
  options: BuildPipeRowRecordsOptions,
): ClearanceRecord {
  const metric = 'center-distance' as const;
  const sourceAnchor = pair.source.anchorRefno;
  const targetAnchor = pair.target.anchorRefno;
  const start = mmPointToM(pair.source.centerMm);
  const end = mmPointToM(pair.target.centerMm);
  return createClearanceRecord({
    id: pipeRowRecordId(group.alignMode, metric, sourceAnchor, targetAnchor, pair.section),
    kind: 'component-to-component',
    inputs: { sourceRefno: normalizeClearanceRefno(sourceAnchor), targetRefno: normalizeClearanceRefno(targetAnchor), targetKind: 'any' },
    sourceNoun: 'BRAN',
    targetNoun: 'BRAN',
    provenance: createComputationProvenance({
      method: 'pipe-row-center-distance',
      accuracyClass: accuracyClassForMethod('pipe-row-center-distance'),
      coordinateSpace: 'design-world',
      sourceModelVersion: sesnoText(options.sesnoByBran[pair.source.branRefno]) ?? sesnoText(options.sesnoByBran[pair.target.branRefno]),
      source: { entityId: pair.source.branRefno, refno: pair.source.branRefno, segmentRefno: sourceAnchor },
      target: { entityId: pair.target.branRefno, refno: pair.target.branRefno, segmentRefno: targetAnchor },
      warnings: pairWarnings(group, pair, metric),
    }),
    snapshot: {
      distanceM: pair.centerDistanceMm / MM_PER_M,
      intersects: false,
      sourcePoint: start,
      targetPoint: end,
      vector: mmPointToM(subVec(pair.target.centerMm, pair.source.centerMm)),
      sourceLeafRefno: sourceAnchor,
      targetLeafRefno: targetAnchor,
      targetLeafNoun: pair.target.run.segments[0]?.noun ?? '',
      targetFace: null,
      perpendicular: null,
      witness: 'closest-points',
    },
    pipeRow: pipeRowExtension(group, pair, metric),
    modelVersion: {
      sourceSesno: options.sesnoByBran[pair.source.branRefno] ?? null,
      targetSesno: options.sesnoByBran[pair.target.branRefno] ?? null,
    },
    status: 'current',
    sourceAnnotation: annotationOf(options.sourceAnnotation),
    computedAt: options.computedAt.toISOString(),
  });
}

/**
 * 一对相邻管 → 「外径推导间隔」记录。G 超过名义接触容差时快照端点是平行圆柱模型的名义表面点
 * （截面内沿 C_i→C_j 方向各缩半径）；名义接触 / 名义重叠 / 缺证据 → `snapshot: null`，有符号值在 `pipeRow.signedGapM`。
 */
function buildDerivedGapRecord(
  group: PipeRowGroup,
  pair: PipeRowPair,
  options: BuildPipeRowRecordsOptions,
): ClearanceRecord {
  const metric = 'derived-gap' as const;
  const sourceAnchor = pair.source.anchorRefno;
  const targetAnchor = pair.target.anchorRefno;
  const gapMm = pair.signedGapMm;

  let snapshot = null;
  if (gapMm !== null && gapMm > PIPE_ROW_NOMINAL_CONTACT_TOLERANCE_MM) {
    const centerDelta = subVec(pair.target.centerMm, pair.source.centerMm);
    const centerDistance = lengthVec(centerDelta);
    // gapMm > 0 ⇒ 两中心点必然不重合（D_cc > (OD_i+OD_j)/2 > 0），方向可求
    const unit = scaleVec(centerDelta, 1 / centerDistance);
    const sourceRadius = (pair.source.odMm ?? 0) / 2;
    const targetRadius = (pair.target.odMm ?? 0) / 2;
    const surfaceA = addVec(pair.source.centerMm, scaleVec(unit, sourceRadius));
    const surfaceB = subVec(pair.target.centerMm, scaleVec(unit, targetRadius));
    const start = mmPointToM(surfaceA);
    const end = mmPointToM(surfaceB);
    snapshot = {
      distanceM: gapMm / MM_PER_M,
      intersects: false,
      sourcePoint: start,
      targetPoint: end,
      vector: mmPointToM(subVec(surfaceB, surfaceA)),
      sourceLeafRefno: sourceAnchor,
      targetLeafRefno: targetAnchor,
      targetLeafNoun: pair.target.run.segments[0]?.noun ?? '',
      targetFace: null,
      perpendicular: null,
      witness: 'closest-points' as const,
    };
  }

  return createClearanceRecord({
    id: pipeRowRecordId(group.alignMode, metric, sourceAnchor, targetAnchor, pair.section),
    kind: 'component-to-component',
    inputs: { sourceRefno: normalizeClearanceRefno(sourceAnchor), targetRefno: normalizeClearanceRefno(targetAnchor), targetKind: 'any' },
    sourceNoun: 'BRAN',
    targetNoun: 'BRAN',
    provenance: createComputationProvenance({
      method: 'pipe-row-derived-gap',
      accuracyClass: accuracyClassForMethod('pipe-row-derived-gap'),
      coordinateSpace: 'design-world',
      sourceModelVersion: sesnoText(options.sesnoByBran[pair.source.branRefno]) ?? sesnoText(options.sesnoByBran[pair.target.branRefno]),
      source: { entityId: pair.source.branRefno, refno: pair.source.branRefno, segmentRefno: sourceAnchor },
      target: { entityId: pair.target.branRefno, refno: pair.target.branRefno, segmentRefno: targetAnchor },
      warnings: pairWarnings(group, pair, metric),
    }),
    snapshot,
    pipeRow: pipeRowExtension(group, pair, metric),
    modelVersion: {
      sourceSesno: options.sesnoByBran[pair.source.branRefno] ?? null,
      targetSesno: options.sesnoByBran[pair.target.branRefno] ?? null,
    },
    status: 'current',
    sourceAnnotation: annotationOf(options.sourceAnnotation),
    computedAt: options.computedAt.toISOString(),
  });
}

function sesnoText(sesno: number | null | undefined): string | null {
  return sesno === null || sesno === undefined ? null : `sesno:${sesno}`;
}

function subVec(a: Vec3Mm, b: Vec3Mm): Vec3Mm {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function addVec(a: Vec3Mm, b: Vec3Mm): Vec3Mm {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scaleVec(a: Vec3Mm, s: number): Vec3Mm {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function lengthVec(a: Vec3Mm): number {
  return Math.hypot(a.x, a.y, a.z);
}

/** 一条排的全部相邻对 → 每对两条记录（中心距 + 推导间隔）。 */
export function buildPipeRowGroupRecords(
  group: PipeRowGroup,
  options: BuildPipeRowRecordsOptions,
): ClearanceRecord[] {
  return group.pairs.flatMap(pair => [
    buildCenterDistanceRecord(group, pair, options),
    buildDerivedGapRecord(group, pair, options),
  ]);
}

/** 整条记录里属于连排测量域的判定：有 `pipeRow` 扩展即是。 */
export function isPipeRowRecord(record: ClearanceRecord): boolean {
  return record.pipeRow != null;
}

function formatMm(mm: number): string {
  return mm < 10 ? mm.toFixed(1) : String(Math.round(mm));
}

/**
 * 连排记录的数值文字（带单位；连排抽屉与通用记录列表共用）：中心距照实；推导间隔按有符号名义值说
 * 「名义接触 / 名义重叠 / 间隔」，缺外径如实说缺，估算外径推出的间隔带 `≈`。口径名由调用方用方法标签另行显示。
 */
export function pipeRowValueText(record: ClearanceRecord): string {
  const pipeRow = record.pipeRow;
  if (!pipeRow) return '';
  if (pipeRow.metric === 'center-distance') {
    return record.snapshot ? `${formatMm(record.snapshot.distanceM * MM_PER_M)} mm` : '—';
  }
  if (pipeRow.signedGapM === null) return '缺外径';
  const approximate = pipeRowGapEstimated(pipeRow) ? '≈' : '';
  const gapMm = pipeRow.signedGapM * MM_PER_M;
  if (Math.abs(gapMm) <= PIPE_ROW_NOMINAL_CONTACT_TOLERANCE_MM) return `${approximate}名义接触`;
  return gapMm < 0 ? `${approximate}名义重叠 ${formatMm(-gapMm)} mm` : `${approximate}${formatMm(gapMm)} mm`;
}

/**
 * 整组提交（§7.4）：先构造、后验证、再一次提交——新记录全部构造完才动库（构造抛错时库里一条没动），
 * 再摘「同一次检测覆盖到的锚点集合」范围内的旧连排记录（同 alignMode）、写入新记录；
 * 范围外的旧记录与其他测量结果不动。取消 / 失败的中途分支由调用方在收到结果前就 return。
 *
 * 只有分组可证的排出正式记录（§5.5 / §5.7）：多解或分组不完整的排不出记录，成员上的旧记录也不摘——
 * 本次没能确认它们，不等于确认了它们不再相邻——改标 `stale`，等人工确认。
 */
export type CommitPipeRowDetectionInput = Readonly<{
  groups: readonly PipeRowGroup[];
  /** 本次检测实际覆盖的直段锚点集合（检测零结果时同样生效：范围内的旧连排记录被摘除） */
  anchorScope: readonly string[];
  alignMode: PipeRowAlignMode;
  records: readonly ClearanceRecord[];
  upsertRecord: (record: ClearanceRecord) => unknown;
  removeRecord: (id: string) => void;
  options: BuildPipeRowRecordsOptions;
}>;

export function commitPipeRowDetection(input: CommitPipeRowDetectionInput): ClearanceRecord[] {
  const created = input.groups
    .filter(isFormalPipeRowGroup)
    .flatMap(group => buildPipeRowGroupRecords(group, input.options));
  const createdIds = new Set(created.map(record => record.id));
  const heldAnchors = new Set(input.groups
    .filter(group => !isFormalPipeRowGroup(group))
    .flatMap(group => group.members.map(member => normalizeClearanceRefno(member.anchorRefno))));
  const isHeld = (record: ClearanceRecord) =>
    heldAnchors.has(record.inputs.sourceRefno) || heldAnchors.has(record.inputs.targetRefno);

  const anchors = new Set(input.anchorScope.map(normalizeClearanceRefno));
  const inScope = input.records.filter(record => isPipeRowRecord(record)
    && record.pipeRow?.alignMode === input.alignMode
    && anchors.has(record.inputs.sourceRefno)
    && anchors.has(record.inputs.targetRefno));
  const removedIds = inScope.filter(record => !isHeld(record)).map(record => record.id);
  const unconfirmed = inScope
    .filter(record => isHeld(record) && !createdIds.has(record.id) && record.status !== 'stale')
    .map(record => withClearanceStatus(record, 'stale'));

  for (const id of removedIds) input.removeRecord(id);
  for (const record of created) input.upsertRecord(record);
  for (const record of unconfirmed) input.upsertRecord(record);
  return created;
}

/**
 * 预览里人工确认一排待定的排（§8 第 4 点）：按与正式排同一构造生成记录，识别时的判定警告随记录保留。
 * 检测时给这排成员留着的 `stale` 旧连排记录（同模式、两侧都在本排、这次没有重建）一并摘掉——确认即替换。
 */
export type ConfirmPipeRowGroupInput = Readonly<{
  group: PipeRowGroup;
  records: readonly ClearanceRecord[];
  upsertRecord: (record: ClearanceRecord) => unknown;
  removeRecord: (id: string) => void;
  options: BuildPipeRowRecordsOptions;
}>;

export function confirmPipeRowGroup(input: ConfirmPipeRowGroupInput): ClearanceRecord[] {
  const created = buildPipeRowGroupRecords(input.group, input.options);
  const createdIds = new Set(created.map(record => record.id));
  const members = new Set(input.group.members.map(member => normalizeClearanceRefno(member.anchorRefno)));
  const superseded = input.records.filter(record => isPipeRowRecord(record)
    && record.pipeRow?.alignMode === input.group.alignMode
    && record.status === 'stale'
    && !createdIds.has(record.id)
    && members.has(record.inputs.sourceRefno)
    && members.has(record.inputs.targetRefno));
  for (const record of superseded) input.removeRecord(record.id);
  for (const record of created) input.upsertRecord(record);
  return created;
}
