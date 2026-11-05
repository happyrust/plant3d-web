/**
 * 重新部署每重建完一个库，就把这个库下的 SITE 排进 RVM 核对队列（`useRvmCheckStore` 串行跑，不挡部署）。
 *
 * 「重建完」认两处：`/health.storage_version.upgrade.done_dbnums` 新增的库，和「重试失败的库」里成功的逐库任务。
 * 同一趟（按 upgrade `started_at` 认）里一个库只排一次。只认本页看着完成的库：打开页面时这一趟里已经完成的
 * 不补跑。开关默认开、记在 localStorage。没登录 E3D TTY 时沿用队列的老规矩：弹登录窗，登录后接着跑。
 */

import { ref, watch, type Ref } from 'vue';

import type { StorageVersionUpgradeHealth } from '@/api/genModelV1Api';
import type { AdminTaskView } from '@/composables/useModelGenerationAdmin';
import type { RvmNodeTarget } from '@/composables/useRvmCheckStore';

const AUTO_KEY = 'redeploy-auto-rvm-check';

export type SiteTarget = RvmNodeTarget & { dbnum: number | null };

export type RedeployRvmFollowUpDeps = {
  progress: Ref<StorageVersionUpgradeHealth | null>;
  tasks: Ref<AdminTaskView[]>;
  enabled: Ref<boolean>;
  collectSites: () => Promise<SiteTarget[]>;
  enqueue: (targets: RvmNodeTarget[]) => number;
};

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createRedeployRvmFollowUp(deps: RedeployRvmFollowUpDeps) {
  /** 本趟已排过 RVM 的库 */
  const queuedDbnums = ref<number[]>([]);
  /** 本趟排进队列的 SITE 数 */
  const queuedSites = ref(0);
  const error = ref<string | null>(null);

  let runKey: string | null | undefined;
  const handled = new Set<number>();
  let chain: Promise<void> = Promise.resolve();

  function resetRun(key: string | null): void {
    runKey = key;
    handled.clear();
    queuedDbnums.value = [];
    queuedSites.value = 0;
    error.value = null;
  }

  async function queueSitesOf(dbnums: number[]): Promise<void> {
    try {
      const wanted = new Set(dbnums);
      const sites = (await deps.collectSites()).filter((site) => site.dbnum != null && wanted.has(site.dbnum));
      queuedDbnums.value = [...new Set([...queuedDbnums.value, ...dbnums])].sort((a, b) => a - b);
      if (sites.length === 0) return;
      queuedSites.value += deps.enqueue(sites.map(({ refno, name, noun }) => ({ refno, name, noun })));
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

  /** 等已排上的 SITE 收集跑完（测试用） */
  function settled(): Promise<void> {
    return chain;
  }

  return { queuedDbnums, queuedSites, error, settled };
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
