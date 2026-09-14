import { describe, expect, it } from 'vitest';

import {
  compareRegionSource,
  deriveLegacyObbRegion,
  fillBoxAnnotationRegionDefault,
  reconcileMembersRegion,
  regionAabb,
  regionCoversMembers,
  regionMemberRefnos,
  type ObbSnapshot,
  type RegionV1,
} from './cloudRegion';

/** P3 共享范围体（方案 §7 / §8）纯函数验收：旧 obb 按保存的盒恢复、成员覆盖判定、重绑原子调和、兼容 AABB、来源比对 */

const nullSource = { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null };

function box(id: string, memberRefno: string | null, center: [number, number, number] = [0, 0, 0]): ObbSnapshot {
  return { id, memberRefno, center, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [1, 1, 1] };
}

function membersRegion(boxes: ObbSnapshot[]): RegionV1 {
  return { version: 1, space: 'world', source: nullSource, origin: 'members', kind: 'obb-union', boxes };
}

describe('deriveLegacyObbRegion / fillBoxAnnotationRegionDefault', () => {
  const legacyObb = { center: [1, 2, 3], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [2, 1, 0.5], corners: [] };

  it('旧 obb → legacy-snapshot，按保存的 center / axes / halfSize 原样恢复，来源全 null，不带成员', () => {
    const region = deriveLegacyObbRegion(legacyObb);
    expect(region).toMatchObject({ version: 1, space: 'world', origin: 'legacy-snapshot', kind: 'obb-union', source: nullSource });
    const boxes = (region as Extract<RegionV1, { kind: 'obb-union' }>).boxes;
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toEqual({ id: 'legacy-snapshot:0', memberRefno: null, center: [1, 2, 3], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [2, 1, 0.5] });
  });

  it('非法 obb（非有限 / 半边长负 / 轴缺）→ null', () => {
    expect(deriveLegacyObbRegion(null)).toBeNull();
    expect(deriveLegacyObbRegion({ ...legacyObb, center: [Number.NaN, 0, 0] })).toBeNull();
    expect(deriveLegacyObbRegion({ ...legacyObb, halfSize: [-1, 1, 1] })).toBeNull();
    expect(deriveLegacyObbRegion({ ...legacyObb, axes: [[1, 0, 0], [0, 1, 0]] })).toBeNull();
  });

  it('漏斗：缺失才补；显式 null 保留；幂等且不改输入', () => {
    const rec = { id: 'r', obb: legacyObb };
    const once = fillBoxAnnotationRegionDefault(rec);
    expect(once.regionV1?.origin).toBe('legacy-snapshot');
    expect('regionV1' in rec).toBe(false);
    expect(fillBoxAnnotationRegionDefault(once)).toEqual(once);
    expect(fillBoxAnnotationRegionDefault({ id: 'r', obb: legacyObb, regionV1: null }).regionV1).toBeNull();
    const kept = membersRegion([box('a', 'x')]);
    expect(fillBoxAnnotationRegionDefault({ id: 'r', obb: legacyObb, regionV1: kept }).regionV1).toBe(kept);
  });
});

describe('regionCoversMembers / regionMemberRefnos', () => {
  it('members 来源：每个成员至少一个盒才算覆盖；两种 refno 写法等价', () => {
    const region = membersRegion([box('a', '24381_1'), box('b', '24381_1'), box('c', '=24381/2')]);
    expect(regionMemberRefnos(region)).toEqual(['24381_1', '=24381/2']);
    expect(regionCoversMembers(region, ['24381_1', '24381_2'])).toBe(true);
    expect(regionCoversMembers(region, ['=24381/1'])).toBe(true);
    expect(regionCoversMembers(region, ['24381_1', '24381_3'])).toBe(false);
  });

  it('legacy-snapshot / user-volume 不按成员覆盖承诺，一律 true；空范围 true', () => {
    const legacy: RegionV1 = { ...membersRegion([box('l', null)]), origin: 'legacy-snapshot' };
    expect(regionCoversMembers(legacy, ['24381_1', '24381_2'])).toBe(true);
    expect(regionCoversMembers(null, ['24381_1'])).toBe(true);
  });
});

describe('reconcileMembersRegion · 重绑 member 的原子调和', () => {
  const region = membersRegion([box('a1', 'A', [0, 0, 0]), box('a2', 'A', [1, 0, 0]), box('b1', 'B', [5, 0, 0])]);

  it('移除成员：删掉它的全部盒；其余原样', () => {
    const out = reconcileMembersRegion(region, ['B'], () => null);
    expect(out.changed).toBe(true);
    expect(out.missing).toEqual([]);
    expect((out.region as Extract<RegionV1, { kind: 'obb-union' }>).boxes.map((b) => b.id)).toEqual(['b1']);
  });

  it('新增成员：由 resolveBoxes 补盒（memberRefno 缺省补成该成员）', () => {
    const out = reconcileMembersRegion(region, ['A', 'B', 'C'], (refno) => (refno === 'C' ? [box('c1', null, [9, 0, 0])] : null));
    expect(out.changed).toBe(true);
    expect(out.missing).toEqual([]);
    const boxes = (out.region as Extract<RegionV1, { kind: 'obb-union' }>).boxes;
    expect(boxes.map((b) => b.id)).toEqual(['a1', 'a2', 'b1', 'c1']);
    expect(boxes[3]!.memberRefno).toBe('C');
  });

  it('新增成员拿不到几何：记进 missing，范围里没有它的盒（不用子集冒充完整）；其它成员不受影响', () => {
    const out = reconcileMembersRegion(region, ['A', 'B', 'D'], () => null);
    expect(out.changed).toBe(false);
    expect(out.missing).toEqual(['D']);
    expect(out.region).toBe(region);
    expect(regionCoversMembers(out.region, ['A', 'B', 'D'])).toBe(false);
  });

  it('成员集合不变：不改引用；非 members 来源一律不动', () => {
    const same = reconcileMembersRegion(region, ['A', 'B'], () => [box('zzz', null)]);
    expect(same.changed).toBe(false);
    expect(same.region).toBe(region);
    const legacy: RegionV1 = { ...region, origin: 'legacy-snapshot' };
    expect(reconcileMembersRegion(legacy, ['Q'], () => null)).toEqual({ region: legacy, missing: [], changed: false });
  });
});

describe('regionAabb', () => {
  it('旋转盒的世界 AABB 用 Σ|axis·e|·half 算，多盒取并集', () => {
    const rotated: ObbSnapshot = {
      id: 'r', memberRefno: 'A', center: [10, 0, 0],
      axes: [[Math.SQRT1_2, Math.SQRT1_2, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], [0, 0, 1]],
      halfSize: [2, 1, 0.5],
    };
    const aabb = regionAabb(membersRegion([rotated, box('u', 'B', [-3, 0, 0])]))!;
    const r = Math.SQRT1_2 * 2 + Math.SQRT1_2 * 1;
    expect(aabb.max[0]).toBeCloseTo(10 + r, 9);
    expect(aabb.max[1]).toBeCloseTo(r, 9);
    expect(aabb.min[0]).toBeCloseTo(-4, 9);
    expect(aabb.min[2]).toBeCloseTo(-1, 9);
    expect(regionAabb(membersRegion([]))).toBeNull();
  });
});

describe('compareRegionSource', () => {
  it('两边都有且不等 → mismatch；相等 → match；任一缺失 → unknown（不判）', () => {
    expect(compareRegionSource({ ...nullSource, modelSnapshotId: '1:parquet:a' }, { modelSnapshotId: '1:parquet:b' })).toBe('mismatch');
    expect(compareRegionSource({ ...nullSource, modelSnapshotId: '1:parquet:a' }, { modelSnapshotId: '1:parquet:a' })).toBe('match');
    expect(compareRegionSource(nullSource, { modelSnapshotId: '1:parquet:a' })).toBe('unknown');
    expect(compareRegionSource({ ...nullSource, modelSnapshotId: '1:parquet:a' }, { modelSnapshotId: null })).toBe('unknown');
    expect(compareRegionSource(null, { modelSnapshotId: null })).toBe('unknown');
  });
});
