/**
 * Pure kernel for the Web's minimal **design aid** system — the stand-in for E3D's
 * graphical aids (`gphline.pmlobj` / `gphplane.pmlobj`, registered in `!!aidNumbers`)
 * that the Positioning Control picks under the **Aid** filter (`EDGPICK.stdAid`) and
 * that "Perpendicular to" / Intersect use as LINE / PLANE targets
 * (`edgpositiondata.getLine()` / `getPlane()` `DESIGNAID` branches; plan 2026-09-12 §7 Q3).
 *
 * What is mirrored (static_expectation from the PML source):
 * - **Aid LINE** (`GPHLINE.line`, a core `LINE`): a finite `start → end` segment. Picking
 *   it under `stdAid` returns `DESIGNAID` with the aid number; `snap()` = `GMFLINE.snap`
 *   of the point on the line nearest the pick ray (→ nearer end), `exact()` = that
 *   nearest point (`LINE.intersection(pointVector.line(1000mm))`), Distance / Proportion /
 *   Fraction walk the line (`GMFLINE`), `getLine()` returns the LINE itself (infinite
 *   for `LINE.near`, so Perpendicular-to projects onto the infinite line), `intersect()`
 *   hands the LINE over. All of that is already the `segment` contract of the pick-type
 *   kernel (`pickDerivation.ts`); this module only supplies the geometry.
 * - **Aid PLANE** (`GPHPLANE.plane`, a core `PLANE` = position + orientation, Z = normal,
 *   drawn as an `x × y` rectangle frame, default 5000 mm × 5000 mm, plus a 1 mm normal
 *   stub): every single-pick type returns `pointVector.intersection(plane)` (ray ∩ plane),
 *   `getPlane()` returns the PLANE itself, `intersect()` hands the PLANE over. The pick
 *   has to land on the drawn rectangle — E3D only picks drawn graphics.
 * - Not mirrored: Aid POSITION / ARC / grids (`PLANTGRID` / `LINEARGRID` / `RADIALGRID`),
 *   `tag` / `detail` text, colour / style tables, aid files (`definition()`).
 *
 * Web choices (not E3D behaviour):
 * - Aids live in the session store, numbered 1, 2, 3 … in creation order (E3D hands out
 *   numbers from the global `!!aidNumbers` pool shared by every command).
 * - In-plane axes of a plane given only its normal: Y is the projection of Up onto the
 *   plane (North when the plane is horizontal), X = Y × Z — a deterministic rule that
 *   coincides with E3D's default `Y is N / Z is U` for horizontal planes; E3D's own
 *   `ORIENTATION('Z is …')` defaulting for tilted planes was not verified.
 *
 * Coordinates: design World **metres** (X = E, Y = N, Z = U), like the rest of the
 * measurement kernel; the UI converts mm ↔ m.
 */

export type AidVec3 = readonly [number, number, number];

export type MeasurementAidLine = Readonly<{
  id: string;
  /** Aid number shown to the user (E3D `!!aidNumbers` number). */
  number: number;
  kind: 'line';
  description: string;
  visible: boolean;
  start: AidVec3;
  end: AidVec3;
}>;

export type MeasurementAidPlane = Readonly<{
  id: string;
  number: number;
  kind: 'plane';
  description: string;
  visible: boolean;
  /** `PLANE.position` — centre of the drawn rectangle. */
  position: AidVec3;
  /** Orthonormal right-handed frame; `zDir` is the plane normal (`PLANE.direction()`). */
  xDir: AidVec3;
  yDir: AidVec3;
  zDir: AidVec3;
  /** `GPHPLANE.x / y` — drawn extent along `xDir` / `yDir`, metres. */
  xSize: number;
  ySize: number;
}>;

export type MeasurementAid = MeasurementAidLine | MeasurementAidPlane;

export type AidRay = Readonly<{ origin: AidVec3; direction: AidVec3 }>;

/** `GPHPLANE()` constructor: `x = y = 5000mm`. */
export const DEFAULT_AID_PLANE_SIZE_M = 5;

const DEGENERATE_LENGTH_SQ = 1e-24;
/** |sin| below which a hint direction counts as parallel to the normal. */
const PARALLEL_SIN = 1e-9;

export type AidGeometryFailure =
  | 'non-finite-input'
  | 'zero-length-line'
  | 'degenerate-normal'
  | 'non-positive-size';

export type AidGeometryResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reason: AidGeometryFailure }>;

function isFiniteVec(value: AidVec3 | null | undefined): value is AidVec3 {
  return !!value && value.length === 3 && value.every(Number.isFinite);
}

function sub(a: AidVec3, b: AidVec3): AidVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: AidVec3, b: AidVec3): AidVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: AidVec3, factor: number): AidVec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: AidVec3, b: AidVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: AidVec3, b: AidVec3): AidVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lengthSq(a: AidVec3): number {
  return dot(a, a);
}

function normalize(a: AidVec3): AidVec3 | null {
  const length = Math.sqrt(lengthSq(a));
  return length > 0 && Number.isFinite(length) ? scale(a, 1 / length) : null;
}

const UP: AidVec3 = [0, 0, 1];
const NORTH: AidVec3 = [0, 1, 0];

/**
 * Right-handed orthonormal frame with `zDir` as Z. `yHint` (optional) is projected
 * onto the plane to become Y; without one, or when it is parallel to Z, Y is the
 * projection of Up, falling back to North for horizontal planes (see module notes).
 */
export function aidPlaneFrame(
  zDir: AidVec3,
  yHint?: AidVec3 | null,
): Readonly<{ xDir: AidVec3; yDir: AidVec3; zDir: AidVec3 }> | null {
  const z = normalize(zDir);
  if (!z) return null;
  const projectOntoPlane = (hint: AidVec3): AidVec3 | null => {
    const unit = normalize(hint);
    if (!unit) return null;
    if (Math.sqrt(lengthSq(cross(unit, z))) <= PARALLEL_SIN) return null;
    return normalize(sub(unit, scale(z, dot(unit, z))));
  };
  const y = (yHint && isFiniteVec(yHint) ? projectOntoPlane(yHint) : null)
    ?? projectOntoPlane(UP)
    ?? projectOntoPlane(NORTH);
  if (!y) return null;
  const x = normalize(cross(y, z));
  if (!x) return null;
  return { xDir: x, yDir: y, zDir: z };
}

export type AidLineInput = Readonly<{
  id: string;
  number: number;
  description?: string | null;
  visible?: boolean;
  start: AidVec3;
  end: AidVec3;
}>;

/** `GPHLINE(LINE)`: a finite aid line between two distinct points. */
export function createAidLine(input: AidLineInput): AidGeometryResult<MeasurementAidLine> {
  if (!isFiniteVec(input.start) || !isFiniteVec(input.end) || !Number.isFinite(input.number)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  if (lengthSq(sub(input.end, input.start)) <= DEGENERATE_LENGTH_SQ) {
    return { ok: false, reason: 'zero-length-line' };
  }
  return {
    ok: true,
    value: {
      id: input.id,
      number: input.number,
      kind: 'line',
      description: (input.description ?? '').trim(),
      visible: input.visible ?? true,
      start: [input.start[0], input.start[1], input.start[2]],
      end: [input.end[0], input.end[1], input.end[2]],
    },
  };
}

/** Which end the position of `aidLineFromDirection` pins (E3D line edit form "Position" option). */
export type AidLineAnchor = 'start' | 'mid' | 'end';

export type AidLineFromDirectionInput = Readonly<{
  id: string;
  number: number;
  description?: string | null;
  visible?: boolean;
  /** The pinned position (start / mid / end of the line). */
  position: AidVec3;
  anchor?: AidLineAnchor;
  /** Line direction (start → end). */
  direction: AidVec3;
  /** Line length, metres, > 0. */
  length: number;
}>;

/**
 * E3D `gphlineedit.pmlfrm`: a line from a pinned position, a `Direction` and a
 * `Length` (`LINE.setLengthEnd / setLengthStart`, mid keeps the centre).
 */
export function aidLineFromDirection(input: AidLineFromDirectionInput): AidGeometryResult<MeasurementAidLine> {
  if (!isFiniteVec(input.position) || !isFiniteVec(input.direction) || !Number.isFinite(input.length)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  const direction = normalize(input.direction);
  if (!direction || !(input.length > 0)) {
    return { ok: false, reason: 'zero-length-line' };
  }
  const anchor = input.anchor ?? 'start';
  const startOffset = anchor === 'start' ? 0 : anchor === 'mid' ? -input.length / 2 : -input.length;
  const start = add(input.position, scale(direction, startOffset));
  const end = add(start, scale(direction, input.length));
  return createAidLine({ ...input, start, end });
}

export type AidPlaneInput = Readonly<{
  id: string;
  number: number;
  description?: string | null;
  visible?: boolean;
  position: AidVec3;
  /** Plane normal (`Z is …`). */
  zDir: AidVec3;
  /** Optional in-plane Y hint (`Y is …`); see `aidPlaneFrame`. */
  yDir?: AidVec3 | null;
  /** Drawn extent, metres; default 5 m × 5 m (E3D 5000 mm). */
  xSize?: number;
  ySize?: number;
}>;

/** `GPHPLANE(PLANE)` with the drawn `x × y` extent. */
export function createAidPlane(input: AidPlaneInput): AidGeometryResult<MeasurementAidPlane> {
  if (!isFiniteVec(input.position) || !isFiniteVec(input.zDir) || !Number.isFinite(input.number)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  const xSize = input.xSize ?? DEFAULT_AID_PLANE_SIZE_M;
  const ySize = input.ySize ?? DEFAULT_AID_PLANE_SIZE_M;
  if (!Number.isFinite(xSize) || !Number.isFinite(ySize) || !(xSize > 0) || !(ySize > 0)) {
    return { ok: false, reason: 'non-positive-size' };
  }
  const frame = aidPlaneFrame(input.zDir, input.yDir ?? null);
  if (!frame) return { ok: false, reason: 'degenerate-normal' };
  return {
    ok: true,
    value: {
      id: input.id,
      number: input.number,
      kind: 'plane',
      description: (input.description ?? '').trim(),
      visible: input.visible ?? true,
      position: [input.position[0], input.position[1], input.position[2]],
      xDir: frame.xDir,
      yDir: frame.yDir,
      zDir: frame.zDir,
      xSize,
      ySize,
    },
  };
}

export type AidPlaneFromThreePointsInput = Readonly<{
  id: string;
  number: number;
  description?: string | null;
  visible?: boolean;
  /** `p1` is the plane position; the normal is `(p2 − p1) × (p3 − p1)`. */
  p1: AidVec3;
  p2: AidVec3;
  p3: AidVec3;
  xSize?: number;
  ySize?: number;
}>;

/**
 * E3D `gphplaneedit.pmlfrm` "Through three points": the plane through three
 * non-collinear points, positioned at the first, Y along `p1 → p2`.
 */
export function aidPlaneFromThreePoints(input: AidPlaneFromThreePointsInput): AidGeometryResult<MeasurementAidPlane> {
  if (!isFiniteVec(input.p1) || !isFiniteVec(input.p2) || !isFiniteVec(input.p3)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  const u = sub(input.p2, input.p1);
  const v = sub(input.p3, input.p1);
  const normal = cross(u, v);
  if (lengthSq(normal) <= DEGENERATE_LENGTH_SQ) return { ok: false, reason: 'degenerate-normal' };
  return createAidPlane({
    id: input.id,
    number: input.number,
    description: input.description,
    visible: input.visible,
    position: input.p1,
    zDir: normal,
    yDir: u,
    xSize: input.xSize,
    ySize: input.ySize,
  });
}

/** Corners of the drawn rectangle (`GPHPLANE.draw`: `threeDPosition(±x/2, ±y/2)`), in loop order. */
export function aidPlaneCorners(plane: MeasurementAidPlane): readonly [AidVec3, AidVec3, AidVec3, AidVec3] {
  const hx = plane.xSize / 2;
  const hy = plane.ySize / 2;
  const at = (sx: number, sy: number): AidVec3 => add(add(plane.position, scale(plane.xDir, sx)), scale(plane.yDir, sy));
  return [at(-hx, -hy), at(-hx, hy), at(hx, hy), at(hx, -hy)];
}

export type AidPlaneRayHit = Readonly<{
  /** Ray ∩ infinite plane (`pointVector.intersection(plane)`). */
  point: AidVec3;
  /** Ray parameter of the hit (≥ 0 when the plane is in front of the ray origin). */
  t: number;
  /** In-plane coordinates of the hit relative to `position`, metres. */
  u: number;
  v: number;
  /** Whether the hit lies on the drawn rectangle (what E3D's graphics pick can hit). */
  inside: boolean;
}>;

/**
 * Intersect a pick ray with an aid plane. `null` when the ray is parallel to the
 * plane or the hit is behind the ray origin. `marginRatio` widens the rectangle test
 * proportionally (e.g. 0.02 = 2 % of the extent) so a pick on the frame line counts.
 */
export function aidPlaneRayHit(
  plane: MeasurementAidPlane,
  ray: AidRay,
  marginRatio = 0,
): AidPlaneRayHit | null {
  if (!isFiniteVec(ray.origin) || !isFiniteVec(ray.direction)) return null;
  const denominator = dot(ray.direction, plane.zDir);
  if (Math.abs(denominator) <= 1e-12 * Math.sqrt(lengthSq(ray.direction))) return null;
  const t = dot(sub(plane.position, ray.origin), plane.zDir) / denominator;
  if (!Number.isFinite(t) || t < 0) return null;
  const point = add(ray.origin, scale(ray.direction, t));
  const local = sub(point, plane.position);
  const u = dot(local, plane.xDir);
  const v = dot(local, plane.yDir);
  const margin = Math.max(0, marginRatio);
  const inside = Math.abs(u) <= (plane.xSize / 2) * (1 + margin) && Math.abs(v) <= (plane.ySize / 2) * (1 + margin);
  return { point, t, u, v, inside };
}

export type AidLineRayHit = Readonly<{
  /** Point on the finite line nearest to the ray (E3D control point of a line pick). */
  point: AidVec3;
  /** Parameter along `start → end`, clamped to [0, 1]. */
  s: number;
  /** Distance between the ray and that point. */
  distance: number;
}>;

/** Nearest point of an aid line to a pick ray (`LINE.intersection(pointVector)` on skew lines). */
export function aidLineRayHit(line: MeasurementAidLine, ray: AidRay): AidLineRayHit | null {
  if (!isFiniteVec(ray.origin) || !isFiniteVec(ray.direction)) return null;
  const u = sub(line.end, line.start);
  const v = ray.direction;
  const w0 = sub(line.start, ray.origin);
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w0);
  const e = dot(v, w0);
  if (a <= 0 || c <= 0) return null;
  const denominator = a * c - b * b;
  let s = denominator <= 1e-18 * a * c ? 0 : (b * e - c * d) / denominator;
  s = Math.min(1, Math.max(0, s));
  const point = add(line.start, scale(u, s));
  let t = (b * s + e) / c;
  if (t < 0) t = 0;
  const onRay = add(ray.origin, scale(v, t));
  return { point, s, distance: Math.sqrt(lengthSq(sub(point, onRay))) };
}

/** Direction `start → end` (not normalised); the Perpendicular-to / Intersect LINE axis. */
export function aidLineDirection(line: MeasurementAidLine): AidVec3 {
  return sub(line.end, line.start);
}

/** `GPHLINE.position()` — the line's mid point. */
export function aidLineMidPoint(line: MeasurementAidLine): AidVec3 {
  return scale(add(line.start, line.end), 0.5);
}

/** Next free aid number: 1 + the largest number in use (E3D-like monotonic handout). */
export function nextAidNumber(aids: readonly Pick<MeasurementAid, 'number'>[]): number {
  return aids.reduce((max, aid) => (Number.isFinite(aid.number) ? Math.max(max, aid.number) : max), 0) + 1;
}

/** E3D-style tag text: the description, or `Line [n]` / `Plane [n]` (`GPHLINE.draw` tag branch). */
export function aidDisplayName(aid: MeasurementAid): string {
  if (aid.description) return aid.description;
  return aid.kind === 'line' ? `Line [${aid.number}]` : `Plane [${aid.number}]`;
}
