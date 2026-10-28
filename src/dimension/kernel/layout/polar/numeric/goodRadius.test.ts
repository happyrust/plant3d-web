import { describe, expect, it } from 'vitest';

import { goodRadiusFromBadRadii } from './goodRadius';

describe('goodRadiusFromBadRadii', () => {
  it('takes the first gap that fits instead of the outermost band edge (C7)', () => {
    // PML :1018 would overwrite the loop result with 260.
    expect(goodRadiusFromBadRadii([[100, 150], [200, 260]], 12, 60)).toBe(30);
    // PML :1018 would give 120.
    expect(goodRadiusFromBadRadii([[20, 50], [70, 120]], 12, 60)).toBe(50);
  });

  it('merges touching and overlapping bands before scanning', () => {
    // [20,50] + [40,80] merge into [20,80]; the gap to [100,130] fits (PML: 130).
    expect(goodRadiusFromBadRadii([[20, 50], [40, 80], [100, 130]], 12, 60)).toBe(80);
    // inner <= outer counts as overlap (polarsystem.pmlobj:987 uses `le`).
    expect(goodRadiusFromBadRadii([[20, 50], [50, 80]], 12, 60)).toBe(80);
    // Input order does not matter: bands are sorted by inner radius first.
    expect(goodRadiusFromBadRadii([[200, 260], [100, 150]], 12, 60)).toBe(30);
  });

  it('falls back to the outermost band edge when no gap is wide enough (= PML behaviour)', () => {
    // 55 - 50 = 5 is narrower than width 12.
    expect(goodRadiusFromBadRadii([[20, 50], [55, 120]], 12, 60)).toBe(120);
    // 40 - 12 = 28 does not clear textLen/2 = 30 either.
    expect(goodRadiusFromBadRadii([[40, 150]], 12, 60)).toBe(150);
  });

  it('keeps the innermost placement when the first band leaves room for it', () => {
    expect(goodRadiusFromBadRadii([[100, 150]], 12, 60)).toBe(30);
  });

  it('applies maxRadius on both the found-gap and the fallback paths', () => {
    expect(goodRadiusFromBadRadii([[100, 150], [200, 260]], 12, 60, 20)).toBe(20);
    expect(goodRadiusFromBadRadii([[20, 50], [55, 120]], 12, 60, 90)).toBe(90);
  });

  it('returns textLen/2 for no bands at all (getgoodradius :923-925 does the same without obstacles)', () => {
    expect(goodRadiusFromBadRadii([], 12, 60)).toBe(30);
  });
});
