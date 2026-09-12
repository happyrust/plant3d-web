import { describe, expect, it } from 'vitest';

import { convexQuadsOverlap, declutterOverlaps } from './declutterPolicy';

import type { LayoutResult, ScreenRect, Vec2 } from '../types';

type Quad = readonly [Vec2, Vec2, Vec2, Vec2];

function quadOf(rect: ScreenRect): Quad {
  return [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];
}

function layout(
  id: string,
  rect: ScreenRect,
  rank?: number,
): LayoutResult {
  const quad = quadOf(rect);
  return {
    dimensionId: id,
    scenePrimitives: [],
    primitives: [{ kind: 'glyph-run', text: id, origin: [rect.x, rect.y], capHeightPx: 13, bounds: rect, styleRole: 'external' }],
    hitRegions: [],
    labelBounds: rect,
    labelPinned: true,
    derived: {
      formattedLabel: id,
      ...(rank !== undefined ? { declutter: { rank, quad } } : {}),
    },
  };
}

describe('declutterOverlaps', () => {
  it('elides the lower-ranked of two overlapping labels and leaves the rest alone', () => {
    const main = layout('main', { x: 0, y: 0, width: 40, height: 20 }, 1001.5);
    const atta = layout('atta', { x: 30, y: 10, width: 40, height: 20 }, 1.2);
    const apart = layout('apart', { x: 200, y: 200, width: 40, height: 20 }, 1000.1);
    // No declutter data (user dimension): never touched, even where it overlaps.
    const user = layout('user', { x: 0, y: 0, width: 40, height: 20 });

    const results = declutterOverlaps([atta, main, apart, user]);

    expect(results.map(result => result.derived.lodHidden)).toEqual(['overlap', undefined, undefined, undefined]);
    expect(results[0]).toMatchObject({
      dimensionId: 'atta',
      primitives: [],
      scenePrimitives: [],
      hitRegions: [],
      labelBounds: { x: 0, y: 0, width: 0, height: 0 },
      labelPinned: true,
      derived: { formattedLabel: 'atta', lodHidden: 'overlap' },
    });
    // Winners are the very same objects — nothing is moved or rebuilt.
    expect(results[1]).toBe(main);
    expect(results[2]).toBe(apart);
    expect(results[3]).toBe(user);
  });

  it('breaks rank ties by id and cascades so a hidden label frees its space', () => {
    const rect = { x: 0, y: 0, width: 40, height: 20 };
    const b = layout('b', rect, 1000);
    const a = layout('a', rect, 1000);
    const shifted = layout('b-shifted', { x: 10, y: 0, width: 40, height: 20 }, 1000);

    expect(declutterOverlaps([b, a]).map(result => result.derived.lodHidden)).toEqual(['overlap', undefined]);
    // Same rank, later id, and it does overlap `a`: hidden.
    expect(declutterOverlaps([a, shifted]).map(result => result.derived.lodHidden)).toEqual([undefined, 'overlap']);
    // Input order does not change the outcome.
    expect(declutterOverlaps([shifted, a]).map(result => result.derived.lodHidden)).toEqual(['overlap', undefined]);

    // Chain a → b → c where c only overlaps b: b loses to a, so c keeps its place.
    const chainB = layout('chain-b', { x: 30, y: 0, width: 40, height: 20 }, 999);
    const chainC = layout('chain-c', { x: 60, y: 0, width: 40, height: 20 }, 998);
    expect(declutterOverlaps([chainC, chainB, a]).map(result => result.derived.lodHidden))
      .toEqual([undefined, 'overlap', undefined]);
  });

  it('tests the real quads, not their bounding boxes, and ignores hidden or degenerate labels', () => {
    // Two 45° slanted labels whose boxes overlap but whose quads do not.
    const slantA: Quad = [[0, 20], [20, 0], [26, 6], [6, 26]];
    const slantB: Quad = [[20, 40], [40, 20], [46, 26], [26, 46]];
    expect(convexQuadsOverlap(slantA, slantB)).toBe(false);
    expect(convexQuadsOverlap(slantA, [[10, 10], [30, 10], [30, 30], [10, 30]])).toBe(true);
    // Touching edges do not count as overlap.
    expect(convexQuadsOverlap(quadOf({ x: 0, y: 0, width: 10, height: 10 }), quadOf({ x: 10, y: 0, width: 10, height: 10 }))).toBe(false);

    const withQuad = (id: string, quad: Quad, rank: number): LayoutResult => ({
      ...layout(id, { x: 0, y: 0, width: 1, height: 1 }, rank),
      derived: { formattedLabel: id, declutter: { rank, quad } },
    });
    const results = declutterOverlaps([
      withQuad('slant-a', slantA, 1000),
      withQuad('slant-b', slantB, 999),
      // Already elided for another reason: neither claims nor loses space.
      { ...layout('gone', { x: 0, y: 0, width: 40, height: 20 }, 2000), primitives: [] },
      // A degenerate (zero-area) quad cannot collide with anything.
      withQuad('point', [[5, 5], [5, 5], [5, 5], [5, 5]], 3000),
    ]);
    expect(results.map(result => result.derived.lodHidden)).toEqual([undefined, undefined, undefined, undefined]);
  });
});
