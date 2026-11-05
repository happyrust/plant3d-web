/**
 * 放置层内部几何小工具（T3.4a）。只服务 `place/` 目录，不进 barrel。
 *
 * PML 的 `DIRECTION.angle` / `DIRECTION.opposite` / `DIRECTION.bisect` 是无源码内建，
 * 语义由用法互证（见 `numeric/isoDirections.ts` 的决策 D2 与 `arc.ts` 文件头）。
 * 这里只补 `place/` 需要的三个，避免重写 numeric 层已有的 `orthogonal`。
 */

import { dot3, length3, scale3, tryNormalize3 } from '../../../vec';

import type { Vec3 } from '../../../types';

/** PML `a.angle(b)`：夹角（度），`[0, 180]`。零向量输入得到 NaN，由调用方拒绝。 */
export function angleDeg(a: Vec3, b: Vec3): number {
  const denominator = length3(a) * length3(b);
  if (!(denominator > 0)) return Number.NaN;
  const cosine = dot3(a, b) / denominator;
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

/** PML `dir.opposite()`：取反，`0 - v` 避免产生 `-0`。 */
export function opposite(v: Vec3): Vec3 {
  return [0 - v[0], 0 - v[1], 0 - v[2]];
}

/**
 * PML `a.bisect(b)`：角平分线方向 = `normalize(a + b)`。
 *
 * 反向平行（`a + b` 近零）时无解：PML 抛运行时错误，这里返回 null 让调用方决定。
 */
export function bisect(a: Vec3, b: Vec3): Vec3 | null {
  return tryNormalize3([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
}

/** `origin + dir × distance`，对应 PML `pos.offset(dir, distance)`。 */
export function offset(origin: Vec3, dir: Vec3, distance: number): Vec3 {
  const delta = scale3(dir, distance);
  return [origin[0] + delta[0], origin[1] + delta[1], origin[2] + delta[2]];
}

/** 逐分量容差相等，用于 PML `array.unique()` 的方向去重。 */
export function sameDirection(a: Vec3, b: Vec3, epsilon = 1e-9): boolean {
  return (
    Math.abs(a[0] - b[0]) <= epsilon &&
    Math.abs(a[1] - b[1]) <= epsilon &&
    Math.abs(a[2] - b[2]) <= epsilon
  );
}
