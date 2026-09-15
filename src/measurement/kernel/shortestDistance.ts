/**
 * Pure kernel for the Web **"Shortest"** distance (result-card `Distance` variant
 * `Point to Point / Shortest`): the true shortest distance between two picked items —
 * point / infinite line / infinite plane — with the witness pair drawn as the distance line.
 *
 * **This is a Web enhancement, not E3D parity** (decision `d-619`, plan
 * `docs/plans/2026-09-15-shortest-web-enhancement-plan.md`). In E3D 3.1 the product's
 * "Measure Shortest" (Picking Control offset fields → `EDGPACKET.defineMeasure('shortest')`
 * → `EDGPICKPACKET.lineShortest()` → `gmfLine.shortest`) always degenerates to the distance
 * between the two picked positions, because `EDGPICKDATA.positionData()` hands every graphics
 * pick a `position` and `gmfLine.shortest` (`gmfline.pmlobj` 800–908) tests `position` first.
 * The branches mirrored here are the ones the product never reaches — golden MD §32 lists them;
 * §33 shows the point-point behaviour the product does have (already covered by the ordinary
 * distance measure under the Graphics filter).
 *
 * Semantics (E3D code reading, `static_expectation`, with the Web resolutions marked):
 * - Point × point: the two points.
 * - Point × line / point × plane: the point and its foot on the **infinite** line / plane
 *   (`LINE.near` / `PLANE.near`; infinite semantics confirmed at runtime by golden G4-04).
 * - Line × line, parallel: start = the position the user picked on the **first** line
 *   (`line.intersection(pointVector)`, falling back to the line's start), end = its foot on
 *   the second line. Not parallel: the two lines' mutual nearest points (`LINE.intersection`
 *   both ways) — the common perpendicular for skew lines; coincident points for crossing lines
 *   → zero length.
 * - Line × plane, parallel: the picked position on the line and its foot on the plane —
 *   E3D 856–874 puts `start` on the line and `end` on the plane whichever was picked first
 *   (the only pair where the witness order does not follow the pick order). Not parallel: an
 *   infinite line always pierces the plane → zero length.
 * - Plane × plane, parallel: start = the position picked on the **first** plane (**Web
 *   resolution**: E3D's branch reads `posData[1].line`, which is unset for a plane pick, and
 *   falls back through `handle any` to `plane.position` — the facet's first vertex — a bug we
 *   do not copy), end = its foot on the second plane. Not parallel → zero length.
 * - Parallel test: `LINE_ANGLE_PARALLEL_TOLERANCE_DEG` (0.01°), the same Web tolerance the
 *   two-line angle uses for float32 mesh edges (E3D's `DIRECTION.isParallel` tolerance is not
 *   visible in PML source).
 * - Zero length (E3D returns an unset LINE and writes 0): reported as `{ ok: false, reason }`
 *   so the caller can refuse the record and prompt, like the degenerate angle cases (`d-619`).
 *
 * All coordinates are design-world metres (X = E, Y = N, Z = U).
 */

import { LINE_ANGLE_PARALLEL_TOLERANCE_DEG } from './lineAngle';
import { closestPointOnInfiniteLine, type PickSegment, type PickVec3 } from './pickDerivation';

export type ShortestPointOperand = Readonly<{ kind: 'point'; position: PickVec3 }>;

export type ShortestLineOperand = Readonly<{
  kind: 'line';
  /** Two points on the picked line (facet edge / p-line / axis), design metres. */
  start: PickVec3;
  end: PickVec3;
  /** Position the user picked on that line (`EDGPOSITIONDATA.position`); defaults to `start`. */
  picked?: PickVec3 | null;
}>;

export type ShortestPlaneOperand = Readonly<{
  kind: 'plane';
  position: PickVec3;
  normal: PickVec3;
  /** Position the user picked on that plane; defaults to `position`. */
  picked?: PickVec3 | null;
}>;

export type ShortestOperand = ShortestPointOperand | ShortestLineOperand | ShortestPlaneOperand;

export type ShortestPairKind =
  | 'point-point'
  | 'point-line'
  | 'point-plane'
  | 'line-line'
  | 'line-plane'
  | 'plane-plane';

export type ShortestDistanceValues = Readonly<{
  kind: ShortestPairKind;
  /** Witness on the first item (E3D `start`). */
  start: PickVec3;
  /** Witness on the second item (E3D `end`). */
  end: PickVec3;
  /** |end − start| in metres. */
  distanceM: number;
  /** Unit direction start → end. */
  direction: PickVec3;
  /**
   * The two items were parallel (lines, line ∥ plane, planes) — the nearest pair is not unique
   * and the start witness is the position picked on the first item.
   */
  parallel: boolean;
  /** Line × line only: the lines were skew (witnesses are the common perpendicular's ends). */
  skew: boolean;
}>;

export type ShortestDistanceFailureReason =
  | 'non-finite-input'
  | 'zero-length-line'
  | 'degenerate-plane'
  /** The two items meet (crossing lines, a line piercing a plane, non-parallel planes, a point on the other item): shortest distance 0. */
  | 'zero-distance';

export type ShortestDistanceResult =
  | Readonly<{ ok: true; value: ShortestDistanceValues }>
  | Readonly<{ ok: false; reason: ShortestDistanceFailureReason }>;

/** |sin| of the shared parallel tolerance (0.01°). */
const PARALLEL_SIN = Math.sin((LINE_ANGLE_PARALLEL_TOLERANCE_DEG * Math.PI) / 180);
/** Squared length below which a vector is degenerate. */
const DEGENERATE_LENGTH_SQ = 1e-24;
/** Witness pairs closer than this (metres) count as zero distance (E3D: `start.distance(end) eq 0`). */
export const SHORTEST_ZERO_DISTANCE_M = 1e-9;

function isFiniteVec(value: PickVec3 | null | undefined): value is PickVec3 {
  return !!value && value.length === 3 && value.every(Number.isFinite);
}

function sub(a: PickVec3, b: PickVec3): PickVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: PickVec3, factor: number): PickVec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: PickVec3, b: PickVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: PickVec3, b: PickVec3): PickVec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(a: PickVec3): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: PickVec3): PickVec3 | null {
  const l = length(a);
  return l > 0 && Number.isFinite(l) ? scale(a, 1 / l) : null;
}

/** `PLANE.near(position)`: the foot of the perpendicular on the infinite plane. */
function footOnPlane(point: PickVec3, position: PickVec3, unitNormal: PickVec3): PickVec3 {
  return sub(point, scale(unitNormal, dot(sub(point, position), unitNormal)));
}

/** Point on `line` nearest to the infinite line `other` (`LINE.intersection(LINE)` for skew lines). */
function nearestOnLineToLine(line: PickSegment, lineDirection: PickVec3, other: PickSegment, otherDirection: PickVec3): PickVec3 {
  const w = sub(line.start, other.start);
  const a = dot(lineDirection, lineDirection);
  const b = dot(lineDirection, otherDirection);
  const c = dot(otherDirection, otherDirection);
  const d = dot(lineDirection, w);
  const e = dot(otherDirection, w);
  const denominator = a * c - b * b;
  const s = (b * e - c * d) / denominator;
  return [line.start[0] + lineDirection[0] * s, line.start[1] + lineDirection[1] * s, line.start[2] + lineDirection[2] * s];
}

function finish(kind: ShortestPairKind, start: PickVec3, end: PickVec3, parallel: boolean, skew: boolean): ShortestDistanceResult {
  const delta = sub(end, start);
  const distanceM = length(delta);
  if (!(distanceM > SHORTEST_ZERO_DISTANCE_M)) return { ok: false, reason: 'zero-distance' };
  return {
    ok: true,
    value: { kind, start, end, distanceM, direction: scale(delta, 1 / distanceM), parallel, skew },
  };
}

type Line = Readonly<{ segment: PickSegment; direction: PickVec3; picked: PickVec3 }>;
type Plane = Readonly<{ position: PickVec3; unitNormal: PickVec3; picked: PickVec3 }>;

function readLine(operand: ShortestLineOperand): Line | ShortestDistanceFailureReason {
  if (!isFiniteVec(operand.start) || !isFiniteVec(operand.end) || (operand.picked != null && !isFiniteVec(operand.picked))) {
    return 'non-finite-input';
  }
  const direction = normalize(sub(operand.end, operand.start));
  if (!direction || dot(sub(operand.end, operand.start), sub(operand.end, operand.start)) <= DEGENERATE_LENGTH_SQ) {
    return 'zero-length-line';
  }
  const segment = { start: operand.start, end: operand.end };
  // The picked position is snapped onto the infinite line (it came from a 12 px snap band).
  const picked = closestPointOnInfiniteLine(segment, operand.picked ?? operand.start);
  return { segment, direction, picked };
}

function readPlane(operand: ShortestPlaneOperand): Plane | ShortestDistanceFailureReason {
  if (!isFiniteVec(operand.position) || !isFiniteVec(operand.normal) || (operand.picked != null && !isFiniteVec(operand.picked))) {
    return 'non-finite-input';
  }
  if (dot(operand.normal, operand.normal) <= DEGENERATE_LENGTH_SQ) return 'degenerate-plane';
  const unitNormal = normalize(operand.normal);
  if (!unitNormal) return 'degenerate-plane';
  const picked = footOnPlane(operand.picked ?? operand.position, operand.position, unitNormal);
  return { position: operand.position, unitNormal, picked };
}

function pointLine(point: PickVec3, line: Line, pointFirst: boolean): ShortestDistanceResult {
  const foot = closestPointOnInfiniteLine(line.segment, point);
  return pointFirst ? finish('point-line', point, foot, false, false) : finish('point-line', foot, point, false, false);
}

function pointPlane(point: PickVec3, plane: Plane, pointFirst: boolean): ShortestDistanceResult {
  const foot = footOnPlane(point, plane.position, plane.unitNormal);
  return pointFirst ? finish('point-plane', point, foot, false, false) : finish('point-plane', foot, point, false, false);
}

function lineLine(first: Line, second: Line): ShortestDistanceResult {
  if (length(cross(first.direction, second.direction)) <= PARALLEL_SIN) {
    // 839–845: parallel — the picked position on the first line and its foot on the second.
    const start = first.picked;
    return finish('line-line', start, closestPointOnInfiniteLine(second.segment, start), true, false);
  }
  // 847–850: `first.intersection(second)` / `second.intersection(first)` — mutual nearest points.
  const start = nearestOnLineToLine(first.segment, first.direction, second.segment, second.direction);
  const end = nearestOnLineToLine(second.segment, second.direction, first.segment, first.direction);
  const gap = length(sub(end, start));
  return finish('line-line', start, end, false, gap > SHORTEST_ZERO_DISTANCE_M);
}

function linePlane(line: Line, plane: Plane): ShortestDistanceResult {
  // 867–874: parallel when the projected line keeps the line's direction, i.e. direction ⟂ normal.
  if (Math.abs(dot(line.direction, plane.unitNormal)) > PARALLEL_SIN) return { ok: false, reason: 'zero-distance' };
  // 856–874: E3D puts `start` on the line and `end` on the plane whichever of the two was picked first.
  const onLine = line.picked;
  return finish('line-plane', onLine, footOnPlane(onLine, plane.position, plane.unitNormal), true, false);
}

function planePlane(first: Plane, second: Plane): ShortestDistanceResult {
  // 885–891: only parallel planes have a distance; Web start = the picked position on the first plane.
  if (length(cross(first.unitNormal, second.unitNormal)) > PARALLEL_SIN) return { ok: false, reason: 'zero-distance' };
  const start = first.picked;
  return finish('plane-plane', start, footOnPlane(start, second.position, second.unitNormal), true, false);
}

/**
 * `gmfLine.shortest(first, second)` as the branches read (see header). The first operand is
 * always the `start` witness, the second the `end` — the order the user picked.
 */
export function buildShortestDistance(first: ShortestOperand, second: ShortestOperand): ShortestDistanceResult {
  if (first.kind === 'point' && !isFiniteVec(first.position)) return { ok: false, reason: 'non-finite-input' };
  if (second.kind === 'point' && !isFiniteVec(second.position)) return { ok: false, reason: 'non-finite-input' };

  const firstLine = first.kind === 'line' ? readLine(first) : null;
  if (typeof firstLine === 'string') return { ok: false, reason: firstLine };
  const secondLine = second.kind === 'line' ? readLine(second) : null;
  if (typeof secondLine === 'string') return { ok: false, reason: secondLine };
  const firstPlane = first.kind === 'plane' ? readPlane(first) : null;
  if (typeof firstPlane === 'string') return { ok: false, reason: firstPlane };
  const secondPlane = second.kind === 'plane' ? readPlane(second) : null;
  if (typeof secondPlane === 'string') return { ok: false, reason: secondPlane };

  if (first.kind === 'point' && second.kind === 'point') return finish('point-point', first.position, second.position, false, false);
  if (first.kind === 'point' && secondLine) return pointLine(first.position, secondLine, true);
  if (firstLine && second.kind === 'point') return pointLine(second.position, firstLine, false);
  if (first.kind === 'point' && secondPlane) return pointPlane(first.position, secondPlane, true);
  if (firstPlane && second.kind === 'point') return pointPlane(second.position, firstPlane, false);
  if (firstLine && secondLine) return lineLine(firstLine, secondLine);
  if (firstLine && secondPlane) return linePlane(firstLine, secondPlane);
  if (firstPlane && secondLine) return linePlane(secondLine, firstPlane);
  if (firstPlane && secondPlane) return planePlane(firstPlane, secondPlane);
  return { ok: false, reason: 'non-finite-input' };
}
