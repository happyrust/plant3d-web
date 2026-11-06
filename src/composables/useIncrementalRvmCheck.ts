/**
 * 增量 RVM 校验的共享状态：模块级单例。按引用计数轮询 `/api/v1/tasks`，推出每轮增量重算过的生成根，
 * 和 `useRvmCheckStore.statusByRefno` 合起来判「增量待校验 / 增量后过期」。同一份任务列表里的
 * `rvm_check` 条目交给 rvm store 吸收，别处发起的核对结论也会落到树上。
 *
 * 自动校验默认关；打开后只处理开关打开之后落地的批次，处理过的 task_id 记进 localStorage，刷新不重复入队。
 * 没登录 E3D TTY 时不弹登录窗，只累计数量，登录后接着入队。
 */

import { computed, effectScope, getCurrentScope, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';

import { useRvmCheckStore, type RvmNodeTarget } from './useRvmCheckStore';

import {
  genModelV1Tasks,
  isGenModelV1ApiError,
  type TaskListEntryDto,
} from '@/api/genModelV1Api';
import {
  incrementalRootsOf,
  isIncrementalTask,
  isInFlight,
  isPendingFor,
  rvmBadgeTitle,
  taskPendingRoots,
  type IncrementalRoot,
} from '@/components/rvm-check/incrementalRvmTargets';
import { rvmRefnoKey, type RvmNodeStatus, type RvmNodeVerdict } from '@/components/rvm-check/rvmCheckFormat';

const POLL_MS = 5_000;
const AUTO_KEY = 'rvm-check-incremental-auto';
const DONE_KEY = 'rvm-check-incremental-auto-done';
const DONE_LIMIT = 400;

type AutoSetting = { enabled: boolean; since: string | null };

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

function readDone(): string[] {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(DONE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
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

const tasks = ref<TaskListEntryDto[]>([]);
const loaded = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const auto = ref<AutoSetting>(readAuto());
const autoDone = new Set<string>(readDone());
/** 自动校验在等登录的根数（去重） */
const waitingLogin = ref(0);
/** 本次开关打开以来自动入队的根数 */
const autoQueued = ref(0);

let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

const roots = computed(() => incrementalRootsOf(tasks.value));
const rootByRefno = computed(() => new Map(roots.value.map((root) => [root.refno, root])));

/** 待校验或过期的根（按该根最近一轮判）；排队 / 运行中不在里面 */
const pendingSet = computed(() => {
  const statuses = rvm().statusByRefno.value;
  return new Set(roots.value.filter((root) => isPendingFor(statuses[root.refno], root)).map((root) => root.refno));
});

export type IncrementalGroup = {
  taskId: string;
  taskKind: string;
  sesno: number | null;
  dbnum: number | null;
  finishedAt: string;
  /** 待校验 + 正在排队 / 运行的根；出了结论就移出 */
  roots: IncrementalRoot[];
  pending: IncrementalRoot[];
};

/** 「增量待校验」页：按批次分组，批次从新到旧。 */
const pendingByTask = computed<IncrementalGroup[]>(() => {
  const statuses = rvm().statusByRefno.value;
  const groups = new Map<string, IncrementalGroup>();
  for (const root of roots.value) {
    const status = statuses[root.refno];
    const pending = isPendingFor(status, root);
    if (!pending && !isInFlight(status)) continue;
    let group = groups.get(root.taskId);
    if (!group) {
      group = { taskId: root.taskId, taskKind: root.taskKind, sesno: root.sesno, dbnum: root.dbnum, finishedAt: root.finishedAt, roots: [], pending: [] };
      groups.set(root.taskId, group);
    }
    group.roots.push(root);
    if (pending) group.pending.push(root);
  }
  return [...groups.values()];
});

function errorText(cause: unknown): string {
  if (isGenModelV1ApiError(cause)) return cause.message;
  return cause instanceof Error ? cause.message : String(cause);
}

function targetOf(root: IncrementalRoot): RvmNodeTarget {
  const status = rvm().statusByRefno.value[root.refno];
  return { refno: root.refno, noun: root.noun, name: status?.name ?? '' };
}

function uniqueRoots(list: IncrementalRoot[]): IncrementalRoot[] {
  const seen = new Set<string>();
  return list.filter((root) => (seen.has(root.refno) ? false : (seen.add(root.refno), true)));
}

/** 手动校验一批根：没登录先弹登录窗。返回实际入队数。 */
async function checkRoots(list: IncrementalRoot[]): Promise<number> {
  const targets = uniqueRoots(list).filter((root) => !isInFlight(rvm().statusByRefno.value[root.refno]));
  if (targets.length === 0) return 0;
  const ok = await rvm().ensureLogin();
  return ok ? rvm().enqueue(targets.map(targetOf)) : 0;
}

/** 手动校验若干条增量记录里还待校验的根。 */
function checkTasks(entries: TaskListEntryDto[]): Promise<number> {
  const statuses = rvm().statusByRefno.value;
  return checkRoots(entries.flatMap((entry) => taskPendingRoots(entry, statuses)));
}

function markDone(taskId: string): void {
  autoDone.add(taskId);
  const list = [...autoDone];
  while (list.length > DONE_LIMIT) autoDone.delete(list.shift()!);
  writeStorage(DONE_KEY, [...autoDone]);
}

function runAuto(): void {
  if (!auto.value.enabled) {
    waitingLogin.value = 0;
    return;
  }
  const since = auto.value.since ? new Date(auto.value.since).getTime() : 0;
  const statuses = rvm().statusByRefno.value;
  const ready = rvm().loggedIn.value && !!rvm().password.value;
  const waiting = new Set<string>();
  for (const entry of tasks.value) {
    if (!isIncrementalTask(entry) || autoDone.has(entry.task_id)) continue;
    if (new Date(entry.finished_at!).getTime() < since) continue;
    const pending = taskPendingRoots(entry, statuses);
    if (pending.length === 0) {
      markDone(entry.task_id);
      continue;
    }
    if (!ready) {
      for (const root of pending) waiting.add(root.refno);
      continue;
    }
    autoQueued.value += rvm().enqueue(pending.map(targetOf));
    markDone(entry.task_id);
  }
  waitingLogin.value = waiting.size;
}

/** 已有请求在路上时复用它，调用方 await 到的总是一份落地后的快照 */
function refresh(): Promise<void> {
  inFlight ??= load().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const list = await genModelV1Tasks();
    tasks.value = Array.isArray(list.tasks) ? list.tasks : [];
    loaded.value = true;
    error.value = null;
    rvm().absorbTasks(tasks.value);
    runAuto();
  } catch (cause) {
    // 失败不作废上一份快照
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function syncTimer(): void {
  const active = subscribers > 0 || auto.value.enabled;
  if (active && !timer) {
    void refresh();
    timer = setInterval(() => void refresh(), POLL_MS);
  } else if (!active && timer) {
    clearInterval(timer);
    timer = null;
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

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;
  // 脱离调用方的作用域：首个调用者多半是组件，它卸载后登录监听还得在
  effectScope(true).run(() => {
    watch(rvm().loggedIn, (loggedIn) => {
      if (loggedIn) runAuto();
    });
  });
}

/** 订阅轮询：在组件 setup 里调用时随组件卸载自动退订。 */
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
    roots,
    rootByRefno,
    pendingSet,
    pendingByTask,
    autoEnabled,
    autoQueued,
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
  /** 只在待校验 / 过期时给出对应的那一轮 */
  root: IncrementalRoot | null;
  /** 没核对过也不在增量里：什么都不画 */
  empty: boolean;
};

/** 一个节点在所有位置统一显示的核对状态。不订阅轮询，只读共享状态，可在模板 / computed 里直接调。 */
export function rvmNodeBadge(refno: string | null | undefined): RvmNodeBadge {
  const key = rvmRefnoKey(refno);
  const status = key ? rvm().statusByRefno.value[key] ?? null : null;
  const root = key && pendingSet.value.has(key) ? rootByRefno.value.get(key) ?? null : null;
  return {
    verdict: status?.verdict ?? null,
    outdated: !!root,
    title: rvmBadgeTitle(status, root),
    status,
    root,
    empty: !status && !root,
  };
}

export function useRvmNodeBadge(refno: MaybeRefOrGetter<string | null | undefined>) {
  return computed(() => rvmNodeBadge(toValue(refno)));
}
