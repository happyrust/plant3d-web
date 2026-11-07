import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutViewport } from './layoutViewport';

import type { ExplicitLayoutInput, NormalizedDimensionInput, ScreenRect } from '../types';

import { present } from '@/testing/present';

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

function boxesIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe('layoutViewport', () => {
  it('applies interaction state, resolves collisions, and builds one hit index', () => {
    const batch = layoutViewport(
      [linear('b'), linear('a')],
      baseContext,
      new Map([['a', 'selected']]),
    );
    const selected = present(
      batch.layouts.find((layout) => layout.dimensionId === 'a'),
      'selected layout',
    );

    expect(
      selected.primitives.every((primitive) => primitive.styleRole === 'selected'),
    ).toBe(true);
    expect(present(batch.layouts[0], 'layout 0').labelBounds).not.toEqual(
      present(batch.layouts[1], 'layout 1').labelBounds,
    );
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
    const layout = present(batch.layouts[0], 'past-the-camera layout');

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

  it('keeps an automatic label off every row of a solver-placed block, not just its first', () => {
    // Three 13 px rows centred on (250, 150), 15.6 px apart: the first row's
    // padded box ends at y = 148.15, the last row sits at y = 165.6.
    const block: ExplicitLayoutInput = {
      id: 'block',
      role: 'external',
      labelPinned: true,
      formattedLabel: 'A',
      lines: [],
      labelAnchor: [0.5, 0.5, 0],
      arrowLines: [],
      labelBlock: { rows: ['A', 'A'], lineAdvance: 1.2 },
    };
    const automatic: ExplicitLayoutInput = {
      id: 'automatic',
      role: 'external',
      labelPinned: false,
      formattedLabel: 'A',
      lines: [],
      labelAnchor: [0.5, 0.344, 0],
      arrowLines: [],
    };
    const alone = present(layoutViewport([automatic], baseContext, new Map()).layouts[0], 'alone');
    const batch = layoutViewport([block, automatic], baseContext, new Map());
    const blockLayout = present(batch.layouts[0], 'block layout');
    const placed = present(batch.layouts[1], 'automatic layout');

    // Left where it is, it would sit on the block's last row …
    expect(boxesIntersect(alone.labelBounds, blockLayout.labelBounds)).toBe(true);
    // … so the declutter moves it clear of the whole block; the block stays put.
    expect(placed.labelBounds).not.toEqual(alone.labelBounds);
    expect(boxesIntersect(placed.labelBounds, blockLayout.labelBounds)).toBe(false);
    expect(blockLayout.labelBounds.y + blockLayout.labelBounds.height / 2).toBeCloseTo(150, 9);
  });

  it('defaults missing interaction state to normal', () => {
    const batch = layoutViewport([linear('linear')], baseContext, new Map());

    expect(
      present(batch.layouts[0], 'layout').primitives.every(
        (primitive) => primitive.styleRole === 'normal',
      ),
    ).toBe(true);
  });

  it('ignores the retired `polar` / `polarObstacle` fields: every label stays on its solver anchor', () => {
    const label: ExplicitLayoutInput = {
      id: 'label',
      role: 'external',
      labelPinned: true,
      formattedLabel: 'X',
      lines: [],
      labelAnchor: [0.5, 0, 0],
      arrowLines: [],
    };
    const sibling: ExplicitLayoutInput = { ...label, id: 'sibling', formattedLabel: 'Y', labelAnchor: [0, 0.07, 0] };
    const plain = layoutViewport([label, sibling], baseContext, new Map()).layouts;
    const tagged = layoutViewport([
      {
        ...label,
        polar: {
          origin: [0, 0, 0],
          axis: [1, 0, 0],
          disRange: [-1, 1],
          basicRadiusM: 0.05,
          textHeightM: 0.02,
          groupKey: 'isoline:0',
        },
      },
      { ...sibling, polarObstacle: { groupKey: 'isoline:0' } },
    ], baseContext, new Map()).layouts;

    expect(tagged).toEqual(plain);
    // The test projector's 100 px/m puts the solver anchor [0.5, 0, 0] at x = 250.
    const labelBounds = present(tagged[0], 'label layout').labelBounds;
    expect(labelBounds.x + labelBounds.width / 2).toBeCloseTo(250, 0);
  });
});
