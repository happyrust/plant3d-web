/**
 * Pure kernel for E3D **design points** (`DPOINT` picks; plan 2026-09-12 §2 #15).
 *
 * Data model (E3D Design DB): a design element (EQUI / SUBE / STRU / FRMW / TMPL …) may own a
 * **Design Point Set** `DPSE` whose members are design points — `DPCA` (Cartesian) and `DPCY`
 * (cylindrical) — each with `NUMB`, `POS` (in the host element's frame) and `ORI`. On the host
 * they surface as the pseudo-attribute arrays `DPPS[n]` (world position) and `DPDI[n]` (world
 * direction). The Positioning Control returns them as pick type `DPOINT` with `pPoint` = `NUMB`
 * (picked in the Ppoint modes next to catalogue P-points, e.g. `splcreatweld.pmlfrm`
 * `stdPpoint('Pick a Design Point for WELD')` → `data.type eq 'DPOINT'`), and
 * (`edgpicktype.pmlobj` / `edgpositiondata.pmlobj` / `edgpickmode.pmlfnc`):
 * - `snap()` / `exact()` / `proportion()` → `item.dpps[n]` (the point itself);
 * - `distance(d)` → `dpps[n].offset(dpDir[n], d)` (like a P-point);
 * - `intersect()` → POINTVECTOR `(dpps[n], dpDir[n])` (the point's axis as a LINE);
 * - `getLine()` has **no** DPOINT branch (falls through to the host element's `line()`, which
 *   EQUI / STRU do not have) → Perpendicular-to takes `getPlane()`: the plane through `dpps[n]`
 *   with `Z is dpdir[n]`.
 *
 * Static expectations (no E3D runtime golden; the loaded design DB `24381` has no DPSE):
 * - `DPDI[n]` is taken as the **Z axis of the design point's `ORI`** expressed in World
 *   (`edgpickmode.pmlfnc` 194–195 pairs `dpps` with `dpdi` the way it pairs `pPos` with `pdir`).
 * - Stored `ORI` triples are Euler angles in degrees composed `Rz · Ry · Rx`
 *   (`aios_core::tool::math_tool::angles_to_ori`, the same convention gen-model uses to build
 *   the element `world_transform` the Web already trusts).
 * - The host `world_transform` (gen-model `element/ptset`, column-major mm, local → World) maps
 *   `POS` / the ORI Z axis into World; a `DPCY` is treated like a `DPCA` (`POS` / `ORI` only —
 *   its cylindrical extras `ANGL` / `BORE` are not interpreted).
 *
 * Coordinates: attribute values are mm in the host frame; outputs are World mm (the caller
 * converts to design metres / scene units like every other ptset-derived candidate).
 */

import { applyPtsetTransformToDir, applyPtsetTransformToPoint } from '@/utils/three/ptsetTransform';

export type DesignPointVec3 = readonly [number, number, number];

/** Nouns that carry a design point (`DPSE` members). */
export const DESIGN_POINT_NOUNS: readonly string[] = ['DPCA', 'DPCY'];
/** The design point set container. */
export const DESIGN_POINT_SET_NOUN = 'DPSE';
/**
 * Owner-chain walk stops here: design point sets hang off design elements, never off the
 * administrative levels (ZONE / SITE / WORL, template worlds / areas, group worlds).
 */
export const DESIGN_POINT_HOST_STOP_NOUNS: ReadonlySet<string> = new Set([
  'ZONE', 'SITE', 'WORL', 'TPWL', 'TMAR', 'GPWL', 'GPSE', 'REGI', 'REGION', 'DB',
]);

export type DesignPointAttributes = Readonly<{
  /** `NUMB` — the design point number (`DPPS[n]` index). */
  number: number;
  /** `POS` in the host element's frame, mm. */
  positionMm: DesignPointVec3;
  /** `ORI` as stored: Euler angles in degrees `(x, y, z)`, composed `Rz · Ry · Rx`. */
  oriDeg: DesignPointVec3;
}>;

const DIRECTION_LETTER_SIGN: Readonly<Record<string, [number, 1 | -1]>> = {
  E: [0, 1], W: [0, -1], N: [1, 1], S: [1, -1], U: [2, 1], D: [2, -1],
};

/**
 * Parse an E3D triple as the model source hands it over: a number array, the gen-model
 * `display` string `"0, 0, -86"`, or a PDMS-style `"E 100mm N 200mm U -86mm"` (letters decide
 * the axis and sign, so `W 5mm` is `-5` on E). `null` when three finite numbers are not found.
 */
export function parseE3dTriple(value: unknown): DesignPointVec3 | null {
  if (Array.isArray(value)) {
    if (value.length < 3) return null;
    const numbers = value.slice(0, 3).map((entry) => Number(entry));
    return numbers.every(Number.isFinite) ? [numbers[0]!, numbers[1]!, numbers[2]!] : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const lettered = /([ENUWSD])\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/gi;
  const letteredMatches = Array.from(text.matchAll(lettered));
  if (letteredMatches.length === 3) {
    const out: [number, number, number] = [0, 0, 0];
    const seen = new Set<number>();
    for (const match of letteredMatches) {
      const entry = DIRECTION_LETTER_SIGN[match[1]!.toUpperCase()];
      const magnitude = Number(match[2]);
      if (!entry || !Number.isFinite(magnitude) || seen.has(entry[0])) return null;
      seen.add(entry[0]);
      out[entry[0]] = entry[1] * magnitude;
    }
    return out;
  }
  const plain = text.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) ?? [];
  if (plain.length !== 3) return null;
  const numbers = plain.map(Number);
  return numbers.every(Number.isFinite) ? [numbers[0]!, numbers[1]!, numbers[2]!] : null;
}

/** `NUMB` / `POS` / `ORI` of a `DPCA` / `DPCY` from the attribute map (`uiAttr().attrs`). */
export function parseDesignPointAttributes(attrs: Record<string, unknown> | null | undefined): DesignPointAttributes | null {
  if (!attrs) return null;
  const number = Number(String(attrs.NUMB ?? attrs.numb ?? '').trim());
  const positionMm = parseE3dTriple(attrs.POS ?? attrs.pos);
  if (!Number.isFinite(number) || !positionMm) return null;
  const oriDeg = parseE3dTriple(attrs.ORI ?? attrs.ori) ?? [0, 0, 0];
  return { number, positionMm, oriDeg };
}

/**
 * Column vectors of the rotation a stored `ORI` triple denotes: `R = Rz(z) · Ry(y) · Rx(x)`,
 * angles in degrees (`angles_to_ori`). Column 3 is the frame's Z axis = the design point direction.
 */
export function oriRotationColumns(oriDeg: DesignPointVec3): readonly [DesignPointVec3, DesignPointVec3, DesignPointVec3] {
  const [ax, ay, az] = oriDeg.map((deg) => (deg * Math.PI) / 180) as [number, number, number];
  const cx = Math.cos(ax); const sx = Math.sin(ax);
  const cy = Math.cos(ay); const sy = Math.sin(ay);
  const cz = Math.cos(az); const sz = Math.sin(az);
  // Rz · Ry · Rx, row-major entries
  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;
  return [
    [r00, r10, r20],
    [r01, r11, r21],
    [r02, r12, r22],
  ];
}

/** Design point direction in the host frame: the Z axis of its `ORI`. */
export function designPointLocalDirection(oriDeg: DesignPointVec3): DesignPointVec3 {
  return oriRotationColumns(oriDeg)[2];
}

export type DesignPointWorld = Readonly<{
  number: number;
  /** `DPPS[n]` — World mm. */
  positionMm: DesignPointVec3;
  /** `DPDI[n]` — unit World direction; `null` only if the transform collapses it. */
  direction: DesignPointVec3 | null;
}>;

function normalize(v: DesignPointVec3): DesignPointVec3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-12 && Number.isFinite(length) ? [v[0] / length, v[1] / length, v[2] / length] : null;
}

/**
 * `DPPS[n]` / `DPDI[n]`: the design point mapped through its host element's `world_transform`
 * (gen-model `element/ptset`, column-major 16 mm or row-major 3×4 / 4×4; `null` = identity).
 */
export function designPointToWorld(
  attributes: DesignPointAttributes,
  hostWorldTransform: unknown,
): DesignPointWorld {
  const position = applyPtsetTransformToPoint(hostWorldTransform ?? null, [
    attributes.positionMm[0], attributes.positionMm[1], attributes.positionMm[2],
  ]);
  const local = designPointLocalDirection(attributes.oriDeg);
  const world = applyPtsetTransformToDir(hostWorldTransform ?? null, [local[0], local[1], local[2]]);
  return {
    number: attributes.number,
    positionMm: [position[0], position[1], position[2]],
    direction: normalize([world[0], world[1], world[2]]),
  };
}

/** Whether a tree noun is a design point host candidate (walk continues) or an administrative stop. */
export function isDesignPointHostStop(noun: string | null | undefined): boolean {
  return DESIGN_POINT_HOST_STOP_NOUNS.has(String(noun ?? '').trim().toUpperCase());
}
