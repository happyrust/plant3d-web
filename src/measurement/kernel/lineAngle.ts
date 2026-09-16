/**
 * Pure kernel for E3D **"Angle 2 Lines"** (ribbon `AVEVA.DesignGeneral.buttonMeasureAngleLines`
 * → `designViewMeasure.execute('LINEANGLE')` → `gphViews.measure('LINEANGLE')` →
 * `GPHANGLEDIMENSION.edit('LINEANGLEARC')` → `EDGPICKPACKET.measureLineAngleArc()`).
 *
 * Source of truth (E3D 3.1 PMLLIB, mirrored as `static_expectation` — the E3D process
 * was not running when this was written, G6-04 runtime golden still owed):
 *
 * - `edgpickpacket.pmlobj` 635–651: two `stdGraphics` picks — `first line` (facet
 *   `EDGE` only) and `second line or plane` (`FACET EDGE`); the action is
 *   `gmfArc.radius2LinesNoError(first.positionData(), second.positionData())` and the
 *   resulting ARC goes to the **same** Measure Angle form as the three-point measure
 *   (`gphAngleMeasure.setMeasure(arc)` → four rows Decimal Angle / DMS / Direction1 /
 *   Direction2, `gphanglemeasure.pmlfrm` 334–410).
 * - `gmfarc.pmlobj` 802–917 `radius2Lines`:
 *   - **Two lines**: root = `baseLine.intersection(referenceLine)` — exact when coplanar,
 *     for skew lines the point on the **first** line nearest to the second (same
 *     `LINE.intersection` reading as the Intersect pick type), parallel → error →
 *     `alert.error('An angular dimension could not be constructed from the data selected')`.
 *     The second arm is the reference line **moved to pass through the root**, oriented
 *     from the reference line's nearest point towards the position the user picked on it
 *     (`referenceLine.intersection(baseLine).line(pickedPoint2).direction()`); the first
 *     arm is the base line oriented from the root towards the picked position (the
 *     start / end swap at 871–890). So the reported angle is the angle at the root
 *     between the two **picked half-lines**: picking the other side of either line
 *     yields the supplementary angle — that is E3D behaviour, not a bug.
 *   - **Line + facet (plane)**: the reference is the base line projected onto the plane.
 *     Base line lying in the plane (both ends < 0.1 mm) → zero-angle arc (radius 100 mm,
 *     X = base direction); base line perpendicular to the plane (projection collapses to a
 *     point) → the reference becomes an in-plane direction (E3D: the picked item's ORI X,
 *     Web: the caller-supplied `xDirection` or a world axis projected into the plane) and
 *     the angle is 90°; otherwise root = where the base line pierces the plane and the
 *     angle is the one between the base line and its projection. Base line parallel to
 *     the plane but off it → the projection is parallel to the base → error.
 *   - Radius (892–903): root outside the base segment → distance from the root to the
 *     nearer base end; otherwise half the shorter of the two lines; never below 500 mm.
 *   - Arc: X = base direction, Z = normal of the plane (root, picked1, picked2),
 *     startAngle 0, endAngle = `root.angle(picked1, picked2)` ∈ [0°, 180°] (minor).
 *
 * The sibling packet `EDGPICKPACKET.measureLineAngle` (667–683, prompt matrix D6) is a different
 * command, not a variant of this one: both of its picks are `EDGE`-only, its action is
 * `gmfAngle.betweenLines(...)` and it returns a REAL rather than an ARC, so it draws nothing and
 * never reaches the Measure Angle form (`gphAngleMeasure.setMeasure` only accepts an `ARC`). Its
 * callers are the three design forms that measure an angle straight into an input field — the
 * "Angle between two lines" menu item in `dbeelementangle.pmlfrm` 799, `dbesrevolution.pmlfrm` 658
 * and `dbeloopedit.pmlfrm` 1716 — and Web has no such field, so there is no second mode here.
 * Numerically the two agree: `betweenLines` (`gmfangle.pmlobj` 81–103) projects the reference pick
 * onto the plane through the root, which is the same operation as moving the reference line onto
 * the root, so its angle is this arc's `endAngle` (`lineAngle.test.ts` pins it case by case). The
 * one divergence is parallel input — `betweenLines` swallows the intersection error and returns 0,
 * while `radius2Lines`, and Web with it, reject.
 *
 * Deliberate Web resolutions of `radius2Lines` corner cases (documented, not E3D
 * behaviour): a picked position exactly at the root keeps the line's own direction
 * (E3D offsets it 100 mm up and measures a meaningless angle); in the line + plane case
 * the projected arm is oriented towards the projection of the picked position (E3D takes
 * the projected line's *end*, so the same picks give θ or 180° − θ depending on the
 * facet edge's stored start / end order); two lines (or a line and a plane) less than
 * `LINE_ANGLE_PARALLEL_TOLERANCE_DEG` apart count as parallel — Web inputs are float32
 * mesh edges, and two design-parallel members come back ~1e-5 rad apart, which E3D's exact
 * `LINE.intersection` would reject but a bare cross-product test would turn into an arc
 * centred hundreds of kilometres away (seen live: 0.0004° → root 762 km off); the finished
 * arc is de-noised before it becomes a record (`LINE_ANGLE_DIRECTION_SNAP` /
 * `LINE_ANGLE_ANGLE_SNAP_DEG`, shared with the three-point kernel through `angleSnap.ts`):
 * arm components below 1e-6 are zeroed (a projected arm that
 * is geometrically vertical came back as (1.2e-9, 1.7e-9, 1) and printed `N 35.00 E 90.00 U`
 * instead of `U`) and the angle is rounded to 1e-5° (a design 70° came back as 69.9999979°,
 * which E3D's truncating DMS shows as `69° 59' 59''`). Both are far below any design angle
 * or display resolution (DMS 1'' = 2.8e-4°) and far above the mesh noise seen live
 * (~4e-8 per component, ~2e-6°) — golden MD §30「补采」.
 *
 * All coordinates are design-world metres (X = E, Y = N, Z = U).
 */

import { ANGLE_DEGREES_SNAP_DEG, ANGLE_DIRECTION_SNAP, snapAngleDegrees, snapUnitDirection } from './angleSnap';
import {
  closestPointOnInfiniteLine,
  intersectLines,
  isWithinSegmentExtent,
  type PickPlane,
  type PickSegment,
  type PickVec3,
} from './pickDerivation';

export type LineAngleLineOperand = Readonly<{
  kind: 'line';
  /** Two points on the picked line (facet edge / p-line / axis), design metres. */
  start: PickVec3;
  end: PickVec3;
  /** Position the user picked on that line (`EDGPOSITIONDATA.position`). */
  picked: PickVec3;
}>;

export type LineAnglePlaneOperand = Readonly<{
  kind: 'plane';
  position: PickVec3;
  normal: PickVec3;
  /**
   * In-plane direction used when the base line is perpendicular to the plane (E3D uses the
   * picked item's `ORI` X). Optional — a world axis projected into the plane is used otherwise.
   */
  xDirection?: PickVec3 | null;
}>;

export type LineAngleReferenceOperand = LineAngleLineOperand | LineAnglePlaneOperand;

export type LineAngleValues = Readonly<{
  kind: 'line-line' | 'line-plane';
  /** Arc position: intersection (or, for skew lines, the point on the base line nearest the reference). */
  root: PickVec3;
  /** Minor angle in degrees, [0°, 180°]. */
  angleDeg: number;
  /** Unit direction of the first arm (E3D Direction1): base line, from the root towards the picked position. */
  direction1: PickVec3;
  /** Unit direction of the second arm (E3D Direction2): reference line moved to the root / projected base line. */
  direction2: PickVec3;
  /** Arc radius in metres after E3D's radius rule (`min 500mm`; 100 mm for the in-plane zero arc). */
  radiusM: number;
  /** Unit normal of the arc plane (direction1 × direction2); `null` for the zero-angle arc. */
  planeNormal: PickVec3 | null;
  /** Two-line case only: the lines were skew — the root lies on the base line. */
  skew: boolean;
  /** Two-line case only: shortest distance between the two lines (0 when they intersect). */
  gapM: number;
  /** Line + plane case only: the base line lies in the plane (E3D zero-angle arc). */
  inPlane: boolean;
}>;

export type LineAngleFailureReason =
  | 'non-finite-input'
  | 'zero-length-line'
  | 'degenerate-plane'
  /** E3D `LINE.intersection` (2,870) inside `radius2Lines` → "Unable to derive arc from given lines". */
  | 'parallel-lines'
  /** Base line parallel to the plane but not in it → its projection is parallel → same E3D error. */
  | 'line-parallel-to-plane';

export type LineAngleResult =
  | Readonly<{ ok: true; value: LineAngleValues }>
  | Readonly<{ ok: false; reason: LineAngleFailureReason }>;

/** E3D `radius2Lines` 901–903: `if (!return.radius lt 500mm) then !return.radius = 500mm`. */
export const LINE_ANGLE_MIN_RADIUS_M = 0.5;
/** E3D `radius2Lines` 831: the zero-angle arc drawn for a base line lying in the plane. */
export const LINE_ANGLE_IN_PLANE_RADIUS_M = 0.1;
/** E3D `radius2Lines` 830: both ends of the projected line within 0.1 mm of the base line. */
const IN_PLANE_TOLERANCE_M = 1e-4;
/** Squared length below which a vector is degenerate. */
const DEGENERATE_LENGTH_SQ = 1e-24;
/**
 * Web resolution (see header): lines / a line and a plane closer than this to parallel are
 * rejected as parallel instead of producing a far-away arc. 0.01° is far above float32 mesh
 * noise (~1e-5 rad on design-parallel members) and far below any deliberate structural angle.
 */
export const LINE_ANGLE_PARALLEL_TOLERANCE_DEG = 0.01;
/** |sin| of `LINE_ANGLE_PARALLEL_TOLERANCE_DEG`. */
const PARALLEL_SIN = Math.sin((LINE_ANGLE_PARALLEL_TOLERANCE_DEG * Math.PI) / 180);
/** Exact-degeneracy threshold for normals / in-plane directions (not an angular tolerance). */
const DEGENERATE_SIN = 1e-9;
/**
 * Web resolution (see header), shared with the three-point kernel through `angleSnap.ts`: an
 * arm component with |value| below this is mesh noise and is zeroed before the arm is
 * re-normalised, so a geometrically axis-aligned arm prints as `U` / `E` … rather than
 * `N 35.00 E 90.00 U`. 1e-6 on a unit vector ≈ 6e-5°, far below the 0.01° parallel tolerance
 * and ~25× above the noise seen live.
 */
export const LINE_ANGLE_DIRECTION_SNAP = ANGLE_DIRECTION_SNAP;
/**
 * Web resolution (see header), shared with the three-point kernel: the finished angle is
 * rounded to this grid so mesh noise cannot turn a design 70° into 69.9999979° (E3D's
 * truncating DMS would show `69° 59' 59''`). 1e-5° is 0.036'' — below the DMS resolution and
 * below every Decimal Places setting that shows anything but mesh noise — and ~5× above the
 * angular noise seen live.
 */
export const LINE_ANGLE_ANGLE_SNAP_DEG = ANGLE_DEGREES_SNAP_DEG;

function isFiniteVec(value: PickVec3 | null | undefined): value is PickVec3 {
  return !!value && value.length === 3 && value.every(Number.isFinite);
}

function sub(a: PickVec3, b: PickVec3): PickVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: PickVec3, b: PickVec3): PickVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: PickVec3, factor: number): PickVec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: PickVec3, b: PickVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: PickVec3, b: PickVec3): PickVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a: PickVec3): number {
  return Math.sqrt(dot(a, a));
}

function distance(a: PickVec3, b: PickVec3): number {
  return length(sub(a, b));
}

function normalize(a: PickVec3): PickVec3 | null {
  const l = length(a);
  return l > 0 && Number.isFinite(l) ? scale(a, 1 / l) : null;
}

/** Angle between two unit vectors in degrees, [0, 180]. */
function angleBetweenDeg(a: PickVec3, b: PickVec3): number {
  return (Math.atan2(length(cross(a, b)), dot(a, b)) * 180) / Math.PI;
}

/**
 * E3D 871–890: flip a line direction so the root is its start — the arm points from the
 * root towards the position the user picked. A picked position at the root keeps the
 * stored direction (see the header note).
 */
function orientTowards(direction: PickVec3, root: PickVec3, picked: PickVec3): PickVec3 {
  const towards = sub(picked, root);
  return dot(towards, direction) < 0 ? scale(direction, -1) : direction;
}

/**
 * E3D 892–903: root outside the base segment → distance to the nearer base end; otherwise
 * half of the shorter line; never below 500 mm.
 */
function arcRadius(base: PickSegment, root: PickVec3, referenceLengthM: number): number {
  const baseLength = distance(base.start, base.end);
  const radius = isWithinSegmentExtent(base, root)
    ? Math.min(referenceLengthM / 2, baseLength / 2)
    : Math.min(distance(root, base.start), distance(root, base.end));
  return Math.max(radius, LINE_ANGLE_MIN_RADIUS_M);
}

function projectOntoPlane(point: PickVec3, plane: Readonly<{ position: PickVec3; unitNormal: PickVec3 }>): PickVec3 {
  const offset = dot(sub(point, plane.position), plane.unitNormal);
  return sub(point, scale(plane.unitNormal, offset));
}

/** A unit direction lying in the plane: the caller's X if usable, else the first world axis not parallel to the normal. */
function inPlaneDirection(unitNormal: PickVec3, preferred: PickVec3 | null | undefined): PickVec3 {
  const candidates: PickVec3[] = [];
  if (isFiniteVec(preferred)) candidates.push(preferred);
  candidates.push([1, 0, 0], [0, 1, 0], [0, 0, 1]);
  for (const candidate of candidates) {
    const projected = sub(candidate, scale(unitNormal, dot(candidate, unitNormal)));
    const unit = normalize(projected);
    if (unit && length(projected) > DEGENERATE_SIN) return unit;
  }
  return [1, 0, 0];
}

/** Zero the mesh-noise components of a unit arm and re-normalise (`angleSnap.snapUnitDirection`). */
export function snapLineAngleDirection(direction: PickVec3): PickVec3 {
  return snapUnitDirection(direction);
}

/** Round an angle in degrees to the `LINE_ANGLE_ANGLE_SNAP_DEG` grid (`angleSnap.snapAngleDegrees`). */
export function snapLineAngleDegrees(angleDeg: number): number {
  return snapAngleDegrees(angleDeg);
}

/**
 * Geometry a pick lends to the two-line angle (design metres): a line (facet edge / p-line /
 * axis / element `line()`), a plane (facet / aid plane), or a bare point with a direction
 * (P-point / design point). `picked` is where the user picked (`EDGPOSITIONDATA.position`).
 */
export type LineAnglePickGeometry = Readonly<{
  segment?: Readonly<{ start: PickVec3; end: PickVec3 }> | null;
  plane?: Readonly<{ position: PickVec3; normal: PickVec3 }> | null;
  position?: PickVec3 | null;
  direction?: PickVec3 | null;
  picked?: PickVec3 | null;
}>;

/**
 * `radius2Lines(base, reference)` reads `reference.line` and `reference.plane` — the members
 * E3D's `EDGPOSITIONDATA.line()` / `.plane()` accessors fill from `getLine()` / `getPlane()`.
 * A **line** pick (edge / p-line / axis / element `line()`) is a LINE for both roles; a **facet**
 * (or aid plane) is a PLANE. A bare point that carries a direction (P-point, design point) is a
 * LINE for the first pick (`getLine()`: the P-point axis, same as the Intersect conversion) but
 * a **PLANE** for the second pick — `EDGPOSITIONDATA.getPlane()` has explicit branches
 * `PPOINT → PLANE(pPosition, Z is pDirection)` and `DPOINT → PLANE(dpps, Z is dpdir)`
 * (`edgpositiondata.pmlobj` 421–608), the same plane Perpendicular-to uses for a design point
 * (golden MD §29). E3D itself only offers `FACET EDGE` on that pick, so admitting P-points /
 * design points there is a Web extension; this is the E3D conversion it follows
 * (golden MD §30「补采」, 2026-09-16). Unconvertible → `null`.
 */
export function lineAngleOperandFromGeometry(
  input: LineAnglePickGeometry,
  role: 'first' | 'second',
): LineAngleReferenceOperand | null {
  const finite = (v: PickVec3 | null | undefined): v is PickVec3 => !!v && v.length === 3 && v.every(Number.isFinite);
  const lengthSq = (v: PickVec3) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (input.segment && finite(input.segment.start) && finite(input.segment.end)) {
    const d = sub(input.segment.end, input.segment.start);
    if (lengthSq(d) > DEGENERATE_LENGTH_SQ) {
      const picked = finite(input.picked) ? input.picked : input.segment.start;
      return { kind: 'line', start: input.segment.start, end: input.segment.end, picked };
    }
  }
  if (input.plane && finite(input.plane.position) && finite(input.plane.normal) && lengthSq(input.plane.normal) > DEGENERATE_LENGTH_SQ) {
    return { kind: 'plane', position: input.plane.position, normal: input.plane.normal };
  }
  if (finite(input.position) && finite(input.direction) && lengthSq(input.direction) > DEGENERATE_LENGTH_SQ) {
    if (role === 'second') {
      return { kind: 'plane', position: input.position, normal: input.direction };
    }
    const [x, y, z] = input.position;
    const [dx, dy, dz] = input.direction;
    return { kind: 'line', start: input.position, end: [x + dx, y + dy, z + dz], picked: input.position };
  }
  return null;
}

function finishArc(input: Readonly<{
  kind: LineAngleValues['kind'];
  root: PickVec3;
  direction1: PickVec3;
  direction2: PickVec3;
  radiusM: number;
  skew: boolean;
  gapM: number;
  inPlane: boolean;
}>): LineAngleValues {
  // Web resolution (see header): de-noise the arms first, then measure the angle between the
  // de-noised arms and round it — so angle, DMS, both Direction strings and the arm ends all
  // come from the same snapped pair.
  const direction1 = snapLineAngleDirection(input.direction1);
  const direction2 = snapLineAngleDirection(input.direction2);
  const normal = cross(direction1, direction2);
  const normalLength = length(normal);
  return {
    kind: input.kind,
    root: input.root,
    angleDeg: snapLineAngleDegrees(angleBetweenDeg(direction1, direction2)),
    direction1,
    direction2,
    radiusM: input.radiusM,
    planeNormal: normalLength > PARALLEL_SIN ? scale(normal, 1 / normalLength) : null,
    skew: input.skew,
    gapM: input.gapM,
    inPlane: input.inPlane,
  };
}

function buildLineLine(base: LineAngleLineOperand, reference: LineAngleLineOperand): LineAngleResult {
  const baseDirection = normalize(sub(base.end, base.start));
  const referenceDirection = normalize(sub(reference.end, reference.start));
  if (!baseDirection || !referenceDirection) return { ok: false, reason: 'zero-length-line' };
  if (length(cross(baseDirection, referenceDirection)) <= PARALLEL_SIN) {
    return { ok: false, reason: 'parallel-lines' };
  }

  // `baseLine.intersection(referenceLine)`: on the base line, nearest to the reference for skew lines.
  const intersection = intersectLines(base, reference);
  if (!intersection.ok) {
    return { ok: false, reason: intersection.reason === 'parallel-lines' ? 'parallel-lines' : 'zero-length-line' };
  }
  const root = intersection.position;
  // `referenceLine.intersection(baseLine)`: the reference line's own nearest point; the second
  // arm runs from there towards the picked position, then is moved onto the root.
  const onReference = closestPointOnInfiniteLine(reference, root);
  const direction1 = orientTowards(baseDirection, root, base.picked);
  const direction2 = orientTowards(referenceDirection, onReference, reference.picked);
  return {
    ok: true,
    value: finishArc({
      kind: 'line-line',
      root,
      direction1,
      direction2,
      radiusM: arcRadius(base, root, distance(reference.start, reference.end)),
      skew: intersection.skew,
      gapM: distance(root, onReference),
      inPlane: false,
    }),
  };
}

function buildLinePlane(base: LineAngleLineOperand, reference: LineAnglePlaneOperand): LineAngleResult {
  const baseDirection = normalize(sub(base.end, base.start));
  if (!baseDirection) return { ok: false, reason: 'zero-length-line' };
  const unitNormal = normalize(reference.normal);
  if (!unitNormal) return { ok: false, reason: 'degenerate-plane' };
  const plane = { position: reference.position, unitNormal };

  // 827–838: `baseLine.projected(plane)`; both ends within 0.1 mm → the line lies in the plane.
  const projectedStart = projectOntoPlane(base.start, plane);
  const projectedEnd = projectOntoPlane(base.end, plane);
  if (distance(projectedStart, base.start) < IN_PLANE_TOLERANCE_M && distance(projectedEnd, base.end) < IN_PLANE_TOLERANCE_M) {
    return {
      ok: true,
      value: finishArc({
        kind: 'line-plane',
        root: projectedStart,
        direction1: baseDirection,
        direction2: baseDirection,
        radiusM: LINE_ANGLE_IN_PLANE_RADIUS_M,
        skew: false,
        gapM: 0,
        inPlane: true,
      }),
    };
  }

  const sine = length(cross(baseDirection, unitNormal));
  const cosine = dot(baseDirection, unitNormal);
  // 840–843: the projection collapsed to a point — the base line is perpendicular to the plane
  // (exact degeneracy, like E3D's `startposition eq endposition`; not the angular tolerance).
  if (sine <= DEGENERATE_SIN) {
    const root = projectedStart;
    const direction1 = orientTowards(baseDirection, root, base.picked);
    const direction2 = inPlaneDirection(unitNormal, reference.xDirection);
    return {
      ok: true,
      value: finishArc({
        kind: 'line-plane',
        root,
        direction1,
        direction2,
        radiusM: arcRadius(base, root, distance(base.start, base.end)),
        skew: false,
        gapM: 0,
        inPlane: false,
      }),
    };
  }
  // 850–853: base ∩ projected line — only exists where the base line pierces the plane.
  if (Math.abs(cosine) <= PARALLEL_SIN) return { ok: false, reason: 'line-parallel-to-plane' };
  const t = dot(sub(plane.position, base.start), unitNormal) / cosine;
  const root = add(base.start, scale(baseDirection, t));
  const projectedDirection = normalize(sub(projectedEnd, projectedStart));
  if (!projectedDirection) return { ok: false, reason: 'line-parallel-to-plane' };
  const direction1 = orientTowards(baseDirection, root, base.picked);
  const direction2 = orientTowards(projectedDirection, root, projectOntoPlane(base.picked, plane));
  return {
    ok: true,
    value: finishArc({
      kind: 'line-plane',
      root,
      direction1,
      direction2,
      radiusM: arcRadius(base, root, distance(projectedStart, projectedEnd)),
      skew: false,
      gapM: 0,
      inPlane: false,
    }),
  };
}

/**
 * `gmfArc.radius2Lines(base, reference)` as values: the first pick must be a line, the second
 * a line or a plane. Failures map to E3D's "Unable to derive arc from given lines" →
 * "An angular dimension could not be constructed from the data selected".
 */
export function buildLineAngle(base: LineAngleLineOperand, reference: LineAngleReferenceOperand): LineAngleResult {
  if (!isFiniteVec(base.start) || !isFiniteVec(base.end) || !isFiniteVec(base.picked)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  if (reference.kind === 'line') {
    if (!isFiniteVec(reference.start) || !isFiniteVec(reference.end) || !isFiniteVec(reference.picked)) {
      return { ok: false, reason: 'non-finite-input' };
    }
    return buildLineLine(base, reference);
  }
  if (!isFiniteVec(reference.position) || !isFiniteVec(reference.normal)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  if (dot(reference.normal, reference.normal) <= DEGENERATE_LENGTH_SQ) {
    return { ok: false, reason: 'degenerate-plane' };
  }
  return buildLinePlane(base, reference);
}

/** Arm end at the arc radius: `root + radius · direction` (E3D `arc.anglePosition(start / end)`). */
export function lineAngleArmEnd(value: LineAngleValues, arm: 'first' | 'second'): PickVec3 {
  const direction = arm === 'first' ? value.direction1 : value.direction2;
  return add(value.root, scale(direction, value.radiusM));
}
