import { describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';

import { Matrix4 } from 'three';

import {
  buildDtxObjectToObjectClearanceRecord,
  buildDtxPointToObjectMeasurementRecord,
  commitDtxObjectToObjectClearance,
  commitDtxPointToObjectMeasurement,
} from './dtxDistanceRecords';

import { DTXLayer } from '@/utils/three/dtx';

function layerRefWithMatrix(matrix: Matrix4) {
  const layer = new DTXLayer({ maxVertices: 256, maxIndices: 256, maxObjects: 4 });
  vi.spyOn(layer, 'getGlobalModelMatrix').mockReturnValue(matrix);
  return shallowRef<DTXLayer | null>(layer);
}

function identityLayerRef() {
  return layerRefWithMatrix(new Matrix4());
}

describe('buildDtxPointToObjectMeasurementRecord（#58）', () => {
  it('端点补 designWorldPos、provenance 写全，标注上下文保留', () => {
    const record = buildDtxPointToObjectMeasurementRecord({
      id: 'pto-1',
      origin: { entityId: '24381_1001', worldPos: [1, 2, 3] },
      target: { entityId: '24381_1002', worldPos: [4, 2, 3] },
      dtxLayerRef: identityLayerRef(),
      sourceAnnotation: { id: 'ann-9', type: 'cloud' },
      createdAt: 42,
    });

    expect(record.kind).toBe('distance');
    expect(record.origin.designWorldPos).toEqual([1, 2, 3]);
    expect(record.target.designWorldPos).toEqual([4, 2, 3]);
    expect(record.provenance?.method).toBe('point-to-triangle-mesh');
    expect(record.provenance?.accuracyClass).toBe('exact-surface');
    expect(record.provenance?.coordinateSpace).toBe('design-world');
    expect(record.provenance?.source.entityId).toBe('24381_1001');
    expect(record.provenance?.target.entityId).toBe('24381_1002');
    expect(record.sourceAnnotationId).toBe('ann-9');
    expect(record.sourceAnnotationType).toBe('cloud');
  });

  it('commit 走传入的统一写入命令，流程里不出现裸 addMeasurement', () => {
    const addMeasurement = vi.fn();
    const record = commitDtxPointToObjectMeasurement({
      id: 'pto-2',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 0, 0] },
      dtxLayerRef: identityLayerRef(),
      createdAt: 1,
      addMeasurement,
    });
    expect(addMeasurement).toHaveBeenCalledTimes(1);
    expect(addMeasurement).toHaveBeenCalledWith(record);
  });
});

describe('buildDtxObjectToObjectClearanceRecord（#58）', () => {
  it('sampled-object / approximate-sampled，坐标与距离换成 design-world 米', () => {
    // 全局矩阵 = 平移(100,0,0) + 均匀放大 2。换算语义：逆矩阵去旋转/平移、
    // 尺度按 `setFromMatrixScale` 乘回（与 xeokit 测量同一套矩阵数学）——
    // 所以 (x-100)/2*2，距离在尺度下保持数值不变。
    const matrix = new Matrix4().makeTranslation(100, 0, 0).multiply(new Matrix4().makeScale(2, 2, 2));
    const dtxLayerRef = layerRefWithMatrix(matrix);

    const record = buildDtxObjectToObjectClearanceRecord({
      sourceRefno: '24381_1001',
      targetRefno: '24381_1002',
      sourcePointScene: [0.5, 0, 0],
      targetPointScene: [2.5, 0, 0],
      dtxLayerRef,
      sourceAnnotation: { id: 'ann-1', type: 'text' },
      computedAt: new Date('2026-10-18T00:00:00Z'),
    });

    expect(record.kind).toBe('component-to-component');
    expect(record.inputs).toEqual({ sourceRefno: '24381_1001', targetRefno: '24381_1002', targetKind: 'any' });
    expect(record.provenance.method).toBe('sampled-object');
    expect(record.provenance.accuracyClass).toBe('approximate-sampled');
    expect(record.provenance.coordinateSpace).toBe('design-world');
    // 场景点 → 设计：(0.5-100)/2*2 = -99.5；(2.5-100)/2*2 = -97.5
    expect(record.snapshot?.sourcePoint[0]).toBeCloseTo(-99.5, 6);
    expect(record.snapshot?.targetPoint[0]).toBeCloseTo(-97.5, 6);
    // 场景相距 2 单位 → 设计向量同尺度换算后长度仍为 2
    expect(record.snapshot?.distanceM).toBeCloseTo(2, 6);
    expect(record.snapshot?.intersects).toBe(false);
    expect(record.snapshot?.witness).toBe('closest-points');
    expect(record.sourceAnnotation).toEqual({ id: 'ann-1', type: 'text' });
  });

  it('输入无效（两侧同一 refno）时抛 TypeError，不产生半成品记录', () => {
    expect(() => buildDtxObjectToObjectClearanceRecord({
      sourceRefno: '24381_1001',
      targetRefno: '24381_1001',
      sourcePointScene: [0, 0, 0],
      targetPointScene: [1, 0, 0],
      dtxLayerRef: identityLayerRef(),
      computedAt: new Date(),
    })).toThrow(TypeError);
  });

  it('commit 把记录交给 ClearanceStore 的 upsertRecord', () => {
    const upsertRecord = vi.fn();
    const record = commitDtxObjectToObjectClearance({
      sourceRefno: '24381_1001',
      targetRefno: '24381_1002',
      sourcePointScene: [0, 0, 0],
      targetPointScene: [1, 0, 0],
      dtxLayerRef: identityLayerRef(),
      computedAt: new Date(),
      upsertRecord,
    });
    expect(upsertRecord).toHaveBeenCalledTimes(1);
    expect(upsertRecord).toHaveBeenCalledWith(record);
    expect(record.id).toBeTruthy();
  });
});
