/**
 * Pure kernel for E3D "Measure Angle" (root / first point / second point).
 *
 * Mirrors the observed E3D 3.1 runtime (golden G6-01/02/03, docs/verification/
 * e3d-measurement-runtime-golden, 2026-09-11/12). The EDG action is
 * `GMFARC.radius3PointsNoError(root, first, second)`:
 * - The arc plane is `root.plane(first, second)`. Exactly collinear picks
 *   (0°, 180°, second on top of first) or a second point on the root make that
 *   plane underivable, the arc comes back unset and the form raises
 *   "An angular dimension could not be constructed from the data selected".
 *   The `Angle 0` text branch in `GPHANGLEDIMENSION.draw()` is therefore
 *   unreachable from the pick flow.
 * - Reported angles are always the minor angle in [0°, 180°]; the plane normal
 *   follows the pick order (first × second), so a clockwise second point flips
 *   the normal instead of producing a reflex angle.
 * - Direction1 is root→first, Direction2 is root→second (both unit vectors);
 *   the arc radius is |root→first|.
 * - Near-collinear inputs (0.1°, 179.9°) are accepted.
 *
 * Web resolution shared with the two-line kernel (`angleSnap.ts`, golden MD §30「补采」): the
 * two unit arms have components below 1e-6 zeroed and are re-normalised, the angle is
 * measured between the snapped arms and rounded to 1e-5°, and the arc-plane normal comes from
 * the snapped arms — Web inputs are float32 mesh points, and without this a design 70° prints
 * as `69° 59' 59''` and a geometrically vertical arm as `N 35.00 E 90.00 U`. The collinear /
 * coincident rejections still use the raw arms (E3D rejects only exact degeneracy).
 *
 * All coordinates are design-world metres (X=E, Y=N, Z=U).
 */

import { snapAngleDegrees, snapUnitDirection } from './angleSnap';

export type AnglePoint = readonly [number, number, number];

export type ThreePointAngleValues = Readonly<{
  root: AnglePoint;
  angleDeg: number;
  radiusM: number;
  /** Unit normal of the arc plane, oriented by the pick order (first × second). */
  planeNormal: AnglePoint;
  /** Unit direction root → first (E3D Direction1). */
  direction1: AnglePoint;
  /** Unit direction root → second (E3D Direction2). */
  direction2: AnglePoint;
}>;

export type ThreePointAngleFailureReason =
  | 'non-finite-input'
  | 'coincident-point'
  | 'collinear';

export type ThreePointAngleResult =
  | Readonly<{ ok: true; value: ThreePointAngleValues }>
  | Readonly<{ ok: false; reason: ThreePointAngleFailureReason }>;

/** Arm lengths below this (metres) coincide with the root. */
const COINCIDENT_LENGTH_M = 1e-9;
/** |sin θ| below this counts as collinear (0° or 180°). */
const COLLINEAR_SIN_THRESHOLD = 1e-12;

function isFinitePoint(point: AnglePoint): boolean {
  return point.length === 3 && point.every(Number.isFinite);
}

function subtract(a: AnglePoint, b: AnglePoint): AnglePoint {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: AnglePoint, b: AnglePoint): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: AnglePoint, b: AnglePoint): AnglePoint {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scale(value: AnglePoint, factor: number): AnglePoint {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

export function buildThreePointAngle(
  root: AnglePoint,
  first: AnglePoint,
  second: AnglePoint,
): ThreePointAngleResult {
  if (!isFinitePoint(root) || !isFinitePoint(first) || !isFinitePoint(second)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  const arm1 = subtract(first, root);
  const arm2 = subtract(second, root);
  const length1 = Math.hypot(arm1[0], arm1[1], arm1[2]);
  const length2 = Math.hypot(arm2[0], arm2[1], arm2[2]);
  if (length1 <= COINCIDENT_LENGTH_M || length2 <= COINCIDENT_LENGTH_M) {
    return { ok: false, reason: 'coincident-point' };
  }

  const normal = cross(arm1, arm2);
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
  const sine = normalLength / (length1 * length2);
  if (sine <= COLLINEAR_SIN_THRESHOLD) {
    return { ok: false, reason: 'collinear' };
  }

  // Web resolution (see header): de-noise the unit arms, then measure between the snapped arms.
  const direction1 = snapUnitDirection(scale(arm1, 1 / length1));
  const direction2 = snapUnitDirection(scale(arm2, 1 / length2));
  const snappedNormal = cross(direction1, direction2);
  const snappedNormalLength = Math.hypot(snappedNormal[0], snappedNormal[1], snappedNormal[2]);
  // Snapping can only merge arms that were already within ~1e-6 rad of each other; keep the raw
  // (non-degenerate) normal and angle in that corner rather than divide by zero.
  const usable = snappedNormalLength > COLLINEAR_SIN_THRESHOLD;
  const rawAngleDeg = usable
    ? (Math.atan2(snappedNormalLength, dot(direction1, direction2)) * 180) / Math.PI
    : (Math.atan2(normalLength, dot(arm1, arm2)) * 180) / Math.PI;
  return {
    ok: true,
    value: {
      root: [...root],
      angleDeg: snapAngleDegrees(rawAngleDeg),
      radiusM: length1,
      planeNormal: usable ? scale(snappedNormal, 1 / snappedNormalLength) : scale(normal, 1 / normalLength),
      direction1,
      direction2,
    },
  };
}
