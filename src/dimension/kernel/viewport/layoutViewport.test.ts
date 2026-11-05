import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutViewport } from './layoutViewport';

import type { ExplicitLayoutInput, NormalizedDimensionInput } from '../types';

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

/**
 * A `label` opted into polar placement: pipe along +X, the solver's own
 * anchor sitting on the axis (what every pre-T3.6a anchor looks like),
 * small enough `basicRadiusM` / `textHeightM` that its placement stays
 * on screen at `createTestProjector()`'s 100 px/m.
 */
function polarLabel(
  id: string,
  overrides: Partial<ExplicitLayoutInput> = {},
): ExplicitLayoutInput {
  return {
    id,
    role: 'external',
    labelPinned: true,
    formattedLabel: 'X',
    lines: [],
    labelAnchor: [0.5, 0, 0],
    arrowLines: [],
    polar: {
      origin: [0, 0, 0],
      axis: [1, 0, 0],
      disRange: [-1, 1],
      basicRadiusM: 0.05,
      textHeightM: 0.02,
    },
    ...overrides,
  };
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

  it('defaults missing interaction state to normal', () => {
    const batch = layoutViewport([linear('linear')], baseContext, new Map());

    expect(
      present(batch.layouts[0], 'layout').primitives.every(
        (primitive) => primitive.styleRole === 'normal',
      ),
    ).toBe(true);
  });
});

describe('layoutViewport — polar placement (T3.6a)', () => {
  it('moves a polar-opted label off the pipe body (anchor distance >= basicRadius)', () => {
    const input = polarLabel('p');
    const batch = layoutViewport([input], baseContext, new Map());

    present(batch.layouts[0], 'layout');
    expect(batch.polarFallbacks).toBe(0);
    expect(batch.polarNext.has('p')).toBe(true);
    const chosen = present(batch.polarNext.get('p'), 'polar state').candidate;
    // Radial distance from the axis is exactly the candidate's `radius`
    // field (`polarPlace`'s own accounting), which must clear the pipe body.
    expect(chosen.radius).toBeGreaterThanOrEqual(input.polar!.basicRadiusM);
  });

  it('separates two same-position labels in one frame (the second does not take the first slot)', () => {
    const a = polarLabel('a');
    const b = polarLabel('b');
    const batch = layoutViewport([a, b], baseContext, new Map());

    expect(batch.polarFallbacks).toBe(0);
    const stateA = present(batch.polarNext.get('a'), 'a state');
    const stateB = present(batch.polarNext.get('b'), 'b state');
    // Different slots: not the same (disIndex, radiusIndex, angle) triple.
    const sameSlot = stateA.candidate.disIndex === stateB.candidate.disIndex
      && stateA.candidate.radiusIndex === stateB.candidate.radiusIndex
      && stateA.candidate.angle === stateB.candidate.angle;
    expect(sameSlot).toBe(false);
  });

  it('keeps the solver anchor when the polar reference is degenerate (RangeError)', () => {
    // A zero-length axis makes `cameraReference` throw (normalises to null).
    const input = polarLabel('degenerate', {
      polar: {
        origin: [0, 0, 0],
        axis: [0, 0, 0],
        disRange: [-1, 1],
        basicRadiusM: 0.05,
        textHeightM: 0.02,
      },
    });
    const batch = layoutViewport([input], baseContext, new Map());

    expect(batch.polarFallbacks).toBe(1);
    expect(batch.polarNext.has('degenerate')).toBe(false);
    const layout = present(batch.layouts[0], 'layout');
    // Falls back to the solver's own anchor: label bounds centre on [0.5,0,0]
    // at the test projector's 100 px/m, i.e. (250, 200).
    expect(layout.labelBounds.x + layout.labelBounds.width / 2).toBeCloseTo(250, 0);
  });

  it('keeps the solver anchor when every screen candidate projects off screen (allRejected)', () => {
    // A 1000 m basic radius pushes every candidate's position ~1000 m off
    // the axis; at the test projector's 100 px/m that is ~1e5 px off
    // screen, so `screenGuard` rejects all of them as `offscreen`.
    const input = polarLabel('far', {
      polar: {
        origin: [0, 0, 0],
        axis: [1, 0, 0],
        disRange: [-1, 1],
        basicRadiusM: 1000,
        textHeightM: 0.02,
      },
    });
    const batch = layoutViewport([input], baseContext, new Map());

    expect(batch.polarFallbacks).toBe(1);
    expect(batch.polarNext.has('far')).toBe(false);
    const layout = present(batch.layouts[0], 'layout');
    // Falls back to the solver's own anchor, same as the degenerate case.
    expect(layout.labelBounds.x + layout.labelBounds.width / 2).toBeCloseTo(250, 0);
  });

  it('is a no-op for inputs without `polar` — output identical to pre-T3.6a behaviour', () => {
    const withoutPolar: ExplicitLayoutInput = {
      id: 'plain',
      role: 'external',
      labelPinned: true,
      formattedLabel: 'X',
      lines: [],
      labelAnchor: [0.5, 0, 0],
      arrowLines: [],
    };
    const batch = layoutViewport([withoutPolar], baseContext, new Map());

    expect(batch.polarFallbacks).toBe(0);
    expect(batch.polarNext.size).toBe(0);
    const layout = present(batch.layouts[0], 'layout');
    expect(layout.labelBounds.x + layout.labelBounds.width / 2).toBeCloseTo(250, 0);
  });

  it('feeds `polarPrevious` back for hysteresis / candidate stability across frames', () => {
    const input = polarLabel('p');
    const first = layoutViewport([input], baseContext, new Map());
    expect(first.polarNext.has('p')).toBe(true);

    const second = layoutViewport([input], baseContext, new Map(), {
      polarPrevious: first.polarNext,
    });
    expect(second.polarFallbacks).toBe(0);
    const firstCandidate = present(first.polarNext.get('p'), 'first').candidate;
    const secondCandidate = present(second.polarNext.get('p'), 'second').candidate;
    // Same camera, same geometry, previous fed back: the chosen slot repeats.
    expect(secondCandidate.disIndex).toBe(firstCandidate.disIndex);
    expect(secondCandidate.radiusIndex).toBe(firstCandidate.radiusIndex);
  });
});
