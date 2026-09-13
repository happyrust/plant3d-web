import { describe, expect, it } from 'vitest';

import { resolvePerpendicularTarget } from './perpendicularTargetProvider';

describe('resolvePerpendicularTarget', () => {
  it('turns an axis-bearing pick into an infinite line through the pick (E3D getLine first)', () => {
    const resolved = resolvePerpendicularTarget({
      point: [1, 2, 3],
      direction: [0, 0, 2],
      circle: { center: [9, 9, 9], normal: [1, 0, 0] },
    });
    expect(resolved.provider).toBe('axis-line');
    expect(resolved.target).toEqual({ kind: 'line', start: [1, 2, 3], end: [1, 2, 5] });
  });

  it('falls back to the circular face plane when no axis is available (E3D getPlane)', () => {
    const resolved = resolvePerpendicularTarget({
      point: [1, 2, 3],
      circle: { center: [0, 0, 0], normal: [0, 3, 0] },
    });
    expect(resolved.provider).toBe('circle-plane');
    expect(resolved.target).toEqual({ kind: 'plane', position: [0, 0, 0], normal: [0, 3, 0] });
  });

  it('uses an arc when only an arc is present', () => {
    const resolved = resolvePerpendicularTarget({
      point: [1, 2, 3],
      arc: { center: [0, 0, 1], normal: [0, 0, 1] },
    });
    expect(resolved.provider).toBe('circle-plane');
    expect(resolved.target).toEqual({ kind: 'plane', position: [0, 0, 1], normal: [0, 0, 1] });
  });

  it('degrades to the pick position for surface picks and degenerate geometry (E3D point fallback)', () => {
    expect(resolvePerpendicularTarget({ point: [1, 2, 3] })).toEqual({
      provider: 'point',
      target: { kind: 'point', position: [1, 2, 3] },
    });
    expect(resolvePerpendicularTarget({ point: [1, 2, 3], direction: [0, 0, 0] }).provider).toBe('point');
    expect(resolvePerpendicularTarget({
      point: [1, 2, 3],
      direction: [Number.NaN, 0, 0],
      circle: { center: [0, 0, 0], normal: [0, 0, 0] },
    }).provider).toBe('point');
  });
});
