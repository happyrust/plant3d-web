import { describe, expect, it } from 'vitest';

import { createTestProjector } from '../../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../../theme';

import {
  backProjectedSegment,
  labelBoundsOf,
  sceneVertexOnSegment,
  toScreen,
  trimBoundsOf,
} from './screen';

import type { ScreenGlyphRun } from '../../types';

const theme = SOLVESPACE_DIMENSION_THEME;
const pad = theme.labelPaddingPx / 2;

function glyph(overrides: Partial<ScreenGlyphRun> = {}): ScreenGlyphRun {
  return {
    kind: 'glyph-run',
    text: 'A',
    origin: [100, 100],
    capHeightPx: 13,
    bounds: { x: 90, y: 80, width: 40, height: 20 },
    styleRole: 'normal',
    ...overrides,
  };
}

describe('toScreen', () => {
  it('drops the depth of the projected point', () => {
    const projector = createTestProjector(100);
    expect(toScreen([1, 2, 3], projector)).toEqual([300, 0]);
    expect(toScreen([0, 0, 0], projector)).toEqual([200, 200]);
  });
});

describe('labelBoundsOf / trimBoundsOf', () => {
  it('pads the glyph bounds by half the theme padding', () => {
    expect(labelBoundsOf(glyph(), theme)).toEqual({
      x: 90 - pad,
      y: 80 - pad,
      width: 40 + 2 * pad,
      height: 20 + 2 * pad,
    });
  });

  it('trims against the unrotated bounds when the run is rotated, else the bounds', () => {
    const rotated = glyph({ unrotatedBounds: { x: 0, y: 0, width: 10, height: 4 }, rotationRad: 0.5 });
    expect(trimBoundsOf(rotated, theme)).toEqual({
      x: -pad,
      y: -pad,
      width: 10 + 2 * pad,
      height: 4 + 2 * pad,
    });
    expect(trimBoundsOf(glyph(), theme)).toEqual(labelBoundsOf(glyph(), theme));
  });
});

describe('backProjectedSegment / sceneVertexOnSegment', () => {
  const projector = createTestProjector(100);
  const fromWorld = [0, 0, 0] as const;
  const toWorld = [2, 0, 0] as const;
  const origin = toScreen(fromWorld, projector);
  const end = toScreen(toWorld, projector);
  const delta = [end[0] - origin[0], end[1] - origin[1]] as const;

  it('squares the screen delta once', () => {
    const segment = backProjectedSegment(fromWorld, toWorld, origin, delta);
    expect(segment.lengthSquared).toBe(delta[0] * delta[0] + delta[1] * delta[1]);
    expect(segment.lengthSquared).toBe(200 * 200);
  });

  it('back-projects a screen point to its parameter on the design segment', () => {
    const segment = backProjectedSegment(fromWorld, toWorld, origin, delta);
    const quarter = sceneVertexOnSegment(segment, [250, 200], projector, false);
    expect(quarter.anchor).toEqual([0.5, 0, 0]);
    expect(quarter.offsetPx).toEqual([0, 0]);

    // Off the line: the parameter is the orthogonal projection, the screen
    // offset carries the rest so the vertex still lands on the point.
    const above = sceneVertexOnSegment(segment, [250, 180], projector, false);
    expect(above.anchor).toEqual([0.5, 0, 0]);
    expect(above.offsetPx).toEqual([0, -20]);
  });

  it('uses the caller-supplied origin and delta rather than re-projecting the ends', () => {
    // An offset dimension line: same delta, origin shifted 30 px down.
    const shifted = backProjectedSegment(fromWorld, toWorld, [origin[0], origin[1] + 30], delta);
    const vertex = sceneVertexOnSegment(shifted, [300, 230], projector, false);
    expect(vertex.anchor).toEqual([1, 0, 0]);
    expect(vertex.offsetPx).toEqual([0, 30]);
  });

  it('keeps both degenerate policies apart', () => {
    const collapsed = backProjectedSegment(fromWorld, [0, 0, 0], origin, [0, 0]);
    expect(collapsed.lengthSquared).toBe(0);

    const parked = sceneVertexOnSegment(collapsed, [210, 200], projector, true);
    expect(parked.anchor).toEqual([0, 0, 0]);
    expect(parked.offsetPx).toEqual([10, 0]);

    const raw = sceneVertexOnSegment(collapsed, [210, 200], projector, false);
    expect(raw.anchor.every(Number.isNaN)).toBe(true);
  });
});
