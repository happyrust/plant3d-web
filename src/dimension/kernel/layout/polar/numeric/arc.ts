/**
 * AVEVA 内建 `ARC` 对象的 `near` / `angledirection` 的纯数值等价实现（T3.4 前置）。
 *
 * AVEVA 内建对象方法无源码，语义由 `polarsystem.pmlobj` 里的用法互相印证（逐条见
 * `arc.test.ts` 与本次移植报告）：
 *
 * - `:729-730` `!angle = !arc.near(!poss[4])` 紧接 `!posdir = !arc.angledirection(!angle)`
 *   ——「位置 → 角 → 位置方向」。只有 `angledirection` 给**径向**（弧心指向弧上该角处）
 *   时这条链才有意义：后续 `:745-800` 拿 `posdir` 判断「哪一侧更近」用的是径向方位。
 * - `:813-816` 极坐标盒四角
 *   `!temppos.offset(!arc.angledirection(!ele.startangle), !ele.startradius)`
 *   ——「角 + 半径 → 点」，偏移量是半径，方向必须径向（切向会把盒子整体转 90°）。
 * - `:610` 权重点 `!cenpos.offset(!arc.angledirection((start+end)/2), 1000)` —— 同上。
 * - `:1255` / `:1564` / `:1629` `!goodangle = !arc.near(!arc.position.offset(!bestdir,1000))`
 *   —— 方向 → 角：把方向当位置偏移再取角，隐含 `near` 与 `angledirection` 互逆。
 * - `:2422` `!outdir = !arc.angledirection(!goodangle)`，随后 `getresult` 用
 *   `goodpos = origin + axis·gooddis + outdir·goodradius + …` 组装位置（径向偏移）。
 *
 * 因此：`arcDirection(frame, θ)` = 径向单位方向；`arcNear(frame, p)` = 它的逆，返回 `p`
 * 在弧平面上投影的极角（度，`[0, 360)`）。
 *
 * ## 基与手性
 *
 * PML `object arc(pos, orientation('X is x and z is z'), …)` 的 `orientation` 会把非正交
 * 输入重建成正交系；这里按 **z 优先** 正交化（`polarsystem.pmlobj:269-273` 先把 z 钉到
 * `±dir`，`:277` 才把 `horidir` 当 x，所以 z 不可动）：
 *
 * - `z' = normalize(z)`；
 * - `x' = normalize(x - (x·z')z')`；
 * - `y = normalize(z' × x')` —— 右手系，与 `isoSheet.ts` 原切线实现及
 *   `geometry/planeBasis.ts` 的 `v = n × u` 同手性。
 *
 * `arcDirection` 的 θ 从 `x'` 起、绕 `z'` 正向转，与 `PolarPlane` 的
 * 「角度从 `zero` 起、绕 `normal` 正向转」一致。
 *
 * 本文件是纯数值层，不 import `reference/`（依赖方向只有 reference → numeric）。
 */

import { cross3, dot3, EPSILON, normalize3, sub3, tryNormalize3 } from '../../../vec';

import type { Vec3 } from '../../../types';

/** 极坐标弧的几何输入：弧心 + 角度零点轴 + 绕向轴（对应 PML 的 `arc` + `orientation`）。 */
export type ArcFrame = Readonly<{
  /** 弧心（PML `arc.position`；`polarsystem.pmlobj:277` 传 `!this.pos`）。 */
  centre: Vec3;
  /** 角度零点轴（PML `orientation` 的 xdir；`polarsystem.pmlobj:277` 传 `!horidir`）。 */
  xAxis: Vec3;
  /** 绕向轴（PML `orientation` 的 zdir；`polarsystem.pmlobj:277` 传 `!tempdir`）。 */
  zAxis: Vec3;
}>;

/** 正交化后的弧基：`(x, y, z)` 右手系，`x` 与 `y` 都在弧平面内。 */
type ArcBasis = Readonly<{ centre: Vec3; x: Vec3; y: Vec3; z: Vec3 }>;

/**
 * 由 `ArcFrame` 建正交基（z 优先正交化，见文件头）。
 *
 * 退化输入抛 `RangeError`，与 `camera.ts` 对退化 axis 的处理一致（PML 侧是 `handle any`
 * 兜住的运行时错误，这里升级成显式契约）：
 *
 * - `zAxis` 为零向量或含非有限值；
 * - `xAxis` 为零向量，或与 `zAxis` 平行（正交化后残余长度 `<= EPSILON`）。
 */
function arcBasis(frame: ArcFrame): ArcBasis {
  const z = tryNormalize3(frame.zAxis);
  if (!z) {
    throw new RangeError('arc frame: zAxis must be a finite non-zero vector');
  }
  const projection = dot3(frame.xAxis, z);
  const x = tryNormalize3([
    frame.xAxis[0] - z[0] * projection,
    frame.xAxis[1] - z[1] * projection,
    frame.xAxis[2] - z[2] * projection,
  ]);
  if (!x) {
    throw new RangeError('arc frame: xAxis must be non-zero and not parallel to zAxis');
  }
  // z ⟂ x 且两者皆非零 → 叉积长度 1，normalize3 不会抛。
  return { centre: frame.centre, x, y: normalize3(cross3(z, x)), z };
}

/** 把角度归一到 `[0, 360)`，并把 `-0` 收敛成 `0`（`-0 === 0` 但 `Object.is` 能区分）。 */
function normalizeAngleDeg(deg: number): number {
  const wrapped = deg % 360;
  // 负角加上 360 后可能因浮点舍入得到恰好 360（如 -1e-16 级），再折一次。
  const shifted = wrapped < 0 ? wrapped + 360 : wrapped;
  const positive = shifted >= 360 ? 0 : shifted;
  return positive === 0 ? 0 : positive;
}

/**
 * PML `arc.angledirection(θ)`：弧上 θ 处的**径向**单位方向（弧心 → 弧上该点）。
 *
 * θ 单位度，可为任意实数（按 `cos θ` / `sin θ` 取值，不做取模）。
 */
export function arcDirection(frame: ArcFrame, angleDeg: number): Vec3 {
  const basis = arcBasis(frame);
  const radians = (angleDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  // x、y 正交且单位 → 组合向量长度恒为 1，normalize3 只吃掉浮点残差。
  return normalize3([
    basis.x[0] * cosine + basis.y[0] * sine,
    basis.x[1] * cosine + basis.y[1] * sine,
    basis.x[2] * cosine + basis.y[2] * sine,
  ]);
}

/**
 * PML `arc.near(pos)`：`pos` 在弧平面上投影的极角，度，`[0, 360)`。
 *
 * `pos` 沿 `zAxis` 的分量被丢掉（PML `arc.near` 只看平面内投影）。投影长度
 * `< EPSILON`（`vec.ts` 的 `1e-9`）时无角度可定义，返回 `null`；调用方必须自己决定
 * 兜底（PML 侧等价于 `handle any`）。
 *
 * 退化弧（`xAxis` 为零或与 `zAxis` 平行、`zAxis` 为零）抛 `RangeError`，同 `arcDirection`。
 */
export function arcNear(frame: ArcFrame, pos: Vec3): number | null {
  const basis = arcBasis(frame);
  const delta = sub3(pos, basis.centre);
  const along = dot3(delta, basis.x);
  const across = dot3(delta, basis.y);
  // `!(>=)` 而不是 `<`：输入含 NaN 时也走「无角度」分支。
  if (!(Math.hypot(along, across) >= EPSILON)) return null;
  return normalizeAngleDeg((Math.atan2(across, along) * 180) / Math.PI);
}
