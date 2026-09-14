import { describe, expect, it } from 'vitest';

import { resolveLabelCollisions } from './resolveLabelCollisions';

import type { LayoutResult, ScreenGlyphRun } from '../types';

function layout(
  id: string,
  x: number,
  y: number,
  pinned = false,
  size = 4,
): LayoutResult {
  const glyph: ScreenGlyphRun = {
    kind: 'glyph-run',
    text: id,
    origin: [x, y + size],
    capHeightPx: size,
    bounds: { x, y, width: size, height: size },
    styleRole: 'normal',
  };
  return {
    dimensionId: id,
    scenePrimitives: [
      {
        kind: 'scene-line',
        from: { anchor: [0, 0, 0], offsetPx: [-10, 20] },
        to: { anchor: [0, 0, 0], offsetPx: [10, 20] },
        part: 'extension',
        styleRole: 'normal',
      },
      {
        kind: 'scene-glyph-run',
        text: id,
        at: {
          anchor: [0, 0, 0],
          offsetPx: [x + size / 2, y + size / 2],
        },
        capHeightPx: size,
        rotationRad: 0,
        styleRole: 'normal',
      },
    ],
    primitives: [
      {
        kind: 'line',
        from: [-10, 20],
        to: [10, 20],
        part: 'extension',
        styleRole: 'normal',
      },
      glyph,
    ],
    hitRegions: [
      {
        kind: 'segment',
        from: [-10, 20],
        to: [10, 20],
        widthPx: 1,
        part: 'extension',
      },
      { kind: 'rect', rect: glyph.bounds, part: 'label' },
    ],
    labelBounds: glyph.bounds,
    labelPinned: pinned,
    derived: { formattedLabel: id },
  };
}

function glyphOf(result: LayoutResult): ScreenGlyphRun {
  return result.primitives.find(
    (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
  )!;
}

describe('resolveLabelCollisions', () => {
  it('never moves pinned labels and moves automatic labels in stable id order', () => {
    const pinned = layout('pinned', 0, 0, true);
    const b = layout('b', 0, 0);
    const a = layout('a', 0, 0);
    const results = resolveLabelCollisions([b, pinned, a]);

    expect(glyphOf(results[1]).bounds).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    expect(glyphOf(results[2]).bounds).toEqual({ x: 0, y: -8, width: 4, height: 4 });
    expect(glyphOf(results[0]).bounds).not.toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it('tries candidates in up, right, down, left order', () => {
    const results = resolveLabelCollisions([
      layout('center', 0, 0, true),
      layout('up-blocker', 0, -8, true),
      layout('auto', 0, 0),
    ]);
    const moved = results.find((result) => result.dimensionId === 'auto')!;

    expect(moved.labelBounds).toEqual({ x: 16, y: 0, width: 4, height: 4 });
  });

  it('keeps searching when the first eight label positions are occupied', () => {
    const blockers = [layout('center', 0, 0, true, 2)];
    const directions = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const;
    for (let candidate = 0; candidate < 8; candidate += 1) {
      const distance = (candidate + 1) * 8;
      const [dx, dy] = directions[candidate % directions.length];
      blockers.push(layout(`block-${candidate}`, dx * distance, dy * distance, true, 2));
    }
    const result = resolveLabelCollisions([...blockers, layout('auto', 0, 0, false, 2)]).at(-1)!;

    expect(result.labelBounds).toEqual({ x: 0, y: -72, width: 2, height: 2 });
  });

  it('moves only label geometry and adds a connecting leader', () => {
    const [pinned, moved] = resolveLabelCollisions([
      layout('pinned', 0, 0, true),
      layout('auto', 0, 0),
    ]);

    expect(pinned.primitives[0]).toEqual(moved.primitives[0]);
    expect(
      moved.primitives.some(
        (primitive) => primitive.kind === 'line' && primitive.part === 'leader',
      ),
    ).toBe(true);
    expect(
      moved.scenePrimitives.some(
        primitive => primitive.kind === 'scene-line'
          && primitive.part === 'leader',
      ),
    ).toBe(true);
    expect(
      moved.scenePrimitives.find(
        primitive => primitive.kind === 'scene-glyph-run',
      ),
    ).toMatchObject({ at: { offsetPx: [2, -6] } });
  });

  it('ignores label-less layouts as obstacles and as movers', () => {
    const pinnedBlank: LayoutResult = {
      ...layout('blank', 0, 0, true),
      derived: { formattedLabel: '' },
    };
    const autoBlank: LayoutResult = {
      ...layout('auto-blank', 0, 0),
      derived: { formattedLabel: '' },
    };
    const withText = layout('with-text', 0, 0);

    const results = resolveLabelCollisions([pinnedBlank, autoBlank, withText]);

    expect(glyphOf(results[1]!).bounds).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    expect(glyphOf(results[2]!).bounds).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it('leaves labels that project beyond the viewport alone instead of gridding them', () => {
    // Label bounds in the 1e8–1e9 px range (a vertex near the camera plane)
    // would take 1e7+ occupancy cells each (RangeError / OOM before
    // 2026-09-14); with the viewport known they neither claim nor take space.
    const viewport = { x: 0, y: 0, width: 400, height: 400 };
    const enormous = layout('enormous', 3e8, -2e8, true, 1e9);
    const automaticEnormous = layout('auto-enormous', 3e8, -2e8, false, 1e9);
    const nonFinite = layout('non-finite', NaN, 0, true);
    const pinned = layout('pinned', 0, 0, true);
    const auto = layout('auto', 0, 0);

    const results = resolveLabelCollisions(
      [enormous, automaticEnormous, nonFinite, pinned, auto],
      viewport,
    );

    expect(results[0]).toBe(enormous);
    expect(results[1]).toBe(automaticEnormous);
    expect(results[2]).toBe(nonFinite);
    expect(glyphOf(results[4]!).bounds).toEqual({ x: 0, y: -8, width: 4, height: 4 });
  });

  it('registers a label straddling the viewport edge in its on-screen cells only', () => {
    const viewport = { x: 0, y: 0, width: 400, height: 400 };
    // Pinned label covering x ≤ 2, y ≤ 2 from 1e8 px off-screen: it still
    // blocks the automatic label at the origin and its first candidate (up),
    // so the automatic label takes the second one, to the right of its edge.
    const wide = layout('wide', -1e8, -1e8, true, 1e8 + 2);
    const auto = layout('auto', 0, 0);

    const results = resolveLabelCollisions([wide, auto], viewport);

    expect(results[0]).toBe(wide);
    expect(glyphOf(results[1]!).bounds).toEqual({ x: 16, y: 0, width: 4, height: 4 });
  });

  it('is byte-identical across repeated calls', () => {
    const once = resolveLabelCollisions([
      layout('pinned', 0, 0, true),
      layout('auto', 0, 0),
    ]);
    const twice = resolveLabelCollisions(once);

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
