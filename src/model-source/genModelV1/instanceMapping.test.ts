import { describe, expect, it } from 'vitest';

import { Matrix4, Vector3 } from 'three';

import {
  aabbToEntryAabb,
  buildNounIndex,
  composeInstanceMatrix,
  geomInstQueryToInstanceEntries,
  groupInstanceEntriesByRefno,
  transformToMatrix,
} from './instanceMapping';

import type { GeomInstQuery, V1Transform } from '@/api/genModelV1Api';

const IDENTITY: V1Transform = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
/** 绕 Z 转 90°：(x, y, z) → (−y, x, z) */
const ROT_Z_90: V1Transform['rotation'] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

function apply(matrix: number[], point: [number, number, number]): [number, number, number] {
  const v = new Vector3(...point).applyMatrix4(new Matrix4().fromArray(matrix));
  return [v.x, v.y, v.z];
}

function closeTo(actual: number[], expected: number[], eps = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThan(eps));
}

function record(overrides: Partial<GeomInstQuery> = {}): GeomInstQuery {
  return {
    refno: '24381_100817',
    old_refno: null,
    owner: '24381_100677',
    world_aabb: { mins: [1000, 2000, 3000], maxs: [1100, 2200, 3300] },
    world_trans: { translation: [1000, 2000, 3000], rotation: ROT_Z_90, scale: [1, 1, 1] },
    insts: [
      { geo_hash: '10000256467819498479', transform: { translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 3, 4] }, is_tubi: false, is_invalid_tubi: false },
    ],
    has_neg: false,
    generic: 'ELBO',
    pts: null,
    date: null,
    ...overrides,
  };
}

describe('transformToMatrix / composeInstanceMatrix（bevy T·R·S → three 列主序）', () => {
  it('单位变换是单位阵；平移落在列主序的第 12–14 位', () => {
    expect(transformToMatrix(IDENTITY).toArray()).toEqual(new Matrix4().identity().toArray());
    const m = transformToMatrix({ ...IDENTITY, translation: [1, 2, 3] }).toArray();
    expect(m.slice(12, 15)).toEqual([1, 2, 3]);
  });

  it('手算一条：局部 (1,0,0) 先缩放 (2,3,4) 再局部平移 (10,0,0) 再绕 Z 转 90° 再平移 (1000,2000,3000)', () => {
    const matrix = composeInstanceMatrix(
      { translation: [1000, 2000, 3000], rotation: ROT_Z_90, scale: [1, 1, 1] },
      { translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 3, 4] },
    );
    // 局部 (1,0,0)：缩放 → (2,0,0)；局部平移 → (12,0,0)；绕 Z 90° → (0,12,0)；世界平移 → (1000,2012,3000)
    closeTo(apply(matrix, [1, 0, 0]), [1000, 2012, 3000]);
    // 局部 (0,1,0)：缩放 → (0,3,0)；平移 → (10,3,0)；旋转 → (−3,10,0)；→ (997,2010,3000)
    closeTo(apply(matrix, [0, 1, 0]), [997, 2010, 3000]);
    // 局部 (0,0,1)：缩放 → (0,0,4)；平移 → (10,0,4)；旋转 → (0,10,4)；→ (1000,2010,3004)
    closeTo(apply(matrix, [0, 0, 1]), [1000, 2010, 3004]);
  });

  it('直管：inst.transform 为单位阵、姿态与缩放全在 world_trans 里，同一条公式照样成立', () => {
    const matrix = composeInstanceMatrix(
      { translation: [5, 6, 7], rotation: ROT_Z_90, scale: [50, 50, 1200] },
      IDENTITY,
    );
    // 单位圆柱顶面中心 (0,0,1) → 缩放 (0,0,1200) → 旋转不变 → (5,6,1207)
    closeTo(apply(matrix, [0, 0, 1]), [5, 6, 1207]);
    // 单位圆柱侧面 (0.5,0,0) → (25,0,0) → 绕 Z 90° → (0,25,0) → (5,31,7)
    closeTo(apply(matrix, [0.5, 0, 0]), [5, 31, 7]);
  });

  it('非法字段（NaN / 缺失）退回单位量，绝不产出 NaN 矩阵', () => {
    const m = transformToMatrix({ translation: [Number.NaN, 0, 0] as never, rotation: [0, 0, 0] as never, scale: undefined as never }).toArray();
    expect(m.every((v) => Number.isFinite(v))).toBe(true);
    expect(m).toEqual(new Matrix4().identity().toArray());
    expect(transformToMatrix(null).toArray()).toEqual(new Matrix4().identity().toArray());
  });
});

describe('geomInstQueryToInstanceEntries', () => {
  it('每个 inst 一条 entry：uniforms 归一、aabb 透传、refno_transform = world_trans、lod_mask=1', () => {
    const [entry, ...rest] = geomInstQueryToInstanceEntries(record(), { nounByRefno: new Map([['24381_100677', 'BRAN']]) });
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      geo_hash: '10000256467819498479',
      geo_index: 0,
      color_index: 0,
      name_index: 0,
      site_name_index: 0,
      lod_mask: 1,
      aabb: { min: [1000, 2000, 3000], max: [1100, 2200, 3300] },
      uniforms: {
        refno: '24381_100817',
        noun: 'ELBO',
        owner_refno: '24381_100677',
        owner_noun: 'BRAN',
        generic: 'ELBO',
        is_tubi: false,
        is_invalid_tubi: false,
        has_neg: false,
      },
    });
    expect(entry!.matrix).toHaveLength(16);
    expect(entry!.matrix).toEqual(composeInstanceMatrix(record().world_trans, record().insts[0]!.transform));
    expect(entry!.refno_transform).toEqual(transformToMatrix(record().world_trans).toArray());
  });

  it('直管：noun 统一 TUBI、owner_noun 缺省 BRAN、不给 refno_transform；a/b 写法的 refno/owner 归一 a_b', () => {
    const [entry] = geomInstQueryToInstanceEntries(record({
      refno: '24381/145018',
      owner: '24381/145018',
      generic: 'BRAN',
      insts: [{ geo_hash: '2', transform: IDENTITY, is_tubi: true, is_invalid_tubi: true }],
    }));
    expect(entry!.uniforms).toMatchObject({ refno: '24381_145018', owner_refno: '24381_145018', noun: 'TUBI', owner_noun: 'BRAN', is_tubi: true, is_invalid_tubi: true });
    expect(entry!.refno_transform).toBeUndefined();
  });

  it('没有 insts / 空 geo_hash / 缺 world_aabb 的记录不崩：产出空数组或 aabb=null', () => {
    expect(geomInstQueryToInstanceEntries(record({ insts: [] }))).toEqual([]);
    expect(geomInstQueryToInstanceEntries(record({ insts: [{ geo_hash: '', transform: IDENTITY, is_tubi: false, is_invalid_tubi: false }] }))).toEqual([]);
    const [entry] = geomInstQueryToInstanceEntries(record({ world_aabb: null }));
    expect(entry!.aabb).toBeNull();
    expect(aabbToEntryAabb({ mins: [0, 0, Number.NaN], maxs: [1, 1, 1] })).toBeNull();
  });
});

describe('groupInstanceEntriesByRefno / buildNounIndex', () => {
  it('按构件 refno 分桶，同一构件多条记录合并；owner_noun 从同批记录里认', () => {
    const items = [
      record({ refno: '24381_145018', owner: '24381_145018', generic: 'BRAN', insts: [{ geo_hash: '2', transform: IDENTITY, is_tubi: true, is_invalid_tubi: false }] }),
      record({ refno: '24381_145019', owner: '24381_145018', generic: 'ELBO' }),
      record({ refno: '24381/145019', owner: '24381_145018', generic: 'ELBO', insts: [{ geo_hash: 'abc', transform: IDENTITY, is_tubi: false, is_invalid_tubi: false }] }),
    ];
    expect(buildNounIndex(items).get('24381_145018')).toBe('BRAN');
    const grouped = groupInstanceEntriesByRefno(items);
    expect([...grouped.keys()]).toEqual(['24381_145018', '24381_145019']);
    expect(grouped.get('24381_145019')).toHaveLength(2);
    expect(grouped.get('24381_145019')![0]!.uniforms).toMatchObject({ owner_noun: 'BRAN', noun: 'ELBO' });
    expect(grouped.get('24381_145018')![0]!.uniforms).toMatchObject({ noun: 'TUBI', owner_noun: 'BRAN' });
  });
});
