import { EPSILON } from '../vec';

import { emptyLayout } from './linear';

import type {
  HitRegion,
  LayoutPrimitive,
  LayoutResult,
  ScenePrimitive,
  ScreenRect,
  Vec2,
} from '../types';

type Quad = readonly [Vec2, Vec2, Vec2, Vec2];

type Candidate = Readonly<{
  index: number;
  layout: LayoutResult;
  quad: Quad;
  box: ScreenRect;
}>;

/** Layouts that win, move, or lose together; a layout without a group is one on its own. */
type Group = {
  /** Tie-break key: the group name, or the layout's id for a group of one. */
  sortKey: string;
  rank: number;
  firstIndex: number;
  movable: boolean;
  members: Candidate[];
};

const declutterAlternatesRegistry = new WeakMap<LayoutResult, () => readonly LayoutResult[]>();

/**
 * Register lazy alternate 3D placements for a layout without embedding closures
 * inside `LayoutResult` (keeping layout snapshots JSON-serializable, #141).
 */
export function registerDeclutterAlternates(
  layout: LayoutResult,
  buildAlternates: () => readonly LayoutResult[],
): LayoutResult {
  declutterAlternatesRegistry.set(layout, buildAlternates);
  return layout;
}

function movableGroupOffsetsPx(members: readonly Candidate[]): readonly Vec2[] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const m of members) {
    minX = Math.min(minX, m.box.x);
    minY = Math.min(minY, m.box.y);
    maxX = Math.max(maxX, m.box.x + m.box.width);
    maxY = Math.max(maxY, m.box.y + m.box.height);
  }
  const sx = Math.max(36, Math.ceil((maxX - minX) * 1.15));
  const sy = Math.max(28, Math.ceil((maxY - minY) * 1.15));
  return [
    [sx, 0],
    [-sx, 0],
    [0, -sy],
    [0, sy],
    [sx, -sy],
    [-sx, sy],
    [sx, sy],
    [-sx, -sy],
    [sx * 2, 0],
    [-sx * 2, 0],
    [0, -sy * 2],
    [0, sy * 2],
    [sx * 2, -sy],
    [-sx * 2, sy],
    [sx * 2, sy],
    [-sx * 2, -sy],
  ];
}

function shiftRect(rect: ScreenRect, dx: number, dy: number): ScreenRect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

function shiftGlyphsInLayout(layout: LayoutResult, dx: number, dy: number): LayoutResult {
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) return layout;
  const scenePrimitives: ScenePrimitive[] = layout.scenePrimitives.map(prim => {
    if (prim.kind !== 'scene-glyph-run') return prim;
    return {
      ...prim,
      at: {
        anchor: prim.at.anchor,
        offsetPx: [prim.at.offsetPx[0] + dx, prim.at.offsetPx[1] + dy],
      },
    };
  });
  const primitives: LayoutPrimitive[] = layout.primitives.map(prim => {
    if (prim.kind !== 'glyph-run') return prim;
    return {
      ...prim,
      origin: [prim.origin[0] + dx, prim.origin[1] + dy],
      bounds: shiftRect(prim.bounds, dx, dy),
      ...(prim.unrotatedBounds ? { unrotatedBounds: shiftRect(prim.unrotatedBounds, dx, dy) } : {}),
      ...(prim.rotationCenter
        ? { rotationCenter: [prim.rotationCenter[0] + dx, prim.rotationCenter[1] + dy] as Vec2 }
        : {}),
      ...(prim.perspective
        ? {
          perspective: [
            [prim.perspective[0][0] + dx, prim.perspective[0][1] + dy],
            [prim.perspective[1][0] + dx, prim.perspective[1][1] + dy],
            [prim.perspective[2][0] + dx, prim.perspective[2][1] + dy],
            [prim.perspective[3][0] + dx, prim.perspective[3][1] + dy],
          ] as const,
        }
        : {}),
    };
  });
  const hitRegions: HitRegion[] = layout.hitRegions.map(region => {
    if (region.kind === 'rect' && region.part === 'label') {
      return { ...region, rect: shiftRect(region.rect, dx, dy) };
    }
    return region;
  });
  const prevDeclutter = layout.derived.declutter;
  const nextQuad: Quad | undefined = prevDeclutter
    ? [
      [prevDeclutter.quad[0][0] + dx, prevDeclutter.quad[0][1] + dy],
      [prevDeclutter.quad[1][0] + dx, prevDeclutter.quad[1][1] + dy],
      [prevDeclutter.quad[2][0] + dx, prevDeclutter.quad[2][1] + dy],
      [prevDeclutter.quad[3][0] + dx, prevDeclutter.quad[3][1] + dy],
    ]
    : undefined;
  return {
    ...layout,
    scenePrimitives,
    primitives,
    hitRegions,
    labelBounds: shiftRect(layout.labelBounds, dx, dy),
    derived: {
      ...layout.derived,
      ...(prevDeclutter && nextQuad
        ? {
          declutter: {
            ...prevDeclutter,
            quad: nextQuad,
            shiftPx: [
              (prevDeclutter.shiftPx?.[0] ?? 0) + dx,
              (prevDeclutter.shiftPx?.[1] ?? 0) + dy,
            ],
          },
        }
        : {}),
    },
  };
}

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

function candidateOf(index: number, layout: LayoutResult): Candidate | null {
  const declutter = layout.derived.declutter;
  if (!declutter || layout.primitives.length === 0) return null;
  const box = boundsOf(declutter.quad);
  if (box.width <= EPSILON || box.height <= EPSILON) return null;
  return { index, layout, quad: declutter.quad, box };
}

/**
 * Pairwise declutter for 3D dimension and angle labels (S1, revised #141 /
 * ADR 0057):
 * - Layouts compete in descending `rank` order (ties broken by id).
 * - When a lower-ranked 3D layout collides with a kept label, it first tries
 *   registered 3D candidate placements (`registerDeclutterAlternates`, e.g.
 *   sliding along its dimension line or flipping to `outside: 'start'`) or,
 *   for `movable` 3D angle groups, compact screen-space glyph offsets; only
 *   when every candidate still collides is the group elided (`lodHidden = 'overlap'`).
 * - Companion notes (`declutter.parentId`, e.g. `+50` adjustweld length) follow
 *   their host dimension: elided whenever the host is hidden, and shifted by
 *   `host.shiftPx` whenever the host moved (#141).
 */
export function declutterOverlaps(
  layouts: readonly LayoutResult[],
): readonly LayoutResult[] {
  const groups = new Map<string, Group>();
  const companions: { index: number; layout: LayoutResult; parentId: string }[] = [];
  const indexById = new Map<string, number>();

  for (const [index, layout] of layouts.entries()) {
    indexById.set(layout.dimensionId, index);
    const declutter = layout.derived.declutter;
    if (!declutter || layout.primitives.length === 0) continue;
    if (declutter.parentId !== undefined) {
      companions.push({ index, layout, parentId: declutter.parentId });
      continue;
    }
    const candidate = candidateOf(index, layout);
    if (!candidate) continue;
    const key = declutter.group !== undefined ? `group:${declutter.group}` : `layout:${index}`;
    const group = groups.get(key);
    if (group) {
      group.rank = Math.max(group.rank, declutter.rank);
      group.movable = group.movable || declutter.movable === true;
      group.members.push(candidate);
    } else {
      groups.set(key, {
        sortKey: declutter.group ?? layout.dimensionId,
        rank: declutter.rank,
        firstIndex: index,
        movable: declutter.movable === true,
        members: [candidate],
      });
    }
  }

  if (groups.size < 2 && companions.length === 0) return layouts;

  const results = [...layouts];
  const kept: Candidate[] = [];

  if (groups.size >= 2) {
    const ordered = [...groups.values()].sort((a, b) =>
      b.rank - a.rank
      || compareIds(a.sortKey, b.sortKey)
      || a.firstIndex - b.firstIndex);

    for (const group of ordered) {
      const collides = group.members.some(member =>
        kept.some(winner => candidatesCollide(winner, member)));
      if (!collides) {
        kept.push(...group.members);
        continue;
      }

      let resolved = false;
      // 1) Single-record 3D layouts with registered geometric alternates (dimension3d.ts)
      if (group.members.length === 1) {
        const only = group.members[0]!;
        const buildAlternates = declutterAlternatesRegistry.get(only.layout);
        if (buildAlternates) {
          for (const altLayout of buildAlternates()) {
            const altCand = candidateOf(only.index, altLayout);
            if (!altCand) continue;
            if (!kept.some(winner => candidatesCollide(winner, altCand))) {
              results[only.index] = altLayout;
              kept.push(altCand);
              resolved = true;
              break;
            }
          }
        }
      }

      // 2) Movable 3D multi-record groups (e.g. installation angle + direction notes)
      if (!resolved && group.movable) {
        for (const [dx, dy] of movableGroupOffsetsPx(group.members)) {
          const shiftedMembers: Candidate[] = [];
          let valid = true;
          for (const member of group.members) {
            const shifted = shiftGlyphsInLayout(member.layout, dx, dy);
            const cand = candidateOf(member.index, shifted);
            if (!cand || kept.some(winner => candidatesCollide(winner, cand))) {
              valid = false;
              break;
            }
            shiftedMembers.push(cand);
          }
          if (valid) {
            for (const cand of shiftedMembers) {
              results[cand.index] = cand.layout;
            }
            kept.push(...shiftedMembers);
            resolved = true;
            break;
          }
        }
      }

      if (!resolved) {
        for (const member of group.members) {
          results[member.index] = emptyLayout(
            member.layout.dimensionId,
            member.layout.labelPinned,
            member.layout.derived.formattedLabel,
            'overlap',
          );
        }
      }
    }
  } else {
    for (const group of groups.values()) {
      kept.push(...group.members);
    }
  }

  // 3) Companion notes follow their host dimension's visibility and shift (#141)
  for (const comp of companions) {
    const parentIdx = indexById.get(comp.parentId);
    if (parentIdx === undefined) continue;
    const parentFinal = results[parentIdx]!;
    if (parentFinal.primitives.length === 0 || parentFinal.derived.lodHidden !== undefined) {
      results[comp.index] = emptyLayout(
        comp.layout.dimensionId,
        comp.layout.labelPinned,
        comp.layout.derived.formattedLabel,
        parentFinal.derived.lodHidden ?? 'overlap',
      );
      continue;
    }
    const shiftPx = parentFinal.derived.declutter?.shiftPx;
    if (shiftPx) {
      results[comp.index] = shiftGlyphsInLayout(comp.layout, shiftPx[0], shiftPx[1]);
    }
  }

  return results;
}
