<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { ChevronDown, ChevronRight, ExternalLink, ListChecks, ListPlus, Play, Plus, Square, Trash2 } from 'lucide-vue-next';

import { formatAt as formatStamp, stageLabel, verdictTone, type RvmNodeVerdict } from './rvmCheckFormat';
import RvmCheckResult from './RvmCheckResult.vue';
import RvmStatusIcon from './RvmStatusIcon.vue';

import type { IncrementalRoot } from './incrementalRvmTargets';
import type { IncrementalGroup } from '@/composables/useIncrementalRvmCheck';

import { rvmNodeBadge, useIncrementalRvmCheck } from '@/composables/useIncrementalRvmCheck';
import { useRvmCheckStore, type RvmQueueItem } from '@/composables/useRvmCheckStore';

/** 独立页没有三维视图，不给定位 */
withDefaults(defineProps<{ locatable?: boolean }>(), { locatable: true });

const store = useRvmCheckStore();
const { config, loggedIn, statusByRefno, statusCounts, queue, queueActive, queueNotice, collecting, viewedRun, viewError, historyError } = store;

const incremental = useIncrementalRvmCheck();
const { pendingSet, pendingByTask, loaded: incrementalLoaded, error: incrementalError } = incremental;
const leftTab = ref<'queue' | 'incremental'>('queue');
const collapsed = ref(new Set<string>());

/** 一次全量重建能出上千根，每组只画前面这些，整组入队不受影响 */
const GROUP_RENDER_LIMIT = 200;

function toggleGroup(taskId: string): void {
  const next = new Set(collapsed.value);
  if (next.has(taskId)) next.delete(taskId);
  else next.add(taskId);
  collapsed.value = next;
}

function groupTitle(group: IncrementalGroup): string {
  const round = group.sesno != null ? `第 ${group.sesno} 轮` : (group.taskKind === 'model_rebuild' ? '模型重建' : '数据批次');
  return `${round} · ${formatStamp(group.finishedAt)}`;
}

function rootNote(root: IncrementalRoot): string {
  const badge = rvmNodeBadge(root.refno);
  if (badge.verdict === 'queued') return '排队中';
  if (badge.verdict === 'running') return '核对中';
  if (!badge.status) return '从未校验';
  return `上次 ${verdictTone(badge.verdict).label}`;
}

function rootName(root: IncrementalRoot): string {
  return rvmNodeBadge(root.refno).status?.name || displayRefno(root.refno);
}

function openRoot(root: IncrementalRoot): void {
  const taskId = rvmNodeBadge(root.refno).status?.taskId;
  if (taskId) void store.openRun(taskId);
}

const report = computed(() => viewedRun.value?.result ?? null);
const viewedStatus = computed(() => {
  const run = viewedRun.value;
  if (!run) return null;
  const queued = queue.value.find((item) => item.taskId === run.task_id);
  return queued ?? null;
});
const pendingCount = computed(() => queue.value.filter((item) => item.state === 'queued').length);
const remainingCount = computed(() => queue.value.filter((item) => item.state === 'queued' || item.state === 'running').length);
const hasFinished = computed(() => queue.value.some((item) => item.state !== 'queued' && item.state !== 'running'));
const paused = computed(() => pendingCount.value > 0 && !queue.value.some((item) => item.state === 'running') && !!queueNotice.value);

/** `statusCounts.pending` 把核对中和排队混在一起，顶栏要分开显示 */
const liveCounts = computed(() => {
  let running = 0;
  let queued = 0;
  for (const status of Object.values(statusByRefno.value)) {
    if (status.verdict === 'running') running += 1;
    else if (status.verdict === 'queued') queued += 1;
  }
  return { running, queued };
});

type CountChip = { verdict: RvmNodeVerdict; label: string; count: number; always?: boolean; chip: string };
const countChips = computed<CountChip[]>(() => [
  { verdict: 'pass', label: '通过', count: statusCounts.value.pass, always: true, chip: verdictTone('pass').chip },
  { verdict: 'kind_differ', label: '种类不一致', count: statusCounts.value.kind_differ, chip: verdictTone('kind_differ').chip },
  { verdict: 'fail', label: '不一致', count: statusCounts.value.fail, always: true, chip: verdictTone('fail').chip },
  { verdict: 'external', label: '非几何', count: statusCounts.value.external, chip: verdictTone('external').chip },
  { verdict: 'empty', label: '无可比', count: statusCounts.value.empty, chip: verdictTone('empty').chip },
  { verdict: 'tool_error', label: '工具故障', count: statusCounts.value.tool_error, chip: verdictTone('tool_error').chip },
  { verdict: 'running', label: '核对中', count: liveCounts.value.running, chip: verdictTone(null).chip },
  { verdict: 'queued', label: '待跑', count: liveCounts.value.queued, chip: 'border-border bg-background text-muted-foreground' },
]);
const incrementalPending = computed(() => pendingSet.value.size);

function itemVerdict(item: RvmQueueItem): RvmNodeVerdict {
  if (item.state === 'done') {
    const key = verdictTone(item.verdict).verdict;
    return key === 'pending' ? 'fail' : key;
  }
  if (item.state === 'running') return 'running';
  if (item.state === 'queued') return 'queued';
  if (item.state === 'cancelled') return 'empty';
  return 'tool_error';
}

function itemAccent(item: RvmQueueItem): string {
  if (item.state === 'done') return verdictTone(item.verdict).accent;
  if (item.state === 'running') return verdictTone(null).accent;
  if (item.state === 'error') return verdictTone('fail').accent;
  return 'bg-zinc-400';
}

/** 第二行：默认 refno；跑着的写阶段，出错的写原因 */
function itemDetail(item: RvmQueueItem): { text: string; error: boolean } {
  if (item.state === 'running') return { text: [stageLabel(item.stage), item.message].filter(Boolean).join(' · '), error: false };
  if (item.state === 'error') return { text: item.message || '出错', error: true };
  if (item.state === 'done' && item.verdict === 'tool_error' && item.message) return { text: item.message, error: false };
  if (item.state === 'cancelled') return { text: `${displayRefno(item.refno)} · 已取消`, error: false };
  return { text: displayRefno(item.refno), error: false };
}

function displayRefno(refno: string): string {
  return refno.replace('_', '/');
}

function isViewed(item: RvmQueueItem): boolean {
  return !!viewedRun.value && item.taskId === viewedRun.value.task_id;
}

function openItem(item: RvmQueueItem): void {
  if (item.taskId) void store.openRun(item.taskId);
}

function openStandalone(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('page', 'rvm-check');
  window.open(url.toString(), '_blank', 'noopener');
}

const btnBase = 'inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 hover:bg-muted disabled:opacity-40';

onMounted(() => {
  void store.restoreFromHistory();
  void store.loadDefaults();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col text-foreground" data-testid="rvm-check-panel">
    <div class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
      <span v-if="loggedIn" class="inline-flex items-center gap-1.5 font-medium text-emerald-700" data-testid="rvm-check-login-state">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {{ config.username.toUpperCase() }} · {{ config.e3dProject || '未填项目码' }} · {{ config.e3dMdb }}
      </span>
      <span v-else class="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="rvm-check-login-state">
        <span class="h-1.5 w-1.5 rounded-full bg-zinc-300" />
        未登录 E3D TTY
      </span>
      <button type="button" :class="btnBase" @click="store.openLogin()">
        {{ loggedIn ? '重新登录' : '登录' }}
      </button>
      <span class="mx-1 h-4 w-px bg-border" />
      <button type="button"
        class="inline-flex items-center gap-1 rounded bg-foreground px-2 py-0.5 text-background disabled:opacity-40"
        :disabled="collecting"
        data-testid="rvm-check-run-all"
        @click="store.runAllSites()">
        <ListChecks class="h-3.5 w-3.5" />
        {{ collecting ? '收集 SITE…' : '全部 SITE 依次核对' }}
      </button>
      <button v-if="queueActive" type="button" :class="btnBase" @click="store.cancelQueue()">
        <Square class="h-3 w-3" />
        停止队列
      </button>
      <button v-if="paused" type="button" :class="btnBase" @click="store.resumeQueue()">
        <Play class="h-3 w-3" />
        继续队列
      </button>
      <button v-if="hasFinished" type="button" :class="btnBase" @click="store.clearFinished()">
        <Trash2 class="h-3 w-3" />
        清掉已完成
      </button>
      <span class="ml-auto flex flex-wrap items-center gap-1 text-[11px]" data-testid="rvm-check-counts">
        <template v-for="chip in countChips" :key="chip.verdict">
          <span v-if="chip.always || chip.count > 0" class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5" :class="chip.chip">
            <RvmStatusIcon :verdict="chip.verdict" />
            {{ chip.label }} {{ chip.count }}
          </span>
        </template>
        <button v-if="incrementalPending > 0" type="button"
          class="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700 hover:bg-blue-100"
          data-testid="rvm-check-incremental-count"
          @click="leftTab = 'incremental'">
          <RvmStatusIcon :verdict="null" :outdated="true" />
          待校验 {{ incrementalPending }}
        </button>
        <button v-if="locatable" type="button" class="ml-1 inline-flex items-center gap-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" @click="openStandalone">
          独立页
          <ExternalLink class="h-3 w-3" />
        </button>
      </span>
    </div>
    <p v-if="queueNotice" class="border-b border-border px-3 py-1 text-[11px] text-amber-700">{{ queueNotice }}</p>
    <p v-if="historyError" class="border-b border-border px-3 py-1 text-[11px] text-red-700">{{ historyError }}</p>
    <div class="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
      <aside class="flex min-h-0 flex-col border-r border-border bg-muted/30">
        <div class="flex items-center gap-3 border-b border-border px-3 text-[11px]" role="tablist">
          <button type="button" role="tab"
            class="-mb-px border-b-2 py-1.5"
            :class="leftTab === 'queue' ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
            :aria-selected="leftTab === 'queue'"
            data-testid="rvm-check-tab-queue"
            @click="leftTab = 'queue'">
            队列
          </button>
          <button type="button" role="tab"
            class="-mb-px border-b-2 py-1.5"
            :class="leftTab === 'incremental' ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
            :aria-selected="leftTab === 'incremental'"
            data-testid="rvm-check-tab-incremental"
            @click="leftTab = 'incremental'">
            增量待校验 ({{ incrementalPending }})
          </button>
          <span v-if="leftTab === 'queue' && queue.length" class="ml-auto text-muted-foreground" data-testid="rvm-check-queue-summary">{{ queue.length }} 项 · 剩 {{ remainingCount }}</span>
        </div>
        <template v-if="leftTab === 'incremental'">
          <p v-if="incrementalError" class="px-3 py-1 text-[11px] text-amber-700">任务表暂时读不到，下面是上一次的快照：{{ incrementalError }}</p>
          <p v-if="!incrementalLoaded" class="px-3 py-2 text-[11px] text-muted-foreground">正在读 /api/v1/tasks…</p>
          <p v-else-if="pendingByTask.length === 0" class="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            最近的增量重算过的根都已校验过。
          </p>
          <ul v-else class="min-h-0 flex-1 overflow-auto pb-1 text-xs" data-testid="rvm-check-incremental">
            <li v-for="group in pendingByTask" :key="group.taskId">
              <div class="flex items-center gap-1.5 bg-muted/60 px-2 py-1 text-[11px]">
                <button type="button" class="inline-flex min-w-0 flex-1 items-center gap-1 text-left" @click="toggleGroup(group.taskId)">
                  <ChevronRight v-if="collapsed.has(group.taskId)" class="h-3 w-3 shrink-0 text-muted-foreground" />
                  <ChevronDown v-else class="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span class="truncate font-medium">{{ groupTitle(group) }}</span>
                  <span class="shrink-0 rounded bg-blue-50 px-1 text-[10px] text-blue-700">{{ group.pending.length }} 根</span>
                </button>
                <button type="button"
                  :class="btnBase"
                  class="text-[10px]"
                  :disabled="group.pending.length === 0"
                  data-testid="rvm-check-incremental-group"
                  @click="incremental.checkRoots(group.pending)">
                  <ListPlus class="h-3 w-3" />
                  整组入队
                </button>
              </div>
              <ul v-if="!collapsed.has(group.taskId)">
                <li v-for="root in group.roots.slice(0, GROUP_RENDER_LIMIT)" :key="root.refno"
                  class="flex items-center gap-2 py-1 pl-6 pr-2 hover:bg-muted"
                  :title="rvmNodeBadge(root.refno).title">
                  <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="openRoot(root)">
                    <RvmStatusIcon :verdict="rvmNodeBadge(root.refno).verdict" :outdated="rvmNodeBadge(root.refno).outdated" />
                    <span class="shrink-0 text-[10px] text-muted-foreground">{{ root.noun }}</span>
                    <span class="truncate font-medium">{{ rootName(root) }}</span>
                    <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">{{ rootNote(root) }}</span>
                  </button>
                  <button v-if="rvmNodeBadge(root.refno).outdated" type="button"
                    class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                    title="单根入队"
                    data-testid="rvm-check-incremental-root"
                    @click="incremental.checkRoots([root])">
                    <Plus class="h-3 w-3" />
                  </button>
                </li>
                <li v-if="group.roots.length > GROUP_RENDER_LIMIT" class="py-1 pl-6 text-[10px] text-muted-foreground">
                  还有 {{ group.roots.length - GROUP_RENDER_LIMIT }} 根未列出，「整组入队」会一并排进去
                </li>
              </ul>
            </li>
          </ul>
          <p class="mt-auto border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">按 /api/v1/tasks 最近 200 条推导；更早的批次不在这里</p>
        </template>
        <p v-else-if="queue.length === 0" class="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          在模型树里右键一个节点选「核对 RVM」，或点上面的「全部 SITE 依次核对」。核对过的节点在树上会带一个状态图标，点图标看结果。
        </p>
        <ul v-else-if="leftTab === 'queue'" class="min-h-0 flex-1 overflow-auto pb-1 text-xs" data-testid="rvm-check-queue">
          <li v-for="item in queue" :key="`${item.refno}-${item.taskId ?? 'pending'}`" class="relative">
            <span v-if="isViewed(item)" class="absolute inset-y-0 left-0 w-0.5" :class="itemAccent(item)" />
            <button type="button"
              class="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-muted disabled:cursor-default"
              :class="isViewed(item) ? 'bg-background' : ''"
              :disabled="!item.taskId"
              :title="item.message || item.refno"
              @click="openItem(item)">
              <span class="mt-0.5 shrink-0"><RvmStatusIcon :verdict="itemVerdict(item)" /></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate">
                  <span class="text-[10px] text-muted-foreground">{{ item.noun }}</span>
                  <span class="ml-1" :class="isViewed(item) ? 'font-semibold' : 'font-medium'">{{ item.name || displayRefno(item.refno) }}</span>
                </span>
                <span class="block truncate font-mono text-[10px]" :class="itemDetail(item).error ? 'text-red-700' : 'text-muted-foreground'">
                  {{ itemDetail(item).text }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </aside>
      <main class="flex min-h-0 flex-col gap-2 overflow-auto p-3">
        <p v-if="viewError" class="text-xs text-red-700">{{ viewError }}</p>
        <template v-if="viewedRun">
          <RvmCheckResult v-if="report"
            :task-id="viewedRun.task_id"
            :report="report"
            :at="viewedRun.finished_at ?? viewedRun.started_at"
            :locatable="locatable" />
          <template v-else>
            <div class="text-xs text-muted-foreground">
              {{ viewedStatus?.noun }} {{ viewedStatus?.name }}
              <span class="ml-1">{{ viewedRun.detail?.refno }}</span>
            </div>
            <p class="text-xs text-sky-800">正在{{ stageLabel(viewedRun.stage) }}…</p>
          </template>
        </template>
        <p v-else-if="!viewError" class="text-xs text-muted-foreground">点左边的条目或树上的状态图标看结果。</p>
      </main>
    </div>
  </div>
</template>
