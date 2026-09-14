/**
 * 云线文字框与引线的屏幕空间布局——2026-09-14 方案 §5（B6）的纯函数部分。
 *
 * 口径：
 * - 文字框锚定到云线**参考包围框**（加 padding、尚未加波浪的轮廓外接矩形），偏移是 CSS 像素**意图值**；
 *   持久化只存意图（`labelLayoutV1.offsetPx`），视口夹紧位移不回写，视口恢复后标签自动回到原偏移。
 * - 顺序：期望位置 → 夹紧到视口安全区（内缩 8 px）→ 与云线内部重叠则试四侧候选、取偏离期望最小者（固定同分排序）。
 *   文本过大先限制尺寸（内部滚动）；云线盖满视口、四侧都放不下时允许覆盖显示并**隐藏引线**。
 * - 引线连接「实际可见云线边界 — 文字框边界」的**最近线段对**（不是最近顶点、不是距文字中心最近的点）；
 *   距离 ≤ 1 px 或重叠时不画；同分按线段身份顺序取第一个，避免左右跳线。
 *
 * 全部坐标相对 overlay 内容区（CSS 像素，x 右 y 下）。无 DOM / three 依赖，可被 Vitest 直接测。
 */

export type P2 = { x: number; y: number };
export type SizePx = { width: number; height: number };
export type RectPx = { x: number; y: number; width: number; height: number };

export type CloudFrame = {
  /** 加 padding、未加波浪的轮廓外接矩形 */
  referenceBounds: RectPx;
  /** 闭合区域（顶点序），供包含 / 重叠判断 */
  enclosure: readonly P2[];
  /** 每条可见 stroke 的连续折线；不含只为闭合而补的视口裁剪边 */
  visibleStrokes: readonly (readonly P2[])[];
};

export type LabelPreference = {
  /** 参考包围框上的锚点比例坐标，默认右上角 `[1, 0]` */
  uv: readonly [number, number];
  /** 文字框左上角相对锚点的期望偏移（CSS 像素） */
  offsetPx: P2;
};

export type LabelLeader = { start: P2; end: P2 };

export type LabelLayoutResult = {
  /** 最终文字框（左上角 + 尺寸） */
  rect: RectPx;
  /** 文字框仍与云线内部重叠（四侧都放不下） */
  overlaps: boolean;
  /** 最终位置偏离了期望位置（被夹紧或改到别侧） */
  displaced: boolean;
  /** 引线：云线边界上的点 → 文字框边界上的点；重叠或贴得太近时为 null */
  leader: LabelLeader | null;
};

export const LABEL_SAFE_INSET_PX = 8;
/** 改侧候选与参考包围框之间的间隙 */
export const LABEL_SIDE_GAP_PX = 12;
/** 引线最短长度（平方），再短不画 */
const LEADER_MIN_DISTANCE_SQ = 1;

export const DEFAULT_LABEL_PREFERENCE: LabelPreference = Object.freeze({
  uv: [1, 0] as const,
  offsetPx: Object.freeze({ x: 18, y: 0 }),
});

export function insetRect(rect: RectPx, inset: number): RectPx {
  const width = Math.max(0, rect.width - inset * 2);
  const height = Math.max(0, rect.height - inset * 2);
  return { x: rect.x + inset, y: rect.y + inset, width, height };
}

/** 文本框超过安全区就先压到安全区尺寸（内部滚动由 DOM 负责） */
export function constrainLabelSize(measured: SizePx, safe: RectPx): SizePx {
  return {
    width: Math.max(1, Math.min(measured.width, safe.width)),
    height: Math.max(1, Math.min(measured.height, safe.height)),
  };
}

/** 把矩形平移进安全区；矩形比安全区大时靠安全区左上 */
export function clampRectInto(rect: RectPx, safe: RectPx): RectPx {
  const maxX = safe.x + safe.width - rect.width;
  const maxY = safe.y + safe.height - rect.height;
  return {
    x: maxX < safe.x ? safe.x : Math.min(Math.max(rect.x, safe.x), maxX),
    y: maxY < safe.y ? safe.y : Math.min(Math.max(rect.y, safe.y), maxY),
    width: rect.width,
    height: rect.height,
  };
}

/** 参考包围框上 `uv` 对应的锚点 */
export function labelAnchorPoint(bounds: RectPx, uv: readonly [number, number]): P2 {
  return { x: bounds.x + bounds.width * uv[0], y: bounds.y + bounds.height * uv[1] };
}

/** 期望左上角 = 锚点 + 意图偏移 */
export function desiredLabelTopLeft(bounds: RectPx, preference: LabelPreference): P2 {
  const anchor = labelAnchorPoint(bounds, preference.uv);
  return { x: anchor.x + preference.offsetPx.x, y: anchor.y + preference.offsetPx.y };
}

/** 反算：由文字框左上角求意图偏移（拖动提交时用），与 `desiredLabelTopLeft` 互逆 */
export function labelOffsetFromTopLeft(bounds: RectPx, uv: readonly [number, number], topLeft: P2): P2 {
  const anchor = labelAnchorPoint(bounds, uv);
  return { x: topLeft.x - anchor.x, y: topLeft.y - anchor.y };
}

function rectCorners(rect: RectPx): P2[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

function pointInRect(p: P2, rect: RectPx): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

/** 射线法，边界上的点算在内 */
export function pointInPolygon(p: P2, polygon: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (onSegment(p, a, b)) return true;
    const crosses = (a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function cross(o: P2, a: P2, b: P2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: P2, a: P2, b: P2, eps = 1e-9): boolean {
  if (Math.abs(cross(a, b, p)) > eps) return false;
  return p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps
    && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
}

function segmentsIntersect(a0: P2, a1: P2, b0: P2, b1: P2): boolean {
  const d1 = cross(b0, b1, a0);
  const d2 = cross(b0, b1, a1);
  const d3 = cross(a0, a1, b0);
  const d4 = cross(a0, a1, b1);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return onSegment(a0, b0, b1) || onSegment(a1, b0, b1) || onSegment(b0, a0, a1) || onSegment(b1, a0, a1);
}

/** 多边形（云线内部）与矩形是否相交：任一顶点互含或任一边相交 */
export function polygonIntersectsRect(polygon: readonly P2[], rect: RectPx): boolean {
  if (polygon.length < 3 || rect.width <= 0 || rect.height <= 0) return false;
  if (polygon.some((p) => pointInRect(p, rect))) return true;
  const corners = rectCorners(rect);
  if (corners.some((c) => pointInPolygon(c, polygon))) return true;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    for (let k = 0; k < 4; k++) {
      if (segmentsIntersect(a, b, corners[k]!, corners[(k + 1) % 4]!)) return true;
    }
  }
  return false;
}

export type ClosestPair = { p: P2; q: P2; distanceSq: number };

function closestPointOnSegment(p: P2, a: P2, b: P2): P2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function distanceSq(a: P2, b: P2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * 两条二维线段的最近点对。相交时距离 0（取交点附近任一端点投影即可）；
 * 不相交时最近点对必含某一端点，四个「端点 → 对方线段」候选取最小。
 */
export function closestSegmentPair(a0: P2, a1: P2, b0: P2, b1: P2): ClosestPair {
  if (segmentsIntersect(a0, a1, b0, b1)) {
    const q = closestPointOnSegment(a0, b0, b1);
    const p = closestPointOnSegment(q, a0, a1);
    return { p, q, distanceSq: 0 };
  }
  const candidates: ClosestPair[] = [];
  for (const end of [a0, a1]) {
    const q = closestPointOnSegment(end, b0, b1);
    candidates.push({ p: end, q, distanceSq: distanceSq(end, q) });
  }
  for (const end of [b0, b1]) {
    const p = closestPointOnSegment(end, a0, a1);
    candidates.push({ p, q: end, distanceSq: distanceSq(p, end) });
  }
  let best = candidates[0]!;
  for (const c of candidates) if (c.distanceSq < best.distanceSq) best = c;
  return best;
}

/**
 * 枚举全部可见轮廓线段 × 文字矩形四边，求线段间最近点对。
 * 同分（差 < 1e-6）保留先遇到的（stroke 序 → 段序 → 矩形边序），避免左右跳线。
 */
export function closestStrokeRectanglePair(
  strokes: readonly (readonly P2[])[],
  rect: RectPx,
): { onStroke: P2; onRectangle: P2; distanceSq: number } | null {
  const corners = rectCorners(rect);
  let best: { onStroke: P2; onRectangle: P2; distanceSq: number } | null = null;
  for (const stroke of strokes) {
    for (let i = 0; i + 1 < stroke.length; i++) {
      const a0 = stroke[i]!;
      const a1 = stroke[i + 1]!;
      for (let k = 0; k < 4; k++) {
        const pair = closestSegmentPair(a0, a1, corners[k]!, corners[(k + 1) % 4]!);
        if (!best || pair.distanceSq < best.distanceSq - 1e-6) {
          best = { onStroke: pair.p, onRectangle: pair.q, distanceSq: pair.distanceSq };
        }
      }
    }
  }
  return best;
}

type FeasibleRectInput = {
  desired: P2;
  size: SizePx;
  safeViewport: RectPx;
  enclosure: readonly P2[];
  referenceBounds: RectPx;
};

/**
 * 期望位置 → 夹紧 → 不重叠即定；重叠则在参考包围框四侧（右、左、下、上）各放一个候选，
 * 保留另一轴上的期望坐标，再夹紧；取与期望位置距离最小且不重叠者；同分按上述固定顺序。
 * 四侧都重叠（云线盖满视口）→ 退回夹紧后的期望位置并标记 `overlaps`。
 */
export function chooseNearestFeasibleLabelRect(input: FeasibleRectInput): { rect: RectPx; overlaps: boolean } {
  const { desired, size, safeViewport, enclosure, referenceBounds: b } = input;
  const primary = clampRectInto({ x: desired.x, y: desired.y, ...size }, safeViewport);
  if (!polygonIntersectsRect(enclosure, primary)) return { rect: primary, overlaps: false };

  const gap = LABEL_SIDE_GAP_PX;
  const sides: P2[] = [
    { x: b.x + b.width + gap, y: desired.y },               // 右
    { x: b.x - gap - size.width, y: desired.y },             // 左
    { x: desired.x, y: b.y + b.height + gap },              // 下
    { x: desired.x, y: b.y - gap - size.height },            // 上
  ];
  let best: { rect: RectPx; score: number } | null = null;
  for (const side of sides) {
    const rect = clampRectInto({ ...side, ...size }, safeViewport);
    if (polygonIntersectsRect(enclosure, rect)) continue;
    const score = distanceSq({ x: rect.x, y: rect.y }, desired);
    if (!best || score < best.score - 1e-6) best = { rect, score };
  }
  return best ? { rect: best.rect, overlaps: false } : { rect: primary, overlaps: true };
}

/**
 * 主入口。`measured` 是文字框实际测得的尺寸；`viewport` 是 overlay 内容区矩形。
 * 拖动中的临时位置由调用方把 `preference` 换成拖动期望即可，函数本身无状态。
 */
export function layoutCloudLabel(
  frame: CloudFrame,
  preference: LabelPreference,
  measured: SizePx,
  viewport: RectPx,
): LabelLayoutResult {
  const safe = insetRect(viewport, LABEL_SAFE_INSET_PX);
  const size = constrainLabelSize(measured, safe);
  const desired = desiredLabelTopLeft(frame.referenceBounds, preference);
  const { rect, overlaps } = chooseNearestFeasibleLabelRect({
    desired,
    size,
    safeViewport: safe,
    enclosure: frame.enclosure,
    referenceBounds: frame.referenceBounds,
  });
  const displaced = Math.abs(rect.x - desired.x) > 1e-6 || Math.abs(rect.y - desired.y) > 1e-6;
  if (overlaps) return { rect, overlaps, displaced, leader: null };

  const pair = closestStrokeRectanglePair(frame.visibleStrokes, rect);
  const leader = pair && pair.distanceSq > LEADER_MIN_DISTANCE_SQ
    ? { start: pair.onStroke, end: pair.onRectangle }
    : null;
  return { rect, overlaps, displaced, leader };
}

/** 轴对齐矩形转成闭合多边形 / 四条 stroke（云线尚未加波浪的参考轮廓） */
export function rectToCloudFrame(bounds: RectPx): CloudFrame {
  const corners = rectCorners(bounds);
  return {
    referenceBounds: bounds,
    enclosure: corners,
    visibleStrokes: [
      [corners[0]!, corners[1]!],
      [corners[1]!, corners[2]!],
      [corners[2]!, corners[3]!],
      [corners[3]!, corners[0]!],
    ],
  };
}
