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
 * E3D takes `radius` from the catalogue (`parameter[2]` for ELBO, `RADI` for BEND);
 * the Web derives it from the geometry alone, because gen-model's ELBO carries
 * `RADI 0` (the radius lives in the catalogue) while its P-Points already sit on
 * the tangent points: with tangent length T = |P1 − POS| and the interior angle
 * α = ∠(P1 − POS, P2 − POS),
 *
 *     R      = T · tan(α / 2)
 *     centre = POS + (u1 + u2) · T / (1 + cos α)        (along the bisector, T / cos(α / 2) away)
 *     normal = u1 × u2                                   (`fillet`'s Z: leave ⟂ arrive)
 *     sweep  = π − α                                     (= E3D `ANGL`)
 *
 * Golden MD §37 checked this against the model: ELBO 24381/145121 gives R 533.000
 * (DN350 1.5 D long-radius, catalogue value 533.4 rounded) and sweep 49.8663° = `ANGL`;
 * BEND 24381/146110 gives R 133.000 = `RADI` and 80.1463° = `ANGL`.
 *
 * Where the arc is used: `EDGPOSITIONDATA.getLine()` is unset for these elements, so
 * `GMFARC.perpendicularToPoint` falls through to `getPlane()` = the **plane of the arc**
 * (through its centre, normal as above) — "Perpendicular to" an elbow measures to that
 * plane. Intersect also accepts the ARC itself as an operand; that is separate work
 * (the Web's intersect session still rejects ELBO / BEND, prompt matrix §6).
 *
 * As with `elementLine`, this does not change Snap: E3D's ELEMENT `snap()` falls back to
 * `item.position` for these elements — the arc is an operand only.
 *
 * Evidence: `static_expectation` (PML source reading; golden MD §37 (1), 2026-09-16).
 */

export type ElementArcVec3 = readonly [number, number, number];

export type ElementArcPPoint = Readonly<{
  number: number;
  position: ElementArcVec3;
}>;

export type ElementArc = Readonly<{
  /** Arc centre. */
  center: ElementArcVec3;
  /** Unit normal of the arc plane: (arrive − corner) × (leave − corner). */
  normal: ElementArcVec3;
  /** Bend radius derived from the tangent length (R = T · tan(α / 2)). */
  radius: number;
  /** Tangent point on the arrive leg (P-Point `arrive`, default 1). */
  start: ElementArcVec3;
  /** Tangent point on the leave leg (P-Point `leave`, default 2). */
  end: ElementArcVec3;
  /** The element origin `POS`: where the two centreline tangents meet. */
  corner: ElementArcVec3;
  /** Deflection angle in radians (E3D `ANGL`). */
  sweep: number;
}>;

/** E3D nouns (4-letter and full-type spellings) whose EDG handler implements `arc()` as the centreline fillet. */
export const E3D_ELEMENT_ARC_NOUNS: ReadonlySet<string> = new Set([
  'ELBO', 'ELBOW',
  'BEND',
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

/** Whether E3D would convert a pick of an element of this noun into its centreline arc. */
export function elementHasE3dArc(noun: string | null | undefined): boolean {
  const key = noun?.trim().toUpperCase();
  return Boolean(key && E3D_ELEMENT_ARC_NOUNS.has(key));
}

/**
 * The element's E3D `arc()`: the centreline fillet through arrive P-Point → `POS` → leave
 * P-Point, or `null` when the noun has no `arc()` handler, a point is missing / non-finite,
 * a tangent point coincides with the corner, or the two legs are (anti)parallel.
 * `points` may be the element's whole ptset in any order; the first arrive / leave found win.
 * Units are whatever the inputs are in (the arc lives in the same frame as its inputs).
 */
export function elementArcFromPPoints(
  noun: string | null | undefined,
  points: readonly ElementArcPPoint[],
  corner: ElementArcVec3 | null | undefined,
  options: Readonly<{ arrive?: number; leave?: number }> = {},
): ElementArc | null {
  if (!elementHasE3dArc(noun)) return null;
  if (!isFiniteVec3(corner)) return null;
  const arriveNumber = options.arrive ?? 1;
  const leaveNumber = options.leave ?? 2;
  if (arriveNumber === leaveNumber) return null;
  const p1 = points.find((point) => point.number === arriveNumber && isFiniteVec3(point.position));
  const p2 = points.find((point) => point.number === leaveNumber && isFiniteVec3(point.position));
  if (!p1 || !p2) return null;

  const v1: ElementArcVec3 = [p1.position[0] - corner[0], p1.position[1] - corner[1], p1.position[2] - corner[2]];
  const v2: ElementArcVec3 = [p2.position[0] - corner[0], p2.position[1] - corner[1], p2.position[2] - corner[2]];
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

  // Both P-Points of a consistent component sit at the same tangent length; average them so
  // the fillet does not depend on which leg is called arrive.
  const tangent = (t1 + t2) / 2;
  const radius = tangent * Math.tan(alpha / 2);
  const toCentre = tangent / (1 + cosine);
  const center: ElementArcVec3 = [
    corner[0] + (u1[0] + u2[0]) * toCentre,
    corner[1] + (u1[1] + u2[1]) * toCentre,
    corner[2] + (u1[2] + u2[2]) * toCentre,
  ];
  if (!isFiniteVec3(center) || !Number.isFinite(radius) || !(radius > 0)) return null;

  return {
    center,
    normal: [cross[0] / sine, cross[1] / sine, cross[2] / sine],
    radius,
    start: p1.position,
    end: p2.position,
    corner,
    sweep: Math.PI - alpha,
  };
}
