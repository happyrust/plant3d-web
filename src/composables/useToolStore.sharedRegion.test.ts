import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  useToolStore,
  type CloudAnnotationRecord,
  type Obb,
  type ObbAnnotationRecord,
  type ObbSnapshot,
  type RectAnnotationRecord,
  type RegionV1,
} from './useToolStore';

/**
 * P3 共享范围体（方案 §7 / §8）store 层验收：
 * - rect / obb 读取漏斗补 `regionV1`（旧 obb → legacy-snapshot，不自动迁移；显式 null 保留；幂等）；
 * - 重绑 member 时绑定 + 范围体 + 兼容字段（云线 `selectionBbox`）在同一个 patch 里原子更新；
 * - 新成员拿不到几何 → 绑定照改、范围里没有它的盒（覆盖判定为不覆盖），不用子集冒充；非 members 来源不动。
 */

const CREATED_AT = 1_700_000_000_000;
const nullSource = { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null };

const legacyObb: Obb = {
  center: [1, 2, 3],
  axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  halfSize: [2, 1, 0.5],
  corners: [[-1, 1, 2.5], [3, 1, 2.5], [3, 3, 2.5], [-1, 3, 2.5], [-1, 1, 3.5], [3, 1, 3.5], [3, 3, 3.5], [-1, 3, 3.5]],
};

function box(id: string, memberRefno: string, center: [number, number, number]): ObbSnapshot {
  return { id, memberRefno, center, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [1, 1, 1] };
}

function membersRegion(boxes: ObbSnapshot[]): RegionV1 {
  return { version: 1, space: 'world', source: nullSource, origin: 'members', kind: 'obb-union', boxes };
}

function makeObbRecord(overrides: Partial<ObbAnnotationRecord> = {}): ObbAnnotationRecord {
  return {
    id: 'obb-1',
    objectIds: ['24381_1'],
    refnos: ['24381_1'],
    obb: legacyObb,
    labelWorldPos: [1, 2, 4],
    anchor: { kind: 'top_center' },
    visible: true,
    title: 'obb',
    description: '',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeRectRecord(overrides: Partial<RectAnnotationRecord> = {}): RectAnnotationRecord {
  return {
    id: 'rect-1',
    objectIds: ['24381_1'],
    refnos: ['24381_1'],
    obb: legacyObb,
    anchorWorldPos: [1, 2, 3],
    visible: true,
    title: 'rect',
    description: '',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeCloudRecord(overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id: 'cloud-1',
    objectIds: ['24381_1'],
    refnos: ['24381_1'],
    anchorWorldPos: [0, 0, 0],
    anchorRefno: '24381_9',
    selectionBbox: { min: [-1, -1, -1], max: [1, 1, 1] },
    visible: true,
    title: 'cloud',
    description: '',
    createdAt: CREATED_AT,
    regionV1: membersRegion([box('a', '24381_1', [0, 0, 0])]),
    ...overrides,
  };
}

beforeEach(() => {
  const store = useToolStore();
  store.clearAll();
  store.setAnnotationRegionMemberBoxResolver(null);
});

afterEach(() => {
  useToolStore().setAnnotationRegionMemberBoxResolver(null);
});

describe('rect / obb 读取漏斗补 regionV1', () => {
  it('旧 obb 记录：regionV1 = 由 obb 派生的 legacy-snapshot（按保存的盒恢复）；obb 字段不动；幂等', () => {
    const store = useToolStore();
    store.addObbAnnotation(makeObbRecord());
    const stored = store.obbAnnotations.value[0]!;
    expect(stored.regionV1).toMatchObject({ origin: 'legacy-snapshot', kind: 'obb-union' });
    const boxes = (stored.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes;
    expect(boxes).toEqual([{ id: 'legacy-snapshot:0', memberRefno: null, center: [1, 2, 3], axes: legacyObb.axes, halfSize: [2, 1, 0.5] }]);
    expect(stored.obb).toEqual(legacyObb);
    // 再过一遍 update（碰绑定字段触发 normalize）结果字节相等
    store.updateObbAnnotation('obb-1', { bindings: stored.bindings });
    expect(JSON.stringify(store.obbAnnotations.value[0])).toBe(JSON.stringify(stored));
  });

  it('rect 同口径；显式 null 与已有 members 范围原样保留', () => {
    const store = useToolStore();
    store.addRectAnnotation(makeRectRecord());
    expect(store.rectAnnotations.value[0]!.regionV1?.origin).toBe('legacy-snapshot');
    store.addRectAnnotation(makeRectRecord({ id: 'rect-null', regionV1: null }));
    expect(store.rectAnnotations.value[1]!.regionV1).toBeNull();
    const members = membersRegion([box('m', '24381_1', [1, 2, 3])]);
    store.addRectAnnotation(makeRectRecord({ id: 'rect-members', regionV1: members }));
    expect(store.rectAnnotations.value[2]!.regionV1).toEqual(members);
  });
});

describe('重绑 member 的原子更新', () => {
  it('云线追加成员：resolver 给盒 → bindings / regionV1.boxes / selectionBbox 同一次更新到位', () => {
    const store = useToolStore();
    store.setAnnotationRegionMemberBoxResolver((refno) => (refno === '24381_2' ? [box('b', '24381_2', [5, 0, 0])] : null));
    store.addCloudAnnotation(makeCloudRecord());
    expect(store.addCloudAnnotationMembers('cloud-1', ['24381_2'])).toBe(1);
    const after = store.cloudAnnotations.value[0]!;
    expect(after.bindings!.filter((b) => b.role === 'member').map((b) => b.refno)).toEqual(['24381_1', '24381_2']);
    const boxes = (after.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes;
    expect(boxes.map((b) => b.id)).toEqual(['a', 'b']);
    // 兼容字段跟着范围体走：两盒并集 [-1..6] × [-1..1] × [-1..1]
    expect(after.selectionBbox).toEqual({ min: [-1, -1, -1], max: [6, 1, 1] });
    // 旧字段投影一致
    expect(after.refnos).toEqual(['24381_1', '24381_2']);
  });

  it('云线移除成员：删掉它的盒并收缩 selectionBbox；锚点绑定不受影响', () => {
    const store = useToolStore();
    store.addCloudAnnotation(makeCloudRecord({
      objectIds: ['24381_1', '24381_2'],
      refnos: ['24381_1', '24381_2'],
      regionV1: membersRegion([box('a', '24381_1', [0, 0, 0]), box('b', '24381_2', [5, 0, 0])]),
    }));
    expect(store.removeCloudAnnotationMember('cloud-1', '24381_2')).toBe(true);
    const after = store.cloudAnnotations.value[0]!;
    expect((after.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes.map((b) => b.id)).toEqual(['a']);
    expect(after.selectionBbox).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] });
    expect(after.bindings!.find((b) => b.role === 'anchor')?.refno).toBe('24381_9');
  });

  it('新成员拿不到几何（没注册 resolver / 未加载）：绑定照改，范围体不变、不覆盖新成员，selectionBbox 不动', () => {
    const store = useToolStore();
    store.addCloudAnnotation(makeCloudRecord());
    const before = store.cloudAnnotations.value[0]!;
    expect(store.addCloudAnnotationMembers('cloud-1', ['24381_7'])).toBe(1);
    const after = store.cloudAnnotations.value[0]!;
    expect(after.bindings!.filter((b) => b.role === 'member').map((b) => b.refno)).toEqual(['24381_1', '24381_7']);
    expect(after.regionV1).toBe(before.regionV1);
    expect(after.selectionBbox).toEqual(before.selectionBbox);
  });

  it('legacy-snapshot 范围体不参与调和（旧记录不自动迁移）', () => {
    const store = useToolStore();
    store.setAnnotationRegionMemberBoxResolver(() => [box('x', 'any', [0, 0, 0])]);
    store.addCloudAnnotation(makeCloudRecord({ regionV1: undefined }));
    const before = store.cloudAnnotations.value[0]!;
    expect(before.regionV1?.origin).toBe('legacy-snapshot');
    store.addCloudAnnotationMembers('cloud-1', ['24381_2']);
    const after = store.cloudAnnotations.value[0]!;
    expect(after.regionV1).toBe(before.regionV1);
    expect(after.selectionBbox).toEqual(before.selectionBbox);
  });

  it('rect / obb 的 members 范围体同样随重绑调和（不碰 obb 旧字段）', () => {
    const store = useToolStore();
    store.setAnnotationRegionMemberBoxResolver((refno) => [box(`box:${refno}`, refno, [9, 9, 9])]);
    store.addObbAnnotation(makeObbRecord({ regionV1: membersRegion([box('a', '24381_1', [0, 0, 0])]) }));
    store.addRectAnnotation(makeRectRecord({ regionV1: membersRegion([box('a', '24381_1', [0, 0, 0])]) }));
    expect(store.addAnnotationMembers('obb', 'obb-1', ['24381_2'])).toBe(1);
    expect(store.addAnnotationMembers('rect', 'rect-1', ['24381_2'])).toBe(1);
    for (const rec of [store.obbAnnotations.value[0]!, store.rectAnnotations.value[0]!]) {
      expect((rec.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes.map((b) => b.id)).toEqual(['a', 'box:24381_2']);
      expect(rec.obb).toEqual(legacyObb);
    }
    expect(store.removeAnnotationMember('obb', 'obb-1', '24381_1')).toBe(true);
    expect((store.obbAnnotations.value[0]!.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes.map((b) => b.id)).toEqual(['box:24381_2']);
  });
});
