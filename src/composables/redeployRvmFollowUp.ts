/**
 * 重新部署每重建完一个库，就把这个库下的 SITE 排进 RVM 核对队列（`useRvmCheckStore` 串行跑，不挡部署）。
 *
 * 「重建完」认两处：`/health.storage_version.upgrade.done_dbnums` 新增的库，和「重试失败的库」里成功的逐库任务。
 * 同一趟（按 upgrade `started_at` 认）里一个库只排一次。只认本页看着完成的库：打开页面时这一趟里已经完成的
 * 不补跑。开关默认开、记在 localStorage。没登录 E3D TTY 时沿用队列的老规矩：弹登录窗，登录后接着跑。
 *
 * 结论不另存：逐 SITE 的状态现读核对 store 的 `statusByRefno`（入队即 `queued`，跑完是结论）和队列项
 * （取消 / 请求失败只在队列项上看得出来——取消会把树上的状态放回入队前的旧结论）。
 */

import { computed, ref, watch, type Ref } from 'vue';

import type { StorageVersionUpgradeHealth } from '@/api/genModelV1Api';
import type { AdminTaskView } from '@/composables/useModelGenerationAdmin';
import type { RvmNodeTarget, RvmQueueItem } from '@/composables/useRvmCheckStore';

import { rvmRefnoKey, type RvmNodeStatus, type RvmNodeVerdict } from '@/components/rvm-check/rvmCheckFormat';

const AUTO_KEY = 'redeploy-auto-rvm-check';

export type SiteTarget = RvmNodeTarget & { dbnum: number | null };

/** 本趟一个 SITE 的核对状态。`cancelled` / `request_error` 来自队列项，其余是树上的结论。 */
export type FollowUpSiteState = RvmNodeVerdict | 'cancelled' | 'request_error';

export type FollowUpSiteRow = {
  refno: string;
  name: string;
  dbnum: number | null;
  state: FollowUpSiteState;
  taskId: string | null;
  stage: string | null;
  message: string;
};

export type FollowUpSummary = { total: number; passed: number; failed: number; pending: number; stopped: number };

const PASSED: ReadonlySet<FollowUpSiteState> = new Set(['pass', 'empty']);
const PENDING: ReadonlySet<FollowUpSiteState> = new Set(['queued', 'running']);
const STOPPED: ReadonlySet<FollowUpSiteState> = new Set(['cancelled']);

/** 没通过、可以点进核对面板看原因的那几种 */
export function isFollowUpFailure(state: FollowUpSiteState): boolean {
  return !PASSED.has(state) && !PENDING.has(state) && !STOPPED.has(state);
}

export type RedeployRvmFollowUpDeps = {
  progress: Ref<StorageVersionUpgradeHealth | null>;
  tasks: Ref<AdminTaskView[]>;
  enabled: Ref<boolean>;
  collectSites: () => Promise<SiteTarget[]>;
  enqueue: (targets: RvmNodeTarget[]) => number;
  statusByRefno: Ref<Record<string, RvmNodeStatus>>;
  queue: Ref<RvmQueueItem[]>;
};

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createRedeployRvmFollowUp(deps: RedeployRvmFollowUpDeps) {
  /** 本趟已排过 RVM 的库 */
  const queuedDbnums = ref<number[]>([]);
  /** 本趟排进队列的 SITE 数 */
  const queuedSites = ref(0);
  /** 本趟这些库下的 SITE，按库完成先后；已在队列里没重复入队的也算 */
  const sites = ref<SiteTarget[]>([]);
  const error = ref<string | null>(null);

  let runKey: string | null | undefined;
  const handled = new Set<number>();
  let chain: Promise<void> = Promise.resolve();

  function resetRun(key: string | null): void {
    runKey = key;
    handled.clear();
    queuedDbnums.value = [];
    queuedSites.value = 0;
    sites.value = [];
    error.value = null;
  }

  async function queueSitesOf(dbnums: number[]): Promise<void> {
    try {
      const wanted = new Set(dbnums);
      const found = (await deps.collectSites()).filter((site) => site.dbnum != null && wanted.has(site.dbnum));
      queuedDbnums.value = [...new Set([...queuedDbnums.value, ...dbnums])].sort((a, b) => a - b);
      if (found.length === 0) return;
      queuedSites.value += deps.enqueue(found.map(({ refno, name, noun }) => ({ refno, name, noun })));
      const known = new Set(sites.value.map((site) => site.refno));
      const added = found
        .map((site) => ({ ...site, refno: rvmRefnoKey(site.refno) }))
        .filter((site) => site.refno && !known.has(site.refno) && known.add(site.refno));
      if (added.length > 0) sites.value = [...sites.value, ...added];
    } catch (cause) {
      error.value = `读 SITE 清单失败：${errorText(cause)}`;
    }
  }

  function handle(dbnums: number[]): void {
    const fresh = dbnums.filter((dbnum) => !handled.has(dbnum));
    if (fresh.length === 0) return;
    for (const dbnum of fresh) handled.add(dbnum);
    if (!deps.enabled.value) return;
    // 树接口串着调：两个库前后脚完成时不并发拉两遍
    chain = chain.then(() => queueSitesOf(fresh));
  }

  watch(deps.progress, (progress) => {
    if (!progress) return;
    const key = progress.started_at ?? null;
    const done = progress.done_dbnums ?? [];
    // 提交回执里可能还没有 started_at，第一拍 /health 补上时仍是同一趟
    if (runKey === null && key !== null && progress.state === 'running') runKey = key;
    if (key !== runKey) {
      resetRun(key);
      // 第一眼看到这一趟时已经完成的库是在本页盯上之前跑完的，不补跑
      for (const dbnum of done) handled.add(dbnum);
      return;
    }
    handle(done);
  }, { immediate: true });

  watch(deps.tasks, (tasks) => {
    handle(tasks.filter((task) => task.state === 'succeeded' && task.dbnum != null).map((task) => task.dbnum!));
  });

  const siteRows = computed<FollowUpSiteRow[]>(() => {
    const items = new Map<string, RvmQueueItem>();
    for (const item of deps.queue.value) items.set(item.refno, item);
    return sites.value.map((site) => {
      const status = deps.statusByRefno.value[site.refno];
      const item = items.get(site.refno);
      let state: FollowUpSiteState = status?.verdict ?? 'queued';
      if (item?.state === 'cancelled') state = 'cancelled';
      else if (item?.state === 'error') state = 'request_error';
      return {
        refno: site.refno,
        name: site.name || status?.name || site.refno,
        dbnum: site.dbnum,
        state,
        taskId: status?.taskId ?? item?.taskId ?? null,
        stage: status?.stage ?? item?.stage ?? null,
        message: (item?.state === 'error' || item?.state === 'cancelled' ? item.message : status?.message) || '',
      };
    });
  });

  const summary = computed<FollowUpSummary>(() => {
    const counts: FollowUpSummary = { total: siteRows.value.length, passed: 0, failed: 0, pending: 0, stopped: 0 };
    for (const row of siteRows.value) {
      if (PASSED.has(row.state)) counts.passed += 1;
      else if (PENDING.has(row.state)) counts.pending += 1;
      else if (STOPPED.has(row.state)) counts.stopped += 1;
      else counts.failed += 1;
    }
    return counts;
  });

  /** 等已排上的 SITE 收集跑完（测试用） */
  function settled(): Promise<void> {
    return chain;
  }

  return { queuedDbnums, queuedSites, siteRows, summary, error, settled };
}

function readEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}

export const autoRvmAfterRedeploy = ref(readEnabled());

watch(autoRvmAfterRedeploy, (enabled) => {
  try {
    globalThis.localStorage?.setItem(AUTO_KEY, enabled ? '1' : '0');
  } catch {
    // 存不下只影响下次默认值
  }
});
