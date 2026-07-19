import { describe, expect, it } from 'vitest';

import { buildHitIndex } from './hitIndex';

import type { HitRegion, LayoutResult } from '../types';

function layout(
  dimensionId: string,
  hitRegions: readonly HitRegion[],
): LayoutResult {
  return {
    dimensionId,
    primitives: [],
    hitRegions,
    labelBounds: { x: 0, y: 0, width: 0, height: 0 },
    labelPinned: false,
    derived: { formattedLabel: dimensionId },
  };
}

describe('buildHitIndex', () => {
  it('computes segment distance and respects tolerance across cells', () => {
    const index = buildHitIndex([
      layout('line', [
        {
          kind: 'segment',
          from: [0, 0],
          to: [100, 0],
          widthPx: 1,
          part: 'dimension',
        },
      ]),
    ], 16);

    expect(index.hitTest([50, 3], 3)).toEqual({
      dimensionId: 'line',
      part: 'dimension',
      distancePx: 3,
    });
    expect(index.hitTest([50, 4], 3)).toBeNull();
  });

  it('prioritizes text rectangles over lines and ids break equal ties', () => {
    const index = buildHitIndex([
      layout('z-line', [
        { kind: 'segment', from: [0, 5], to: [10, 5], widthPx: 2, part: 'arrow' },
      ]),
      layout('b-label', [
        { kind: 'rect', rect: { x: 0, y: 0, width: 10, height: 10 }, part: 'label' },
      ]),
      layout('a-label', [
        { kind: 'rect', rect: { x: 0, y: 0, width: 10, height: 10 }, part: 'label' },
      ]),
    ]);

    expect(index.hitTest([5, 5], 0)).toEqual({
      dimensionId: 'a-label',
      part: 'label',
      distancePx: 0,
    });
  });

  it('returns null for empty cells', () => {
    const index = buildHitIndex([
      layout('far', [
        { kind: 'rect', rect: { x: 1000, y: 1000, width: 10, height: 10 }, part: 'label' },
      ]),
    ]);

    expect(index.hitTest([0, 0], 2)).toBeNull();
  });

  it('bulk-inserts 2,000 results into every overlapping cell', () => {
    const layouts = Array.from({ length: 2000 }, (_, index) =>
      layout(`dimension-${index.toString().padStart(4, '0')}`, [
        {
          kind: 'rect',
          rect: { x: index * 70, y: 10, width: 68, height: 10 },
          part: 'label',
        },
      ]),
    );
    const index = buildHitIndex(layouts, 64);

    expect(index.hitTest([1999 * 70 + 67, 15], 0)).toEqual({
      dimensionId: 'dimension-1999',
      part: 'label',
      distancePx: 0,
    });
  });
});
