/**
 * 3D 相机参考系（T3.3c）：把 PML `polarsystem` 的 `showdir` 从当前相机矩阵派生，
 * 并带滞回，让极坐标放置层在自由透视相机下也能工作。
 *
 * ## 为什么需要这一层
 *
 * PML 的极坐标参考系把 `showdir` 当成「观察方向在垂直于管轴平面上的投影方向」：
 *
 * - `polarsystem.pmlobj:265-273` 先取 `horidir.orthogonal(u)`，再用
 *   `if !tempdir.angle(!this.dir) le 90 then !tempdir = !this.dir else !tempdir = !this.dir.opposite()`
 *   把绕向轴修到与管轴同侧，然后
 *   `:277` 造 `object arc(!this.pos, object orientation('X is $!horidir and z is $!tempdir'), 0, 360, 1000, true)`
 *   —— 弧的 xdir（角度零点）就是 `showdir`，zdir 与管轴平行，所以 **`showdir` 必须正交于 `dir`**；
 * - `:280` `!this.showdir = !arc.angledirection(!lookupangle)` 用固定 `lookangle` 在弧上取定；
 * - `:283` 管轴接近竖直（`dir.angle(u)` 在 10°..170° 之外）时直接 `showdir = horidir`；
 * - `:289` `!this.ori = x is $!this.showdir and z is $!this.dir` 把这对正交方向钉成弧的平面。
 *
 * `lookangle` 是 2D 轴测图上的常量，透视相机下「观察方向」每帧都变，所以这一层把
 * `lookangle` 换成「相机 `forward` 在管轴垂直平面上的投影」，并加滞回避免标注在
 * 相机微动时来回跳格。
 *
 * ## 符号约定（与 `forward` 同向，不取反）
 *
 * `showDir` 取 `forward` 在平面内的分量本身，即「从观察者看向场景」的方向。
 *
 * PML 的 2D 路径里确实有两处翻转，但都不是「观察方向」的符号定义，故不搬：
 *
 * - `polarsystem.pmlobj:227-238`：`horidir` 与上一帧 `prehoridir` 夹角 `< 45°` 或 `> 135°`
 *   时沿用上一帧，且 `> 135°` 时取反——这是**2D 图纸的帧间连续性规则**，正是本文件
 *   `hysteresisShowDir` 用显式滞回带替代的东西（阈值从 45°/135° 收到 1°/3°）；
 * - `polarsystem.pmlobj:240-248`：`horidir.angle(branlookdirection) < 90` 时取反——那是
 *   把弧零点摆到分支视线一侧的**图纸排版规则**，与「相机朝哪看」无关。
 *
 * 真正与「朝向可见性」相关的取舍在 `polarsystem.pmlobj:2450-2463`：`getresult` 用
 * `outdir.angle(showdir) < 90` 判断文字方向要不要翻（`:2452-2457`）。那是**文字**方向的
 * 修正，消费的是 `showDir` 的符号，所以不能在同一层再翻一次（双重取反会抵消）。背向
 * 候选的惩罚留给候选打分层（T3.5），本层只如实反映相机。
 *
 * ## 不可变性
 *
 * `PolarReference` 全 `Readonly`；`cameraReference` 每帧返回**新对象**，绝不改写传入的
 * `previous`（参考系挂在实例上而不是模块上，替换而非就地改）。
 */

import { dot3, length3, scale3, sub3, tryNormalize3 } from '../../../vec';
import { orthogonal } from '../numeric/isoDirections';

import type { PolarReference } from './types';
import type { ViewportProjector } from '../../../projector';
import type { Vec3 } from '../../../types';

/**
 * 「相机几乎沿管轴看」的判定阈值：`forward` 在垂直平面上的**残余长度**下限。
 *
 * 参与比较的两个向量都已单位化，所以残余长度
 * `|forward - axis * dot(forward, axis)| === sin(forward 与 axis 的夹角)`。
 * 取 `1e-3` 相当于夹角约 `0.0573°`：
 *
 * - 再小下去，单位化的放大倍数是 `1 / sin(θ)`，θ = 1e-4 rad 时已经放大 1e4 倍，
 *   浮点噪声（双精度约 1e-16 相对误差）会被放大到 1e-12 级——方向本身仍然可算，
 *   但它的**角位置**在弧上会抖，且 `showDir` 的物理含义已经退化（贴着管轴看，
 *   平面内的「上下左右」由相机 roll 决定而不是由视线决定）；
 * - 再大就会把正常斜视（比如 0.5° 的偏心视角）误判成退化，丢掉本可用的方向。
 *
 * 命中阈值时返回 `null` 而不是随便给一个方向：调用方必须保留上一帧的 `showDir`
 * （见 `hysteresisShowDir` 的 `candidate === null` 分支）。
 */
const PARALLEL_SIN_EPSILON = 1e-3;

/** 滞回进入阈值默认值（度）：与上一帧夹角小于它就直接采纳候选。 */
export const DEFAULT_ENTER_DEG = 1;

/** 滞回退出阈值默认值（度）：与上一帧夹角达到它就切换。 */
export const DEFAULT_EXIT_DEG = 3;

/** 退化兜底第一选择：世界上方（`PML` 里的 `u`）。 */
const WORLD_UP: Vec3 = [0, 0, 1];

/** 退化兜底第二选择：世界北向（`PML` 里的 `n`）。 */
const WORLD_NORTH: Vec3 = [0, 1, 0];

/** 退化兜底最后选择（理论上不可达：单位向量不可能同时平行于上方与北向）。 */
const WORLD_EAST: Vec3 = [1, 0, 0];

/** 两方向的**无向**夹角，度，`[0, 180]`；任一向量退化时返回 `NaN`。 */
function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const lengthA = length3(a);
  const lengthB = length3(b);
  if (!(lengthA > 0) || !(lengthB > 0)) return Number.NaN;
  const cosine = dot3(a, b) / (lengthA * lengthB);
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

/** 把方向投到「垂直于 `unitAxis`」的平面上并单位化；退化时 `null`。 */
function projectOntoAxisPlane(direction: Vec3 | null, unitAxis: Vec3): Vec3 | null {
  if (!direction) return null;
  const unit = tryNormalize3(direction);
  if (!unit) return null;
  const along = dot3(unit, unitAxis);
  return tryNormalize3(sub3(unit, scale3(unitAxis, along)));
}

/**
 * 相机派生 `showDir`：`forward` 在垂直于 `axis` 平面上的投影，单位向量。
 *
 * - `axis` 或 `projector.forward` 退化（长度 `<= EPSILON`）→ `null`；
 * - 相机几乎沿管轴看（残余长度 `<= PARALLEL_SIN_EPSILON`，约 0.057°）→ `null`，
 *   调用方必须保留上一帧的 `showDir`（平面内的方向已由相机 roll 而非视线决定）。
 *
 * 符号：与 `forward` 在平面内的分量**同向**（详见文件头「符号约定」）。
 */
export function cameraShowDir(projector: ViewportProjector, axis: Vec3): Vec3 | null {
  const unitAxis = tryNormalize3(axis);
  if (!unitAxis) return null;
  const unitForward = tryNormalize3(projector.forward);
  if (!unitForward) return null;

  const along = dot3(unitForward, unitAxis);
  const projected = sub3(unitForward, scale3(unitAxis, along));
  const residual = length3(projected);
  // residual === sin(forward 与 axis 的夹角)，见 PARALLEL_SIN_EPSILON 的注释。
  if (!(residual > PARALLEL_SIN_EPSILON)) return null;
  return scale3(projected, 1 / residual);
}

function assertHysteresisBand(enterDeg: number, exitDeg: number): void {
  if (!Number.isFinite(enterDeg) || !Number.isFinite(exitDeg)) {
    throw new RangeError(
      `hysteresisShowDir: enterDeg/exitDeg must be finite numbers, got ${String(enterDeg)}/${String(exitDeg)}`,
    );
  }
  if (enterDeg < 0 || exitDeg < 0) {
    throw new RangeError(
      `hysteresisShowDir: enterDeg/exitDeg must be >= 0, got ${enterDeg}/${exitDeg}`,
    );
  }
  if (enterDeg > exitDeg) {
    throw new RangeError(
      `hysteresisShowDir: enterDeg must not exceed exitDeg, got ${enterDeg} > ${exitDeg}`,
    );
  }
}

/**
 * `showDir` 的滞回选择：在「跟随相机」与「保持上一帧」之间用一个角度带隔开，
 * 避免相机微动时弧的零点每帧重排、标注在屏幕上来回跳。
 *
 * 判定（`angle` = `previous` 与 `candidate` 的**无向**夹角，度）：
 *
 * | 情形 | 返回 |
 * | --- | --- |
 * | `previous === null` | `candidate`（无历史，直接采用） |
 * | `candidate === null` | `previous`（相机沿轴看，保持上一帧） |
 * | `angle < enterDeg` | `candidate`（方向没变，采纳候选让微小漂移跟上） |
 * | `angle >= exitDeg` | `candidate`（明显变化，切换） |
 * | `enterDeg <= angle < exitDeg` | `previous`（滞回带内，保持） |
 *
 * ## 反平行（179° → 0° 的跳变）
 *
 * `previous` 与 `candidate` 夹角接近 180° 时（相机绕过管轴背面），夹角会在 179° 与
 * 0° 之间跳变——`showDir` 也随之翻转，弧的零点整圈移位，屏幕上表现为标注突然换边。
 * 本函数**不处理**这个不连续：夹角 ≈ 180° 落入 `angle >= exitDeg` 分支，直接返回
 * `candidate`，即如实反映相机的真实运动。理由：
 *
 * - 在这一层做插值或符号修正会掩盖真实的相机运动，让「标注跳到管子另一侧」这类
 *   现象查不出来；
 * - 正确的处理是**候选打分**：绕管一周的候选里背向观察者的那些应当加罚，由 T3.5 的
 *   摆放层在 `showDir` 翻转后选到视觉上等价的那一支。
 *
 * 夹角公式用 `acos` 折到 `[0, 180]`，所以「反平行」与「同向」不会被混为一谈：同向是
 * 0°，反平行是 180°，两者走不同分支。
 *
 * @param enterDeg 进入阈值（度），必须有限、`>= 0` 且 `<= exitDeg`，否则 `RangeError`。
 * @param exitDeg 退出阈值（度），必须有限、`>= 0`，否则 `RangeError`。
 */
export function hysteresisShowDir(
  previous: Vec3 | null,
  candidate: Vec3 | null,
  enterDeg: number,
  exitDeg: number,
): Vec3 | null {
  assertHysteresisBand(enterDeg, exitDeg);
  if (!previous) return candidate;
  if (!candidate) return previous;

  const angle = angleBetweenDeg(previous, candidate);
  // 防御：调用方传进来的向量若退化（长度 0），夹角无定义，按「明显变化」处理。
  if (!Number.isFinite(angle)) return candidate;
  if (angle < enterDeg) return candidate;
  if (angle >= exitDeg) return candidate;
  return previous;
}

/**
 * 退化兜底：拿不到任何观察方向时（无历史且相机正沿管轴看），按「先与世界上方叉积、
 * 平行则换北向、都平行则用 `[1,0,0]`」造一个与管轴正交的单位方向。
 *
 * **这是退化输入**：结果与相机的 roll 无关，只是让参考系保持合法（弧平面存在、
 * 角度零点有定义），不代表任何「最佳观察角」。`[1,0,0]` 一支理论上不可达——单位向量
 * 不可能同时平行于 `[0,0,1]` 与 `[0,1,0]`——保留它只为让返回值类型封闭。
 */
function degenerateShowDir(unitAxis: Vec3): Vec3 {
  return orthogonal(unitAxis, WORLD_UP) ?? orthogonal(unitAxis, WORLD_NORTH) ?? WORLD_EAST;
}

/** `cameraReference` 的入参。 */
export type CameraReferenceInput = Readonly<{
  /** 当前视口投影器，只读 `forward`（相机朝向，从相机指向场景）。 */
  projector: ViewportProjector;
  /** 轴向原点（PML `polarsystem.pos`），Design Space 米。 */
  origin: Vec3;
  /** 管轴方向（PML `polarsystem.dir`），内部会单位化；退化时 `RangeError`。 */
  axis: Vec3;
  /** 沿轴可放置范围（PML `limitMinDis`..`limitMaxDis`），米。 */
  disRange: readonly [min: number, max: number];
  /** 基准半径（PML `basicRadius`），米。 */
  basicRadius: number;
  /** 仪表管（PML `isinstpipe`）。 */
  isInstPipe: boolean;
  /** 上一帧的参考系，用于滞回与 `candidate === null` 兜底；首帧传 `null`。 */
  previous: PolarReference | null;
  /** 滞回进入阈值（度），默认 `DEFAULT_ENTER_DEG`。 */
  enterDeg?: number;
  /** 滞回退出阈值（度），默认 `DEFAULT_EXIT_DEG`。 */
  exitDeg?: number;
}>;

/**
 * 组装 3D 相机参考系：`showDir` 由相机派生 + 滞回，`plane` 由 `showDir` 与管轴钉成，
 * `kind` 固定 `'camera'`，`mainDimDir` 留给 T3.4。
 *
 * 步骤：
 *
 * 1. `axis` 单位化（退化抛 `RangeError`：没有管轴就构不成弧的绕向轴）；
 * 2. `candidate = cameraShowDir(projector, axis)`；
 * 3. `showDir = hysteresisShowDir(previous?.showDir ?? null, candidate, enterDeg, exitDeg)`；
 * 4. 把结果重新投影到「垂直于新管轴」的平面并单位化——帧间管轴若漂移，`previous.showDir`
 *    就不再严格正交于新轴，而 `plane.zero ⟂ plane.normal` 是本层必须维持的不变量
 *    （`polarsystem.pmlobj:265-273` 要求 `showdir` 正交于 `dir`）。管轴不变时这一步是
 *    恒等变换，不改变任何已算出的值；
 * 5. 仍拿不到方向 → 退化兜底 `degenerateShowDir`；
 * 6. 返回**新对象**，`previous` 一个字段都不改。
 */
export function cameraReference(input: CameraReferenceInput): PolarReference {
  const { projector, origin, axis, disRange, basicRadius, isInstPipe, previous } = input;
  const enterDeg = input.enterDeg ?? DEFAULT_ENTER_DEG;
  const exitDeg = input.exitDeg ?? DEFAULT_EXIT_DEG;

  const unitAxis = tryNormalize3(axis);
  if (!unitAxis) {
    throw new RangeError('cameraReference: axis must be a finite non-zero vector');
  }

  const candidate = cameraShowDir(projector, unitAxis);
  const held = hysteresisShowDir(previous?.showDir ?? null, candidate, enterDeg, exitDeg);
  const showDir = projectOntoAxisPlane(held, unitAxis) ?? degenerateShowDir(unitAxis);

  return {
    origin,
    axis: unitAxis,
    plane: { zero: showDir, normal: unitAxis },
    showDir,
    mainDimDir: null,
    disRange: [disRange[0], disRange[1]] as const,
    basicRadius,
    isInstPipe,
    kind: 'camera',
  };
}
