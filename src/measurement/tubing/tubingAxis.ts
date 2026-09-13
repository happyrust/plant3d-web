/**
 * Pure kernel for the E3D **TUBING** pick (`EDGPOSITIONDATA.type = 'TUBING'`,
 * `EDGTUBING` in `edgtubing.pmlobj`): an implied tube between two branch
 * components is picked as a **line** — its centre-line from the owner's leave
 * position to the next component's arrive position (`EDGTUBING.line(dbRef, 'LEAVE')`;
 * the branch HEAD tube runs `hPosition → first member aPosition`).
 *
 * The Web has no branch topology at pick time, but it has the drawn tube: gen-model
 * places one shared cylinder (local axis **z**, `z ∈ [0, 1]`, radius 1; observed
 * live 2026-09-13 on BRAN 24381/145018: local bounds `(−1, −1, 0)…(1, 1, 1)`) with a
 * placement matrix whose scale is `(r, r, length)` in scene metres (`0.05715` for a
 * 114.3 mm OD tube). The axis is therefore derived on
 * the front end from the tube object's **local bounds × placement matrix**
 * (plan 2026-09-12 Phase A, "TUBING 轴线点 … Phase A 先前端派生"), and its ends are
 * then **refined onto the adjacent P-Points** already in the ptset cache: E3D
 * defines the tube by those arrive / leave positions rather than by the implied
 * tube length ("this … handles bad alignment between components correctly").
 *
 * Downstream the axis is an ordinary line-bearing pick candidate, so the pick-type
 * kernel (`pickDerivation.ts`) gives E3D's TUBING semantics for free:
 * `snap` → nearest end (`EDGTUBING.snap`: ray ∩ tube line, then the nearer end),
 * `exact` → the point on the axis nearest the pick ray (`EDGTUBING.exact`),
 * `distance` / `proportion` / `fraction` → `GMFLINE` walks from that control point,
 * Intersect → the axis as a LINE operand (`EDGTUBING.line`). E3D 3.1's
 * `lineExtended` is the plain `line` (no in-line component skipping), so the
 * Significant Snaps flag changes nothing for tubing — no `intermediates` here.
 *
 * `EDGTUBING.line` **skips attachment points**: the leave tube runs from the
 * component's `lPosition` to the arrive position of the next member whose type is
 * not `ATTA` (`skip if(!component.type inset('ATTA'))`, likewise for the HEAD tube).
 * gen-model draws one tube object per implied-tube stretch and breaks it at every
 * ATTA, so the Web has two (or more) collinear pieces where E3D has one line.
 * `mergeTubingAxisAcrossPassThrough` stitches them back: starting from the picked
 * piece, whenever a refined end sits on a pass-through point (`noun === 'ATTA'`),
 * the collinear piece touching that point is appended and the walk continues
 * from its far end. Non-ATTA zero-length components (an OLET's arrive = leave, a
 * zero-length coupling) are *not* passed through — E3D stops the line there.
 *
 * Evidence status: `static_expectation` from `edgtubing.pmlobj` / `edgpicktype.pmlobj`
 * (`TUBING` branches of `snap()` / `exact()` / `distance()` / `proportion()` /
 * `fraction()` / `intersect()`); runtime golden G7-02 (TUBING capture geometry) is
 * still to be observed on E3D.
 *
 * Coordinates: whatever frame `matrix` maps into (scene world here). No three.js
 * dependency so it can be unit-tested.
 */

export type TubingVec3 = readonly [number, number, number];

export type TubingBounds = Readonly<{ min: TubingVec3; max: TubingVec3 }>;

export type TubingAxis = Readonly<{
  start: TubingVec3;
  end: TubingVec3;
  /** Outer radius in the target frame (half the local cross-section extent, scaled). */
  radius: number;
}>;

export type TubingAxisEndPoint = Readonly<{
  position: TubingVec3;
  /** Caller's handle for the point (e.g. `ELBO P-Point #2`), echoed back on the refined end. */
  label?: string | null;
  /**
   * E3D noun of the component owning the point. `ATTA` marks a pass-through point:
   * `EDGTUBING.line` runs the tube line through attachment points to the next component.
   */
  noun?: string | null;
}>;

export type RefinedTubingAxis = TubingAxis & Readonly<{
  /** The adjacent point the start / end was snapped onto, when one was within tolerance. */
  startPoint: TubingAxisEndPoint | null;
  endPoint: TubingAxisEndPoint | null;
}>;

export type TubingLocalAxis = 'x' | 'y' | 'z';

/** gen-model / DTX unit-tube convention: the cylinder axis is local **z**. */
export const DEFAULT_TUBING_LOCAL_AXIS: TubingLocalAxis = 'z';

/** Tolerance for snapping an axis end onto an adjacent P-Point, as a fraction of the tube radius. */
export const DEFAULT_TUBING_END_TOLERANCE_RATIO = 0.05;

/**
 * Component types `EDGTUBING.line` skips when looking for the far end of a tube
 * (`skip if(!component.type inset('ATTA'))` — E3D 3.1 lists only ATTA).
 */
export const TUBING_PASS_THROUGH_NOUNS: ReadonlySet<string> = new Set(['ATTA']);

/**
 * Two tube pieces count as one straight run when their axes are within 0.5° of
 * each other. gen-model places the pieces on either side of an ATTA from the same
 * branch geometry, so the real deviation is numerical noise; the tolerance only
 * has to reject genuine direction changes.
 */
export const DEFAULT_TUBING_MERGE_MIN_COS = Math.cos((0.5 * Math.PI) / 180);

const DEGENERATE_LENGTH_SQ = 1e-24;

function isFiniteVec3(v: unknown): v is TubingVec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function applyMatrixToPoint(matrix: ArrayLike<number> | null | undefined, p: TubingVec3): TubingVec3 {
  if (!matrix || matrix.length !== 16) return p;
  const m = matrix;
  const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
  const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
  const z = m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!;
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
  return w !== 0 && w !== 1 ? [x / w, y / w, z / w] : [x, y, z];
}

function sub(a: TubingVec3, b: TubingVec3): TubingVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lengthSq(v: TubingVec3): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

export function distanceBetween(a: TubingVec3, b: TubingVec3): number {
  return Math.sqrt(lengthSq(sub(a, b)));
}

/**
 * Centre-line of a tube object from its **local** bounds and placement matrix
 * (column-major 4×4, local → target frame). The axis runs through the centre of
 * the cross-section from the low to the high face along `localAxis`; the radius
 * is half the cross-section extent measured in the target frame.
 *
 * Returns `null` for non-finite bounds, a zero-length axis or a non-16 matrix.
 */
export function tubingAxisFromBounds(input: Readonly<{
  bounds: TubingBounds;
  matrix?: ArrayLike<number> | null;
  localAxis?: TubingLocalAxis;
}>): TubingAxis | null {
  const { min, max } = input.bounds;
  if (!isFiniteVec3(min) || !isFiniteVec3(max)) return null;
  if (input.matrix && input.matrix.length !== 16) return null;
  const axisIndex = (input.localAxis ?? DEFAULT_TUBING_LOCAL_AXIS) === 'x' ? 0 : (input.localAxis ?? DEFAULT_TUBING_LOCAL_AXIS) === 'y' ? 1 : 2;
  if (!(max[axisIndex] > min[axisIndex])) return null;

  const centre: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const lo: [number, number, number] = [...centre];
  const hi: [number, number, number] = [...centre];
  lo[axisIndex] = min[axisIndex];
  hi[axisIndex] = max[axisIndex];

  const start = applyMatrixToPoint(input.matrix, lo);
  const end = applyMatrixToPoint(input.matrix, hi);
  if (!isFiniteVec3(start) || !isFiniteVec3(end)) return null;
  if (lengthSq(sub(end, start)) <= DEGENERATE_LENGTH_SQ) return null;

  // Radius: half the cross-section extent along the first non-axis local direction, in the target frame.
  const crossIndex = axisIndex === 0 ? 1 : 0;
  const rim: [number, number, number] = [...centre];
  rim[crossIndex] = max[crossIndex];
  const radius = distanceBetween(applyMatrixToPoint(input.matrix, rim), applyMatrixToPoint(input.matrix, centre));

  return { start, end, radius: Number.isFinite(radius) ? radius : 0 };
}

/** Tolerance for `refineTubingAxisEnds`: never below `minimum`, grows with the bore. */
export function tubingEndTolerance(axis: TubingAxis, minimum: number): number {
  const fromRadius = axis.radius * DEFAULT_TUBING_END_TOLERANCE_RATIO;
  return Math.max(minimum > 0 && Number.isFinite(minimum) ? minimum : 0, Number.isFinite(fromRadius) ? fromRadius : 0);
}

/**
 * Snap the axis ends onto the nearest adjacent points (arrive / leave P-Points of
 * the neighbouring components) that lie within `tolerance`. Each point serves at
 * most one end — when the same point is nearest to both, the closer end takes it.
 * Points beyond tolerance, or a refinement that would collapse the axis, leave the
 * geometric end in place. The axis is never re-oriented.
 */
export function refineTubingAxisEnds(
  axis: TubingAxis,
  points: readonly TubingAxisEndPoint[],
  tolerance: number,
): RefinedTubingAxis {
  const unrefined: RefinedTubingAxis = { ...axis, startPoint: null, endPoint: null };
  if (!(tolerance > 0) || points.length === 0) return unrefined;

  // Every (end, point) pair within tolerance, closest first; greedy assignment so that
  // each end takes at most one point and each point serves at most one end.
  type Pair = { end: 0 | 1; index: number; distance: number };
  const ends: readonly TubingVec3[] = [axis.start, axis.end];
  const pairs: Pair[] = [];
  points.forEach((point, index) => {
    if (!isFiniteVec3(point.position)) return;
    ends.forEach((end, endIndex) => {
      const distance = distanceBetween(point.position, end);
      if (distance <= tolerance) pairs.push({ end: endIndex as 0 | 1, index, distance });
    });
  });
  pairs.sort((a, b) => a.distance - b.distance || a.end - b.end || a.index - b.index);

  const matched: [number | null, number | null] = [null, null];
  const takenPoints = new Set<number>();
  for (const pair of pairs) {
    if (matched[pair.end] !== null || takenPoints.has(pair.index)) continue;
    matched[pair.end] = pair.index;
    takenPoints.add(pair.index);
  }

  const startPoint = matched[0] !== null ? points[matched[0]]! : null;
  const endPoint = matched[1] !== null ? points[matched[1]]! : null;
  const start = startPoint ? startPoint.position : axis.start;
  const end = endPoint ? endPoint.position : axis.end;
  if (lengthSq(sub(end, start)) <= DEGENERATE_LENGTH_SQ) return unrefined;

  return { start, end, radius: axis.radius, startPoint, endPoint };
}

/** Whether a refined end sits on a component `EDGTUBING.line` passes through (ATTA). */
export function isTubingPassThroughPoint(point: TubingAxisEndPoint | null | undefined): boolean {
  const noun = point?.noun?.trim().toUpperCase();
  return Boolean(noun && TUBING_PASS_THROUGH_NOUNS.has(noun));
}

/** One drawn tube object with its (refined) axis; `id` is the caller's handle (DTX object id). */
export type TubingAxisPiece = Readonly<{
  id: string;
  axis: RefinedTubingAxis;
}>;

export type MergedTubingAxis = RefinedTubingAxis & Readonly<{
  /** Piece ids in start → end order; just the picked piece when nothing was merged. */
  pieces: readonly string[];
  /** Pass-through points the merged line runs through (ATTA arrive / leave), in start → end order. */
  passThrough: readonly TubingAxisEndPoint[];
}>;

function normalize(v: TubingVec3): TubingVec3 | null {
  const length = Math.sqrt(lengthSq(v));
  return length > 0 && Number.isFinite(length) ? [v[0] / length, v[1] / length, v[2] / length] : null;
}

function dot(a: TubingVec3, b: TubingVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * E3D `EDGTUBING.line` semantics over gen-model's per-stretch tube objects: the
 * picked piece is extended through every end that rests on a pass-through point
 * (`isPassThrough`, default: `noun === 'ATTA'`) by appending the unused, collinear
 * piece that touches that point (either of its ends within `tolerance`) and lies
 * beyond it; the walk continues from the appended piece's far end, in both
 * directions, until an end is a real component point (or nothing continues —
 * then the ATTA point stays as the end, like E3D falling back to the branch tail).
 *
 * The picked piece's orientation and radius are kept. Pieces are consumed at most
 * once; when several touch the same point, the one whose end is nearest wins
 * (then the earlier one in `others`). Nothing is merged across points that are
 * not pass-through: an OLET with arrive = leave, a zero-length coupling — E3D
 * stops the line at those components.
 */
export function mergeTubingAxisAcrossPassThrough(
  hit: TubingAxisPiece,
  others: readonly TubingAxisPiece[],
  options: Readonly<{
    tolerance: number;
    minCos?: number;
    isPassThrough?: (point: TubingAxisEndPoint) => boolean;
  }>,
): MergedTubingAxis {
  const unmerged: MergedTubingAxis = { ...hit.axis, pieces: [hit.id], passThrough: [] };
  const hitDirection = normalize(sub(hit.axis.end, hit.axis.start));
  if (!hitDirection || !(options.tolerance > 0) || others.length === 0) return unmerged;
  const direction: TubingVec3 = hitDirection;
  const isPassThrough = options.isPassThrough ?? isTubingPassThroughPoint;
  const minCos = options.minCos ?? DEFAULT_TUBING_MERGE_MIN_COS;

  const used = new Set<string>([hit.id]);
  const collinear = others.filter((piece) => {
    if (used.has(piece.id) || piece.id === hit.id) return false;
    const pieceDirection = normalize(sub(piece.axis.end, piece.axis.start));
    return pieceDirection !== null && Math.abs(dot(pieceDirection, direction)) >= minCos;
  });

  /** The unused collinear piece touching `at` whose far end lies on the `sign` side of `at`. */
  function continuation(at: TubingVec3, sign: 1 | -1): Readonly<{ id: string; far: TubingVec3; farPoint: TubingAxisEndPoint | null }> | null {
    let best: { id: string; far: TubingVec3; farPoint: TubingAxisEndPoint | null; distance: number } | null = null;
    for (const piece of collinear) {
      if (used.has(piece.id)) continue;
      const orientations = [
        { near: piece.axis.start, far: piece.axis.end, farPoint: piece.axis.endPoint },
        { near: piece.axis.end, far: piece.axis.start, farPoint: piece.axis.startPoint },
      ];
      for (const { near, far, farPoint } of orientations) {
        const distance = distanceBetween(near, at);
        if (distance > options.tolerance) continue;
        if (dot(sub(far, at), direction) * sign <= 0) continue;
        if (!best || distance < best.distance) best = { id: piece.id, far, farPoint, distance };
      }
    }
    return best;
  }

  let { start, end, startPoint, endPoint } = hit.axis;
  const pieces: string[] = [hit.id];
  const forward: TubingAxisEndPoint[] = [];
  const backward: TubingAxisEndPoint[] = [];

  while (endPoint && isPassThrough(endPoint)) {
    const next = continuation(end, 1);
    if (!next) break;
    used.add(next.id);
    pieces.push(next.id);
    forward.push(endPoint);
    end = next.far;
    endPoint = next.farPoint;
  }
  while (startPoint && isPassThrough(startPoint)) {
    const previous = continuation(start, -1);
    if (!previous) break;
    used.add(previous.id);
    pieces.unshift(previous.id);
    backward.unshift(startPoint);
    start = previous.far;
    startPoint = previous.farPoint;
  }

  if (pieces.length === 1) return unmerged;
  if (lengthSq(sub(end, start)) <= DEGENERATE_LENGTH_SQ) return unmerged;
  return {
    start,
    end,
    radius: hit.axis.radius,
    startPoint,
    endPoint,
    pieces,
    passThrough: [...backward, ...forward],
  };
}
