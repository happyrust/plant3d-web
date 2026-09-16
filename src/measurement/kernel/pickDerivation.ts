/**
 * Pure kernel for the E3D Positioning Control **pick types** (Snap · Distance ·
 * Mid-Point · Fraction · Proportion · Cursor · Intersect).
 *
 * Source of truth: E3D 3.1 PMLLIB `edgpicktype.pmlobj` (per-pick-type dispatch on
 * the picked item type) and `gmfline.pmlobj` (`GMFLINE.snap / distance /
 * proportion / fraction`, the line engine every line-bearing pick — PLINE, TUBING,
 * GRAPHICS edge, Aid LINE — is routed through), `edgtubing.pmlobj`,
 * `edgpline.pmlobj`, `edgposcntrl.pmlobj` (`loadPicks`: Mid-Point ≡ Proportion 0.5,
 * defaults Distance 0 / Fraction 2 / Proportion 0.5).
 *
 * Evidence status (golden capture §1 rule): every rule below is a
 * `static_expectation` derived from the PML source; the runtime golden group
 * **G8** (`docs/verification/e3d-measurement-runtime-golden-capture.md`) is still
 * to be captured and must not be claimed as observed.
 *
 * Observable contract mirrored here:
 * - The **control point** of a line-bearing pick is the intersection of the pick
 *   ray with the item line (`LINE.intersection(pointVector.line(1000mm))`); for
 *   skew lines that is the point on the item line nearest to the ray.
 * - `GMFLINE` first re-orients the line so the end **nearest to the control
 *   point** becomes `start` (`reverseSense`; a tie keeps the original sense).
 * - `Snap` returns that nearest end. `Cursor` (`exact`) returns the control point.
 * - `Distance d` walks `d` from the nearest end **without** clamping to the
 *   extent (negative or over-length values are honoured).
 * - `Proportion p` / `Mid-Point` (p = 0.5) walk `p · length` from the nearest end;
 *   if the control point projects **outside** the extent the nearest end is
 *   returned instead.
 * - `Fraction n` (n truncated to an integer) splits the line into `n` equal
 *   segments and returns the split point nearest to the control point (ties go
 *   to the segment start, i.e. towards the nearest end); outside the extent →
 *   nearest end; `n < 1` → the control point itself (the PML loop never runs).
 * - Point-bearing picks (PPOINT / DPOINT / Aid POSITION) ignore every pick type
 *   except `Distance`, which offsets the P-point along its direction.
 * - Plane-bearing picks (GRAPHICS facet, Aid PLANE) return the ray ∩ plane
 *   position for every single-pick type.
 * - `Intersect` converts each pick into a LINE / PLANE / ARC and intersects them
 *   (line × line, line × plane, plane × plane × plane); parallel inputs are the
 *   E3D `(2,870)` "Pick another line, last pick was parallel to first line".
 *   An ARC (ELBO / BEND centreline fillet, `elementArc.ts`) is always the subject
 *   (`edgpicktype.pmlobj` 864–904 "Make sure arc is always first"): `ARC.intersections`
 *   gives the 0 / 1 / 2 angles where the other item meets the arc's circle, and the
 *   position nearest to where the **arc's own pick ray** meets the arc plane wins;
 *   none → `alert.warning('No intersection between picked items')`.
 *
 * All coordinates are design-world metres (X=E, Y=N, Z=U); `distance` is metres.
 */

export type PickVec3 = readonly [number, number, number];

export type PickSegment = Readonly<{ start: PickVec3; end: PickVec3 }>;

export type PickRay = Readonly<{ origin: PickVec3; direction: PickVec3 }>;

export type PickPlane = Readonly<{ position: PickVec3; normal: PickVec3 }>;

/** Geometry a pick candidate lends to the pick-type derivation. */
export type PickGeometry =
  | Readonly<{ kind: 'point'; position: PickVec3; direction?: PickVec3 | null }>
  | Readonly<{ kind: 'segment'; start: PickVec3; end: PickVec3 }>
  | Readonly<{ kind: 'plane'; position: PickVec3; normal: PickVec3 }>;

/** Single-pick types (`Intersect` needs two or three picks, see `intersectPicks`). */
export type PickDerivationType =
  | 'snap'
  | 'exact'
  | 'distance'
  | 'midpoint'
  | 'fraction'
  | 'proportion';

export type PickDerivationFailureReason =
  | 'non-finite-input'
  | 'zero-length-segment'
  | 'degenerate-plane'
  | 'ray-parallel'
  | 'parallel-lines'
  | 'parallel-planes'
  /** ARC × item: the item never meets the arc's circle (E3D "No intersection between picked items"). */
  | 'no-arc-intersection'
  | 'unsupported-geometry';

export type PickDerivationResult =
  | Readonly<{
    ok: true;
    position: PickVec3;
    /** Which original end `GMFLINE` treated as `start` (segment geometry only). */
    nearEnd?: 'start' | 'end';
  }>
  | Readonly<{ ok: false; reason: PickDerivationFailureReason }>;

/** Squared length below which two points coincide / a vector is degenerate. */
const DEGENERATE_LENGTH_SQ = 1e-24;
/** Tolerance on the projection parameter for `LINE.onProjected`. */
const EXTENT_EPSILON = 1e-9;
/** |sin| below which two directions count as parallel. */
const PARALLEL_SIN = 1e-9;

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

function lengthSq(a: PickVec3): number {
  return dot(a, a);
}

function distanceSq(a: PickVec3, b: PickVec3): number {
  return lengthSq(sub(a, b));
}

function normalize(a: PickVec3): PickVec3 | null {
  const length = Math.sqrt(lengthSq(a));
  return length > 0 ? scale(a, 1 / length) : null;
}

function clone(a: PickVec3): PickVec3 {
  return [a[0], a[1], a[2]];
}

function isFiniteSegment(segment: PickSegment): boolean {
  return isFiniteVec(segment.start) && isFiniteVec(segment.end);
}

function isFiniteRay(ray: PickRay): boolean {
  return isFiniteVec(ray.origin) && isFiniteVec(ray.direction) && lengthSq(ray.direction) > DEGENERATE_LENGTH_SQ;
}

function isFinitePlane(plane: PickPlane): boolean {
  return isFiniteVec(plane.position) && isFiniteVec(plane.normal) && lengthSq(plane.normal) > DEGENERATE_LENGTH_SQ;
}

/** Projection parameter `t` of `point` onto the infinite line through `segment` (`t = 0` start, `t = 1` end). */
function projectionParameter(segment: PickSegment, point: PickVec3): number {
  const axis = sub(segment.end, segment.start);
  const axisLengthSq = lengthSq(axis);
  if (axisLengthSq <= DEGENERATE_LENGTH_SQ) return 0;
  return dot(sub(point, segment.start), axis) / axisLengthSq;
}

/** `LINE.near(position)`: nearest point on the **infinite** line through the segment. */
export function closestPointOnInfiniteLine(segment: PickSegment, point: PickVec3): PickVec3 {
  const t = projectionParameter(segment, point);
  return add(segment.start, scale(sub(segment.end, segment.start), t));
}

/** `LINE.onProjected(position)`: the projection of `point` lies within the segment extent. */
export function isWithinSegmentExtent(segment: PickSegment, point: PickVec3): boolean {
  const t = projectionParameter(segment, point);
  return t >= -EXTENT_EPSILON && t <= 1 + EXTENT_EPSILON;
}

/** `LINE.proportion(p)`: unclamped linear interpolation along the segment. */
export function pointAtProportion(segment: PickSegment, proportion: number): PickVec3 {
  return add(segment.start, scale(sub(segment.end, segment.start), proportion));
}

/**
 * `LINE.intersection(pointVector.line(1000mm))`: the control point a pick ray
 * puts on an item line — for skew lines the point on the item line nearest to
 * the ray. `null` when the ray is parallel to the line (E3D raises there).
 */
export function lineRayControlPoint(segment: PickSegment, ray: PickRay): PickVec3 | null {
  if (!isFiniteSegment(segment) || !isFiniteRay(ray)) return null;
  const u = sub(segment.end, segment.start);
  if (lengthSq(u) <= DEGENERATE_LENGTH_SQ) return clone(segment.start);
  const v = ray.direction;
  const w = sub(segment.start, ray.origin);
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w);
  const e = dot(v, w);
  const denominator = a * c - b * b;
  // sin²θ · |u|² · |v|² — parallel when the sine vanishes.
  if (denominator <= PARALLEL_SIN * PARALLEL_SIN * a * c) return null;
  const s = (b * e - c * d) / denominator;
  return add(segment.start, scale(u, s));
}

/** Ray ∩ plane (`POINTVECTOR.intersection(PLANE)`); `null` when parallel. */
export function rayPlaneIntersection(ray: PickRay, plane: PickPlane): PickVec3 | null {
  if (!isFiniteRay(ray) || !isFinitePlane(plane)) return null;
  const denominator = dot(ray.direction, plane.normal);
  const normalLength = Math.sqrt(lengthSq(plane.normal));
  const directionLength = Math.sqrt(lengthSq(ray.direction));
  if (Math.abs(denominator) <= PARALLEL_SIN * normalLength * directionLength) return null;
  const t = dot(sub(plane.position, ray.origin), plane.normal) / denominator;
  return add(ray.origin, scale(ray.direction, t));
}

/**
 * `GMFLINE` `reverseSense` rule: orient the segment so the end nearest to the
 * control point becomes `start`. A tie keeps the original sense (`gt`, not `ge`).
 */
export function orientSegmentToNearEnd(
  segment: PickSegment,
  control: PickVec3,
): Readonly<{ segment: PickSegment; nearEnd: 'start' | 'end' }> {
  const near = closestPointOnInfiniteLine(segment, control);
  if (distanceSq(near, segment.start) > distanceSq(near, segment.end)) {
    return { segment: { start: segment.end, end: segment.start }, nearEnd: 'end' };
  }
  return { segment, nearEnd: 'start' };
}

/** `GMFLINE.snap(control)`: the end nearest to the control point (tie → start). */
export function snapSegmentEnd(segment: PickSegment, control: PickVec3): PickDerivationResult {
  if (!isFiniteSegment(segment) || !isFiniteVec(control)) return { ok: false, reason: 'non-finite-input' };
  const oriented = orientSegmentToNearEnd(segment, control);
  return { ok: true, position: clone(oriented.segment.start), nearEnd: oriented.nearEnd };
}

/**
 * `GMFLINE.distance(d, control)`: `d` metres from the nearest end along the
 * line, **not** clamped to the extent. A zero-length line cannot define a
 * direction (PML divides by `length()`), so it fails.
 */
export function distanceAlongSegment(
  segment: PickSegment,
  distance: number,
  control: PickVec3,
): PickDerivationResult {
  if (!isFiniteSegment(segment) || !isFiniteVec(control) || !Number.isFinite(distance)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  const oriented = orientSegmentToNearEnd(segment, control);
  const axis = sub(oriented.segment.end, oriented.segment.start);
  const length = Math.sqrt(lengthSq(axis));
  if (length <= Math.sqrt(DEGENERATE_LENGTH_SQ)) return { ok: false, reason: 'zero-length-segment' };
  return {
    ok: true,
    position: pointAtProportion(oriented.segment, distance / length),
    nearEnd: oriented.nearEnd,
  };
}

/**
 * `GMFLINE.proportion(p, control)`: `p · length` from the nearest end; when the
 * control point projects outside the extent the nearest end is returned.
 */
export function proportionAlongSegment(
  segment: PickSegment,
  proportion: number,
  control: PickVec3,
): PickDerivationResult {
  if (!isFiniteSegment(segment) || !isFiniteVec(control) || !Number.isFinite(proportion)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  const oriented = orientSegmentToNearEnd(segment, control);
  const near = closestPointOnInfiniteLine(oriented.segment, control);
  if (!isWithinSegmentExtent(oriented.segment, near)) {
    return { ok: true, position: clone(oriented.segment.start), nearEnd: oriented.nearEnd };
  }
  return { ok: true, position: pointAtProportion(oriented.segment, proportion), nearEnd: oriented.nearEnd };
}

/**
 * `GMFLINE.fraction(n, control)`: split the line into `int(n)` equal segments
 * and return the split point nearest to the control point (ties → segment
 * start). Outside the extent → nearest end. `int(n) < 1` → the control point's
 * projection, because the PML loop never executes.
 */
export function fractionAlongSegment(
  segment: PickSegment,
  fraction: number,
  control: PickVec3,
): PickDerivationResult {
  if (!isFiniteSegment(segment) || !isFiniteVec(control) || !Number.isFinite(fraction)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  const oriented = orientSegmentToNearEnd(segment, control);
  const near = closestPointOnInfiniteLine(oriented.segment, control);
  if (!isWithinSegmentExtent(oriented.segment, near)) {
    return { ok: true, position: clone(oriented.segment.start), nearEnd: oriented.nearEnd };
  }
  const count = Math.trunc(fraction);
  let start = oriented.segment.start;
  for (let index = 1; index <= count; index += 1) {
    const end = pointAtProportion(oriented.segment, index / count);
    if (isWithinSegmentExtent({ start, end }, near)) {
      const position = distanceSq(near, start) > distanceSq(near, end) ? end : start;
      return { ok: true, position: clone(position), nearEnd: oriented.nearEnd };
    }
    start = end;
  }
  return { ok: true, position: near, nearEnd: oriented.nearEnd };
}

/** `POSITION.offset(DIRECTION, REAL)`: move `distance` along the unit direction. */
export function offsetAlongDirection(position: PickVec3, direction: PickVec3, distance: number): PickVec3 {
  const unit = normalize(direction);
  if (!unit) return clone(position);
  return add(position, scale(unit, distance));
}

export type PickDerivationInput = Readonly<{
  type: PickDerivationType;
  geometry: PickGeometry;
  /** Pick ray in the same frame as the geometry (needed for segment / plane geometry). */
  ray?: PickRay | null;
  /** `Distance` value in metres (E3D `pickTypesValue[2]`, default 0). */
  distance?: number;
  /** `Fraction` value (E3D `pickTypesValue[4]`, default 2). */
  fraction?: number;
  /** `Proportion` value (E3D `pickTypesValue[5]`, default 0.5). */
  proportion?: number;
}>;

/**
 * Dispatch of `EDGPICKTYPE.snap / exact / distance / proportion / fraction` on
 * the picked geometry kind.
 */
export function derivePickPosition(input: PickDerivationInput): PickDerivationResult {
  const { geometry } = input;
  const distance = input.distance ?? 0;
  const fraction = input.fraction ?? 2;
  const proportion = input.type === 'midpoint' ? 0.5 : input.proportion ?? 0.5;

  if (geometry.kind === 'point') {
    if (!isFiniteVec(geometry.position)) return { ok: false, reason: 'non-finite-input' };
    if (input.type === 'distance') {
      if (!Number.isFinite(distance)) return { ok: false, reason: 'non-finite-input' };
      if (!isFiniteVec(geometry.direction) || lengthSq(geometry.direction) <= DEGENERATE_LENGTH_SQ) {
        // Aid POSITION: `.distance()` returns the aid position itself.
        return { ok: true, position: clone(geometry.position) };
      }
      return { ok: true, position: offsetAlongDirection(geometry.position, geometry.direction, distance) };
    }
    return { ok: true, position: clone(geometry.position) };
  }

  const ray = input.ray ?? null;
  if (!ray || !isFiniteRay(ray)) return { ok: false, reason: 'non-finite-input' };

  if (geometry.kind === 'plane') {
    if (!isFinitePlane(geometry)) return { ok: false, reason: 'degenerate-plane' };
    const position = rayPlaneIntersection(ray, geometry);
    return position ? { ok: true, position } : { ok: false, reason: 'ray-parallel' };
  }

  const segment: PickSegment = { start: geometry.start, end: geometry.end };
  if (!isFiniteSegment(segment)) return { ok: false, reason: 'non-finite-input' };
  const control = lineRayControlPoint(segment, ray);
  if (!control) return { ok: false, reason: 'ray-parallel' };

  switch (input.type) {
    case 'snap':
      return snapSegmentEnd(segment, control);
    case 'exact':
      return { ok: true, position: control };
    case 'distance':
      return distanceAlongSegment(segment, distance, control);
    case 'midpoint':
    case 'proportion':
      return proportionAlongSegment(segment, proportion, control);
    case 'fraction':
      return fractionAlongSegment(segment, fraction, control);
    default:
      return { ok: false, reason: 'unsupported-geometry' };
  }
}

/**
 * An ARC operand: the element's centreline arc as a full circle (E3D `ARC.intersections`
 * works on the circle; `GMFARC.exact` is the one that filters by `onProjected`).
 * `picked` is where the cursor ray that picked the arc meets the arc plane
 * (`!pick.intersection(!arcPlane)`, `edgpicktype.pmlobj` 895) — the candidate nearest to it wins.
 */
export type IntersectArcOperand = Readonly<{
  kind: 'arc';
  center: PickVec3;
  normal: PickVec3;
  radius: number;
  picked: PickVec3;
}>;

/** Geometry an `Intersect` pick contributes (`EDGPICKTYPE.intersect` `intersectData`). */
export type IntersectOperand =
  | Readonly<{ kind: 'line'; start: PickVec3; end: PickVec3 }>
  | Readonly<{ kind: 'plane'; position: PickVec3; normal: PickVec3 }>
  | IntersectArcOperand;

export type IntersectPicksResult =
  | Readonly<{ ok: true; position: PickVec3; /** Lines were skew; position is on the first line. */ skew: boolean }>
  | Readonly<{ ok: false; reason: PickDerivationFailureReason | 'needs-another-pick' }>;

/**
 * `LINE.intersection(LINE)`: the point on `first` nearest to `second` (exact
 * intersection when coplanar). Parallel → `(2,870)`.
 */
export function intersectLines(first: PickSegment, second: PickSegment): IntersectPicksResult {
  if (!isFiniteSegment(first) || !isFiniteSegment(second)) return { ok: false, reason: 'non-finite-input' };
  const u = sub(first.end, first.start);
  const v = sub(second.end, second.start);
  if (lengthSq(u) <= DEGENERATE_LENGTH_SQ || lengthSq(v) <= DEGENERATE_LENGTH_SQ) {
    return { ok: false, reason: 'zero-length-segment' };
  }
  const control = lineRayControlPoint(first, { origin: second.start, direction: v });
  if (!control) return { ok: false, reason: 'parallel-lines' };
  const onSecond = closestPointOnInfiniteLine(second, control);
  const gap = Math.sqrt(distanceSq(control, onSecond));
  const scaleRef = Math.sqrt(Math.max(lengthSq(u), lengthSq(v)));
  return { ok: true, position: control, skew: gap > 1e-9 * Math.max(1, scaleRef) };
}

/** `PLANE.intersection(LINE)`; parallel → `(2,870)`. */
export function intersectLinePlane(line: PickSegment, plane: PickPlane): IntersectPicksResult {
  if (!isFiniteSegment(line)) return { ok: false, reason: 'non-finite-input' };
  if (!isFinitePlane(plane)) return { ok: false, reason: 'degenerate-plane' };
  const direction = sub(line.end, line.start);
  if (lengthSq(direction) <= DEGENERATE_LENGTH_SQ) return { ok: false, reason: 'zero-length-segment' };
  const position = rayPlaneIntersection({ origin: line.start, direction }, plane);
  return position ? { ok: true, position, skew: false } : { ok: false, reason: 'ray-parallel' };
}

/** `PLANE.intersection(PLANE, PLANE)`: the single point three planes share. */
export function intersectThreePlanes(a: PickPlane, b: PickPlane, c: PickPlane): IntersectPicksResult {
  if (!isFinitePlane(a) || !isFinitePlane(b) || !isFinitePlane(c)) return { ok: false, reason: 'degenerate-plane' };
  const na = normalize(a.normal)!;
  const nb = normalize(b.normal)!;
  const nc = normalize(c.normal)!;
  const determinant = dot(na, cross(nb, nc));
  if (Math.abs(determinant) <= PARALLEL_SIN) return { ok: false, reason: 'parallel-planes' };
  const da = dot(na, a.position);
  const db = dot(nb, b.position);
  const dc = dot(nc, c.position);
  const position = scale(
    add(add(scale(cross(nb, nc), da), scale(cross(nc, na), db)), scale(cross(na, nb), dc)),
    1 / determinant,
  );
  return { ok: true, position, skew: false };
}

function isFiniteArc(arc: IntersectArcOperand): boolean {
  return isFiniteVec(arc.center) && isFiniteVec(arc.normal) && lengthSq(arc.normal) > DEGENERATE_LENGTH_SQ
    && Number.isFinite(arc.radius) && arc.radius > 0 && isFiniteVec(arc.picked);
}

/** Tolerance (metres) for "on the circle" / tangency tests: relative to the radius, never below 1 nm. */
function arcTolerance(radius: number): number {
  return 1e-9 * Math.max(1, radius);
}

/**
 * The points where an infinite line **lying in the arc plane** meets the arc's circle:
 * two (chord), one (tangent within tolerance) or none. `origin` must be in the plane,
 * `direction` in-plane and non-degenerate.
 */
function circleLineIntersections(
  center: PickVec3,
  radius: number,
  origin: PickVec3,
  direction: PickVec3,
): PickVec3[] {
  const unitDirection = normalize(direction);
  if (!unitDirection) return [];
  const toOrigin = sub(origin, center);
  const along = dot(toOrigin, unitDirection);
  const foot = sub(origin, scale(unitDirection, along));
  const gap = Math.sqrt(distanceSq(foot, center));
  const tolerance = arcTolerance(radius);
  if (gap > radius + tolerance) return [];
  if (gap >= radius - tolerance) return [foot];
  const half = Math.sqrt(Math.max(0, radius * radius - gap * gap));
  return [add(foot, scale(unitDirection, half)), sub(foot, scale(unitDirection, half))];
}

/**
 * `ARC.intersections(LINE)`: the line is projected onto the arc plane and met with the
 * circle. A line perpendicular to the plane projects to a point: an intersection only
 * when that point sits on the circle.
 */
export function arcLineIntersections(arc: IntersectArcOperand, line: PickSegment): PickVec3[] {
  const normal = normalize(arc.normal)!;
  const direction = sub(line.end, line.start);
  const inPlaneDirection = sub(direction, scale(normal, dot(direction, normal)));
  const inPlaneStart = sub(line.start, scale(normal, dot(sub(line.start, arc.center), normal)));
  if (lengthSq(inPlaneDirection) <= PARALLEL_SIN * PARALLEL_SIN * lengthSq(direction)) {
    const gap = Math.sqrt(distanceSq(inPlaneStart, arc.center));
    return Math.abs(gap - arc.radius) <= arcTolerance(arc.radius) ? [inPlaneStart] : [];
  }
  return circleLineIntersections(arc.center, arc.radius, inPlaneStart, inPlaneDirection);
}

/**
 * The line shared by the arc plane and another plane: `null` when the planes are
 * parallel (coincident planes share everything and nothing in particular — E3D's
 * `ARC.intersections(PLANE)` comes back unset for them too).
 */
function arcPlaneTraceLine(arc: IntersectArcOperand, plane: PickPlane): PickRay | null {
  const normal = normalize(arc.normal)!;
  const other = normalize(plane.normal);
  if (!other) return null;
  const direction = cross(normal, other);
  if (Math.sqrt(lengthSq(direction)) <= PARALLEL_SIN) return null;
  // Walk from the arc centre, inside the arc plane, straight towards the other plane.
  const towards = normalize(sub(other, scale(normal, dot(other, normal))))!;
  const step = dot(sub(plane.position, arc.center), other) / dot(towards, other);
  return { origin: add(arc.center, scale(towards, step)), direction };
}

/** `ARC.intersections(PLANE)`: the plane cuts the arc plane in a line, met with the circle. */
export function arcPlaneIntersections(arc: IntersectArcOperand, plane: PickPlane): PickVec3[] {
  const trace = arcPlaneTraceLine(arc, plane);
  if (!trace) return [];
  return circleLineIntersections(arc.center, arc.radius, trace.origin, trace.direction);
}

/**
 * `ARC.intersections(ARC)`: coplanar circles meet at 0 / 1 / 2 points; circles in
 * different planes can only meet where the trace line of the two planes crosses both.
 */
export function arcArcIntersections(arc: IntersectArcOperand, other: IntersectArcOperand): PickVec3[] {
  const normal = normalize(arc.normal)!;
  const otherNormal = normalize(other.normal)!;
  const tolerance = arcTolerance(Math.max(arc.radius, other.radius));
  const coplanar = Math.sqrt(lengthSq(cross(normal, otherNormal))) <= PARALLEL_SIN
    && Math.abs(dot(sub(other.center, arc.center), normal)) <= tolerance;
  if (!coplanar) {
    const trace = arcPlaneTraceLine(arc, { position: other.center, normal: other.normal });
    if (!trace) return [];
    return circleLineIntersections(arc.center, arc.radius, trace.origin, trace.direction)
      .filter((point) => Math.abs(Math.sqrt(distanceSq(point, other.center)) - other.radius) <= tolerance);
  }
  const between = sub(other.center, arc.center);
  const distance = Math.sqrt(lengthSq(between));
  if (distance <= tolerance) return []; // concentric: nothing (identical circles have no single point)
  if (distance > arc.radius + other.radius + tolerance) return [];
  if (distance < Math.abs(arc.radius - other.radius) - tolerance) return [];
  const along = (arc.radius * arc.radius - other.radius * other.radius + distance * distance) / (2 * distance);
  const unitBetween = scale(between, 1 / distance);
  const base = add(arc.center, scale(unitBetween, along));
  const halfSq = arc.radius * arc.radius - along * along;
  if (halfSq <= tolerance * tolerance) return [base];
  const side = scale(normalize(cross(normal, unitBetween))!, Math.sqrt(halfSq));
  return [add(base, side), sub(base, side)];
}

/**
 * `edgpicktype.pmlobj` 864–904: the arc is the subject whatever the pick order; among
 * the candidates the one nearest to where the arc's own pick ray meets the arc plane
 * is the position. No candidate → `alert.warning('No intersection between picked items')`
 * (the failing pick is refused, the first stays).
 */
export function intersectArcWith(arc: IntersectArcOperand, other: IntersectOperand): IntersectPicksResult {
  if (!isFiniteArc(arc)) return { ok: false, reason: 'non-finite-input' };
  let candidates: PickVec3[];
  if (other.kind === 'line') {
    if (!isFiniteSegment(other)) return { ok: false, reason: 'non-finite-input' };
    if (lengthSq(sub(other.end, other.start)) <= DEGENERATE_LENGTH_SQ) return { ok: false, reason: 'zero-length-segment' };
    candidates = arcLineIntersections(arc, other);
  } else if (other.kind === 'plane') {
    if (!isFinitePlane(other)) return { ok: false, reason: 'degenerate-plane' };
    candidates = arcPlaneIntersections(arc, other);
  } else {
    if (!isFiniteArc(other)) return { ok: false, reason: 'non-finite-input' };
    candidates = arcArcIntersections(arc, other);
  }
  if (candidates.length === 0) return { ok: false, reason: 'no-arc-intersection' };
  let best = candidates[0]!;
  let bestDistance = distanceSq(best, arc.picked);
  for (const candidate of candidates.slice(1)) {
    const distance = distanceSq(candidate, arc.picked);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return { ok: true, position: best, skew: false };
}

/**
 * `EDGPICKTYPE.intersect` sequencing: two operands intersect unless both are
 * planes, in which case a third pick is required (`golabel /nextPick`). An arc
 * among the first two is resolved at once with the other item as its subject.
 */
export function intersectPicks(operands: readonly IntersectOperand[]): IntersectPicksResult {
  const [first, second, third] = operands;
  if (!first || !second) return { ok: false, reason: 'needs-another-pick' };
  if (first.kind === 'arc') return intersectArcWith(first, second);
  if (second.kind === 'arc') return intersectArcWith(second, first);
  if (first.kind === 'line' && second.kind === 'line') {
    return intersectLines(first, second);
  }
  if (first.kind === 'line' && second.kind === 'plane') {
    return intersectLinePlane(first, second);
  }
  if (first.kind === 'plane' && second.kind === 'line') {
    return intersectLinePlane(second, first);
  }
  if (first.kind === 'plane' && second.kind === 'plane') {
    if (!third) return { ok: false, reason: 'needs-another-pick' };
    if (third.kind === 'line') return intersectLinePlane(third, first);
    // E3D would call `ARC.intersection(PLANE, PLANE)`, which the ARC object does not have:
    // an arc cannot be the third item (refused without consuming the pick, see the session).
    if (third.kind === 'arc') return { ok: false, reason: 'unsupported-geometry' };
    return intersectThreePlanes(first, second, third);
  }
  return { ok: false, reason: 'unsupported-geometry' };
}
