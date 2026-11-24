/**
 * 增量 RVM 校验的共享状态：模块级单例，模型树、RVM 核对面板、增量记录面板看到的是同一份。
 *
 * 任务从哪来：账本里的几类任务按种类拉 `/api/v1/tasks`（服务端每页封顶 160 条；不分种类时 `rvm_check` 会把数据批次
 * 挤出窗口），按 task_id 缓存——终态任务不会再变，一条整库批次的回执就有 1–2 MB，不反复下载。之后靠 `/api/v1/ws` 的
 * `task_started` / `task_progress` / `task_finished` 逐条补；WS 重连、丢帧或不在线时按种类对账，翻到认识的终态任务就停。
 * `rvm_check` 不发 WS 事件，另按小页轮询交给 `useRvmCheckStore.absorbTasks`，别处发起的核对结论也会落到树上。
 *
 * 各轮重算过的生成根和 `useRvmCheckStore.statusByRefno` 合起来判「增量待校验 / 增量后过期」，规则见
 * `incrementalRvmTargets.ts`（同库按会话号比；整库从头生成的一轮不把没核对过的根列为待校验；祖先核对通过算核对过）。
 * 自己看来待校验的根才去查祖先链（`/api/v1/tree/ancestors`，按根缓存）。
 *
 * 自动校验默认关；打开后只处理开关打开之后落地的轮次，按根记账（localStorage）：后端接下过的根同一轮不再自动入队，
 * 请求失败的最多重试 3 次，被取消的这一轮不再自动入队；排着队还没开跑就刷新了页面的，刷新后接着入队。一轮待校验超过
 * `AUTO_ROUND_LIMIT` 根不自动入队，只提示。没登录 E3D TTY 时不弹登录窗，只累计数量，登录后接着入队。
 */

import { computed, effectScope, getCurrentScope, onScopeDispose, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue';

import { subscribeGenModelV1TaskEvents, useGenModelV1TaskFeed, type GenModelV1TaskEnvelope } from './useGenModelV1TaskFeed';
import { subscribeRvmQueueEvents, useRvmCheckStore, type RvmNodeTarget, type RvmQueueEvent } from './useRvmCheckStore';

import {
  GEN_MODEL_V1_TASKS_PAGE_LIMIT,
  genModelV1TaskGet,
  genModelV1TasksPage,
  genModelV1TreeAncestors,
  isGenModelV1ApiError,
  type TaskListEntryDto,
} from '@/api/genModelV1Api';
import {
  incrementalRoundsOf,
  isInFlight,
  passingAncestorChecks,
  pendingRoundFor,
  roundLabel,
  rvmBadgeTitle,
  taskPendingRoots,
  type CheckedAt,
  type IncrementalRoot,
  type RootRounds,
} from '@/components/rvm-check/incrementalRvmTargets';
import { isTerminalState, rvmRefnoKey, type RvmNodeStatus, type RvmNodeVerdict } from '@/components/rvm-check/rvmCheckFormat';

/** 账本里的任务种类；`rvm_check` 另走小页轮询，`model_history`（历史投影）不是增量账 */
const LEDGER_KINDS = ['data_batch', 'model_rebuild', 'room_rebuild', 'dbnum_model_ensure'] as const;
const LEDGER_KIND_SET = new Set<string>(LEDGER_KINDS);
const SMALL_KINDS = LEDGER_KINDS.filter((kind) => kind !== 'data_batch');
const WINDOW = GEN_MODEL_V1_TASKS_PAGE_LIMIT;
const TICK_MS = 10_000;
const LEDGER_POLL_MS = 60_000;
const BATCH_RECONCILE_LIVE_MS = 120_000;
const BATCH_RECONCILE_DOWN_MS = 30_000;
const PROGRESS_REFETCH_MS = 5_000;
const RVM_PAGE = 20;
const SMALL_PAGE = 20;
const BATCH_PAGE = 10;
/** 首次整窗拉数据批次：整库批次的回执加起来十几 MB，默认 30 s 不够稳 */
const INITIAL_TIMEOUT_MS = 120_000;
const AUTO_KEY = 'rvm-check-incremental-auto';
const ATTEMPTS_KEY = 'rvm-check-incremental-auto-attempts';
const LEGACY_DONE_KEY = 'rvm-check-incremental-auto-done';
const ATTEMPTS_LIMIT = 2_000;
const MAX_AUTO_FAILURES = 3;
/** 一次最多查这么多根的祖先链；一轮整库级的增量也不至于一口气打几千个请求 */
const ANCESTOR_LOOKUP_BATCH = 300;
const ANCESTOR_LOOKUP_CONCURRENCY = 6;
/** 一轮待校验超过这么多根就不自动入队：逐根核对每根要起一次 E3D TTY，几千根要排上一天 */
export const AUTO_ROUND_LIMIT = 200;

type AutoSetting = { enabled: boolean; since: string | null };
/** 一个根在某一轮（`round`）里被自动校验碰过几次：后端接下几次、请求失败几次、是否被取消 */
type AutoAttempt = { round: string; started: number; failed: number; cancelled: boolean };

export type AutoSkippedRound = { taskId: string; label: string; count: number };

function readAuto(): AutoSetting {
  try {
    const raw = globalThis.localStorage?.getItem(AUTO_KEY);
    if (!raw) return { enabled: false, since: null };
    const parsed = JSON.parse(raw) as Partial<AutoSetting>;
    return { enabled: parsed.enabled === true, since: typeof parsed.since === 'string' ? parsed.since : null };
  } catch {
    return { enabled: false, since: null };
  }
}

function readAttempts(): Map<string, AutoAttempt> {
  const attempts = new Map<string, AutoAttempt>();
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(ATTEMPTS_KEY) ?? '{}') as Record<string, Partial<AutoAttempt>> | null;
    for (const [refno, value] of Object.entries(parsed ?? {})) {
      if (!value || typeof value.round !== 'string') continue;
      attempts.set(refno, {
        round: value.round,
        started: Number(value.started) || 0,
        failed: Number(value.failed) || 0,
        cancelled: value.cancelled === true,
      });
    }
  } catch {
    // 读不出就当没碰过：最坏是同一轮多自动入队一次
  }
  return attempts;
}

function writeStorage(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // 存不下只影响刷新后的去重
  }
}

let store: ReturnType<typeof useRvmCheckStore> | null = null;
/** 用到时再取 rvm store：模块加载时不碰它，测试里部分 mock 也不受影响 */
function rvm(): ReturnType<typeof useRvmCheckStore> {
  store ??= useRvmCheckStore();
  return store;
}

const feed = useGenModelV1TaskFeed();

const cache = new Map<string, TaskListEntryDto>();
const tasks = shallowRef<TaskListEntryDto[]>([]);
const loaded = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const auto = ref<AutoSetting>(readAuto());
const attempts = readAttempts();
/** 自动校验在等登录的根数 */
const waitingLogin = ref(0);
/** 本次开关打开以来自动入队的根数 */
const autoQueued = ref(0);
/** 待校验超过上限、没有自动入队的轮次 */
const autoSkipped = shallowRef<AutoSkippedRound[]>([]);
/** 根 → 祖先链（自己在前，`a_b`）；只给自己看来待校验的根查 */
const ancestors = shallowRef(new Map<string, readonly string[]>());
/** 查祖先链失败过的根：本次页面里不再反复查 */
const ancestorMisses = new Set<string>();
let ancestorLookup: Promise<void> | null = null;

let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribeFeed: (() => void) | null = null;
let busy = 0;
let chain: Promise<void> = Promise.resolve();
let lastBatchReconcile = 0;
let lastLedgerPoll = 0;
const fetchingIds = new Map<string, Promise<void>>();
const progressFetchedAt = new Map<string, number>();

function timeMs(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const ms = new Date(stamp).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function newestFirst(left: TaskListEntryDto, right: TaskListEntryDto): number {
  return (timeMs(right.created_at) ?? 0) - (timeMs(left.created_at) ?? 0)
    || String(right.created_at ?? '').localeCompare(String(left.created_at ?? ''));
}

function errorText(cause: unknown): string {
  if (isGenModelV1ApiError(cause)) return cause.message;
  return cause instanceof Error ? cause.message : String(cause);
}

const rounds = computed(() => incrementalRoundsOf(tasks.value));

/** 某个根的祖先里核对通过的结论（祖先链还没查到时为空）。模板 / computed 里可直接调。 */
export function incrementalAncestorPasses(refno: string): readonly CheckedAt[] {
  return passingAncestorChecks(refno, ancestors.value.get(refno), rvm().statusByRefno.value);
}

/** 每个根现在因为哪一轮待校验 / 过期；排队 / 运行中、不待校验的不在里面 */
const pendingRoundByRefno = computed(() => {
  const statuses = rvm().statusByRefno.value;
  const pending = new Map<string, IncrementalRoot>();
  for (const [refno, rootRounds] of rounds.value) {
    const round = pendingRoundFor(statuses[refno], rootRounds, incrementalAncestorPasses(refno));
    if (round) pending.set(refno, round);
  }
  return pending;
});

/** 只看自己的结论仍待校验、祖先链又还没查过的根：要知道有没有祖先核对通过覆盖它 */
function ancestorCandidates(): string[] {
  const statuses = rvm().statusByRefno.value;
  const candidates: string[] = [];
  for (const [refno, rootRounds] of rounds.value) {
    if (ancestors.value.has(refno) || ancestorMisses.has(refno)) continue;
    if (pendingRoundFor(statuses[refno], rootRounds)) candidates.push(refno);
    if (candidates.length >= ANCESTOR_LOOKUP_BATCH) break;
  }
  return candidates;
}

async function lookupAncestors(): Promise<void> {
  for (;;) {
    const candidates = ancestorCandidates();
    if (candidates.length === 0) return;
    const found = new Map(ancestors.value);
    let next = 0;
    const worker = async () => {
      while (next < candidates.length) {
        const refno = candidates[next++]!;
        try {
          const response = await genModelV1TreeAncestors(refno);
          found.set(refno, (response.refnos ?? []).map((item) => rvmRefnoKey(item)));
        } catch {
          ancestorMisses.add(refno);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ANCESTOR_LOOKUP_CONCURRENCY, candidates.length) }, worker));
    ancestors.value = found;
    runAuto();
  }
}

/** 有新的待校验根就去查祖先链（同一时刻只跑一趟，跑完再看有没有新的） */
function scheduleAncestorLookup(): void {
  ancestorLookup ??= lookupAncestors().finally(() => {
    ancestorLookup = null;
  });
}

const pendingSet = computed(() => new Set(pendingRoundByRefno.value.keys()));

export type IncrementalGroup = {
  taskId: string;
  taskKind: string;
  sesno: number | null;
  startSesno: number | null;
  /** 整库从头生成的一轮：组里只有结论落后于它的根 */
  baseline: boolean;
  dbnum: number | null;
  finishedAt: string;
  /** 待校验 + 正在排队 / 运行的根；出了结论就移出 */
  roots: IncrementalRoot[];
  pending: IncrementalRoot[];
};

/** 「增量待校验」页：按轮次分组，轮次从新到旧。 */
const pendingByTask = computed<IncrementalGroup[]>(() => {
  const statuses = rvm().statusByRefno.value;
  const groups = new Map<string, IncrementalGroup>();
  const add = (round: IncrementalRoot, pending: boolean) => {
    let group = groups.get(round.taskId);
    if (!group) {
      group = {
        taskId: round.taskId,
        taskKind: round.taskKind,
        sesno: round.sesno,
        startSesno: round.startSesno,
        baseline: round.baseline,
        dbnum: round.dbnum,
        finishedAt: round.finishedAt,
        roots: [],
        pending: [],
      };
      groups.set(round.taskId, group);
    }
    group.roots.push(round);
    if (pending) group.pending.push(round);
  };
  for (const [refno, rootRounds] of rounds.value) {
    const round = pendingRoundByRefno.value.get(refno);
    if (round) add(round, true);
    else if (isInFlight(statuses[refno]) && rootRounds.latestIncremental) add(rootRounds.latestIncremental, false);
  }
  return [...groups.values()].sort((left, right) => (timeMs(right.finishedAt) ?? 0) - (timeMs(left.finishedAt) ?? 0));
});

/** 缓存 → 对外的列表；每种只留最近 160 条，和服务端窗口同一口径，缓存不无限长。 */
function publish(): void {
  const byKind = new Map<string, TaskListEntryDto[]>();
  for (const entry of cache.values()) {
    const list = byKind.get(entry.kind);
    if (list) list.push(entry);
    else byKind.set(entry.kind, [entry]);
  }
  for (const list of byKind.values()) {
    if (list.length <= WINDOW) continue;
    list.sort(newestFirst);
    for (const stale of list.slice(WINDOW)) cache.delete(stale.task_id);
  }
  tasks.value = [...cache.values()].sort(newestFirst);
}

function upsert(entry: TaskListEntryDto | null | undefined): void {
  if (!entry || typeof entry.task_id !== 'string' || !LEDGER_KIND_SET.has(entry.kind)) return;
  cache.set(entry.task_id, entry);
}

async function loadKind(kind: string): Promise<void> {
  const page = await genModelV1TasksPage({ kind, limit: WINDOW }, { timeoutMs: INITIAL_TIMEOUT_MS });
  for (const entry of page.tasks ?? []) upsert(entry);
}

/** 从最新的往回翻，翻到认识的终态任务就停：更早的都已在缓存里，终态不会再变。 */
async function reconcileKind(kind: string, firstLimit: number, pageLimit: number): Promise<void> {
  let before: string | null = null;
  let limit = firstLimit;
  let seen = 0;
  while (seen < WINDOW) {
    const page = await genModelV1TasksPage({ kind, limit, before });
    const rows = page.tasks ?? [];
    let reachedKnown = false;
    for (const row of rows) {
      const known = cache.get(row.task_id);
      if (known && isTerminalState(known.state) && isTerminalState(row.state)) {
        reachedKnown = true;
        break;
      }
      upsert(row);
    }
    seen += rows.length;
    const oldest = rows[rows.length - 1]?.created_at;
    if (reachedKnown || !page.has_more || !oldest) return;
    before = oldest;
    limit = pageLimit;
  }
}

/** 按 task_id 取一条（同一条在路上时复用）；`rvm_check` 交给 rvm store，其余进缓存。 */
function fetchEntry(taskId: string): Promise<void> {
  let pending = fetchingIds.get(taskId);
  if (!pending) {
    pending = (async () => {
      try {
        const entry = (await genModelV1TaskGet(taskId)) as TaskListEntryDto;
        if (entry?.kind === 'rvm_check') rvm().absorbTasks([entry]);
        else upsert(entry);
      } catch (cause) {
        // 注册表和归档里都没有了：缓存里的那份作废
        if (isGenModelV1ApiError(cause) && cause.status === 404) cache.delete(taskId);
        else throw cause;
      }
    })().finally(() => {
      fetchingIds.delete(taskId);
    });
    fetchingIds.set(taskId, pending);
  }
  return pending;
}

async function refreshUnfinished(): Promise<void> {
  const ids = [...cache.values()].filter((entry) => !isTerminalState(entry.state)).map((entry) => entry.task_id);
  await Promise.all(ids.map((id) => fetchEntry(id)));
}

async function pollRvm(): Promise<void> {
  const page = await genModelV1TasksPage({ kind: 'rvm_check', limit: RVM_PAGE });
  rvm().absorbTasks(page.tasks ?? []);
}

/** 收一批并行请求的结果：失败不作废上一份快照，只记下原因。 */
function settle(results: PromiseSettledResult<unknown>[]): void {
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  error.value = failure ? errorText(failure.reason) : null;
  publish();
  scheduleAncestorLookup();
}

async function loadAll(): Promise<void> {
  const results = await Promise.allSettled([
    loadKind('data_batch'),
    ...SMALL_KINDS.map((kind) => loadKind(kind)),
    rvm().restoreFromHistory(),
  ]);
  if (results[0]?.status === 'fulfilled') loaded.value = true;
  const now = Date.now();
  lastBatchReconcile = now;
  lastLedgerPoll = now;
  settle(results);
}

async function reconcileAll(): Promise<void> {
  const now = Date.now();
  lastBatchReconcile = now;
  lastLedgerPoll = now;
  settle(await Promise.allSettled([
    reconcileKind('data_batch', 1, BATCH_PAGE),
    ...SMALL_KINDS.map((kind) => reconcileKind(kind, SMALL_PAGE, SMALL_PAGE)),
    refreshUnfinished(),
    pollRvm(),
  ]));
}

/** 定时那一拍：核对结论每拍都看；数据批次 WS 在线时两分钟兜底对账一次，不在线时半分钟；小种类一分钟。 */
async function scheduledSync(): Promise<void> {
  const now = Date.now();
  const live = feed.feedStatus.value === 'live';
  const jobs: Promise<unknown>[] = [pollRvm()];
  if (now - lastBatchReconcile >= (live ? BATCH_RECONCILE_LIVE_MS : BATCH_RECONCILE_DOWN_MS)) {
    lastBatchReconcile = now;
    jobs.push(reconcileKind('data_batch', 1, BATCH_PAGE));
  }
  if (now - lastLedgerPoll >= LEDGER_POLL_MS) {
    lastLedgerPoll = now;
    jobs.push(...SMALL_KINDS.map((kind) => reconcileKind(kind, SMALL_PAGE, SMALL_PAGE)), refreshUnfinished());
  } else if (!live) {
    // WS 不在线：运行中批次的进度靠这里跟
    jobs.push(refreshUnfinished());
  }
  settle(await Promise.allSettled(jobs));
}

/** 同步一个接一个跑；调用方 await 到的是这一次跑完、祖先链查完、自动校验也过了一遍之后的快照。 */
function enqueueSync(job: () => Promise<void>): Promise<void> {
  busy += 1;
  const next = chain
    .then(async () => {
      loading.value = true;
      try {
        await job();
        await ancestorLookup;
      } finally {
        loading.value = false;
        runAuto();
      }
    })
    .finally(() => {
      busy -= 1;
    });
  chain = next.catch(() => {});
  return next;
}

function tick(): void {
  if (busy > 0) return;
  void enqueueSync(() => (loaded.value ? scheduledSync() : loadAll())).catch(() => {});
}

/** 手动刷新：排在正在跑的那次之后，整套对账一遍。 */
function refresh(): Promise<void> {
  return enqueueSync(() => (loaded.value ? reconcileAll() : loadAll()));
}

function refetch(taskId: string): void {
  fetchEntry(taskId).then(
    () => {
      publish();
      scheduleAncestorLookup();
      runAuto();
    },
    (cause) => {
      error.value = errorText(cause);
    },
  );
}

function onEnvelope(envelope: GenModelV1TaskEnvelope): void {
  if (!loaded.value) return;
  const payload = envelope.payload && typeof envelope.payload === 'object' ? (envelope.payload as Record<string, unknown>) : {};
  const taskId = typeof envelope.task_id === 'string' && envelope.task_id
    ? envelope.task_id
    : typeof payload.task_id === 'string' ? payload.task_id : '';
  if (!taskId) return;
  const known = cache.get(taskId);
  if (envelope.type === 'task_progress') {
    if (!known || isTerminalState(known.state)) return;
    const now = Date.now();
    if (now - (progressFetchedAt.get(taskId) ?? 0) < PROGRESS_REFETCH_MS) return;
    progressFetchedAt.set(taskId, now);
    refetch(taskId);
    return;
  }
  if (envelope.type !== 'task_started' && envelope.type !== 'task_finished') return;
  const kind = typeof payload.kind === 'string' ? payload.kind : null;
  // 数据批次的 task_finished 不带 kind，认得出的只有 result 里的 batch / units
  const result = payload.result && typeof payload.result === 'object' ? (payload.result as Record<string, unknown>) : null;
  const looksLikeRound = !!result && ('batch' in result || 'units' in result);
  if (!known && !(kind && LEDGER_KIND_SET.has(kind)) && !looksLikeRound) return;
  if (envelope.type === 'task_finished') progressFetchedAt.delete(taskId);
  refetch(taskId);
}

/** WS 重连、丢帧之后对账一次数据批次 */
function requestBatchReconcile(): void {
  if (!timer || !loaded.value) return;
  lastBatchReconcile = 0;
  tick();
}

function roundKey(round: IncrementalRoot): string {
  return round.sesno != null && round.dbnum != null ? `${round.dbnum}:${round.sesno}` : `task:${round.taskId}`;
}

function autoEligible(refno: string, round: IncrementalRoot): boolean {
  const attempt = attempts.get(refno);
  if (!attempt || attempt.round !== roundKey(round)) return true;
  return !attempt.cancelled && attempt.started === 0 && attempt.failed < MAX_AUTO_FAILURES;
}

function persistAttempts(): void {
  while (attempts.size > ATTEMPTS_LIMIT) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
  writeStorage(ATTEMPTS_KEY, Object.fromEntries(attempts));
}

function noteAutoEnqueued(refno: string, round: IncrementalRoot): void {
  const key = roundKey(round);
  const previous = attempts.get(refno);
  // 重新插到末尾：超上限时先挤掉最久没碰过的
  attempts.delete(refno);
  attempts.set(refno, previous && previous.round === key ? previous : { round: key, started: 0, failed: 0, cancelled: false });
}

function onQueueEvent(event: RvmQueueEvent): void {
  const attempt = attempts.get(event.refno);
  if (!attempt) return;
  if (event.type === 'accepted') attempt.started += 1;
  else if (event.type === 'error') attempt.failed += 1;
  else if (event.type === 'cancelled') attempt.cancelled = true;
  else return;
  persistAttempts();
}

function targetOf(refno: string, round: IncrementalRoot): RvmNodeTarget {
  const status = rvm().statusByRefno.value[refno];
  return { refno, noun: round.noun, name: status?.name ?? '' };
}

function sameSkipped(left: AutoSkippedRound[], right: AutoSkippedRound[]): boolean {
  return left.length === right.length
    && left.every((item, index) => item.taskId === right[index]?.taskId && item.count === right[index]?.count);
}

function runAuto(): void {
  if (!auto.value.enabled) {
    waitingLogin.value = 0;
    if (autoSkipped.value.length) autoSkipped.value = [];
    return;
  }
  if (!loaded.value) return;
  const since = timeMs(auto.value.since) ?? 0;
  const groups = new Map<string, { round: IncrementalRoot; refnos: string[] }>();
  for (const [refno, round] of pendingRoundByRefno.value) {
    if ((timeMs(round.finishedAt) ?? 0) < since || !autoEligible(refno, round)) continue;
    // 祖先链还没查到：先等它，可能已有 SITE 核对通过覆盖了这一根
    if (!ancestors.value.has(refno) && !ancestorMisses.has(refno)) continue;
    const group = groups.get(round.taskId);
    if (group) group.refnos.push(refno);
    else groups.set(round.taskId, { round, refnos: [refno] });
  }
  const skipped: AutoSkippedRound[] = [];
  const targets: { refno: string; round: IncrementalRoot }[] = [];
  for (const { round, refnos } of groups.values()) {
    if (refnos.length > AUTO_ROUND_LIMIT) {
      skipped.push({ taskId: round.taskId, label: roundLabel(round), count: refnos.length });
      continue;
    }
    for (const refno of refnos) targets.push({ refno, round });
  }
  if (!sameSkipped(autoSkipped.value, skipped)) autoSkipped.value = skipped;
  if (!rvm().loggedIn.value || !rvm().password.value) {
    waitingLogin.value = targets.length;
    return;
  }
  waitingLogin.value = 0;
  if (targets.length === 0) return;
  for (const { refno, round } of targets) noteAutoEnqueued(refno, round);
  persistAttempts();
  autoQueued.value += rvm().enqueue(targets.map(({ refno, round }) => targetOf(refno, round)));
}

function syncTimer(): void {
  const active = subscribers > 0 || auto.value.enabled;
  if (active && !timer) {
    unsubscribeFeed = subscribeGenModelV1TaskEvents(onEnvelope);
    timer = setInterval(tick, TICK_MS);
    tick();
  } else if (!active && timer) {
    clearInterval(timer);
    timer = null;
    unsubscribeFeed?.();
    unsubscribeFeed = null;
  }
}

function setAutoEnabled(enabled: boolean): void {
  auto.value = { enabled, since: enabled ? new Date().toISOString() : null };
  autoQueued.value = 0;
  writeStorage(AUTO_KEY, auto.value);
  runAuto();
  syncTimer();
}

const autoEnabled = computed({
  get: () => auto.value.enabled,
  set: setAutoEnabled,
});

/** 手动校验一批根：没登录先弹登录窗。返回实际入队数。 */
async function checkRoots(list: IncrementalRoot[]): Promise<number> {
  const seen = new Set<string>();
  const targets = list.filter((root) => {
    if (seen.has(root.refno) || isInFlight(rvm().statusByRefno.value[root.refno])) return false;
    seen.add(root.refno);
    return true;
  });
  if (targets.length === 0) return 0;
  const ok = await rvm().ensureLogin();
  return ok ? rvm().enqueue(targets.map((root) => targetOf(root.refno, root))) : 0;
}

/** 手动校验若干条增量记录里还待校验的根。 */
function checkTasks(entries: TaskListEntryDto[]): Promise<number> {
  const statuses = rvm().statusByRefno.value;
  return checkRoots(entries.flatMap((entry) => taskPendingRoots(entry, statuses, incrementalAncestorPasses)));
}

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;
  try {
    // 旧版按批次记的去重表，按根记账之后不再用
    globalThis.localStorage?.removeItem(LEGACY_DONE_KEY);
  } catch {
    // 删不掉无妨
  }
  subscribeRvmQueueEvents(onQueueEvent);
  // 脱离调用方的作用域：首个调用者多半是组件，它卸载后这些监听还得在
  effectScope(true).run(() => {
    watch(rvm().loggedIn, (loggedIn) => {
      if (loggedIn) runAuto();
    });
    watch(feed.feedStatus, (status, previous) => {
      if (status === 'live' && previous !== 'live') requestBatchReconcile();
    });
    watch(feed.missedEvents, (count, previous) => {
      if (count > previous) requestBatchReconcile();
    });
  });
}

/** 订阅：在组件 setup 里调用时随组件卸载自动退订。 */
export function useIncrementalRvmCheck() {
  init();
  if (getCurrentScope()) {
    subscribers += 1;
    syncTimer();
    onScopeDispose(() => {
      subscribers = Math.max(0, subscribers - 1);
      syncTimer();
    });
  } else {
    syncTimer();
  }
  return {
    tasks,
    loaded,
    loading,
    error,
    rounds,
    pendingSet,
    pendingByTask,
    autoEnabled,
    autoQueued,
    autoSkipped,
    waitingLogin,
    refresh,
    checkRoots,
    checkTasks,
  };
}

export type RvmNodeBadge = {
  /** `null` = 从没核对过 */
  verdict: RvmNodeVerdict | null;
  /** 增量待校验 / 增量后过期：画蓝色刷新角标 */
  outdated: boolean;
  title: string;
  status: RvmNodeStatus | null;
  /** 只在待校验 / 过期时给出是因为哪一轮 */
  root: IncrementalRoot | null;
  /** 这个根在任务窗口里最近的轮次；不在任何一轮里时为 null */
  rounds: RootRounds | null;
  /** 没核对过也不待校验：什么都不画 */
  empty: boolean;
};

/** 一个节点在所有位置统一显示的核对状态。不订阅轮询，只读共享状态，可在模板 / computed 里直接调。 */
export function rvmNodeBadge(refno: string | null | undefined): RvmNodeBadge {
  const key = rvmRefnoKey(refno);
  const status = key ? rvm().statusByRefno.value[key] ?? null : null;
  const root = key ? pendingRoundByRefno.value.get(key) ?? null : null;
  return {
    verdict: status?.verdict ?? null,
    outdated: !!root,
    title: rvmBadgeTitle(status, root),
    status,
    root,
    rounds: key ? rounds.value.get(key) ?? null : null,
    empty: !status && !root,
  };
}

export function useRvmNodeBadge(refno: MaybeRefOrGetter<string | null | undefined>) {
  return computed(() => rvmNodeBadge(toValue(refno)));
}
