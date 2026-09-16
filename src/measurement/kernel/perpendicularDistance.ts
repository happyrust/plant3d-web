/**
 * Pure kernel for E3D "Measure Distance → Perpendicular to".
 *
 * Mirrors the observed E3D 3.1 runtime (golden G4, docs/verification/
 * e3d-measurement-runtime-golden, 2026-09-12):
 * - `GMFARC.perpendicularToPoint` maps the source point with `LINE.near()` /
 *   `PLANE.near()`, i.e. onto the **infinite** line or plane; the finite aid
 *   extent never clamps the foot (G4-04).
 * - The result `from` is the foot and `to` is the source; Direction runs from
 *   the foot to the source and is expressed WRT World even when another WRT
 *   is displayed in the disabled gadget (G4-06).
 * - Vertical = |Δup| in World, Horizontal = sqrt(distance² − vertical²).
 * - A zero perpendicular distance yields no arc; the form warns
 *   "Cannot draw dimension line. Perpendicular distance is 0".
 * - Two point picks fall back to the plain point-to-point distance with the
 *   same Vertical/Horizontal split (G4-03).
 *
 * All coordinates are design-world metres (X=E, Y=N, Z=U).
 */

export type PerpendicularPoint = readonly [number, number, number];

export type PerpendicularTarget =
  | Readonly<{ kind: 'line'; start: PerpendicularPoint; end: PerpendicularPoint }>
  | Readonly<{ kind: 'plane'; position: PerpendicularPoint; normal: PerpendicularPoint }>
  | Readonly<{ kind: 'point'; position: PerpendicularPoint }>;

export type PerpendicularDistanceValues = Readonly<{
  /** E3D result `from`: the foot of the perpendicular on the target. */
  foot: PerpendicularPoint;
  /** E3D result `to`: the picked source point. */
  source: PerpendicularPoint;
  distanceM: number;
  verticalM: number;
  horizontalM: number;
  /** Unit vector from the foot to the source, World frame. */
  direction: PerpendicularPoint;
  targetKind: PerpendicularTarget['kind'];
}>;

export type PerpendicularDistanceFailureReason =
  | 'non-finite-input'
  | 'degenerate-target'
  | 'zero-distance';

export type PerpendicularDistanceResult =
  | Readonly<{ ok: true; value: PerpendicularDistanceValues }>
  | Readonly<{ ok: false; reason: PerpendicularDistanceFailureReason }>;

/** Squared length below which a direction or normal counts as degenerate. */
const DEGENERATE_LENGTH_SQ = 1e-24;
/**
 * Distances below this (metres) are treated as E3D's "Perpendicular distance is 0".
 *
 * 1e-6 m (1 µm), not exact zero: design data carries 1e-7 m noise (golden MD §36 — two
 * P-Points of one riser differ by 9.5e-5 mm in N, so "A onto B's axis" came out as
 * 9.5e-8 m and produced a `0mm / 0mm / 0mm / S 0.0103685 W` row whose direction was
 * pure noise). Same magnitude as `angleSnap`'s component snapping. E3D compares with
 * PML `eq 0`, which is exact for REAL, but it never displays below 0.01 mm either.
 * Decided 2026-09-16 (golden MD §36 已知偏离 (2)).
 */
export const PERPENDICULAR_ZERO_DISTANCE_M = 1e-6;
const ZERO_DISTANCE_M = PERPENDICULAR_ZERO_DISTANCE_M;

function isFinitePoint(point: PerpendicularPoint): boolean {
  return point.length === 3 && point.every(Number.isFinite);
}

function subtract(a: PerpendicularPoint, b: PerpendicularPoint): PerpendicularPoint {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: PerpendicularPoint, b: PerpendicularPoint): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function targetIsFinite(target: PerpendicularTarget): boolean {
  switch (target.kind) {
    case 'line':
      return isFinitePoint(target.start) && isFinitePoint(target.end);
    case 'plane':
      return isFinitePoint(target.position) && isFinitePoint(target.normal);
    case 'point':
      return isFinitePoint(target.position);
  }
}

function footOnTarget(
  source: PerpendicularPoint,
  target: PerpendicularTarget,
): PerpendicularPoint | null {
  switch (target.kind) {
    case 'line': {
      const axis = subtract(target.end, target.start);
      const axisLengthSq = dot(axis, axis);
      if (axisLengthSq <= DEGENERATE_LENGTH_SQ) return null;
      // Unbounded parameter: E3D LINE.near() does not clamp to the segment.
      const t = dot(subtract(source, target.start), axis) / axisLengthSq;
      return [
        target.start[0] + axis[0] * t,
        target.start[1] + axis[1] * t,
        target.start[2] + axis[2] * t,
      ];
    }
    case 'plane': {
      const normalLengthSq = dot(target.normal, target.normal);
      if (normalLengthSq <= DEGENERATE_LENGTH_SQ) return null;
      const signedDistance = dot(subtract(source, target.position), target.normal) / normalLengthSq;
      return [
        source[0] - target.normal[0] * signedDistance,
        source[1] - target.normal[1] * signedDistance,
        source[2] - target.normal[2] * signedDistance,
      ];
    }
    case 'point':
      return [...target.position];
  }
}

export function computePerpendicularDistance(
  source: PerpendicularPoint,
  target: PerpendicularTarget,
): PerpendicularDistanceResult {
  if (!isFinitePoint(source) || !targetIsFinite(target)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  const foot = footOnTarget(source, target);
  if (!foot) return { ok: false, reason: 'degenerate-target' };

  const delta = subtract(source, foot);
  const distanceM = Math.hypot(delta[0], delta[1], delta[2]);
  if (distanceM <= ZERO_DISTANCE_M) return { ok: false, reason: 'zero-distance' };

  const verticalM = Math.abs(delta[2]);
  const horizontalM = Math.sqrt(Math.max(0, distanceM * distanceM - verticalM * verticalM));
  return {
    ok: true,
    value: {
      foot,
      source: [...source],
      distanceM,
      verticalM,
      horizontalM,
      direction: [delta[0] / distanceM, delta[1] / distanceM, delta[2] / distanceM],
      targetKind: target.kind,
    },
  };
}
