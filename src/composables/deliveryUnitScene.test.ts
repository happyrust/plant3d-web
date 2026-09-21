import { beforeEach, describe, expect, it, vi } from 'vitest';

import { branOwnerOfLoaded, deliveryUnitSceneRefnos, sceneCompanionsOf } from './deliveryUnitScene';

import type { InstanceEntry } from '@/utils/instances/instanceManifest';

// 管件带直段（2026-09-21，方案 A）：只读 gen-model 记录缓存认属主 / 取整根；源没建起来时什么都不扩。
const recordMocks = vi.hoisted(() => ({
  present: true,
  peek: vi.fn<(refno: string) => InstanceEntry[] | undefined>(),
  leavesOfRoot: vi.fn<(root: string) => string[]>(),
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => {
    if (!recordMocks.present) throw new Error('源还没建起来');
    return { records: { peek: recordMocks.peek, leavesOfRoot: recordMocks.leavesOfRoot } };
  },
}));

function entry(uniforms: Record<string, unknown>): InstanceEntry {
  return { geo_hash: 'g', matrix: [], geo_index: 0, color_index: 0, name_index: 0, site_name_index: 0, lod_mask: 1, uniforms };
}

/** 真机 BRAN 24381_105030 的形状：管件 owner 是 BRAN、owner_noun 由同批 TUBI 记录推成 BRAN；直管挂在 BRAN 自己的 refno 上。 */
const BRAN = '24381_105030';
const cache: Record<string, InstanceEntry[]> = {
  '24381_105031': [entry({ refno: '24381_105031', noun: 'REDU', owner_refno: BRAN, owner_noun: 'BRAN' })],
  '24381_105033': [entry({ refno: '24381_105033', noun: 'BEND', owner_refno: '24381/105030', owner_noun: 'bran' })],
  [BRAN]: [entry({ refno: BRAN, noun: 'TUBI', owner_refno: BRAN, owner_noun: 'BRAN', is_tubi: true })],
  '24381_9001': [entry({ refno: '24381_9001', noun: 'NOZZ', owner_refno: '24381_9000', owner_noun: 'EQUI' })],
  '24381_9101': [entry({ refno: '24381_9101', noun: 'HELE', owner_refno: '24381_9100', owner_noun: '' })],
  '24381_7777': [],
};

beforeEach(() => {
  recordMocks.present = true;
  recordMocks.peek.mockReset();
  recordMocks.leavesOfRoot.mockReset();
  recordMocks.peek.mockImplementation((refno) => cache[refno]);
  recordMocks.leavesOfRoot.mockImplementation((root) => (root === BRAN ? ['24381/105031', '24381_105032', '24381_105033', BRAN] : []));
});

describe('deliveryUnitScene（管件带直段）', () => {
  it('branOwnerOfLoaded：只认记录缓存里 owner_noun 为 BRAN 的构件，a/b 归一成 a_b；BRAN 自己的直管条目、EQUI / 无 owner_noun 的构件、没几何、没记录都回 null', () => {
    expect(branOwnerOfLoaded('24381_105031')).toBe(BRAN);
    expect(branOwnerOfLoaded('24381/105033')).toBe(BRAN);
    expect(branOwnerOfLoaded(BRAN), 'BRAN 自己（refno == owner）不是别人的管件').toBeNull();
    expect(branOwnerOfLoaded('24381_9001'), 'EQUI 根没有直管').toBeNull();
    expect(branOwnerOfLoaded('24381_9101'), 'owner_noun 空（HANG 之类）不扩').toBeNull();
    expect(branOwnerOfLoaded('24381_7777'), '有记录但没几何').toBeNull();
    expect(branOwnerOfLoaded('24381_8888'), '没取过记录').toBeNull();
    expect(branOwnerOfLoaded('')).toBeNull();
  });

  it('deliveryUnitSceneRefnos：BRAN 自己排第一（直管挂在这儿），后面是记录缓存里这一根的构件，归一去重；没取过记录只有它自己', () => {
    expect(deliveryUnitSceneRefnos('24381/105030')).toEqual([BRAN, '24381_105031', '24381_105032', '24381_105033']);
    expect(deliveryUnitSceneRefnos('24381_9999')).toEqual(['24381_9999']);
    expect(deliveryUnitSceneRefnos('')).toEqual([]);
  });

  it('sceneCompanionsOf：按构件认属主 + 直接给的单元，整根展开后去掉入参里已有的；同根只展一次', () => {
    expect(sceneCompanionsOf(['24381_105031', '24381_105033', '24381_9001'])).toEqual([BRAN, '24381_105032']);
    expect(sceneCompanionsOf([], ['24381/105030'])).toEqual([BRAN, '24381_105031', '24381_105032', '24381_105033']);
    expect(sceneCompanionsOf(['24381_105031'], [BRAN]), '构件与单元指向同一根不重复').toEqual([BRAN, '24381_105032', '24381_105033']);
    expect(sceneCompanionsOf(['24381_9001', '24381_8888'])).toEqual([]);
  });

  it('源没建起来（测试没桩 / 早于 activate）：一律回退成不扩，不抛', () => {
    recordMocks.present = false;
    expect(branOwnerOfLoaded('24381_105031')).toBeNull();
    expect(deliveryUnitSceneRefnos(BRAN)).toEqual([BRAN]);
    expect(sceneCompanionsOf(['24381_105031'])).toEqual([]);
  });
});
