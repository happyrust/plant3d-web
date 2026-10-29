/**
 * 2D 轴测参考系（T3.3b）：PML `polarsystem.getDetail` 的逐值等价移植。
 *
 * 输入是一组构造参数（PML `polarsystem` 的成员，声明见 `polarsystem.pmlobj:100-109`，
 * 落值见 `polarsystem.pmlobj:112-149`），输出是 `PolarReference`。PML 把结果写回
 * `this.horidir` / `this.showdir` / `this.ori`（`polarsystem.pmlobj:252` / `:280` /
 * `:283` / `:289`），这里改成返回值，方便 T3.4 的放置层无状态调用。
 *
 * 有效语句只到 `polarsystem.pmlobj:293` 的 `return`；`:294-345` 的 `$(` 块是注释掉的
 * 旧分支。`getMainDimDir` 在 `:292` 被注释，故 `mainDimDir` 恒为 null（移植它属 T3.4）。
 *
 * 世界轴：AVEVA 设计空间是 E/N/U = X/Y/Z。依据 `src/measurement/kernel/threePointAngle.ts`
 * 文件头「All coordinates are design-world metres (X=E, Y=N, Z=U)」，同仓
 * `src/dimension/kernel/geometry/planeBasis.ts:11` 也把 `[0, 0, 1]` 当世界竖直参考轴。
 * 因此 `u = [0, 0, 1]`、`n = [0, 1, 0]`、`d = [0, 0, -1]`（`d` 本函数不用，列出备查）。
 */

import { cross3, dot3, length3, tryNormalize3 } from '../../../vec';
import { orthogonal } from '../numeric';

import type { PolarReference } from './types';
import type { Vec3 } from '../../../types';

/** 世界竖直向上（PML `u`）。依据见文件头。 */
const WORLD_UP: Vec3 = [0, 0, 1];
/** 世界正北（PML `n`）。依据见文件头。 */
const WORLD_NORTH: Vec3 = [0, 1, 0];

/**
 * 退化输入的最后兜底方向。
 *
 * `orthogonal` 在 `a × b` 长度小于 `EPSILON` 时返 null（`numeric/isoDirections.ts:36-37`），
 * PML 会抛错并由 `handle any` 兜住（`isoGetDimDir.pmlfnc:7-8`）。本函数返回
 * `PolarReference` 而不是 `| null`，所以必须给出确定值：
 *
 * 1. `axis` 与 `u` 平行（竖直管）→ 改用 `n` 作参考轴，得 `[-1, 0, 0]`
 *    （`cross(u, n) = [-1, 0, 0]`）。这是唯一有几何意义的兜底：竖直管的「水平方向」
 *    只能由水平参考轴定，PML 在 `referencedirs` 为空时对竖直管本身是崩溃/未定义的
 *    （`:154` 的 `trydir` 抛错后 `horidir` 保持未赋值，`:228` 再调用会二次抛错）。
 * 2. `axis` 与 `u`、`n` 都平行 → 不可能同时成立（`u ⟂ n`），只剩 `axis` 为零向量一种
 *    情况（已在 `isoSheetReference` 入口用 `WORLD_UP` 顶替），故本常量只作类型兜底。
 */
const DEGENERATE_HORIDIR: Vec3 = [1, 0, 0];

/** 两方向夹角（度），对应 PML `DIRECTION.angle`，值域 `[0, 180]`。 */
function angleDeg(a: Vec3, b: Vec3): number {
  const cosine = dot3(a, b) / (length3(a) * length3(b));
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

/** `0 - v` 而不是 `-v`，免得 0 分量变成 -0（PML `direction.opposite()`）。 */
function opposite(v: Vec3): Vec3 {
  return [0 - v[0], 0 - v[1], 0 - v[2]];
}

/** PML `polarsystem.getDetail` 依赖的构造参数子集（`polarsystem.pmlobj:100-149`）。 */
export type IsoSheetParams = Readonly<{
  /** PML `this.pos`（`:137` `!this.pos = !startpos`），Design Space 米。 */
  origin: Vec3;
  /** PML `this.dir`（`:138` `!this.dir = !startpos.direction(!endpos)`），单位向量。 */
  axis: Vec3;
  /** PML `limitMinDis`..`limitMaxDis`（`:139-140`），米。 */
  disRange: readonly [min: number, max: number];
  /** PML `this.basicRadius`（`:141`）。 */
  basicRadius: number;
  /** PML `this.isinstpipe`（`:147`）。 */
  isInstPipe: boolean;
  /** PML `this.lookangle`（`:144`），度；调用方通常传 30 或 90。 */
  lookAngleDeg: number;
  /** PML `this.referencedirs`（`:113` / `:122`），可空数组。 */
  referenceDirs: readonly Vec3[];
  /** PML `this.prehoridir`（`:114-116`）；null 表示 PML 的 `.set()` 为假（未设）。 */
  preHoriDir: Vec3 | null;
  /** PML `this.branlookdirection`（`:129`）；null 表示未设。 */
  branchLookDirection: Vec3 | null;
  /**
   * PML `this.fromltor`（`:133`），三态：null = 未设（`.set()` 为假，整段跳过）、
   * true / false = 已设。PML 只关心「已设且为假」这一种（`:244-247`）。
   */
  fromLeftToRight: boolean | null;
  /**
   * PML `getDetail` 的 `cenpos` 形参（`:151`）。
   *
   * 有效语句里**没有**用到它：唯一引用在 `:202` / `:295`，两处都在 `--$(` 注释块内。
   * 保留字段是为了让 T3.4 能把完整构造上下文透传，且未来移植 `getMainDimDir` 时要它。
   */
  centrePos: Vec3;
  /** PML `getDetail` 的 `midpos` 形参（`:151`，由 `:148` 传入 `startpos.midpoint(endpos)`），同上未用。 */
  midPos: Vec3;
}>;

/**
 * PML `arc.angledirection(θ)` 在「`x = xAxis`、`z = zAxis`」朝向的弧上取 θ 处的切线方向。
 *
 * 手性依据（仓库内已有同约定实现，符号与手性由它们交叉验证）：
 * - `src/dimension/kernel/geometry/planeBasis.ts:22-31`：平面基 `u = normalize(ref × n)`、
 *   `v = normalize(n × u)`，即 `v = n × u`，右手系 `(u, v, n)`。
 * - `src/dimension/adapters/mbdV2ExternalAnnotations.ts:694-701`（`arcTangent`）：
 *   切向 = `-u·sin θ + v·cos θ`，注释写明「Counter-clockwise tangent (about `normal`)」。
 *
 * 套到 PML 的 `orientation('X is horidir and z is tempdir')`（`:277`）：
 * `u = xAxis`、`normal = zAxis`、`v = normalize(zAxis × xAxis)`，
 * 故 `angledirection(θ) = normalize(-xAxis·sin θ + v·cos θ)`。
 *
 * 正交化（关键）：`xAxis`（= `horidir`）与 `zAxis`（= ±`dir`）**不一定正交**
 * （`horidir` 来自 `tempdir.orthogonal(u)`，只保证 ⟂ `u`）。PML `orientation`
 * 构造器对非正交输入会重建成正交系，且本函数的语义要求 z 轴固定为 `±dir`
 * ——`:268` / `:274` 的注释「ensure the showdir is orthogonal the zdir of orientation
 * of this s/e 202306281001」正是为此，且 `:269-273` 已把 `tempdir` 钉到 `±dir`。
 * 因此按「z 优先」正交化：`x' = normalize(x - (x·z)z)`。这样切向恒 ⟂ `z = ±dir`，
 * 满足 `PolarReference` 里 `showDir` 落在 `plane.normal` 的正交补内的契约。
 * （若按 x 优先正交化，`z` 被改动就不再等于管轴，`:269-273` 那段钉 z 的代码失去意义。）
 */
function arcTangentDegrees(xAxis: Vec3, zAxis: Vec3, angle: number): Vec3 {
  const radians = (angle * Math.PI) / 180;
  const projection = dot3(xAxis, zAxis);
  const orthoX = tryNormalize3([
    xAxis[0] - zAxis[0] * projection,
    xAxis[1] - zAxis[1] * projection,
    xAxis[2] - zAxis[2] * projection,
  ]) ?? DEGENERATE_HORIDIR;
  const yAxis = tryNormalize3(cross3(zAxis, orthoX)) ?? DEGENERATE_HORIDIR;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const tangent: Vec3 = [
    yAxis[0] * cos - orthoX[0] * sin,
    yAxis[1] * cos - orthoX[1] * sin,
    yAxis[2] * cos - orthoX[2] * sin,
  ];
  return tryNormalize3(tangent) ?? DEGENERATE_HORIDIR;
}

/**
 * `polarsystem.pmlobj:157-196` 的 `horidir` 初值。
 *
 * - `:157-182`：`referencedirs` 非空时逐个试，取第一个「与 `u` 夹角落在
 *   `(30°, 150°)` 内」的方向（`abs(angle(u) - 90) < 60`），用 `tempdir.orthogonal(u)`
 *   作 `horidir` 并 `golabel /horidirok` 跳出。
 * - `:183-196` `elsehandle none`：`horidir = dir.orthogonal(u)`。
 *
 * 注：`:154` 的 `!trydir = !this.dir.orthogonal(u)` 在 `handle any` **之外**，是全函数里
 * 唯一一处 `trydir`，结果再未被读取——PML 的死赋值，这里不移植（`handle any` 的作用
 * 只剩「竖直管时整个 `:157-196` 块被跳过、`horidir` 保持未赋值」，见下方兜底说明）。
 */
function initialHorizontalDir(params: IsoSheetParams, axis: Vec3): Vec3 {
  for (const tempdir of params.referenceDirs) {
    if (Math.abs(angleDeg(tempdir, WORLD_UP) - 90) < 60) {
      // 条件已排除 tempdir ∥ u，orthogonal 不会返 null；仍按契约兜底。
      return orthogonal(tempdir, WORLD_UP) ?? fallbackHorizontalDir(axis);
    }
  }
  return fallbackHorizontalDir(axis);
}

/** 竖直管（`axis ∥ u`）兜底：改用 `n` 作参考轴，二者皆平行时用常量。见 `DEGENERATE_HORIDIR`。 */
function fallbackHorizontalDir(axis: Vec3): Vec3 {
  return orthogonal(axis, WORLD_UP)
    ?? orthogonal(axis, WORLD_NORTH)
    ?? DEGENERATE_HORIDIR;
}

/**
 * PML `polarsystem.getDetail`（`polarsystem.pmlobj:151-292`）的逐值等价实现：
 * 构造参数 → `PolarReference`。
 *
 * 语句映射：
 * - `:157-196` → `initialHorizontalDir`
 * - `:201-223` → 整段跳过：包在 `--$(` / `--$)` 里，是注释掉的旧分支
 * - `:225-238` → `prehoridir` 滞后；命中 `angle < 45 || angle > 135` 时
 *   `golabel /sethoridirok`（`:236`）**跳过**下面的 `branlookdirection` / `fromltor` 分支
 * - `:240-248` → `branlookdirection` 优先，否则 `fromltor`
 * - `:250-252` → `this.horidir = horidir`
 * - `:258-284` → 非水平/非竖直管在弧上取 `lookangle` 处切向作 `showdir`
 * - `:289` → `ori = x is showdir and z is dir`
 */
export function isoSheetReference(params: IsoSheetParams): PolarReference {
  // PML `dir` 由 `direction()` 产生、已归一；零长度输入用世界竖直顶替，保证
  // `plane.normal` 满足 PolarReference 的单位向量契约。
  const axis = tryNormalize3(params.axis) ?? WORLD_UP;

  let horidir = initialHorizontalDir(params, axis);

  // `:227-238`
  if (params.preHoriDir !== null) {
    const preAngle = angleDeg(horidir, params.preHoriDir);
    if (preAngle < 45 || preAngle > 135) {
      if (preAngle > 135) horidir = opposite(horidir);
      // `:236` golabel /sethoridirok：跳过 `:240-248`
      return buildReference(params, axis, horidir);
    }
  }

  // `:240-248`
  if (params.branchLookDirection !== null) {
    if (angleDeg(horidir, params.branchLookDirection) < 90) horidir = opposite(horidir);
  } else if (params.fromLeftToRight !== null) {
    if (!params.fromLeftToRight) horidir = opposite(horidir);
  }

  return buildReference(params, axis, horidir);
}

/** `:250-289`：由 `horidir` 定 `showdir` 与 `ori`，并组装 `PolarReference`。 */
function buildReference(
  params: IsoSheetParams,
  axis: Vec3,
  horidir: Vec3,
): PolarReference {
  const axisAngle = angleDeg(axis, WORLD_UP);

  // `:259`：`10 < tempangle < 170` 才走弧分支；竖直管（0°）与倒立管（180°）走 else。
  let showDir: Vec3;
  if (axisAngle > 10 && axisAngle < 170) {
    // `:265` `!tempdir = !horidir.orthogonal(u)`，`:269-273` 再把 z 轴钉到 ±dir 上，
    // 保证 showdir 与管轴正交（注释 `:268` / `:274` 的 202306281001 修正）。
    const tempdirRaw = orthogonal(horidir, WORLD_UP) ?? axis;
    const tempdir = angleDeg(tempdirRaw, axis) <= 90 ? axis : opposite(axis);
    // `:277-280` `arc = object arc(pos, orientation('X is horidir and z is tempdir'), 0, 360, 1000, true)`
    //           `showdir = arc.angledirection(lookupangle)`
    showDir = arcTangentDegrees(horidir, tempdir, params.lookAngleDeg);
  } else {
    // `:282-283`
    showDir = horidir;
  }

  return {
    origin: [params.origin[0], params.origin[1], params.origin[2]],
    axis,
    // `:289` `!this.ori = x is $!this.showdir and z is $!this.dir`
    plane: { zero: showDir, normal: axis },
    showDir,
    // `:292` `--!this.getMainDimDir()` 被注释掉，故恒 null（移植归 T3.4）。
    mainDimDir: null,
    disRange: [params.disRange[0], params.disRange[1]],
    basicRadius: params.basicRadius,
    isInstPipe: params.isInstPipe,
    kind: 'iso-sheet',
  };
}
