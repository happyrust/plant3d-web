import { describe, expect, it } from 'vitest';

import { splitRange } from './splitRange';

describe('splitRange (non-angle)', () => {
  it('centres one cell on the only best value and walks outward', () => {
    // Range [0, 100], cell 30, best 50: cells at 35..65, then 5..35 / 65..95.
    expect(splitRange([[0, 100]], 30, [50], false)).toEqual([
      [35, 65],
      [5, 35],
      [65, 95],
    ]);
  });

  it('uses the range midpoint when no best value is supplied', () => {
    expect(splitRange([[0, 100]], 30, [], false)).toEqual([
      [35, 65],
      [5, 35],
      [65, 95],
    ]);
  });

  it('clamps a best value whose full cell would leave the range', () => {
    // Best 5 is inside [0, 100] but 5 - 15 < 0, so it is clamped to 15.
    expect(splitRange([[0, 100]], 30, [5], false)).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
    ]);
  });

  it('skips a range narrower than the cell', () => {
    expect(splitRange([[0, 20]], 30, [10], false)).toEqual([]);
  });

  it('returns nothing for an empty range list', () => {
    expect(splitRange([], 30, [10], false)).toEqual([]);
  });

  it('orders ranges so the one holding the first best leads', () => {
    // The best 250 lives only in [200, 300], so that range is processed first
    // and its leading cell comes out ahead of anything from [0, 100]. That
    // second range has no best of its own, so it falls back to its midpoint 50.
    const cells = splitRange([[0, 100], [200, 300]], 40, [250], false);
    expect(cells[0]).toEqual([230, 270]);
    expect(cells).toContainEqual([30, 70]);
  });

  it('adds a boundary cell pushed in from the range end when a best sits outside', () => {
    // afterBest = 120 keeps the last edge at 90, so the pushed-in cell walks
    // left until it clears that edge: x = 1 gives [60, 100] (100 > 90, skipped)
    // and x = 2 gives [20, 60], which is what PML :3070-3081 emits.
    const cells = splitRange([[0, 100]], 40, [60, 120], false);
    expect(cells).toContainEqual([20, 60]);
  });

  it('keeps interior cells that share an edge', () => {
    const cells = splitRange([[0, 200]], 50, [50, 150], false);
    // The two best values split the range at 100; cells may touch that edge.
    expect(cells).toContainEqual([25, 75]);
    expect(cells).toContainEqual([125, 175]);
  });
});

describe('splitRange (angle)', () => {
  it('unrolls a wrapping range and centres cells on the best value', () => {
    expect(splitRange([[300, 60]], 30, [0], true)).toEqual([
      [-15, 15],
      [-45, -15],
      [15, 45],
    ]);
  });

  it('prefers the range that contains the best value in angle mode', () => {
    const cells = splitRange([[0, 90], [270, 360]], 30, [350], true);
    // The best 350 lives in [270, 360]; 350 + 15 > 360, so PML clamps it to
    // 360 - 15 = 345 and the leading cell is [330, 360].
    expect(cells[0]).toEqual([330, 360]);
  });

  it('walks the full circle when the range spans 360 degrees', () => {
    const cells = splitRange([[0, 360]], 90, [45], true);
    expect(cells[0]).toEqual([0, 90]);
    expect(cells.length).toBeGreaterThan(1);
  });
});
