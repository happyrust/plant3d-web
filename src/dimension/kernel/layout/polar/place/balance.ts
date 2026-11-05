/**
 * PML `polarsystem.balance` 的忠实移植（T3.4b）。
 *
 * 源：`polarsystem.pmlobj:537-648`。给定一个轴向单元 `disArr`，产出该单元的
 * 角度区间列表、重排后的优选方向、障碍元素、径向档位候选半径——供
 * `getBestPosAndOri` Step 5 使用。
 *
 * 四段（对应 PML 自身的段落）：
 * 1. `:540` `getdiseles(disArr)` 取障碍元素；
 * 2. `:542-582` 从障碍元素的外半径（四舍五入到毫米，见 `nintMm`）里筛出落在
 *    `(basicRadius, basicRadius × 20/50)` 的候选半径，连同 `basicRadius`
 *    本身，去重排序后再从高到低合并「挨得太近」（差 < `basicRadius / 20`）
 *    的相邻值，只留每簇里最大的一个；
 * 3. `:586-595` `isDim && mainDimDir` 时强制走单一角度窗口（`mainDimDir` 恒
 *    null，本实现保留分支与 `diagnostics.forcedMainDimDir` 旗标备未来注入）；
 * 4. `:596-636` 否则按障碍元素的「径向厚度 × 轴向重叠宽度」加权，取角度质心
 *    方向 `wdir`，再把 `newbestdirs` 按与 `wdir` 的夹角升序重排（`handle any`
 *    吞掉 `wdir` 退化时的错误，等价于保持 `newbestdirs` 原序不变）。
 *
 * ## 缺陷修正：`:618-620` 的除零
 *
 * PML 原文：`!e = !e * !totalw / !newtotalw + !wpos.east * !weight / !newtotalw`
 * （`:618`，`:619` / `:620` 同式）。当某次迭代的 `!weight` 为 0（`wr` 或 `wl`
 * 恰为 0）且此前 `!totalw` 也是 0 时，`!newtotalw = 0`，三行各产生一次 `0/0`。
 * 修正：`newtotalw === 0` 时跳过本次累加（既有总权重与新增权重都是 0，加权平均
 * 无定义，保持 0 与「重新从 0 开始累加」等价，不产生 NaN）。
 *
 * ## `:610` / `:624-625` 的 1000 偏移不需要换算
 *
 * `wpos = cenpos.offset(angledirection(mid), 1000)`，随后对多个 `wpos` 做加权
 * 平均得到 `twpos`，再取 `wdir = twpos.direction(cenpos)`。由于每个 `wpos` 都是
 * `cenpos + 1000·dir_i`，加权平均后 `twpos = cenpos + 1000·(Σw_i·dir_i / Σw_i)`，
 * 取方向时 `1000` 与 `cenpos` 偏移量都被 `direction()` 的归一化消掉——与
 * `arc.ts` 文件头「`1000` 只是方向探测的偏移量」同一结论，这里直接按加权方向
 * 平均实现，不引入该常量。
 *
 * ## ENU 分量
 *
 * PML `pos.east` / `.north` / `.up` 是位置在世界 ENU 基下的三个分量。本仓极坐标层
 * 的世界轴约定是 `E=[1,0,0]`、`N=[0,1,0]`、`U=[0,0,1]`（`reference/types.ts` 的
 * `up` 字段注释、`dirAndCha.test.ts` 的参考系夹具），故 `.east/.north/.up` 直接取
 * `Vec3` 的三个分量，不需要另外的基变换。
 */

import { arcDirection, arcNear } from '../numeric/arc';

import { getDisEles } from './disEles';
import { angleDeg } from './geometry';
import { polarArcFrame } from './result';

import type { Vec3 } from '../../../types';
import type { AngleRange } from '../numeric/angleRanges';
import type { PolarElement, PolarReference } from '../reference/types';

/** `:575` `basicRadius / 20`：合并相邻候选半径的间距门槛。 */
const RADIUS_MERGE_DIVISOR = 20;

/** `:521` / `:525`：候选半径必须落在 `(basicRadius, basicRadius × factor)`。 */
const NON_INST_PIPE_RADIUS_FACTOR = 20;
const INST_PIPE_RADIUS_FACTOR = 50;

/**
 * `:545` `!r2 = !ele.endradius.nint()`：PML 的 `nint()` 四舍五入到最接近的
 * **毫米整数**（PML 单位本身是毫米）。本层单位是米，裸的 `Math.round` 会把亚米
 * 级精度全部抹掉（`0.12m` 会舍成 `0`），必须先放大到毫米再取整再缩回米。
 */
function nintMm(valueMeters: number): number {
  return Math.round(valueMeters * 1000) / 1000;
}

export type BalanceResult = Readonly<{
  /** `:639` result[1]：本单元的角度区间列表。 */
  angleRanges: readonly AngleRange[];
  /** `:640` result[2]：重排后的优选方向。 */
  bestDirs: readonly Vec3[];
  /** `:642` result[3]：本单元的障碍元素（`getdiseles` 的结果，供 Step 9 分带）。 */
  elements: readonly PolarElement[];
  /** `:643` result[4]：候选半径（含 `basicRadius`），升序去重。 */
  radii: readonly number[];
  /** 是否走了 `:586-595` 的强制单窗口分支。 */
  forcedMainDimDir: boolean;
}>;

/** `:566-567` `radiuss.unique().sort()` 的去重排序（数值相等视为重复）。 */
function uniqueSorted(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.length === 0 || result[result.length - 1] !== value) result.push(value);
  }
  return result;
}

/**
 * `:571-582`：从高到低合并挨得太近（差 < `basicRadius / 20`）的相邻候选半径，
 * 每簇只留最大值。输入必须已升序去重。
 */
function mergeCloseRadii(sorted: readonly number[], basicRadius: number): number[] {
  if (sorted.length < 2) return [...sorted];

  const kept = new Array<boolean>(sorted.length).fill(true);
  let largeRadius = sorted[sorted.length - 1]!;
  for (let x = sorted.length - 2; x >= 0; x -= 1) {
    if (largeRadius - sorted[x]! < basicRadius / RADIUS_MERGE_DIVISOR) {
      kept[x] = false;
    } else {
      largeRadius = sorted[x]!;
    }
  }
  return sorted.filter((_, index) => kept[index]);
}

/**
 * `:542-565`：从障碍元素的外半径（四舍五入）里筛出候选半径，连同 `basicRadius`。
 */
function collectCandidateRadii(
  reference: PolarReference,
  elements: readonly PolarElement[],
): number[] {
  const radii = [reference.basicRadius];
  const factor = reference.isInstPipe ? INST_PIPE_RADIUS_FACTOR : NON_INST_PIPE_RADIUS_FACTOR;
  for (const ele of elements) {
    const r2 = nintMm(ele.radius[1]);
    if (r2 > reference.basicRadius && r2 < reference.basicRadius * factor) {
      radii.push(r2);
    }
  }
  return mergeCloseRadii(uniqueSorted(radii), reference.basicRadius);
}

/**
 * `:586-595`：`isDim && mainDimDir` 的强制单窗口分支。`:591` 的 1000 偏移同样
 * 只是方向探测用的中间量，不需要单位换算（见文件头）。
 */
function forcedMainDimDirWindow(
  reference: PolarReference,
  mainDimDir: Vec3,
  needAngle: number,
): Readonly<{ angleRanges: readonly AngleRange[]; bestDirs: readonly Vec3[] }> {
  const frame = polarArcFrame(reference);
  const probe: Vec3 = [
    frame.centre[0] + mainDimDir[0],
    frame.centre[1] + mainDimDir[1],
    frame.centre[2] + mainDimDir[2],
  ];
  const angle = arcNear(frame, probe);
  if (angle === null) {
    throw new RangeError('balance: mainDimDir is degenerate on the polar plane');
  }
  return {
    angleRanges: [[angle - needAngle / 2, angle + needAngle / 2]],
    bestDirs: [mainDimDir],
  };
}

/**
 * `:596-636`：按障碍元素的加权质心方向重排 `newBestDirs`。
 *
 * @returns 重排后的方向数组；`wdir` 无解（无障碍元素或方向退化）时原样返回输入。
 */
function reorderByWeightedCentroid(
  reference: PolarReference,
  elements: readonly PolarElement[],
  disArr: readonly [number, number],
  newBestDirs: readonly Vec3[],
): Vec3[] {
  const frame = polarArcFrame(reference);

  let e = 0;
  let n = 0;
  let u = 0;
  let totalW = 0;

  for (const ele of elements) {
    if (ele.dis[0] >= disArr[1] || ele.dis[1] <= disArr[0]) continue;

    const wr = ele.radius[1] - ele.radius[0];
    const wl = Math.min(disArr[1], ele.dis[1]) - Math.max(disArr[0], ele.dis[0]);
    const weight = wr * wl;
    const dir = arcDirection(frame, (ele.angle[0] + ele.angle[1]) / 2);

    const newTotalW = totalW + weight;
    // `:618-620` 修正：newTotalW === 0 时（totalW 与本次 weight 都是 0）跳过，
    // 避免 0/0。
    if (newTotalW !== 0) {
      e = (e * totalW) / newTotalW + (dir[0] * weight) / newTotalW;
      n = (n * totalW) / newTotalW + (dir[1] * weight) / newTotalW;
      u = (u * totalW) / newTotalW + (dir[2] * weight) / newTotalW;
    }
    totalW = newTotalW;
  }

  // `:624-625`：twpos = centre + (e,n,u)（因为每个 dir 已经是单位向量，相当于
  // `offset(dir, 1000)` 在加权平均与 direction() 归一化后抵消掉的 1000，见文件头）。
  // wdir 退化（twpos 与 centre 重合，即没有障碍元素或权重全 0）时 PML 的
  // `handle any` 吞掉错误、保持 newbestdirs 不变。
  const delta: Vec3 = [e, n, u];
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (!(length > 0)) return [...newBestDirs];
  const wdir: Vec3 = [delta[0] / length, delta[1] / length, delta[2] / length];

  // `:628-634`：按与 wdir 的夹角升序排（PML sortedindices 是稳定排序）。
  return [...newBestDirs]
    .map((dir, index) => ({ dir, angle: angleDeg(dir, wdir), index }))
    .sort((left, right) => left.angle - right.angle || left.index - right.index)
    .map(entry => entry.dir);
}

/**
 * PML `balance(disArr, angleRange, needAngle, newBestDirs, isDim)`（`:537-648`）。
 *
 * @param reference 参考系。
 * @param elements PML `this.elements`。
 * @param disArr PML `disarr`：本轴向单元 `[start, end]`。
 * @param angleRange PML `anglerange`：`isDim` 为 false 或 `mainDimDir` 未定时原样返回。
 * @param needAngle PML `needangle`（`needs[2]`，恒 30）。
 * @param newBestDirs PML `newbestdirs`：进入时的优选方向（即 `getnormaldirs()` 的结果）。
 * @param isDim PML `isdim`。
 * @param ignoreLine PML `this.ignoreline`，转给 `getdiseles`。
 */
export function balance(
  reference: PolarReference,
  elements: readonly PolarElement[],
  disArr: readonly [number, number],
  angleRange: readonly AngleRange[],
  needAngle: number,
  newBestDirs: readonly Vec3[],
  isDim: boolean,
  ignoreLine: boolean,
): BalanceResult {
  const diseles = getDisEles(reference, elements, disArr, ignoreLine);
  const radii = collectCandidateRadii(reference, diseles);

  if (isDim && reference.mainDimDir) {
    const forced = forcedMainDimDirWindow(reference, reference.mainDimDir, needAngle);
    return {
      angleRanges: forced.angleRanges,
      bestDirs: forced.bestDirs,
      elements: diseles,
      radii,
      forcedMainDimDir: true,
    };
  }

  const reordered = reorderByWeightedCentroid(reference, diseles, disArr, newBestDirs);
  return {
    angleRanges: angleRange,
    bestDirs: reordered,
    elements: diseles,
    radii,
    forcedMainDimDir: false,
  };
}
