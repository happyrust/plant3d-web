import type { LaidTick, ScrubVersion, TickCluster } from './tickLayout';
import type { ModelVersionImpactKind } from '@/model-source';

/**
 * 版本游标的吸附与移动（design.md §2.2，Requirement 2）。
 * 纯函数：无 Vue、无 DOM、无网络。
 *
 * 口径：候选刻度按 Tick_Ordinal（即 sesno）升序理解，「相邻」「第一个 / 最后一个」都按 sesno 顺序；
 * `noop` 视为「仅属性」，null 视为未知，两者都不算几何变化，其余四态（含 `tombstone`）算几何变化。
 */

/** 几何变化：kind 非 null 且不是 noop（Requirement 2.9） */
export function isGeometryChange(kind: ModelVersionImpactKind | null): boolean {
  return kind !== null && kind !== 'noop';
}

function bySesno(a: LaidTick, b: LaidTick): number {
  return a.sesno - b.sesno;
}

/**
 * 可导航刻度：geometryOnly 关闭时为全部刻度，打开时只留几何变化版本（版本表里查不到的刻度也排除）。
 * 结果按 sesno 升序；为空时调用方不显示游标（Requirement 2.11）。
 */
export function navigableTicks(ticks: readonly LaidTick[], versions: ReadonlyMap<number, ScrubVersion>,
  geometryOnly: boolean): LaidTick[] {
  const out = geometryOnly
    ? ticks.filter((t) => isGeometryChange(versions.get(t.sesno)?.impactKind ?? null))
    : [...ticks];
  return out.sort(bySesno);
}

/**
 * 拖动吸附（Requirement 2.3）：取与指针水平距离最小的刻度，距离相等取 sesno 较大者；
 * 指针在最左刻度左侧 / 最右刻度右侧时取 sesno 最小 / 最大的刻度。候选为空或指针为 NaN 时回 null。
 */
export function snapToPointer(candidates: readonly LaidTick[], pointerX: number): number | null {
  if (candidates.length === 0 || Number.isNaN(pointerX)) return null;
  const sorted = [...candidates].sort(bySesno);
  let minX = Infinity;
  let maxX = -Infinity;
  for (const t of sorted) {
    if (t.x < minX) minX = t.x;
    if (t.x > maxX) maxX = t.x;
  }
  if (pointerX < minX) return sorted[0]!.sesno;
  if (pointerX > maxX) return sorted[sorted.length - 1]!.sesno;

  let best = sorted[0]!;
  let bestDist = Math.abs(best.x - pointerX);
  for (let i = 1; i < sorted.length; i += 1) {
    const t = sorted[i]!;
    const d = Math.abs(t.x - pointerX);
    // sorted 按 sesno 升序，距离相等时后来者 sesno 更大，用 <= 让它胜出
    if (d <= bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best.sesno;
}

/**
 * 方向键（Requirement 2.5）：移到 sesno 顺序中紧邻的前一个（−1）/ 后一个（+1）候选；
 * 已在端点或没有更前 / 更后的候选时保持 current。current 不在候选中时取严格小于 / 大于它的最近候选。
 */
export function stepCursor(candidates: readonly LaidTick[], current: number, delta: -1 | 1): number {
  let next: number | null = null;
  for (const t of candidates) {
    if (delta > 0) {
      if (t.sesno > current && (next === null || t.sesno < next)) next = t.sesno;
    } else if (t.sesno < current && (next === null || t.sesno > next)) {
      next = t.sesno;
    }
  }
  return next ?? current;
}

/**
 * 点击刻度（Requirement 2.6、2.9）：取被点刻度 / 簇内可导航版本中 sesno 最大者；
 * 簇内没有可导航版本（如勾选「只看几何变的」时点到「仅属性」刻度）时保持 current。
 */
export function clickTick(candidates: readonly LaidTick[], clicked: TickCluster, current: number): number {
  const members = new Set(clicked.sesnos);
  let best: number | null = null;
  for (const t of candidates) {
    if (members.has(t.sesno) && (best === null || t.sesno > best)) best = t.sesno;
  }
  return best ?? current;
}

/** 首次显示的游标（Requirement 2.2）：sesno 最大的候选；候选为空回 null。 */
export function initialCursor(candidates: readonly LaidTick[]): number | null {
  let best: number | null = null;
  for (const t of candidates) {
    if (best === null || t.sesno > best) best = t.sesno;
  }
  return best;
}

/**
 * 勾选「只看几何变的」时的游标迁移（Requirement 2.10）：当前版本是几何变化版本时不动；
 * 否则取 sesno ≤ current 的最后一个几何变化版本，没有则取 sesno 最小的几何变化版本；表中没有几何变化版本回 null。
 */
export function coerceCursorForGeometryOnly(all: readonly ScrubVersion[], current: number): number | null {
  let atOrBefore: number | null = null;
  let smallest: number | null = null;
  for (const v of all) {
    if (!isGeometryChange(v.impactKind)) continue;
    if (v.sesno === current) return current;
    if (v.sesno <= current && (atOrBefore === null || v.sesno > atOrBefore)) atOrBefore = v.sesno;
    if (smallest === null || v.sesno < smallest) smallest = v.sesno;
  }
  return atOrBefore ?? smallest;
}
