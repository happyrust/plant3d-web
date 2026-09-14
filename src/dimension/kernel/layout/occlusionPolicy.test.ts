import { describe, expect, it, vi } from 'vitest';

import { createTestProjector } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { markOcclusion, occlusionProbe, occlusionToleranceM } from './occlusionPolicy';

import type { LayoutResult, OcclusionSource, ScenePrimitive, Vec3 } from '../types';

const RECT = { x: 0, y: 0, width: 10, height: 10 };

function drawn(id: string, anchor: Vec3, withGlyph = true): LayoutResult {
  return {
    dimensionId: id,
    scenePrimitives: [
      {
        kind: 'scene-line',
        from: { anchor: [anchor[0] - 1, anchor[1], anchor[2]], offsetPx: [0, 0] },
        to: { anchor: [anchor[0] + 1, anchor[1], anchor[2]], offsetPx: [0, 0] },
        part: 'dimension',
        styleRole: 'external',
      },
      ...(withGlyph
        ? [{
          kind: 'scene-glyph-run' as const,
          text: id,
          at: { anchor, offsetPx: [0, 0] as const },
          capHeightPx: 13,
          rotationRad: 0,
          styleRole: 'external',
        }]
        : []),
    ],
    primitives: [
      { kind: 'line', from: [0, 0], to: [10, 0], part: 'dimension', styleRole: 'external' },
    ],
    hitRegions: [],
    labelBounds: RECT,
    labelPinned: true,
    derived: { formattedLabel: id },
  };
}

function elided(id: string): LayoutResult {
  return {
    dimensionId: id,
    scenePrimitives: [],
    primitives: [],
    hitRegions: [],
    labelBounds: { x: 0, y: 0, width: 0, height: 0 },
    labelPinned: true,
    derived: { formattedLabel: id, lodHidden: 'secondary-far' },
  };
}

describe('occlusionProbe', () => {
  const projector = createTestProjector(100);

  it('prefers the value text anchor and falls back to the first stroke vertex', () => {
    expect(occlusionProbe(drawn('a', [1, 2, 3]), projector)).toEqual({ point: [1, 2, 3] });
    expect(occlusionProbe(drawn('b', [1, 2, 3], false), projector)).toEqual({ point: [0, 2, 3] });
    expect(occlusionProbe(elided('c'), projector)).toBeNull();
  });

  it('probes a tag that names its object at the anchor, telling the host which object that is', () => {
    const tag: LayoutResult = {
      ...drawn('tag', [0, 0, 0.4]),
      derived: {
        formattedLabel: 'tag',
        tag: { candidate: 3, body: { x: 260, y: 130, width: 80, height: 40 }, subject: '24381_145035' },
      },
    };
    expect(occlusionProbe(tag, projector)).toEqual({
      point: [0, 0, 0.4],
      hints: { subject: '24381_145035' },
    });
  });

  it('probes a weld mark that names its WELD component at the anchor, with the component as subject', () => {
    // A weld mark has no glyph: its anchor is the marker's weld point on the
    // bore axis, inside the WELD bead and the pipe wall (27 / 27 faded
    // without the subject, BRAN 24381_146979, 2026-09-14).
    const marker: ScenePrimitive = {
      kind: 'scene-marker',
      at: { anchor: [0, 0, 0.4], offsetPx: [0, 0] },
      shape: 'circle',
      radiusPx: 5,
      part: 'marker',
      styleRole: 'external',
    };
    const weld: LayoutResult = {
      ...drawn('weld', [0, 0, 0.4], false),
      scenePrimitives: [marker],
      derived: { formattedLabel: '', subject: '24381_146980' },
    };
    expect(occlusionProbe(weld, projector)).toEqual({
      point: [0, 0, 0.4],
      hints: { subject: '24381_146980' },
    });
  });

  it('probes a tag without an object where its body is, at the anchor depth', () => {
    // Anchor on the pipe at (0, 0, 0.4); the card was placed 100 px right and
    // 50 px up of the anchor's pixel (200, 200) → its centre is at (300, 150).
    const tag: LayoutResult = {
      ...drawn('tag', [0, 0, 0.4]),
      derived: {
        formattedLabel: 'tag',
        tag: { candidate: 3, body: { x: 260, y: 130, width: 80, height: 40 } },
      },
    };
    expect(occlusionProbe(tag, projector)).toEqual({ point: [1, 0.5, 0.4] });
  });
});

describe('occlusionToleranceM', () => {
  it('takes the larger of the model and the screen tolerance', () => {
    const theme = SOLVESPACE_DIMENSION_THEME;
    // 100 px / m → 2 px = 0.02 m, above the 0.5 mm floor.
    expect(occlusionToleranceM([0, 0, 0], createTestProjector(100), theme)).toBeCloseTo(0.02, 12);
    // 100 000 px / m (extreme close-up) → 2 px = 0.02 mm, the 0.5 mm floor wins.
    expect(occlusionToleranceM([0, 0, 0], createTestProjector(100_000), theme)).toBeCloseTo(0.0005, 12);
  });
});

describe('markOcclusion', () => {
  const projector = createTestProjector(100);
  const theme = SOLVESPACE_DIMENSION_THEME;

  it('casts one ray per drawn layout from the near plane to the probe and flags the blocked ones', () => {
    const source: OcclusionSource = {
      isSegmentBlocked: vi.fn((_from: Vec3, to: Vec3) => to[0] < 0),
    };
    const behind = drawn('behind', [-0.5, 0.2, 0.7]);
    const front = drawn('front', [0.5, 0.2, 0.7]);
    const hidden = elided('hidden');

    const results = markOcclusion([behind, front, hidden], projector, source, theme);

    expect(results.map(result => result.derived.occluded)).toEqual([true, false, undefined]);
    expect(source.isSegmentBlocked).toHaveBeenCalledTimes(2);
    // Ray origin: the probe's pixel unprojected onto the near plane (depth −1),
    // target: the probe itself, tolerance at the probe's depth.
    expect(source.isSegmentBlocked).toHaveBeenNthCalledWith(
      1,
      [-0.5, 0.2, -1],
      [-0.5, 0.2, 0.7],
      expect.closeTo(0.02, 12),
    );
    // Untouched layouts are the same objects; flagged ones keep everything but the flag.
    expect(results[2]).toBe(hidden);
    expect(results[0]).toMatchObject({
      dimensionId: 'behind',
      scenePrimitives: behind.scenePrimitives,
      primitives: behind.primitives,
      derived: { formattedLabel: 'behind', occluded: true },
    });
  });

  it('hands the host a tag\'s or a weld mark\'s object with the cast, and nothing extra for a dimension', () => {
    const source: OcclusionSource = { isSegmentBlocked: vi.fn(() => false) };
    const tag: LayoutResult = {
      ...drawn('tag', [0.5, 0.2, 0.7]),
      derived: {
        formattedLabel: 'tag',
        tag: { candidate: 0, body: { x: 240, y: 170, width: 20, height: 10 }, subject: 'r7' },
      },
    };
    const weld: LayoutResult = {
      ...drawn('weld', [0.5, -0.2, 0.7]),
      derived: { formattedLabel: '', subject: 'w9' },
    };

    markOcclusion([tag, weld, drawn('dim', [-0.5, 0.2, 0.7])], projector, source, theme);

    expect(source.isSegmentBlocked).toHaveBeenNthCalledWith(
      1,
      [0.5, 0.2, -1],
      [0.5, 0.2, 0.7],
      expect.closeTo(0.02, 12),
      { subject: 'r7' },
    );
    expect(source.isSegmentBlocked).toHaveBeenNthCalledWith(
      2,
      [0.5, -0.2, -1],
      [0.5, -0.2, 0.7],
      expect.closeTo(0.02, 12),
      { subject: 'w9' },
    );
    expect(source.isSegmentBlocked).toHaveBeenNthCalledWith(
      3,
      [-0.5, 0.2, -1],
      [-0.5, 0.2, 0.7],
      expect.closeTo(0.02, 12),
    );
  });

  it('is deterministic: the same inputs give the same flags', () => {
    const source: OcclusionSource = {
      isSegmentBlocked: (_from, to) => Math.round(to[1] * 10) % 2 === 0,
    };
    const layouts = [drawn('a', [0, 0.2, 0]), drawn('b', [0, 0.3, 0]), drawn('c', [0, 0.4, 0])];
    const first = markOcclusion(layouts, projector, source, theme).map(l => l.derived.occluded);
    const second = markOcclusion(layouts, projector, source, theme).map(l => l.derived.occluded);
    expect(first).toEqual([true, false, true]);
    expect(second).toEqual(first);
  });
});
