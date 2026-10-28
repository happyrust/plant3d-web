import { describe, expect, it } from 'vitest';

import { isoGetBestDir, isoGetDimDir, orthogonal } from './isoDirections';

import type { Vec3 } from '../../../types';

const E: Vec3 = [1, 0, 0];
const N: Vec3 = [0, 1, 0];
const U: Vec3 = [0, 0, 1];
const DIRS: readonly [Vec3, Vec3, Vec3] = [E, N, U];
const HALF_SQRT2 = Math.SQRT1_2;

function expectVec(actual: Vec3, expected: Vec3, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe('orthogonal (D2)', () => {
  it('is the normalized right-hand cross product', () => {
    expect(orthogonal(E, N)).toEqual([0, 0, 1]);
    expect(orthogonal(N, E)).toEqual([0, 0, -1]);
    expect(orthogonal([2, 0, 0], [0, 2, 0])).toEqual([0, 0, 1]);
  });

  it('has no answer for parallel or opposite directions', () => {
    expect(orthogonal(U, U)).toBeNull();
    expect(orthogonal(U, [0, 0, -1])).toBeNull();
  });
});

describe('isoGetBestDir', () => {
  it('keeps a direction that already points into the preferred half-space', () => {
    expect(isoGetBestDir([1, 0, 0], DIRS)).toEqual([1, 0, 0]);
    expect(isoGetBestDir([0.6, 0.8, 0], DIRS)).toEqual([0.6, 0.8, 0]);
  });

  it('flips a direction whose nearest axis sees it at more than 90°', () => {
    expect(isoGetBestDir([-1, 0, 0], DIRS)).toEqual([1, 0, 0]);
    expect(isoGetBestDir([0.6, -0.8, 0], DIRS)).toEqual([-0.6, 0.8, 0]);
    expect(isoGetBestDir([0, 0, -1], DIRS)).toEqual([0, 0, 1]);
  });

  it('D3 tie: equal folded angles pick the lower axis index (E before N) and flip', () => {
    expectVec(isoGetBestDir([-HALF_SQRT2, HALF_SQRT2, 0], DIRS), [HALF_SQRT2, -HALF_SQRT2, 0]);
  });
});

describe('isoGetDimDir', () => {
  it('takes the direction orthogonal to the pipe and the third preference, sign-corrected', () => {
    // E × U = S, which isoGetBestDir flips to N.
    expect(isoGetDimDir(E, DIRS)).toEqual([0, 1, 0]);
    // N × U = E already points along the first preference.
    expect(isoGetDimDir(N, DIRS)).toEqual([1, 0, 0]);
  });

  it('falls back to the second preference when the pipe is parallel to the third', () => {
    // U × U has no answer; U × N = W, flipped to E.
    expect(isoGetDimDir(U, DIRS)).toEqual([1, 0, 0]);
  });

  it('throws when the pipe is parallel to both fallbacks', () => {
    expect(() => isoGetDimDir(N, [E, N, [0, -1, 0]])).toThrow(RangeError);
  });
});
