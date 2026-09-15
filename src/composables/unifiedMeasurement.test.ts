import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  combineMeasurements,
  fromClassicMeasurement,
  fromXeokitMeasurement,
  isUnifiedMeasurementStoreEnabled,
  toClassicMeasurement,
  toXeokitMeasurement,
} from './unifiedMeasurement';

import type {
  AngleMeasurementRecord,
  DistanceMeasurementRecord,
  ElevationPointMeasurementRecord,
  XeokitAngleMeasurementRecord,
  XeokitDistanceMeasurementRecord,
  XeokitElevationDeltaMeasurementRecord,
  XeokitElevationPointMeasurementRecord,
} from './useToolStore';

import { createComputationProvenance } from '@/measurement/domain/computationProvenance';

const POINT_A = { entityId: 'entity-a', worldPos: [1, 2, 3] as [number, number, number] };
const POINT_B = { entityId: 'entity-b', worldPos: [4, 5, 6] as [number, number, number] };
const POINT_C = { entityId: 'entity-c', worldPos: [7, 8, 9] as [number, number, number] };

function makeClassicDistance(overrides: Partial<DistanceMeasurementRecord> = {}): DistanceMeasurementRecord {
  return {
    id: 'cd-1',
    kind: 'distance',
    origin: POINT_A,
    target: POINT_B,
    visible: true,
    createdAt: 1000,
    ...overrides,
  };
}

function makeClassicAngle(overrides: Partial<AngleMeasurementRecord> = {}): AngleMeasurementRecord {
  return {
    id: 'ca-1',
    kind: 'angle',
    origin: POINT_A,
    corner: POINT_B,
    target: POINT_C,
    visible: true,
    createdAt: 1000,
    ...overrides,
  };
}

function makeXeokitDistance(overrides: Partial<XeokitDistanceMeasurementRecord> = {}): XeokitDistanceMeasurementRecord {
  return {
    id: 'xd-1',
    kind: 'distance',
    origin: POINT_A,
    target: POINT_B,
    visible: true,
    approximate: true,
    createdAt: 2000,
    ...overrides,
  };
}

function makeXeokitAngle(overrides: Partial<XeokitAngleMeasurementRecord> = {}): XeokitAngleMeasurementRecord {
  return {
    id: 'xa-1',
    kind: 'angle',
    origin: POINT_A,
    corner: POINT_B,
    target: POINT_C,
    visible: true,
    approximate: false,
    createdAt: 2000,
    ...overrides,
  };
}

function makeClassicElevationPoint(
  overrides: Partial<ElevationPointMeasurementRecord> = {},
): ElevationPointMeasurementRecord {
  return {
    id: 'cep-1',
    kind: 'elevation_point',
    point: POINT_A,
    absoluteElevation: 12.5,
    datumElevation: 2.5,
    relativeElevation: 10,
    visible: true,
    createdAt: 1000,
    ...overrides,
  };
}

function makeXeokitElevationPoint(
  overrides: Partial<XeokitElevationPointMeasurementRecord> = {},
): XeokitElevationPointMeasurementRecord {
  return {
    id: 'xep-1',
    kind: 'elevation_point',
    point: POINT_A,
    absoluteElevation: 12.5,
    datumElevation: 2.5,
    relativeElevation: 10,
    visible: true,
    approximate: false,
    createdAt: 2000,
    ...overrides,
  };
}

function makeXeokitElevationDelta(
  overrides: Partial<XeokitElevationDeltaMeasurementRecord> = {},
): XeokitElevationDeltaMeasurementRecord {
  return {
    id: 'xed-1',
    kind: 'elevation_delta',
    origin: POINT_A,
    target: POINT_B,
    originElevation: 10,
    targetElevation: 14,
    deltaElevation: 4,
    datumElevation: 2.5,
    visible: true,
    approximate: true,
    createdAt: 2000,
    ...overrides,
  };
}

describe('unifiedMeasurement adapters', () => {
  describe('fromClassicMeasurement', () => {
    it('distance：无来源证据的 classic 记录保守迁移为 legacy-unknown', () => {
      const rec = makeClassicDistance({ sourceAnnotationId: 'ann-1' });
      const u = fromClassicMeasurement(rec);

      expect(u.kind).toBe('distance');
      expect(u.id).toBe('cd-1');
      if (u.kind === 'distance') {
        expect(u.origin).toBe(POINT_A);
      }
      expect(u.source).toBe('classic');
      expect(u.approximate).toBe(true);
      expect(u.provenance).toMatchObject({
        method: 'legacy-unknown',
        accuracyClass: 'legacy-unknown',
        coordinateSpace: 'scene-world',
        sourceModelVersion: null,
      });
      expect(u.sourceAnnotationId).toBe('ann-1');
    });

    it('angle：包含 corner 字段并显式保留未知来源', () => {
      const rec = makeClassicAngle();
      const u = fromClassicMeasurement(rec);

      expect(u.kind).toBe('angle');
      if (u.kind === 'angle') {
        expect(u.corner).toBe(POINT_B);
      }
      expect(u.source).toBe('classic');
      expect(u.approximate).toBe(true);
      expect(u.provenance.accuracyClass).toBe('legacy-unknown');
    });
  });

  describe('fromXeokitMeasurement', () => {
    it('distance：旧 approximate 布尔值不能替代来源证据', () => {
      const rec = makeXeokitDistance({ approximate: true });
      const u = fromXeokitMeasurement(rec);

      expect(u.kind).toBe('distance');
      expect(u.approximate).toBe(true);
      expect(u.source).toBe('xeokit');
      expect(u.provenance.accuracyClass).toBe('legacy-unknown');
    });

    it('angle：旧 approximate=false 也不能被推断为 exact', () => {
      const rec = makeXeokitAngle({ approximate: false });
      const u = fromXeokitMeasurement(rec);

      expect(u.kind).toBe('angle');
      expect(u.approximate).toBe(true);
      expect(u.source).toBe('xeokit');
      expect(u.provenance.accuracyClass).toBe('legacy-unknown');
    });

    it('有完整 provenance 时按 accuracyClass 派生兼容 approximate', () => {
      const provenance = createComputationProvenance({
        method: 'semantic-point-pair',
        accuracyClass: 'exact-semantic',
        coordinateSpace: 'design-world',
        sourceModelVersion: 'model-v9',
        source: { entityId: POINT_A.entityId },
        target: { entityId: POINT_B.entityId },
      });
      const u = fromXeokitMeasurement(makeXeokitDistance({
        approximate: true,
        provenance,
      }));

      expect(u.provenance).toBe(provenance);
      expect(u.approximate).toBe(false);
    });
  });

  describe('toClassicMeasurement', () => {
    it('distance：round-trip classic → unified → classic 保留 id/origin/target/visible/createdAt', () => {
      const rec = makeClassicDistance({
        sourceAnnotationId: 'ann-x',
        sourceAnnotationType: 'cloud',
        formId: 'form-1',
      });
      const u = fromClassicMeasurement(rec);
      const back = toClassicMeasurement(u);

      expect(back.kind).toBe('distance');
      expect(back.id).toBe('cd-1');
      if (back.kind === 'distance') {
        expect(back.origin).toBe(POINT_A);
        expect(back.target).toBe(POINT_B);
      }
      expect(back.visible).toBe(true);
      expect(back.createdAt).toBe(1000);
      expect(back.sourceAnnotationId).toBe('ann-x');
      expect(back.sourceAnnotationType).toBe('cloud');
      expect(back.formId).toBe('form-1');
      expect(back.provenance?.accuracyClass).toBe('legacy-unknown');
      expect('approximate' in back).toBe(false);
      expect('source' in back).toBe(false);
    });

    it('angle：round-trip classic → unified → classic 保留 corner', () => {
      const rec = makeClassicAngle();
      const u = fromClassicMeasurement(rec);
      const back = toClassicMeasurement(u);

      expect(back.kind).toBe('angle');
      if (back.kind === 'angle') {
        expect(back.corner).toBe(POINT_B);
      }
    });
  });

  describe('toXeokitMeasurement', () => {
    it('xeokit → unified → xeokit 保留 approximate', () => {
      const rec = makeXeokitDistance({ approximate: true });
      const u = fromXeokitMeasurement(rec);
      const back = toXeokitMeasurement(u);

      expect(back.kind).toBe('distance');
      expect(back.approximate).toBe(true);
    });

    it('classic → unified → xeokit 对未知旧来源保持 approximate=true', () => {
      const rec = makeClassicDistance();
      const u = fromClassicMeasurement(rec);
      const back = toXeokitMeasurement(u);

      expect(back.kind).toBe('distance');
      expect(back.approximate).toBe(true);
      expect(back.provenance?.accuracyClass).toBe('legacy-unknown');
    });

    it('angle：两线夹角的 lineAngle 标记（E3D Angle 2 Lines）往返保留，三点角没有此字段', () => {
      const lineAngle = {
        kind: 'line-plane' as const,
        angleDeg: 0,
        direction1: [1, 0, 0] as [number, number, number],
        direction2: [1, 0, 0] as [number, number, number],
        skew: false,
        inPlane: true,
        firstLabel: 'Graphics 边',
        secondLabel: 'Graphics 面（面）',
      };
      const u = fromXeokitMeasurement(makeXeokitAngle({ lineAngle }));
      expect(u.kind).toBe('angle');
      if (u.kind !== 'angle') return;
      expect(u.lineAngle).toEqual(lineAngle);
      const back = toXeokitMeasurement(u);
      expect(back.kind).toBe('angle');
      if (back.kind !== 'angle') return;
      expect(back.lineAngle).toEqual(lineAngle);

      const plain = toXeokitMeasurement(fromXeokitMeasurement(makeXeokitAngle()));
      expect(plain.kind === 'angle' && 'lineAngle' in plain).toBe(false);
    });

    it('distance：最短距离的 shortest 标记（Web 增强 d-619）往返保留，两点距离没有此字段', () => {
      const shortest = {
        kind: 'line-plane' as const,
        firstLabel: 'Graphics 边（线）',
        secondLabel: 'Graphics 面（面）',
        parallel: true,
        skew: false,
      };
      const u = fromXeokitMeasurement(makeXeokitDistance({ shortest }));
      expect(u.kind).toBe('distance');
      if (u.kind !== 'distance') return;
      expect(u.shortest).toEqual(shortest);
      const back = toXeokitMeasurement(u);
      expect(back.kind).toBe('distance');
      if (back.kind !== 'distance') return;
      expect(back.shortest).toEqual(shortest);

      const plain = toXeokitMeasurement(fromXeokitMeasurement(makeXeokitDistance()));
      expect(plain.kind === 'distance' && 'shortest' in plain).toBe(false);
    });
  });

  describe('combineMeasurements', () => {
    it('五路空数组返回空数组', () => {
      const result = combineMeasurements([], [], [], [], []);
      expect(result).toEqual([]);
    });

    it('五路混合：合并数量正确，source 标记正确', () => {
      const classic = [makeClassicDistance({ id: 'c1' }), makeClassicAngle({ id: 'c2' })];
      const xdist = [makeXeokitDistance({ id: 'x1' })];
      const xang = [makeXeokitAngle({ id: 'x2' })];
      const xelevPoint = [makeXeokitElevationPoint({ id: 'x3' })];
      const xelevDelta = [makeXeokitElevationDelta({ id: 'x4' })];

      const result = combineMeasurements(classic, xdist, xang, xelevPoint, xelevDelta);

      expect(result).toHaveLength(6);
      expect(result.map((r) => r.source)).toEqual([
        'classic', 'classic', 'xeokit', 'xeokit', 'xeokit', 'xeokit',
      ]);
      expect(result.map((r) => r.id)).toEqual(['c1', 'c2', 'x1', 'x2', 'x3', 'x4']);
    });

    /**
     * 这两路曾经被静默丢掉：`useToolStore` 加了高程 ref，`combineMeasurements`
     * 却还是三参数版本，聚合结果里根本没有高程测量。
     */
    it('高程测量必须出现在聚合结果里，不能被丢掉', () => {
      const result = combineMeasurements(
        [],
        [],
        [],
        [makeXeokitElevationPoint({ id: 'ep' })],
        [makeXeokitElevationDelta({ id: 'ed' })],
      );

      expect(result.map((r) => r.kind)).toEqual(['elevation_point', 'elevation_delta']);
      expect(result.map((r) => r.id)).toEqual(['ep', 'ed']);
    });

    it('没有 provenance 的所有旧来源都保守映射为 approximate', () => {
      const classic = [makeClassicDistance()];
      const xdist = [makeXeokitDistance({ approximate: true })];
      const xang = [makeXeokitAngle({ approximate: false })];

      const result = combineMeasurements(classic, xdist, xang, [], []);

      expect(result[0]?.approximate).toBe(true);
      expect(result[1]?.approximate).toBe(true);
      expect(result[2]?.approximate).toBe(true);
      expect(result.map((item) => item.provenance.accuracyClass)).toEqual([
        'legacy-unknown',
        'legacy-unknown',
        'legacy-unknown',
      ]);
    });
  });

  describe('高程测量转换（此前整类缺失）', () => {
    it('classic elevation_point → unified 保留三个高程标量，不再被当成 angle', () => {
      const u = fromClassicMeasurement(makeClassicElevationPoint());

      expect(u.kind).toBe('elevation_point');
      if (u.kind !== 'elevation_point') throw new Error('kind 收窄失败');
      expect(u.point).toBe(POINT_A);
      expect(u.absoluteElevation).toBe(12.5);
      expect(u.datumElevation).toBe(2.5);
      expect(u.relativeElevation).toBe(10);
      expect(u.source).toBe('classic');
      expect(u.approximate).toBe(true);
      expect(u.provenance.accuracyClass).toBe('legacy-unknown');
    });

    it('xeokit elevation_delta 往返保留业务字段并补 provenance', () => {
      const rec = makeXeokitElevationDelta();
      const back = toXeokitMeasurement(fromXeokitMeasurement(rec));

      expect(back).toMatchObject({
        ...rec,
        approximate: true,
        provenance: expect.objectContaining({ accuracyClass: 'legacy-unknown' }),
      });
    });

    it('xeokit elevation_point 往返保留业务字段且不把旧 false 当 exact', () => {
      const rec = makeXeokitElevationPoint();
      const back = toXeokitMeasurement(fromXeokitMeasurement(rec));

      expect(back).toMatchObject({
        ...rec,
        approximate: true,
        provenance: expect.objectContaining({ accuracyClass: 'legacy-unknown' }),
      });
    });

    it('taskId 在往返中保留（旧适配器只复制了三个来源字段）', () => {
      const rec = makeXeokitDistance({ formId: 'form-9', taskId: 'task-9' });
      const back = toXeokitMeasurement(fromXeokitMeasurement(rec));

      expect(back.taskId).toBe('task-9');
      expect(back.formId).toBe('form-9');
    });
  });

  describe('isUnifiedMeasurementStoreEnabled', () => {
    const memory = new Map<string, string>();
    const stubLocalStorage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => memory.clear(),
    };

    beforeEach(() => {
      memory.clear();
      vi.stubGlobal('localStorage', stubLocalStorage);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      memory.clear();
    });

    it('默认返回 false（无 localStorage 覆盖、无 env）', () => {
      expect(isUnifiedMeasurementStoreEnabled()).toBe(false);
    });

    it('localStorage=1 → true', () => {
      stubLocalStorage.setItem('measurement.unified_store', '1');
      expect(isUnifiedMeasurementStoreEnabled()).toBe(true);
    });

    it('localStorage=0 → false（显式关闭优先于默认值）', () => {
      stubLocalStorage.setItem('measurement.unified_store', '0');
      expect(isUnifiedMeasurementStoreEnabled()).toBe(false);
    });

    it('localStorage=true → true（字符串大小写不敏感）', () => {
      stubLocalStorage.setItem('measurement.unified_store', 'TRUE');
      expect(isUnifiedMeasurementStoreEnabled()).toBe(true);
    });
  });
});
