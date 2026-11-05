/**
 * PML `polarsystem.getdiseles(!disarr)` 的忠实移植（T3.4b）。
 *
 * 源：`polarsystem.pmlobj:510-535`。给定一个轴向单元 `disarr = [start, end]`，
 * 从 `this.elements` 里选出沿轴与它重叠、且径向足够靠近管轴的障碍元素，供
 * `balance` / Step 9（径向分带）使用。
 *
 * 逐段：
 * - `:514` `--if not(...)` 已被注释掉，真正生效的沿轴重叠判断是 `:521` /
 *   `:525` 内联的 `not(ele.startdis ge disarr[2] or ele.enddis le disarr[1])`；
 * - `:515-519` `ignoreline` 为真时，跳过「沿轴跨度 < 1mm」的元素（线状标注通常
 *   跨度为 0，视作不参与避让）——`1` 是 PML 的毫米裸数，本层单位是米，换算成
 *   `0.001`；
 * - `:520-528` 径向上限按 `isInstPipe` 二选一：非仪表管用 `basicRadius * 20`
 *   （`:521`），仪表管用 `basicRadius * 50`（`:525`）——都是 PML 自身的
 *   `basicRadius` 倍数，`basicRadius` 本身已经是米，不需要再单独换算；
 * - `:530-532` 被注释掉的调试分支，不移植。
 *
 * PML `ele.startdis ge disarr[2] or ele.enddis le disarr[1]` 的否定即「沿轴区间
 * 与 `disarr` 有重叠（含边界相切）」。
 */

import type { PolarElement, PolarReference } from '../reference/types';

/** `:516` `ele.enddis - ele.startdis lt 1` 的「线状元素」判定阈值。PML 是 1mm，这里换算成米。 */
const IGNORE_LINE_SPAN_THRESHOLD_M = 0.001;

/** `:521` 非仪表管的径向上限系数。 */
const NON_INST_PIPE_RADIUS_FACTOR = 20;

/** `:525` 仪表管的径向上限系数。 */
const INST_PIPE_RADIUS_FACTOR = 50;

/**
 * PML `getdiseles(disarr)`（`:510-535`）。
 *
 * @param reference 参考系，取 `basicRadius` / `isInstPipe`。
 * @param elements PML `this.elements`。
 * @param disArr PML `disarr`：轴向单元 `[start, end]`。
 * @param ignoreLine PML `this.ignoreline`。
 */
export function getDisEles(
  reference: PolarReference,
  elements: readonly PolarElement[],
  disArr: readonly [number, number],
  ignoreLine: boolean,
): PolarElement[] {
  const radiusLimit =
    reference.basicRadius * (reference.isInstPipe ? INST_PIPE_RADIUS_FACTOR : NON_INST_PIPE_RADIUS_FACTOR);

  const result: PolarElement[] = [];
  for (const ele of elements) {
    if (ignoreLine && ele.dis[1] - ele.dis[0] < IGNORE_LINE_SPAN_THRESHOLD_M) continue;

    const overlapsAxially = !(ele.dis[0] >= disArr[1] || ele.dis[1] <= disArr[0]);
    if (overlapsAxially && ele.radius[0] < radiusLimit) {
      result.push(ele);
    }
  }
  return result;
}
