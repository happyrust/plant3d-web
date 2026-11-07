import { EPSILON } from '../vec';

import { emptyLayout } from './linear';

import type { LayoutResult, ScreenRect, Vec2 } from '../types';

type Quad = readonly [Vec2, Vec2, Vec2, Vec2];

type Candidate = Readonly<{
  index: number;
  layout: LayoutResult;
  quad: Quad;
  box: ScreenRect;
}>;

/** Layouts that win or lose together; a layout without a group is one on its own. */
type Group = {
  /** Tie-break key: the group name, or the layout's id for a group of one. */
  sortKey: string;
  rank: number;
  firstIndex: number;
  members: Candidate[];
};

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

/** Twice the signed area of a quad, absolute. */
function quadArea(quad: Quad): number {
  let twice = 0;
  for (let index = 0; index < 4; index += 1) {
    const point = quad[index]!;
    const next = quad[(index + 1) % 4]!;
    twice += point[0] * next[1] - next[0] * point[1];
  }
  return Math.abs(twice) / 2;
}

/**
 * Whether the projected text quad still describes the text's footprint, so a
 * separating-axis verdict on it can be trusted.
 *
 * A frame point near the camera plane projects outside the clip depth and the
 * quad stops bounding the glyph box: measured on live MBD at a close-up, the
 * area ratio to the label box ranged from 0.27 (healthy) up to 1.3e5 (a sliver
 * spanning the screen). A sliver shares no separating axis with anything, so
 * the test reported "no overlap" for every pair and 79 overlapping labels were
 * left on screen. Such a quad falls back to the axis-aligned bounds, which
 * always bound the drawn text (2026-10-29).
 */
function quadBracketsLabel(quad: Quad, box: ScreenRect): boolean {
  const area = box.width * box.height;
  if (!(area > 0)) return false;
  const ratio = quadArea(quad) / area;
  return ratio >= 0.05 && ratio <= 1.2;
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

function candidatesCollide(winner: Candidate, candidate: Candidate): boolean {
  if (!boxesOverlap(winner.box, candidate.box)) return false;
  // A degenerate quad cannot prove separation — fall back to the bounds.
  return quadBracketsLabel(winner.quad, winner.box)
    && quadBracketsLabel(candidate.quad, candidate.box)
    ? convexQuadsOverlap(winner.quad, candidate.quad)
    : true;
}

/**
 * Pairwise declutter for solver-placed labels (S1, 2026-09-12): when two
 * labels overlap on screen, the lower-ranked one is elided for this view
 * (`derived.lodHidden = 'overlap'`) — never moved, because the solver's
 * placement is authoritative. Rank comes from the layout (`derived.declutter`:
 * 3D dimensions rank main row over atta row, then line length per label
 * width; explicit records bring their own); ties fall to the lexically
 * smaller id, so the outcome is the same on every frame with the same camera.
 *
 * Layouts that share `derived.declutter.group` compete as one: the group
 * takes its best member's rank, loses when any member overlaps a kept layout
 * of another group, and then every member is elided — an angle's value and
 * its two direction notes never survive without each other. Members of one
 * group never knock each other out. A layout without a group is a group of
 * its own, which is exactly the pairwise rule above.
 *
 * Layouts without declutter data (user dimensions, annotations, flat
 * presentations) are left alone and keep going through the moving declutter
 * in `resolveLabelCollisions`.
 */
export function declutterOverlaps(
  layouts: readonly LayoutResult[],
): readonly LayoutResult[] {
  const groups = new Map<string, Group>();
  for (const [index, layout] of layouts.entries()) {
    const declutter = layout.derived.declutter;
    if (!declutter || layout.primitives.length === 0) continue;
    const box = boundsOf(declutter.quad);
    if (box.width <= EPSILON || box.height <= EPSILON) continue;
    const key = declutter.group !== undefined ? `group:${declutter.group}` : `layout:${index}`;
    const candidate: Candidate = { index, layout, quad: declutter.quad, box };
    const group = groups.get(key);
    if (group) {
      group.rank = Math.max(group.rank, declutter.rank);
      group.members.push(candidate);
    } else {
      groups.set(key, {
        sortKey: declutter.group ?? layout.dimensionId,
        rank: declutter.rank,
        firstIndex: index,
        members: [candidate],
      });
    }
  }
  if (groups.size < 2) return layouts;

  const ordered = [...groups.values()].sort((a, b) =>
    b.rank - a.rank
    || compareIds(a.sortKey, b.sortKey)
    || a.firstIndex - b.firstIndex);
  const results = [...layouts];
  const kept: Candidate[] = [];
  for (const group of ordered) {
    const collides = group.members.some(member =>
      kept.some(winner => candidatesCollide(winner, member)));
    if (collides) {
      for (const member of group.members) {
        results[member.index] = emptyLayout(
          member.layout.dimensionId,
          member.layout.labelPinned,
          member.layout.derived.formattedLabel,
          'overlap',
        );
      }
    } else {
      kept.push(...group.members);
    }
  }
  return results;
}
