import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutDimension } from './layoutDimension';

import type {
  ExplicitLayoutInput,
  NormalizedDimensionInput,
} from '../types';
import type { LayoutContext } from './context';

const context: LayoutContext = {
  projector: createTestProjector(),
  font: createTestFont(),
  theme: SOLVESPACE_DIMENSION_THEME,
  format: DEFAULT_DIMENSION_FORMAT,
  interaction: 'normal',
};

describe('layoutDimension', () => {
  it('dispatches all semantic dimension kinds', () => {
    const inputs: NormalizedDimensionInput[] = [
      {
        id: 'linear',
        kind: 'linear',
        role: 'normal',
        labelPinned: false,
        a: [0, 0, 0],
        b: [1, 0, 0],
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
      {
        id: 'projected',
        kind: 'projected',
        role: 'normal',
        labelPinned: false,
        a: [1, 0, 0],
        b: [0, 0.6, 0],
        axis: [1, 0, 0],
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
      {
        id: 'angular',
        kind: 'angular',
        role: 'normal',
        labelPinned: false,
        vertex: [0, 0, 0],
        rayA: [1, 0, 0],
        rayB: [0, 1, 0],
        placement: { radiusM: 0.3, labelT: 0.5, arcChoice: 'minor' },
      },
      {
        id: 'radial',
        kind: 'radial',
        role: 'normal',
        labelPinned: false,
        center: [0, 0, 0],
        rim: [0.5, 0, 0],
        normal: [0, 0, 1],
        display: 'radius',
        placement: { leaderDirection: [1, 1, 0], labelDistanceM: 0.25 },
      },
    ];

    expect(inputs.map((input) => layoutDimension(input, context).dimensionId)).toEqual([
      'linear',
      'projected',
      'angular',
      'radial',
    ]);
    expect(inputs.every((input) => layoutDimension(input, context).primitives.length > 0)).toBe(
      true,
    );
  });

  it('dispatches explicit layouts to the same result shape', () => {
    const explicit: ExplicitLayoutInput = {
      id: 'explicit',
      role: 'external',
      labelPinned: true,
      formattedLabel: 'SOURCE',
      lines: [{ from: [0, 0, 0], to: [1, 0, 0], part: 'dimension' }],
      labelAnchor: [0.5, 0.2, 0],
      arrowLines: [],
    };
    const result = layoutDimension(explicit, context);

    expect(result).toMatchObject({
      dimensionId: 'explicit',
      labelPinned: true,
      derived: { formattedLabel: 'SOURCE' },
    });
  });
});
