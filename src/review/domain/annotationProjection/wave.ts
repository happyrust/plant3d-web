/**
 * 恒像素单侧余弦波纹与相位稳定——2026-09-14 方案 §4.4 的纯函数部分。
 *
 * - 波纹**只向外抬高**（`A · (1 − cos φ) / 2 ≥ 0`）：正负正弦的波谷会侵入净空，单侧更容易保证包住性质。
 * - 相位锚定到一个确定的来源特征（`src:` 优先），只要该特征仍在轮廓上就保留；特征消失时选最近的共同存活特征，
 *   把旧轮廓在该处的相位转移过去；没有共同特征时由调用方给一个纯几何的边界对应（`continuingBoundaryPair`）。
 * - 闭环约束：「严格固定波长」「整圈整数波」「所有波峰固定世界位置」不能同时满足；这里选恒像素观感 + 锚点处不重置相位，
 *   用一小段收口区（`seamWidth = min(λ, L/4)`）吸收闭合余量，收口两侧高度与一阶变化归零。
 * - 采样点按弧长生成并包含所有直线 / 圆弧连接点；**采样点数只影响离散精度，不定义相位**。
 */

import { atArcLength, mod, segmentRectInterval, visibleCloudPathIntervals, type RoundedPath } from './roundedPath';

import type { P2, Rect } from './hull2d';

const TAU = Math.PI * 2;
const smoothstep = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export type PhaseFrame = {
  anchorId: string;
  anchorS: number;
  phaseAtAnchor: number;
  wavelengthPx: number;
};

/** 弧长 s 处的抬高（非负），收口区两侧渐归零 */
export function cloudHeightAt(s: number, length: number, frame: PhaseFrame, amplitudePx: number): number {
  if (!(length > 0 && frame.wavelengthPx > 0 && amplitudePx >= 0)) throw new Error('invalid cloud metric');
  const u = mod(s - frame.anchorS, length);
  const distanceToSeam = Math.min(u, length - u);
  const seamWidth = Math.min(frame.wavelengthPx, length / 4);
  const gate = smoothstep(distanceToSeam / seamWidth);
  return amplitudePx * gate * (1 - Math.cos((TAU * u) / frame.wavelengthPx + frame.phaseAtAnchor)) / 2;
}

export type PhasePrevious = { path: RoundedPath; frame: PhaseFrame };
export type BoundaryPair = { oldS: number; newS: number; id: string };

/**
 * 保留稳定来源 id；交接时在共同特征处转移解析相位。
 * `previous` 为空 = 首帧：取排序后的第一个特征（`src:` 优先，再按字典序）作锚定，相位 0。
 */
export function transportCloudPhase(
  path: RoundedPath,
  wavelengthPx: number,
  previous?: PhasePrevious | null,
  fallback?: BoundaryPair | null,
): { frame: PhaseFrame; handover: boolean } {
  if (!(wavelengthPx > 0)) throw new Error('positive wavelength required');
  const ids = Object.keys(path.features).sort(
    (a, b) => Number(!a.startsWith('src:')) - Number(!b.startsWith('src:')) || a.localeCompare(b),
  );
  const first = ids[0];
  if (first === undefined) throw new Error('path has no features');
  if (!previous) {
    return { frame: { anchorId: first, anchorS: path.features[first]!, phaseAtAnchor: 0, wavelengthPx }, handover: false };
  }
  const old = previous.frame;
  const keptS = path.features[old.anchorId];
  if (keptS !== undefined) return { frame: { ...old, anchorS: keptS, wavelengthPx }, handover: false };

  const oldLength = previous.path.length;
  const cyclic = (id: string) => {
    const d = mod(previous.path.features[id]! - old.anchorS, oldLength);
    return Math.min(d, oldLength - d);
  };
  const shared = ids
    .filter((id) => previous.path.features[id] !== undefined)
    .sort((a, b) => cyclic(a) - cyclic(b) || a.localeCompare(b));
  const id = shared[0] ?? fallback?.id;
  if (id === undefined) throw new Error('phase handover needs boundary correspondence');
  const oldS = shared.length ? previous.path.features[id]! : fallback!.oldS;
  const newS = shared.length ? path.features[id]! : fallback!.newS;
  const phaseAtAnchor = mod(old.phaseAtAnchor + (TAU * mod(oldS - old.anchorS, oldLength)) / old.wavelengthPx, TAU);
  return { frame: { anchorId: id, anchorS: newS, phaseAtAnchor, wavelengthPx }, handover: true };
}

/**
 * 没有任何共同特征时的纯几何回退：在新轮廓上找最接近旧锚点位置的边界点；
 * 2 px 内的近似并列候选用旧弧长比例位置消歧，避免在几乎重合的候选之间来回切换。
 */
export function continuingBoundaryPair(previous: PhasePrevious, current: RoundedPath, tiePx = 2): BoundaryPair {
  const oldS = previous.frame.anchorS;
  const point = atArcLength(previous.path, oldS);
  const hint = mod((oldS / previous.path.length) * current.length, current.length);
  const candidates: { s: number; distance: number }[] = [];
  const add = (s: number) => {
    const q = atArcLength(current, s);
    candidates.push({ s: mod(s, current.length), distance: Math.hypot(q.x - point.x, q.y - point.y) });
  };
  for (const seg of current.segments) {
    if (seg.kind === 'line') {
      const dx = seg.to.x - seg.from.x;
      const dy = seg.to.y - seg.from.y;
      const lenSq = seg.length * seg.length;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((point.x - seg.from.x) * dx + (point.y - seg.from.y) * dy) / lenSq)) : 0;
      add(seg.s0 + t * seg.length);
    } else {
      add(seg.s0);
      add(seg.s0 + seg.length);
      const angle = Math.atan2(point.y - seg.center.y, point.x - seg.center.x);
      const delta = mod(angle - seg.startAngle, TAU);
      if (delta <= seg.sweep) add(seg.s0 + delta * seg.radius);
    }
  }
  if (!candidates.length) throw new Error('empty contour correspondence');
  const best = Math.min(...candidates.map((c) => c.distance));
  const cyclicDistance = (s: number) => {
    const d = mod(s - hint, current.length);
    return Math.min(d, current.length - d);
  };
  const chosen = candidates
    .filter((c) => c.distance <= best + tiePx)
    .sort((a, b) => cyclicDistance(a.s) - cyclicDistance(b.s) || a.distance - b.distance || a.s - b.s)[0]!;
  return { oldS, newS: chosen.s, id: 'transported-anchor' };
}

/** 有界轮廓的完整闭合折线（首尾重合）；超大 / 出屏路径请用 `buildVisibleCloudPolylines` */
export function buildCloudScreenPolyline(path: RoundedPath, frame: PhaseFrame, amplitudePx = 4, stepPx = 2): P2[] {
  if (!(stepPx > 0 && Number.isFinite(stepPx))) throw new Error('invalid step');
  if (path.length / stepPx > 200000) throw new Error('select visible path intervals before sampling');
  const samples: number[] = [0, path.length, frame.anchorS, ...path.segments.flatMap((s) => [s.s0, s.s0 + s.length])];
  for (let s = 0; s < path.length; s += stepPx) samples.push(s);
  return [...new Set(samples)].sort((a, b) => a - b).map((s, i) => {
    const p = atArcLength(path, s);
    const height = cloudHeightAt(s, path.length, frame, amplitudePx);
    return { id: `sample:${i}`, x: p.x + p.nx * height, y: p.y + p.ny * height };
  });
}

/**
 * 只采样可能可见的弧长区间并按视口切成若干连续折线（真实轮廓片段）。
 * 视口截断产生的闭合边属于边缘提示，**不在这里**——不把它们伪装成云线边界。
 * 整条路径都在视口内时返回一条首尾重合的闭合折线。
 */
export function buildVisibleCloudPolylines(
  path: RoundedPath,
  frame: PhaseFrame,
  viewport: Rect,
  amplitudePx = 4,
  stepPx = 2,
  haloWidthPx = 8.5,
): P2[][] {
  if (!(stepPx > 0 && amplitudePx >= 0 && haloWidthPx >= 0)) throw new Error('invalid screen style');
  const intervals = visibleCloudPathIntervals(path, viewport, amplitudePx + haloWidthPx / 2);
  const output: P2[][] = [];
  const clipRect: Rect = {
    left: viewport.left - haloWidthPx,
    right: viewport.right + haloWidthPx,
    top: viewport.top - haloWidthPx,
    bottom: viewport.bottom + haloWidthPx,
  };
  for (const [lo, hi] of intervals) {
    const samples = [lo, hi, ...path.segments.flatMap((s) => [s.s0, s.s0 + s.length]).filter((s) => s > lo && s < hi)];
    if (frame.anchorS > lo && frame.anchorS < hi) samples.push(frame.anchorS);
    const first = Math.ceil(lo / stepPx);
    const count = Math.ceil((hi - lo) / stepPx) + 1;
    if (count > 200000) throw new Error('visible path exceeds sampling budget');
    for (let k = 0; k < count; k++) {
      const s = (first + k) * stepPx;
      if (s < hi) samples.push(s);
    }
    const points = [...new Set(samples)].sort((a, b) => a - b).map((s) => {
      const p = atArcLength(path, s);
      const height = cloudHeightAt(s, path.length, frame, amplitudePx);
      return { id: `s:${s}`, x: p.x + p.nx * height, y: p.y + p.ny * height };
    });
    let piece: P2[] = [];
    const flush = () => {
      if (piece.length > 1) output.push(piece);
      piece = [];
    };
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const t = segmentRectInterval(a, b, clipRect);
      if (!t) {
        flush();
        continue;
      }
      const mix = (u: number): P2 => ({ id: `clip:${a.id}:${u}`, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
      const start = mix(t[0]);
      const end = mix(t[1]);
      const last = piece[piece.length - 1];
      if (last && Math.hypot(last.x - start.x, last.y - start.y) > 1e-6) flush();
      if (!piece.length) piece.push(start);
      piece.push(end);
    }
    flush();
  }
  return output;
}
