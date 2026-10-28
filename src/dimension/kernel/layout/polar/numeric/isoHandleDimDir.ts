/**
 * Dimension-direction choice around used handle directions, ported from PML
 * `markpipe/function/isoGetHandleDimDir.pmlfnc:16-240`.
 *
 * The PML function answers: "given the pipe axis, the handle directions that are
 * already taken (each with the angular width it needs), and the three preferred
 * dimension axes, which axis should the next dimension line use?"
 *
 * Behaviour reproduced exactly:
 * - no used directions -> fall back to {@link isoGetDimDir} (`:20-21`);
 * - directions within 1 degree of parallel or antiparallel to the pipe are
 *   dropped, and the first survivor defines the plane normal
 *   `y = pipeDir × survivor` (`:35-44`); with none left, fall back again (`:47-49`);
 * - the plane is spanned by `x = y × pipeDir` and `z = pipeDir`, so an angle in
 *   that plane maps to `cos(a)·x + sin(a)·y` (`:50-53`, `:63-83`);
 * - each used direction occupies `[centre - width/2, centre + width/2]` folded
 *   into `[0, 360)` (`:68-83`), and the occupied intervals are merged
 *   (`:126`, see {@link mergeAngles});
 * - preferred axes are tried in order: an axis more than 10 degrees off
 *   perpendicular to the pipe is skipped, and an axis is rejected when its angle
 *   falls inside an occupied interval, or when its plain (not circular) absolute
 *   distance to either end of an occupied interval is below `minGapAngle`
 *   (`:146-174`). The first accepted axis is returned as
 *   `(pipeDir × axis) × pipeDir`, which projects the axis back into the plane
 *   perpendicular to the pipe;
 * - otherwise the gaps between occupied intervals are measured (the last
 *   interval wraps to the first, `:179-197`); a gap at least `minGapAngle` wide
 *   contributes its bisector to `gooddirs`, a narrower one contributes its
 *   bisector to `dimdirs` together with the gap width (`:191-196`);
 * - with any `gooddirs`, the one whose angles to all three preferred axes sum
 *   smallest wins (`:223-232`); otherwise the widest gap's bisector wins
 *   (`:233-238`).
 *
 * Deviation from PML (decision D5): PML calls `!usedDirs.unique()` at `:19`,
 * which deduplicates whole entries. Merging the occupied intervals afterwards
 * makes duplicates indistinguishable, so it is not reproduced.
 */

import { angleInAngles, mergeAngles } from './angleRanges';
import { isoGetDimDir, orthogonal } from './isoDirections';

import type { AngleRange } from './angleRanges';
import type { Vec3 } from '../../../types';

/** A handle direction that already carries a dimension, and the width it needs. */
export type IsoUsedDir = Readonly<{ dir: Vec3; angle: number }>;

/** Preferred axes more than this many degrees off perpendicular are skipped (`:147`). */
const PERPENDICULAR_TOLERANCE_DEG = 10;
/** A used direction this close to parallel with the pipe is ignored (`:38`). */
const PARALLEL_TOLERANCE_DEG = 1;

/** Two directions' angle in degrees, matching PML `DIRECTION.angle`. */
function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  if (la === 0 || lb === 0) return 0;
  const cosine = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Pick the dimension direction for the next dimension line.
 *
 * @param pipeDir      Pipe axis.
 * @param usedDirs     Handle directions already carrying a dimension.
 * @param minGapAngle  Minimum free angular gap, in degrees.
 * @param goodDimDirs  The three preferred dimension axes, most preferred first.
 */
export function isoGetHandleDimDir(
  pipeDir: Vec3,
  usedDirs: readonly IsoUsedDir[],
  minGapAngle: number,
  goodDimDirs: readonly [Vec3, Vec3, Vec3],
): Vec3 {
  if (usedDirs.length === 0) return isoGetDimDir(pipeDir, goodDimDirs);

  // Plane basis. `y` is normal to both the pipe and the first usable handle
  // direction; `x` completes the right-handed frame inside the plane.
  let yDir: Vec3 | null = null;
  const kept: IsoUsedDir[] = [];
  for (const usedDir of usedDirs) {
    const angle = angleBetweenDeg(usedDir.dir, pipeDir);
    // `abs(abs(angle - 90) - 90) > 1` keeps only directions that are neither
    // parallel nor antiparallel to the pipe.
    if (Math.abs(Math.abs(angle - 90) - 90) > PARALLEL_TOLERANCE_DEG) {
      kept.push(usedDir);
      if (yDir === null) yDir = orthogonal(pipeDir, usedDir.dir);
    }
  }
  if (yDir === null) return isoGetDimDir(pipeDir, goodDimDirs);

  const y = yDir;
  const z = normalize(pipeDir);
  const x = normalize(cross(y, z));

  const angleOf = (dir: Vec3): number => {
    const degrees = (Math.atan2(dot(dir, y), dot(dir, x)) * 180) / Math.PI;
    return ((degrees % 360) + 360) % 360;
  };
  const dirAt = (degrees: number): Vec3 => {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return normalize([x[0] * cos + y[0] * sin, x[1] * cos + y[1] * sin, x[2] * cos + y[2] * sin]);
  };

  const occupiedRaw: AngleRange[] = [];
  for (const usedDir of kept) {
    const centre = angleOf(usedDir.dir);
    let low = centre - usedDir.angle / 2;
    let high = centre + usedDir.angle / 2;
    if (low < 0) low += 360;
    if (high >= 360) high -= 360;
    occupiedRaw.push([low, high]);
  }
  const occupied = mergeAngles(occupiedRaw);

  // Try the preferred axes first (`:146-174`).
  for (const tryDir of goodDimDirs) {
    if (Math.abs(angleBetweenDeg(tryDir, pipeDir) - 90) > PERPENDICULAR_TOLERANCE_DEG) {
      continue;
    }
    const tryAngle = angleOf(tryDir);
    let good = true;
    for (const interval of occupied) {
      if (
        angleInAngles(tryAngle, interval[0], interval[1])
        || Math.abs(tryAngle - interval[0]) < minGapAngle
        || Math.abs(tryAngle - interval[1]) < minGapAngle
      ) {
        good = false;
        break;
      }
    }
    if (good) {
      const tempDir = orthogonal(pipeDir, tryDir);
      const projected = tempDir === null ? null : orthogonal(tempDir, pipeDir);
      if (projected) return projected;
    }
  }

  // Otherwise fall back to the widest free gap (`:176-238`).
  const goodDirs: Vec3[] = [];
  const dimDirs: Vec3[] = [];
  const dimAngles: number[] = [];
  for (let index = 0; index < occupied.length; index += 1) {
    const startAngle = occupied[index]![1];
    const endAngle =
      index === occupied.length - 1 ? occupied[0]![0] : occupied[index + 1]![0];
    const wrappedEnd = endAngle < startAngle ? 360 + endAngle : endAngle;
    const gapAngle = wrappedEnd - startAngle;
    const midDir = dirAt((startAngle + wrappedEnd) / 2);
    if (gapAngle >= minGapAngle) {
      goodDirs.push(midDir);
    } else {
      dimDirs.push(midDir);
      dimAngles.push(gapAngle);
    }
  }

  if (goodDirs.length > 0) {
    let bestIndex = 0;
    let bestSum = Number.POSITIVE_INFINITY;
    for (let index = 0; index < goodDirs.length; index += 1) {
      const dir = goodDirs[index]!;
      const sum =
        angleBetweenDeg(dir, goodDimDirs[0])
        + angleBetweenDeg(dir, goodDimDirs[1])
        + angleBetweenDeg(dir, goodDimDirs[2]);
      if (sum < bestSum) {
        bestSum = sum;
        bestIndex = index;
      }
    }
    return goodDirs[bestIndex]!;
  }

  // No gap is wide enough: take the widest of the narrow ones.
  let widestIndex = 0;
  for (let index = 1; index < dimAngles.length; index += 1) {
    if (dimAngles[index]! > dimAngles[widestIndex]!) widestIndex = index;
  }
  return dimDirs[widestIndex]!;
}
