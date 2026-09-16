/**
 * The radius E3D feeds into the centreline fillet of ELBO / BEND
 * (`EDGTYPES.attribute(noun).arc(dbRef)` — see `elementArc.ts`).
 *
 * Two different sources, one per noun:
 * - **BEND** — `!dbRef.radius`, the design element's own `RADI` (`edgbend.pmlobj` 62).
 * - **ELBO** — `!dbRef.parameter[2]`, a **catalogue** design parameter (`edgelbow.pmlobj` 58).
 *   An ELBO's own `RADI` is 0 here (the radius lives in the catalogue), and the parameters hang off
 *   the spec: element `SPRE` → SPCO `CATR` → SCOM `PARA`.
 *
 * `parameter[2]` is not the bend radius in every catalogue. The ASME B16.9 elbows in this project
 * carry `PARA = 350, 356, 533` = bore / outside diameter / bend radius, so E3D's own arc for
 * `=24381/145121` is a **356** fillet whose tangent points miss the element's P1 / P2 by ~82 mm,
 * while the geometric centreline radius is the 533 in `parameter[3]`. Measured on the running E3D:
 * golden MD §39.4. The Web reads the same index E3D reads, so both draw the same circle — being the
 * same operand as the product is the whole point of this geometry (user decision 2026-09-17).
 *
 * Pure: the caller fetches the attributes (`elementArcRadiusCache.ts`) and hands the raw values in.
 */

/** Where the fillet radius comes from for a given noun. */
export type ElementArcRadiusSource =
  /** The element's own `RADI` attribute (BEND). */
  | 'radi'
  /** The catalogue component's `PARA` entry #2, reached through `SPRE` → `CATR` (ELBO). */
  | 'catalogue-parameter-2';

const RADIUS_SOURCE_BY_NOUN: ReadonlyMap<string, ElementArcRadiusSource> = new Map([
  ['ELBO', 'catalogue-parameter-2'],
  ['ELBOW', 'catalogue-parameter-2'],
  ['BEND', 'radi'],
]);

/** Which attribute E3D reads for this noun's fillet radius; `null` when the noun has no fillet. */
export function elementArcRadiusSourceFor(noun: string | null | undefined): ElementArcRadiusSource | null {
  const key = noun?.trim().toUpperCase();
  return (key && RADIUS_SOURCE_BY_NOUN.get(key)) || null;
}

/** A finite, strictly positive length, or `null` — E3D raises `(2,888) invalid arc` on anything else. */
function asRadius(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * `SCOM.PARA` as numbers. The attribute comes back as the catalogue's display text
 * (`"350, 356, 533"`) from gen-model's `element/attributes`, or already as an array from a source
 * that decodes it; both are accepted. Non-numeric entries drop out, which is enough to make an
 * index miss return `null` rather than `NaN`.
 */
export function parseCatalogueParameters(raw: unknown): readonly number[] {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw ?? '').split(/[,\s]+/);
  const values: number[] = [];
  for (const part of parts) {
    if (typeof part === 'number') {
      if (Number.isFinite(part)) values.push(part);
      continue;
    }
    // 空串不是 0：`Number('')` 会给 0，那会把「没有这一项」读成一个真值。
    const text = String(part ?? '').trim();
    if (!text) continue;
    const n = Number(text);
    if (Number.isFinite(n)) values.push(n);
  }
  return values;
}

/**
 * The fillet radius for this element, or `null` when the noun has no fillet or the value is missing
 * / non-positive — in which case E3D's `arc()` raises and the element has no arc operand at all.
 * `parameters` is 1-based the way PML indexes it: `parameter[2]` is `parameters[1]`.
 */
export function elementArcRadiusFromAttributes(
  noun: string | null | undefined,
  input: Readonly<{ radi?: unknown; catalogueParameters?: readonly number[] | null }>,
): number | null {
  switch (elementArcRadiusSourceFor(noun)) {
    case 'radi':
      return asRadius(input.radi);
    case 'catalogue-parameter-2':
      return asRadius(input.catalogueParameters?.[1]);
    default:
      return null;
  }
}
