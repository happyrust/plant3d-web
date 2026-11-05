/**
 * PML `polarsystem.getnormaldirs` / `normalanglerange` / `getanglerange` /
 * `getUsedAngles` 的忠实移植（T3.4a）。
 *
 * 源：`polarsystem.pmlobj:2541-2574`、`:1772-1812`、`:1813-1859`、`:1985-2043`。
 */

import { angleInAngles, angleUnique, mergeAngles } from '../numeric/angleRanges';
import { arcDirection } from '../numeric/arc';
import { orthogonal } from '../numeric/isoDirections';

import { angleDeg, opposite, sameDirection } from './geometry';
import { angleOfDirection, getZDir, polarArcFrame } from './result';

import type { Vec3 } from '../../../types';
import type { AngleRange } from '../numeric/angleRanges';
import type { PolarElement, PolarReference } from '../reference/types';

/**
 * `:2558` / `:2424` / `:1777` 共用的「竖直管」判定阈值：`dir.angle(u)` 落在
 * `(10, 170)` 之外即竖直（`:2559` `lt 10 or gt 170`，`:1778` / `:2426` 取补集）。
 */
export const VERTICAL_ANGLE_TOLERANCE_DEG = 10;

/** `:1776` `!tolerance = 45`：`normalanglerange` 的固定角窗半宽。 */
export const NORMAL_ANGLE_TOLERANCE_DEG = 45;

/** `:1619` `!notbestplusangle = 30`：非首选方向的角偏差罚值。 */
export const NOT_BEST_PLUS_ANGLE_DEG = 30;

/** 管轴是否近竖直：`dir.angle(u)` 在 `(10, 170)` 之外。 */
export function isVerticalAxis(
  reference: PolarReference,
  toleranceDeg = VERTICAL_ANGLE_TOLERANCE_DEG,
): boolean {
  const angle = angleDeg(reference.axis, reference.up);
  return angle < toleranceDeg || angle > 180 - toleranceDeg;
}

/** PML `array.unique()`：按值去重，保留首次出现顺序。 */
function uniqueDirections(dirs: readonly Vec3[]): Vec3[] {
  const unique: Vec3[] = [];
  for (const dir of dirs) {
    if (!unique.some(existing => sameDirection(existing, dir))) unique.push(dir);
  }
  return unique;
}

/**
 * PML `getnormaldirs()`（`:2541-2574`）：放置标注最常用的候选方向。
 *
 * 逐段：
 * - `:2555-2557` `mainDimDir` 已定则先进候选（本层 `reference.mainDimDir` 恒 null，
 *   保留判断以备 T3.5 注入）；
 * - `:2558-2561` 竖直管（`dir.angle(u) < 10` 或 `> 170`）：加
 *   `showdir.orthogonal(u)` 及其反向；
 * - `:2562-2569` 否则取 `getzdir()`，用 `ori = x is showdir and z is zdir` 的弧取 ±90°
 *   的径向方向；
 * - `:2572` `unique()` 去重（PML 的 unique 按值；这里逐分量容差去重，保留首次出现）。
 *
 * 退化：竖直分支的 `showdir.orthogonal(u)`、水平分支的 `getzdir()` 都可能无解。
 * PML 在 `:2560` 没有 `handle any`（会抛运行时错误），这里跳过该分支而不是抛错——
 * 与 `:2572` 去重后「少一个候选」等价，且 `getDirAndCha` 允许空 bestdirs。
 */
export function getNormalDirs(reference: PolarReference): Vec3[] {
  const dirs: Vec3[] = [];
  if (reference.mainDimDir) dirs.push(reference.mainDimDir);

  if (isVerticalAxis(reference)) {
    const horizontal = orthogonal(reference.showDir, reference.up);
    if (horizontal) {
      dirs.push(horizontal);
      dirs.push(opposite(horizontal));
    }
  } else {
    const zDir = getZDir(reference);
    if (zDir) {
      const frame = { centre: reference.origin, xAxis: reference.showDir, zAxis: zDir };
      dirs.push(arcDirection(frame, 90));
      dirs.push(arcDirection(frame, -90));
    }
  }

  return uniqueDirections(dirs);
}

/**
 * PML `normalanglerange()`（`:1772-1812`）：按管向给出「默认可用」的角度区间。
 *
 * 逐段：
 * - `:1776` 固定 `tolerance = 45`；
 * - `:1777-1778` 水平管（`dir.angle(u)` 在 `(10, 170)` 内）：
 *   - `:1779` 取 `getzdir()`，`:1781` 若 `zdir.angle(dir) < 90` 先给 `[45, 135]` 再给
 *     `[-135, -45]`，否则顺序相反（`getDirAndCha` 按顺序偏好前者）；
 * - `:1798-1809` 竖直管：固定 `[45, 135]`、`[-135, -45]`，顺序同上一支的第一种。
 *
 * PML 返回的是**未归一化**的负角区间（`-135..-45`），下游 `mergeAngles` /
 * `angleInAngles` 各自 `angleUnique` 归一（`angleunique.pmlfnc:13-21`）。这里原样保留
 * 负角，保持逐值等价。
 *
 * 退化：`getzdir()` 无解（horidir ∥ axis）时 PML 会在 `:1781` 抛运行时错误；这里退回
 * 竖直管那一档的固定区间，让上游拿到确定结果（记录为偏离）。
 */
export function normalAngleRange(
  reference: PolarReference,
  toleranceDeg = NORMAL_ANGLE_TOLERANCE_DEG,
): AngleRange[] {
  const positive: AngleRange = [90 - toleranceDeg, 90 + toleranceDeg];
  const negative: AngleRange = [-90 - toleranceDeg, -90 + toleranceDeg];

  if (isVerticalAxis(reference)) return [positive, negative];

  const zDir = getZDir(reference);
  if (!zDir) return [positive, negative];
  return angleDeg(zDir, reference.axis) < 90 ? [positive, negative] : [negative, positive];
}

/**
 * PML `getanglerange(inputallangleranges, needangle, bestdirs)`（`:1813-1859`）。
 *
 * 控制流关键点：`:1819` 是 `--$(`、`:1845` 是 `--$)`，即**块注释标记被行注释吃掉**，
 * 中间 `:1820-1844` 是活代码；`:1846-1853` 那段（`limit` 为 true 时的 `[[0,360]]`）
 * 才是不可达的死代码。所以实际行为是：
 *
 * - `:1854-1855` 输入非空 → 原样返回输入；
 * - `:1816-1817` 输入为空 → `limit = false`，`:1818` 走 if 分支（活代码）：
 *   - `:1820` `bestdirs` 为空或 `usebest` 为 false → `:1826-1827` `usenewwayangle`
 *     为 true，取 `normalanglerange()`；
 *   - 否则 `:1836-1842` 每个 bestdir 取极坐标角（`:1838` 再 `nint()`）展开成
 *     `[角 - needangle/2, 角 + needangle/2]`。
 *
 * 调用方固定值（`getBestPosAndOri` `:1061`，与 `:1042-1049` 同一路）：`usebest` 恒
 * true（`:1814`）、`limit` 恒 false（`:1817`）。easy way 3（`:485-492`）与
 * `getMainDimDir`（`:351-358`）都传空 `bestdirs`，所以**默认路径是
 * `normalanglerange()`**，不是 `[[0,360]]`。
 *
 * @param allAngleRanges PML `inputallangleranges`。
 * @param needAngle PML `needangle`（度），仅 bestdirs 分支使用。
 * @param bestDirs PML `bestdirs`。
 * @param reference 参考系，仅 bestdirs 分支使用。
 * @param useBest PML `usebest`，调用方恒 true。
 * @param limit PML `limit`，调用方恒 false。
 */
export function getAngleRange(
  allAngleRanges: readonly AngleRange[],
  needAngle: number,
  bestDirs: readonly Vec3[],
  reference: PolarReference,
  useBest = true,
  limit = false,
): AngleRange[] {
  if (allAngleRanges.length > 0) return allAngleRanges.map(range => [range[0], range[1]] as const);

  if (limit) return [[0, 360]];

  if (bestDirs.length === 0 || !useBest) return normalAngleRange(reference);

  const ranges: AngleRange[] = [];
  for (const bestDir of bestDirs) {
    const angle = angleOfDirection(reference, bestDir);
    if (angle === null) continue;
    const bestAngle = Math.round(angle);
    ranges.push([bestAngle - needAngle / 2, bestAngle + needAngle / 2]);
  }
  return ranges;
}

/** PML `:1996-2005` 的单次归一：`<0` 加 360，`>=360` 减 360，只做一次。 */
function wrapOnce(angle: number): number {
  if (angle < 0) return angle + 360;
  if (angle >= 360) return angle - 360;
  return angle;
}

/**
 * PML `getUsedAngles(eles, anglerange)`（`:1985-2043`）：把一个轴向单元内已占用的
 * 角度区间求出来。
 *
 * 逐段：
 * - `:1988-2013` 把输入 `anglerange` 的**相邻间隙**当已占用区间：第 x 个区间取
 *   `startangle = anglerange[x][2]`（即它的 end）、`endangle = anglerange[x+1][1]`
 *   （下一个的 start），最后一个绕回第一个的 end（`:1990-1991`）。`start` 在
 *   `:1996-2000` 单次归一（`<0` 加 360、`>=360` 减 360），`end` 同理（`:2001-2005`）；
 *   两者相等（`:2007`）时丢弃——这是 `[[0,360]]` 输入得到空结果的原因；
 * - `:2017-2033` 每个元素的 `[startangle, endangle]` 原样加入（`start > end` 表示跨界，
 *   合法，见 `:2027` 注释；`:2020-2025` 两个归一化分支已被注释掉，所以不归一）；
 * - `:2035` `mergeangles` 合并；
 * - `:2039-2040` 按 start 排序（`mergeAngles` 已按 start 升序返回，这里保留显式排序）。
 *
 * 偏离：`mergeAngles` 内部用 `angleUnique` 循环归一到 `[0, 360]`，PML `:1996-2005`
 * 只归一次。两者在 `[-360, 720]` 内一致；更极端的输入 PML 会留下越界值，这里收敛。
 */
export function getUsedAngles(
  elements: readonly PolarElement[],
  angleRanges: readonly AngleRange[],
): AngleRange[] {
  const collected: AngleRange[] = [];

  for (let x = 0; x < angleRanges.length; x += 1) {
    const startRaw = angleRanges[x]![1];
    // `:1991` 绕回的是**第一个区间的 start**（`anglerange[1][1]`），不是它的 end。
    const endRaw = x === angleRanges.length - 1 ? angleRanges[0]![0] : angleRanges[x + 1]![0];

    const start = wrapOnce(startRaw);
    const end = wrapOnce(endRaw);
    // `:2007` 相等即跳过（含 `[[0,360]]` 自环）。
    if (start !== end) collected.push([start, end]);
  }

  for (const element of elements) {
    collected.push([element.angle[0], element.angle[1]]);
  }

  const merged = mergeAngles(collected);
  return merged
    .map(range => range as AngleRange)
    .sort((left, right) => left[0] - right[0]);
}

/** 判断角度是否落在区间集合内（`angleinangles.pmlfnc:12-27` 的批量版）。 */
export function angleInAnyRange(angle: number, ranges: readonly AngleRange[]): boolean {
  return ranges.some(range => angleInAngles(angle, range[0], range[1]));
}

/** 把角度归一进 `[0, 360]`，供测试与上游断言用（转发 `angleRanges.angleUnique`）。 */
export const normalizeAngle = angleUnique;

/** 方向 → 极坐标角，T3.4b 的 `balance` / `place` 直接复用。 */
export function directionAngle(reference: PolarReference, dir: Vec3): number | null {
  return angleOfDirection(reference, dir);
}

/** 极坐标弧 frame 的重导出，T3.4b 直接用。 */
export { polarArcFrame };
