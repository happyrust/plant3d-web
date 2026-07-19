import { describe, expect, it } from 'vitest';

import { deriveDimensionValue } from './value';

import type { NormalizedDimensionInput } from './types';

const base = {
  role: 'normal',
  labelPinned: false,
} as const;

describe('deriveDimensionValue', () => {
  it('derives Euclidean and absolute projected lengths', () => {
    const linear: NormalizedDimensionInput = {
      ...base,
      id: 'linear',
      kind: 'linear',
      a: [0, 0, 0],
      b: [0, 3, 4],
      placement: { offsetM: 0.1, labelT: 0.5, side: 1 },
    };
    const projected: NormalizedDimensionInput = {
      ...base,
      id: 'projected',
      kind: 'projected',
      a: [1, 0, 0],
      b: [0, 0.6, 0],
      axis: [2, 0, 0],
      placement: { offsetM: 0.1, labelT: 0.5, side: 1 },
    };

    expect(deriveDimensionValue(linear)).toEqual({ ok: true, valueM: 5 });
    expect(deriveDimensionValue(projected)).toEqual({ ok: true, valueM: 1 });
  });

  it('derives minor and major angular values', () => {
    const angular = (arcChoice: 'minor' | 'major'): NormalizedDimensionInput => ({
      ...base,
      id: `angular-${arcChoice}`,
      kind: 'angular',
      vertex: [0, 0, 0],
      rayA: [1, 0, 0],
      rayB: [0, 1, 0],
      placement: { labelT: 0.5, arcChoice },
    });

    expect(deriveDimensionValue(angular('minor'))).toEqual({
      ok: true,
      valueRad: Math.PI / 2,
    });
    expect(deriveDimensionValue(angular('major'))).toEqual({
      ok: true,
      valueRad: (3 * Math.PI) / 2,
    });
  });

  it('derives radial radius and diameter from geometry', () => {
    const radial = (display: 'radius' | 'diameter'): NormalizedDimensionInput => ({
      ...base,
      id: `radial-${display}`,
      kind: 'radial',
      center: [0, 0, 0],
      rim: [0.5, 0, 0],
      normal: [0, 0, 1],
      display,
      placement: { leaderDirection: [1, 1, 0], labelDistanceM: 0.25 },
    });

    expect(deriveDimensionValue(radial('radius'))).toEqual({ ok: true, valueM: 0.5 });
    expect(deriveDimensionValue(radial('diameter'))).toEqual({ ok: true, valueM: 1 });
  });

  it('returns discriminated errors for degenerate geometry and axes', () => {
    expect(
      deriveDimensionValue({
        ...base,
        id: 'zero-linear',
        kind: 'linear',
        a: [0, 0, 0],
        b: [0, 0, 0],
        placement: { offsetM: 0, labelT: 0.5, side: 1 },
      }),
    ).toEqual({ ok: false, reason: 'degenerate' });

    expect(
      deriveDimensionValue({
        ...base,
        id: 'bad-axis',
        kind: 'projected',
        a: [0, 0, 0],
        b: [1, 0, 0],
        axis: [0, 0, 0],
        placement: { offsetM: 0, labelT: 0.5, side: 1 },
      }),
    ).toEqual({ ok: false, reason: 'invalid-axis' });
  });
});
