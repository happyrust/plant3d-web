import { describe, expect, it } from 'vitest';

import { angleInAngles, angleUnique, mergeAngles } from './angleRanges';

import type { AngleRange } from './angleRanges';

describe('angleUnique', () => {
  it('leaves values already inside [0, 360] alone, including the 360 endpoint', () => {
    expect(angleUnique(0)).toBe(0);
    expect(angleUnique(180)).toBe(180);
    // PML compares with `gt 360`, so 360 itself is returned unchanged.
    expect(angleUnique(360)).toBe(360);
  });

  it('folds values above 360 down by whole turns', () => {
    expect(angleUnique(361)).toBe(1);
    expect(angleUnique(720)).toBe(360);
    expect(angleUnique(725)).toBe(5);
  });

  it('folds negative values up by whole turns', () => {
    expect(angleUnique(-10)).toBe(350);
    expect(angleUnique(-360)).toBe(0);
    expect(angleUnique(-370)).toBe(350);
  });
});

describe('angleInAngles', () => {
  it('matches a plain non-wrapping interval inclusively', () => {
    expect(angleInAngles(10, 0, 20)).toBe(true);
    expect(angleInAngles(0, 0, 20)).toBe(true);
    expect(angleInAngles(20, 0, 20)).toBe(true);
    expect(angleInAngles(25, 0, 20)).toBe(false);
    expect(angleInAngles(10, 20, 20)).toBe(false);
    expect(angleInAngles(5, 5, 5)).toBe(true);
  });

  it('matches a wrapping interval as [0, end] union [start, 360]', () => {
    expect(angleInAngles(350, 300, 30)).toBe(true);
    expect(angleInAngles(300, 300, 30)).toBe(true);
    expect(angleInAngles(30, 300, 30)).toBe(true);
    expect(angleInAngles(0, 300, 30)).toBe(true);
    expect(angleInAngles(100, 300, 30)).toBe(false);
    expect(angleInAngles(200, 300, 30)).toBe(false);
  });

  it('normalises every argument before comparing', () => {
    expect(angleInAngles(370, 0, 20)).toBe(true);
    expect(angleInAngles(-10, 300, 30)).toBe(true);
    expect(angleInAngles(10, -360, 20)).toBe(true);
  });
});

describe('mergeAngles', () => {
  it('returns an empty array for empty input', () => {
    expect(mergeAngles([])).toEqual([]);
  });

  it('keeps a single range untouched', () => {
    expect(mergeAngles([[10, 20]])).toEqual([[10, 20]]);
    expect(mergeAngles([[0, 360]])).toEqual([[0, 360]]);
  });

  it('merges overlapping ranges', () => {
    expect(mergeAngles([[10, 30], [20, 40]])).toEqual([[10, 40]]);
    expect(mergeAngles([[10, 50], [20, 30]])).toEqual([[10, 50]]);
    expect(mergeAngles([[10, 20], [10, 20]])).toEqual([[10, 20]]);
  });

  it('merges touching ranges because the split test is strict', () => {
    expect(mergeAngles([[10, 20], [20, 30]])).toEqual([[10, 30]]);
  });

  it('keeps disjoint ranges apart and sorts them by start', () => {
    expect(mergeAngles([[10, 20], [30, 40]])).toEqual([[10, 20], [30, 40]]);
    expect(mergeAngles([[100, 120], [10, 30]])).toEqual([[10, 30], [100, 120]]);
    expect(mergeAngles([[30, 60], [0, 20], [300, 359]])).toEqual([
      [0, 20],
      [30, 60],
      [300, 359],
    ]);
  });

  it('splits a wrapping range and stitches it back into one', () => {
    expect(mergeAngles([[350, 10]])).toEqual([[350, 10]]);
    expect(mergeAngles([[-30, 30]])).toEqual([[330, 30]]);
  });

  it('merges a wrapping range with a range on the low side', () => {
    expect(mergeAngles([[350, 10], [5, 20]])).toEqual([[350, 20]]);
    expect(mergeAngles([[300, 60], [0, 120]])).toEqual([[300, 120]]);
  });

  it('returns a whole turn only when the normalised range spans 360 degrees', () => {
    expect(mergeAngles([[0, 720]])).toEqual([[0, 360]]);
    expect(mergeAngles([[0, 360]])).toEqual([[0, 360]]);
    // PML runs the `max1 >= min1 + 360` test on normalised values, so
    // `[10, 400]` becomes `[10, 40]` and stays a short range.
    expect(mergeAngles([[10, 400]])).toEqual([[10, 40]]);
  });

  it('does not stitch when only one end of the circle is covered', () => {
    const ranges: readonly AngleRange[] = [[0, 90], [180, 270]];
    expect(mergeAngles(ranges)).toEqual([[0, 90], [180, 270]]);
  });
});
