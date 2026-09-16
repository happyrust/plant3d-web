import { describe, expect, it } from 'vitest';

import {
  E3D_ELEMENT_ARC_NOUNS,
  E3D_ELEMENT_TORUS_ARC_NOUNS,
  elementArcFromPPoints,
  elementHasE3dArc,
  elementHasE3dFilletArc,
  elementHasE3dTorusArc,
  type ElementArcVec3,
} from './elementArc';

const sub = (a: ElementArcVec3, b: ElementArcVec3): ElementArcVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ElementArcVec3, b: ElementArcVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: ElementArcVec3): number => Math.hypot(a[0], a[1], a[2]);
const deg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * gen-model-v1 `:8022` 实机数据（golden MD §37，World mm，`element/ptset` 的 world_transform × 局部点；`POS` = 矩阵平移）。
 * DN350 长半径 ELBO 24381/145121（`RADI 0`，`ANGL 49.8663`）与 DN20 3D 弯 BEND 24381/146110（`RADI 133`，`ANGL 80.1463`）。
 */
const ELBO_145121 = {
  corner: [7608.62, -1427.95, 2350] as const,
  p1: [7534.508577362234, -1586.813683004945, 2525.1210370430153] as const,
  p2: [7516.602253665127, -1385.075359357835, 2123.964494144025] as const,
  /** 源点 ATTA 145120 P3：E3D 弧面垂距 76.098 mm（§37 表）。 */
  source: [7400.401879654111, -1874.2880242211704, 2641.2895028173753] as const,
};
const BEND_146110 = {
  corner: [8999.9, 10727.68, 24781.69] as const,
  p1: [8890.866401574323, 10727.68, 24806.81028004174] as const,
  p2: [8999.902952482247, 10800.118856677691, 24696.414176406564] as const,
  /** 源点 ATTA 146109 P3：E3D 弧面垂距 7.033 mm。 */
  source: [7733.0778274536515, 10727.68, 25084.537344690292] as const,
};

describe('elementArc（E3D edgTypes.attribute(noun).arc() = gmfArc.fillet(radius, P1, POS, P2)：ELBO / BEND 的 Intersect ARC 操作数）', () => {
  it('有 arc() 的只有两类：EDGELBOW / EDGBEND 的 fillet 与 EDGRTORUS / EDGCTORUS 的中心圆；有 line() 的圆柱类、BOX / VALV / TUBI 等都没有', () => {
    for (const noun of ['ELBO', 'ELBOW', 'BEND', 'elbo', ' bend ']) {
      expect(elementHasE3dFilletArc(noun), noun).toBe(true);
      expect(elementHasE3dTorusArc(noun), noun).toBe(false);
      expect(elementHasE3dArc(noun), noun).toBe(true);
    }
    for (const noun of ['RTOR', 'RTORUS', 'CTOR', 'CTORUS', 'ctor ']) {
      expect(elementHasE3dTorusArc(noun), noun).toBe(true);
      expect(elementHasE3dFilletArc(noun), noun).toBe(false);
      expect(elementHasE3dArc(noun), noun).toBe(true);
    }
    for (const noun of ['CYLI', 'NCYL', 'DISH', 'CONE', 'SNOU', 'NOZZ', 'PYRA', 'BOX', 'VALV', 'FLAN', 'TEE', 'TUBI', 'ATTA', 'OLET', '', null, undefined]) {
      expect(elementHasE3dArc(noun as string | null | undefined), String(noun)).toBe(false);
    }
    expect(E3D_ELEMENT_ARC_NOUNS.has('ELBO')).toBe(true);
    expect(E3D_ELEMENT_ARC_NOUNS.has('CYLI')).toBe(false);
    expect(E3D_ELEMENT_TORUS_ARC_NOUNS.has('CTOR')).toBe(true);
    expect(E3D_ELEMENT_TORUS_ARC_NOUNS.has('ELBO')).toBe(false);
  });

  it('实机 ELBO 145121：半径来自目录 parameter[2] = 356（PARA「350, 356, 533」），与 E3D 同一个圆——弧心 / 切点逐位对上，切点离 P1 / P2 各 82.285 mm', () => {
    const arc = elementArcFromPPoints('ELBO', [
      { number: 1, position: ELBO_145121.p1 },
      { number: 2, position: ELBO_145121.p2 },
    ], ELBO_145121.corner, { radius: 356 })!;
    expect(arc).not.toBeNull();
    expect(arc.radius).toBe(356);
    expect(deg(arc.sweep)).toBeCloseTo(49.8663, 4);
    // 跑着的 E3D 实测（golden MD §39.4，trace 按 3 位显示）：`EDGELBOW.arc(dbRef)` 的圆心与半径。
    expect(arc.center[0]).toBeCloseTo(7296.430, 3);
    expect(arc.center[1]).toBeCloseTo(-1645.917, 3);
    expect(arc.center[2]).toBeCloseTo(2254.322, 3);
    // 切点在两腿上、离角点 165.500（P-Point 在 247.785）——**不是** P1 / P2，这正是 E3D 取错目录下标的那一格。
    // E3D 自己的切点带 ~3e-4 mm 的 `arcFillet` 数值噪声（两端 82.2850087 / 82.2853345 本该相等），所以按 1e-3 mm 对。
    expect(len(sub(arc.start, ELBO_145121.corner))).toBeCloseTo(165.500282099058, 3);
    expect(len(sub(arc.end, ELBO_145121.corner))).toBeCloseTo(165.500282099058, 3);
    expect(len(sub(ELBO_145121.p1, ELBO_145121.corner))).toBeCloseTo(247.785290843323, 6);
    expect(len(sub(arc.start, ELBO_145121.p1))).toBeCloseTo(82.2850087442867, 3);
    expect(len(sub(arc.end, ELBO_145121.p2))).toBeCloseTo(82.2853345176429, 3);
    expect(arc.start[0]).toBeCloseTo(7559.120, 3);
    expect(arc.end[0]).toBeCloseTo(7547.160, 3);
    // 弧心到两切点都是 R，且 (弧心 − 切点) ⟂ 该腿（相切）。
    expect(len(sub(arc.center, arc.start))).toBeCloseTo(356, 9);
    expect(len(sub(arc.center, arc.end))).toBeCloseTo(356, 9);
    expect(dot(sub(arc.center, arc.start), sub(ELBO_145121.p1, ELBO_145121.corner))).toBeCloseTo(0, 6);
    expect(dot(sub(arc.center, arc.end), sub(ELBO_145121.p2, ELBO_145121.corner))).toBeCloseTo(0, 6);
    // 弧心与两腿、角点共面：法向 ⟂ 三个位置差（与 R 无关，所以仍是 §37 那张平面）。
    expect(len(arc.normal)).toBeCloseTo(1, 12);
    expect(dot(arc.normal, sub(ELBO_145121.p1, ELBO_145121.corner))).toBeCloseTo(0, 9);
    expect(dot(arc.normal, sub(ELBO_145121.p2, ELBO_145121.corner))).toBeCloseTo(0, 9);
    expect(dot(arc.normal, sub(arc.center, ELBO_145121.corner))).toBeCloseTo(0, 9);
    expect(arc.corner).toEqual(ELBO_145121.corner);
    // 目录 parameter[3] = 533 才是几何上的中心线半径（切点正好落在 P1 / P2）——E3D 不画这个圆，这里只记差别。
    const geometric = elementArcFromPPoints('ELBO', [
      { number: 1, position: ELBO_145121.p1 },
      { number: 2, position: ELBO_145121.p2 },
    ], ELBO_145121.corner, { radius: 533 })!;
    expect(len(sub(geometric.start, ELBO_145121.p1))).toBeLessThan(0.3);
    expect(len(sub(geometric.center, arc.center))).toBeGreaterThan(190);
  });

  it('实机 BEND 146110（3D 弯：arrive 在 XZ 面、leave 在 YZ 面）：半径 = RADI 133（BEND 读元素自己的属性，不走目录）、80.1463° = ANGL、法向 (−0.1475, −0.7538, −0.6403)', () => {
    const arc = elementArcFromPPoints('BEND', [
      { number: 2, position: BEND_146110.p2 },
      { number: 1, position: BEND_146110.p1 },
    ], BEND_146110.corner, { radius: 133 })!;
    expect(arc).not.toBeNull();
    expect(arc.radius).toBe(133);
    expect(deg(arc.sweep)).toBeCloseTo(80.1463, 4);
    expect(arc.normal[0]).toBeCloseTo(-0.1475, 4);
    expect(arc.normal[1]).toBeCloseTo(-0.7538, 4);
    expect(arc.normal[2]).toBeCloseTo(-0.6403, 4);
    expect(len(sub(arc.center, arc.start))).toBeCloseTo(133.0, 9);
    expect(len(sub(arc.center, arc.end))).toBeCloseTo(133.0, 9);
    // RADI 就是真的弯曲半径，所以切点落回 P-Point 上（与 ELBO 那一格不同，差的只是建模舍入）。
    expect(len(sub(arc.start, BEND_146110.p1))).toBeLessThan(0.2);
    expect(len(sub(arc.end, BEND_146110.p2))).toBeLessThan(0.2);
    expect(Math.abs(dot(sub(BEND_146110.source, arc.center), arc.normal))).toBeCloseTo(7.0333, 3);
  });

  it('arrive / leave 编号可指定；对调两腿只翻法向，弧心 / 半径 / 偏转角不变', () => {
    const points = [
      { number: 3, position: BEND_146110.p1 },
      { number: 4, position: BEND_146110.p2 },
    ];
    expect(elementArcFromPPoints('BEND', points, BEND_146110.corner, { radius: 133 })).toBeNull(); // 缺省找 P1 / P2
    const forward = elementArcFromPPoints('BEND', points, BEND_146110.corner, { arrive: 3, leave: 4, radius: 133 })!;
    const backward = elementArcFromPPoints('BEND', points, BEND_146110.corner, { arrive: 4, leave: 3, radius: 133 })!;
    expect(forward.radius).toBeCloseTo(backward.radius, 9);
    expect(forward.sweep).toBeCloseTo(backward.sweep, 12);
    for (let i = 0; i < 3; i++) {
      expect(forward.center[i]).toBeCloseTo(backward.center[i]!, 9);
      expect(forward.normal[i]).toBeCloseTo(-backward.normal[i]!, 12);
      expect(backward.start[i]).toBeCloseTo(forward.end[i]!, 9);
    }
    expect(elementArcFromPPoints('BEND', points, BEND_146110.corner, { arrive: 3, leave: 3, radius: 133 })).toBeNull();
  });

  it('90° 弯的闭式解：给 R 得到腿上 T = R 处的切点，弧心在两腿方向之和上、距角点 √2 T', () => {
    const arc = elementArcFromPPoints('ELBO', [
      { number: 1, position: [-300, 0, 0] },
      { number: 2, position: [0, 0, 300] },
    ], [0, 0, 0], { radius: 300 })!;
    expect(arc.radius).toBeCloseTo(300, 9);
    for (let i = 0; i < 3; i++) {
      expect(arc.start[i]).toBeCloseTo([-300, 0, 0][i]!, 9);
      expect(arc.end[i]).toBeCloseTo([0, 0, 300][i]!, 9);
    }
    expect(deg(arc.sweep)).toBeCloseTo(90, 9);
    expect(arc.center[0]).toBeCloseTo(-300, 9);
    expect(arc.center[1]).toBeCloseTo(0, 9);
    expect(arc.center[2]).toBeCloseTo(300, 9);
    // (−X) × (+Z) = +Y
    expect(arc.normal[0]).toBeCloseTo(0, 12);
    expect(arc.normal[1]).toBeCloseTo(1, 12);
    expect(arc.normal[2]).toBeCloseTo(0, 12);
  });

  it('P-Point 只定腿的方向：两腿长短不一（甚至比切点还短）也不影响，切点一律在离角点 T = R / tan(α / 2) 处', () => {
    const arc = elementArcFromPPoints('BEND', [
      { number: 1, position: [-200, 0, 0] },
      { number: 2, position: [0, 400, 0] },
    ], [0, 0, 0], { radius: 300 })!;
    expect(arc.radius).toBeCloseTo(300, 9);
    expect(arc.center[0]).toBeCloseTo(-300, 9);
    expect(arc.center[1]).toBeCloseTo(300, 9);
    // 90° 弯 → T = R = 300：arrive 腿的 P-Point 只有 200，切点照样落在 300 处（E3D 的 arcFillet 也不管腿多长）。
    for (let i = 0; i < 3; i++) {
      expect(arc.start[i]).toBeCloseTo([-300, 0, 0][i]!, 9);
      expect(arc.end[i]).toBeCloseTo([0, 300, 0][i]!, 9);
    }
  });

  it('没有半径就没有弧：缺省 / null / 0 / 负数 / NaN 都回 null（E3D 那一侧 arc() 抛 (2,888)，同样没有操作数）', () => {
    const points = [
      { number: 1, position: [-300, 0, 0] as const },
      { number: 2, position: [0, 0, 300] as const },
    ];
    expect(elementArcFromPPoints('ELBO', points, [0, 0, 0])).toBeNull();
    for (const radius of [null, undefined, 0, -300, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(elementArcFromPPoints('ELBO', points, [0, 0, 0], { radius }), String(radius)).toBeNull();
    }
    // 环面那条路不要半径：三点自己定圆。
    expect(elementArcFromPPoints('CTOR', [
      { number: 1, position: [500, 0, 0] },
      { number: 2, position: [0, 500, 0] },
      { number: 3, position: [500 * Math.SQRT1_2, 500 * Math.SQRT1_2, 0] },
    ], null)?.radius).toBeCloseTo(500, 9);
  });

  it('退化都回 null：无 arc() 的 noun、缺 P1 / P2、角点缺或非有限、P-Point 落在角点上、两腿共线（直通 / 同侧）', () => {
    const p1 = { number: 1, position: [-300, 0, 0] as const };
    const p2 = { number: 2, position: [0, 0, 300] as const };
    const r = { radius: 300 };
    expect(elementArcFromPPoints('CYLI', [p1, p2], [0, 0, 0], r)).toBeNull();
    expect(elementArcFromPPoints(null, [p1, p2], [0, 0, 0], r)).toBeNull();
    expect(elementArcFromPPoints('ELBO', [p1], [0, 0, 0], r)).toBeNull();
    expect(elementArcFromPPoints('ELBO', [p1, p2], null, r)).toBeNull();
    expect(elementArcFromPPoints('ELBO', [p1, p2], undefined, r)).toBeNull();
    expect(elementArcFromPPoints('ELBO', [p1, p2], [Number.NaN, 0, 0], r)).toBeNull();
    expect(elementArcFromPPoints('ELBO', [p1, { number: 2, position: [0, Number.POSITIVE_INFINITY, 300] }], [0, 0, 0], r)).toBeNull();
    // P-Point 就是角点（OLET 那种 arrive = leave = 原点的构件不是弯）：腿没有方向。
    expect(elementArcFromPPoints('ELBO', [{ number: 1, position: [0, 0, 0] }, p2], [0, 0, 0], r)).toBeNull();
    // 直通：两腿反向共线（E3D fillet 里 LINE.intersection 求不出角点）。
    expect(elementArcFromPPoints('ELBO', [p1, { number: 2, position: [300, 0, 0] }], [0, 0, 0], r)).toBeNull();
    // 同侧共线：不是弯。
    expect(elementArcFromPPoints('ELBO', [p1, { number: 2, position: [-600, 0, 0] }], [0, 0, 0], r)).toBeNull();
    // 几乎共线（1e-8 的横向分量）也不硬算一条几公里长的切线。
    expect(elementArcFromPPoints('ELBO', [p1, { number: 2, position: [300, 1e-8, 0] }], [0, 0, 0], r)).toBeNull();
  });
});

/**
 * RTOR / CTOR 的 `arc(dbRef)` 是另一条路：`gmfArc.through3Points(pPosition[1], pPosition[3], pPosition[2])`
 * （`edgctorus.pmlobj` 59–68 / `edgrtorus.pmlobj` 59–68）——三枚 P-Point 本来就在中心圆上，不要 `POS`，也不要 RINS / ROUT。
 * `static_expectation`：本库没有 RTOR / CTOR 样本（gen-model `:8022` 搜不到），下面的数按 PML 源手算。
 */
describe('elementArc · RTOR / CTOR（环面中心圆，只当 Intersect 的 ARC 操作数）', () => {
  /** 单位圆上 R = 500 的三点：P1 在 +X、P2 在 +Y、P3 在 45°，绕 +Z 从 P1 转到 P2 是 90°。 */
  const QUARTER = {
    p1: [500, 0, 0] as const,
    p2: [0, 500, 0] as const,
    p3: [500 * Math.SQRT1_2, 500 * Math.SQRT1_2, 0] as const,
  };

  it('90° 环面：三点定出中心圆（圆心 / R / 法向 / 扫角），POS 给不给都一样', () => {
    const points = [
      { number: 1, position: QUARTER.p1 },
      { number: 2, position: QUARTER.p2 },
      { number: 3, position: QUARTER.p3 },
    ];
    for (const corner of [null, undefined, [123, -456, 789] as ElementArcVec3]) {
      const arc = elementArcFromPPoints('CTOR', points, corner)!;
      expect(arc, String(corner)).not.toBeNull();
      expect(arc.kind).toBe('torus');
      expect(arc.radius).toBeCloseTo(500, 9);
      for (let i = 0; i < 3; i++) expect(arc.center[i]).toBeCloseTo(0, 9);
      expect(deg(arc.sweep)).toBeCloseTo(90, 9);
      // P1 → P3 → P2 逆时针绕 +Z。
      expect(arc.normal[0]).toBeCloseTo(0, 12);
      expect(arc.normal[1]).toBeCloseTo(0, 12);
      expect(arc.normal[2]).toBeCloseTo(1, 12);
      // 环面没有「角点」，`corner` 就是圆心（fillet 才是两腿切线的交点）。
      expect(arc.corner).toEqual(arc.center);
      expect(arc.start).toEqual(QUARTER.p1);
      expect(arc.end).toEqual(QUARTER.p2);
    }
    expect(elementArcFromPPoints('RTOR', points, null)?.radius).toBeCloseTo(500, 9);
  });

  it('控制点决定走哪一边：P3 放到远侧就是 270° 的环面，法向跟着翻', () => {
    const arc = elementArcFromPPoints('CTOR', [
      { number: 1, position: [500, 0, 0] },
      { number: 2, position: [0, -500, 0] },
      { number: 3, position: [-500, 0, 0] },
    ], null)!;
    expect(deg(arc.sweep)).toBeCloseTo(270, 9);
    expect(arc.radius).toBeCloseTo(500, 9);
    expect(arc.normal[2]).toBeCloseTo(1, 12);
    // 同样两端、控制点换到近侧 → 90°，法向反向。
    const short = elementArcFromPPoints('CTOR', [
      { number: 1, position: [500, 0, 0] },
      { number: 2, position: [0, -500, 0] },
      { number: 3, position: [500 * Math.SQRT1_2, -500 * Math.SQRT1_2, 0] },
    ], null)!;
    expect(deg(short.sweep)).toBeCloseTo(90, 9);
    expect(short.normal[2]).toBeCloseTo(-1, 12);
  });

  it('任意摆放（绕 X 转 30° 再平移）：三点都在圆上、法向 ⟂ 三点所在平面', () => {
    const angle = Math.PI / 6;
    const place = (p: ElementArcVec3): ElementArcVec3 => [
      p[0] + 1000,
      p[1] * Math.cos(angle) - p[2] * Math.sin(angle) - 2000,
      p[1] * Math.sin(angle) + p[2] * Math.cos(angle) + 3000,
    ];
    const arc = elementArcFromPPoints('RTORUS', [
      { number: 1, position: place(QUARTER.p1) },
      { number: 2, position: place(QUARTER.p2) },
      { number: 3, position: place(QUARTER.p3) },
    ], null)!;
    const center = place([0, 0, 0]);
    for (let i = 0; i < 3; i++) expect(arc.center[i]).toBeCloseTo(center[i]!, 6);
    expect(arc.radius).toBeCloseTo(500, 6);
    expect(deg(arc.sweep)).toBeCloseTo(90, 6);
    expect(len(arc.normal)).toBeCloseTo(1, 12);
    for (const p of [QUARTER.p1, QUARTER.p2, QUARTER.p3]) {
      expect(len(sub(arc.center, place(p)))).toBeCloseTo(500, 6);
      expect(dot(arc.normal, sub(place(p), arc.center))).toBeCloseTo(0, 6);
    }
  });

  it('退化回 null：缺 P3（E3D 的 through3Points 也要三枚）、三点共线 / 重合、非有限', () => {
    const p1 = { number: 1, position: QUARTER.p1 };
    const p2 = { number: 2, position: QUARTER.p2 };
    expect(elementArcFromPPoints('CTOR', [p1, p2], null)).toBeNull();
    expect(elementArcFromPPoints('CTOR', [p1, p2, { number: 3, position: [Number.NaN, 0, 0] }], null)).toBeNull();
    expect(elementArcFromPPoints('CTOR', [
      { number: 1, position: [0, 0, 0] },
      { number: 2, position: [1000, 0, 0] },
      { number: 3, position: [500, 0, 0] },
    ], null)).toBeNull();
    expect(elementArcFromPPoints('CTOR', [p1, p2, { number: 3, position: QUARTER.p1 }], null)).toBeNull();
    // 控制点编号可指定（缺省 3）。
    expect(elementArcFromPPoints('CTOR', [p1, p2, { number: 5, position: QUARTER.p3 }], null)).toBeNull();
    expect(elementArcFromPPoints('CTOR', [p1, p2, { number: 5, position: QUARTER.p3 }], null, { control: 5 })?.radius)
      .toBeCloseTo(500, 9);
  });
});
