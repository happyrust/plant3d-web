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
  XeokitAngleMeasurementRecord,
  XeokitDistanceMeasurementRecord,
} from './useToolStore';

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

describe('unifiedMeasurement adapters', () => {
  describe('fromClassicMeasurement', () => {
    it('distance：保留所有字段，approximate=false，source=classic', () => {
      const rec = makeClassicDistance({ sourceAnnotationId: 'ann-1' });
      const u = fromClassicMeasurement(rec);

      expect(u.kind).toBe('distance');
      expect(u.id).toBe('cd-1');
      expect(u.origin).toBe(POINT_A);
      expect(u.source).toBe('classic');
      expect(u.approximate).toBe(false);
      expect(u.sourceAnnotationId).toBe('ann-1');
    });

    it('angle：包含 corner 字段，source=classic', () => {
      const rec = makeClassicAngle();
      const u = fromClassicMeasurement(rec);

      expect(u.kind).toBe('angle');
      if (u.kind === 'angle') {
        expect(u.corner).toBe(POINT_B);
      }
      expect(u.source).toBe('classic');
      expect(u.approximate).toBe(false);
    });
  });

  describe('fromXeokitMeasurement', () => {
    it('distance：保留 approximate，source=xeokit', () => {
      const rec = makeXeokitDistance({ approximate: true });
      const u = fromXeokitMeasurement(rec);

      expect(u.kind).toBe('distance');
      expect(u.approximate).toBe(true);
      expect(u.source).toBe('xeokit');
    });

    it('angle：approximate=false 也能正确透传', () => {
      const rec = makeXeokitAngle({ approximate: false });
      const u = fromXeokitMeasurement(rec);

      expect(u.kind).toBe('angle');
      expect(u.approximate).toBe(false);
      expect(u.source).toBe('xeokit');
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
      expect(back.origin).toBe(POINT_A);
      expect(back.target).toBe(POINT_B);
      expect(back.visible).toBe(true);
      expect(back.createdAt).toBe(1000);
      expect(back.sourceAnnotationId).toBe('ann-x');
      expect(back.sourceAnnotationType).toBe('cloud');
      expect(back.formId).toBe('form-1');
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

    it('classic → unified → xeokit 得到 approximate=false（classic 的默认值）', () => {
      const rec = makeClassicDistance();
      const u = fromClassicMeasurement(rec);
      const back = toXeokitMeasurement(u);

      expect(back.kind).toBe('distance');
      expect(back.approximate).toBe(false);
    });
  });

  describe('combineMeasurements', () => {
    it('三路空数组返回空数组', () => {
      const result = combineMeasurements([], [], []);
      expect(result).toEqual([]);
    });

    it('三路混合：合并数量正确，source 标记正确', () => {
      const classic = [makeClassicDistance({ id: 'c1' }), makeClassicAngle({ id: 'c2' })];
      const xdist = [makeXeokitDistance({ id: 'x1' })];
      const xang = [makeXeokitAngle({ id: 'x2' })];

      const result = combineMeasurements(classic, xdist, xang);

      expect(result).toHaveLength(4);
      expect(result.map((r) => r.source)).toEqual(['classic', 'classic', 'xeokit', 'xeokit']);
      expect(result.map((r) => r.id)).toEqual(['c1', 'c2', 'x1', 'x2']);
    });

    it('classic 的 approximate 保持 false，xeokit 保持其原值', () => {
      const classic = [makeClassicDistance()];
      const xdist = [makeXeokitDistance({ approximate: true })];
      const xang = [makeXeokitAngle({ approximate: false })];

      const result = combineMeasurements(classic, xdist, xang);

      expect(result[0].approximate).toBe(false);
      expect(result[1].approximate).toBe(true);
      expect(result[2].approximate).toBe(false);
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
