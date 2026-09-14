import { describe, expect, it } from 'vitest';

import { deriveSectionBasisFromPlines, type SectionPlineSample } from './gensecSectionBasis';

type V = readonly [number, number, number];

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V): V => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** 用已知截面标架把目录偏移 (x, y) 放到世界里：start = O + x·X + y·Y，dir = Z。 */
function plines(
  origin: V,
  x: V,
  y: V,
  z: V,
  offsets: readonly (readonly [string, number, number])[],
): SectionPlineSample[] {
  return offsets.map(([key, px, py]) => ({
    key,
    offset: [px, py] as const,
    start: add(origin, add(scale(x, px), scale(y, py))),
    dir: z,
  }));
}

function expectAxis(actual: V | undefined, expected: V): void {
  expect(actual).toBeDefined();
  expected.forEach((value, index) => expect(actual![index]).toBeCloseTo(value, 9));
}

describe('deriveSectionBasisFromPlines · 由 p-line 偏移 + 世界起点解出 GENSEC 截面标架', () => {
  const W: V = [-1, 0, 0];
  const S: V = [0, -1, 0];
  const U: V = [0, 0, 1];
  const N: V = [0, 1, 0];

  it('G3-04 那种轴对齐的截面标架（X = W / Y = S / Z = U）', () => {
    const basis = deriveSectionBasisFromPlines(plines([15666.93, 4150, 6133], W, S, U, [
      ['NA', 0, 0],
      ['TOS', 0, 50],
      ['LTOS', -50, 100],
    ]));
    expectAxis(basis?.u, W);
    expectAxis(basis?.v, S);
    expectAxis(basis?.w, U);
  });

  it('任意旋转的标架也解得回来（右手）', () => {
    const z = unit([1, 2, 3]);
    const xRaw: V = [3, 0, -1];
    const x = unit([xRaw[0] - z[0] * (xRaw[0] * z[0] + xRaw[1] * z[1] + xRaw[2] * z[2]),
      xRaw[1] - z[1] * (xRaw[0] * z[0] + xRaw[1] * z[1] + xRaw[2] * z[2]),
      xRaw[2] - z[2] * (xRaw[0] * z[0] + xRaw[1] * z[1] + xRaw[2] * z[2])]);
    const y: V = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const basis = deriveSectionBasisFromPlines(plines([100, -200, 300], x, y, z, [
      ['NA', 12.5, -7],
      ['BOS', 12.5, -107],
      ['RTOS', 60, 40],
    ]));
    expectAxis(basis?.u, x);
    expectAxis(basis?.v, y);
    expectAxis(basis?.w, z);
  });

  it('LMIRR 已经镜进 offset 里（x 取反），放置标架仍是右手：解出的还是同一个标架', () => {
    const basis = deriveSectionBasisFromPlines(plines([0, 0, 0], W, S, U, [
      ['NA', 0, 0],
      ['TOS', 0, 50],
      ['LTOS', 50, 100], // 镜像前是 (-50, 100)
      ['LBOS', 50, -100],
    ]));
    expectAxis(basis?.u, W);
    expectAxis(basis?.v, S);
    expectAxis(basis?.w, U);
  });

  it('偏移只沿一根轴时分不出左右手，但两种解的轴线相同——回右手解（Offset 取绝对值，正负无所谓）', () => {
    // 映射用 Y = N（左手：W × N = D ≠ U）；只有 Δy，右手解是 X = E / Y = N，轴线与 (W, S) 一样。
    const basis = deriveSectionBasisFromPlines(plines([0, 0, 0], W, N, U, [
      ['NA', 0, 0],
      ['TOS', 0, 50],
    ]));
    expect(basis).not.toBeNull();
    expectAxis(basis?.u, [-W[0], -W[1], -W[2]]);
    expectAxis(basis?.v, N);
    expectAxis(basis?.w, U);
  });

  it('真正左手的放置（三条不共线的 p-line）被残差检查拒掉，回 null', () => {
    expect(deriveSectionBasisFromPlines(plines([0, 0, 0], W, N, U, [
      ['NA', 0, 0],
      ['TOS', 0, 50],
      ['LTOS', -50, 100],
    ]))).toBeNull();
  });

  it('用上全部 p-line：第三条与前两条不是同一个刚体放置时回 null，而不是只信前两条', () => {
    const consistent = plines([0, 0, 0], W, S, U, [
      ['NA', 0, 0],
      ['TOS', 0, 50],
    ]);
    const stray: SectionPlineSample = { offset: [40, 0], start: [0, -40, 0], dir: U }; // 40·X 应落在 W 上，却给了 S
    expect(deriveSectionBasisFromPlines([...consistent, stray])).toBeNull();
    // 方向不平行的 p-line 也不是同一根直构件。
    const skew: SectionPlineSample = { offset: [40, 0], start: [-40, 0, 0], dir: unit([0, 0.01, 1]) };
    expect(deriveSectionBasisFromPlines([...consistent, skew])).toBeNull();
  });

  it('只沿一根轴偏移的一对 p-line 也够（Δy = 0 或 Δx = 0）', () => {
    const onlyX = deriveSectionBasisFromPlines(plines([0, 0, 0], W, S, U, [['NA', 0, 0], ['RA', 40, 0]]));
    expectAxis(onlyX?.u, W);
    expectAxis(onlyX?.v, S);
    const onlyY = deriveSectionBasisFromPlines(plines([0, 0, 0], W, S, U, [['NA', 0, 0], ['TOS', 0, 75]]));
    expectAxis(onlyY?.u, W);
    expectAxis(onlyY?.v, S);
  });

  it('解不出就回 null：单条 / 偏移全同 / 方向缺 / 几何不自洽', () => {
    expect(deriveSectionBasisFromPlines([])).toBeNull();
    expect(deriveSectionBasisFromPlines(plines([0, 0, 0], W, S, U, [['NA', 0, 0]]))).toBeNull();
    expect(deriveSectionBasisFromPlines(plines([0, 0, 0], W, S, U, [['NA', 0, 0], ['NA2', 0, 0]]))).toBeNull();
    expect(deriveSectionBasisFromPlines([
      { offset: [0, 0], start: [0, 0, 0], dir: [0, 0, 0] },
      { offset: [0, 50], start: [0, -50, 0], dir: [0, 0, 0] },
    ])).toBeNull();
    // 起点差长度与偏移差不符（不是同一个刚体放置）。
    expect(deriveSectionBasisFromPlines([
      { offset: [0, 0], start: [0, 0, 0], dir: U },
      { offset: [0, 50], start: [0, -80, 0], dir: U },
    ])).toBeNull();
  });
});
