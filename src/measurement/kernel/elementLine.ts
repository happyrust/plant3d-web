/**
 * E3D **element line** operand (`EDGTYPES.attribute(fullType).line(dbRef)`).
 *
 * When an Intersect sub-pick or the Perpendicular-to target is an **element** pick,
 * E3D 3.1 converts the element into a LINE through the handler registered for its
 * type (`edgpicktype.pmlobj` 631 `intersect()`, `edgpositiondata.pmlobj` `line()`).
 * Only these handlers implement `line(DBREF)`, and every one of them returns the
 * segment from **P-Point 1 to P-Point 2** in World:
 *
 * - `EDGCYLINDER` — CYLI / NCYL / SLCY / NSLC (`pPosition[1] → pPosition[2]`)
 * - `EDGDISH`     — DISH / NDIS
 * - `EDGSNOUT`    — CONE / NCON / SNOU / NSNO
 * - `EDGNOZZLE`   — NOZZ
 * - `EDGPYRAMID`  — PYRA / NPYR
 *
 * ELBO / BEND / RTOR / CTOR only implement `arc()`, BOX / VALV / FLAN / TEE have no
 * handler at all: for those E3D's `handle any` rejects the pick as an operand
 * ("Unable to convert item into a line or plane for intersection"). SCTN / GENSEC
 * lines come from PLINEs (`element/plines`, separate work).
 *
 * This is distinct from the element's **snap** position: `EDGPICKTYPE.snap()` for an
 * ELEMENT falls back to `item.position` (the element origin) for all of these types,
 * so the element line must not turn the pick into a line candidate for Snap /
 * Mid-Point — it is an operand only.
 *
 * P1 / P2 come from the element's ptset when the source has them (catalogue components:
 * NOZZ); for design primitives without ptset points the drawn local geometry stands in
 * ({@link elementLineAcceptsLocalBounds}).
 *
 * Evidence: `static_expectation` (PML source reading; decision d-336).
 */

export type ElementLineVec3 = readonly [number, number, number];

export type ElementLinePPoint = Readonly<{
  number: number;
  position: ElementLineVec3;
}>;

export type ElementLine = Readonly<{
  start: ElementLineVec3;
  end: ElementLineVec3;
}>;

/** E3D nouns (4-letter and full-type spellings) whose EDG handler implements `line()` = P1 → P2. */
export const E3D_ELEMENT_LINE_NOUNS: ReadonlySet<string> = new Set([
  'CYLI', 'CYLINDER',
  'NCYL', 'NCYLINDER',
  'SLCY', 'SLCYLINDER',
  'NSLC', 'NSLCYLINDER',
  'DISH',
  'NDIS', 'NDISH',
  'CONE',
  'NCON', 'NCONE',
  'SNOU', 'SNOUT',
  'NSNO', 'NSNOUT',
  'NOZZ', 'NOZZLE',
  'PYRA', 'PYRAMID',
  'NPYR', 'NPYRAMID',
]);

/**
 * How the **drawn** geometry of a design primitive stands in for its P1 → P2 when the ptset
 * has no points (gen-model-v1 `element/ptset` resolves catalogue PTSE only — design
 * primitives have none). gen-model draws design primitives in the primitive's own local
 * frame (fast_model `mesh_primitives.rs`) and places them with the element's world transform:
 *
 * - CYLI / NCYL / SLCY / NSLC — shared unit-cylinder instance, local z ∈ [0, 1], any radius;
 * - CONE / SNOU (`gen_snout`) — end rings at z = ∓HEIG / 2, XOFF / YOFF split ± between them;
 * - DISH (`gen_spherical_dish` / `gen_elliptical_dish`) — base ring at z = 0, apex at z = HEIG;
 * - PYRA (`gen_pyramid`) — end faces at z = ∓HEIG / 2, XOFF / YOFF split ± between them.
 *
 * E3D puts P1 at the bottom face centre and P2 at the top face centre of every one of these,
 * so the local z-range through the cross-section centre **is** P1 → P2 whenever the
 * cross-section is centred on the local origin — i.e. no XOFF / YOFF. Offset snouts and
 * pyramids fail the centring check and get no line (deviation: E3D's line is tilted there);
 * baked meshes that are not in a primitive frame (world-baked solids) fail it as well.
 *
 * - `centred-round`: cross-section centred on z and circular (cylinder / cone / dish);
 * - `centred`: cross-section centred on z, any aspect (pyramid).
 */
export type ElementLineBoundsRule = 'centred-round' | 'centred';

const ELEMENT_LINE_BOUNDS_RULES: ReadonlyMap<string, ElementLineBoundsRule> = new Map(Object.entries({
  CYLI: 'centred-round', CYLINDER: 'centred-round',
  NCYL: 'centred-round', NCYLINDER: 'centred-round',
  SLCY: 'centred-round', SLCYLINDER: 'centred-round',
  NSLC: 'centred-round', NSLCYLINDER: 'centred-round',
  CONE: 'centred-round',
  NCON: 'centred-round', NCONE: 'centred-round',
  SNOU: 'centred-round', SNOUT: 'centred-round',
  NSNO: 'centred-round', NSNOUT: 'centred-round',
  DISH: 'centred-round',
  NDIS: 'centred-round', NDISH: 'centred-round',
  PYRA: 'centred', PYRAMID: 'centred',
  NPYR: 'centred', NPYRAMID: 'centred',
} satisfies Record<string, ElementLineBoundsRule>));

export type ElementLineBounds = Readonly<{ min: ElementLineVec3; max: ElementLineVec3 }>;

/** Relative tolerance for the centring / roundness checks (float32 vertices of a tessellated ring). */
const BOUNDS_RULE_RELATIVE_EPSILON = 1e-3;

const DEGENERATE_LENGTH_SQ = 1e-24;

function isFiniteVec3(v: unknown): v is ElementLineVec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Whether E3D would convert a pick of an element of this noun into its P1 → P2 line. */
export function elementHasE3dLine(noun: string | null | undefined): boolean {
  const key = noun?.trim().toUpperCase();
  return Boolean(key && E3D_ELEMENT_LINE_NOUNS.has(key));
}

/** The bounds rule under which this noun's drawn local geometry gives its P1 → P2; `null` = never (NOZZ: catalogue only). */
export function elementLineBoundsRule(noun: string | null | undefined): ElementLineBoundsRule | null {
  const key = noun?.trim().toUpperCase();
  return (key && ELEMENT_LINE_BOUNDS_RULES.get(key)) || null;
}

/**
 * Whether the element's **local** bounds are those of a design primitive drawn in its own
 * frame, so that the z-range through the cross-section centre is its P1 → P2 (see
 * {@link ElementLineBoundsRule}). False for nouns without a rule, non-finite or flat bounds,
 * cross-sections not centred on the local origin, and (for round rules) non-circular ones.
 */
export function elementLineAcceptsLocalBounds(noun: string | null | undefined, bounds: ElementLineBounds): boolean {
  const rule = elementLineBoundsRule(noun);
  if (!rule) return false;
  const { min, max } = bounds;
  if (!isFiniteVec3(min) || !isFiniteVec3(max)) return false;
  const extentX = max[0] - min[0];
  const extentY = max[1] - min[1];
  if (!(extentX > 0) || !(extentY > 0) || !(max[2] > min[2])) return false;
  const epsilon = Math.max(1e-9, BOUNDS_RULE_RELATIVE_EPSILON * Math.max(extentX, extentY));
  if (Math.abs(min[0] + max[0]) > epsilon || Math.abs(min[1] + max[1]) > epsilon) return false;
  return rule === 'centred' || Math.abs(extentX - extentY) <= epsilon;
}

/**
 * The element's E3D `line()`: P-Point 1 → P-Point 2, or `null` when the noun has no
 * `line()` handler, either point is missing / non-finite, or the two coincide.
 * `points` may be the element's whole ptset in any order; the first P1 / P2 found win.
 */
export function elementLineFromPPoints(
  noun: string | null | undefined,
  points: readonly ElementLinePPoint[],
): ElementLine | null {
  if (!elementHasE3dLine(noun)) return null;
  const p1 = points.find((point) => point.number === 1 && isFiniteVec3(point.position));
  const p2 = points.find((point) => point.number === 2 && isFiniteVec3(point.position));
  if (!p1 || !p2) return null;
  const dx = p2.position[0] - p1.position[0];
  const dy = p2.position[1] - p1.position[1];
  const dz = p2.position[2] - p1.position[2];
  if (dx * dx + dy * dy + dz * dz <= DEGENERATE_LENGTH_SQ) return null;
  return { start: p1.position, end: p2.position };
}
