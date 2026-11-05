import { describe, expect, it } from 'vitest';

import { angleDeg, bisect, offset, opposite, sameDirection } from './geometry';

import type { Vec3 } from '../../../types';

/** 这些是 PML 无源码内建（`DIRECTION.angle` / `.opposite` / `.bisect` / `pos.offset`）的等价实现。 */

function expectVec(actual: Vec3, expected: Vec3, digits = 12): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe('angleDeg — `DIRECTION.angle`', () => {
  it('is 0 for parallel, 90 for perpendicular, 180 for antiparallel', () => {
    expect(angleDeg([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(angleDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90, 12);
    expect(angleDeg([1, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 12);
  });

  it('is scale invariant (PML normalises internally)', () => {
    expect(angleDeg([2, 0, 0], [0, 5, 0])).toBeCloseTo(90, 12);
  });

  it('clamps the cosine so rounding cannot produce NaN', () => {
    // 同向单位向量点积可能到 1 + 1e-16。
    expect(Number.isNaN(angleDeg([1, 0, 0], [1, 0, 0]))).toBe(false);
  });

  it('returns NaN for a zero vector so callers must reject it', () => {
    expect(Number.isNaN(angleDeg([0, 0, 0], [1, 0, 0]))).toBe(true);
  });
});

describe('opposite — `DIRECTION.opposite`', () => {
  it('negates every component without producing -0', () => {
    const result = opposite([1, 0, -2]);
    expect(result).toEqual([-1, 0, 2]);
    expect(Object.is(result[1], 0)).toBe(true);
  });
});

describe('bisect — `DIRECTION.bisect`', () => {
  it('returns the normalised sum of two non-antiparallel directions', () => {
    expectVec(bisect([1, 0, 0], [0, 1, 0])!, [Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it('returns null for antiparallel input (PML raises at runtime)', () => {
    expect(bisect([1, 0, 0], [-1, 0, 0])).toBeNull();
  });

  it('returns null when the sum is a zero vector', () => {
    expect(bisect([0, 0, 0], [0, 0, 0])).toBeNull();
  });
});

describe('offset — `pos.offset(dir, distance)`', () => {
  it('adds dir * distance to the origin', () => {
    expect(offset([1, 2, 3], [0, 0, 1], 5)).toEqual([1, 2, 8]);
  });

  it('accepts a negative distance', () => {
    expect(offset([1, 2, 3], [0, 0, 1], -1)).toEqual([1, 2, 2]);
  });

  it('does not normalise the direction (PML offset takes the vector as given)', () => {
    expect(offset([0, 0, 0], [2, 0, 0], 3)).toEqual([6, 0, 0]);
  });
});

describe('sameDirection — `array.unique` 的逐分量比较', () => {
  it('is true within the default epsilon', () => {
    expect(sameDirection([1, 0, 0], [1 + 1e-12, 0, 0])).toBe(true);
  });

  it('is false beyond the epsilon', () => {
    expect(sameDirection([1, 0, 0], [1 + 1e-6, 0, 0])).toBe(false);
  });
});
