/**
 * PML `polarsystem.getzdir` / `polarsystem.getresult` 的忠实移植（T3.4a）。
 *
 * 源：`polarsystem.pmlobj:380-398`（getzdir）与 `:2420-2539`（getresult）。
 * 两者都只读参考系值 + 少量标量，因此做成纯函数。
 *
 * ## 与 numeric 层的分工
 *
 * 极坐标弧的 frame 由参考系给定（`:289` `ori = x is showdir and z is dir`）：
 * `{ centre: reference.origin, xAxis: plane.zero, zAxis: plane.normal }`。
 * PML 里 `arc.near(pos.offset(dir, 1000))` 是「方向 → 角」，`1000` 只是保证偏移非零的
 * 长度，不进结果；这里直接用 `arcNear`，不引入长度常量。
 */

import { arcDirection, arcNear } from '../numeric/arc';
import { orthogonal } from '../numeric/isoDirections';

import { angleDeg, opposite } from './geometry';

import type { PolarNeeds, PolarTextOrientation } from './types';
import type { Vec3 } from '../../../types';
import type { ArcFrame } from '../numeric/arc';
import type { PolarReference } from '../reference/types';

/** 极坐标弧的 frame（`:289` + `:2421`）：弧心在轴上原点，零点是 showdir，绕轴是管轴。 */
export function polarArcFrame(reference: PolarReference): ArcFrame {
  return {
    centre: reference.origin,
    xAxis: reference.plane.zero,
    zAxis: reference.plane.normal,
  };
}

/**
 * PML `getzdir()`（`:380-398`）：textori 的 z 轴（文字朝向的法向）。
 *
 * 原文三支：
 * - `:381` `angle = horidir.angle(showdir)`；
 * - `:382` `angle < 1` 或 `> 179` 时退化（horidir 与 showdir 共线），`:387` 改看
 *   `dir.orthogonal(horidir).angle(d)`：`< 90` 取 `-dir`，否则取 `dir`；
 * - `:394` 否则 `horidir.orthogonal(showdir)`。
 *
 * 退化输入：`:387` 的 `dir.orthogonal(horidir)` 在 dir ∥ horidir 时无解（PML 的
 * `handle any` 已在 `:384-392` 被注释掉，会直接抛运行时错误），这里返回 `null`，
 * 由调用方升级成 `RangeError` 或改走别的分支。
 *
 * `d` 是世界向下 = `-up`；用 `reference.up` 而不是硬编码 `[0,0,1]`，但两者等价。
 */
export function getZDir(reference: PolarReference): Vec3 | null {
  const angle = angleDeg(reference.horiDir, reference.showDir);
  if (angle < 1 || angle > 179) {
    const cross = orthogonal(reference.axis, reference.horiDir);
    if (!cross) return null;
    const worldDown = opposite(reference.up);
    return angleDeg(cross, worldDown) < 90 ? opposite(reference.axis) : reference.axis;
  }
  return orthogonal(reference.horiDir, reference.showDir);
}

/** `getresult` 的返回值（PML `:2532-2535` 的 `[goodpos, textori]`）。 */
export type PolarPlacement = Readonly<{
  /** 标注锚点，米（`:2515` goodpos）。 */
  pos: Vec3;
  /** 文字坐标系（`:2513` textori）。 */
  textOri: PolarTextOrientation;
}>;

/**
 * PML `getresult(gooddis, goodangle, goodradius, needs, isdim)`（`:2420-2539`）。
 *
 * 逐段对应：
 * - `:2421-2422` 造弧取径向 `outdir`；
 * - `:2424-2425` `angle = min(dir.angle(U), 180 - dir.angle(U))` 折叠，`:2426` `> 10`
 *   进水平分支（`:2427-2428` 用 `getzdir()` 的 `bestchardir`），否则 `:2447` 竖直分支
 *   用 `showdir.orthogonal(u)`；
 * - `:2450-2463` chardir 三档（`|t-90| < 5` 退化 → 看 `outdir.angle(showdir)`；`> 90`
 *   取反；否则取正）；
 * - `:2496-2512` zdir → xdir 三档（`|t-90| < 1` 退化 → 看 `zdir.angle(bestchardir)`；
 *   `> 90` 取反；否则取正）；
 * - `:2513` `textori = y is chardir and x is xdir`；
 * - `:2515` `goodpos = pos.offset(dir, gooddis).offset(outdir, goodradius).offset(chardir, -needs[3]/2)`。
 *
 * `isdim` 在有效代码里不再影响结果（`:2517-2530` 的 isdim 分支整段在 `$( … $)` 里），
 * 因此签名不收；T3.4b 若需要保留旧签名，自行忽略该参数。
 *
 * 退化输入抛 `RangeError`：
 * - `getzdir()` 返回 null（水平分支且 horidir ∥ dir）；
 * - `showdir.orthogonal(u)` 无解（竖直分支且 showdir ∥ u，PML 会抛错）；
 * - `dir.orthogonal(chardir)` 无解（`:2496`，chardir ∥ dir，PML 会抛错）；
 * - `xdir × chardir` 退化（textori 的 z 轴无法定义）。
 */
export function getResult(
  reference: PolarReference,
  goodDis: number,
  goodAngle: number,
  goodRadius: number,
  needs: PolarNeeds,
): PolarPlacement {
  const frame = polarArcFrame(reference);
  const outDir = arcDirection(frame, goodAngle);

  const rawAngle = angleDeg(reference.axis, reference.up);
  const foldedAngle = Math.min(rawAngle, 180 - rawAngle);

  let bestCharDir: Vec3 | null;
  if (foldedAngle > 10) {
    const zDir = getZDir(reference);
    if (!zDir) {
      throw new RangeError('getResult: horiDir is parallel to axis, getzdir() has no solution');
    }
    bestCharDir = orthogonal(zDir, reference.showDir);
  } else {
    bestCharDir = orthogonal(reference.showDir, reference.up);
  }
  if (!bestCharDir) {
    throw new RangeError('getResult: showDir is parallel to up, bestchardir has no solution');
  }

  const charAngle = angleDeg(outDir, bestCharDir);
  let charDir: Vec3;
  if (Math.abs(charAngle - 90) < 5) {
    charDir = angleDeg(outDir, reference.showDir) < 90 ? opposite(outDir) : outDir;
  } else if (charAngle > 90) {
    charDir = opposite(outDir);
  } else {
    charDir = outDir;
  }

  const zDir = orthogonal(reference.axis, charDir);
  if (!zDir) {
    throw new RangeError('getResult: charDir is parallel to axis, textori z has no solution');
  }
  const textAngle = angleDeg(zDir, reference.showDir);
  let xDir: Vec3;
  if (Math.abs(textAngle - 90) < 1) {
    xDir = angleDeg(zDir, bestCharDir) < 90 ? reference.axis : opposite(reference.axis);
  } else if (textAngle > 90) {
    xDir = opposite(reference.axis);
  } else {
    xDir = reference.axis;
  }

  const textOri: PolarTextOrientation = {
    x: xDir,
    y: charDir,
    z: zDir,
  };

  // PML 是 1 基数组：`:2515` 的 `needs[3]` = needradius = 本类型的 `needs[2]`。
  const halfRadius = -needs[2] / 2;
  const pos: Vec3 = [
    reference.origin[0] + reference.axis[0] * goodDis + outDir[0] * goodRadius + charDir[0] * halfRadius,
    reference.origin[1] + reference.axis[1] * goodDis + outDir[1] * goodRadius + charDir[1] * halfRadius,
    reference.origin[2] + reference.axis[2] * goodDis + outDir[2] * goodRadius + charDir[2] * halfRadius,
  ];

  return { pos, textOri };
}

/**
 * PML `arc.near(origin.offset(dir, 1000))`：方向 → 极坐标角（度，`[0, 360)`）。
 *
 * 方向落在弧平面上（`plane.normal` 方向分量为 0）时等价于纯角度换算；方向带轴分量时
 * `arcNear` 只取平面内投影。投影退化返回 `null`，由调用方决定兜底。
 */
export function angleOfDirection(reference: PolarReference, dir: Vec3): number | null {
  return arcNear(polarArcFrame(reference), [
    reference.origin[0] + dir[0],
    reference.origin[1] + dir[1],
    reference.origin[2] + dir[2],
  ]);
}
