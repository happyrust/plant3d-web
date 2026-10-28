import { describe, expect, it } from 'vitest';

import { fallbackPlacement } from './fallbackPlacement';

describe('fallbackPlacement', () => {
  it('reads the angle from the first angle range, not from the radius range (C8)', () => {
    // PML :1290 would hand back angle 165 — the radius-cell midpoint in mm.
    expect(fallbackPlacement([[0, 100]], [[[0, 360]]], [[[110, 220]]]))
      .toEqual({ dis: 50, angle: 180, radius: 165 });
    expect(fallbackPlacement([[0, 100]], [[[45, 135]]], [[[110, 220]]])?.angle).toBe(90);
  });

  it('only looks at the first dis cell, like PML :1289-1291', () => {
    expect(fallbackPlacement(
      [[0, 100], [200, 300]],
      [[[0, 360]], [[10, 20]]],
      [[[110, 220]], [[1, 2]]],
    )).toEqual({ dis: 50, angle: 180, radius: 165 });
  });

  it('is null when any of the three first cells is missing (PML would fault on an unset index)', () => {
    expect(fallbackPlacement([[0, 100]], [[]], [[[110, 220]]])).toBeNull();
    expect(fallbackPlacement([[0, 100]], [[[0, 360]]], [[]])).toBeNull();
    expect(fallbackPlacement([], [], [])).toBeNull();
  });
});
