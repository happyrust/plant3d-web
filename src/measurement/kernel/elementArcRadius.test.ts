import { describe, expect, it } from 'vitest';

import {
  elementArcRadiusFromAttributes,
  elementArcRadiusSourceFor,
  parseCatalogueParameters,
} from './elementArcRadius';

describe('elementArcRadius（E3D 的 arc() 半径入参：BEND 读 RADI、ELBO 读目录 parameter[2]）', () => {
  it('哪个 noun 走哪一路：ELBO / ELBOW → 目录，BEND → RADI，其余没有 fillet 弧', () => {
    for (const noun of ['ELBO', 'ELBOW', 'elbo', ' Elbow ']) {
      expect(elementArcRadiusSourceFor(noun), noun).toBe('catalogue-parameter-2');
    }
    for (const noun of ['BEND', 'bend ']) {
      expect(elementArcRadiusSourceFor(noun), noun).toBe('radi');
    }
    // 环面的圆由三枚 P-Point 自己定，不要半径；其余 noun 根本没有 arc()。
    for (const noun of ['CTOR', 'RTOR', 'CYLI', 'TUBI', 'VALV', '', null, undefined]) {
      expect(elementArcRadiusSourceFor(noun), String(noun)).toBeNull();
    }
  });

  it('PARA 按目录给的显示文本解析（实机 ELBO 145121：「350, 356, 533」），数组也收，垃圾项丢掉', () => {
    expect(parseCatalogueParameters('350, 356, 533')).toEqual([350, 356, 533]);
    expect(parseCatalogueParameters('350 356 533')).toEqual([350, 356, 533]);
    expect(parseCatalogueParameters([350, 356, 533])).toEqual([350, 356, 533]);
    expect(parseCatalogueParameters(['350', '356', '533'])).toEqual([350, 356, 533]);
    expect(parseCatalogueParameters('350, n/a, 533')).toEqual([350, 533]);
    expect(parseCatalogueParameters('')).toEqual([]);
    expect(parseCatalogueParameters(null)).toEqual([]);
    expect(parseCatalogueParameters(undefined)).toEqual([]);
  });

  it('实机两枚：ELBO 145121 取 parameter[2] = 356（不是几何半径 533，也不是它自己 RADI 0 的那一格）；BEND 146110 取 RADI 133', () => {
    const elbo = { radi: 0, catalogueParameters: parseCatalogueParameters('350, 356, 533') };
    expect(elementArcRadiusFromAttributes('ELBO', elbo)).toBe(356);
    // BEND 那一路压根不看目录。
    expect(elementArcRadiusFromAttributes('BEND', { radi: 133, catalogueParameters: [350, 356, 533] })).toBe(133);
    expect(elementArcRadiusFromAttributes('BEND', { radi: '133' })).toBe(133);
  });

  it('取不到就回 null（E3D 那一侧 arc() 抛 (2,888)，同样没有弧）：缺那一项、非正、非数、noun 没有 fillet', () => {
    expect(elementArcRadiusFromAttributes('ELBO', { catalogueParameters: [350] })).toBeNull();
    expect(elementArcRadiusFromAttributes('ELBO', { catalogueParameters: null })).toBeNull();
    expect(elementArcRadiusFromAttributes('ELBO', {})).toBeNull();
    expect(elementArcRadiusFromAttributes('ELBO', { catalogueParameters: [350, 0, 533] })).toBeNull();
    expect(elementArcRadiusFromAttributes('ELBO', { catalogueParameters: [350, -356, 533] })).toBeNull();
    // ELBO 的自有 RADI 是 0，就算有值也不是 E3D 读的那一格。
    expect(elementArcRadiusFromAttributes('ELBO', { radi: 533 })).toBeNull();
    expect(elementArcRadiusFromAttributes('BEND', { radi: 0 })).toBeNull();
    expect(elementArcRadiusFromAttributes('BEND', { radi: 'unset' })).toBeNull();
    expect(elementArcRadiusFromAttributes('BEND', {})).toBeNull();
    expect(elementArcRadiusFromAttributes('CTOR', { radi: 500 })).toBeNull();
    expect(elementArcRadiusFromAttributes(null, { radi: 500 })).toBeNull();
  });
});
