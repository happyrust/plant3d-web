/**
 * Character-height choice for a dimension text, ported from PML
 * `function/draw/getgoodcheight.pmlfnc:11-38`.
 *
 * PML picks the text cap height so the whole label fits along the dimension: it
 * sums the widths of the numbers it is about to print, measures the dimension
 * length along `dir`, and divides. The result is a cap height in the same units
 * as `points`.
 *
 * Behaviour reproduced exactly:
 * - for each segment the **signed** projection length onto `dir` is taken and
 *   made positive, then formatted as `D2` with a trailing `.00` stripped
 *   (`:13-17`). A trailing zero in the first decimal is also stripped
 *   (`:19-25`), so `12.30` becomes `12.3` but `12.00` becomes `12`;
 * - the text width of every formatted segment is summed (`:26`);
 * - with a zero total the function returns 0 (`:28-30`);
 * - the denominator is the whole dimension length projected onto `dir`
 *   (`:31-33`);
 * - the height is `dimLength * bili / totalWidth` (`:34`).
 *
 * `suidirdis.pmlfnc` is a signed distance from `pos1` to `pos2` measured along
 * `dir`: the offset of `pos2` from the line through `pos1` along `dir`, negated
 * when that offset points more than 90 degrees away from `dir` (`:11-31`). It is
 * reproduced here as {@link suiDirDis}.
 *
 * Deviation from PML: PML's `handle any` around the line construction returns 0
 * when the points coincide (`suidirdis.pmlfnc:17-22`); that is reproduced. The
 * `length()` / `substring()` calls in `:16-25` are string operations whose
 * byte-vs-character semantics cannot be settled from source, so the formatting
 * is done numerically and documented per branch below.
 */

import { mbdTextLen } from './mbdTextLen';

import type { Vec3 } from '../../../types';

/**
 * Signed distance from `pos1` to `pos2` measured along `dir`
 * (`suidirdis.pmlfnc:11-31`).
 *
 * Returns 0 when `pos1` and `pos2` coincide, mirroring the PML `handle any`
 * fallback at `:17-22`.
 */
export function suiDirDis(pos1: Vec3, dir: Vec3, pos2: Vec3): number {
  const delta: Vec3 = [pos2[0] - pos1[0], pos2[1] - pos1[1], pos2[2] - pos1[2]];
  const distance = Math.hypot(delta[0], delta[1], delta[2]);
  if (distance === 0) return 0;

  const dirLength = Math.hypot(dir[0], dir[1], dir[2]);
  if (dirLength === 0) return 0;

  const signed = (delta[0] * dir[0] + delta[1] * dir[1] + delta[2] * dir[2]) / dirLength;
  return Math.abs(signed);
}

/**
 * Format a length the way PML `:16-25` does: two decimals, then drop a trailing
 * `.00`, then drop a trailing zero in the first decimal (`12.30` -> `12.3`).
 */
function formatForWidth(value: number): string {
  let text = value.toFixed(2);
  if (text.endsWith('.00')) text = text.slice(0, -3);
  else if (text.length >= 2 && text[text.length - 1] === '0') text = text.slice(0, -1);
  return text;
}

/**
 * Cap height that lets the label of `points` fit along `dir`.
 *
 * @param points Vertices of the dimension path, in order.
 * @param dir    Direction the text runs along.
 * @param bili   Scale factor applied to the dimension length (PML passes 1).
 */
export function getGoodCheight(points: readonly Vec3[], dir: Vec3, bili: number): number {
  let total = 0;
  for (let x = 0; x < points.length - 1; x += 1) {
    const distance = Math.abs(suiDirDis(points[x]!, dir, points[x + 1]!));
    total += mbdTextLen(formatForWidth(distance));
  }
  if (total === 0) return 0;

  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;

  const dimLength = Math.abs(suiDirDis(first, dir, last));
  return (dimLength * bili) / total;
}
