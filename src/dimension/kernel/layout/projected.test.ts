import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutProjected } from './projected';

import type { NormalizedDimensionInput, ScreenLine } from '../types';
import type { LayoutContext } from './context';

const context: LayoutContext = {
  projector: createTestProjector(),
  font: createTestFont(),
  theme: SOLVESPACE_DIMENSION_THEME,
  format: DEFAULT_DIMENSION_FORMAT,
  interaction: 'normal',
};

const projected: Extract<NormalizedDimensionInput, { kind: 'projected' }> = {
  id: 'projected',
  kind: 'projected',
  role: 'normal',
  labelPinned: false,
  a: [1, 0, 0],
  b: [0, 0.6, 0],
  axis: [1, 0, 0],
  placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
};

describe('layoutProjected', () => {
  it('adds two projection lines and formats the absolute X projection', () => {
    const result = roundNumbers(layoutProjected(projected, context));
    const projectionLines = result.primitives.filter(
      (primitive): primitive is ScreenLine =>
        primitive.kind === 'line' && primitive.part === 'projection',
    );

    expect(result.derived).toEqual({ valueM: 1, formattedLabel: '1000.00' });
    expect(projectionLines).toEqual([
      {
        kind: 'line',
        from: [300, 200],
        to: [200, 200],
        part: 'projection',
        styleRole: 'normal',
      },
      {
        kind: 'line',
        from: [200, 140],
        to: [200, 200],
        part: 'projection',
        styleRole: 'normal',
      },
    ]);
  });

  it('returns an empty trusted layout for an invalid projection axis', () => {
    const result = layoutProjected({ ...projected, axis: [0, 0, 0] }, context);

    expect(result.primitives).toEqual([]);
    expect(result.hitRegions).toEqual([]);
    expect(result.derived.formattedLabel).toBe('');
  });
});
