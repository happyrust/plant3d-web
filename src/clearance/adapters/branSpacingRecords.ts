import type { BranParallelRunPair, Vec3Mm } from '@/composables/branParallelSpacing';
import type { ComputationPoint } from '@/measurement/domain/measurementResult';

import {
  clearanceRecordId,
  createClearanceRecord,
  normalizeClearanceRefno,
  type ClearanceInputs,
  type ClearanceRecord,
  type ClearanceSourceAnnotation,
} from '@/clearance/domain/clearanceRecord';
import {
  accuracyClassForMethod,
  createComputationProvenance,
  type ComputationWarning,
} from '@/measurement/domain/computationProvenance';

/**
 * #63：交互式「管-管间距」（两条 BRAN 平行直段的中心距）→ ClearanceRecord。
 *
 * 每条平行直段对一条记录：record id 由 `clearanceRecordId(inputs)` 唯一决定，所以
 * `inputs` 两侧用**直段首段的 refno**（一条直段只属于一条 BRAN，首段 refno 即直段身份），
 * 两条 BRAN 的 refno 进 `provenance` 的 operand（`segmentRefno` 回指直段），
 * 与服务端 `surfaceClearanceToRecord`「entityId=对象、segmentRefno=命中叶子」同一形状。
 *
 * 方法说真话：`parallel-centerline` / `exact-centerline`——两条真实中心线轴线间的垂距是精确几何，
 * 永不标「估算」「净距」；两侧外径扣出的表面净距不在这条记录里（口径见 `branParallelSpacing.ts` 头注）。
 * 中心线坐标本来就是 E3D 世界 mm，只在边界处一次换成 design-world 米（D3）。
 */

const MM_PER_M = 1000;

function mmToM(point: Vec3Mm): ComputationPoint {
  return Object.freeze([point.x / MM_PER_M, point.y / MM_PER_M, point.z / MM_PER_M]) as ComputationPoint;
}

function runAnchorRefno(pair: BranParallelRunPair, side: 'source' | 'target'): string {
  const refno = pair[side].segments[0]?.refno?.trim() ?? '';
  if (!refno) {
    throw new TypeError(`parallel run pair ${side} run has no segment refno`);
  }
  return refno;
}

function sesnoText(sesno: number | null | undefined): string | null {
  return sesno === null || sesno === undefined ? null : `sesno:${sesno}`;
}

export type BuildBranParallelSpacingRecordInput = Readonly<{
  sourceBranRefno: string;
  targetBranRefno: string;
  pair: BranParallelRunPair;
  /** 两条中心线响应里的 `source_version.sesno`；拿不到给 null（`clearanceModelChanged` 不判不知道的一侧）。 */
  sourceSesno?: number | null;
  targetSesno?: number | null;
  /** 中心线响应自带的 warnings（已解析成 ComputationWarning）。 */
  warnings?: readonly ComputationWarning[];
  /** `store.activeAnnotationContext` 形状（`{id, type, record?}`），归一化后留 `{id, type}`。 */
  sourceAnnotation?: Readonly<{ id: string; type: string }> | null;
  computedAt: Date;
}>;

function annotationOf(
  context: Readonly<{ id: string; type: string }> | null | undefined,
): ClearanceSourceAnnotation | null {
  if (!context?.id || !context.type) return null;
  return { id: context.id, type: context.type };
}

/** 一对平行直段 → 一条 `component-to-component` 记录（`parallel-centerline` / `exact-centerline`）。 */
export function buildBranParallelSpacingRecord(
  input: BuildBranParallelSpacingRecordInput,
): ClearanceRecord {
  const sourceBranRefno = normalizeClearanceRefno(input.sourceBranRefno);
  const targetBranRefno = normalizeClearanceRefno(input.targetBranRefno);
  const sourceLeafRefno = runAnchorRefno(input.pair, 'source');
  const targetLeafRefno = runAnchorRefno(input.pair, 'target');
  const inputs: ClearanceInputs = {
    sourceRefno: sourceLeafRefno,
    targetRefno: targetLeafRefno,
    targetKind: 'any',
  };
  const pair = input.pair;
  const distanceM = pair.axisDistanceMm / MM_PER_M;
  const intersects = distanceM <= 0;
  const provenance = createComputationProvenance({
    method: 'parallel-centerline',
    accuracyClass: accuracyClassForMethod('parallel-centerline'),
    coordinateSpace: 'design-world',
    sourceModelVersion: sesnoText(input.sourceSesno) ?? sesnoText(input.targetSesno),
    source: { entityId: sourceBranRefno, refno: sourceBranRefno, segmentRefno: sourceLeafRefno },
    target: { entityId: targetBranRefno, refno: targetBranRefno, segmentRefno: targetLeafRefno },
    warnings: input.warnings ?? [],
  });
  return createClearanceRecord({
    id: clearanceRecordId(inputs),
    kind: 'component-to-component',
    inputs,
    sourceNoun: 'BRAN',
    targetNoun: 'BRAN',
    provenance,
    snapshot: {
      distanceM: intersects ? 0 : distanceM,
      intersects,
      sourcePoint: mmToM(pair.sourcePointMm),
      targetPoint: mmToM(pair.targetPointMm),
      vector: mmToM({
        x: pair.targetPointMm.x - pair.sourcePointMm.x,
        y: pair.targetPointMm.y - pair.sourcePointMm.y,
        z: pair.targetPointMm.z - pair.sourcePointMm.z,
      }),
      sourceLeafRefno,
      targetLeafRefno,
      targetLeafNoun: pair.target.segments[0]?.noun ?? '',
      targetFace: null,
      perpendicular: null,
      witness: 'closest-points',
    },
    modelVersion: {
      sourceSesno: input.sourceSesno ?? null,
      targetSesno: input.targetSesno ?? null,
    },
    status: 'current',
    sourceAnnotation: annotationOf(input.sourceAnnotation),
    computedAt: input.computedAt.toISOString(),
  });
}

export type CommitBranParallelSpacingInput = Readonly<
  Omit<BuildBranParallelSpacingRecordInput, 'pair'>
> & Readonly<{
  pairs: readonly BranParallelRunPair[];
  /** 落点：store 的 `records` / `upsertRecord` / `removeRecord`（测试可给假对象）。 */
  records: readonly ClearanceRecord[];
  upsertRecord: (record: ClearanceRecord) => unknown;
  removeRecord: (id: string) => void;
}>;

/** 这对 BRAN 上一次写出来的整组平行直段记录（点选不分先后，两个方向都认）。 */
function isSameBranPairRecord(record: ClearanceRecord, branA: string, branB: string): boolean {
  if (record.provenance.method !== 'parallel-centerline') return false;
  const source = record.provenance.source.refno;
  const target = record.provenance.target.refno;
  return (source === branA && target === branB) || (source === branB && target === branA);
}

/**
 * 整组替换语义（与退役的 `recordBranParallelSpacing` 对齐）：先把这对 BRAN 上一次的记录摘掉
 * （没平行直段了就清空），再逐对写入。返回这次写入的记录。
 */
export function commitBranParallelSpacing(
  input: CommitBranParallelSpacingInput,
): ClearanceRecord[] {
  const branA = normalizeClearanceRefno(input.sourceBranRefno);
  const branB = normalizeClearanceRefno(input.targetBranRefno);
  // 先收齐再摘——`removeRecord` 可能就地改 `records`，边遍历边删会跳项。
  const staleIds = input.records
    .filter((record) => isSameBranPairRecord(record, branA, branB))
    .map((record) => record.id);
  for (const id of staleIds) input.removeRecord(id);
  const created = input.pairs.map((pair) =>
    buildBranParallelSpacingRecord({
      sourceBranRefno: branA,
      targetBranRefno: branB,
      pair,
      sourceSesno: input.sourceSesno,
      targetSesno: input.targetSesno,
      warnings: input.warnings,
      sourceAnnotation: input.sourceAnnotation ?? null,
      computedAt: input.computedAt,
    }),
  );
  for (const record of created) input.upsertRecord(record);
  return created;
}
