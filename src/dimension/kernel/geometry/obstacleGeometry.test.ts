import { describe, expect, it } from 'vitest';

import {
  clipConvexPolygonToRect,
  convexHull,
  polygonArea,
  polygonBounds,
  rectPolygonOverlapArea,
  rectsOverlapArea,
  segmentLengthInsideRect,
} from './obstacleGeometry';

import type { ScreenRect, Vec2 } from '../types';

const rect: ScreenRect = { x: 10, y: 10, width: 20, height: 10 };

describe('convexHull', () => {
  it('keeps the outline of a point cloud, dropping interior and collinear points', () => {
    const hull = convexHull([
      [0, 0], [4, 0], [4, 4], [0, 4], // square
      [2, 2], [1, 3], // interior
      [2, 0], [4, 2], // on edges
      [2, 0], // duplicate
    ]);
    expect(hull).toHaveLength(4);
    expect(polygonArea(hull)).toBe(16);
    expect(polygonBounds(hull)).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    // Projected box corners: any orientation, the hull is what is covered.
    const diamond = convexHull([[2, 0], [4, 2], [2, 4], [0, 2], [2, 2]]);
    expect(polygonArea(diamond)).toBe(8);
  });

  it('degenerates gracefully', () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([[1, 1], [1, 1]])).toEqual([[1, 1]]);
    expect(polygonArea(convexHull([[0, 0], [1, 1], [2, 2]]))).toBe(0);
    expect(convexHull([[0, 0], [Number.NaN, 1], [1, 0], [0, 1]])).toHaveLength(3);
  });
});

describe('clipConvexPolygonToRect / rectPolygonOverlapArea', () => {
  it('clips a polygon to the part inside the rectangle', () => {
    // Triangle whose apex pokes into the rect from below.
    const triangle: Vec2[] = [[15, 30], [25, 30], [20, 15]];
    const clipped = clipConvexPolygonToRect(triangle, rect);
    expect(clipped.length).toBeGreaterThanOrEqual(3);
    // Similar triangle above y = 20: apex at 15, base at 20 → 5/15 of the height, area scales by (1/3)².
    expect(rectPolygonOverlapArea(rect, triangle)).toBeCloseTo(75 / 9, 9);
    // Polygon enclosing the rect: the whole rect.
    expect(rectPolygonOverlapArea(rect, [[0, 0], [100, 0], [100, 100], [0, 100]])).toBe(200);
    // Polygon inside the rect: its own area.
    expect(rectPolygonOverlapArea(rect, [[12, 12], [18, 12], [18, 18], [12, 18]])).toBe(36);
  });

  it('gives equal bodies over one big box the same area wherever they sit', () => {
    // Candidate bodies fan out at rotated, non-integer offsets; a tie between
    // them has to survive the clipping arithmetic (the placement pass treats
    // scores within 1e-6 px² as equal) or the preferred position loses.
    const everywhere: Vec2[] = [[-1000, -1000], [2000, -1000], [2000, 2000], [-1000, 2000]];
    const areas = [0, 30, -30, 60, 135].map(degrees => {
      const radians = (degrees * Math.PI) / 180;
      const body: ScreenRect = {
        x: 300.37 + 41.3 * Math.cos(radians),
        y: 210.11 + 41.3 * Math.sin(radians),
        width: 57.3,
        height: 23.9,
      };
      return rectPolygonOverlapArea(body, everywhere);
    });
    for (const area of areas) expect(area).toBeCloseTo(57.3 * 23.9, 9);
    expect(Math.max(...areas) - Math.min(...areas)).toBeLessThan(1e-9);
  });

  it('reports no overlap for separated or touching shapes', () => {
    expect(rectPolygonOverlapArea(rect, [[40, 0], [50, 0], [50, 10]])).toBe(0);
    // Sharing an edge only.
    expect(rectPolygonOverlapArea(rect, [[30, 10], [40, 10], [40, 20], [30, 20]])).toBe(0);
    expect(rectPolygonOverlapArea(rect, [[0, 0], [1, 1]])).toBe(0);
    expect(rectPolygonOverlapArea({ x: 0, y: 0, width: 0, height: 5 }, [[0, 0], [5, 0], [5, 5]])).toBe(0);
  });
});

describe('rectsOverlapArea', () => {
  it('measures the intersection and ignores a shared edge', () => {
    expect(rectsOverlapArea(rect, { x: 20, y: 15, width: 20, height: 20 })).toBe(50);
    expect(rectsOverlapArea(rect, { x: 30, y: 10, width: 5, height: 5 })).toBe(0);
    expect(rectsOverlapArea(rect, rect)).toBe(200);
  });
});

describe('segmentLengthInsideRect', () => {
  it('measures the run inside the rectangle', () => {
    // Horizontal through the middle: the full rect width.
    expect(segmentLengthInsideRect({ from: [0, 15], to: [50, 15] }, rect)).toBe(20);
    // Starting inside, leaving through the right edge.
    expect(segmentLengthInsideRect({ from: [20, 15], to: [40, 15] }, rect)).toBe(10);
    // Entirely inside.
    expect(segmentLengthInsideRect({ from: [12, 12], to: [15, 16] }, rect)).toBe(5);
    // Diagonal corner to corner.
    expect(segmentLengthInsideRect({ from: [10, 10], to: [30, 20] }, rect)).toBeCloseTo(Math.hypot(20, 10), 9);
  });

  it('ignores misses, touches and runs along an edge', () => {
    expect(segmentLengthInsideRect({ from: [0, 0], to: [50, 5] }, rect)).toBe(0);
    expect(segmentLengthInsideRect({ from: [0, 10], to: [50, 10] }, rect)).toBe(0);
    expect(segmentLengthInsideRect({ from: [10, 0], to: [10, 50] }, rect)).toBe(0);
    expect(segmentLengthInsideRect({ from: [30, 20], to: [40, 30] }, rect)).toBe(0);
    expect(segmentLengthInsideRect({ from: [15, 15], to: [15, 15] }, rect)).toBe(0);
  });
});
