import { describe, expect, it } from 'vitest';

import { isoGetHandleDimDir } from './isoHandleDimDir';

import type { IsoUsedDir } from './isoHandleDimDir';
import type { Vec3 } from '../../../types';

const E: Vec3 = [1, 0, 0];
const N: Vec3 = [0, 1, 0];
const U: Vec3 = [0, 0, 1];
const D: Vec3 = [0, 0, -1];
const GOOD: readonly [Vec3, Vec3, Vec3] = [E, N, U];

function expectDir(actual: Vec3, expected: Vec3, digits = 6): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

function used(dir: Vec3, angle: number): IsoUsedDir {
  return { dir, angle };
}

describe('isoGetHandleDimDir', () => {
  it('falls back to isoGetDimDir when nothing is used yet', () => {
    expectDir(isoGetHandleDimDir(E, [], 30, GOOD), N);
  });

  it('falls back when the only used direction is parallel to the pipe', () => {
    expectDir(isoGetHandleDimDir(E, [used(E, 10)], 30, GOOD), N);
    expectDir(isoGetHandleDimDir(E, [used([-1, 0, 0], 10)], 30, GOOD), N);
  });

  it('takes the first preferred axis that is clear of the occupied interval', () => {
    // Pipe E, one used direction U: the plane is spanned by U and E, so the
    // occupied interval is centred on U. N is still free and is tried first.
    expectDir(isoGetHandleDimDir(E, [used(U, 10)], 30, GOOD), N);
  });

  it('skips preferred axes whose angle falls inside an occupied interval', () => {
    // With U and N both occupied, E is 0 degrees off the pipe and gets skipped
    // by the perpendicularity test; the remaining gaps decide the answer.
    const result = isoGetHandleDimDir(E, [used(U, 10), used(N, 10)], 30, GOOD);
    expectDir(result, [0, Math.SQRT1_2, Math.SQRT1_2]);
  });

  it('picks the widest narrow gap when no gap reaches minGapAngle', () => {
    const result = isoGetHandleDimDir(E, [used(U, 200), used(N, 200)], 90, GOOD);
    expectDir(result, [0, -Math.SQRT1_2, -Math.SQRT1_2]);
  });

  it('works with the pipe along U', () => {
    expectDir(isoGetHandleDimDir(U, [used(N, 10)], 30, GOOD), E);
  });

  it('ignores a used direction opposite to another one', () => {
    // U and D are antiparallel, so both map to the same interval; N stays free.
    expectDir(isoGetHandleDimDir(E, [used(U, 10), used(D, 10)], 30, GOOD), N);
  });

  it('returns a unit vector in every branch', () => {
    const branches: Vec3[] = [
      isoGetHandleDimDir(E, [], 30, GOOD),
      isoGetHandleDimDir(E, [used(U, 10)], 30, GOOD),
      isoGetHandleDimDir(E, [used(U, 10), used(N, 10)], 30, GOOD),
      isoGetHandleDimDir(E, [used(U, 200), used(N, 200)], 90, GOOD),
    ];
    for (const dir of branches) {
      expect(Math.hypot(dir[0], dir[1], dir[2])).toBeCloseTo(1, 9);
    }
  });
});
