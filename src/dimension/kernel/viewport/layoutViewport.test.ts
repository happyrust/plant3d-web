import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutViewport } from './layoutViewport';

import type { NormalizedDimensionInput } from '../types';

const baseContext = {
  projector: createTestProjector(),
  font: createTestFont(),
  theme: SOLVESPACE_DIMENSION_THEME,
  format: DEFAULT_DIMENSION_FORMAT,
};

function linear(id: string): Extract<NormalizedDimensionInput, { kind: 'linear' }> {
  return {
    id,
    kind: 'linear',
    role: 'normal',
    labelPinned: false,
    a: [0, 0, 0],
    b: [1, 0, 0],
    placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
  };
}

describe('layoutViewport', () => {
  it('applies interaction state, resolves collisions, and builds one hit index', () => {
    const batch = layoutViewport(
      [linear('b'), linear('a')],
      baseContext,
      new Map([['a', 'selected']]),
    );
    const selected = batch.layouts.find((layout) => layout.dimensionId === 'a')!;

    expect(
      selected.primitives.every((primitive) => primitive.styleRole === 'selected'),
    ).toBe(true);
    expect(batch.layouts[0].labelBounds).not.toEqual(batch.layouts[1].labelBounds);
    const labelCenter = [
      selected.labelBounds.x + selected.labelBounds.width / 2,
      selected.labelBounds.y + selected.labelBounds.height / 2,
    ] as const;
    expect(batch.hitIndex.hitTest(labelCenter, 0)).toMatchObject({
      dimensionId: 'a',
      part: 'label',
    });
  });

  it('defaults missing interaction state to normal', () => {
    const batch = layoutViewport([linear('linear')], baseContext, new Map());

    expect(batch.layouts[0].primitives.every((primitive) => primitive.styleRole === 'normal')).toBe(
      true,
    );
  });
});
