import type { ModelVersionImpactKind } from '@/model-source';

/**
 * 版本时间轴（Timeline_Scrubber）的刻度排布、簇合并与缩放（design.md §2.1，Requirement 1）。
 * 纯函数：无 Vue、无 DOM、无网络。
 *
 * 口径：刻度按 Chain_Order（sesno 升序）等距排布，下标即 Tick_Ordinal；横坐标只由序号决定，
 * Session_Time 只用于次级标注、悬停提示与时间异常标记。
 */

export type ScrubVersion = {
  sesno: number;
  sessionTime: string | null;      // RFC3339
  impactKind: ModelVersionImpactKind | null;
  author?: string | null;
  note?: string | null;
  changedUnits?: number | null;    // 仅「所有子节点」范围
};
/** 视口以 Tick_Ordinal 计（浮点），刻度 i 的中心在 i，全量范围为 [-0.5, n - 0.5]。 */
export type OrdinalViewport = { start: number; end: number };
export type LaidTick = { sesno: number; ordinal: number; x: number };
export type TickCluster = { x: number; sesnos: number[]; first: number; last: number; anomaly: boolean };
export type TimeLabel = { sesno: number; x: number; text: string };   // 次级时间标注

/** 簇合并阈值：相邻刻度间距小于它时合并（Requirement 1.7） */
const DEFAULT_MIN_GAP_PX = 4;
/** 次级时间标注之间的最小间距 */
const DEFAULT_MIN_LABEL_GAP_PX = 80;
/** 缩放下限：可见范围不少于 5 个刻度（Requirement 1.8） */
const MIN_VISIBLE_TICKS = 5;

/** sesno 升序；同一 sesno 出现多次时只留第一行，保证序列严格升序。 */
export function orderVersions(versions: readonly ScrubVersion[]): ScrubVersion[] {
  const sorted = [...versions].sort((a, b) => a.sesno - b.sesno);
  const out: ScrubVersion[] = [];
  for (const v of sorted) {
    if (out.length === 0 || out[out.length - 1]!.sesno !== v.sesno) out.push(v);
  }
  return out;
}

/** 全量视口 [-0.5, n - 0.5] */
export function fullViewport(n: number): OrdinalViewport {
  const count = Math.max(0, Math.floor(n));
  return { start: -0.5, end: count - 0.5 };
}

/** 缩放下限 min(5, n) */
export function minSpanOf(n: number): number {
  return Math.min(MIN_VISIBLE_TICKS, Math.max(0, Math.floor(n)));
}

/** RFC3339 → 秒级时间戳；缺失或解析不了时为 null（按「无时间」处理）。 */
function epochSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * 时间异常：沿 Chain_Order 记住「前一个带时间版本」u；当前版本 v 带时间且秒级时间严格早于 u 时，记 `v.sesno → u.sesno`。
 * 无时间的行既不标记，也不更新 u。
 */
export function timeAnomalies(ordered: readonly ScrubVersion[]): Map<number, number> {
  const out = new Map<number, number>();
  let prev: { sesno: number; sec: number } | null = null;
  for (const v of ordered) {
    const sec = epochSeconds(v.sessionTime);
    if (sec === null) continue;
    if (prev && sec < prev.sec) out.set(v.sesno, prev.sesno);
    prev = { sesno: v.sesno, sec };
  }
  return out;
}

/** 等距排布下的分桶宽度：间距够大时 1，否则 ceil(minGap / gap)，并防住浮点让 k × gap 略小于 minGap。 */
function bucketSize(gapPx: number, minGapPx: number): number {
  if (!(gapPx > 0)) return 1;
  if (gapPx >= minGapPx) return 1;
  let k = Math.ceil(minGapPx / gapPx);
  while (k * gapPx < minGapPx) k += 1;
  return k;
}

function ordinalToX(ordinal: number, viewport: OrdinalViewport, widthPx: number): number {
  return ((ordinal - viewport.start) / (viewport.end - viewport.start)) * widthPx;
}

/**
 * 刻度与簇。x = (ordinal − start) / (end − start) × widthPx，与 Session_Time 无关。
 * 簇按序号分桶：序号 i 归入桶 floor(i / k)（以序号 0 对齐，平移视口时成员不变），簇 x 取桶的名义中心
 * b × k + (k − 1) / 2，相邻簇中心恰好相距 k × gapPx ≥ minGapPx。
 * 只为与视口相交的桶出刻度与簇（两端不满视口的桶整桶纳入），因此簇的 sesnos 按序拼接恰好等于 ticks 的 sesno 序列。
 */
export function layoutTicks(input: {
  ordered: readonly ScrubVersion[]; viewport: OrdinalViewport; widthPx: number;
  anomalies: ReadonlyMap<number, number>; minGapPx?: number;
}): { ticks: LaidTick[]; clusters: TickCluster[]; gapPx: number } {
  const { ordered, viewport, widthPx, anomalies } = input;
  const minGapPx = input.minGapPx ?? DEFAULT_MIN_GAP_PX;
  const n = ordered.length;
  const span = viewport.end - viewport.start;
  if (n === 0 || !(span > 0) || !(widthPx > 0)) return { ticks: [], clusters: [], gapPx: 0 };

  const gapPx = widthPx / span;
  const lo = Math.max(0, Math.ceil(viewport.start));
  const hi = Math.min(n - 1, Math.floor(viewport.end));
  if (lo > hi) return { ticks: [], clusters: [], gapPx };

  const k = bucketSize(gapPx, minGapPx);
  const bLo = Math.floor(lo / k);
  const bHi = Math.floor(hi / k);
  const ticks: LaidTick[] = [];
  const clusters: TickCluster[] = [];
  for (let b = bLo; b <= bHi; b += 1) {
    const from = b * k;
    const to = Math.min(n - 1, from + k - 1);
    const sesnos: number[] = [];
    let anomaly = false;
    for (let i = from; i <= to; i += 1) {
      const sesno = ordered[i]!.sesno;
      ticks.push({ sesno, ordinal: i, x: ordinalToX(i, viewport, widthPx) });
      sesnos.push(sesno);
      if (anomalies.has(sesno)) anomaly = true;
    }
    clusters.push({
      x: ordinalToX(from + (k - 1) / 2, viewport, widthPx),
      sesnos,
      first: sesnos[0]!,
      last: sesnos[sesnos.length - 1]!,
      anomaly,
    });
  }
  return { ticks, clusters, gapPx };
}

/** 取 RFC3339 字面上的日期与时分（按字符串自带的偏移显示，不受本机时区影响）。 */
function timeParts(text: string | null | undefined): { date: string; hm: string } | null {
  if (!text || epochSeconds(text) === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  return { date: m[1]!, hm: `${m[2]}:${m[3]}` };
}

/**
 * 次级时间标注：可见刻度中每隔 ceil(minLabelGapPx / (k × gapPx)) 个序号取一个，标 `YYYY-MM-DD`，
 * 与上一个标注同一天时改标 `HH:mm`；无时间的刻度跳过，顺延到下一个带时间的刻度。
 * 标注只是读数，不表示刻度按时间分布。
 */
export function timeLabels(ticks: readonly LaidTick[], versions: ReadonlyMap<number, ScrubVersion>,
  widthPx: number, minLabelGapPx: number = DEFAULT_MIN_LABEL_GAP_PX): TimeLabel[] {
  const visible = ticks.filter((t) => t.x >= 0 && t.x <= widthPx);
  if (visible.length === 0) return [];
  let gapPx = 0;
  for (let i = 1; i < ticks.length; i += 1) {
    const dOrd = ticks[i]!.ordinal - ticks[i - 1]!.ordinal;
    if (dOrd > 0) { gapPx = (ticks[i]!.x - ticks[i - 1]!.x) / dOrd; break; }
  }
  const k = bucketSize(gapPx, DEFAULT_MIN_GAP_PX);
  const step = gapPx > 0 ? Math.max(1, Math.ceil(minLabelGapPx / (k * gapPx))) : 1;

  const out: TimeLabel[] = [];
  let threshold = Math.ceil(visible[0]!.ordinal / step) * step;
  let prevDate: string | null = null;
  for (const t of visible) {
    if (t.ordinal < threshold) continue;
    const parts = timeParts(versions.get(t.sesno)?.sessionTime);
    if (!parts) continue;
    out.push({ sesno: t.sesno, x: t.x, text: parts.date === prevDate ? parts.hm : parts.date });
    prevDate = parts.date;
    threshold = t.ordinal + step;
  }
  return out;
}

/** 有序 sesno 表中小于 sesno 的个数 */
function lowerBound(orderedSesnos: readonly number[], sesno: number): number {
  let lo = 0;
  let hi = orderedSesnos.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (orderedSesnos[mid]! < sesno) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 不在表中的 sesno 的灰标位置：插入位置 p（sesno 小于它的刻度数）− 0.5，
 * 即落在「小于它的最后一个刻度」与「大于它的第一个刻度」之间。sesno 在表中时返回它自己的序号。
 */
export function ghostOrdinal(orderedSesnos: readonly number[], sesno: number): number {
  const p = lowerBound(orderedSesnos, sesno);
  if (p < orderedSesnos.length && orderedSesnos[p] === sesno) return p;
  return p - 0.5;
}

/** 把给定跨度的视口平移进全量范围（跨度不超过 n 时不改跨度）。 */
function shiftInto(start: number, span: number, n: number): OrdinalViewport {
  const full = fullViewport(n);
  let s = start;
  if (s + span > full.end) s = full.end - span;
  if (s < full.start) s = full.start;
  return { start: s, end: Math.min(full.end, s + span) };
}

/**
 * 以 anchorOrdinal 为中心把跨度乘 factor，跨度钳在 [min(5, n), n]，再平移进 [-0.5, n − 0.5]。
 * 未触及限制时锚点在视口中的相对位置不变。
 */
export function zoomViewport(viewport: OrdinalViewport, anchorOrdinal: number, factor: number, n: number): OrdinalViewport {
  const count = Math.max(0, Math.floor(n));
  if (count === 0) return fullViewport(0);
  const oldSpan = viewport.end - viewport.start;
  const minSpan = minSpanOf(count);
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const baseSpan = Number.isFinite(oldSpan) && oldSpan > 0 ? oldSpan : count;
  const newSpan = Math.min(count, Math.max(minSpan, baseSpan * safeFactor));
  const rel = Number.isFinite(oldSpan) && oldSpan > 0 && Number.isFinite(anchorOrdinal)
    ? (anchorOrdinal - viewport.start) / oldSpan
    : 0.5;
  const anchor = Number.isFinite(anchorOrdinal) ? anchorOrdinal : viewport.start + baseSpan / 2;
  return shiftInto(anchor - rel * newSpan, newSpan, count);
}

/**
 * 点击簇：取 [first 的序号 − 0.5, last 的序号 + 0.5]；跨度小于 min(5, n) 时以簇中心扩到下限，再钳进全量范围。
 * 结果总覆盖簇首末刻度；轴宽足够（widthPx ≥ 簇刻度数 × minGapPx）时簇内间距 ≥ minGapPx，否则跨度停在覆盖簇所需的最小值。
 */
export function viewportForCluster(cluster: TickCluster, orderedSesnos: readonly number[], widthPx: number,
  minGapPx: number = DEFAULT_MIN_GAP_PX): OrdinalViewport {
  const n = orderedSesnos.length;
  if (n === 0) return fullViewport(0);
  const firstOrd = Math.min(n - 1, lowerBound(orderedSesnos, cluster.first));
  const lastOrd = Math.max(firstOrd, Math.min(n - 1, lowerBound(orderedSesnos, cluster.last)));
  const clusterSpan = lastOrd - firstOrd + 1;
  // 簇内间距 = widthPx / span，span 越小越大；覆盖簇是硬约束，所以跨度取「覆盖簇所需」与下限中的较大者，
  // 不会为凑间距再缩。widthPx < clusterSpan × minGapPx 只在轴极窄时出现，此时间距达不到 minGapPx 也无更优解。
  void widthPx;
  void minGapPx;
  const span = Math.max(clusterSpan, minSpanOf(n));
  const center = (firstOrd + lastOrd) / 2;
  return shiftInto(center - span / 2, Math.min(span, n), n);
}

/** 五态固定色，沿用面板徽章（nodeVersionPanelFormat.impactClass）的色系；noop（仅属性）空心。 */
const IMPACT_COLORS: Record<ModelVersionImpactKind, string> = {
  mesh: '#f59e0b',       // amber-500
  placement: '#3b82f6',  // blue-500
  delivery: '#10b981',   // emerald-500
  tombstone: '#f43f5e',  // rose-500
  noop: '#94a3b8',       // slate-400
};

/** 版本表中出现的每种 impact_kind 一种颜色；noop 空心，其余实心。 */
export function impactPalette(kinds: readonly ModelVersionImpactKind[]): Map<ModelVersionImpactKind, { color: string; hollow: boolean }> {
  const out = new Map<ModelVersionImpactKind, { color: string; hollow: boolean }>();
  for (const kind of kinds) {
    if (out.has(kind) || !(kind in IMPACT_COLORS)) continue;
    out.set(kind, { color: IMPACT_COLORS[kind], hollow: kind === 'noop' });
  }
  return out;
}
