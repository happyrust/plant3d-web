import { describe, expect, it } from 'vitest';

import { getGoodCheight, suiDirDis } from './getGoodCheight';
import { mbdTextLen } from './mbdTextLen';

import type { Vec3 } from '../../../types';

const X: Vec3 = [1, 0, 0];

describe('suiDirDis', () => {
  it('measures the projection onto the direction, unsigned', () => {
    expect(suiDirDis([0, 0, 0], X, [10, 0, 0])).toBe(10);
    expect(suiDirDis([0, 0, 0], X, [-10, 0, 0])).toBe(10);
    expect(suiDirDis([0, 0, 0], X, [10, 5, 0])).toBe(10);
  });

  it('returns 0 for coincident points', () => {
    expect(suiDirDis([3, 4, 5], X, [3, 4, 5])).toBe(0);
  });

  it('returns 0 for a zero direction', () => {
    expect(suiDirDis([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBe(0);
  });

  it('normalises the direction', () => {
    expect(suiDirDis([0, 0, 0], [2, 0, 0], [10, 0, 0])).toBe(10);
  });
});

describe('getGoodCheight', () => {
  it('divides the dimension length by the summed text width', () => {
    // One segment of 100 -> "100", width = 0.5741 + 0.5761 + 0.5761.
    const points: Vec3[] = [[0, 0, 0], [100, 0, 0]];
    const width = mbdTextLen('100');
    expect(getGoodCheight(points, X, 1)).toBeCloseTo(100 / width, 9);
  });

  it('sums the width of every segment, not just the last', () => {
    const points: Vec3[] = [[0, 0, 0], [100, 0, 0], [200, 0, 0]];
    const width = mbdTextLen('100') + mbdTextLen('100');
    expect(getGoodCheight(points, X, 1)).toBeCloseTo(200 / width, 9);
  });

  it('applies bili to the dimension length only', () => {
    const points: Vec3[] = [[0, 0, 0], [100, 0, 0]];
    const width = mbdTextLen('100');
    expect(getGoodCheight(points, X, 2)).toBeCloseTo(200 / width, 9);
  });

  it('strips a trailing .00 before measuring the width', () => {
    // 10 formats as "10", not "10.00", so its width is two characters.
    const points: Vec3[] = [[0, 0, 0], [10, 0, 0]];
    const width = mbdTextLen('10');
    expect(getGoodCheight(points, X, 1)).toBeCloseTo(10 / width, 9);
  });

  it('keeps one decimal when the first decimal is non-zero', () => {
    // 12.34 formats as "12.3" after the trailing-zero rule does not apply,
    // then the first-decimal rule is a no-op because '3' is not '0'.
    const points: Vec3[] = [[0, 0, 0], [12.34, 0, 0]];
    const width = mbdTextLen('12.34');
    expect(getGoodCheight(points, X, 1)).toBeCloseTo(12.34 / width, 9);
  });

  it('drops a trailing zero in the first decimal', () => {
    const points: Vec3[] = [[0, 0, 0], [12.3, 0, 0]];
    const width = mbdTextLen('12.3');
    expect(getGoodCheight(points, X, 1)).toBeCloseTo(12.3 / width, 9);
  });

  it('returns 0 when the path has no length', () => {
    expect(getGoodCheight([[0, 0, 0]], X, 1)).toBe(0);
    expect(getGoodCheight([], X, 1)).toBe(0);
    expect(getGoodCheight([[0, 0, 0], [0, 0, 0]], X, 1)).toBe(0);
  });

  it('ignores the component perpendicular to the direction', () => {
    const points: Vec3[] = [[0, 0, 0], [100, 500, 0]];
    const width = mbdTextLen('100');
    expect(getGoodCheight(points, X, 1)).toBeCloseTo(100 / width, 9);
  });
});
