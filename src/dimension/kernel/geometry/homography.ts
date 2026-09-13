import { EPSILON } from '../vec';

import type { Vec2 } from '../types';

/**
 * Plane → plane projective map, `(u, v) ↦ ((a·u + b·v + c) / w, (d·u + e·v + f) / w)`
 * with `w = g·u + h·v + 1`. A perspective camera maps the points of any 3D
 * plane onto the screen through exactly such a map, so the screen image of
 * a planar figure (3D dimension text) follows from four projected points of
 * its plane and never needs the camera again.
 */
export type Homography = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
}>;

export type ScreenQuad = readonly [Vec2, Vec2, Vec2, Vec2];

/**
 * The homography that sends the unit square `(0,0) (1,0) (1,1) (0,1)` to
 * `quad`, corner for corner (Heckbert's square → quad). A parallelogram —
 * an orthographic view, or a plane parallel to the screen — gives the affine
 * special case with `g = h = 0`; a degenerate quad falls back to the affine
 * map through its first three corners rather than dividing by zero.
 */
export function unitSquareToQuad(quad: ScreenQuad): Homography {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const affine = (Math.abs(dx3) <= EPSILON && Math.abs(dy3) <= EPSILON)
    || Math.abs(det) <= EPSILON;
  if (affine) {
    return {
      a: x1 - x0,
      b: x3 - x0,
      c: x0,
      d: y1 - y0,
      e: y3 - y0,
      f: y0,
      g: 0,
      h: 0,
    };
  }
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return {
    a: x1 - x0 + g * x1,
    b: x3 - x0 + h * x3,
    c: x0,
    d: y1 - y0 + g * y1,
    e: y3 - y0 + h * y3,
    f: y0,
    g,
    h,
  };
}

export function applyHomography(map: Homography, point: Vec2): Vec2 {
  const [u, v] = point;
  const w = map.g * u + map.h * v + 1;
  return [
    (map.a * u + map.b * v + map.c) / w,
    (map.d * u + map.e * v + map.f) / w,
  ];
}
