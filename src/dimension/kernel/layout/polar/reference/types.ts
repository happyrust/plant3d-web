/**
 * 极坐标参考系层的纯类型契约（T3.3a）。
 *
 * 本层是 PML `polarsystem.getDetail` / `polarsystem.getresult` 的「可注入化」抽象：
 * PML 把参考系写死在 `polarsystem` 对象成员里（`polarsystem.pmlobj:70-110` 声明
 * `pos` / `dir` / `ori` / `basicRadius` / `limitMinDis` / `limitMaxDis` /
 * `horidir` / `showdir` / `mainDimDir` / `lookangle` / `isinstpipe`），构造时由
 * `polarsystem.pmlobj:136-149` 落值，随后 `polarsystem.pmlobj:151-345` 的
 * `getDetail` 算出 `horidir` / `showdir` / `ori`（有效语句到 `:293` 的 `return`，
 * 之后是注释掉的旧分支），再由
 * `polarsystem.pmlobj:2420-2539` 的 `getresult` 把
 * `(gooddis, goodangle, goodradius, needs, isdim)` 换成 `goodpos` + `textori`。
 * 这里把这套状态拆成「参考系值」+「已占用区间盒」，让放置算法不再依赖全局对象。
 *
 * 两种实现共用同一份类型，所以 `showDir` 与 `plane` 都是**值**而不是常量：
 *
 * - 2D 轴测参考系（`isoSheet.ts`，T3.3b）：`showDir` 由 `getDetail` 的
 *   `lookangle` 在极坐标弧上取定（`polarsystem.pmlobj:277-280`
 *   `arc.angledirection(!lookupangle)`），一旦算完就不再变，逐值等价 PML。
 * - 3D 相机参考系（`camera.ts`，T3.3c）：`showDir` 每帧从相机矩阵派生，并带
 *   滞回（进入 `<1°` 才切换、偏离 `>3°` 才更新），且参考系挂在**实例**上而不是
 *   模块上，因此实现方每帧构造新实例；整个类型是 `Readonly`，替换而非改写。
 *
 * 本文件**只定义类型**，不含任何运行时值。实现在 `isoSheet.ts`（T3.3b）与
 * `camera.ts`（T3.3c）；barrel 留给 T3.4。
 *
 * 角度约定沿用 PML 的极坐标弧：`object arc(pos, ori, 0, 360, basicRadius, true)`
 * （`getpolarelement.pmlobj:82`），角度从 `ori.xdir`（= `showdir`）起、绕
 * `ori.zdir`（= 管轴 `dir`）正向转（`polarsystem.pmlobj:289`
 * `!this.ori = x is $!this.showdir and z is $!this.dir`）。
 */

import type { Vec3 } from '../../../types';

/**
 * 一个点在极坐标里的三轴分解（PML `getpolarelement.getOnePointData` 的返回三元组，
 * `getpolarelement.pmlobj:206-221`）。
 *
 * PML 原文按 `[dis, angle, radius]` 顺序 append，字段顺序与之一致：
 * `dis = suidirdis(line.startposition, line.direction(), pos)`、
 * `radius = line.distance(pos)`、`angle = arc.near(pos)`。
 */
export type PolarCoords = Readonly<{
  /** 沿管轴 `axis` 的距离（PML `dis`），单位米。 */
  dis: number;
  /** 极坐标弧上的角度，度，`[0, 360)`（PML `angle`）。 */
  angle: number;
  /** 到管轴的垂直距离（PML `radius`），单位米。 */
  radius: number;
}>;

/**
 * 极坐标弧所在的平面与角度零点。
 *
 * PML 里这个平面不是独立对象，而是从 `ori` 里借两根轴：弧用
 * `object arc(pos, ori, 0, 360, basicRadius, true)` 造
 * （`getpolarelement.pmlobj:88`），`ori` 由
 * `polarsystem.pmlobj:289` 定成 `x is showdir and z is dir`；`getresult`
 * 里同样以 `object arc(!this.pos,!this.ori,0,360,1000,true)` 取
 * `outdir = arc.angledirection(goodangle)`（`polarsystem.pmlobj:2421-2422`）。
 * 所以平面由「角度零点方向」+「绕向轴」两根单位向量定死。
 */
export type PolarPlane = Readonly<{
  /** 角度零点方向（PML `ori` 的 xdir，即 `showdir`），单位向量。 */
  zero: Vec3;
  /** 绕向轴（PML `ori` 的 zdir，即管轴 `dir`），单位向量。 */
  normal: Vec3;
}>;

/**
 * 极坐标参考系，本层的核心接口（PML `polarsystem` 的成员子集，
 * 声明见 `polarsystem.pmlobj:70-110`，落值见 `polarsystem.pmlobj:136-149`）。
 *
 * 同时要能表达「2D 轴测参考系」（固定 `showDir`，逐值等价 PML）与
 * 「3D 相机参考系」（`showDir` 每帧变、带滞回、挂实例不挂模块），
 * 因此所有可变部分都放在值里，整个类型 `Readonly`。
 */
export type PolarReference = Readonly<{
  /** 轴向原点（PML `polarsystem.pos`），Design Space 米。 */
  origin: Vec3;
  /** 管轴方向（PML `polarsystem.dir`），单位向量。 */
  axis: Vec3;
  /** 极坐标弧的平面与角度零点（PML `polarsystem.ori` 的 x/z 两轴）。 */
  plane: PolarPlane;
  /** 当前观察方向（PML `polarsystem.showdir`），单位向量，`plane.normal` 的正交补内。 */
  showDir: Vec3;
  /** 主干尺寸方向（PML `polarsystem.mainDimDir`），未定则为 null。 */
  mainDimDir: Vec3 | null;
  /** 沿轴可放置范围（PML `limitMinDis`..`limitMaxDis`），米。 */
  disRange: readonly [min: number, max: number];
  /** 基准半径（PML `basicRadius`，通常取管外径一半），米。 */
  basicRadius: number;
  /** 仪表管：径向档位表走更宽松的一档（PML `isinstpipe`）。 */
  isInstPipe: boolean;
  /** 参考系来源，供诊断与 A/B 开关区分；不参与计算。 */
  kind: 'iso-sheet' | 'camera';
}>;

/**
 * 已占用空间的极坐标区间盒，对应 PML `polarElement`
 * （`polarelement.pmlobj:11-25`），由 `getpolarelement.addelement`
 * （`getpolarelement.pmlobj:174-204`）产出。
 *
 * 三个区间都是闭区间；`addelement` 对退化区间做 ±0.01 展开
 * （`getpolarelement.pmlobj:186-198`，`!tolerance = 0.01`，三个 `eq` 判断各减/加一次），
 * 所以这里的 `start === end` 是**未展开**的原始输入，展开归实现方处理。
 *
 * PML 的 `arc` / `line` 两个成员（`polarelement.pmlobj:23-24`）只是构造时的缓存，
 * 可由 `PolarReference` + `PolarPlane` 重建，故不入类型。
 */
export type PolarElement = Readonly<{
  /** 图元 id，仅用于诊断，不参与计算。 */
  id: string;
  /** PML `type`：来源图元的 objecttype（`LINDIM` / `AIDTEX` / `AIDLIN` / `AIDARC` / `AIDCIR` / `AIDPOI` / `MLABEL` / `POLARCYLI` / `POLARBOX` …）。 */
  type: string;
  /** 沿轴区间，米（PML `startdis`..`enddis`）。 */
  dis: readonly [start: number, end: number];
  /** 角度区间，度，允许跨界（`start > end` 表示绕 0 度）（PML `startangle`..`endangle`）。 */
  angle: readonly [start: number, end: number];
  /** 径向区间，米（PML `startradius`..`endradius`）。 */
  radius: readonly [start: number, end: number];
  /** 管本体或构件本体：为 true 时其引线不参与避让（PML `basic`）。 */
  basic: boolean;
}>;
