import { describe, expect, it } from 'vitest';

import { Matrix4, Quaternion, Vector3 } from 'three';

import {
  refineTubingAxisEnds,
  tubingAxisFromBounds,
  tubingEndTolerance,
  type TubingAxis,
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
