/**
 * Angle helpers ported from PML `markpipe/function/geo/angle/*.pmlfnc`.
 *
 * The three functions below are pure: no module state, no I/O. They are the
 * numeric base the polar placement layer (T3.4) sits on.
 *
 * Sources, line for line:
 *   - `angleunique.pmlfnc:11-23`  -> {@link angleUnique}
 *   - `angleinangles.pmlfnc:12-27` -> {@link angleInAngles}
 *   - `mergeangles.pmlfnc:16-87`   -> {@link mergeAngles}
 *
 * Deviation from PML (decision D1): the PML guard `max1 >= min1 + 360` runs on
 * already-normalised values, so it only fires for the literal `[0, 360]` span.
 * We keep that behaviour instead of normalising first, because a caller that
 * hands us `[0, 720]` expects the full circle and PML delivers exactly that.
 */

/** Closed angle interval in degrees. `start > end` means the range wraps past 0. */
export type AngleRange = readonly [start: number, end: number];

/**
 * Fold an angle into `[0, 360]` (`angleunique.pmlfnc:13-21`).
 *
 * Note the upper bound is **inclusive**: `360` is returned unchanged, because
 * PML compares with `gt 360`, not `ge 360`. Callers rely on that so a merged
 * range can end at exactly `360`.
 */
export function angleUnique(inputAngle: number): number {
  let angle = inputAngle;
  // The PML loop is unbounded; bounded here so a NaN or Infinity cannot hang.
  for (let guard = 0; guard < 64; guard += 1) {
    if (angle < 0) {
      angle += 360;
    } else if (angle > 360) {
      angle -= 360;
    } else {
      return angle;
    }
  }
  return angle;
}

/**
 * Is `inputAngle` inside the closed interval `[start, end]`?
 * `angleinangles.pmlfnc:12-27`.
 *
 * A wrapping interval (`start > end`) matches `[0, end]` union `[start, 360]`.
 * Both endpoints are inclusive, matching PML's `le` / `ge`.
 */
export function angleInAngles(
  inputAngle: number,
  inputStart: number,
  inputEnd: number,
): boolean {
  const angle = angleUnique(inputAngle);
  const start = angleUnique(inputStart);
  const end = angleUnique(inputEnd);

  if (end >= start) {
    return angle <= end && angle >= start;
  }
  return (angle <= end && angle >= 0) || (angle <= 360 && angle >= start);
}

/**
 * Merge overlapping or touching angle intervals; `mergeangles.pmlfnc:16-87`.
 *
 * Behaviour reproduced exactly:
 * - an empty input returns an empty array (`:17-19`);
 * - each range is normalised with {@link angleUnique}, then a wrapping range is
 *   split into `[min, 360]` + `[0, max]` (`:25-35`);
 * - a range spanning a whole turn returns `[[0, 360]]` (`:37-42`);
 * - the pieces are stably sorted by start angle (`:55-57`);
 * - two pieces merge when the first does **not** end strictly before the second
 *   starts, i.e. touching intervals merge (`:65`);
 * - if the result opens at `0` and closes at `360` the two ends are stitched
 *   into one wrapping range (`:79-86`).
 *
 * The returned ranges are in ascending start order; at most the last one wraps.
 */
export function mergeAngles(inputAngles: readonly AngleRange[]): AngleRange[] {
  if (inputAngles.length === 0) return [];

  const pieces: [number, number][] = [];
  const starts: number[] = [];

  for (const oneAngles of inputAngles) {
    const min1 = angleUnique(oneAngles[0]);
    const max1 = angleUnique(oneAngles[1]);
    if (min1 > max1) {
      pieces.push([min1, 360]);
      starts.push(min1);
      pieces.push([0, max1]);
      starts.push(0);
    } else if (max1 >= min1 + 360) {
      return [[0, 360]];
    } else {
      pieces.push([min1, max1]);
      starts.push(min1);
    }
  }

  // Stable sort by start angle, carrying the pieces along.
  const order = starts
    .map((start, index) => ({ start, index }))
    .sort((left, right) => left.start - right.start)
    .map(entry => entry.index);
  const angles = order.map(index => pieces[index]!);

  const merged: [number, number][] = [];
  let openStart = angles[0]![0];
  for (let x = 0; x < angles.length - 1; x += 1) {
    const current = angles[x]!;
    const next = angles[x + 1]!;
    if (current[1] < next[0]) {
      merged.push([openStart, current[1]]);
      openStart = next[0];
    } else {
      next[1] = Math.max(current[1], next[1]);
    }
  }
  merged.push([openStart, angles[angles.length - 1]![1]]);

  if (merged.length > 1) {
    const first = merged[0]!;
    const last = merged[merged.length - 1]!;
    if (first[0] === 0 && last[1] === 360) {
      first[0] = last[0];
      merged.pop();
    }
  }

  return merged.map(range => [range[0], range[1]] as const);
}
