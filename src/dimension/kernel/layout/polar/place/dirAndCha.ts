/**
 * PML `polarsystem.getDirAndCha` 的忠实移植（T3.4a）。
 *
 * 源：`polarsystem.pmlobj:1608-1770`。返回值是 `[bestdir, anglecha]`：方向 + 角偏差
 * （越大越差）。调用处 `:1205` / `:1230` 只把 `anglecha` 喂给 `weightedweight` 打分。
 *
 * ## 变量名大小写的裁决
 *
 * PML 在 `:1621` 定义 `!minGapAngle`，在 `:1685-1686` 用小写 `!mingapangle`。同一文件里
 * 同类混写大量存在，且都作用在同一个成员上：
 *
 * - `member .limitMinDis`（`:76`）vs `!this.limitmindis`（`:1873`）；
 * - `member .basicRadius`（`:74`）vs `!this.basicradius`（`:418`）；
 * - `member .mainDimDir`（`:81`）vs `!this.maindimdir`（`:365`）；
 * - `define method .getUsedAngles`（`:1985`）vs `!this.getusedangles`（`:1611`）。
 *
 * 结论：PML 标识符**大小写不敏感**，`:1621` 与 `:1685-1686` 是同一个变量。
 * TS 里只保留一个 `minGapAngle`（由 `needAngle / minGapDivisor` 派生）。
 *
 * ## 与 `numeric/isoHandleDimDir.ts` 的关系
 *
 * 后者是二维轴测图里「从三根优选轴中选一根当尺寸方向」；本函数是三维极坐标里
 * 「在已占用角度的空隙中找方向」。输入输出都不同，互补而非重复。
 */

import { angleInAngles } from '../numeric/angleRanges';
import { arcDirection } from '../numeric/arc';
import { orthogonal } from '../numeric/isoDirections';

import { getUsedAngles, NOT_BEST_PLUS_ANGLE_DEG } from './angles';
import { angleDeg, bisect } from './geometry';
import { angleOfDirection, polarArcFrame } from './result';

import type { Vec3 } from '../../../types';
import type { AngleRange } from '../numeric/angleRanges';
import type { ArcFrame } from '../numeric/arc';
import type { PolarElement, PolarReference } from '../reference/types';

/**
 * `:1621` `!minGapAngle = !needangle / 2` 的除数：已用区间端点两侧的净空半宽。
 * 不是固定常量，而是随 `needangle` 缩放（`needangle` 恒 30 时即 15°）。
 */
export const DEFAULT_MIN_GAP_DIVISOR = 2;

/** `:1717` `lt 0.1` / `:1719` `gt 179` 的默认容差（度）。 */
export const DEFAULT_ANGLE_EPSILON_DEG = 0.1;

/** `:1700` `min(0.9 * tempangle, 360)` 的系数。 */
export const SHOWDIR_SAME_SIDE_FACTOR = 0.9;

/** `getDirAndCha` 结果：PML `[bestdir, anglecha]` 的具名版。 */
export type DirAndCha = Readonly<{
  /** PML `result[1]`：选中的方向。 */
  dir: Vec3;
  /** PML `result[2]`：角偏差（度），0 最好，360 最差。 */
  angleCha: number;
}>;

/** 可覆盖阈值。 */
export type DirAndChaOptions = Readonly<{
  /** `:1619` `!notbestplusangle = 30`：非首选方向的附加罚值，度。 */
  notBestPlusAngleDeg?: number;
  /** `:1621` `!minGapAngle = !needangle / 2` 的除数。 */
  minGapDivisor?: number;
  /** `:1717` / `:1719` 的角区间退化判定容差，度。 */
  angleEpsilonDeg?: number;
}>;

/**
 * PML `getDirAndCha(eles, needangle, bestdirs, anglerange)`（`:1608-1770`）。
 *
 * 三段（PML 自己的注释编号）：
 *
 * 1. **优选方向**（`:1625-1652`）：按 `bestdirs` 顺序找第一个与已用角度都不冲突的
 *    方向。「冲突」= 角落在某个已用区间内（`:1633` `angleinangles`）或与区间任一端点
 *    的距离小于 `minGapAngle`。`bestdirs.size() >= 3` 且不是第 1 个时 `anglecha` 记
 *    `notbestplusangle`（`:1643-1649`）。
 * 2. **全圆特例**（`:1654-1660`）：已用角度只有一个 `[0, 360]` 区间时直接用
 *    `bestdirs[1]`、`anglecha = 360`。
 * 3. **最近方向**（`:1662-1760`）：算已用区间之间的空闲跨度（`:1667-1678`）；跨度
 *    `>= needangle` 的，在两端各取 `start + minGapAngle` / `end - minGapAngle`
 *    （`:1685-1686`），逐 `bestdir` 求角差；若该 bestdir 同时垂直于 `showdir` 与候选
 *    方向（`:1693-1703`，说明两者在观察面上同侧）则角差乘 0.9（`:1700`）。取角差最小
 *    者。跨度不够的取区间中点方向（`:1715-1723`）并记下该跨度。若无任何跨度够用，
 *    取**跨度最大**那个的中点方向（`:1744-1746`），`anglecha` 从 360 起与各 bestdir
 *    取最小夹角（`:1748-1755`）。
 *
 * 退化：
 * - `bestDirs` 为空：PML 在 `:1614` / `:1656` 会因下标越界报错，这里返回 `null`；
 * - `needAngle <= 0`：`minGapAngle` 非正会让 `:1633` 的端点判定恒真，PML 退化到
 *   段 2/3；这里抛 `RangeError`，需求角非正在物理上无意义。
 *
 * `elements` / `angleRanges` 是 `:1611` `this.getusedangles(eles, anglerange)` 的入参；
 * 已预算 `usedAngles` 时通过最后一个参数传入，避免重复合并。
 */
export function getDirAndCha(
  reference: PolarReference,
  elements: readonly PolarElement[],
  needAngle: number,
  bestDirs: readonly Vec3[],
  angleRanges: readonly AngleRange[],
  options: DirAndChaOptions = {},
  precomputedUsedAngles?: readonly AngleRange[],
): DirAndCha | null {
  if (!(needAngle > 0)) {
    throw new RangeError('getDirAndCha: needAngle must be positive');
  }

  const notBestPlusAngle = options.notBestPlusAngleDeg ?? NOT_BEST_PLUS_ANGLE_DEG;
  const minGapAngle = needAngle / (options.minGapDivisor ?? DEFAULT_MIN_GAP_DIVISOR);
  const angleEpsilon = options.angleEpsilonDeg ?? DEFAULT_ANGLE_EPSILON_DEG;
  const frame = polarArcFrame(reference);

  const usedAngles = precomputedUsedAngles ?? getUsedAngles(elements, angleRanges);

  // `:1613-1617` 无已用角度：直接取首选方向。
  if (usedAngles.length === 0) {
    const first = bestDirs[0];
    return first ? { dir: first, angleCha: 0 } : null;
  }

  // 段 1（`:1625-1652`）：优选方向。
  for (let x = 0; x < bestDirs.length; x += 1) {
    const tryDir = bestDirs[x]!;
    const tryAngle = angleOfDirection(reference, tryDir);
    if (tryAngle === null) continue;

    let good = true;
    for (const usedAngle of usedAngles) {
      if (
        angleInAngles(tryAngle, usedAngle[0], usedAngle[1]) ||
        Math.abs(tryAngle - usedAngle[0]) < minGapAngle ||
        Math.abs(tryAngle - usedAngle[1]) < minGapAngle
      ) {
        good = false;
        break;
      }
    }

    if (good) {
      return { dir: tryDir, angleCha: bestDirs.length >= 3 && x !== 0 ? notBestPlusAngle : 0 };
    }
  }

  // 段 2（`:1654-1660`）：整圆已被占用。
  if (usedAngles.length === 1) {
    const only = usedAngles[0]!;
    if (only[0] === 0 && only[1] === 360) {
      const first = bestDirs[0];
      return first ? { dir: first, angleCha: 360 } : null;
    }
  }

  // 段 3（`:1662-1760`）：最近方向。
  const middleDirs: Vec3[] = [];
  const middleSpans: number[] = [];
  let minAngle = 360;
  let found: DirAndCha | null = null;

  for (let x = 0; x < usedAngles.length; x += 1) {
    const startAngle = usedAngles[x]![1];
    const endAngle = x === usedAngles.length - 1 ? usedAngles[0]![0] : usedAngles[x + 1]![0];

    let span = endAngle - startAngle;
    if (span < 0) span += 360;

    if (span >= needAngle) {
      const candidates = [
        arcDirection(frame, startAngle + minGapAngle),
        arcDirection(frame, endAngle - minGapAngle),
      ];
      for (const tempDir of candidates) {
        for (let y = 0; y < bestDirs.length; y += 1) {
          const oneDir = bestDirs[y]!;
          let tempAngle = angleDeg(oneDir, tempDir);
          if (!Number.isFinite(tempAngle)) continue;

          // `:1693-1703`：两者在观察面上同侧时降权。
          const tempZDir1 = orthogonal(oneDir, reference.showDir);
          if (tempZDir1) {
            const tempZDir2 = orthogonal(oneDir, tempDir);
            if (tempZDir2 && angleDeg(tempZDir1, tempZDir2) < 90) {
              tempAngle = Math.min(SHOWDIR_SAME_SIDE_FACTOR * tempAngle, 360);
            }
          }

          if (tempAngle < minAngle) {
            minAngle = tempAngle;
            const angleCha =
              bestDirs.length >= 3 && y !== 0 ? notBestPlusAngle + tempAngle : tempAngle;
            found = { dir: tempDir, angleCha };
          }
        }
      }
    } else {
      const middleDir = middleDirection(frame, startAngle, endAngle, angleEpsilon);
      if (middleDir) {
        middleDirs.push(middleDir);
        middleSpans.push(span);
      }
    }
  }

  if (found) return found;

  // `:1739-1760` 无足够角度：取跨度最大的中点方向。
  if (middleDirs.length === 0) return null;
  let widest = 0;
  for (let index = 1; index < middleSpans.length; index += 1) {
    if (middleSpans[index]! > middleSpans[widest]!) widest = index;
  }
  const fallbackDir = middleDirs[widest]!;
  let cha = 360;
  for (const bestDirEntry of bestDirs) {
    const tempAngle = angleDeg(bestDirEntry, fallbackDir);
    if (Number.isFinite(tempAngle)) cha = Math.min(cha, tempAngle);
  }
  return { dir: fallbackDir, angleCha: cha };
}

/** `:1715-1723`：空闲跨度不足 `needangle` 时的代表方向。 */
function middleDirection(
  frame: ArcFrame,
  startAngle: number,
  endAngle: number,
  angleEpsilon: number,
): Vec3 | null {
  const dir1 = arcDirection(frame, startAngle);
  const dir2 = arcDirection(frame, endAngle);

  const between = angleDeg(dir1, dir2);
  if (between < angleEpsilon) return dir1;
  if (between > 180 - angleEpsilon) {
    // `:1720` 对跨界区间（start > end）取原始算术中点会落到区间之外 —— PML 缺陷 C10。
    // 修正：先把两端归一到 [0,360) 再取沿弧正向的中点，保持「反平行取角中点」语义。
    const normalizedStart = ((startAngle % 360) + 360) % 360;
    const normalizedEnd = ((endAngle % 360) + 360) % 360;
    const span =
      normalizedEnd >= normalizedStart
        ? normalizedEnd - normalizedStart
        : normalizedEnd + 360 - normalizedStart;
    return arcDirection(frame, normalizedStart + span / 2);
  }
  return bisect(dir1, dir2) ?? dir1;
}
