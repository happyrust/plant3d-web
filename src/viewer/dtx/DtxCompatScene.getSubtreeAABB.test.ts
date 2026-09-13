import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Box3, Vector3 } from 'three';

import { DtxCompatScene } from './DtxCompatViewer';

import type { DTXLayer } from '@/utils/three/dtx';

type Aabb6 = [number, number, number, number, number, number];

/**
 * BRAN 24381_145018 的真机数据（2026-09-14，:18122 `/api/v1/model/records`）：11 条 TUBI 挂在 BRAN 自己的 refno 下，
 * ELBO / VALV 成员各有 refno；VALV 24381_145035 把子树盒往 +x / +z 顶出 590 / 1146 mm。
 */
const BOXES: Record<string, Aabb6> = {
  'o:24381_145018:0': [1510, 8100, 13236, 9827, 11845, 18722], // BRAN 的隐含管子
  'o:24381_145019:1': [3186, 8259, 13244, 3398, 8387, 13453], // ELBO 成员
  'o:24381_145035:2': [9545, 9624, 18272, 10417, 10231, 19868], // VALV 成员
  'o:24381_900001:3': [0, 0, 0, 1, 1, 1], // 同库、别的根
};
const OWNER: Record<string, string> = {
  '24381_145019': '24381_145018',
  '24381_145035': '24381_145018',
  '24381_900001': '24381_900000',
};

const refnoOf = (objectId: string) => objectId.split(':')[1] ?? '';

const dbMetaMocks = vi.hoisted(() => ({
  tryGetDbnumByRefno: vi.fn((refno: string) => (refno.startsWith('24381_') ? 7997 : null)),
}));
const loaderMocks = vi.hoisted(() => ({
  hasDtxDbnoCache: vi.fn((dbno: number) => dbno === 7997),
  resolveDtxObjectIdsByRefno: vi.fn((_dbno: number, _refno: string): string[] => []),
  resolveDtxObjectIdsByUnitRefno: vi.fn((_dbno: number, _root: string): string[] => []),
}));

vi.mock('@/composables/useDbMetaInfo', () => ({ tryGetDbnumByRefno: dbMetaMocks.tryGetDbnumByRefno }));
vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  hasDtxDbnoCache: loaderMocks.hasDtxDbnoCache,
  resolveDtxObjectIdsByRefno: loaderMocks.resolveDtxObjectIdsByRefno,
  resolveDtxObjectIdsByUnitRefno: loaderMocks.resolveDtxObjectIdsByUnitRefno,
}));

function createLayer(): DTXLayer {
  return {
    hasObject: (id: string) => id in BOXES,
    get objectCount() {
      return Object.keys(BOXES).length;
    },
    getAllObjectIds: () => Object.keys(BOXES),
    getObjectBoundingBoxInto: (id: string, target: Box3) => {
      const b = BOXES[id];
      if (!b) return null;
      target.set(new Vector3(b[0], b[1], b[2]), new Vector3(b[3], b[4], b[5]));
      return target;
    },
  } as unknown as DTXLayer;
}

describe('DtxCompatScene.getSubtreeAABB', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loaderMocks.resolveDtxObjectIdsByRefno.mockImplementation((_dbno, refno) => Object.keys(BOXES).filter((id) => refnoOf(id) === refno));
    loaderMocks.resolveDtxObjectIdsByUnitRefno.mockImplementation((_dbno, root) => Object.keys(BOXES).filter((id) => {
      let current = refnoOf(id);
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        if (current === root) return true;
        seen.add(current);
        current = OWNER[current] ?? '';
      }
      return false;
    }));
  });

  it('getAABB 只并自己 refno 的对象（BRAN = 管子盒）；getSubtreeAABB 并上 owner 链落到它的成员', () => {
    const scene = new DtxCompatScene({ dtxLayer: createLayer() });

    expect(scene.getAABB(['24381_145018'])).toEqual([1510, 8100, 13236, 9827, 11845, 18722]);
    // 子树：管子 ∪ ELBO ∪ VALV；别的根不算
    expect(scene.getSubtreeAABB(['24381_145018'])).toEqual([1510, 8100, 13236, 10417, 11845, 19868]);
    expect(loaderMocks.resolveDtxObjectIdsByUnitRefno).toHaveBeenCalledWith(7997, '24381_145018');

    // 与真机一致：两种盒的中心差 (295, 0, 573)
    const own = scene.getAABB(['24381_145018'])!;
    const subtree = scene.getSubtreeAABB(['24381_145018'])!;
    const center = (b: Aabb6): [number, number, number] => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const [ox, oy, oz] = center(own);
    const [sx, sy, sz] = center(subtree);
    expect([sx - ox, sy - oy, sz - oz]).toEqual([295, 0, 573]);
  });

  it('叶子构件两种盒相同；refno 用斜杠写也认', () => {
    const scene = new DtxCompatScene({ dtxLayer: createLayer() });
    expect(scene.getSubtreeAABB(['24381_145035'])).toEqual(scene.getAABB(['24381_145035']));
    expect(scene.getSubtreeAABB(['24381/145035'])).toEqual([9545, 9624, 18272, 10417, 10231, 19868]);
  });

  it('多个 refno 取并集；一个都没加载回 null', () => {
    const scene = new DtxCompatScene({ dtxLayer: createLayer() });
    expect(scene.getSubtreeAABB(['24381_145019', '24381_900001'])).toEqual([0, 0, 0, 3398, 8387, 13453]);
    expect(scene.getSubtreeAABB(['24381_777777'])).toBeNull();
    expect(scene.getSubtreeAABB([])).toBeNull();
  });

  it('解不出库号或不是 refno 形状的 id 只走自己的对象，不去问 owner 链', () => {
    const scene = new DtxCompatScene({ dtxLayer: createLayer() });
    // 55555_… 没有 db_meta：退回按已加载 objectId 建的索引，只有自己的
    expect(scene.getSubtreeAABB(['55555_1'])).toBeNull();
    expect(loaderMocks.resolveDtxObjectIdsByUnitRefno).not.toHaveBeenCalledWith(expect.anything(), '55555_1');
    // 直接以 objectId 当 id（hasObject 命中）：只有它自己
    expect(scene.getSubtreeAABB(['o:24381_145019:1'])).toEqual([3186, 8259, 13244, 3398, 8387, 13453]);
    expect(loaderMocks.resolveDtxObjectIdsByUnitRefno).not.toHaveBeenCalledWith(expect.anything(), 'o:24381_145019:1');
  });
});
