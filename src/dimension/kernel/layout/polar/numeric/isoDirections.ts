import { cross3, dot3, EPSILON, length3, normalize3 } from '../../../vec';

import type { Vec3 } from '../../../types';

/**
 * PML 等轴测朝向函数的纯数值移植（vendor/MBD/markpipe/function/isoGetBestDir.pmlfnc、
 * isoGetDimDir.pmlfnc）。两者都只读入参，不读 isoori 成员；isoori.pmlobj:61-97
 * 把自己的成员当参数传进来，那一层对应 T3.3 的参考系层。
 *
 * 决策 D2 —— `DIRECTION.orthogonal(d)`：AVEVA 内建，源码读不到。由 isoori.pmlobj:81
 * `charDir = pipeDir.orthogonal(dimDir)` 之后 :88 用 y = dimdir、z = chardir 组成正交
 * ori 可知它是「同时垂直二者」的方向，即叉积；这里取右手 `normalize(a × b)`，二者
 * 平行时无解（PML 抛错，isoGetDimDir.pmlfnc:7-8 用 handle any 兜底）。
 *
 * 决策 D3 —— isoGetBestDir.pmlfnc:27-28 用 `sortedindices()[1]` 取最小夹角的轴，
 * PML 排序的平局顺序读不到；这里平局（含 1e-9° 内的浮点平局）取下标最小的轴。
 */

/** 浮点平局容差（度）：acos 在 45° / 135° 一类对称输入上会差出 1e-14 级噪声。 */
const TIE_EPSILON_DEG = 1e-9;

/** 两方向夹角（度），对应 PML `DIRECTION.angle`。 */
function angleDeg(a: Vec3, b: Vec3): number {
  const cosine = dot3(a, b) / (length3(a) * length3(b));
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

/** `0 - v` 而不是 `-v`，免得 0 分量变成 -0。 */
function opposite(v: Vec3): Vec3 {
  return [0 - v[0], 0 - v[1], 0 - v[2]];
}

/** PML `a.orthogonal(b)`（决策 D2）：同时垂直 a、b 的单位方向，平行时 null。 */
export function orthogonal(a: Vec3, b: Vec3): Vec3 | null {
  const crossed = cross3(a, b);
  return length3(crossed) < EPSILON ? null : normalize3(crossed);
}

/**
 * isoGetBestDir.pmlfnc:12-34：以 `dirs` 里与 `input` 最接近平行（或反平行）的那根轴
 * 为准——若 `input` 与它的夹角大于 90° 就取反，让结果指向优选半空间。
 */
export function isoGetBestDir(input: Vec3, dirs: readonly [Vec3, Vec3, Vec3]): Vec3 {
  const angles = [angleDeg(input, dirs[0]), angleDeg(input, dirs[1]), angleDeg(input, dirs[2])];
  const folded = angles.map(angle => Math.min(angle, 180 - angle));
  let best = 0;
  for (let index = 1; index < folded.length; index += 1) {
    // D3: a tie (within the float tolerance) keeps the lower index.
    if (folded[index]! < folded[best]! - TIE_EPSILON_DEG) best = index;
  }
  return angles[best]! > 90 ? opposite(input) : input;
}

/**
 * isoGetDimDir.pmlfnc:6-10：尺寸方向 = 同时垂直管向与第三优选方向的方向；管向与
 * 第三优选方向平行时改用第二优选方向；再经 isoGetBestDir 定正负。
 */
export function isoGetDimDir(pipeDir: Vec3, dimDirs: readonly [Vec3, Vec3, Vec3]): Vec3 {
  const dimDir = orthogonal(pipeDir, dimDirs[2]) ?? orthogonal(pipeDir, dimDirs[1]);
  if (!dimDir) {
    throw new RangeError('isoGetDimDir: pipeDir is parallel to both the third and the second preferred direction');
  }
  return isoGetBestDir(dimDir, dimDirs);
}
