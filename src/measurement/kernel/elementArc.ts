/**
 * E3D **element arc** operand (`EDGTYPES.attribute(fullType).arc(dbRef)`).
 *
 * ELBO / BEND have no `line()` handler (see `elementLine.ts`): their EDG types only
 * implement `arc()`, the centreline fillet through the component
 * (`edgelbow.pmlobj` 55 / `edgbend.pmlobj` 59):
 *
 *     gmfArc.fillet(radius, pPosition[arrive], position, pPosition[leave])
 *
 * — the arc tangent to both centreline legs, which run from the element origin
 * (`POS`, the intersection of the two tangents) to the arrive and leave P-Points.
 *
 * **`radius` is an input, not something the geometry decides** (`elementArcRadius.ts`): E3D reads
 * `RADI` for BEND and the catalogue's `parameter[2]` for ELBO. With the interior angle
 * α = ∠(P1 − POS, P2 − POS) the rest follows,
 *
 *     T      = R / tan(α / 2)                            (tangent length from the corner)
 *     start  = POS + u1 · T,  end = POS + u2 · T         (where the arc touches each leg)
 *     centre = POS + (u1 + u2) · T / (1 + cos α)         (along the bisector, T / cos(α / 2) away)
 *     normal = u1 × u2                                   (`fillet`'s Z: leave ⟂ arrive)
 *     sweep  = π − α                                     (= E3D `ANGL`, its `endAngle`)
 *
 * The tangent points are **not** in general the element's P-Points. Measured on the running E3D
 * (golden MD §39.4): ELBO `24381/145121` has `PARA = 350, 356, 533`, E3D takes `parameter[2]` = 356
 * and its arc touches 165.500 mm from `POS` while P1 / P2 sit at 247.785 mm — 82.285 mm apart. The
 * geometric centreline radius (533, the catalogue's `parameter[3]`) would touch exactly at P1 / P2,
 * but E3D does not draw that circle, so neither does the Web (user decision 2026-09-17: match the
 * product, index quirk and all). BEND is unaffected — its `RADI` *is* the bend radius
 * (`24381/146110`: R 133, sweep 80.1463° = `ANGL`).
 *
 * Where the fillet is used: **Intersect only.** `EDGPICKTYPE.intersect` takes the ARC as an operand
 * (`edgpicktype.pmlobj` 666 → `pickDerivation.intersectArcWith`). Perpendicular does **not** use it:
 * `GMFARC.perpendicularToPoint` only asks `getLine()` → `getPlane()`, and `EDGELBOW` / `EDGBEND`
 * define neither (only `arc()`), so E3D degenerates to a point-to-point distance to the picked
 * position — measured on the running E3D, golden MD §39.3.
 *
 * **RTOR / CTOR** get their circle a different way — `gmfArc.through3Points(P1, P3, P2)`, no `POS`,
 * no `RINS` / `ROUT` and no catalogue radius (`edgctorus.pmlobj` 59–68 / `edgrtorus.pmlobj` 59–68)
 * — and it too is an Intersect operand only: their Perpendicular degenerates to point-to-point for
 * the same reason as the elbow's (`EDGCTORUS` has no `.plane()`; CTOR `24381/46880` measured at
 * §39.3). The `arc(item, refPosition)` overload they do have only feeds `getArc()`, which
 * Perpendicular never calls.
 *
 * As with `elementLine`, this does not change Snap: E3D's ELEMENT `snap()` falls back to
 * `item.position` for these elements — the arc is an operand only.
 *
 * Evidence: runtime observation on E3D 3.1 (golden MD §39, 2026-09-17), on top of the PML reading
 * in §37 (1).
 */

export type ElementArcVec3 = readonly [number, number, number];

export type ElementArcPPoint = Readonly<{
  number: number;
  position: ElementArcVec3;
}>;

export type ElementArc = Readonly<{
  /**
   * How E3D builds this arc: `fillet` = ELBO / BEND's centreline fillet tangent to both legs,
   * `torus` = RTOR / CTOR's centreline circle through P1 → P3 → P2. Only the fillet flavour is
   * also the Perpendicular target (see the header).
   */
  kind: 'fillet' | 'torus';
  /** Arc centre. */
  center: ElementArcVec3;
  /** Unit normal of the arc plane: (arrive − corner) × (leave − corner). */
  normal: ElementArcVec3;
  /** Fillet: the radius E3D was given (`RADI` / catalogue `parameter[2]`). Torus: the circle's. */
  radius: number;
  /** Fillet: where the arc touches the arrive leg, `corner + u1 · T` — **not** the P-Point. Torus: P1. */
  start: ElementArcVec3;
  /** Fillet: where the arc touches the leave leg, `corner + u2 · T`. Torus: P2. */
  end: ElementArcVec3;
  /** Fillet: the element origin `POS`, where the two centreline tangents meet. Torus: the circle centre. */
  corner: ElementArcVec3;
  /** Swept angle in radians: the fillet's deflection (E3D `ANGL`), the torus' P1 → P3 → P2 sweep. */
  sweep: number;
}>;

/** E3D nouns (4-letter and full-type spellings) whose EDG handler implements `arc()` as the centreline fillet. */
export const E3D_ELEMENT_ARC_NOUNS: ReadonlySet<string> = new Set([
  'ELBO', 'ELBOW',
  'BEND',
]);

/**
 * E3D nouns whose `arc(dbRef)` is `gmfArc.through3Points(pPosition[1], pPosition[3], pPosition[2])`
 * — the torus centreline circle (`edgctorus.pmlobj` 59–68 / `edgrtorus.pmlobj` 59–68). No `POS`, no
 * `RINS` / `ROUT`: the three P-Points already sit on that circle.
 */
export const E3D_ELEMENT_TORUS_ARC_NOUNS: ReadonlySet<string> = new Set([
  'CTOR', 'CTORUS',
  'RTOR', 'RTORUS',
]);

const DEGENERATE_LENGTH_SQ = 1e-24;
/**
 * |u1 × u2| below this = the two legs are (anti)parallel: a straight run has no fillet
 * (E3D `LINE.intersection` fails inside `fillet`), and legs on the same side are not a bend.
 * 1e-6 ≈ 0.00006°, far below any real bend and far above float noise on 100 mm legs.
 */
const MIN_LEG_SINE = 1e-6;

function isFiniteVec3(v: unknown): v is ElementArcVec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Whether the element's `arc()` is the fillet through its two centreline legs (ELBO / BEND). */
export function elementHasE3dFilletArc(noun: string | null | undefined): boolean {
  const key = noun?.trim().toUpperCase();
  return Boolean(key && E3D_ELEMENT_ARC_NOUNS.has(key));
}

/** Whether the element's `arc()` is the torus centreline circle through P1 → P3 → P2 (RTOR / CTOR). */
export function elementHasE3dTorusArc(noun: string | null | undefined): boolean {
  const key = noun?.trim().toUpperCase();
  return Boolean(key && E3D_ELEMENT_TORUS_ARC_NOUNS.has(key));
}

/** Whether E3D would convert a pick of an element of this noun into an arc at all. */
export function elementHasE3dArc(noun: string | null | undefined): boolean {
  return elementHasE3dFilletArc(noun) || elementHasE3dTorusArc(noun);
}

function pointAt(points: readonly ElementArcPPoint[], number: number): ElementArcVec3 | null {
  const found = points.find((point) => point.number === number && isFiniteVec3(point.position));
  return found ? found.position : null;
}

function sub3(a: ElementArcVec3, b: ElementArcVec3): ElementArcVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a: ElementArcVec3, b: ElementArcVec3): ElementArcVec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a: ElementArcVec3, b: ElementArcVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * `GMFARC.through3Points(start, control, end)`: the circle through the three P-Points, traversed
 * start → control → end (that order fixes the normal's sign, right-hand rule). `null` when the
 * three points are collinear / coincident — a torus with no sweep has no circle.
 */
function torusArcFromPPoints(
  points: readonly ElementArcPPoint[],
  options: Readonly<{ arrive?: number; leave?: number; control?: number }>,
): ElementArc | null {
  const start = pointAt(points, options.arrive ?? 1);
  const end = pointAt(points, options.leave ?? 2);
  const control = pointAt(points, options.control ?? 3);
  if (!start || !end || !control) return null;

  const a = sub3(control, start);
  const b = sub3(end, start);
  const normal = cross3(a, b);
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
  const aLength = Math.hypot(a[0], a[1], a[2]);
  const bLength = Math.hypot(b[0], b[1], b[2]);
  if (!(normalLength > MIN_LEG_SINE * aLength * bLength)) return null;

  // Circumcentre: start + (|a|²·(b × n) + |b|²·(n × a)) / (2|n|²).
  const scale = 1 / (2 * normalLength * normalLength);
  const bn = cross3(b, normal);
  const na = cross3(normal, a);
  const aSq = aLength * aLength;
  const bSq = bLength * bLength;
  const center: ElementArcVec3 = [
    start[0] + (aSq * bn[0] + bSq * na[0]) * scale,
    start[1] + (aSq * bn[1] + bSq * na[1]) * scale,
    start[2] + (aSq * bn[2] + bSq * na[2]) * scale,
  ];
  const toStart = sub3(start, center);
  const radius = Math.hypot(toStart[0], toStart[1], toStart[2]);
  if (!isFiniteVec3(center) || !Number.isFinite(radius) || !(radius > 0)) return null;
  const unitNormal: ElementArcVec3 = [
    normal[0] / normalLength,
    normal[1] / normalLength,
    normal[2] / normalLength,
  ];
  // Angle from start to end measured the way the arc runs (start → control → end is positive).
  const toEnd = sub3(end, center);
  const turn = Math.atan2(dot3(unitNormal, cross3(toStart, toEnd)), dot3(toStart, toEnd));

  return {
    kind: 'torus',
    center,
    normal: unitNormal,
    radius,
    start,
    end,
    corner: center,
    sweep: turn >= 0 ? turn : turn + 2 * Math.PI,
  };
}

/**
 * The element's E3D `arc()`. ELBO / BEND: the centreline fillet of the given `radius`, tangent to
 * the two legs that run from `corner` (`POS`) towards the arrive / leave P-Points — the P-Points
 * fix the leg **directions**, the radius fixes where the arc touches them. RTOR / CTOR: the
 * centreline circle through P1 → P3 → P2, which needs neither `POS` nor a radius (`corner` may be
 * null). `null` when the noun has no `arc()` handler, a defining point is missing / non-finite, a
 * leg is degenerate, the legs are (anti)parallel / collinear, or — for the fillet — no positive
 * radius was supplied (E3D raises `(2,888) Attempt to create invalid arc` and ends up without an
 * operand too). `points` may be the element's whole ptset in any order; the first arrive / leave /
 * control found win. Units are whatever the inputs are in; `radius` must be in the same ones.
 */
export function elementArcFromPPoints(
  noun: string | null | undefined,
  points: readonly ElementArcPPoint[],
  corner: ElementArcVec3 | null | undefined,
  options: Readonly<{ arrive?: number; leave?: number; control?: number; radius?: number | null }> = {},
): ElementArc | null {
  if (elementHasE3dTorusArc(noun)) return torusArcFromPPoints(points, options);
  if (!elementHasE3dFilletArc(noun)) return null;
  if (!isFiniteVec3(corner)) return null;
  const radius = options.radius;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) return null;
  const arriveNumber = options.arrive ?? 1;
  const leaveNumber = options.leave ?? 2;
  if (arriveNumber === leaveNumber) return null;
  const p1 = pointAt(points, arriveNumber);
  const p2 = pointAt(points, leaveNumber);
  if (!p1 || !p2) return null;

  const v1 = sub3(p1, corner);
  const v2 = sub3(p2, corner);
  const t1Sq = v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2];
  const t2Sq = v2[0] * v2[0] + v2[1] * v2[1] + v2[2] * v2[2];
  if (t1Sq <= DEGENERATE_LENGTH_SQ || t2Sq <= DEGENERATE_LENGTH_SQ) return null;
  const t1 = Math.sqrt(t1Sq);
  const t2 = Math.sqrt(t2Sq);
  const u1: ElementArcVec3 = [v1[0] / t1, v1[1] / t1, v1[2] / t1];
  const u2: ElementArcVec3 = [v2[0] / t2, v2[1] / t2, v2[2] / t2];

  const cross: ElementArcVec3 = [
    u1[1] * u2[2] - u1[2] * u2[1],
    u1[2] * u2[0] - u1[0] * u2[2],
    u1[0] * u2[1] - u1[1] * u2[0],
  ];
  const sine = Math.hypot(cross[0], cross[1], cross[2]);
  if (!(sine > MIN_LEG_SINE)) return null;
  const cosine = u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2];
  const alpha = Math.atan2(sine, cosine);

  // `arcFillet`: the tangent length the given radius implies on both legs. The P-Points only said
  // which way the legs run — how far along them the arc touches is the radius' business.
  const tangent = radius / Math.tan(alpha / 2);
  if (!Number.isFinite(tangent) || !(tangent > 0)) return null;
  const toCentre = tangent / (1 + cosine);
  const center: ElementArcVec3 = [
    corner[0] + (u1[0] + u2[0]) * toCentre,
    corner[1] + (u1[1] + u2[1]) * toCentre,
    corner[2] + (u1[2] + u2[2]) * toCentre,
  ];
  if (!isFiniteVec3(center)) return null;

  return {
    kind: 'fillet',
    center,
    normal: [cross[0] / sine, cross[1] / sine, cross[2] / sine],
    radius,
    start: [corner[0] + u1[0] * tangent, corner[1] + u1[1] * tangent, corner[2] + u1[2] * tangent],
    end: [corner[0] + u2[0] * tangent, corner[1] + u2[1] * tangent, corner[2] + u2[2] * tangent],
    corner,
    sweep: Math.PI - alpha,
  };
}
