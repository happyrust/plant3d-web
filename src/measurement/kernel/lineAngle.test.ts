import { describe, expect, it } from 'vitest';

import {
  LINE_ANGLE_IN_PLANE_RADIUS_M,
  LINE_ANGLE_MIN_RADIUS_M,
  LINE_ANGLE_PARALLEL_TOLERANCE_DEG,
  buildLineAngle,
  lineAngleArmEnd,
  type LineAngleLineOperand,
  type LineAnglePlaneOperand,
} from './lineAngle';
import { buildThreePointAngle } from './threePointAngle';

import type { PickVec3 } from './pickDerivation';

function line(start: PickVec3, end: PickVec3, picked: PickVec3): LineAngleLineOperand {
  return { kind: 'line', start, end, picked };
}

function plane(position: PickVec3, normal: PickVec3, xDirection?: PickVec3): LineAnglePlaneOperand {
  return { kind: 'plane', position, normal, ...(xDirection ? { xDirection } : {}) };
}

function expectVec(actual: PickVec3, expected: PickVec3, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

function ok(result: ReturnType<typeof buildLineAngle>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.value;
}

const COS60 = 0.5;
const SIN60 = Math.sqrt(3) / 2;

// `radius2Lines` 802–917: base line along E through the origin, reference line along N at x = 1.
const BASE_E = line([0, 0, 0], [2, 0, 0], [1.5, 0, 0]);
const REF_N = line([1, -1, 0], [1, 1, 0], [1, 0.5, 0]);

describe('buildLineAngle · two lines (gmfArc.radius2Lines, two-edge branch)', () => {
  it('coplanar crossing lines: root at the intersection, arms E / N, 90°, plane normal from arm order', () => {
    const value = ok(buildLineAngle(BASE_E, REF_N));
    expect(value.kind).toBe('line-line');
    expectVec(value.root, [1, 0, 0]);
    expectVec(value.direction1, [1, 0, 0]);
    expectVec(value.direction2, [0, 1, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expectVec(value.planeNormal!, [0, 0, 1]);
    expect(value.skew).toBe(false);
    expect(value.gapM).toBeCloseTo(0, 12);
    expect(value.inPlane).toBe(false);
    // root inside the base segment → half of the shorter line (both 2 m) = 1 m.
    expect(value.radiusM).toBeCloseTo(1, 9);
  });

  it('the picked side of the reference line decides the second arm (871–890 direction flip)', () => {
    const value = ok(buildLineAngle(BASE_E, line([1, -1, 0], [1, 1, 0], [1, -0.5, 0])));
    expectVec(value.direction2, [0, -1, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expectVec(value.planeNormal!, [0, 0, -1]);
  });

  it('oblique lines report the angle between the picked half-lines: 60° or its supplement 120°', () => {
    const d: PickVec3 = [COS60, SIN60, 0];
    const ref = (picked: PickVec3) => line([1 - d[0], -d[1], 0], [1 + d[0], d[1], 0], picked);
    const near = ok(buildLineAngle(BASE_E, ref([1 + 0.25, 0.25 * Math.sqrt(3), 0])));
    expect(near.angleDeg).toBeCloseTo(60, 9);
    expectVec(near.direction2, d);
    const far = ok(buildLineAngle(BASE_E, ref([1 - 0.25, -0.25 * Math.sqrt(3), 0])));
    expect(far.angleDeg).toBeCloseTo(120, 9);
    expectVec(far.direction2, [-COS60, -SIN60, 0]);
    // Picking the base line on the other side of the root flips Direction1 the same way.
    const baseLeft = line([0, 0, 0], [2, 0, 0], [0.5, 0, 0]);
    const left = ok(buildLineAngle(baseLeft, ref([1 + 0.25, 0.25 * Math.sqrt(3), 0])));
    expectVec(left.direction1, [-1, 0, 0]);
    expect(left.angleDeg).toBeCloseTo(120, 9);
  });

  it('skew lines: root on the base line nearest the reference, second arm moved onto the root, gap reported', () => {
    const value = ok(buildLineAngle(BASE_E, line([1, -1, 0.3], [1, 1, 0.3], [1, 0.5, 0.3])));
    expectVec(value.root, [1, 0, 0]);
    expectVec(value.direction1, [1, 0, 0]);
    expectVec(value.direction2, [0, 1, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expect(value.skew).toBe(true);
    expect(value.gapM).toBeCloseTo(0.3, 9);
  });

  it('parallel lines cannot make an arc (E3D "Unable to derive arc from given lines")', () => {
    const result = buildLineAngle(BASE_E, line([0, 1, 0], [2, 1, 0], [1, 1, 0]));
    expect(result).toEqual({ ok: false, reason: 'parallel-lines' });
    const antiParallel = buildLineAngle(BASE_E, line([2, 1, 0.5], [0, 1, 0.5], [1, 1, 0.5]));
    expect(antiParallel).toEqual({ ok: false, reason: 'parallel-lines' });
  });

  it('design-parallel mesh edges a few 1e-5 rad apart count as parallel (Web tolerance 0.01°), 0.02° apart do not', () => {
    // Live case (PANE edge vs SCTN edge, float32 vertices): directions 1e-5 rad apart, offset 5.9 m —
    // a bare cross-product test put the root 762 km away and reported 0.0004°.
    const tiny = Math.tan((0.0004 * Math.PI) / 180);
    const almostParallel = buildLineAngle(BASE_E, line([0, 5.9, 0], [2, 5.9 + 2 * tiny, 0], [1, 5.9 + tiny, 0]));
    expect(almostParallel).toEqual({ ok: false, reason: 'parallel-lines' });
    expect(LINE_ANGLE_PARALLEL_TOLERANCE_DEG).toBe(0.01);
    // Twice the tolerance is a real (if tiny) angle and still resolves, far root and all.
    const small = Math.tan((0.02 * Math.PI) / 180);
    const resolved = ok(buildLineAngle(BASE_E, line([0, 5.9, 0], [2, 5.9 + 2 * small, 0], [1, 5.9 + small, 0])));
    expect(resolved.angleDeg).toBeCloseTo(0.02, 6);
    // The same tolerance rejects a line lying 0.005° off a plane it does not touch.
    const grazing = buildLineAngle(
      line([0, 0, 1], [2, 0, 1 + 2 * Math.tan((0.005 * Math.PI) / 180)], [1, 0, 1]),
      plane([0, 0, 0], [0, 0, 1]),
    );
    expect(grazing).toEqual({ ok: false, reason: 'line-parallel-to-plane' });
  });

  it('root outside the base segment: Direction1 points back towards the pick, radius = distance to the nearer base end (892–894)', () => {
    const value = ok(buildLineAngle(line([0, 0, 0], [1, 0, 0], [0.8, 0, 0]), line([3, -1, 0], [3, 1, 0], [3, 0.5, 0])));
    expectVec(value.root, [3, 0, 0]);
    expectVec(value.direction1, [-1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expect(value.radiusM).toBeCloseTo(2, 9);
  });

  it('radius never drops below 500 mm (901–903)', () => {
    const value = ok(buildLineAngle(
      line([0, 0, 0], [0.2, 0, 0], [0.15, 0, 0]),
      line([0.1, -0.1, 0], [0.1, 0.1, 0], [0.1, 0.05, 0]),
    ));
    expect(value.radiusM).toBe(LINE_ANGLE_MIN_RADIUS_M);
  });

  it('a pick exactly at the root keeps the stored line direction (Web resolution of the 858–863 corner case)', () => {
    const value = ok(buildLineAngle(line([0, 0, 0], [2, 0, 0], [1, 0, 0]), REF_N));
    expectVec(value.direction1, [1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
  });

  it('arm ends at the radius reproduce the arc through the three-point kernel (same Measure Angle form)', () => {
    const value = ok(buildLineAngle(BASE_E, REF_N));
    const first = lineAngleArmEnd(value, 'first');
    const second = lineAngleArmEnd(value, 'second');
    expectVec(first, [2, 0, 0]);
    expectVec(second, [1, 1, 0]);
    const built = buildThreePointAngle(value.root, first, second);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.angleDeg).toBeCloseTo(value.angleDeg, 9);
    expectVec(built.value.direction1, value.direction1);
    expectVec(built.value.direction2, value.direction2);
    expect(built.value.radiusM).toBeCloseTo(value.radiusM, 9);
  });
});

describe('buildLineAngle · line + facet plane (radius2Lines 826–854 projected-line branch)', () => {
  const GROUND = plane([0, 0, 0], [0, 0, 1]);

  it('general case: root where the base line pierces the plane, second arm = projection, acute angle', () => {
    const value = ok(buildLineAngle(line([0, 0, 0], [1, 0, 1], [0.8, 0, 0.8]), GROUND));
    expect(value.kind).toBe('line-plane');
    expectVec(value.root, [0, 0, 0]);
    expectVec(value.direction1, [Math.SQRT1_2, 0, Math.SQRT1_2]);
    expectVec(value.direction2, [1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(45, 9);
    expectVec(value.planeNormal!, [0, 1, 0]);
    expect(value.inPlane).toBe(false);
    // reference = projected line (1 m) → half of the shorter line = 0.5 m.
    expect(value.radiusM).toBeCloseTo(0.5, 9);
  });

  it('the projected arm follows the picked side, so the angle stays the acute line–plane angle', () => {
    const value = ok(buildLineAngle(line([-1, 0, -1], [1, 0, 1], [-0.5, 0, -0.5]), GROUND));
    expectVec(value.root, [0, 0, 0]);
    expectVec(value.direction1, [-Math.SQRT1_2, 0, -Math.SQRT1_2]);
    expectVec(value.direction2, [-1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(45, 9);
  });

  it('base line lying in the plane: E3D zero-angle arc (radius 100 mm, both arms along the line)', () => {
    const value = ok(buildLineAngle(line([0, 0, 0], [1, 0, 0], [0.5, 0, 0]), GROUND));
    expect(value.inPlane).toBe(true);
    expect(value.angleDeg).toBe(0);
    expectVec(value.root, [0, 0, 0]);
    expectVec(value.direction1, [1, 0, 0]);
    expectVec(value.direction2, [1, 0, 0]);
    expect(value.radiusM).toBe(LINE_ANGLE_IN_PLANE_RADIUS_M);
    expect(value.planeNormal).toBeNull();
    // 0.1 mm tolerance (830): a line 0.05 mm above the plane still counts as lying in it.
    expect(ok(buildLineAngle(line([0, 0, 0.00005], [1, 0, 0.00005], [0.5, 0, 0.00005]), GROUND)).inPlane).toBe(true);
    expect(buildLineAngle(line([0, 0, 0.0002], [1, 0, 0.0002], [0.5, 0, 0.0002]), GROUND)).toEqual({
      ok: false,
      reason: 'line-parallel-to-plane',
    });
  });

  it('base line perpendicular to the plane: 90° against an in-plane direction (840–843, item X or a world axis)', () => {
    const value = ok(buildLineAngle(line([0, 0, -1], [0, 0, 1], [0, 0, 0.5]), GROUND));
    expectVec(value.root, [0, 0, 0]);
    expectVec(value.direction1, [0, 0, 1]);
    expectVec(value.direction2, [1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expect(value.radiusM).toBeCloseTo(1, 9);
    const withX = ok(buildLineAngle(line([0, 0, -1], [0, 0, 1], [0, 0, -0.5]), plane([0, 0, 0], [0, 0, 1], [0, 1, 0])));
    expectVec(withX.direction1, [0, 0, -1]);
    expectVec(withX.direction2, [0, 1, 0]);
    expect(withX.angleDeg).toBeCloseTo(90, 9);
  });

  it('base line parallel to the plane but off it: its projection is parallel → no arc', () => {
    expect(buildLineAngle(line([0, 0, 1], [1, 0, 1], [0.5, 0, 1]), GROUND)).toEqual({
      ok: false,
      reason: 'line-parallel-to-plane',
    });
  });

  it('accepts a plane given with an unnormalised normal and an arbitrary position on it', () => {
    const tilted = plane([5, 5, 5], [0, 0, 3]);
    const value = ok(buildLineAngle(line([0, 0, 5], [1, 0, 6], [0.8, 0, 5.8]), tilted));
    expectVec(value.root, [0, 0, 5]);
    expect(value.angleDeg).toBeCloseTo(45, 9);
  });
});

describe('buildLineAngle · degenerate input', () => {
  it('rejects zero-length lines, degenerate planes and non-finite coordinates', () => {
    expect(buildLineAngle(line([0, 0, 0], [0, 0, 0], [0, 0, 0]), REF_N)).toEqual({ ok: false, reason: 'zero-length-line' });
    expect(buildLineAngle(BASE_E, line([1, 1, 0], [1, 1, 0], [1, 1, 0]))).toEqual({ ok: false, reason: 'zero-length-line' });
    expect(buildLineAngle(BASE_E, plane([0, 0, 0], [0, 0, 0]))).toEqual({ ok: false, reason: 'degenerate-plane' });
    expect(buildLineAngle(line([Number.NaN, 0, 0], [1, 0, 0], [0.5, 0, 0]), REF_N)).toEqual({ ok: false, reason: 'non-finite-input' });
    expect(buildLineAngle(BASE_E, line([1, -1, 0], [1, 1, 0], [1, Number.POSITIVE_INFINITY, 0]))).toEqual({
      ok: false,
      reason: 'non-finite-input',
    });
    expect(buildLineAngle(BASE_E, plane([0, 0, 0], [0, Number.NaN, 1]))).toEqual({ ok: false, reason: 'non-finite-input' });
  });
});
