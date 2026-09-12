import { EPSILON } from '../vec';

import { emptyLayout } from './linear';

import type { LayoutResult, ScreenRect, Vec2 } from '../types';

type Quad = readonly [Vec2, Vec2, Vec2, Vec2];

type Candidate = Readonly<{
  index: number;
  layout: LayoutResult;
  rank: number;
  quad: Quad;
  box: ScreenRect;
}>;

function boundsOf(quad: Quad): ScreenRect {
  const xs = quad.map(point => point[0]);
  const ys = quad.map(point => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function boxesOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

function projectedRange(quad: Quad, axis: Vec2): readonly [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of quad) {
    const distance = point[0] * axis[0] + point[1] * axis[1];
    min = Math.min(min, distance);
    max = Math.max(max, distance);
  }
  return [min, max];
}

/** Separating-axis test for two convex quads; touching edges do not overlap. */
export function convexQuadsOverlap(a: Quad, b: Quad): boolean {
  for (const [subject, other] of [[a, b], [b, a]] as const) {
    for (let index = 0; index < 4; index += 1) {
      const from = subject[index]!;
      const to = subject[(index + 1) % 4]!;
      const axis: Vec2 = [from[1] - to[1], to[0] - from[0]];
      if (Math.abs(axis[0]) + Math.abs(axis[1]) <= EPSILON) continue;
      const [minA, maxA] = projectedRange(subject, axis);
      const [minB, maxB] = projectedRange(other, axis);
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pairwise declutter for solver-placed labels (S1, 2026-09-12): when two 3D
 * dimension labels overlap on screen, the lower-ranked one is elided for this
 * view (`derived.lodHidden = 'overlap'`) — never moved, because the solver's
 * placement is authoritative. Rank comes from the layout (`derived.declutter`:
 * main row over atta row, then line length per label width); ties fall to the
 * lexically smaller id, so the outcome is the same on every frame with the
 * same camera. Layouts without declutter data (user dimensions, annotations,
 * flat presentations) are left alone and keep going through the moving
 * declutter in `resolveLabelCollisions`.
 */
export function declutterOverlaps(
  layouts: readonly LayoutResult[],
): readonly LayoutResult[] {
  const candidates: Candidate[] = [];
  for (const [index, layout] of layouts.entries()) {
    const declutter = layout.derived.declutter;
    if (!declutter || layout.primitives.length === 0) continue;
    const box = boundsOf(declutter.quad);
    if (box.width <= EPSILON || box.height <= EPSILON) continue;
    candidates.push({ index, layout, rank: declutter.rank, quad: declutter.quad, box });
  }
  if (candidates.length < 2) return layouts;

  candidates.sort((a, b) =>
    b.rank - a.rank
    || compareIds(a.layout.dimensionId, b.layout.dimensionId)
    || a.index - b.index);
  const results = [...layouts];
  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    const collides = kept.some(winner =>
      boxesOverlap(winner.box, candidate.box)
      && convexQuadsOverlap(winner.quad, candidate.quad));
    if (collides) {
      results[candidate.index] = emptyLayout(
        candidate.layout.dimensionId,
        candidate.layout.labelPinned,
        candidate.layout.derived.formattedLabel,
        'overlap',
      );
    } else {
      kept.push(candidate);
    }
  }
  return results;
}
