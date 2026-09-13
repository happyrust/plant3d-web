import { describe, expect, it } from 'vitest';

import { Matrix4, Quaternion, Vector3 } from 'three';

import {
  DEFAULT_TUBING_MERGE_MIN_COS,
  isTubingPassThroughPoint,
  mergeTubingAxisAcrossPassThrough,
  refineTubingAxisEnds,
  tubingAxisFromBounds,
  tubingEndTolerance,
  type RefinedTubingAxis,
  type TubingAxis,
  type TubingAxisEndPoint,
  type TubingAxisPiece,
  type TubingVec3,
} from './tubingAxis';

/** gen-model unit tube: radius ½, axis z ∈ [0, 1]. */
const UNIT_TUBE_BOUNDS = { min: [-0.5, -0.5, 0] as TubingVec3, max: [0.5, 0.5, 1] as TubingVec3 };

function close(actual: TubingVec3, expected: readonly number[], digits = 6): void {
  expect(actual[0]).toBeCloseTo(expected[0]!, digits);
  expect(actual[1]).toBeCloseTo(expected[1]!, digits);
  expect(actual[2]).toBeCloseTo(expected[2]!, digits);
}

describe('tubingAxisFromBounds（E3D TUBING：直管对象局部包围盒 × 放置矩阵 → 轴线段）', () => {
  it('单位阵：轴线沿局部 z 从低面到高面，穿过截面中心，半径 = 半截面', () => {
    const axis = tubingAxisFromBounds({ bounds: UNIT_TUBE_BOUNDS });
    expect(axis).not.toBeNull();
    close(axis!.start, [0, 0, 0]);
    close(axis!.end, [0, 0, 1]);
    expect(axis!.radius).toBeCloseTo(0.5, 9);
  });

  it('gen-model 放置矩阵（T·R·S，缩放 (s, s, L)）：起点 = translation，终点 = 沿旋转后的 z 走 L，半径 = 半截面 × s', () => {
    // 实机记录 BRAN 24381/145018 的一段直管（model/records 2026-09-13）：scale = (57.15, 57.15, 456.39)，
    // rotation 把局部 z 转到世界 −y 方向。半径随局部截面走：直径 1 的夹具 → s / 2。
    const scaleXY = 57.150001525878906;
    const length = 456.3885803222656;
    const translation = new Vector3(3341.6298828125, 8330.5703125, 13909.0498046875);
    const rotation = new Quaternion(-0.7071067690849304, 0.7071067690849304, 0, 0).normalize();
    const matrix = new Matrix4().compose(translation, rotation, new Vector3(scaleXY, scaleXY, length));

    const axis = tubingAxisFromBounds({ bounds: UNIT_TUBE_BOUNDS, matrix: matrix.toArray() });
    expect(axis).not.toBeNull();
    close(axis!.start, translation.toArray(), 3);
    const expectedEnd = new Vector3(0, 0, 1).applyQuaternion(rotation).multiplyScalar(length).add(translation);
    close(axis!.end, expectedEnd.toArray(), 3);
    expect(axis!.radius).toBeCloseTo(scaleXY / 2, 3);
    // 轴长 = L，与截面无关。
    expect(new Vector3(...axis!.end).distanceTo(new Vector3(...axis!.start))).toBeCloseTo(length, 3);
  });

  it('实机 DTX 直管：局部圆柱半径 1、z ∈ [0, 1]，矩阵缩放 (0.05715, 0.05715, 2.338) 米 → 半径 57.15 mm、轴长 2338 mm', () => {
    // 2026-09-13 实机走查 BRAN 24381/145018 对象 o:24381_145018:7（DTXLayer.getObjectGeometryData）：
    // 局部包围盒 (−1, −1, 0)…(1, 1, 1)，矩阵缩放列长 (0.0572, 0.0572, 2.338)（场景米）。
    const matrix = new Matrix4().compose(
      new Vector3(1.8861, -0.6736, 2.1041),
      new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 1, -0.005).normalize()),
      new Vector3(0.05715, 0.05715, 2.338),
    );
    const axis = tubingAxisFromBounds({ bounds: { min: [-1, -1, 0], max: [1, 1, 1] }, matrix: matrix.toArray() });
    expect(axis).not.toBeNull();
    expect(axis!.radius * 1000).toBeCloseTo(57.15, 6);
    expect(new Vector3(...axis!.end).distanceTo(new Vector3(...axis!.start)) * 1000).toBeCloseTo(2338, 6);
    close(axis!.start, [1.8861, -0.6736, 2.1041], 6);
  });

  it('居中的单位圆柱（z ∈ [−½, ½]）与自定义局部轴同样成立', () => {
    const centred = tubingAxisFromBounds({ bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } });
    close(centred!.start, [0, 0, -0.5]);
    close(centred!.end, [0, 0, 0.5]);

    const alongX = tubingAxisFromBounds({
      bounds: { min: [0, -1, -1], max: [10, 1, 1] },
      localAxis: 'x',
    });
    close(alongX!.start, [0, 0, 0]);
    close(alongX!.end, [10, 0, 0]);
    expect(alongX!.radius).toBeCloseTo(1, 9);
  });

  it('退化输入回 null：零长轴、非有限包围盒、长度不是 16 的矩阵', () => {
    expect(tubingAxisFromBounds({ bounds: { min: [0, 0, 1], max: [1, 1, 1] } })).toBeNull();
    expect(tubingAxisFromBounds({ bounds: { min: [0, 0, Number.NaN], max: [1, 1, 1] } })).toBeNull();
    expect(tubingAxisFromBounds({ bounds: UNIT_TUBE_BOUNDS, matrix: [1, 0, 0] })).toBeNull();
    // 缩放到零长度的矩阵
    const flat = new Matrix4().makeScale(1, 1, 0).toArray();
    expect(tubingAxisFromBounds({ bounds: UNIT_TUBE_BOUNDS, matrix: flat })).toBeNull();
  });
});

describe('refineTubingAxisEnds（轴线端点吸到邻接 P-Point：E3D 以 leave / arrive 位置定义管线）', () => {
  const axis: TubingAxis = { start: [0, 0, 0], end: [0, 0, 1000], radius: 50 };

  it('tolerance 下限与半径比例取大者', () => {
    expect(tubingEndTolerance(axis, 2)).toBeCloseTo(2.5, 9); // 5% × 50 = 2.5 > 2
    expect(tubingEndTolerance({ ...axis, radius: 10 }, 2)).toBeCloseTo(2, 9); // 0.5 < 2
    expect(tubingEndTolerance({ ...axis, radius: Number.NaN }, 2)).toBeCloseTo(2, 9);
  });

  it('两端各吸到容差内最近的一点，并回传该点的标签；容差外的点不参与', () => {
    const refined = refineTubingAxisEnds(axis, [
      { position: [0.4, 0, -0.3], label: 'ELBO P-Point #2' },
      { position: [0, 0.2, 1000.4], label: 'VALV P-Point #1' },
      { position: [0, 0, 990], label: 'far' },
      { position: [3, 0, 0], label: 'too far' },
    ], 1);
    expect(refined.startPoint?.label).toBe('ELBO P-Point #2');
    expect(refined.endPoint?.label).toBe('VALV P-Point #1');
    close(refined.start, [0.4, 0, -0.3]);
    close(refined.end, [0, 0.2, 1000.4]);
    expect(refined.radius).toBe(50);
  });

  it('只有一端有邻接点时另一端保留几何端点；没有点或容差非正时原样返回', () => {
    const oneEnd = refineTubingAxisEnds(axis, [{ position: [0, 0, 1000.5], label: 'end' }], 1);
    expect(oneEnd.startPoint).toBeNull();
    close(oneEnd.start, [0, 0, 0]);
    expect(oneEnd.endPoint?.label).toBe('end');

    const none = refineTubingAxisEnds(axis, [], 1);
    expect(none.startPoint).toBeNull();
    expect(none.endPoint).toBeNull();
    expect(refineTubingAxisEnds(axis, [{ position: [0, 0, 0] }], 0).startPoint).toBeNull();
  });

  it('同一点离两端都在容差内时只给更近的那一端；把轴线吸成零长时放弃校正', () => {
    const shortAxis: TubingAxis = { start: [0, 0, 0], end: [0, 0, 1], radius: 50 };
    const shared = refineTubingAxisEnds(shortAxis, [{ position: [0, 0, 0.2], label: 'shared' }], 2);
    expect(shared.startPoint?.label).toBe('shared');
    expect(shared.endPoint).toBeNull();
    close(shared.end, [0, 0, 1]);

    const collapse = refineTubingAxisEnds(shortAxis, [
      { position: [0, 0, 0.5], label: 'a' },
      { position: [0, 0, 0.5], label: 'b' },
    ], 2);
    expect(collapse.startPoint).toBeNull();
    expect(collapse.endPoint).toBeNull();
    close(collapse.start, [0, 0, 0]);
    close(collapse.end, [0, 0, 1]);
  });
});

describe('mergeTubingAxisAcrossPassThrough（E3D EDGTUBING.line 跳 ATTA：ATTA 处断开的直管合成一条轴线）', () => {
  const RADIUS = 0.05715;
  const point = (position: readonly number[], noun: string, number: number): TubingAxisEndPoint => ({
    position: position as TubingVec3,
    label: `${noun} P-Point #${number}`,
    noun,
  });
  const piece = (
    id: string,
    start: readonly number[],
    end: readonly number[],
    startPoint: TubingAxisEndPoint | null,
    endPoint: TubingAxisEndPoint | null,
  ): TubingAxisPiece => ({
    id,
    axis: { start: start as TubingVec3, end: end as TubingVec3, radius: RADIUS, startPoint, endPoint },
  });

  // 实机 BRAN 24381/145018 的成员序：ELBO → ATTA → ELBO → ATTA → ELBO …；ATTA 的 P1 = P2 = 原点，落在管身轴线上。
  const elboA = point([0, 0, 0], 'ELBO', 2);
  const atta1 = point([0, 0, 1.0], 'ATTA', 2);
  const elboB = point([0, 0, 2.5], 'ELBO', 1);
  const atta2 = point([0, 0, 2.5 + 0.8], 'ATTA', 1);
  const elboC = point([0, 0, 4.0], 'ELBO', 1);
  const TOL = 0.003;

  it('ATTA 是穿过点，其它 noun（含空）不是；大小写与空白不敏感', () => {
    expect(isTubingPassThroughPoint(atta1)).toBe(true);
    expect(isTubingPassThroughPoint({ position: [0, 0, 0], noun: ' atta ' })).toBe(true);
    expect(isTubingPassThroughPoint(elboA)).toBe(false);
    expect(isTubingPassThroughPoint({ position: [0, 0, 0], noun: 'OLET' })).toBe(false);
    expect(isTubingPassThroughPoint({ position: [0, 0, 0] })).toBe(false);
    expect(isTubingPassThroughPoint(null)).toBe(false);
  });

  it('拾中前段、终点在 ATTA 上：接上另一侧的共线段，轴线 = ELBO.leave → 下一非 ATTA 构件 arrive，ATTA 记入 passThrough', () => {
    const hit = piece('o:b:0', [0, 0, 0], [0, 0, 1.0], elboA, atta1);
    const merged = mergeTubingAxisAcrossPassThrough(hit, [
      piece('o:b:1', [0, 0, 1.0], [0, 0, 2.5], atta1, elboB),
    ], { tolerance: TOL });
    close(merged.start, [0, 0, 0]);
    close(merged.end, [0, 0, 2.5]);
    expect(merged.startPoint?.label).toBe('ELBO P-Point #2');
    expect(merged.endPoint?.label).toBe('ELBO P-Point #1');
    expect(merged.pieces).toEqual(['o:b:0', 'o:b:1']);
    expect(merged.passThrough.map((p) => p.label)).toEqual(['ATTA P-Point #2']);
    expect(merged.radius).toBe(RADIUS);
  });

  it('拾中后段、起点在 ATTA 上：向后接；另一段方向相反也能接（不改拾中段的朝向）；连续两个 ATTA 一路穿过', () => {
    // 拾中中段 o:b:1（ATTA1 → ATTA2），前面 o:b:0 反向摆放（ELBO A 在 end），后面 o:b:2 正向。
    const hit = piece('o:b:1', [0, 0, 1.0], [0, 0, 3.3], atta1, atta2);
    const merged = mergeTubingAxisAcrossPassThrough(hit, [
      piece('o:b:2', [0, 0, 3.3], [0, 0, 4.0], atta2, elboC),
      piece('o:b:0', [0, 0, 1.0], [0, 0, 0], atta1, elboA),
    ], { tolerance: TOL });
    close(merged.start, [0, 0, 0]);
    close(merged.end, [0, 0, 4.0]);
    expect(merged.startPoint).toBe(elboA);
    expect(merged.endPoint).toBe(elboC);
    expect(merged.pieces).toEqual(['o:b:0', 'o:b:1', 'o:b:2']);
    expect(merged.passThrough).toEqual([atta1, atta2]);
    // 朝向沿拾中段：start → end 仍是 +z。
    expect(merged.end[2]).toBeGreaterThan(merged.start[2]);
  });

  it('不是 ATTA 的零长构件（OLET arrive = leave）不穿过：E3D 的管线在它那里就停', () => {
    const olet = point([0, 0, 1.0], 'OLET', 1);
    const hit = piece('o:b:0', [0, 0, 0], [0, 0, 1.0], elboA, olet);
    const merged = mergeTubingAxisAcrossPassThrough(hit, [
      piece('o:b:1', [0, 0, 1.0], [0, 0, 2.5], olet, elboB),
    ], { tolerance: TOL });
    expect(merged.pieces).toEqual(['o:b:0']);
    expect(merged.passThrough).toEqual([]);
    close(merged.end, [0, 0, 1.0]);
    expect(merged.endPoint).toBe(olet);
  });

  it('ATTA 另一侧没有共线段（拐弯、离得远、或根本没画）时保留 ATTA 端点；同一点多段候选取端点最近的一段', () => {
    const hit = piece('o:b:0', [0, 0, 0], [0, 0, 1.0], elboA, atta1);
    // 拐弯：另一段从 ATTA 出发沿 +x 走。
    const bent = mergeTubingAxisAcrossPassThrough(hit, [
      piece('o:b:1', [0, 0, 1.0], [1.5, 0, 1.0], atta1, elboB),
    ], { tolerance: TOL });
    expect(bent.pieces).toEqual(['o:b:0']);
    close(bent.end, [0, 0, 1.0]);
    expect(bent.endPoint).toBe(atta1);

    // 共线但端点离 ATTA 超容差（另一根平行管）不接；并且往回（−z 侧）的共线段不算「继续」。
    const gapped = mergeTubingAxisAcrossPassThrough(hit, [
      piece('o:b:1', [0, 0, 1.02], [0, 0, 2.5], null, elboB),
      piece('o:b:9', [0, 0, 1.0], [0, 0, 0.2], atta1, null),
    ], { tolerance: TOL });
    expect(gapped.pieces).toEqual(['o:b:0']);

    // 两段都碰到 ATTA：端点更近的那段赢。
    const crowded = mergeTubingAxisAcrossPassThrough(hit, [
      piece('o:b:1', [0, 0, 1.002], [0, 0, 2.5], atta1, elboB),
      piece('o:b:2', [0, 0, 1.0005], [0, 0, 2.0], atta1, point([0, 0, 2.0], 'VALV', 1)),
    ], { tolerance: TOL });
    expect(crowded.pieces).toEqual(['o:b:0', 'o:b:2']);
    close(crowded.end, [0, 0, 2.0]);

    // 没有别的段 / 容差非正：原样返回，pieces 只有自己。
    expect(mergeTubingAxisAcrossPassThrough(hit, [], { tolerance: TOL }).pieces).toEqual(['o:b:0']);
    expect(mergeTubingAxisAcrossPassThrough(hit, [piece('o:b:1', [0, 0, 1.0], [0, 0, 2.5], atta1, elboB)], { tolerance: 0 }).pieces)
      .toEqual(['o:b:0']);
  });

  it('共线判据：缺省 0.5°，略微偏转的段仍接，偏 1° 的段不接；可自定义穿过判据', () => {
    const hit = piece('o:b:0', [0, 0, 0], [0, 0, 1.0], elboA, atta1);
    const tilt = (deg: number): readonly number[] => [Math.sin((deg * Math.PI) / 180) * 1.5, 0, 1.0 + Math.cos((deg * Math.PI) / 180) * 1.5];
    expect(DEFAULT_TUBING_MERGE_MIN_COS).toBeCloseTo(Math.cos((0.5 * Math.PI) / 180), 12);
    const slight = mergeTubingAxisAcrossPassThrough(hit, [piece('o:b:1', [0, 0, 1.0], tilt(0.2), atta1, elboB)], { tolerance: TOL });
    expect(slight.pieces).toEqual(['o:b:0', 'o:b:1']);
    const bent = mergeTubingAxisAcrossPassThrough(hit, [piece('o:b:1', [0, 0, 1.0], tilt(1), atta1, elboB)], { tolerance: TOL });
    expect(bent.pieces).toEqual(['o:b:0']);

    // 自定义穿过判据：把 OLET 也当穿过点（非 E3D 口径，只验证注入生效）。
    const olet = point([0, 0, 1.0], 'OLET', 1);
    const hitOlet = piece('o:b:0', [0, 0, 0], [0, 0, 1.0], elboA, olet);
    const custom = mergeTubingAxisAcrossPassThrough(hitOlet, [piece('o:b:1', [0, 0, 1.0], [0, 0, 2.5], olet, elboB)], {
      tolerance: TOL,
      isPassThrough: (p) => p.noun === 'OLET',
    });
    expect(custom.pieces).toEqual(['o:b:0', 'o:b:1']);
  });

  it('端到端：两段实机尺寸的直管经 refineTubingAxisEnds 吸到同一 ATTA 点后合并，Mid-Point 落在合并后轴线的中点', () => {
    const points: TubingAxisEndPoint[] = [elboA, atta1, elboB];
    const a: TubingAxis = { start: [0.0004, 0, 0.0002], end: [0, 0.0003, 0.9995], radius: RADIUS };
    const b: TubingAxis = { start: [0.0002, 0, 1.0006], end: [0, 0, 2.5004], radius: RADIUS };
    const tolerance = tubingEndTolerance(a, 0.002);
    const refinedA: RefinedTubingAxis = refineTubingAxisEnds(a, points, tolerance);
    const refinedB: RefinedTubingAxis = refineTubingAxisEnds(b, points, tolerance);
    expect(refinedA.endPoint).toBe(atta1);
    expect(refinedB.startPoint).toBe(atta1);
    const merged = mergeTubingAxisAcrossPassThrough({ id: 'a', axis: refinedA }, [{ id: 'b', axis: refinedB }], { tolerance });
    expect(merged.pieces).toEqual(['a', 'b']);
    close(merged.start, [0, 0, 0]);
    close(merged.end, [0, 0, 2.5]);
    const mid: TubingVec3 = [(merged.start[0] + merged.end[0]) / 2, (merged.start[1] + merged.end[1]) / 2, (merged.start[2] + merged.end[2]) / 2];
    close(mid, [0, 0, 1.25]);
  });
});
