import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

import type { NodeVersionTimelineState } from '@/composables/useNodeVersionTimeline';
import type { ModelVersionSource } from '@/model-source';
import type { NodeTimelineRow } from '@/utils/nodeVersionTimeline';

import { ModelVersionRouteUnavailableError } from '@/model-source/modelVersionErrors';
import {
  clickTick,
  coerceCursorForGeometryOnly,
  initialCursor,
  isGeometryChange,
  navigableTicks,
  snapToPointer,
  stepCursor,
} from '@/utils/versionScrub/cursorNav';
import { normalizePins, pinSide, pinsWithLatest, pinsWithPrevious, type Pins } from '@/utils/versionScrub/pins';
import {
  fullViewport,
  ghostOrdinal,
  layoutTicks,
  orderVersions,
  timeAnomalies,
  timeLabels,
  viewportForCluster,
  zoomViewport,
  type LaidTick,
  type OrdinalViewport,
  type ScrubVersion,
  type TickCluster,
  type TimeLabel,
} from '@/utils/versionScrub/tickLayout';
import { resolveAt, parseInstantText } from '@/utils/versionScrub/timeResolve';

/**
 * 版本时间轴的游标、视口、钉与时间点解析（design.md §4.1，tasks.md 14.4）。
 *
 * 取数口径只有一条：**吃 `useNodeVersionTimeline` 的 `rows`，不另取版本表**。刻度的「本范围 n 版」与列表表头
 * 是同一个数——`attributeOnly` 与 `inScope === false` 的行不进轴，否则轴上的版数会比列表多。
 *
 * 范围切换（`rows` 的 sesno 集合变了）时游标与钉**不动**（Requirement 1.9），视口重置为新表的全量
 * （Requirement 1.10 的另一半）；不在新表里的游标 / 钉按 `ghostOrdinal` 出灰标「本范围无变化」。
 *
 * 纯计算全在 `utils/versionScrub/*`（游标吸附、钉、刻度排布、时间点解析），这里只把它们接到 Vue 响应式上，
 * 加两件事：时间点解析的后端调用（旧服务端回落前端 `resolveAt`）与 `onCursorChange` 的通知。
 */

/** 游标变化的触发方式（`useVersionFrames` 据此决定走 150 ms 停留门还是立即发请求） */
export type CursorTrigger = 'drag' | 'release' | 'click' | 'key' | 'resolve' | 'url';

export type VersionScrubberDeps = {
  source: ModelVersionSource;
  /** 轴宽（像素）。界面用 `ResizeObserver` 喂进来；视口与簇都按它算 x。 */
  width: Ref<number>;
};

export type VersionScrubberState = {
  /** 轴上的版本，sesno 升序（`orderVersions` 之后） */
  versions: ComputedRef<ScrubVersion[]>;
  /** `sesno → 前一个带时间版本`；时间倒退的那些行 */
  anomalies: ComputedRef<Map<number, number>>;
  viewport: Ref<OrdinalViewport>;
  layout: ComputedRef<{ ticks: LaidTick[]; clusters: TickCluster[]; labels: TimeLabel[] }>;
  cursor: Ref<number | null>;
  /** 游标 / 两钉各自在不在当前范围的版本表里 */
  outOfScope: ComputedRef<{ cursor: boolean; a: boolean; b: boolean }>;
  /** 不在表里的游标 / 钉：放灰标「本范围无变化」（Requirement 1.10） */
  ghosts: ComputedRef<{ role: 'cursor' | 'a' | 'b'; sesno: number; ordinal: number }[]>;
  pins: ComputedRef<Pins>;
  /** 一次性提示（钉同版被拒、手填失败之类） */
  notice: Ref<string | null>;
  /** 时间点解析失败的原因（Requirement 8.9）；游标不动、输入框文本保留 */
  dateError: Ref<string | null>;
  canPrev: ComputedRef<boolean>;
  canLatest: ComputedRef<boolean>;
  /** 本面板会话已确认服务端没有 `node/versions/resolve`：改用前端 `resolveAt`（Requirement 10.2） */
  legacyResolve: Ref<boolean>;

  pointerSnap(x: number): void;
  pointerRelease(): void;
  step(delta: -1 | 1): void;
  clickCluster(cluster: TickCluster): void;
  zoom(anchorX: number, factor: number): void;
  pin(side: 'a' | 'b'): void;
  dragPin(side: 'a' | 'b', sesno: number): void;
  withPrevious(): void;
  withLatest(): void;
  clearPins(): void;
  resolveDate(text: string): Promise<void>;
  /** 从直达链接恢复（Requirement 11.2 / 11.6）：游标照 URL 落，钉照 URL 落 */
  restoreFromUrl(state: { cursor: number; a: number | null; b: number | null }): void;
  onCursorChange(cb: (sesno: number, trigger: CursorTrigger) => void): () => void;
};

/**
 * 轴上的版本：与列表表头「本范围 n 版」**同一个口径**（`countNodeTimeline`），按 sesno 升序。
 *
 * 排除的是「不算一版」的行：`!inScope`（本范围无变化），以及模型口径下不成一版的「仅属性」行——
 * `self` 范围里 `attributeOnly` 一律排除；`subtree` 范围里只有「自身只改了属性、子树也没动几何」才排除
 * （子树动了几何时它仍是一版）。照 `countNodeTimeline` 抄，两边不会各算一套。
 */
function toScrubVersions(timeline: NodeVersionTimelineState): ScrubVersion[] {
  const rows: NodeTimelineRow[] = timeline.rows.value;
  const scope = timeline.scope.value;
  const kept: ScrubVersion[] = [];
  for (const row of rows) {
    if (!row.inScope) continue;
    const onlyAttributes = scope === 'self' ? row.attributeOnly : row.attributeOnly && row.unitImpact === null;
    if (onlyAttributes) continue;
    kept.push({
      sesno: row.sesno,
      sessionTime: row.sessionTime,
      impactKind: timeline.rowImpact(row),
      author: row.user,
      note: row.comment,
      changedUnits: row.unitsChanged,
    });
  }
  return orderVersions(kept);
}

export function useVersionScrubber(
  timeline: NodeVersionTimelineState,
  deps: VersionScrubberDeps,
): VersionScrubberState {
  const versions = computed<ScrubVersion[]>(() => toScrubVersions(timeline));
  const orderedSesnos = computed<number[]>(() => versions.value.map((v) => v.sesno));
  const bySesno = computed<ReadonlyMap<number, ScrubVersion>>(
    () => new Map(versions.value.map((v) => [v.sesno, v])),
  );
  const anomalies = computed(() => timeAnomalies(versions.value));

  const viewport = ref<OrdinalViewport>(fullViewport(versions.value.length));
  const cursor = ref<number | null>(null);
  const notice = ref<string | null>(null);
  const dateError = ref<string | null>(null);
  const legacyResolve = ref(false);

  const layout = computed(() => {
    const widthPx = Math.max(0, deps.width.value);
    const laid = layoutTicks({
      ordered: versions.value,
      viewport: viewport.value,
      widthPx,
      anomalies: anomalies.value,
    });
    return {
      ticks: laid.ticks,
      clusters: laid.clusters,
      labels: timeLabels(laid.ticks, bySesno.value, widthPx),
    };
  });

  const pins = computed<Pins>(() => normalizePins({
    a: timeline.beforeSesno.value,
    b: timeline.afterSesno.value,
  }));

  const outOfScope = computed(() => {
    const known = new Set(orderedSesnos.value);
    const c = cursor.value;
    return {
      cursor: c !== null && !known.has(c),
      a: pins.value.a !== null && !known.has(pins.value.a),
      b: pins.value.b !== null && !known.has(pins.value.b),
    };
  });

  const ghosts = computed(() => {
    const out: { role: 'cursor' | 'a' | 'b'; sesno: number; ordinal: number }[] = [];
    const known = new Set(orderedSesnos.value);
    const push = (role: 'cursor' | 'a' | 'b', sesno: number | null): void => {
      if (sesno === null || known.has(sesno)) return;
      out.push({ role, sesno, ordinal: ghostOrdinal(orderedSesnos.value, sesno) });
    };
    push('cursor', cursor.value);
    push('a', pins.value.a);
    push('b', pins.value.b);
    return out;
  });

  const navigable = computed(() => navigableTicks(
    layout.value.ticks,
    bySesno.value,
    timeline.geometryOnly.value,
  ));

  const canPrev = computed(() => {
    const c = cursor.value;
    if (c === null) return false;
    return navigable.value.some((t) => t.sesno < c);
  });

  const canLatest = computed(() => {
    const c = cursor.value;
    if (c === null) return false;
    return navigable.value.some((t) => t.sesno > c);
  });

  // ---------------------------------------------------------------------
  // 游标变化通知
  // ---------------------------------------------------------------------

  const listeners = new Set<(sesno: number, trigger: CursorTrigger) => void>();

  function emit(sesno: number, trigger: CursorTrigger): void {
    for (const cb of listeners) cb(sesno, trigger);
  }

  /**
   * 改游标并通知。`force` = 版本没变也通知一次：
   * 「松手」要让 150 ms 门里的请求立刻发出，「按时间点解析」要让面板把角标换成解析结果。
   * 通知是显式发的，不靠 `watch`——组件外的 `watch` 在测试与 `effectScope` 之外时机不好控。
   */
  function setCursor(next: number | null, trigger: CursorTrigger, force = false): void {
    if (next === null) return;
    if (next === cursor.value) {
      if (force) emit(next, trigger);
      return;
    }
    cursor.value = next;
    emit(next, trigger);
  }

  function onCursorChange(cb: (sesno: number, trigger: CursorTrigger) => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }

  // ---------------------------------------------------------------------
  // 版本表变化：首次给游标、视口回全量；游标与钉不动
  // ---------------------------------------------------------------------

  watch(orderedSesnos, () => {
    // 视口重置为新表的全量（Requirement 1.10 的「视口重置」那一半）
    viewport.value = fullViewport(versions.value.length);
    // 首次显示：游标放在最新一版（Requirement 2.2）。之后即使表变了也不动游标——
    // 不在新表里就靠 ghosts 出灰标，而不是悄悄把它挪到别处。
    if (cursor.value === null) {
      const first = initialCursor(navigable.value);
      if (first !== null) setCursor(first, 'url');
    }
  // sync：`setNode` / `setScope` 之后游标必须立刻可用，界面第一帧就要画出来，不能等下一拍
  }, { immediate: true, flush: 'sync' });

  // 勾选「只看几何变的」后游标可能落在不可导航的版本上：按 Requirement 2.10 迁移
  watch(() => timeline.geometryOnly.value, (geometryOnly) => {
    if (!geometryOnly || cursor.value === null) return;
    const next = coerceCursorForGeometryOnly(versions.value, cursor.value);
    if (next !== null && next !== cursor.value) setCursor(next, 'key');
  }, { flush: 'sync' });

  // ---------------------------------------------------------------------
  // 指针 / 键盘 / 点击
  // ---------------------------------------------------------------------

  function pointerSnap(x: number): void {
    const snapped = snapToPointer(navigable.value, x);
    if (snapped !== null) setCursor(snapped, 'drag');
  }

  function pointerRelease(): void {
    const value = cursor.value;
    if (value === null) return;
    // 松手：与拖动同一版也要通知一次——`useVersionFrames` 靠它把 150 ms 停留门里的请求立刻发出
    setCursor(value, 'release', true);
  }

  function step(delta: -1 | 1): void {
    const value = cursor.value;
    if (value === null) return;
    setCursor(stepCursor(navigable.value, value, delta), 'key');
  }

  function clickCluster(cluster: TickCluster): void {
    viewport.value = viewportForCluster(cluster, orderedSesnos.value, Math.max(0, deps.width.value));
    const value = cursor.value ?? 0;
    setCursor(clickTick(navigable.value, cluster, value), 'click');
  }

  /** 指针 x 反算成序号：`ordinal = start + x / widthPx × (end − start)`。 */
  function ordinalAtX(x: number): number {
    const widthPx = Math.max(1, deps.width.value);
    const span = viewport.value.end - viewport.value.start;
    return viewport.value.start + (x / widthPx) * span;
  }

  function zoom(anchorX: number, factor: number): void {
    viewport.value = zoomViewport(viewport.value, ordinalAtX(anchorX), factor, versions.value.length);
  }

  // ---------------------------------------------------------------------
  // 钉
  // ---------------------------------------------------------------------

  function applyPins(next: Pins): void {
    timeline.setPins(next);
  }

  function pin(side: 'a' | 'b'): void {
    const value = cursor.value;
    if (value === null) return;
    const result = pinSide(pins.value, side, value);
    if (result.rejected === 'same-version') {
      notice.value = `另一侧已经钉在 sesno ${value} 上：同一版不能同时做 A 和 B`;
      return;
    }
    notice.value = null;
    applyPins(result.pins);
  }

  function dragPin(side: 'a' | 'b', sesno: number): void {
    const result = pinSide(pins.value, side, sesno);
    if (result.rejected === 'same-version') {
      notice.value = `另一侧已经钉在 sesno ${sesno} 上：同一版不能同时做 A 和 B`;
      return;
    }
    notice.value = null;
    applyPins(result.pins);
  }

  function withPrevious(): void {
    const value = cursor.value;
    if (value === null) return;
    const next = pinsWithPrevious(orderedSesnos.value, value);
    if (!next) {
      notice.value = '游标已经是范围内第一版，没有「上一版」可比';
      return;
    }
    notice.value = null;
    applyPins(next);
  }

  function withLatest(): void {
    const value = cursor.value;
    if (value === null) return;
    const next = pinsWithLatest(orderedSesnos.value, value);
    if (!next) {
      notice.value = '游标已经是范围内最新版，没有「更新版本」可比';
      return;
    }
    notice.value = null;
    applyPins(next);
  }

  function clearPins(): void {
    notice.value = null;
    applyPins({ a: null, b: null });
  }

  // ---------------------------------------------------------------------
  // 时间点解析（Requirement 8.8、8.9、10.2）
  // ---------------------------------------------------------------------

  /** 解析失败的原因文案：服务端码 / 前端 `resolveAt` 的三种，各说各的。 */
  function resolveFailureText(error: string): string {
    switch (error) {
      case 'invalid-format':
        return '时间格式无效：要 YYYY-MM-DD HH:mm（可带 :ss 与时区）';
      case 'before-oldest':
        return '这个时间点早于全部有时间的版本';
      case 'no-resolvable':
        return '这张版本表里没有带时间的版本，无法按时间点定位';
      case 'NODE_NOT_FOUND':
        return '服务端找不到这个节点';
      case 'TIME_BEFORE_OLDEST_SESSION':
        return '这个时间点早于全部有时间的版本';
      case 'NO_RESOLVABLE_SESSION':
        return '这张版本表里没有带时间的版本，无法按时间点定位';
      default:
        return error;
    }
  }

  function resolveLocally(text: string): boolean {
    const resolved = resolveAt(versions.value, text);
    if (!resolved.ok) {
      dateError.value = resolveFailureText(resolved.error);
      return false;
    }
    dateError.value = null;
    setCursor(resolved.sesno, 'resolve', true);
    return true;
  }

  async function resolveDate(text: string): Promise<void> {
    // 语法先在前端拦掉：格式错不必打一次后端（Requirement 8.9 的第一档原因）
    if (parseInstantText(text) === null) {
      dateError.value = resolveFailureText('invalid-format');
      return;
    }
    const node = timeline.elementTimeline.value;
    const resolveNodeTime = deps.source.resolveNodeTime;
    if (legacyResolve.value || !node || !resolveNodeTime) {
      resolveLocally(text);
      return;
    }
    try {
      const resolved = await resolveNodeTime({
        dbnum: node.dbnum,
        refno: node.refno,
        scope: timeline.scope.value,
        at: text,
      });
      dateError.value = null;
      setCursor(resolved.sesno, 'resolve', true);
    } catch (error) {
      if (error instanceof ModelVersionRouteUnavailableError) {
        // 本面板会话改用前端 `resolveAt`：同一把链序尺子（Requirement 10.2），后面不再打这条路由
        legacyResolve.value = true;
        resolveLocally(text);
        return;
      }
      const code = (error as { code?: unknown }).code;
      dateError.value = resolveFailureText(typeof code === 'string' ? code : '按时间点解析失败');
    }
  }

  // ---------------------------------------------------------------------
  // 直达链接恢复
  // ---------------------------------------------------------------------

  function restoreFromUrl(state: { cursor: number; a: number | null; b: number | null }): void {
    notice.value = null;
    // 游标照 URL 落，即使不在当前范围里（那样会出灰标，而不是被悄悄换掉）
    setCursor(state.cursor, 'url', true);
    timeline.setPins(normalizePins({ a: state.a, b: state.b }));
  }

  return {
    versions,
    anomalies,
    viewport,
    layout,
    cursor,
    outOfScope,
    ghosts,
    pins,
    notice,
    dateError,
    canPrev,
    canLatest,
    legacyResolve,
    pointerSnap,
    pointerRelease,
    step,
    clickCluster,
    zoom,
    pin,
    dragPin,
    withPrevious,
    withLatest,
    clearPins,
    resolveDate,
    restoreFromUrl,
    onCursorChange,
  };
}

/** 只是给界面用的谓词转出：轴上的刻度是不是几何变化版本（图例与灰显共用同一把尺子）。 */
export { isGeometryChange };
