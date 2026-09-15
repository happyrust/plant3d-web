/**
 * Mesh-noise snapping shared by the two angle kernels (`threePointAngle.ts` — E3D
 * "Measure Angle", `lineAngle.ts` — E3D "Angle 2 Lines"), so both angle paths hand the
 * result table the same kind of values.
 *
 * Web resolution, not E3D behaviour (golden MD §30「补采」): E3D measures exact design
 * geometry, the Web measures float32 mesh features. Live, a projected arm that is
 * geometrically vertical came back as (1.2e-9, 1.7e-9, 1) and printed `N 35.00 E 90.00 U`
 * instead of `U`, and a design 70° came back as 69.9999979°, which E3D's truncating DMS
 * shows as `69° 59' 59''`. Both thresholds sit far below any design angle or display
 * resolution (DMS 1'' = 2.8e-4°) and far above the noise seen live (~4e-8 per component,
 * ~2e-6°); a 1e-6° angle grid would not have absorbed that 2.1e-6° error.
 *
 * Callers snap the two unit arms first, measure the angle between the snapped arms, then
 * round it — so the angle, its DMS, both Direction strings, the arm ends and the arc-plane
 * normal all come from one snapped pair.
 */

export type SnapVec3 = readonly [number, number, number];

/**
 * An arm component with |value| below this is mesh noise and is zeroed before the arm is
 * re-normalised (1e-6 on a unit vector ≈ 6e-5°, ~25× the component noise seen live).
 */
export const ANGLE_DIRECTION_SNAP = 1e-6;

/**
 * Finished angles are rounded to this grid (1e-5° = 0.036'' — below the DMS resolution and
 * below every Decimal Places setting that shows anything but mesh noise, ~5× the angular
 * noise seen live).
 */
export const ANGLE_DEGREES_SNAP_DEG = 1e-5;

/** Grid steps per degree (100 000); dividing by it yields the nearest double to the decimal value. */
const ANGLE_SNAP_STEPS_PER_DEG = Math.round(1 / ANGLE_DEGREES_SNAP_DEG);

/**
 * Zero the mesh-noise components of a unit arm and re-normalise. A unit vector always keeps
 * at least one component ≥ 1/√3, so the snapped vector is never zero; a non-unit or
 * degenerate input is returned unchanged.
 */
export function snapUnitDirection(direction: SnapVec3): SnapVec3 {
  const snapped: SnapVec3 = [
    Math.abs(direction[0]) < ANGLE_DIRECTION_SNAP ? 0 : direction[0],
    Math.abs(direction[1]) < ANGLE_DIRECTION_SNAP ? 0 : direction[1],
    Math.abs(direction[2]) < ANGLE_DIRECTION_SNAP ? 0 : direction[2],
  ];
  const length = Math.hypot(snapped[0], snapped[1], snapped[2]);
  if (!(length > 0) || !Number.isFinite(length)) return direction;
  return [snapped[0] / length, snapped[1] / length, snapped[2] / length];
}

/** Round an angle in degrees to the `ANGLE_DEGREES_SNAP_DEG` grid (`-0` folded to `0`). */
export function snapAngleDegrees(angleDeg: number): number {
  const snapped = Math.round(angleDeg * ANGLE_SNAP_STEPS_PER_DEG) / ANGLE_SNAP_STEPS_PER_DEG;
  return snapped === 0 ? 0 : snapped;
}
