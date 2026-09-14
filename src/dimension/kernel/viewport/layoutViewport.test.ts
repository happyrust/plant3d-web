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

  it('keeps the screen grids bounded when geometry projects far beyond the viewport', () => {
    // 1e6 px per metre and a diagonal dimension: its line runs from 1.4e5 px
    // up-left of the screen to 1.1e6 px down-right — the shape of a vertex
    // near the camera plane. Registering that cell by cell is 6e7 cells
    // (RangeError: Map maximum size exceeded / OOM before 2026-09-14). Only
    // the near extension line, diagonally up-left from the centre, is on screen.
    const diagonal = { ...linear('a'), b: [1, 1, 0] as const };
    const batch = layoutViewport(
      [diagonal, { ...diagonal, id: 'b' }],
      { ...baseContext, projector: createTestProjector(1e6) },
      new Map(),
    );

    expect(batch.layouts).toHaveLength(2);
    expect(batch.hitIndex.hitTest([100, 100], 2)).toMatchObject({ dimensionId: 'a', part: 'extension' });
    expect(batch.hitIndex.hitTest([300, 300], 2)).toBeNull();
  });

  it('cuts the snapshot at the frustum: no hit region, label or obstacle from what the GPU clips', () => {
    // Test projector: depth = Z, drawn within [−1, 1]. An explicit dimension
    // whose line runs from the screen centre to a point behind the camera,
    // with its value text behind the camera too: before 2026-09-14 the far
    // end projected to a mirrored point and the whole line, plus the label,
    // was hit-testable and claimed space on screen.
    const batch = layoutViewport(
      [{
        id: 'past-the-camera',
        role: 'external' as const,
        labelPinned: true,
        formattedLabel: '1000',
        lines: [{ from: [0, 0, 0] as const, to: [1, 1, 2] as const, part: 'dimension' as const }],
        labelAnchor: [1, 1, 2] as const,
        arrowLines: [],
        texts: [],
      }],
      baseContext,
      new Map(),
    );
    const layout = batch.layouts[0]!;

    // In step with the scene primitives, nothing non-finite.
    expect(layout.primitives).toHaveLength(layout.scenePrimitives.length);
    expect(JSON.stringify(layout.primitives)).not.toMatch(/null|Infinity/);
    // The line is cut where it leaves the frustum (halfway, at (250, 150)) …
    expect(batch.hitIndex.hitTest([225, 175], 2)).toMatchObject({ dimensionId: 'past-the-camera', part: 'dimension' });
    expect(batch.hitIndex.hitTest([275, 125], 2)).toBeNull();
    // … and the label parks off screen instead of at the mirrored position.
    expect(layout.labelBounds.x).toBeLessThan(0);
    expect(batch.hitIndex.hitTest([300, 100], 8)).toBeNull();
  });

  it('defaults missing interaction state to normal', () => {
    const batch = layoutViewport([linear('linear')], baseContext, new Map());

    expect(batch.layouts[0].primitives.every((primitive) => primitive.styleRole === 'normal')).toBe(
      true,
    );
  });
});
