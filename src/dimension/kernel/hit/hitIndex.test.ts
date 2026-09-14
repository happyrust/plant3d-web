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

  it('registers only the on-screen cells of a region that projects far beyond the viewport', () => {
    // A vertex near the camera plane projects to 1e8–1e9 px: cell by cell
    // that is 1e7+ cells per region (RangeError / OOM before 2026-09-14).
    const viewport = { x: 0, y: 0, width: 1920, height: 1080 };
    const index = buildHitIndex([
      layout('through-screen', [
        { kind: 'segment', from: [100, 100], to: [3e8, 100], widthPx: 1, part: 'dimension' },
      ]),
      layout('covers-everything', [
        { kind: 'rect', rect: { x: -5e8, y: 500, width: 1e9, height: 1e9 }, part: 'label' },
      ]),
      layout('off-screen', [
        { kind: 'rect', rect: { x: 5000, y: 5000, width: 10, height: 10 }, part: 'label' },
      ]),
      layout('non-finite', [
        { kind: 'segment', from: [-Infinity, 0], to: [Infinity, 0], widthPx: 1, part: 'dimension' },
        { kind: 'rect', rect: { x: NaN, y: 0, width: 10, height: 10 }, part: 'label' },
      ]),
    ], 64, viewport);

    expect(index.hitTest([1000, 102], 3)).toMatchObject({ dimensionId: 'through-screen', distancePx: 2 });
    expect(index.hitTest([960, 900], 0)).toMatchObject({ dimensionId: 'covers-everything' });
    expect(index.hitTest([960, 300], 0)).toBeNull();
    // Beyond the viewport (plus one cell) nothing is indexed, by design.
    expect(index.hitTest([5005, 5005], 0)).toBeNull();
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
