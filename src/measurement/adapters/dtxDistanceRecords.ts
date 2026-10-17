import type { Ref } from 'vue';

import { Vector3 } from 'three';

import type {
  AnnotationType,
  DistanceMeasurementRecord,
  MeasurementPoint,
  Vec3,
} from '@/composables/useToolStore';
import type { ComputationPoint } from '@/measurement/domain/measurementResult';
import type { DTXLayer } from '@/utils/three/dtx';

import {
  clearanceRecordId,
  createClearanceRecord,
  type ClearanceRecord,
  type ClearanceSourceAnnotation,
} from '@/clearance/domain/clearanceRecord';
import {
  sceneDirectionToDesign,
  sceneWorldToDesignMeters,
} from '@/composables/dtxDesignCoordinates';
import {
  accuracyClassForMethod,
  createComputationProvenance,
  type ComputationOperandRef,
  type ComputationProvenance,
} from '@/measurement/domain/computationProvenance';

/**
 * #58 迁移适配器：DTX 两条距离流离开「裸 classic 记录」的写法。
 *
 * - 点到面（point-to-object）仍是 Measurement，但端点带上 `designWorldPos`、
 *   provenance 写全（`point-to-triangle-mesh` / `exact-surface`），经入参里
 *   传进来的统一写入命令落库——流程里不再出现裸 `store.addMeasurement`。
 * - 构件最近点（object-to-object）进 ClearanceStore：`sampled-object` /
 *   `approximate-sampled`——种子点采样出来的最近对，永远不标精确、不标表面净距。
 *   几何坐标换算成 design-world 米（Clearance 域合同 D3）。
 */

export type DtxSourceAnnotationContext = Readonly<{ id: string; type: AnnotationType }> | null | undefined;

function toDesignWorldPoint(point: Vec3, dtxLayerRef: Ref<DTXLayer | null>): ComputationPoint {
  const design = sceneWorldToDesignMeters(new Vector3(point[0], point[1], point[2]), dtxLayerRef);
  return [design.x, design.y, design.z];
}

function operandOf(entityId: string): ComputationOperandRef {
  return { entityId, refno: entityId };
}

function annotationOf(context: DtxSourceAnnotationContext): ClearanceSourceAnnotation | null {
  if (!context?.id || !context.type) return null;
  return { id: context.id, type: context.type };
}

export type BuildDtxPointToObjectMeasurementInput = Readonly<{
  id: string;
  origin: MeasurementPoint;
  target: MeasurementPoint;
  dtxLayerRef: Ref<DTXLayer | null>;
  sourceAnnotation?: DtxSourceAnnotationContext;
  createdAt: number;
}>;

/** 点到面测量记录：Measurement 域，design-world 端点 + 完整 provenance。 */
export function buildDtxPointToObjectMeasurementRecord(
  input: BuildDtxPointToObjectMeasurementInput,
): DistanceMeasurementRecord {
  const withDesign = (point: MeasurementPoint): MeasurementPoint => ({
    ...point,
    designWorldPos: (() => {
      const design = sceneWorldToDesignMeters(
        new Vector3(point.worldPos[0], point.worldPos[1], point.worldPos[2]),
        input.dtxLayerRef,
      );
      return [design.x, design.y, design.z] as Vec3;
    })(),
  });
  const provenance: ComputationProvenance = createComputationProvenance({
    method: 'point-to-triangle-mesh',
    accuracyClass: accuracyClassForMethod('point-to-triangle-mesh'),
    coordinateSpace: 'design-world',
    source: operandOf(input.origin.entityId),
    target: operandOf(input.target.entityId),
  });
  return {
    id: input.id,
    kind: 'distance',
    origin: withDesign(input.origin),
    target: withDesign(input.target),
    visible: true,
    createdAt: input.createdAt,
    sourceAnnotationId: input.sourceAnnotation?.id,
    sourceAnnotationType: input.sourceAnnotation?.type,
    provenance,
  };
}

export type CommitDtxPointToObjectMeasurementInput = BuildDtxPointToObjectMeasurementInput & Readonly<{
  /** 统一写入命令（`useToolStore.addMeasurement` → `fromClassicMeasurement` 入统一数组）。 */
  addMeasurement: (record: DistanceMeasurementRecord) => void;
}>;

/** 组装 + 落库一次做完：流程只调这里，`store.addMeasurement` 不再散在流程里。 */
export function commitDtxPointToObjectMeasurement(
  input: CommitDtxPointToObjectMeasurementInput,
): DistanceMeasurementRecord {
  const record = buildDtxPointToObjectMeasurementRecord(input);
  input.addMeasurement(record);
  return record;
}

export type BuildDtxObjectToObjectClearanceInput = Readonly<{
  sourceRefno: string;
  targetRefno: string;
  /** `computeApproxNearestBetweenObjects` 的输出（场景坐标 Vec3 + 场景距离）。 */
  sourcePointScene: Vec3;
  targetPointScene: Vec3;
  dtxLayerRef: Ref<DTXLayer | null>;
  sourceAnnotation?: DtxSourceAnnotationContext;
  computedAt: Date;
}>;

/**
 * 构件最近点 → ClearanceRecord：`sampled-object` / `approximate-sampled`。
 * 距离取两点设计向量长度（场景距离经同一矩阵换算，尺度任意仿射成立）。
 */
export function buildDtxObjectToObjectClearanceRecord(
  input: BuildDtxObjectToObjectClearanceInput,
): ClearanceRecord {
  const sourcePoint = toDesignWorldPoint(input.sourcePointScene, input.dtxLayerRef);
  const targetPoint = toDesignWorldPoint(input.targetPointScene, input.dtxLayerRef);
  const designVector = sceneDirectionToDesign(
    new Vector3(input.sourcePointScene[0], input.sourcePointScene[1], input.sourcePointScene[2]),
    new Vector3(
      input.targetPointScene[0] - input.sourcePointScene[0],
      input.targetPointScene[1] - input.sourcePointScene[1],
      input.targetPointScene[2] - input.sourcePointScene[2],
    ),
    input.dtxLayerRef,
  );
  const distanceM = designVector.length();
  const inputs = {
    sourceRefno: input.sourceRefno,
    targetRefno: input.targetRefno,
    targetKind: 'any' as const,
  };
  const provenance = createComputationProvenance({
    method: 'sampled-object',
    accuracyClass: accuracyClassForMethod('sampled-object'),
    coordinateSpace: 'design-world',
    source: operandOf(input.sourceRefno),
    target: operandOf(input.targetRefno),
  });
  return createClearanceRecord({
    id: clearanceRecordId(inputs),
    kind: 'component-to-component',
    inputs,
    provenance,
    snapshot: {
      distanceM,
      intersects: distanceM <= 0,
      sourcePoint,
      targetPoint,
      vector: [designVector.x, designVector.y, designVector.z],
      sourceLeafRefno: input.sourceRefno,
      targetLeafRefno: input.targetRefno,
      targetLeafNoun: '',
      targetFace: null,
      perpendicular: null,
      witness: 'closest-points',
    },
    modelVersion: { sourceSesno: null, targetSesno: null },
    status: 'current',
    sourceAnnotation: annotationOf(input.sourceAnnotation),
    computedAt: input.computedAt.toISOString(),
  });
}

export type CommitDtxObjectToObjectClearanceInput = BuildDtxObjectToObjectClearanceInput & Readonly<{
  upsertRecord: (record: ClearanceRecord) => unknown;
}>;

/** 组装 + 写 ClearanceStore 一次做完，返回落库后的记录。 */
export function commitDtxObjectToObjectClearance(
  input: CommitDtxObjectToObjectClearanceInput,
): ClearanceRecord {
  const record = buildDtxObjectToObjectClearanceRecord(input);
  input.upsertRecord(record);
  return record;
}
