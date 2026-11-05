/**
 * 极坐标放置的屏幕空间校验层（T3.5）。
 *
 * `polarPlace`（`place/place.ts`）只在 Design Space 里打分、排序，不知道相机、
 * 不知道像素、不知道谁已经占了屏幕上的哪块地。这一层把 `PolarPlaceResult.candidates`
 * （已按 score 升序）逐个投影到像素，用 `LabelOccupancy` 的净空判据淘汰与已占用区域
 * 重叠的候选，复用 `declutterPolicy.ts` 的凸四边形分离轴算法判重叠；第一个通过的
 * 候选胜出，全部被否决时给出确定性兜底（`result.best`）与逐候选诊断。
 *
 * 不接入渲染管线、不改写 `textOri`、不自动登记 occupancy——那些都是 T3.6 的事。
 * 这里只有纯函数，不 import Vue/Three。
 *
 * ## 为什么不直接用 `LabelOccupancy.overlaps`（轴对齐矩形）
 *
 * `polarPlace` 的候选可以在任意朝向的 `textOri` 平面内（3D 相机参考系下文字框
 * 不一定与屏幕轴对齐），投影后是任意四边形，不是矩形。做法：先用四边形的轴对齐
 * 包围盒过 `LabelOccupancy`（它只存矩形，见 `collision/occupancy.ts`）筛出候选重叠的
 * 已占用矩形，再用 `convexQuadsOverlap`（`declutterPolicy.ts:72-85`）对这些矩形的
 * 四角做分离轴精确判重叠——与 `declutterOverlaps` 判两个标签是否重叠的算法完全一致，
 * 只是这里一边是文字四边形、另一边是已登记的占用矩形（退化为其四角）。
 */

import { dot3, scale3 } from '../../vec';
import { convexQuadsOverlap, quadBracketsLabel } from '../declutterPolicy';

import type { LabelOccupancy } from '../../collision/occupancy';
import type { ViewportProjector } from '../../projector';
import type { ScreenRect, Vec3 } from '../../types';
import type { Quad } from '../declutterPolicy';
import type { PolarCandidate, PolarPlaceResult } from './place/types';

/** 文字框在屏幕上的四角，像素，顺序 = `textOri` 平面内 (-w,-h) (w,-h) (w,h) (-w,h)。 */
export type Px = readonly [number, number];

/** 候选被否决的原因。 */
export type ScreenGuardRejectReason = 'overlap' | 'offscreen' | 'degenerate' | 'backfacing';

export type ScreenGuardRejection = Readonly<{
  index: number;
  reason: ScreenGuardRejectReason;
}>;

export type ScreenGuardInput = Readonly<{
  /** `polarPlace` 的输出；`result.candidates` 已按 score 升序，`best === candidates[0]`。 */
  result: PolarPlaceResult;
  projector: ViewportProjector;
  /** 文字框在 `textOri` 平面内的世界尺寸，米（整宽/整高，非半宽）。 */
  textSize: Readonly<{ widthM: number; heightM: number }>;
  /** 调用方持有、已登记其他标签占用的网格；本函数只读，不插入。 */
  occupancy: LabelOccupancy;
  /** 像素净空：候选四边形外扩这么多像素后才去比对占用，默认 `DEFAULT_CLEARANCE_PX`。 */
  clearancePx?: number;
  /** 上一帧选中的候选，用于稳定性：未被否决时优先沿用，避免逐帧跳动。 */
  previous?: PolarCandidate | null;
}>;

export type ScreenGuardResult = Readonly<{
  chosen: PolarCandidate;
  /** `chosen` 在 `result.candidates` 里的下标；全部否决时回退到 0（`result.best`）。 */
  chosenIndex: number;
  /** `chosen` 投影后的像素四边形（未外扩 `clearancePx`）。 */
  quad: Quad;
  /** 在 `chosen` 之前被否决的候选（不含 `chosen` 自身），按 `result.candidates` 的下标序。 */
  rejected: readonly ScreenGuardRejection[];
  /** 全部候选都被否决；此时 `chosen === result.best`，由调用方（T3.6）决定隐藏还是走旧路径。 */
  allRejected: boolean;
}>;

/**
 * 默认像素净空：4 px。
 *
 * `LabelOccupancy.overlapsAt`（`collision/occupancy.ts`）对落在同一网格桶里的
 * 条目做的是精确矩形相交，64 px 网格只是分桶结构，不是判定分辨率——净空不需要
 * 对齐网格粒度（之前的论证站不住）。`collision/resolveLabelCollisions.ts` /
 * `selectPlacement.ts` 没有现成的「净空」常量可对齐（`theme.declutter` 只有
 * 移动避让的步长 `candidateStepPx`，不是净空语义），取 4 px：比 1 px 描边的
 * 视觉误差裕量大，又远小于一个文字框的尺寸，不会在密集场景把候选基本全部否决。
 *
 * 净空只加在查询侧（见 `overlapsOccupancy`）；`registerChosen` 登记的是未外扩
 * 的原始包围盒，避免「查询侧外扩一次、登记侧再外扩一次」让两个标签之间的实际
 * 间距变成 `2×clearancePx`。
 */
export const DEFAULT_CLEARANCE_PX = 4;

/**
 * `previous` 匹配容差：按 `(disIndex, radiusIndex)` 相同 + `angle` 差值在此范围内
 * 认为是「同一个候选」。`polarPlace` 的候选打分是连续量，同一轴向/径向单元内
 * 角度会随相机 `showDir` 的滞回微漂（`camera.ts` 的滞回带是 1°进入/3°退出），
 * 取比退出滞回更宽的 5° 保证滞回切换中的候选仍能被认作「同一个」，避免滞回已经
 * 吸收的小漂移在这一层又被当成跳变重新触发候选切换。
 */
export const PREVIOUS_ANGLE_TOLERANCE_DEG = 5;

type ProjectedQuad = Readonly<{ quad: Quad; box: ScreenRect }>;

function boundsOf(quad: Quad): ScreenRect {
  const xs = quad.map((point) => point[0]);
  const ys = quad.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function expandRect(rect: ScreenRect, clearancePx: number): ScreenRect {
  return {
    x: rect.x - clearancePx,
    y: rect.y - clearancePx,
    width: rect.width + clearancePx * 2,
    height: rect.height + clearancePx * 2,
  };
}

/** 矩形四角，顺时针/逆时针皆可——只喂给 `convexQuadsOverlap`，它对绕向不敏感。 */
function rectQuad(rect: ScreenRect): Quad {
  return [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];
}

function isFinitePoint(point: Px): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

/**
 * 文字框世界四角：以 `pos` 为中心（`result.ts` 的 `getResult` 已让文字中心落在
 * 极坐标点上，`:2515`），沿 `textOri.x` 取 `widthM`、沿 `textOri.y` 取 `heightM`。
 */
function worldCorners(candidate: PolarCandidate, widthM: number, heightM: number): readonly Vec3[] {
  const { pos, textOri } = candidate;
  const halfX = scale3(textOri.x, widthM / 2);
  const halfY = scale3(textOri.y, heightM / 2);
  const corners: Vec3[] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    corners.push([
      pos[0] + halfX[0] * sx + halfY[0] * sy,
      pos[1] + halfX[1] * sx + halfY[1] * sy,
      pos[2] + halfX[2] * sx + halfY[2] * sy,
    ]);
  }
  return corners;
}

/**
 * 投影候选文字框。`null` = 退化（含「在相机后」，`depth` 约定见
 * `geometry/sceneGeometry.ts` 的 `projectVertex`：有限且 `depth` 在 `[-1, 1]`
 * 才是相机前方的可绘制点，否则是裁剪/背后，不可信）。
 */
function projectCandidate(
  candidate: PolarCandidate,
  projector: ViewportProjector,
  textSize: Readonly<{ widthM: number; heightM: number }>,
): ProjectedQuad | null {
  const corners = worldCorners(candidate, textSize.widthM, textSize.heightM);
  const quad: Px[] = [];
  for (const corner of corners) {
    const screen = projector.project(corner);
    if (
      !Number.isFinite(screen.x) || !Number.isFinite(screen.y)
      || !Number.isFinite(screen.depth) || screen.depth < -1 || screen.depth > 1
    ) {
      return null;
    }
    quad.push([screen.x, screen.y]);
  }
  const typedQuad = quad as unknown as Quad;
  const box = boundsOf(typedQuad);
  if (!(box.width > 0) && !(box.height > 0)) return null;
  return { quad: typedQuad, box };
}

function isOffscreen(box: ScreenRect, projector: ViewportProjector): boolean {
  return box.x + box.width <= 0
    || box.y + box.height <= 0
    || box.x >= projector.widthCssPx
    || box.y >= projector.heightCssPx;
}

function isBackfacing(candidate: PolarCandidate, projector: ViewportProjector): boolean {
  // `camera.ts` 文件头「符号约定」：`forward` 与观察方向同向（从相机指向场景）。
  // 文字平面法向与 `forward` 同向（点积 > 0）即法向背离观察者——背面朝屏幕。
  return dot3(candidate.textOri.z, projector.forward) > 0;
}

function overlapsOccupancy(
  quad: Quad,
  box: ScreenRect,
  occupancy: LabelOccupancy,
  clearancePx: number,
): boolean {
  const expanded = expandRect(box, clearancePx);
  if (!occupancy.overlaps(expanded)) return false;
  // `LabelOccupancy` 只按矩形存取，这里只能拿扩张后的矩形粗筛；精确判重叠仍需
  // SAT，但没有已占用标签的原始四边形可用（occupancy 存的是矩形），所以精确
  // 判据退化为「扩张矩形 vs 扩张矩形的四角」——与 `declutterOverlaps` 同一算法，
  // 只是占用侧的『四边形』本身就是矩形。
  const expandedQuad = rectQuad(expanded);
  return quadBracketsLabel(quad, box)
    ? convexQuadsOverlap(quad, expandedQuad)
    : true;
}

function sameCandidateSlot(a: PolarCandidate, b: PolarCandidate): boolean {
  if (a.disIndex !== b.disIndex || a.radiusIndex !== b.radiusIndex) return false;
  const delta = Math.abs(a.angle - b.angle);
  const wrapped = Math.min(delta, 360 - delta);
  return wrapped <= PREVIOUS_ANGLE_TOLERANCE_DEG;
}

type Verdict = Readonly<{ ok: true; quad: Quad } | { ok: false; reason: ScreenGuardRejectReason }>;

function evaluate(
  candidate: PolarCandidate,
  projector: ViewportProjector,
  textSize: Readonly<{ widthM: number; heightM: number }>,
  occupancy: LabelOccupancy,
  clearancePx: number,
): Verdict {
  if (isBackfacing(candidate, projector)) return { ok: false, reason: 'backfacing' };

  const projected = projectCandidate(candidate, projector, textSize);
  if (!projected) return { ok: false, reason: 'degenerate' };
  if (projected.quad.some((point) => !isFinitePoint(point))) return { ok: false, reason: 'degenerate' };

  if (isOffscreen(projected.box, projector)) return { ok: false, reason: 'offscreen' };

  if (overlapsOccupancy(projected.quad, projected.box, occupancy, clearancePx)) {
    return { ok: false, reason: 'overlap' };
  }
  return { ok: true, quad: projected.quad };
}

/**
 * 按 `result.candidates` 的排序逐个校验，第一个通过的胜出；`previous` 仍在候选中
 * 且未被否决时优先沿用它，避免逐帧跳动。全部被否决时退回 `result.best`
 * （`chosenIndex` 仍是 0，因为 `best === candidates[0]`），`allRejected = true`。
 */
export function screenGuard(input: ScreenGuardInput): ScreenGuardResult {
  const { result, projector, textSize, occupancy, previous } = input;
  const clearancePx = input.clearancePx ?? DEFAULT_CLEARANCE_PX;
  const candidates = result.candidates;

  const rejected: ScreenGuardRejection[] = [];
  let acceptedIndex = -1;
  let acceptedQuad: Quad | null = null;
  let previousIndex = -1;
  let previousQuad: Quad | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const verdict = evaluate(candidate, projector, textSize, occupancy, clearancePx);
    if (!verdict.ok) {
      rejected.push({ index, reason: verdict.reason });
      continue;
    }
    if (acceptedIndex === -1) {
      acceptedIndex = index;
      acceptedQuad = verdict.quad;
    }
    if (previous && previousIndex === -1 && sameCandidateSlot(candidate, previous)) {
      previousIndex = index;
      previousQuad = verdict.quad;
    }
  }

  if (previousIndex !== -1) {
    return {
      chosen: candidates[previousIndex]!,
      chosenIndex: previousIndex,
      quad: previousQuad!,
      rejected: rejected.filter((entry) => entry.index < previousIndex),
      allRejected: false,
    };
  }

  if (acceptedIndex !== -1) {
    return {
      chosen: candidates[acceptedIndex]!,
      chosenIndex: acceptedIndex,
      quad: acceptedQuad!,
      rejected: rejected.filter((entry) => entry.index < acceptedIndex),
      allRejected: false,
    };
  }

  // 全部否决：确定性兜底，`best` 本就是 `candidates[0]`。没有可信的投影四边形时
  // 仍返回一个值（而不是 null）——T3.6 的调用方要靠 `allRejected` 判断是否可信，
  // 不应该再处理 `quad` 可能缺失的分支。
  const fallbackQuad = projectCandidate(result.best, projector, textSize)?.quad
    ?? ([[0, 0], [0, 0], [0, 0], [0, 0]] as const);
  return {
    chosen: result.best,
    chosenIndex: 0,
    quad: fallbackQuad,
    rejected,
    allRejected: true,
  };
}

/**
 * 把校验选中的候选登记进 `occupancy`，供下一个标签的校验复用（T3.6 的调用场景：
 * 多个标注依次跑 `screenGuard` 时，前一个的选中结果要占住地方）。登记的是文字框
 * **未外扩**的轴对齐包围盒——净空只在查询侧的 `overlapsOccupancy` 加一次；这里
 * 再外扩会让两个标签之间的实际间距变成 `2×clearancePx`（默认值翻倍到 8 px 还
 * 好，但调用方若把 `clearancePx` 调大，密集场景会把几乎所有候选都判成重叠）。
 */
export function registerChosen(
  occupancy: LabelOccupancy,
  guardResult: ScreenGuardResult,
): void {
  occupancy.insert(boundsOf(guardResult.quad));
}
