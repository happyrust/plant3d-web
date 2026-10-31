import { ref, type Ref } from 'vue';

import type { CursorTrigger } from '@/composables/useVersionScrubber';
import type { ModelNodeDiffScope, ModelVersion, ModelVersionGeometry, ModelVersionSource } from '@/model-source';
import type { ModelUnitGeometryDiff } from '@/utils/modelUnitVersionCompare';
import type { BrowseFrameDetail, ModelUnitCompareBrowseApi, ModelUnitCompareController } from '@/viewer/modelUnitCompareController';

import { HistoryQueryError, ModelVersionRouteUnavailableError } from '@/model-source/modelVersionErrors';
import { buildModelUnitCompareView, type LoadedModelUnitComparePair } from '@/utils/modelUnitCompareLoader';
import { compareModelUnitGeometry, geometrySnapshotsFromInstanceEntries } from '@/utils/modelUnitVersionCompare';
import { abortableSleep, retryOnBusy } from '@/utils/versionScrub/busyRetry';
import { createDwellGate, CURSOR_DWELL_MS, PREFETCH_DWELL_MS, type DwellSchedule } from '@/utils/versionScrub/dwellGate';
import {
  clearFrames,
  emptyFrameCache,
  frameKeyOf,
  getFrame,
  putFrame,
  putSharedFrame,
  touchFrame,
  trimFrames,
  type CachedFrame,
  type FrameCacheEffect,
  type FrameCacheState,
  type FrameKey,
  type ProtectSet,
} from '@/utils/versionScrub/frameCache';
import { normalizePins, type Pins } from '@/utils/versionScrub/pins';
import { planPrefetch, reassignOnCursorMove, PREFETCH_MAX_CONCURRENT, type InFlight } from '@/utils/versionScrub/prefetchPlan';
import { planSubtreeFrames, runBounded, type SubtreePlan, type SubtreeUnitChange } from '@/utils/versionScrub/subtreeFramePlan';

/**
 * 拖动浏览的主流程（design.md §4.2，tasks.md 14.9–14.11）。
 *
 * 三件事分得很开：**取数**（`queryHistoryGeometry`，降级时 `loadVersion`）、**调度**（请求表 + 停留门 + 预取计划 +
 * 忙重试，纯函数在 `utils/versionScrub/*`）、**显示**（只有「完成时游标仍停在这一版」才 `browseShow`，3.7）。
 * 这一层只把三者接起来，外加两件真状态：请求表与帧缓存。
 */

/** 进入浏览的上下文 */
export type BrowseContext = {
  dbnum: number;
  /** 要浏览的单元根（容器逐组看时是它下面那几个单元） */
  unitRefnos: string[];
  /** 起始游标 */
  cursor: number;
  /** 可导航 sesno，升序（预取与邻接都按它） */
  ordered: number[];
  scope: ModelNodeDiffScope;
  /** 叶子「仅自身」时只高亮该构件（9.5） */
  focusRefno?: string | null;
  /** 范围最新一版（子树下「游标就是最新」不装任何帧，9.2） */
  latest?: number | null;
};

export type VersionFramesDeps = {
  source: ModelVersionSource;
  /** 三维接口：浏览那半边 + 对比模式要用的 `open` */
  controller: ModelUnitCompareBrowseApi & Pick<ModelUnitCompareController, 'open'>;
  /** 停留门的计时器；缺省 setTimeout */
  schedule?: DwellSchedule;
  /** 缺省 `abortableSleep` */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type VersionFrameError = { sesno: number; unitRefno?: string; code: string; message: string };

export type VersionFramesState = {
  mode: Ref<'idle' | 'browse' | 'compare'>;
  /** 刻度的加载 / 失败标记（3.12、4.9） */
  tickStatus: Ref<Map<number, 'loading' | 'failed'>>;
  errors: Ref<VersionFrameError[]>;
  /** 服务端没有实时历史查询，本面板会话改走逐版生成（10.1） */
  legacyFallback: Ref<boolean>;
  /** 子树范围的待确认计划（9.3） */
  pendingConfirm: Ref<(SubtreePlan & { kind: 'confirm' }) | null>;
  /** 17.1 的只读调试读数：前端缓存键数、进行中请求数、浏览图层是否已建（性能脚本读它） */
  debug: Ref<{ cacheKeys: number; inFlight: number; browseLayerReady: boolean }>;
  /** 17.1：把同一份读数挂到 `window.__versionScrubDebug`，e2e 脚本不必知道 Vue 内部 */
  exposeDebug(): () => void;

  enterBrowse(ctx: BrowseContext): Promise<void>;
  cursorChanged(sesno: number, trigger: CursorTrigger): void;
  pinsChanged(pins: Pins): void;
  enterCompare(): Promise<void>;
  retry(sesno: number): void;
  answerConfirm(choice: 'all' | 'top' | 'cancel'): void;
  exitBrowse(): Promise<void>;
};

/** 请求表里的一条 */
type InFlightRequest = {
  key: FrameKey;
  unitRefno: string;
  sesno: number;
  controller: AbortController;
  role: 'cursor' | 'prefetch';
  /** 这一条结束时兑现（含重试与角色转换） */
  settled: Promise<void>;
};

const defaultSchedule: DwellSchedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/** `readRealtimeLimit` 读不到时的并发上限（9.9） */
const DEFAULT_CONCURRENCY_LIMIT = 4;
/** 子树预取只针对需装单元 ≤ 5 的相邻版本（9.4） */
const SUBTREE_PREFETCH_UNIT_LIMIT = 5;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function codeOf(error: unknown): string {
  if (error instanceof HistoryQueryError) return error.code;
  if (error instanceof ModelVersionRouteUnavailableError) return 'ROUTE_UNAVAILABLE';
  return error instanceof Error ? error.name : 'UNKNOWN';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyGeometry(): ModelVersionGeometry {
  return { refnos: [], entries: new Map(), release: async () => undefined };
}

export function useVersionFrames(deps: VersionFramesDeps): VersionFramesState {
  const schedule = deps.schedule ?? defaultSchedule;
  const sleep = deps.sleep ?? abortableSleep;

  const mode = ref<'idle' | 'browse' | 'compare'>('idle');
  const tickStatus = ref<Map<number, 'loading' | 'failed'>>(new Map());
  const errors = ref<VersionFrameError[]>([]);
  const legacyFallback = ref(false);
  const pendingConfirm = ref<(SubtreePlan & { kind: 'confirm' }) | null>(null);
  const debug = ref({ cacheKeys: 0, inFlight: 0, browseLayerReady: false });

  let cache: FrameCacheState<ModelVersionGeometry> = emptyFrameCache<ModelVersionGeometry>();
  const inFlight = new Map<FrameKey, InFlightRequest>();
  /**
   * 子树请求的 controller（每次 `loadUnits` 整批共用一个）。`inFlight` 只装游标/预取请求（它参与角色重分配与预取计数），
   * 子树请求另记一份，`exitBrowse` 一并 abort——否则退出浏览后子树请求继续跑，
   * 回来后 `commit` 把帧写进已清空的缓存。
   */
  const subtreeControllers = new Set<AbortController>();
  /** 排队中的预取 sesno */
  let queuedPrefetch: number[] = [];
  /** 本会话预取失败过的 sesno（`HISTORY_BUSY` 不进，4.11） */
  const failedPrefetch = new Set<number>();
  /** 子树范围下需装单元 > 5 的版本：不预取（9.4） */
  const excludedPrefetch = new Set<number>();
  /** 已知的「某版本需装几个单元」（来自差异摘要；只对算过的版本有值） */
  const subtreeUnitCounts = new Map<number, number>();
  /** `UNIT_NOT_PRESENT` 的原因：`not-yet`（早于首次出现）/ `deleted`（晚于删除）（3.11） */
  const missingReasons = new Map<number, 'not-yet' | 'deleted'>();
  /** 视口里当前装着的帧键（`If-None-Match` 与缓存保护都看它） */
  let installedKey: FrameKey | null = null;
  let ctx: BrowseContext | null = null;
  let concurrencyLimit = DEFAULT_CONCURRENCY_LIMIT;
  let limitLoaded = false;
  let lastPins: Pins = { a: null, b: null };

  // ---------------------------------------------------------------- 小工具

  function publishDebug(): void {
    debug.value = {
      cacheKeys: cache.frames.size,
      inFlight: inFlight.size,
      browseLayerReady: deps.controller.browseLayerReady,
    };
  }

  function setTick(sesno: number, status: 'loading' | 'failed' | null): void {
    const next = new Map(tickStatus.value);
    if (status === null) next.delete(sesno);
    else next.set(sesno, status);
    tickStatus.value = next;
  }

  function addError(entry: VersionFrameError): void {
    errors.value = [...errors.value, entry];
  }

  function protect(): ProtectSet {
    const keys = new Set<FrameKey>();
    if (installedKey) keys.add(installedKey);
    // 钉所在帧不被淘汰（4.2）
    if (ctx) {
      for (const sesno of [lastPins.a, lastPins.b]) {
        if (sesno === null) continue;
        for (const unitRefno of ctx.unitRefnos) keys.add(keyOf(unitRefno, sesno));
      }
    }
    return { keys, cursorSesno: ctx?.cursor ?? null };
  }

  function keyOf(unitRefno: string, sesno: number): FrameKey {
    return frameKeyOf(ctx?.dbnum ?? 0, unitRefno, sesno);
  }

  /** 写入缓存并执行副作用：降级路径的快照在这里还回去（10.5） */
  function commit(result: { state: FrameCacheState<ModelVersionGeometry>; effects: FrameCacheEffect<ModelVersionGeometry>[] }): void {
    cache = result.state;
    for (const effect of result.effects) {
      if (effect.kind === 'evicted') void releaseFrameGeometry(effect.frame);
    }
    publishDebug();
  }

  /** 还一份降级路径创建的几何；实时路由的 `release` 是空操作 */
  async function releaseFrameGeometry(frame: CachedFrame<ModelVersionGeometry>): Promise<void> {
    if (!frame.legacySnapshotKey) return;
    const timeout = new Promise<'timeout'>((resolve) => { setTimeout(() => resolve('timeout'), 10_000); });
    try {
      const outcome = await Promise.race([frame.geometry.release(), timeout]);
      if (outcome === 'timeout') console.warn(`[version-scrub] 释放历史快照超时（${frame.legacySnapshotKey}）`);
    } catch (error) {
      console.warn(`[version-scrub] 释放历史快照失败（${frame.legacySnapshotKey}）：${messageOf(error)}`);
    }
  }

  // ---------------------------------------------------------------- 取数

  function inFlightList(): InFlight[] {
    return [...inFlight.values()].map((request) => ({ sesno: request.sesno, role: request.role }));
  }

  function activePrefetchCount(): number {
    let count = 0;
    for (const request of inFlight.values()) if (request.role === 'prefetch') count += 1;
    return count;
  }

  function cursorRequestActive(): boolean {
    for (const request of inFlight.values()) if (request.role === 'cursor') return true;
    return false;
  }

  /** 发一个单元的帧请求；同键已在飞就只改角色，不重复发（3.15）。返回的 Promise 在这一条结束时兑现。 */
  function requestUnit(unitRefno: string, sesno: number, role: 'cursor' | 'prefetch'): Promise<void> {
    const context = ctx;
    if (!context) return Promise.resolve();
    const key = keyOf(unitRefno, sesno);
    const existing = inFlight.get(key);
    if (existing) {
      if (role === 'cursor') existing.role = 'cursor';
      return existing.settled;
    }
    const controller = new AbortController();
    const request: InFlightRequest = { key, unitRefno, sesno, controller, role, settled: Promise.resolve() };
    inFlight.set(key, request);
    publishDebug();
    const shared = sharedFrameFor(unitRefno, sesno);
    request.settled = (async () => {
      try {
        if (legacyFallback.value) await fetchLegacyFrame(unitRefno, sesno, controller.signal);
        else await fetchRealtimeFrame(unitRefno, sesno, controller.signal, role, shared);
      } catch (error) {
        if (isAbortError(error)) return;
        if (error instanceof ModelVersionRouteUnavailableError && role === 'cursor' && !legacyFallback.value) {
          // 旧服务端：本面板会话改用 `loadVersion`，这一版重发一次（10.1）
          legacyFallback.value = true;
          inFlight.delete(key);
          publishDebug();
          await requestUnit(unitRefno, sesno, role);
          return;
        }
        handleFailure(unitRefno, sesno, request.role, error);
      } finally {
        if (inFlight.get(key) === request) inFlight.delete(key);
        publishDebug();
        afterRequestSettled(sesno);
      }
    })();
    return request.settled;
  }

  /** 视口里已装入同一单元的帧：拿它的 `geometryKey` 做 `If-None-Match`（4.10） */
  function sharedFrameFor(unitRefno: string, sesno: number): { key: FrameKey; geometryKey: string } | null {
    if (!installedKey) return null;
    const installed = getFrame(cache, installedKey);
    if (!installed || installed.geometryKey === null) return null;
    if (installed.unitRefno !== unitRefno || installed.sesno === sesno) return null;
    return { key: installedKey, geometryKey: installed.geometryKey };
  }

  async function fetchRealtimeFrame(
    unitRefno: string,
    sesno: number,
    signal: AbortSignal,
    role: 'cursor' | 'prefetch',
    shared: { key: FrameKey; geometryKey: string } | null,
  ): Promise<void> {
    const context = ctx;
    const query = deps.source.queryHistoryGeometry;
    if (!context || !query) throw new ModelVersionRouteUnavailableError('model/history/geometry');
    const options = shared ? { signal, ifNoneMatch: shared.geometryKey } : { signal };
    const attempt = () => query({ dbnum: context.dbnum, unitRefno, sesno }, options);
    const key = keyOf(unitRefno, sesno);

    const result = role === 'cursor'
      ? await retryOnBusy(attempt, {
        signal,
        sleep,
        // 等待期间角色被改成预取（游标移走了）就不再自动重发（3.16）
        shouldRetry: () => inFlight.get(key)?.role === 'cursor',
        // 等待期间角标保持「正在加载」（3.16）；已转成预取的就不再标加载
        onWait: () => { if (inFlight.get(key)?.role === 'cursor') setTick(sesno, 'loading'); },
      })
      : await attempt();

    if (result.kind === 'not-modified') {
      const sharedFrom = shared?.key ?? installedKey;
      if (!sharedFrom) {
        // 已装入的那一帧被淘汰了：这一版没拿到几何，退回无条件请求
        throw new HistoryQueryError('RETRY_WITHOUT_IF_NONE_MATCH', { status: 304 });
      }
      commit(putSharedFrame(cache, {
        key, dbnum: context.dbnum, unitRefno, sesno: result.sesno,
        sessionTime: result.sessionTime, geometryKey: result.geometryKey,
      }, sharedFrom, protect()));
    } else {
      commit(putFrame(cache, {
        key, dbnum: context.dbnum, unitRefno, sesno: result.sesno,
        sessionTime: result.sessionTime, geometryKey: result.geometryKey, geometry: result.geometry,
      }, protect()));
    }
    setTick(sesno, null);
  }

  /** 旧服务端的降级：走 `loadVersion`（300 s 预算），帧带 `legacySnapshotKey`（10.4、10.5） */
  async function fetchLegacyFrame(unitRefno: string, sesno: number, signal: AbortSignal): Promise<void> {
    const context = ctx;
    if (!context) return;
    const version: ModelVersion = {
      dbnum: context.dbnum,
      unitRefno,
      unitNoun: '',
      sesno,
      sessionTime: null,
      impactKind: 'mesh',
    };
    const geometry = await deps.source.loadVersion(version, { signal });
    const snapshotKey = typeof geometry.handle === 'string' ? geometry.handle : null;
    commit(putFrame(cache, {
      key: keyOf(unitRefno, sesno),
      dbnum: context.dbnum,
      unitRefno,
      sesno,
      sessionTime: null,
      geometryKey: geometry.geometryKey ?? null,
      geometry,
      ...(snapshotKey ? { legacySnapshotKey: snapshotKey } : {}),
    }, protect()));
    setTick(sesno, null);
  }

  function handleFailure(unitRefno: string, sesno: number, role: 'cursor' | 'prefetch', error: unknown): void {
    // 预取遇忙不算失败：下次 300 ms 停留再算（4.11）
    if (role === 'prefetch') {
      // 转成预取的游标请求也要把「正在加载」摘掉
      if (error instanceof HistoryQueryError && error.code === 'HISTORY_BUSY') {
        setTick(sesno, null);
        return;
      }
      failedPrefetch.add(sesno);
      setTick(sesno, 'failed');
      return;
    }
    // `UNIT_NOT_PRESENT` 不是失败，是一种帧：缓存空帧，装入时 `browseMissing`（3.11）
    if (error instanceof HistoryQueryError && error.code === 'UNIT_NOT_PRESENT') {
      const context = ctx;
      if (context) {
        missingReasons.set(sesno, error.reason ?? 'not-yet');
        commit(putFrame(cache, {
          key: keyOf(unitRefno, sesno),
          dbnum: context.dbnum,
          unitRefno,
          sesno,
          sessionTime: null,
          geometryKey: null,
          geometry: emptyGeometry(),
        }, protect()));
      }
      setTick(sesno, null);
      return;
    }
    if (error instanceof HistoryQueryError && error.code === 'RETRY_WITHOUT_IF_NONE_MATCH') {
      void requestUnit(unitRefno, sesno, role);
      return;
    }
    setTick(sesno, 'failed');
    addError({ sesno, unitRefno, code: codeOf(error), message: messageOf(error) });
  }

  /** 一个请求结束：游标那一版装一次，然后重跑预取计划（4.4） */
  function afterRequestSettled(sesno: number): void {
    if (!ctx) return;
    const { a, b } = lastPins;
    if (mode.value === 'compare' && a !== null && b !== null
      && unitsOfFrame(a).length > 0 && unitsOfFrame(b).length > 0) {
      setTick(a, null);
      setTick(b, null);
      void openCompareView(ctx, a, b);
      return;
    }
    if (mode.value !== 'browse') return;
    if (ctx.cursor === sesno && unitsOfFrame(sesno).length > 0) void showCursorFrame();
    schedulePrefetch();
  }

  // ---------------------------------------------------------------- 显示

  function unitsOfFrame(sesno: number): BrowseFrameDetail['units'] {
    const context = ctx;
    if (!context) return [];
    const units: BrowseFrameDetail['units'] = [];
    for (const unitRefno of context.unitRefnos) {
      const frame = getFrame(cache, keyOf(unitRefno, sesno));
      if (!frame) return [];
      units.push({ unitRefno, geometryKey: frame.geometryKey, entries: frame.geometry.entries });
    }
    return units;
  }

  /** 单钉着色：只有一个钉时算四态行交给 `browseShow`（5.4） */
  function diffRowsFor(sesno: number, pins: Pins): ModelUnitGeometryDiff[] | undefined {
    const context = ctx;
    const pinSesno = pins.a ?? pins.b;
    if (!context || pinSesno === null) return undefined;
    const before: ReturnType<typeof geometrySnapshotsFromInstanceEntries> = [];
    const after: ReturnType<typeof geometrySnapshotsFromInstanceEntries> = [];
    for (const unitRefno of context.unitRefnos) {
      const cursorFrame = getFrame(cache, keyOf(unitRefno, sesno));
      if (!cursorFrame) return undefined;
      after.push(...geometrySnapshotsFromInstanceEntries(cursorFrame.geometry.entries));
      if (pinSesno === sesno) {
        before.push(...geometrySnapshotsFromInstanceEntries(cursorFrame.geometry.entries));
        continue;
      }
      const pinFrame = getFrame(cache, keyOf(unitRefno, pinSesno));
      if (!pinFrame) return undefined;
      before.push(...geometrySnapshotsFromInstanceEntries(pinFrame.geometry.entries));
    }
    return compareModelUnitGeometry(before, after);
  }

  async function showCursorFrame(): Promise<void> {
    const context = ctx;
    if (!context) return;
    const sesno = context.cursor;
    const units = unitsOfFrame(sesno);
    if (units.length === 0) return;

    // 任一单元是空帧（该版没有这个单元）→ 整个视口按「这一版没有」处理（3.11）
    for (const unitRefno of context.unitRefnos) {
      const frame = getFrame(cache, keyOf(unitRefno, sesno));
      if (frame && frame.geometryKey === null && frame.geometry.refnos.length === 0) {
        deps.controller.browseMissing(sesno, missingReasons.get(sesno) ?? 'not-yet');
        return;
      }
    }

    const diffRows = diffRowsFor(sesno, lastPins);
    const first = getFrame(cache, keyOf(context.unitRefnos[0]!, sesno));
    await deps.controller.browseShow(
      { dbnum: context.dbnum, sesno, sessionTime: first?.sessionTime ?? null, units },
      diffRows ? { diffRows } : {},
    );
    installedKey = keyOf(context.unitRefnos[0]!, sesno);
    cache = touchFrame(cache, installedKey);
    commit(trimFrames(cache, protect()));
  }

  // ---------------------------------------------------------------- 预取

  function cachedSesnos(): Set<number> {
    const out = new Set<number>();
    const context = ctx;
    if (!context) return out;
    for (const frame of cache.frames.values()) {
      if (context.unitRefnos.includes(frame.unitRefno)) out.add(frame.sesno);
    }
    return out;
  }

  const prefetchGate = createDwellGate({
    delayMs: PREFETCH_DWELL_MS,
    schedule,
    fire: (sesno) => {
      const context = ctx;
      if (!context || context.cursor !== sesno || mode.value !== 'browse') return;
      const plan = planPrefetch({
        ordered: context.ordered,
        cursor: sesno,
        cached: cachedSesnos(),
        inFlight: new Set([...inFlight.values()].map((request) => request.sesno)),
        failed: failedPrefetch,
        excluded: excludedPrefetch,
        cursorRequestActive: cursorRequestActive(),
        activePrefetches: activePrefetchCount(),
        maxConcurrent: PREFETCH_MAX_CONCURRENT,
      });
      // 子树范围：已知需装 > 5 个单元的版本不预取（9.4）
      if (context.scope === 'subtree') {
        for (const target of plan) {
          const count = subtreeUnitCounts.get(target);
          if (count !== undefined && count > SUBTREE_PREFETCH_UNIT_LIMIT) excludedPrefetch.add(target);
        }
      }
      queuedPrefetch = plan;
      for (const target of plan) {
        // 子树范围：只预取已知需装 ≤ 5 个单元的版本，未算过的不预取（9.4）
        if (context.scope === 'subtree') {
          const count = subtreeUnitCounts.get(target);
          if (count === undefined || count > SUBTREE_PREFETCH_UNIT_LIMIT) continue;
        }
        for (const unitRefno of context.unitRefnos) requestUnit(unitRefno, target, 'prefetch');
      }
    },
  });

  const cursorGate = createDwellGate({
    delayMs: CURSOR_DWELL_MS,
    schedule,
    fire: (sesno) => {
      const context = ctx;
      if (!context || context.cursor !== sesno || mode.value !== 'browse') return;
      void requestCursorFrame(sesno);
    },
  });

  function schedulePrefetch(): void {
    if (ctx) prefetchGate.onSnap(ctx.cursor);
  }

  /** 取游标那一版：子树范围先算差异摘要与装载计划（9.2、9.3） */
  async function requestCursorFrame(sesno: number): Promise<void> {
    const context = ctx;
    if (!context) return;
    if (context.scope === 'subtree') {
      await requestSubtreeFrame(context, sesno);
      return;
    }
    setTick(sesno, 'loading');
    deps.controller.browsePending(sesno);
    await Promise.all(context.unitRefnos.map((unitRefno) => requestUnit(unitRefno, sesno, 'cursor')));
  }

  async function requestSubtreeFrame(context: BrowseContext, sesno: number): Promise<void> {
    const latest = context.latest ?? null;
    if (latest !== null && sesno === latest) {
      // 游标就是最新版：不装任何帧（9.2）
      setTick(sesno, null);
      deps.controller.browseBadge(`浏览 · sesno ${sesno} · 最新版本，无历史差异`);
      return;
    }
    setTick(sesno, 'loading');
    deps.controller.browsePending(sesno);
    if (latest === null) {
      await Promise.all(context.unitRefnos.map((unitRefno) => requestUnit(unitRefno, sesno, 'cursor')));
      return;
    }
    // 摘要要等一阵，回来先比会话：期间退出、重进或转去对比，结果就不归当前会话，什么都不动（同 `loadUnits`）
    let summary;
    try {
      summary = await deps.source.diffSummary(context.dbnum, context.unitRefnos[0]!, sesno, latest, 'subtree');
    } catch (error) {
      if (mode.value !== 'browse' || ctx !== context) return;
      // 差异摘要失败：不发任何几何请求，视口不动（9.7）
      setTick(sesno, 'failed');
      addError({ sesno, code: codeOf(error), message: messageOf(error) });
      return;
    }
    if (mode.value !== 'browse' || ctx !== context) return;
    const groups: SubtreeUnitChange[] = summary.groups
      .filter((group) => group.unitRefno !== null && group.geometryChanged)
      .map((group) => ({
        unitRefno: group.unitRefno as string,
        changedElements: group.counts.added + group.counts.deleted + group.counts.modified,
      }));
    const cachedUnits = new Set<string>();
    for (const group of groups) {
      if (getFrame(cache, keyOf(group.unitRefno, sesno))) cachedUnits.add(group.unitRefno);
    }
    const plan = planSubtreeFrames({
      cursor: sesno,
      latest,
      groups,
      cachedUnits,
      costThreshold: summary.needsConfirm ? summary.confirmThresholdUnits : null,
    });
    // 记下这一版需装几个单元：子树预取只碰 ≤ 5 的版本（9.4）
    subtreeUnitCounts.set(sesno, groups.length - cachedUnits.size);
    // 游标已经移走：确认框、角标与装载都归游标所在那一版，这一格的「加载中」摘掉就走
    if (context.cursor !== sesno) {
      setTick(sesno, null);
      return;
    }
    if (plan.kind === 'latest') {
      setTick(sesno, null);
      deps.controller.browseBadge(`浏览 · sesno ${sesno} · 最新版本，无历史差异`);
      return;
    }
    if (plan.kind === 'confirm') {
      pendingConfirm.value = plan;
      deps.controller.browseBadge(`浏览 · sesno ${sesno} · 等待确认`);
      return;
    }
    await loadUnits(context, sesno, plan.units.map((unit) => unit.unitRefno));
  }

  /**
   * 并发闸 + 忙重试（9.9、9.10）；部分失败照常显示成功单元（9.8）。
   * 取数与结算都按 `sesno`（发起时那一版）：`context.cursor` 随游标就地改写，排队任务开跑、整批结算时可能早已不是它。
   */
  async function loadUnits(context: BrowseContext, sesno: number, unitRefnos: string[]): Promise<void> {
    const pending = unitRefnos.filter((unitRefno) => !getFrame(cache, keyOf(unitRefno, sesno)));
    // 整批共用一个 controller，开跑前就记进 `subtreeControllers`，`exitBrowse` 一并 abort。
    // 不能每个任务开跑时才建：超过并发上限的任务还在 `runBounded` 里排队，中止时不在集合里，
    // 之后开跑拿到的是没中止的 signal，照样发请求、把帧写进已清空的缓存。
    // 不塞进 `inFlight`：那张表参与角色重分配与预取计数，子树请求混进去会破坏它们的语义。
    const controller = new AbortController();
    subtreeControllers.add(controller);
    const tasks = pending.map((unitRefno) => () => retryOnBusy(
      (signal) => fetchUnitAt(unitRefno, sesno, signal),
      { signal: controller.signal, sleep },
    ));
    const results = await runBounded(tasks, concurrencyLimit);
    subtreeControllers.delete(controller);
    // 只在发起这批请求的那个浏览会话里结算。`mode` 挡住对比模式与退出途中（`exitBrowse` 逐帧
    // `await` 时 `ctx` 还没清）；`ctx !== context` 挡住退出后立即重进——那时 `mode` 已回到 `browse`，
    // 旧会话的结算会改写新会话的刻度、错误与角标。`context` 是调用方当时取的 `ctx`，同一会话内恒等。
    if (mode.value !== 'browse' || ctx !== context) return;
    let failed = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') return;
      // 退出导致的中止不是失败
      if (isAbortError(result.reason)) return;
      failed += 1;
      addError({
        sesno,
        unitRefno: pending[index],
        code: codeOf(result.reason),
        message: messageOf(result.reason),
      });
    });
    setTick(sesno, failed > 0 ? 'failed' : null);
    // 游标已经移走：角标与视口归游标所在那一版，这里只结自己这一格的刻度与错误
    if (context.cursor !== sesno) return;
    if (failed > 0) deps.controller.browseBadge(`浏览 · sesno ${sesno} · ${failed} 个单元加载失败`);
    await showCursorFrame();
  }

  async function fetchUnitAt(unitRefno: string, sesno: number, signal: AbortSignal): Promise<void> {
    const context = ctx;
    const query = deps.source.queryHistoryGeometry;
    if (!context || !query) throw new ModelVersionRouteUnavailableError('model/history/geometry');
    const result = await query({ dbnum: context.dbnum, unitRefno, sesno }, { signal });
    // 响应可能在中止之后才到：数据源不一定理会 signal，`retryOnBusy` 的赛跑只让上层先结束，
    // 不会停掉这里。中止了就不落地，否则帧会写进 `exitBrowse` 已清空的缓存。
    // 没退出就重进不会 abort，另查会话：帧键按当前 `ctx` 的 dbnum 算，旧会话的帧会记到新会话名下。
    if (signal.aborted || ctx !== context) throw new DOMException('This operation was aborted', 'AbortError');
    // 只有 `ok` 带几何。`not-modified` 回的是 304，没有 `geometry` 字段，而本函数是
    // `loadUnits` 里「缓存中没有这一帧」时才发起的——此时没有可复用的本地几何，
    // 不能当成功。原先是 `return`，等于把失败算成成功：`loadUnits` 的 `failed` 恒为 0，
    // 角标说「全部加载成功」而实际一帧都没装。
    if (result.kind !== 'ok') {
      throw new HistoryQueryError('INVALID_RESPONSE', {
        status: 304,
        message: `model/history/geometry 对 ${unitRefno}@${sesno} 回了 304，但本地没有可复用的几何`,
      });
    }
    commit(putFrame(cache, {
      key: keyOf(unitRefno, sesno),
      dbnum: context.dbnum,
      unitRefno,
      sesno: result.sesno,
      sessionTime: result.sessionTime,
      geometryKey: result.geometryKey,
      geometry: result.geometry,
    }, protect()));
  }

  // ---------------------------------------------------------------- 对外

  async function enterBrowse(context: BrowseContext): Promise<void> {
    mode.value = 'browse';
    errors.value = [];
    tickStatus.value = new Map();
    failedPrefetch.clear();
    excludedPrefetch.clear();
    pendingConfirm.value = null;
    ctx = { ...context };
    lastPins = { a: null, b: null };
    installedKey = null;
    if (!limitLoaded) {
      limitLoaded = true;
      const limit = await (deps.source.readRealtimeLimit?.() ?? Promise.resolve(null)).catch(() => null);
      concurrencyLimit = limit && limit >= 1 ? limit : DEFAULT_CONCURRENCY_LIMIT;
    }
    deps.controller.browseEnter({
      dbnum: context.dbnum,
      unitRefnos: context.unitRefnos,
      ...(context.focusRefno ? { focusRefno: context.focusRefno } : {}),
    });
    // `browseEnter` 在视口未就绪时静默返回、不建图层；把读数立刻刷一次，
    // 超时诊断才能区分「图层没建」与「几何没装上」
    publishDebug();
    // 进入就取游标那一版：用户已经点进来了，不用等停留门
    await requestCursorFrame(context.cursor);
  }

  function cursorChanged(sesno: number, trigger: CursorTrigger): void {
    const context = ctx;
    if (mode.value !== 'browse' || !context) return;
    // 待确认只属于游标所在那一版：游标移走就作废，连同那一格的「加载中」。
    // 留着的话，`answerConfirm` 会把按旧版算出的单元拿到新游标去装。
    if (pendingConfirm.value && sesno !== context.cursor) {
      pendingConfirm.value = null;
      setTick(context.cursor, null);
    }
    context.cursor = sesno;

    // 1. 先按新游标重分配在飞的请求（3.15、4.8）
    const reassign = reassignOnCursorMove({
      ordered: context.ordered,
      newCursor: sesno,
      inFlight: inFlightList(),
      queuedPrefetch,
    });
    for (const target of reassign.convertToPrefetch) {
      for (const request of inFlight.values()) if (request.sesno === target) request.role = 'prefetch';
    }
    for (const target of reassign.abort) {
      for (const [key, request] of inFlight) {
        if (request.sesno !== target) continue;
        request.controller.abort();
        inFlight.delete(key);
      }
    }
    queuedPrefetch = queuedPrefetch.filter((item) => !reassign.dequeue.includes(item));

    // 2. 缓存里已有这一版：直接装，不发请求（3.5）
    if (unitsOfFrame(sesno).length > 0) {
      setTick(sesno, null);
      void showCursorFrame();
      schedulePrefetch();
      return;
    }

    // 3. 按触发方式走门（3.3、3.4）
    if (trigger === 'drag') cursorGate.onSnap(sesno);
    else cursorGate.flush(sesno);
    schedulePrefetch();
  }

  function pinsChanged(pins: Pins): void {
    lastPins = normalizePins(pins);
    if (mode.value !== 'browse' || !ctx) return;
    const pinSesno = lastPins.a ?? lastPins.b;
    if (pinSesno === null) {
      void showCursorFrame();
      return;
    }
    // 钉所在帧缺失：按游标规则请求（5.4 的另一半）
    if (unitsOfFrame(pinSesno).length === 0) {
      for (const unitRefno of ctx.unitRefnos) requestUnit(unitRefno, pinSesno, 'prefetch');
      return;
    }
    void showCursorFrame();
  }

  async function enterCompare(): Promise<void> {
    const context = ctx;
    const { a, b } = lastPins;
    if (!context || a === null || b === null) return;
    mode.value = 'compare';
    // 缺哪侧请求哪侧，已有的直接装载不重查（5.6）
    const missing: number[] = [];
    if (unitsOfFrame(a).length === 0) missing.push(a);
    if (unitsOfFrame(b).length === 0) missing.push(b);
    for (const sesno of missing) {
      setTick(sesno, 'loading');
      for (const unitRefno of context.unitRefnos) requestUnit(unitRefno, sesno, 'cursor');
    }
    if (missing.length > 0) return;
    await openCompareView(context, a, b);
  }

  /** 两侧帧齐了：拼 `buildModelUnitCompareView` 的 detail 交给 `controller.open`（5.6） */
  async function openCompareView(context: BrowseContext, a: number, b: number): Promise<void> {
    const loaded: LoadedModelUnitComparePair[] = [];
    for (const unitRefno of context.unitRefnos) {
      const beforeFrame = getFrame(cache, keyOf(unitRefno, a));
      const afterFrame = getFrame(cache, keyOf(unitRefno, b));
      if (!beforeFrame || !afterFrame) continue;
      loaded.push({
        pair: {
          unitRefno,
          unitNoun: '',
          before: versionOf(context, unitRefno, a, beforeFrame.sessionTime),
          after: versionOf(context, unitRefno, b, afterFrame.sessionTime),
        },
        geometries: { before: beforeFrame.geometry, after: afterFrame.geometry },
      });
    }
    if (loaded.length === 0) return;
    const view = buildModelUnitCompareView(loaded, {
      dbnum: context.dbnum,
      container: { unitRefno: context.unitRefnos[0]!, unitNoun: '' },
      // 对比模式下点构件按 side 取那一侧的几何；快照句柄原样交回 `attributesAt`
      attributesAt: async (side, refno) => {
        const sesno = side === 'before' ? a : b;
        if (deps.source.attributesAtSesno) {
          return deps.source.attributesAtSesno({ dbnum: context.dbnum, refno, sesno });
        }
        const frame = loaded.find((item) => item.geometries[side].refnos.includes(refno))?.geometries[side];
        if (!frame) throw new Error(`对比几何里没有 ${refno}`);
        return deps.source.attributesAt(frame, refno);
      },
      asUnits: context.unitRefnos.length > 1,
    });
    await deps.controller.open(view.detail);
  }

  function versionOf(context: BrowseContext, unitRefno: string, sesno: number, sessionTime: string | null): ModelVersion {
    return { dbnum: context.dbnum, unitRefno, unitNoun: '', sesno, sessionTime, impactKind: 'mesh' };
  }

  function retry(sesno: number): void {
    const context = ctx;
    if (!context) return;
    errors.value = errors.value.filter((entry) => entry.sesno !== sesno);
    failedPrefetch.delete(sesno);
    excludedPrefetch.delete(sesno);
    setTick(sesno, 'loading');
    void requestCursorFrame(sesno);
  }

  function answerConfirm(choice: 'all' | 'top' | 'cancel'): void {
    const plan = pendingConfirm.value;
    const context = ctx;
    if (!plan || !context) return;
    pendingConfirm.value = null;
    if (choice === 'cancel') {
      setTick(context.cursor, null);
      // 取消：不发任何请求，视口保持上一次装入的帧（9.6）
      deps.controller.browseBadge(`浏览 · sesno ${context.cursor} 未加载（已取消）`);
      return;
    }
    const units = choice === 'top' ? plan.top : plan.units;
    // 游标一移 `cursorChanged` 就清掉待确认，答得了的一定是当前游标那一版
    void loadUnits(context, context.cursor, units.map((unit) => unit.unitRefno));
  }

  async function exitBrowse(): Promise<void> {
    mode.value = 'idle';
    cursorGate.dispose();
    prefetchGate.dispose();
    for (const request of inFlight.values()) request.controller.abort();
    inFlight.clear();
    for (const controller of subtreeControllers) controller.abort();
    subtreeControllers.clear();
    queuedPrefetch = [];
    // 清空缓存并把降级路径的快照逐个还回去（4.6、10.5）
    const cleared = clearFrames(cache);
    cache = cleared.state;
    for (const effect of cleared.effects) {
      if (effect.kind === 'evicted') await releaseFrameGeometry(effect.frame);
    }
    deps.controller.browseExit();
    ctx = null;
    installedKey = null;
    lastPins = { a: null, b: null };
    tickStatus.value = new Map();
    errors.value = [];
    pendingConfirm.value = null;
    failedPrefetch.clear();
    excludedPrefetch.clear();
    publishDebug();
    // `legacyFallback` 不复位：它是「服务端版本」的判断，同一面板会话再进来还是旧服务端
  }

  /**
   * 17.1：把只读读数挂到 window 上，性能脚本直接读 `window.__versionScrubDebug`。
   * 返回卸载函数；不改变任何行为。
   */
  function exposeDebug(): () => void {
    const target = window as unknown as {
      __versionScrubDebug?: () => { cacheKeys: number; inFlight: number; browseLayerReady: boolean };
    };
    target.__versionScrubDebug = () => ({ ...debug.value });
    return () => { delete target.__versionScrubDebug; };
  }

  return {
    mode,
    tickStatus,
    errors,
    legacyFallback,
    pendingConfirm,
    debug,
    exposeDebug,
    enterBrowse,
    cursorChanged,
    pinsChanged,
    enterCompare,
    retry,
    answerConfirm,
    exitBrowse,
  };
}
