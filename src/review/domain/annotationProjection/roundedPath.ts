/**
 * 凸包的 Minkowski 圆角外扩路径——2026-09-14 方案 §4.3 的纯函数部分。
 *
 * - padding 用「凸包 ⊕ 半径 = padding 的圆盘」的精确边界：直边作外平行线，顶点处用以原顶点为圆心的圆弧连接相邻外法线。
 *   **不用「平均法线 × padding」**（锐角处距离错误）。
 * - `path.length = 凸包周长 + 2π·padding`；`atArcLength(path, s)` 给位置与单位外法线，`s` 是累计 CSS 像素弧长。
 * - `features[id]` = 每个凸包顶点对应圆弧中点的弧长，是相位锚定用的「特征」（§4.4）。
 * - `visibleCloudPathIntervals` 只选可能可见的弧长区间（线段与矩形求交区间、圆弧与四边求交角），**保留全局 s**，不在视口交点重新起相位。
 */

import { convexHull2d, signedArea, type P2, type Rect } from './hull2d';

const TAU = Math.PI * 2;
export const mod = (x: number, n: number): number => ((x % n) + n) % n;

export type PathSegment =
  | { kind: 'line'; s0: number; length: number; from: P2; to: P2; nx: number; ny: number }
  | { kind: 'arc'; s0: number; length: number; center: P2; radius: number; startAngle: number; sweep: number };

export type RoundedPath = {
  segments: PathSegment[];
  length: number;
  /** 凸包顶点 id → 该顶点圆弧中点的弧长 */
  features: Record<string, number>;
};

/** 输入会先取一次凸包；要求正面积（少于 3 点 / 退化先走点 / 线段 LOD） */
export function buildRoundedConvexPath(input: readonly P2[], radius: number): RoundedPath {
  if (!(radius > 0)) throw new Error('positive padding required');
  const hull = convexHull2d(input);
  if (hull.length < 3 || signedArea(hull) <= 0) throw new Error('use point/segment LOD before rounded hull');
  const normals = hull.map((a, i) => {
    const b = hull[(i + 1) % hull.length]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.y - a.y) / l, y: -(b.x - a.x) / l };
  });
  const segments: PathSegment[] = [];
  const features: Record<string, number> = {};
  let s = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const before = normals[(i + normals.length - 1) % normals.length]!;
    const after = normals[i]!;
    const sweep = mod(Math.atan2(before.x * after.y - before.y * after.x, before.x * after.x + before.y * after.y), TAU);
    if (sweep > Math.PI + 1e-8) throw new Error('non-convex normal turn');
    const arcLength = radius * sweep;
    features[a.id] = s + arcLength / 2;
    if (arcLength > 0) {
      segments.push({ kind: 'arc', s0: s, length: arcLength, center: a, radius, startAngle: Math.atan2(before.y, before.x), sweep });
    }
    s += arcLength;
    const from: P2 = { ...a, x: a.x + radius * after.x, y: a.y + radius * after.y };
    const to: P2 = { ...b, x: b.x + radius * after.x, y: b.y + radius * after.y };
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ kind: 'line', s0: s, length, from, to, nx: after.x, ny: after.y });
    s += length;
  }
  return { segments, length: s, features };
}

export type PathPoint = { x: number; y: number; nx: number; ny: number };

export function atArcLength(path: RoundedPath, s: number): PathPoint {
  s = mod(s, path.length);
  const seg = path.segments.find((x) => s < x.s0 + x.length) ?? path.segments[path.segments.length - 1]!;
  const t = seg.length > 0 ? Math.max(0, Math.min(1, (s - seg.s0) / seg.length)) : 0;
  if (seg.kind === 'line') {
    return { x: seg.from.x + (seg.to.x - seg.from.x) * t, y: seg.from.y + (seg.to.y - seg.from.y) * t, nx: seg.nx, ny: seg.ny };
  }
  const angle = seg.startAngle + t * seg.sweep;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  return { x: seg.center.x + seg.radius * nx, y: seg.center.y + seg.radius * ny, nx, ny };
}

/** 路径（含 padding、未加波浪）的轴对齐包围框：直边取端点，圆弧取「圆心 ± 半径」的保守盒 */
export function roundedPathBounds(path: RoundedPath): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const seg of path.segments) {
    if (seg.kind === 'line') {
      add(seg.from.x, seg.from.y);
      add(seg.to.x, seg.to.y);
    } else {
      // 圆弧端点 + 落在扫过角度内的四个轴向极值点
      add(seg.center.x + seg.radius * Math.cos(seg.startAngle), seg.center.y + seg.radius * Math.sin(seg.startAngle));
      add(seg.center.x + seg.radius * Math.cos(seg.startAngle + seg.sweep), seg.center.y + seg.radius * Math.sin(seg.startAngle + seg.sweep));
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        if (mod(angle - seg.startAngle, TAU) <= seg.sweep) add(seg.center.x + seg.radius * Math.cos(angle), seg.center.y + seg.radius * Math.sin(angle));
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

/** 路径的闭合多边形近似（每段直边端点 + 每段圆弧按角度细分），供包含 / 重叠判断 */
export function roundedPathPolygon(path: RoundedPath, arcStepRad = Math.PI / 8): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const seg of path.segments) {
    if (seg.kind === 'line') {
      out.push({ x: seg.from.x, y: seg.from.y });
      continue;
    }
    const steps = Math.max(1, Math.ceil(seg.sweep / arcStepRad));
    for (let k = 0; k < steps; k++) {
      const angle = seg.startAngle + (k / steps) * seg.sweep;
      out.push({ x: seg.center.x + seg.radius * Math.cos(angle), y: seg.center.y + seg.radius * Math.sin(angle) });
    }
  }
  return out;
}

/** 线段与矩形的参数区间 [t0, t1]（Liang–Barsky），不相交返回 null */
export function segmentRectInterval(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect): [number, number] | null {
  let lo = 0;
  let hi = 1;
  const constraints: readonly (readonly [number, number])[] = [
    [a.x - r.left, b.x - a.x],
    [r.right - a.x, a.x - b.x],
    [a.y - r.top, b.y - a.y],
    [r.bottom - a.y, a.y - b.y],
  ];
  for (const [base, delta] of constraints) {
    if (delta === 0) {
      if (base < 0) return null;
      continue;
    }
    const t = -base / delta;
    if (delta > 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return null;
  }
  return [lo, hi];
}

/** 只选可能可见的弧长区间（视口外扩 `expansionPx`），**不重设** s 原点；返回按 s 升序合并后的区间 */
export function visibleCloudPathIntervals(path: RoundedPath, viewport: Rect, expansionPx: number): [number, number][] {
  if (!(expansionPx >= 0)) throw new Error('invalid expansion');
  const r: Rect = {
    left: viewport.left - expansionPx,
    right: viewport.right + expansionPx,
    top: viewport.top - expansionPx,
    bottom: viewport.bottom + expansionPx,
  };
  const inside = (x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const intervals: [number, number][] = [];
  for (const seg of path.segments) {
    if (seg.kind === 'line') {
      const t = segmentRectInterval(seg.from, seg.to, r);
      if (t) intervals.push([seg.s0 + t[0] * seg.length, seg.s0 + t[1] * seg.length]);
      continue;
    }
    const ts = [0, 1];
    const addAngle = (angle: number) => {
      const delta = mod(angle - seg.startAngle, TAU);
      if (delta <= seg.sweep + 1e-10) ts.push(Math.min(1, delta / seg.sweep));
    };
    for (const x of [r.left, r.right]) {
      const a = (x - seg.center.x) / seg.radius;
      if (Math.abs(a) <= 1) {
        const t = Math.acos(a);
        addAngle(t);
        addAngle(-t);
      }
    }
    for (const y of [r.top, r.bottom]) {
      const a = (y - seg.center.y) / seg.radius;
      if (Math.abs(a) <= 1) {
        const t = Math.asin(a);
        addAngle(t);
        addAngle(Math.PI - t);
      }
    }
    const ordered = [...new Set(ts)].sort((a, b) => a - b);
    for (let i = 0; i + 1 < ordered.length; i++) {
      const a = ordered[i]!;
      const b = ordered[i + 1]!;
      const theta = seg.startAngle + ((a + b) / 2) * seg.sweep;
      if (inside(seg.center.x + seg.radius * Math.cos(theta), seg.center.y + seg.radius * Math.sin(theta))) {
        intervals.push([seg.s0 + a * seg.length, seg.s0 + b * seg.length]);
      }
    }
  }
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const prev = merged[merged.length - 1];
    if (prev && interval[0] <= prev[1] + 1e-8) prev[1] = Math.max(prev[1], interval[1]);
    else merged.push([interval[0], interval[1]]);
  }
  return merged;
}
