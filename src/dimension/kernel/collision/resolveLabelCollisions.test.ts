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

  it('is byte-identical across repeated calls', () => {
    const once = resolveLabelCollisions([
      layout('pinned', 0, 0, true),
      layout('auto', 0, 0),
    ]);
    const twice = resolveLabelCollisions(once);

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
