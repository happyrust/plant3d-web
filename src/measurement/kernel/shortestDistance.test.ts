import { describe, expect, it } from 'vitest';

import { LINE_ANGLE_PARALLEL_TOLERANCE_DEG } from './lineAngle';
import {
  SHORTEST_ZERO_DISTANCE_M,
  buildShortestDistance,
  type ShortestLineOperand,
  type ShortestOperand,
  type ShortestPlaneOperand,
} from './shortestDistance';

import type { PickVec3 } from './pickDerivation';

const point = (position: PickVec3): ShortestOperand => ({ kind: 'point', position });
const line = (start: PickVec3, end: PickVec3, picked?: PickVec3): ShortestLineOperand => ({ kind: 'line', start, end, ...(picked ? { picked } : {}) });
const plane = (position: PickVec3, normal: PickVec3, picked?: PickVec3): ShortestPlaneOperand => ({ kind: 'plane', position, normal, ...(picked ? { picked } : {}) });

function expectVec(actual: PickVec3, expected: PickVec3, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

function ok(result: ReturnType<typeof buildShortestDistance>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.value;
}

// gmfLine.shortest 800–908: base line along E through the origin; a second line along N at x = 1, 0.5 m up.
const LINE_E = line([0, 0, 0], [2, 0, 0], [1.5, 0, 0]);
const GROUND = plane([0, 0, 0], [0, 0, 1], [0.3, 0.4, 0]);

describe('buildShortestDistance · point branches (807–834)', () => {
  it('point × point: the two points, witness order = pick order', () => {
    const value = ok(buildShortestDistance(point([0, 0, 0]), point([3, 4, 0])));
    expect(value.kind).toBe('point-point');
    expectVec(value.start, [0, 0, 0]);
    expectVec(value.end, [3, 4, 0]);
    expect(value.distanceM).toBeCloseTo(5, 12);
    expectVec(value.direction, [0.6, 0.8, 0]);
    expect(value.parallel).toBe(false);
    expect(value.skew).toBe(false);
  });

  it('point × line: foot on the infinite line (LINE.near, beyond the segment extent too); order follows the picks', () => {
    const value = ok(buildShortestDistance(point([5, 3, 0]), LINE_E));
    expect(value.kind).toBe('point-line');
    expectVec(value.start, [5, 3, 0]);
    expectVec(value.end, [5, 0, 0]); // x = 5 is outside the 0..2 segment — not clamped.
    expect(value.distanceM).toBeCloseTo(3, 12);
    const flipped = ok(buildShortestDistance(LINE_E, point([5, 3, 0])));
    expectVec(flipped.start, [5, 0, 0]);
    expectVec(flipped.end, [5, 3, 0]);
  });

  it('point × plane: foot on the infinite plane (PLANE.near); an unnormalised normal is fine', () => {
    const value = ok(buildShortestDistance(point([7, -2, 1.25]), plane([0, 0, 0], [0, 0, 4])));
    expect(value.kind).toBe('point-plane');
    expectVec(value.end, [7, -2, 0]);
    expect(value.distanceM).toBeCloseTo(1.25, 12);
    expectVec(value.direction, [0, 0, -1]);
    const flipped = ok(buildShortestDistance(GROUND, point([7, -2, 1.25])));
    expectVec(flipped.start, [7, -2, 0]);
    expectVec(flipped.end, [7, -2, 1.25]);
  });

  it('a point lying on the line / plane is zero distance → refused (E3D: unset LINE, field 0)', () => {
    expect(buildShortestDistance(point([1, 0, 0]), LINE_E)).toEqual({ ok: false, reason: 'zero-distance' });
    expect(buildShortestDistance(point([1, 2, 0]), GROUND)).toEqual({ ok: false, reason: 'zero-distance' });
    expect(buildShortestDistance(point([1, 1, 1]), point([1, 1, 1]))).toEqual({ ok: false, reason: 'zero-distance' });
    expect(SHORTEST_ZERO_DISTANCE_M).toBe(1e-9);
  });
});

describe('buildShortestDistance · line × line (837–851)', () => {
  it('parallel lines: start = the position picked on the first line, end = its foot on the second (839–845)', () => {
    const second = line([0, 0.5, 0.3], [2, 0.5, 0.3]);
    const value = ok(buildShortestDistance(LINE_E, second));
    expect(value.kind).toBe('line-line');
    expect(value.parallel).toBe(true);
    expectVec(value.start, [1.5, 0, 0]); // the picked position, not the midpoint or an end
    expectVec(value.end, [1.5, 0.5, 0.3]);
    expect(value.distanceM).toBeCloseTo(Math.hypot(0.5, 0.3), 12);
    // Without a picked position the line's start is used (`handle any` → startPosition, 842–844).
    const noPick = ok(buildShortestDistance(line([0, 0, 0], [2, 0, 0]), second));
    expectVec(noPick.start, [0, 0, 0]);
  });

  it('the picked position is snapped onto the infinite line before it becomes the start witness', () => {
    const value = ok(buildShortestDistance(line([0, 0, 0], [2, 0, 0], [0.7, 0.002, -0.001]), line([0, 1, 0], [2, 1, 0])));
    expectVec(value.start, [0.7, 0, 0]);
    expectVec(value.end, [0.7, 1, 0]);
  });

  it('skew lines: the common perpendicular — mutual nearest points (847–850), skew flagged', () => {
    const second = line([1, -1, 0.5], [1, 1, 0.5], [1, 0.8, 0.5]);
    const value = ok(buildShortestDistance(LINE_E, second));
    expect(value.parallel).toBe(false);
    expect(value.skew).toBe(true);
    expectVec(value.start, [1, 0, 0]);
    expectVec(value.end, [1, 0, 0.5]);
    expect(value.distanceM).toBeCloseTo(0.5, 12);
    expectVec(value.direction, [0, 0, 1]);
  });

  it('crossing lines meet → zero distance refused', () => {
    expect(buildShortestDistance(LINE_E, line([1, -1, 0], [1, 1, 0]))).toEqual({ ok: false, reason: 'zero-distance' });
  });

  it('design-parallel mesh edges a few 1e-5 rad apart count as parallel (0.01° Web tolerance); 0.02° apart do not', () => {
    const angleOf = (deg: number) => (deg * Math.PI) / 180;
    const almost = line([0, 1, 0], [2 * Math.cos(angleOf(0.005)), 1 + 2 * Math.sin(angleOf(0.005)), 0]);
    const value = ok(buildShortestDistance(LINE_E, almost));
    expect(value.parallel).toBe(true);
    expectVec(value.start, [1.5, 0, 0]);
    const apart = line([0, 1, 0], [2 * Math.cos(angleOf(0.02)), 1 + 2 * Math.sin(angleOf(0.02)), 0]);
    const crossing = buildShortestDistance(LINE_E, apart);
    // Coplanar lines 0.02° apart cross far away (≈ 2.9 km) → zero distance, not a parallel witness pair.
    expect(crossing).toEqual({ ok: false, reason: 'zero-distance' });
    expect(LINE_ANGLE_PARALLEL_TOLERANCE_DEG).toBe(0.01);
  });
});

describe('buildShortestDistance · line × plane (854–880)', () => {
  it('line parallel to the plane: picked position on the line and its foot on the plane; start stays on the line whichever was picked first (856–874)', () => {
    const raised = line([0, 0, 0.2], [2, 0, 0.2], [0.5, 0, 0.2]);
    const value = ok(buildShortestDistance(raised, GROUND));
    expect(value.kind).toBe('line-plane');
    expect(value.parallel).toBe(true);
    expectVec(value.start, [0.5, 0, 0.2]);
    expectVec(value.end, [0.5, 0, 0]);
    expect(value.distanceM).toBeCloseTo(0.2, 12);
    const planeFirst = ok(buildShortestDistance(GROUND, raised));
    expectVec(planeFirst.start, [0.5, 0, 0.2]);
    expectVec(planeFirst.end, [0.5, 0, 0]);
  });

  it('a line not parallel to the plane pierces it somewhere → zero distance, even if the finite edge stops short', () => {
    expect(buildShortestDistance(line([0, 0, 1], [1, 0, 1.1]), GROUND)).toEqual({ ok: false, reason: 'zero-distance' });
  });

  it('a line lying in the plane is zero distance', () => {
    expect(buildShortestDistance(LINE_E, GROUND)).toEqual({ ok: false, reason: 'zero-distance' });
  });
});

describe('buildShortestDistance · plane × plane (883–897)', () => {
  it('parallel planes: start = the position picked on the first plane (Web resolution, not E3D\'s first-vertex fallback), end = its foot on the second', () => {
    const upper = plane([10, 10, 3], [0, 0, -1], [10.5, 9, 3]);
    const value = ok(buildShortestDistance(GROUND, upper));
    expect(value.kind).toBe('plane-plane');
    expect(value.parallel).toBe(true);
    expectVec(value.start, [0.3, 0.4, 0]); // GROUND's picked position, projected onto GROUND
    expectVec(value.end, [0.3, 0.4, 3]);
    expect(value.distanceM).toBeCloseTo(3, 12);
    const flipped = ok(buildShortestDistance(upper, GROUND));
    expectVec(flipped.start, [10.5, 9, 3]);
    expectVec(flipped.end, [10.5, 9, 0]);
    // No picked position → the plane's own position (E3D `plane.position` fallback, 889).
    const bare = ok(buildShortestDistance(plane([0, 0, 0], [0, 0, 1]), upper));
    expectVec(bare.start, [0, 0, 0]);
  });

  it('non-parallel planes always meet → zero distance', () => {
    expect(buildShortestDistance(GROUND, plane([0, 0, 0], [1, 0, 0.001]))).toEqual({ ok: false, reason: 'zero-distance' });
  });
});

describe('buildShortestDistance · degenerate input', () => {
  it('rejects zero-length lines, degenerate planes and non-finite coordinates', () => {
    expect(buildShortestDistance(line([1, 1, 1], [1, 1, 1]), point([0, 0, 0]))).toEqual({ ok: false, reason: 'zero-length-line' });
    expect(buildShortestDistance(point([0, 0, 0]), plane([0, 0, 0], [0, 0, 0]))).toEqual({ ok: false, reason: 'degenerate-plane' });
    expect(buildShortestDistance(point([Number.NaN, 0, 0]), point([1, 0, 0]))).toEqual({ ok: false, reason: 'non-finite-input' });
    expect(buildShortestDistance(line([0, 0, 0], [1, 0, 0], [Number.POSITIVE_INFINITY, 0, 0]), GROUND)).toEqual({ ok: false, reason: 'non-finite-input' });
    expect(buildShortestDistance(plane([0, 0, 0], [0, Number.NaN, 1]), point([1, 1, 1]))).toEqual({ ok: false, reason: 'non-finite-input' });
  });
});
