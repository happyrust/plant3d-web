/**
 * 极坐标放置层的输入输出契约（T3.4a），供 T3.4b 的 `place.ts` / `balance.ts` /
 * `getdiseles` 使用。
 *
 * 字段命名对齐 PML `polarsystem.getBestPosAndOri`
 * （`polarsystem.pmlobj:1028-1296`）与 `getresult`（`:2420-2539`）的中间量：
 *
 * - `score` = `:1220` 的 `weightedweight(dirangle[2], disradiusarr[x][1], havelead, needs[2])`；
 * - `dis` / `angle` / `radius` = `:1253` / `:1255` / `:1256` 的 gooddis / goodangle / goodradius；
 * - `dir` = `:1249` 的 bestdir；
 * - `disIndex` / `radiusIndex` = `:1165` 的 disindex 与 `:1250` 的 level；
 * - `haveLead` = `:1208` / `:1211` 的 havelead；
 * - `pos` / `textOri` = `:2515` / `:2513` 的 goodpos 与 textori。
 *
 * 长度一律是**米**（PML 是毫米），角度一律是**度**。
 */

import type { Vec3 } from '../../../types';
import type { PolarElement, PolarReference } from '../reference/types';

/** PML `textori = y is chardir and x is xdir`（`:2513`）的正交三轴，右手系 `z = x × y`。 */
export type PolarTextOrientation = Readonly<{
  x: Vec3;
  y: Vec3;
  z: Vec3;
}>;

/**
 * 一个候选摆放。PML 只在 Step 13 之后留下排好序的 `alldisbests`
 * （`:1264-1269` / `:1274-1282`），这里保留完整候选，供降级路径与屏幕校验使用。
 */
export type PolarCandidate = Readonly<{
  /** 加权代价，越小越好（`:1220` weightedweight 的返回值）。 */
  score: number;
  /** 沿轴位置，米（`:1253`）。 */
  dis: number;
  /** 极坐标角度，度，`[0, 360)`（`:1255`）。 */
  angle: number;
  /** 到轴线的径向距离，米（`:1256`）。 */
  radius: number;
  /** 放置方向（`:1249` bestdir）。 */
  dir: Vec3;
  /** 所属轴向单元下标（`:1165` disindex，0 基）。 */
  disIndex: number;
  /** 所属径向单元下标（`:1250` level，0 基）。 */
  radiusIndex: number;
  /** 该径向单元是否因引线冲突被二次评估（`:1208`）。 */
  haveLead: boolean;
  /** 标注锚点，米（`:2515` goodpos）。 */
  pos: Vec3;
  /** 文字坐标系（`:2513` textori）。 */
  textOri: PolarTextOrientation;
  /** `solved` = Step 8-13 找到；`fallback` = Step 14 兜底（`:1289-1291`）。 */
  source: 'solved' | 'fallback';
}>;

/** 每个轴向单元的最优候选摘要（`:1264-1269` 每轮 append 的三元组 + 下标）。 */
export type PolarPerDisBest = Readonly<{
  disIndex: number;
  score: number;
  dis: number;
  angle: number;
  radius: number;
}>;

/** 诊断信息：给 T3.5 的屏幕校验与 A/B 开关用，不参与计算。 */
export type PolarPlaceDiagnostics = Readonly<{
  /** 是否走了 Step 14 兜底（`:1289-1291`）。 */
  usedFallback: boolean;
  /** 轴向单元数量（`:1049` splitrange 之后）。 */
  disRangeCount: number;
  /** 每个轴向单元的径向单元数量（`:1173-1176` 的 disradiusarr）。 */
  radiusBandCounts: readonly number[];
  /** 是否因 `isdim && mainDimDir` 走了 `:586-595` 的强制方向分支。 */
  forcedMainDimDir: boolean;
}>;

/** 放置结果：`best` 是 `candidates[0]`，`candidates` 已按 score 升序。 */
export type PolarPlaceResult = Readonly<{
  best: PolarCandidate;
  candidates: readonly PolarCandidate[];
  perDisBest: readonly PolarPerDisBest[];
  diagnostics: PolarPlaceDiagnostics;
}>;

/**
 * PML `needs` 三元组（`:462-465` 由 easy way 1 构造，`:500-506` 由 polarelement 构造）：
 * `needs[1]` = needdis（`mbdtextlen(text) × cheight`）、`needs[2]` = needangle（固定 30）、
 * `needs[3]` = needradius（`cheight`）。
 *
 * `getresult` 只读 `needs[3]`（`:2515` 的 `- needs[3] / 2`），别处用它做径向档位步长。
 */
export type PolarNeeds = readonly [needDis: number, needAngle: number, needRadius: number];

/**
 * PML 里写死在函数体中的阈值（3D 下可能失效，见各字段注释）。全部可选，
 * 缺省值即 PML 默认值；T3.5 的像素净空换算会通过这里注入。
 */
export type PolarPlaceOverrides = Readonly<{
  /** `:1776` `!tolerance = 45`：`normalanglerange` 的固定角窗半宽，度。 */
  angleToleranceDeg?: number;
  /** `:1619` `!notbestplusangle = 30`：非首选方向的角偏差罚值，度。 */
  notBestPlusAngleDeg?: number;
  /** `:2558` / `:2424` 的 `10` / `170` 判定竖直管的角度容差，度。 */
  verticalToleranceDeg?: number;
  /** `:2451` `abs(!tempangle - 90) lt 5`：chardir 翻转判定的垂直容差，度。 */
  charDirVerticalToleranceDeg?: number;
  /** `:2499` `abs(!tempangle - 90) lt 1`：textori 退化判定的容差，度。 */
  textOriDegenerateToleranceDeg?: number;
  /** `:1717` `lt 0.1` / `:1719` `gt 179`：`getDirAndCha` 第三段的角区间退化判定，度。 */
  angleEpsilonDeg?: number;
}>;

/** 放置层入参（PML 的五种 `getBestPosAndOri` 重载收敛成一份）。 */
export type PolarPlaceParams = Readonly<{
  /** 参考系（PML `this.pos` / `this.dir` / `this.ori` / `this.showdir` …）。 */
  reference: PolarReference;
  /** 障碍元素（PML `this.elements`）。 */
  elements: readonly PolarElement[];
  /** 需求三元组（PML `needs`）。 */
  needs: PolarNeeds;
  /** 是否尺寸标注（PML `isdim`，影响 `:586-595` 与 textori 之外的罚值）。 */
  isDim: boolean;
  /** 是否带引线（PML `leadline`，`:1029-1033` 缺省 true）。 */
  leadLine?: boolean;
  /** 忽略线类元素（PML `ignoreline`，`:515-519` 用于 getdiseles）。 */
  ignoreLine?: boolean;
  /** easy way 1（`:437-472`）的入参走法，供 T3.4b 分派。 */
  easy?: boolean;
  /** 阈值覆盖。 */
  overrides?: PolarPlaceOverrides;
  /** 候选列表上限，防止极端场景爆量；缺省不截断。 */
  maxCandidates?: number;
}>;
