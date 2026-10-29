import { describe, expect, it } from 'vitest';

import { arcDirection, arcNear } from './arc';

import type { ArcFrame } from './arc';
import type { Vec3 } from '../../../types';

const SIN_30 = 0.5;
const COS_30 = Math.sqrt(3) / 2;

/** 最简弧：弧心原点、x 轴东向、绕向轴世界上方 → 平面是水平面，y = z × x = 北向。 */
const FLAT: ArcFrame = { centre: [0, 0, 0], xAxis: [1, 0, 0], zAxis: [0, 0, 1] };

function expectVec(actual: Vec3, expected: Vec3, digits = 12): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe('arcDirection — 径向（不是切向）', () => {
  it('θ = 0 is the (orthogonalized) x axis, θ = 90 is the y axis', () => {
    expectVec(arcDirection(FLAT, 0), [1, 0, 0]);
    // y = z × x = [0,0,1] × [1,0,0] = [0,1,0]
    expectVec(arcDirection(FLAT, 90), [0, 1, 0]);
    expectVec(arcDirection(FLAT, 180), [-1, 0, 0]);
    expectVec(arcDirection(FLAT, 270), [0, -1, 0]);
  });

  it('is a unit radial direction, never the tangent (tangent would be 90° ahead)', () => {
    // 切向实现会在 θ = 0 给出 y、θ = 90 给出 -x；这里钉住径向语义。
    const at0 = arcDirection(FLAT, 0);
    const at30 = arcDirection(FLAT, 30);
    expectVec(at0, [1, 0, 0]);
    expectVec(at30, [COS_30, SIN_30, 0]);
    expect(Math.hypot(...at30)).toBeCloseTo(1, 12);
  });

  it('accepts any real angle and is 360°-periodic', () => {
    expectVec(arcDirection(FLAT, 360), [1, 0, 0]);
    expectVec(arcDirection(FLAT, -90), [0, -1, 0]);
    expectVec(arcDirection(FLAT, 450), [0, 1, 0]);
  });

  it('orthogonalizes a non-orthogonal x axis before use (z wins)', () => {
    // x = [1,0,1]、z = [0,0,1] → x' = normalize([1,0,1] - [0,0,1]) = [1,0,0]，y = [0,1,0]
    const tilted: ArcFrame = { centre: [0, 0, 0], xAxis: [1, 0, 1], zAxis: [0, 0, 1] };
    expectVec(arcDirection(tilted, 0), [1, 0, 0]);
    expectVec(arcDirection(tilted, 90), [0, 1, 0]);
  });

  it('normalizes a non-unit z axis and keeps the arc plane perpendicular to it', () => {
    const scaled: ArcFrame = { centre: [0, 0, 0], xAxis: [2, 0, 0], zAxis: [0, 0, 3] };
    expectVec(arcDirection(scaled, 0), [1, 0, 0]);
    expectVec(arcDirection(scaled, 90), [0, 1, 0]);
  });

  it('is independent of the centre', () => {
    const moved: ArcFrame = { ...FLAT, centre: [5, -3, 7] };
    expectVec(arcDirection(moved, 0), [1, 0, 0]);
  });

  it('throws RangeError for a zero or parallel x axis, or a zero z axis', () => {
    expect(() => arcDirection({ ...FLAT, xAxis: [0, 0, 0] }, 0)).toThrow(RangeError);
    expect(() => arcDirection({ ...FLAT, xAxis: [0, 0, 2] }, 0)).toThrow(RangeError);
    expect(() => arcDirection({ ...FLAT, xAxis: [0, 0, -1] }, 0)).toThrow(RangeError);
    expect(() => arcDirection({ ...FLAT, zAxis: [0, 0, 0] }, 0)).toThrow(RangeError);
  });
});

describe('arcNear — 投影极角', () => {
  it('round-trips arcDirection for a sweep of angles', () => {
    for (const angle of [0, 30, 90, 179, 180, 270, 359.5]) {
      const point: Vec3 = [
        Math.cos((angle * Math.PI) / 180),
        Math.sin((angle * Math.PI) / 180),
        0,
      ];
      const near = arcNear(FLAT, point);
      expect(near).not.toBeNull();
      expect(near!).toBeCloseTo(angle, 9);
    }
  });

  it('round-trips through a translated, scaled, tilted frame', () => {
    const frame: ArcFrame = { centre: [2, 3, -4], xAxis: [1, 0, 1], zAxis: [0, 0, 5] };
    for (const angle of [0, 45, 135, 300]) {
      const direction = arcDirection(frame, angle);
      const point: Vec3 = [
        frame.centre[0] + direction[0] * 7,
        frame.centre[1] + direction[1] * 7,
        frame.centre[2] + direction[2] * 7,
      ];
      const near = arcNear(frame, point);
      expect(near).not.toBeNull();
      expect(near!).toBeCloseTo(angle, 9);
    }
  });

  it('drops the component along the arc axis and measures the in-plane projection', () => {
    // 平面内投影是 [1,1,0] → 45°；z 分量 5 被丢掉，不影响结果。
    expect(arcNear(FLAT, [1, 1, 5])).toBeCloseTo(45, 12);
    expect(arcNear(FLAT, [1, 1, -1000])).toBeCloseTo(45, 12);
    // 平面内投影是 [-1,-1,0] → 225°
    expect(arcNear(FLAT, [-2, -2, 0])).toBeCloseTo(225, 12);
  });

  it('measures from the centre, not from the world origin', () => {
    const moved: ArcFrame = { ...FLAT, centre: [10, 10, 0] };
    expect(arcNear(moved, [10 + COS_30, 10 + SIN_30, 0])).toBeCloseTo(30, 9);
    expect(arcNear(moved, [10, 10, 0])).toBeNull();
  });

  it('returns null when the in-plane projection collapses', () => {
    expect(arcNear(FLAT, [0, 0, 0])).toBeNull();
    // 沿轴偏移：投影长度 0
    expect(arcNear(FLAT, [0, 0, 9])).toBeNull();
    // 低于 EPSILON（1e-9）的残余投影也视为退化
    expect(arcNear(FLAT, [1e-12, 0, 0])).toBeNull();
    expect(arcNear(FLAT, [Number.NaN, 0, 0])).toBeNull();
  });

  it('throws RangeError on the same degenerate frames as arcDirection', () => {
    expect(() => arcNear({ ...FLAT, xAxis: [0, 0, 0] }, [1, 0, 0])).toThrow(RangeError);
    expect(() => arcNear({ ...FLAT, xAxis: [0, 0, 1] }, [1, 0, 0])).toThrow(RangeError);
    expect(() => arcNear({ ...FLAT, zAxis: [0, 0, 0] }, [1, 0, 0])).toThrow(RangeError);
  });

  it('always returns an angle in [0, 360), including the -0 / 360 wrap', () => {
    // 刚好在 x 轴下方 → atan2 给 -0；归一后必须是 +0 而不是 -0。
    const justBelow = arcNear(FLAT, [1, -0, 0]);
    expect(justBelow).toBe(0);
    expect(Object.is(justBelow, -0)).toBe(false);
    // 极小的负角加 360 后浮点上正好落到 360，必须折回 0。
    const almostFull = arcNear(FLAT, [1, -1e-17, 0]);
    expect(almostFull).toBe(0);
    // 全周扫描：无一个值越界。
    for (let angle = -720; angle <= 720; angle += 7.5) {
      const radians = (angle * Math.PI) / 180;
      const near = arcNear(FLAT, [Math.cos(radians), Math.sin(radians), 0]);
      expect(near).not.toBeNull();
      expect(near!).toBeGreaterThanOrEqual(0);
      expect(near!).toBeLessThan(360);
    }
  });
});
