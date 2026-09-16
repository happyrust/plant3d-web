/**
 * State machine for the E3D **Intersect** pick type (`EDGPICKTYPE.intersect`,
 * `EDGSTATE.minor`): one measurement position is produced from two (or three)
 * sub-picks, each converted to a LINE or a PLANE.
 *
 * Source of truth (E3D 3.1 PMLLIB `edgpicktype.pmlobj` 616–960, `edgstate.pmlobj`
 * 455–500), mirrored as `static_expectation`:
 *
 * - Every sub-pick is converted first: `3D_LINE` / Graphics edge → LINE, Graphics
 *   facet / Aid PLANE → PLANE, PPOINT / DPOINT / PIN → POINTVECTOR (a line through
 *   the point along its direction), PLINE / TUBING → their axis line. An item that
 *   converts to nothing is refused with a warning and the sub-pick is **not**
 *   consumed ("Unable to convert item into a line or plane for intersection").
 * - The first converted item is stored; the prompt token advances to
 *   `Intersection[2]` (`minor` is incremented when `numberOfPicks` grows).
 * - Two items intersect unless **both are planes**, in which case a third pick is
 *   required (`golabel /nextPick`, prompt `Intersection[3]`).
 * - LINE × LINE / LINE × PLANE parallel → `(2,870)` "Pick another line, last pick
 *   was parallel to first line": only the failing pick is dropped, the first stays.
 * - PLANE × PLANE × third parallel / no unique point → `(2,874)`: the whole return
 *   stack is cleared and `numberOfPicks` reset to 1 — the user starts over.
 * - Skew lines are not an error: `LINE.intersection(LINE)` returns the point on the
 *   first line nearest to the second (see `intersectLines`).
 * - ARC items (ELBO / BEND: `edgTypes.attribute(noun).arc()`, the centreline fillet —
 *   `elementArc.ts`) are resolved as soon as the second item is in, whatever the
 *   order (`edgpicktype.pmlobj` 864–904): `ARC.intersections(item)` → 0 / 1 / 2 points
 *   on the arc's circle, the one nearest to where the arc's own pick ray meets the arc
 *   plane wins. None → `alert.warning('No intersection between picked items')`: the
 *   failing pick is refused, the first stays (like `(2,870)`). An arc **after** two
 *   planes is refused as well (`ARC.intersection(PLANE, PLANE)` does not exist), and
 *   like an unconvertible item it does not consume the pick.
 *
 * All coordinates are design-world metres like the rest of the pick kernel.
 */

import {
  intersectPicks,
  type IntersectOperand,
  type PickDerivationFailureReason,
  type PickVec3,
} from './pickDerivation';

export type { IntersectOperand } from './pickDerivation';

export type IntersectPickSession = Readonly<{
  /** Converted sub-picks accepted so far (E3D `!this.return[2..]`). */
  operands: readonly IntersectOperand[];
  /** Human-readable label of each accepted sub-pick, for the status message. */
  labels: readonly string[];
}>;

export const EMPTY_INTERSECT_SESSION: IntersectPickSession = { operands: [], labels: [] };

/** E3D prompt ordinal (`Intersection[n]`): the pick about to be made. */
export function intersectPickOrdinal(session: IntersectPickSession): number {
  return session.operands.length + 1;
}

export type IntersectPickStep =
  | Readonly<{
    status: 'need-more';
    session: IntersectPickSession;
    /** Ordinal of the next sub-pick (`Intersection[n]`). */
    nextOrdinal: number;
  }>
  | Readonly<{
    status: 'resolved';
    position: PickVec3;
    /** Lines were skew; the position lies on the first line (E3D `LINE.intersection`). */
    skew: boolean;
    /** Session after resolution — always empty (`numberOfPicks = 1`). */
    session: IntersectPickSession;
  }>
  | Readonly<{
    status: 'rejected';
    reason: PickDerivationFailureReason | 'not-convertible';
    /** E3D message code when the PML raises one. */
    e3dCode: '2,870' | '2,874' | null;
    /** Which `!!alert` E3D raises for this rejection (`warning` for 2,870 / 2,874 / no arc intersection, `error` for "Unable to convert"). */
    level: 'warning' | 'error';
    /** Session after the rejection (unchanged, or cleared for `2,874`). */
    session: IntersectPickSession;
    message: string;
  }>;

export const INTERSECT_MESSAGES = {
  notConvertible: '所选项无法转成线 / 面参与求交，请改选其它项或按 Esc 取消（E3D: Unable to convert item into a line or plane for intersection）',
  parallelToFirst: '请再选一条线：上一次拾取与第一条线平行（E3D 2,870 Pick another line, last pick was parallel to first line）',
  // The third item may be a plane or a line (a line ∥ the first plane fails the same way), so the
  // wording names "面 × 面 × 第三项" rather than "三个平面" (prompt matrix D5, 2026-09-16). The E3D
  // text of (2,874) lives in the message file and is still to be captured with E3D running.
  planesNoPoint: '面 × 面 × 第三项没有唯一交点，求交已重置，请重新拾取（E3D 2,874）',
  // `edgpicktype.pmlobj` 887: `!!alert.warning('No intersection between picked items')` — the arc's
  // circle is never met by the other item; only this pick is dropped, the first stays.
  noArcIntersection: '所选项与弧没有交点，请改选其它项（E3D: No intersection between picked items）',
} as const;

/**
 * Feed one converted sub-pick into the session. Pass `null` when the picked item
 * could not be converted to a line / plane (E3D refuses it without consuming the pick).
 */
export function advanceIntersectPick(
  session: IntersectPickSession,
  operand: IntersectOperand | null,
  label = '',
): IntersectPickStep {
  if (!operand) {
    return {
      status: 'rejected',
      reason: 'not-convertible',
      e3dCode: null,
      level: 'error',
      session,
      message: INTERSECT_MESSAGES.notConvertible,
    };
  }

  const operands = [...session.operands, operand];
  const labels = [...session.labels, label];
  const result = intersectPicks(operands);

  if (result.ok) {
    return { status: 'resolved', position: result.position, skew: result.skew, session: EMPTY_INTERSECT_SESSION };
  }
  if (result.reason === 'needs-another-pick') {
    const next: IntersectPickSession = { operands, labels };
    return { status: 'need-more', session: next, nextOrdinal: intersectPickOrdinal(next) };
  }
  const reason: PickDerivationFailureReason = result.reason;

  // PLANE × PLANE × ARC: E3D would call `ARC.intersection(PLANE, PLANE)`, which the ARC object
  // does not have — the arc simply cannot be the third item. Refused like an unconvertible item,
  // and like it the pick is not consumed: the two planes stay and a third line / plane still works.
  if (reason === 'unsupported-geometry') {
    return {
      status: 'rejected',
      reason,
      e3dCode: null,
      level: 'error',
      session,
      message: INTERSECT_MESSAGES.notConvertible,
    };
  }
  // Three-plane failure clears everything (E3D `!this.return.clear()`); the two-item
  // failures only drop the pick that failed.
  const threePlanes = operands.length >= 3 && operands.slice(0, 2).every((item) => item.kind === 'plane');
  if (threePlanes) {
    return {
      status: 'rejected',
      reason,
      e3dCode: '2,874',
      level: 'warning',
      session: EMPTY_INTERSECT_SESSION,
      message: INTERSECT_MESSAGES.planesNoPoint,
    };
  }
  if (reason === 'no-arc-intersection') {
    return {
      status: 'rejected',
      reason,
      e3dCode: null,
      level: 'warning',
      session,
      message: INTERSECT_MESSAGES.noArcIntersection,
    };
  }
  const parallel = reason === 'parallel-lines' || reason === 'ray-parallel' || reason === 'parallel-planes';
  return {
    status: 'rejected',
    reason,
    e3dCode: parallel ? '2,870' : null,
    level: parallel ? 'warning' : 'error',
    session,
    message: parallel ? INTERSECT_MESSAGES.parallelToFirst : INTERSECT_MESSAGES.notConvertible,
  };
}

/**
 * Converts the geometry a Web pick candidate lends (design-world) into an
 * Intersect operand, following `EDGPICKTYPE.intersect`'s per-type conversion:
 * line-bearing (`segment`) → LINE; plane-bearing → PLANE; the picked element's
 * centreline arc (ELBO / BEND, `elementArc.ts`) → ARC, which the ELEMENT branch
 * only reaches when `line()` is unset (`edgpicktype.pmlobj` 647–680); point with
 * direction (P-point / primitive axis) → POINTVECTOR line; a bare point → not
 * convertible. `arc.picked` is where the ray that picked the arc meets the arc
 * plane — it decides which of two intersections wins (`intersectArcWith`).
 */
export function intersectOperandFromGeometry(input: Readonly<{
  segment?: Readonly<{ start: PickVec3; end: PickVec3 }> | null;
  plane?: Readonly<{ position: PickVec3; normal: PickVec3 }> | null;
  arc?: Readonly<{ center: PickVec3; normal: PickVec3; radius: number; picked: PickVec3 }> | null;
  position?: PickVec3 | null;
  direction?: PickVec3 | null;
}>): IntersectOperand | null {
  const finite = (v: PickVec3 | null | undefined): v is PickVec3 => !!v && v.length === 3 && v.every(Number.isFinite);
  const lengthSq = (v: PickVec3) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (input.segment && finite(input.segment.start) && finite(input.segment.end)) {
    const d: PickVec3 = [
      input.segment.end[0] - input.segment.start[0],
      input.segment.end[1] - input.segment.start[1],
      input.segment.end[2] - input.segment.start[2],
    ];
    if (lengthSq(d) > 1e-24) return { kind: 'line', start: input.segment.start, end: input.segment.end };
  }
  if (input.plane && finite(input.plane.position) && finite(input.plane.normal) && lengthSq(input.plane.normal) > 1e-24) {
    return { kind: 'plane', position: input.plane.position, normal: input.plane.normal };
  }
  const arc = input.arc;
  if (
    arc && finite(arc.center) && finite(arc.normal) && finite(arc.picked)
    && lengthSq(arc.normal) > 1e-24 && Number.isFinite(arc.radius) && arc.radius > 0
  ) {
    return { kind: 'arc', center: arc.center, normal: arc.normal, radius: arc.radius, picked: arc.picked };
  }
  if (finite(input.position) && finite(input.direction) && lengthSq(input.direction) > 1e-24) {
    const [x, y, z] = input.position;
    const [dx, dy, dz] = input.direction;
    return { kind: 'line', start: input.position, end: [x + dx, y + dy, z + dz] };
  }
  return null;
}
