import { describe, expect, it } from 'vitest';

import { applyHomography, unitSquareToQuad } from './homography';

import type { ScreenQuad } from './homography';
import type { Vec2 } from '../types';

const UNIT_CORNERS: readonly Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

function expectPoint(actual: Vec2, expected: Vec2): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe('unitSquareToQuad', () => {
  it('maps the unit square corners onto a parallelogram affinely', () => {
    const quad: ScreenQuad = [[100, 100], [110, 102], [113, 92], [103, 90]];
    const map = unitSquareToQuad(quad);
    expect(map.g).toBe(0);
    expect(map.h).toBe(0);
    UNIT_CORNERS.forEach((corner, index) => {
      expectPoint(applyHomography(map, corner), quad[index]!);
    });
    // Affine: the square centre lands on the parallelogram centre.
    expectPoint(applyHomography(map, [0.5, 0.5]), [106.5, 96]);
  });

  it('maps the unit square corners onto a perspective trapezoid', () => {
    const quad: ScreenQuad = [[0, 0], [4, 0], [3, 1], [1, 1]];
    const map = unitSquareToQuad(quad);
    expect(map.g).not.toBe(0);
    UNIT_CORNERS.forEach((corner, index) => {
      expectPoint(applyHomography(map, corner), quad[index]!);
    });
    // Projective: the square centre lands where the quad's diagonals cross,
    // not at the mean of the corners.
    expectPoint(applyHomography(map, [0.5, 0.5]), [2, 2 / 3]);
    // Straight lines stay straight: the midpoint of the top edge maps onto
    // the top edge of the quad.
    const top = applyHomography(map, [0.5, 1]);
    expect(top[1]).toBeCloseTo(1, 9);
    expect(top[0]).toBeCloseTo(2, 9);
  });

  it('extends beyond the unit square consistently with the frame axes', () => {
    const quad: ScreenQuad = [[10, 10], [20, 10], [20, 0], [10, 0]];
    const map = unitSquareToQuad(quad);
    expectPoint(applyHomography(map, [-0.5, 0]), [5, 10]);
    expectPoint(applyHomography(map, [2, -1]), [30, 20]);
  });

  it('does not divide by zero on a collapsed quad', () => {
    const quad: ScreenQuad = [[5, 5], [5, 5], [5, 5], [5, 5]];
    const map = unitSquareToQuad(quad);
    const point = applyHomography(map, [0.3, 0.7]);
    expect(point.every(Number.isFinite)).toBe(true);
    expectPoint(point, [5, 5]);
  });
});
