import { describe, expect, it } from 'vitest';

import {
  E3D_ELEMENT_LINE_NOUNS,
  elementHasE3dLine,
  elementLineAcceptsLocalBounds,
  elementLineBoundsRule,
  elementLineFromPPoints,
} from './elementLine';

describe('elementLine（E3D edgTypes.attribute(noun).line() = P1 → P2：Intersect / Perpendicular 的元素操作数）', () => {
  it('只有 EDGCYLINDER / EDGDISH / EDGSNOUT / EDGNOZZLE / EDGPYRAMID 管的 noun 有 line()；ELBO / BEND / BOX / VALV 没有', () => {
    for (const noun of ['CYLI', 'NCYL', 'SLCY', 'NSLC', 'DISH', 'NDIS', 'CONE', 'NCON', 'SNOU', 'NSNO', 'NOZZ', 'PYRA', 'NPYR']) {
      expect(elementHasE3dLine(noun), noun).toBe(true);
    }
    // 全称拼法（E3D fullType）与大小写 / 空白
    expect(elementHasE3dLine('cylinder')).toBe(true);
    expect(elementHasE3dLine(' nozzle ')).toBe(true);
    for (const noun of ['ELBO', 'BEND', 'RTOR', 'CTOR', 'BOX', 'VALV', 'FLAN', 'TEE', 'SCTN', 'PANEL', 'ATTA', 'TUBI', '', null, undefined]) {
      expect(elementHasE3dLine(noun as string | null | undefined), String(noun)).toBe(false);
    }
    expect(E3D_ELEMENT_LINE_NOUNS.has('CYLI')).toBe(true);
    expect(E3D_ELEMENT_LINE_NOUNS.has('ELBO')).toBe(false);
  });

  it('设计基本体的局部几何可代 P1 → P2：圆柱 / 锥 / 碟要截面对中且圆，棱锥只要对中；NOZZ 只认目录 ptset', () => {
    for (const noun of ['CYLI', 'NCYL', 'SLCY', 'NSLC', 'cylinder', 'CONE', 'NCON', 'SNOU', 'snout', 'NSNO', 'DISH', 'NDIS']) {
      expect(elementLineBoundsRule(noun), noun).toBe('centred-round');
    }
    for (const noun of ['PYRA', 'NPYR', 'pyramid']) expect(elementLineBoundsRule(noun), noun).toBe('centred');
    for (const noun of ['NOZZ', 'TUBI', 'ELBO', 'BOX', '', null, undefined]) {
      expect(elementLineBoundsRule(noun as string | null | undefined), String(noun)).toBeNull();
    }
  });

  it('elementLineAcceptsLocalBounds：实机 gen-model 的局部包围盒——单位圆柱实例、CONE（z ∓ HEIG/2）、DISH（z 0 → HEIG）、PYRA 楔形都过', () => {
    expect(elementLineAcceptsLocalBounds('CYLI', { min: [-1, -1, 0], max: [1, 1, 1] })).toBe(true); // 单位圆柱实例
    expect(elementLineAcceptsLocalBounds('CYLI', { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] })).toBe(true); // 半径任意
    expect(elementLineAcceptsLocalBounds('CONE', { min: [-46.5, -46.5, -24], max: [46.5, 46.5, 24] })).toBe(true); // CONE 24381_160671
    expect(elementLineAcceptsLocalBounds('DISH', { min: [-1200, -1200, 0], max: [1200, 1200, 1218] })).toBe(true); // DISH 24381_163319
    expect(elementLineAcceptsLocalBounds('PYRA', { min: [-497, -865, -600], max: [497, 865, 600] })).toBe(true); // PYRA 24381_163627（XTOP = 0 楔形）
    // float32 细分环的对称误差在千分之一以内
    expect(elementLineAcceptsLocalBounds('CONE', { min: [-46.5, -46.49, -24], max: [46.5, 46.5, 24] })).toBe(true);
  });

  it('elementLineAcceptsLocalBounds：不对中（带 XOFF / YOFF 的 SNOU / PYRA、烘在世界帧的实体）、不圆、扁平、非有限、无规则的 noun 都不过', () => {
    expect(elementLineAcceptsLocalBounds('SNOU', { min: [-60, -50, -24], max: [40, 50, 24] })).toBe(false); // XOFF ≠ 0
    expect(elementLineAcceptsLocalBounds('PYRA', { min: [-400, -865, -600], max: [594, 865, 600] })).toBe(false); // XOFF ≠ 0
    expect(elementLineAcceptsLocalBounds('CYLI', { min: [-120, -80, -30], max: [90, 60, 200] })).toBe(false); // 世界帧网格
    expect(elementLineAcceptsLocalBounds('CYLI', { min: [5, 5, 5], max: [6, 6, 7] })).toBe(false); // 世界帧网格
    expect(elementLineAcceptsLocalBounds('CONE', { min: [-1, -0.5, 0], max: [1, 0.5, 1] })).toBe(false); // 截面不圆
    expect(elementLineAcceptsLocalBounds('PYRA', { min: [-1, -0.5, 0], max: [1, 0.5, 1] })).toBe(true); // 棱锥不要求圆
    expect(elementLineAcceptsLocalBounds('DISH', { min: [-1, -1, 1], max: [1, 1, 1] })).toBe(false); // 零高度
    expect(elementLineAcceptsLocalBounds('PYRA', { min: [0, 0, -600], max: [0, 0, 600] })).toBe(false); // 截面退化成点
    expect(elementLineAcceptsLocalBounds('CYLI', { min: [Number.NaN, -1, 0], max: [1, 1, 1] })).toBe(false);
    expect(elementLineAcceptsLocalBounds('NOZZ', { min: [-1, -1, 0], max: [1, 1, 1] })).toBe(false); // 无规则
    expect(elementLineAcceptsLocalBounds('ELBO', { min: [-1, -1, 0], max: [1, 1, 1] })).toBe(false);
    expect(elementLineAcceptsLocalBounds(null, { min: [-1, -1, 0], max: [1, 1, 1] })).toBe(false);
  });

  it('P1 → P2 成线，点集顺序无关、其余 P 点忽略', () => {
    const line = elementLineFromPPoints('CYLI', [
      { number: 3, position: [9, 9, 9] },
      { number: 2, position: [0, 0, 1200] },
      { number: 1, position: [0, 0, 0] },
    ]);
    expect(line).toEqual({ start: [0, 0, 0], end: [0, 0, 1200] });
  });

  it('noun 无 line() handler、缺 P1 / P2、坐标非有限、P1 = P2 → null', () => {
    const p1p2 = [
      { number: 1, position: [0, 0, 0] as const },
      { number: 2, position: [0, 0, 1] as const },
    ];
    expect(elementLineFromPPoints('ELBO', p1p2)).toBeNull();
    expect(elementLineFromPPoints('BOX', p1p2)).toBeNull();
    expect(elementLineFromPPoints('NOZZ', [p1p2[0]!])).toBeNull();
    expect(elementLineFromPPoints('NOZZ', [{ number: 1, position: [0, 0, Number.NaN] }, p1p2[1]!])).toBeNull();
    expect(elementLineFromPPoints('DISH', [{ number: 1, position: [1, 2, 3] }, { number: 2, position: [1, 2, 3] }])).toBeNull();
    expect(elementLineFromPPoints('SNOU', [])).toBeNull();
  });
});
