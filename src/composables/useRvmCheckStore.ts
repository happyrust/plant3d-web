/**
 * RVM 核对的共享状态：E3D TTY 登录、各节点最新结论、串行队列。模块级单例，
 * 模型树、停靠面板、独立页和登录弹窗看到的是同一份。
 *
 * 密码只放在这个模块的内存里，不进 localStorage；刷新页面后要重新登录。
 */

import { computed, reactive, ref, shallowRef } from 'vue';

import {
  genModelV1Fetch,
  genModelV1TaskGet,
  genModelV1TreeChildren,
  genModelV1TreeRoots,
  isGenModelV1ApiError,
  toV1Refno,
  type EleTreeNodeDto,
  type TaskEntryDto,
  type TaskListEntryDto,
} from '@/api/genModelV1Api';
import {
  fetchRvmCheckDefaults,
  fetchRvmCheckFileText,
  getRvmCheckRun,
  preflightRvmCheck,
  RVM_CHECK_E3D_LOG,
  startRvmCheckRun,
  type PreflightReport,
  type RvmCheckConnection,
  type RvmCheckDefaults,
  type RvmCheckReport,
  type RvmCheckRun,
} from '@/api/rvmCheckApi';
import {
  isTerminalState,
  latestStatusByRefno,
  rvmRefnoKey,
  statusFromRun,
  type RvmNodeStatus,
} from '@/components/rvm-check/rvmCheckFormat';
import { classifyReport, parseE3dLog, type E3dLogInfo } from '@/components/rvm-check/rvmMismatchReason';
import { emitToast } from '@/ribbon/toastBus';

const STORAGE_KEY = 'rvm-check-config';
const POLL_MS = 2_000;
const BUSY_RETRY_MS = 5_000;
const HISTORY_LIMIT = 160;
const LOGIN_FAILURE = /登录|login|密码|password/i;

export type RvmCheckConfig = {
  installDir: string;
  projectsDir: string;
  projectName: string;
  e3dProject: string;
  username: string;
  e3dMdb: string;
};

export type RvmQueueState = 'queued' | 'running' | 'done' | 'cancelled' | 'error';

export type RvmQueueItem = {
  refno: string;
  name: string;
  noun: string;
  state: RvmQueueState;
  taskId: string | null;
  stage: string | null;
  verdict: string | null;
  message: string;
  /** 入队前的结论；取消或请求失败时放回树上 */
  previous: RvmNodeStatus | null;
};

export type RvmNodeTarget = { refno: string; name?: string; noun?: string };

function readStored(): RvmCheckConfig {
  const empty: RvmCheckConfig = {
    installDir: '',
    projectsDir: '',
    projectName: '',
    e3dProject: '',
    username: '',
    e3dMdb: '/ALL',
  };
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const stored = JSON.parse(raw) as Partial<Record<keyof RvmCheckConfig, string>>;
    return {
      installDir: stored.installDir ?? '',
      projectsDir: stored.projectsDir ?? '',
      projectName: stored.projectName ?? '',
      e3dProject: stored.e3dProject ?? '',
      username: stored.username ?? '',
      e3dMdb: stored.e3dMdb || '/ALL',
    };
  } catch {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    return empty;
  }
}

function errorText(cause: unknown): string {
  if (isGenModelV1ApiError(cause)) return cause.message;
  return cause instanceof Error ? cause.message : String(cause);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toRun(entry: TaskEntryDto | TaskListEntryDto): RvmCheckRun {
  const value = entry as TaskListEntryDto;
  return {
    task_id: value.task_id,
    state: value.state,
    stage: value.current_stage ?? null,
    detail: (value.detail as Record<string, unknown> | null | undefined) ?? null,
    result: (value.result as RvmCheckReport | null | undefined) ?? null,
    started_at: value.started_at ?? null,
    finished_at: value.finished_at ?? null,
    created_at: value.created_at ?? null,
    units_done: value.units_done ?? null,
    total_units: value.total_units ?? null,
    dbnum: value.dbnum ?? null,
    db_type: value.db_type ?? null,
  };
}

const config = reactive<RvmCheckConfig>(readStored());
const password = ref('');
const loggedIn = ref(false);
const defaults = ref<RvmCheckDefaults | null>(null);
const checking = ref<'env' | 'login' | null>(null);
const preflight = ref<PreflightReport | null>(null);
const formError = ref<string | null>(null);
const loginDialogOpen = ref(false);

const statusByRefno = ref<Record<string, RvmNodeStatus>>({});
const queue = ref<RvmQueueItem[]>([]);
const queueNotice = ref<string | null>(null);
const collecting = ref(false);
const viewedRun = shallowRef<RvmCheckRun | null>(null);
const viewError = ref<string | null>(null);
const historyError = ref<string | null>(null);

const runCache = new Map<string, RvmCheckRun>();
/** 跑完的任务 e3d.log 不会再变，按任务缓存解析结果 */
const e3dLogCache = new Map<string, Promise<E3dLogInfo | null>>();
const followed = new Set<string>();
let loginWaiters: ((ok: boolean) => void)[] = [];
let defaultsRequest: Promise<void> | null = null;
let historyRequest: Promise<void> | null = null;
let pumping = false;
let stopRequested = false;
/** 结果区跟着队列走；用户手动点开某次结果后不再自动切走 */
let followQueue = true;

const statusCounts = computed(() => {
  const counts = { pass: 0, kind_differ: 0, fail: 0, external: 0, empty: 0, tool_error: 0, pending: 0 };
  for (const status of Object.values(statusByRefno.value)) {
    if (status.verdict === 'running' || status.verdict === 'queued') counts.pending += 1;
    else counts[status.verdict] += 1;
  }
  return counts;
});

const queueActive = computed(() => queue.value.some((item) => item.state === 'queued' || item.state === 'running'));

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ ...config }));
  } catch {
    // 存不下只影响下次预填
  }
}

function connection(): RvmCheckConnection {
  return {
    install_dir: config.installDir.trim(),
    projects_dir: config.projectsDir.trim(),
    project_name: config.projectName.trim(),
    e3d_project: config.e3dProject.trim(),
    username: config.username.trim(),
    password: password.value,
    e3d_mdb: config.e3dMdb.trim(),
  };
}

function loadDefaults(): Promise<void> {
  defaultsRequest ??= (async () => {
    try {
      const loaded = await fetchRvmCheckDefaults();
      defaults.value = loaded;
      if (!config.projectsDir) config.projectsDir = loaded.projects_dir;
      if (!config.projectName) config.projectName = loaded.project_name;
      if (!config.e3dProject && loaded.e3d_project) config.e3dProject = loaded.e3d_project;
      if (!config.e3dMdb) config.e3dMdb = loaded.mdb;
      persist();
    } catch (cause) {
      defaultsRequest = null;
      formError.value = isGenModelV1ApiError(cause) ? cause.message : '读不到服务端默认值';
    }
  })();
  return defaultsRequest;
}

async function runPreflight(tryLogin: boolean): Promise<PreflightReport | null> {
  formError.value = null;
  if (tryLogin && (!config.username.trim() || !password.value)) {
    formError.value = '先填用户名和密码';
    return null;
  }
  preflight.value = null;
  checking.value = tryLogin ? 'login' : 'env';
  persist();
  try {
    const report = await preflightRvmCheck(connection(), tryLogin);
    preflight.value = report;
    if (tryLogin) {
      loggedIn.value = report.login_ok === true;
      if (loggedIn.value) {
        emitToast({ message: `已登录 E3D TTY：${config.username.trim().toUpperCase()} · ${config.e3dProject.trim() || '未填项目码'} · ${config.e3dMdb.trim()}`, level: 'success' });
      }
    }
    return report;
  } catch (cause) {
    formError.value = errorText(cause);
    if (tryLogin) loggedIn.value = false;
    return null;
  } finally {
    checking.value = null;
  }
}

/** 这个标签页还没登录过 E3D TTY 就弹登录窗，等用户登录成功（true）或取消（false）。 */
function ensureLogin(): Promise<boolean> {
  if (loggedIn.value && password.value) return Promise.resolve(true);
  loginDialogOpen.value = true;
  return new Promise((resolve) => {
    loginWaiters.push(resolve);
  });
}

function openLogin(): void {
  loginDialogOpen.value = true;
}

function resolveLogin(ok: boolean): void {
  loginDialogOpen.value = false;
  const waiters = loginWaiters;
  loginWaiters = [];
  for (const resolve of waiters) resolve(ok);
}

function logout(): void {
  password.value = '';
  loggedIn.value = false;
}

function setStatus(refno: string, status: RvmNodeStatus | null): void {
  const next = { ...statusByRefno.value };
  if (status) next[refno] = status;
  else delete next[refno];
  statusByRefno.value = next;
}

function statusOf(refno: string): RvmNodeStatus | null {
  return statusByRefno.value[rvmRefnoKey(refno)] ?? null;
}

function rememberRun(run: RvmCheckRun): void {
  runCache.set(run.task_id, run);
  const status = statusFromRun(run);
  if (status) setStatus(status.refno, status);
  if (viewedRun.value?.task_id === run.task_id) viewedRun.value = run;
}

function enqueue(targets: RvmNodeTarget[]): number {
  let added = 0;
  for (const target of targets) {
    const refno = rvmRefnoKey(target.refno);
    if (!refno) continue;
    if (queue.value.some((item) => item.refno === refno && (item.state === 'queued' || item.state === 'running'))) continue;
    const previous = statusByRefno.value[refno] ?? null;
    queue.value.push({
      refno,
      name: target.name ?? '',
      noun: target.noun ?? '',
      state: 'queued',
      taskId: null,
      stage: null,
      verdict: null,
      message: '',
      previous,
    });
    setStatus(refno, {
      refno,
      verdict: 'queued',
      taskId: null,
      at: new Date().toISOString(),
      sesno: previous?.sesno ?? null,
      message: '',
      name: target.name ?? previous?.name ?? null,
      stage: null,
      reasons: '',
    });
    added += 1;
  }
  if (added > 0) {
    queueNotice.value = null;
    followQueue = true;
    void pump();
  }
  return added;
}

async function startTask(item: RvmQueueItem): Promise<string | null> {
  for (;;) {
    try {
      const accepted = await startRvmCheckRun(connection(), toV1Refno(item.refno));
      return accepted.task_id;
    } catch (cause) {
      if (isGenModelV1ApiError(cause) && cause.status === 409 && !stopRequested) {
        item.message = '另一次比对还在跑，稍后重试';
        await sleep(BUSY_RETRY_MS);
        continue;
      }
      item.state = stopRequested ? 'cancelled' : 'error';
      item.message = stopRequested ? '已取消' : errorText(cause);
      setStatus(item.refno, item.previous);
      return null;
    }
  }
}

async function runOne(item: RvmQueueItem): Promise<void> {
  item.state = 'running';
  item.stage = 'queued';
  item.message = '';
  setStatus(item.refno, {
    refno: item.refno,
    verdict: 'running',
    taskId: null,
    at: new Date().toISOString(),
    sesno: item.previous?.sesno ?? null,
    message: '',
    name: item.name || null,
    stage: 'queued',
    reasons: '',
  });
  const taskId = await startTask(item);
  if (!taskId) return;
  item.taskId = taskId;
  if (followQueue) {
    viewedRun.value = null;
    viewError.value = null;
  }
  for (;;) {
    try {
      const run = await getRvmCheckRun(taskId);
      if (followQueue && viewedRun.value?.task_id !== taskId) viewedRun.value = run;
      rememberRun(run);
      item.stage = run.stage;
      if (isTerminalState(run.state)) {
        const report = run.result;
        item.state = 'done';
        item.verdict = report ? classifyReport(report).nodeVerdict : 'fail';
        item.message = report?.message ?? '';
        if (report && report.verdict === 'fail' && report.stage === 'e3d_export' && LOGIN_FAILURE.test(report.message)) {
          loggedIn.value = false;
          queueNotice.value = 'E3D 登录没有通过，重新登录后队列会接着跑';
        }
        return;
      }
    } catch (cause) {
      item.message = errorText(cause);
      if (isGenModelV1ApiError(cause) && cause.status === 404) {
        item.state = 'error';
        setStatus(item.refno, item.previous);
        return;
      }
    }
    await sleep(POLL_MS);
  }
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  stopRequested = false;
  try {
    for (;;) {
      if (stopRequested) break;
      const item = queue.value.find((entry) => entry.state === 'queued');
      if (!item) break;
      if (!loggedIn.value || !password.value) {
        const ok = await ensureLogin();
        if (!ok) {
          queueNotice.value = '没有登录 E3D TTY，队列已暂停';
          break;
        }
      }
      await runOne(item);
    }
  } finally {
    pumping = false;
  }
}

/** 登录取消或失败后接着跑剩下的。 */
function resumeQueue(): void {
  queueNotice.value = null;
  void pump();
}

/** 没开跑的取消；正在跑的那一项后端停不下来，跑完就停。 */
function cancelQueue(): void {
  stopRequested = true;
  let cancelled = 0;
  for (const item of queue.value) {
    if (item.state !== 'queued') continue;
    item.state = 'cancelled';
    item.message = '已取消';
    setStatus(item.refno, item.previous);
    cancelled += 1;
  }
  const running = queue.value.some((item) => item.state === 'running');
  queueNotice.value = running
    ? `已取消 ${cancelled} 项，正在跑的那一项跑完就停`
    : `已取消 ${cancelled} 项`;
}

function clearFinished(): void {
  queue.value = queue.value.filter((item) => item.state === 'queued' || item.state === 'running');
}

async function collectSites(): Promise<RvmNodeTarget[]> {
  const roots = (await genModelV1TreeRoots()).nodes ?? [];
  const sites: RvmNodeTarget[] = [];
  const seen = new Set<string>();
  const add = (node: EleTreeNodeDto) => {
    if (String(node.noun).toUpperCase() !== 'SITE') return;
    const refno = rvmRefnoKey(node.refno);
    if (seen.has(refno)) return;
    seen.add(refno);
    sites.push({ refno, name: node.short_name || node.name, noun: node.noun });
  };
  for (const root of roots) {
    if (String(root.noun).toUpperCase() === 'SITE') {
      add(root);
    } else if (root.children_count > 0) {
      const children = (await genModelV1TreeChildren(root.refno)).nodes ?? [];
      children.forEach(add);
    }
  }
  return sites;
}

/** 收集模型树里所有 SITE，登录后依次入队。返回入队数。 */
async function runAllSites(): Promise<number> {
  collecting.value = true;
  queueNotice.value = null;
  try {
    const sites = await collectSites();
    if (sites.length === 0) {
      queueNotice.value = '模型树里没有找到 SITE';
      return 0;
    }
    const ok = await ensureLogin();
    if (!ok) return 0;
    return enqueue(sites);
  } catch (cause) {
    queueNotice.value = `读 SITE 清单失败：${errorText(cause)}`;
    return 0;
  } finally {
    collecting.value = false;
  }
}

/** 盯一个别处发起、还没跑完的任务，让它的结论也落到树上。 */
async function follow(taskId: string): Promise<void> {
  if (followed.has(taskId)) return;
  followed.add(taskId);
  try {
    for (;;) {
      await sleep(POLL_MS);
      if (queue.value.some((item) => item.taskId === taskId)) return;
      const run = await getRvmCheckRun(taskId);
      rememberRun(run);
      if (isTerminalState(run.state)) return;
    }
  } catch {
    // 任务没了就不盯了；状态等下次刷新历史
  } finally {
    followed.delete(taskId);
  }
}

/** 从服务端任务历史（含落盘归档）还原每个节点最新的结论。`force` 时重拉。 */
function restoreFromHistory(force = false): Promise<void> {
  if (historyRequest && !force) return historyRequest;
  historyRequest = (async () => {
    try {
      const response = await genModelV1Fetch<{ tasks?: TaskListEntryDto[] }>('/api/v1/tasks', {
        query: { kind: 'rvm_check', limit: HISTORY_LIMIT },
      });
      const runs = (response.tasks ?? []).filter((entry) => entry.kind === 'rvm_check').map(toRun);
      for (const run of runs) runCache.set(run.task_id, run);
      const latest = latestStatusByRefno(runs);
      const active = new Set(
        queue.value.filter((item) => item.state === 'queued' || item.state === 'running').map((item) => item.refno),
      );
      const next = { ...statusByRefno.value };
      for (const [refno, status] of Object.entries(latest)) {
        if (active.has(refno)) continue;
        const current = next[refno];
        if (!current || (current.at ?? '') <= (status.at ?? '')) next[refno] = status;
      }
      statusByRefno.value = next;
      historyError.value = null;
      for (const run of runs) {
        if (!isTerminalState(run.state)) void follow(run.task_id);
      }
    } catch (cause) {
      historyRequest = null;
      historyError.value = `读核对历史失败：${errorText(cause)}`;
    }
  })();
  return historyRequest;
}

async function fetchRun(taskId: string): Promise<RvmCheckRun> {
  try {
    return await getRvmCheckRun(taskId);
  } catch (cause) {
    // `runs/{id}` 只查进程内注册表；重启前跑完的要去任务归档里取
    if (isGenModelV1ApiError(cause) && cause.status === 404) return toRun(await genModelV1TaskGet(taskId));
    throw cause;
  }
}

/** 在结果区打开某一次核对。 */
async function openRun(taskId: string): Promise<void> {
  followQueue = false;
  viewError.value = null;
  const cached = runCache.get(taskId);
  if (cached) viewedRun.value = cached;
  if (cached && isTerminalState(cached.state) && cached.result) return;
  try {
    const run = await fetchRun(taskId);
    runCache.set(run.task_id, run);
    viewedRun.value = run;
  } catch (cause) {
    if (!cached) viewError.value = errorText(cause);
  }
}

/** 结果页上的「重新核对」：没登录先弹登录窗，再排进队列。返回是否真的排进去了。 */
async function recheck(target: RvmNodeTarget): Promise<boolean> {
  const ok = await ensureLogin();
  return ok && enqueue([target]) > 0;
}

/** 读并解析某次核对的 e3d.log；读不到给 null，只是少分出「E3D 目录错误」这一类。 */
function loadE3dLog(taskId: string): Promise<E3dLogInfo | null> {
  let pending = e3dLogCache.get(taskId);
  if (!pending) {
    pending = fetchRvmCheckFileText(taskId, RVM_CHECK_E3D_LOG).then(parseE3dLog, () => {
      e3dLogCache.delete(taskId);
      return null;
    });
    e3dLogCache.set(taskId, pending);
  }
  return pending;
}

export function useRvmCheckStore() {
  return {
    config,
    password,
    loggedIn,
    defaults,
    checking,
    preflight,
    formError,
    loginDialogOpen,
    statusByRefno,
    statusCounts,
    queue,
    queueActive,
    queueNotice,
    collecting,
    viewedRun,
    viewError,
    historyError,
    persist,
    connection,
    loadDefaults,
    runPreflight,
    ensureLogin,
    openLogin,
    resolveLogin,
    logout,
    statusOf,
    enqueue,
    recheck,
    resumeQueue,
    cancelQueue,
    clearFinished,
    runAllSites,
    restoreFromHistory,
    openRun,
    loadE3dLog,
  };
}
