import { EPSILON } from '../vec';

import type { ScreenRect, Vec2 } from '../types';

/** Convex screen polygon, vertices in order (either winding), no repeats. */
export type ScreenPolygon = readonly Vec2[];

export type ScreenSegment = Readonly<{ from: Vec2; to: Vec2 }>;

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Convex hull of a point set (Andrew's monotone chain), counter-clockwise in
 * screen coordinates (y down). Collinear boundary points are dropped. Fewer
 * than three distinct points give back what there is (a point or a
 * segment), which the area / overlap helpers treat as empty.
 */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = [...points]
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((point, index, all) =>
      index === 0 || point[0] !== all[index - 1]![0] || point[1] !== all[index - 1]![1]);
  if (sorted.length < 3) return sorted;
  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Vec2[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function polygonBounds(polygon: ScreenPolygon): ScreenRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (polygon.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Unsigned area (shoelace, taken about the first vertex so screen offsets do
 * not feed cancellation error); zero for fewer than three vertices.
 */
export function polygonArea(polygon: ScreenPolygon): number {
  if (polygon.length < 3) return 0;
  const [originX, originY] = polygon[0]!;
  let twice = 0;
  for (let index = 1; index < polygon.length - 1; index += 1) {
    const a = polygon[index]!;
    const b = polygon[index + 1]!;
    twice += (a[0] - originX) * (b[1] - originY) - (b[0] - originX) * (a[1] - originY);
  }
  return Math.abs(twice) / 2;
}

type HalfPlane = Readonly<{
  /** Screen axis the boundary is perpendicular to (0 = x, 1 = y). */
  axis: 0 | 1;
  /** Boundary coordinate on that axis. */
  value: number;
  /** True when the point is kept. */
  inside(point: Vec2): boolean;
}>;

function clipAgainst(polygon: ScreenPolygon, plane: HalfPlane): Vec2[] {
  const output: Vec2[] = [];
  const other = plane.axis === 0 ? 1 : 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    const currentInside = plane.inside(current);
    const previousInside = plane.inside(previous);
    if (currentInside !== previousInside) {
      // The crossing sits exactly on the boundary: snapping that coordinate
      // (instead of interpolating it) keeps the clipped area free of
      // floating-point noise, so equal intrusions compare equal.
      const t = (plane.value - previous[plane.axis]) / (current[plane.axis] - previous[plane.axis]);
      const crossing: [number, number] = [0, 0];
      crossing[plane.axis] = plane.value;
      crossing[other] = previous[other] + (current[other] - previous[other]) * t;
      output.push(crossing);
    }
    if (currentInside) output.push(current);
  }
  return output;
}

/**
 * Sutherland–Hodgman clip of a convex polygon against an axis-aligned
 * rectangle; the result is the (convex) intersection, empty when they do not
 * overlap.
 */
export function clipConvexPolygonToRect(polygon: ScreenPolygon, rect: ScreenRect): Vec2[] {
  if (polygon.length < 3 || rect.width <= 0 || rect.height <= 0) return [];
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;
  const planes: HalfPlane[] = [
    { axis: 0, value: minX, inside: p => p[0] >= minX },
    { axis: 0, value: maxX, inside: p => p[0] <= maxX },
    { axis: 1, value: minY, inside: p => p[1] >= minY },
    { axis: 1, value: maxY, inside: p => p[1] <= maxY },
  ];
  let clipped: Vec2[] = [...polygon];
  for (const plane of planes) {
    clipped = clipAgainst(clipped, plane);
    if (clipped.length === 0) return [];
  }
  return clipped;
}

/** Area of `rect ∩ polygon` (convex polygon), 0 when they only touch. */
export function rectPolygonOverlapArea(rect: ScreenRect, polygon: ScreenPolygon): number {
  const area = polygonArea(clipConvexPolygonToRect(polygon, rect));
  return area > EPSILON ? area : 0;
}

/** Area of `a ∩ b`, 0 when they only touch. */
export function rectsOverlapArea(a: ScreenRect, b: ScreenRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > EPSILON && height > EPSILON ? width * height : 0;
}

/**
 * Length of the part of the segment that lies strictly inside the rectangle
 * (slab clipping); 0 when it misses, only touches the boundary or runs along
 * an edge.
 */
export function segmentLengthInsideRect(segment: ScreenSegment, rect: ScreenRect): number {
  const { from, to } = segment;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON || rect.width <= 0 || rect.height <= 0) return 0;
  let entry = 0;
  let exit = 1;
  const slab = (origin: number, delta: number, min: number, max: number): boolean => {
    if (Math.abs(delta) <= EPSILON) return origin > min + EPSILON && origin < max - EPSILON;
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    return entry < exit - EPSILON;
  };
  if (!slab(from[0], dx, rect.x, rect.x + rect.width)) return 0;
  if (!slab(from[1], dy, rect.y, rect.y + rect.height)) return 0;
  const inside = (exit - entry) * length;
  return inside > EPSILON ? inside : 0;
}
