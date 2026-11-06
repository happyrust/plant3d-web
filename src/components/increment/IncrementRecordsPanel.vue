<script setup lang="ts">
/**
 * 「增量记录」面板：gen-model `/api/v1/tasks` 的只读账本服。
 *
 * 每一轮增量（保存窗口 → 数据批次 → 模型生成 → 房间重算）在这里按时间轴排：
 * 保存窗口、增删改三数、逐单元发布方式（整根重算 / 刚体前移 ADR-066）、房间轮的
 * 面板 / 成员 / 死信计数。d-195 的口径没松——纯展示，不订阅、不反推、不据此
 * 重载任何已加载的根。
 *
 * 轮询走 `useIncrementalRvmCheck` 的共享订阅（5s，面板活着或自动校验打开时才打）；`/tasks` 服务端是
 * 200 条窗口，更早的批次看不到了就照实说，不猜。数据批次 / 模型重建落地后，可以对本轮重算过的
 * 生成根发起 RVM 校验：单条、勾选批量，或打开自动校验。
 */
import { computed, ref } from 'vue';

import {
  ChevronDown,
  CircleCheck,
  CircleX,
  DoorOpen,
  FilePlus2,
  GitCommitHorizontal,
  GitMerge,
  LoaderCircle,
  Package,
  RefreshCw,
  ScanSearch,
  TriangleAlert,
  X,
} from 'lucide-vue-next';

import {
  batchOf,
  changeSummary,
  elapsedLabel,
  isAbsorbed,
  mergedSavesLabel,
  recordKindLabel,
  recordStateChip,
  roomCounts,
  saveWindowLabel,
  sesnoRangeLabel,
  terminalTimes,
  transformRoots,
  unitKindLabel,
  unitsOf,
  warningsOf,
  type RecordKind,
} from './incrementRecordFormat';

import type { TaskListEntryDto } from '@/api/genModelV1Api';

import { batchCheckSummary, rootsOfTask, taskPendingRoots } from '@/components/rvm-check/incrementalRvmTargets';
import RvmStatusIcon from '@/components/rvm-check/RvmStatusIcon.vue';
import { rvmNodeBadge, useIncrementalRvmCheck } from '@/composables/useIncrementalRvmCheck';
import { useRvmCheckStore } from '@/composables/useRvmCheckStore';

const incremental = useIncrementalRvmCheck();
/** `loaded` 还没成功取到过一次时为 false（画「还没连上」而不是空账本） */
const { tasks, loaded, loading, error, autoEnabled, autoQueued, waitingLogin, refresh } = incremental;
const rvm = useRvmCheckStore();
const selected = ref(new Set<string>());
const expanded = ref(new Set<string>());
const filter = ref<RecordKind | 'all'>('all');

const filters: { key: RecordKind | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'data_batch', label: '数据批次' },
  { key: 'room_recalc', label: '房间' },
  { key: 'model_rebuild', label: '模型重建' },
];

const entries = computed(() =>
  tasks.value.filter((entry) => entry.kind !== 'rvm_check'
    && (filter.value === 'all' || recordKindLabel(entry.kind).key === filter.value)),
);

/** 一次全量重建能有上千根，模板里每行要读好几次，按任务缓存一份 */
const summaries = computed(() => {
  const statuses = rvm.statusByRefno.value;
  const map = new Map<string, ReturnType<typeof batchCheckSummary>>();
  for (const entry of tasks.value) {
    if (rootsOfTask(entry).length > 0) map.set(entry.task_id, batchCheckSummary(entry, statuses));
  }
  return map;
});

const EMPTY_SUMMARY = { total: 0, pending: 0, running: 0, pass: 0, mismatch: 0, failed: 0, other: 0 };

function summaryOf(entry: TaskListEntryDto) {
  return summaries.value.get(entry.task_id) ?? EMPTY_SUMMARY;
}

function pendingCount(entry: TaskListEntryDto): number {
  return summaryOf(entry).pending;
}

/** 能勾选的：落地后有生成根的记录 */
function checkable(entry: TaskListEntryDto): boolean {
  return summaries.value.has(entry.task_id);
}

function toggleSelected(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

const selectedEntries = computed(() => entries.value.filter((entry) => selected.value.has(entry.task_id)));
const selectedPending = computed(() => {
  const seen = new Set<string>();
  for (const entry of selectedEntries.value) {
    for (const root of taskPendingRoots(entry, rvm.statusByRefno.value)) seen.add(root.refno);
  }
  return seen.size;
});
const checkableEntries = computed(() => entries.value.filter(checkable));
const allSelected = computed(() => checkableEntries.value.length > 0
  && checkableEntries.value.every((entry) => selected.value.has(entry.task_id)));

function toggleAll(): void {
  selected.value = allSelected.value ? new Set() : new Set(checkableEntries.value.map((entry) => entry.task_id));
}

async function checkSelected(): Promise<void> {
  await incremental.checkTasks(selectedEntries.value);
  selected.value = new Set();
}

function checkOne(entry: TaskListEntryDto): void {
  void incremental.checkTasks([entry]);
}

/**
 * 只给展开记录的前 UNIT_BADGE_LIMIT 根画核对图标：一次全量重建展开有几千行，每行一个图标组件，
 * 6772 行实测展开从 1s 拖到 4s+。整批状态看汇总标签和 RVM 核对面板。
 */
const UNIT_BADGE_LIMIT = 300;
const unitBadges = computed(() => {
  const map = new Map<string, (ReturnType<typeof rvmNodeBadge> | null)[]>();
  for (const entry of tasks.value) {
    if (!expanded.value.has(entry.task_id)) continue;
    map.set(entry.task_id, unitsOf(entry).slice(0, UNIT_BADGE_LIMIT).map((unit) => {
      if (unit.status !== 'generated') return null;
      const badge = rvmNodeBadge(unit.root_refno);
      return badge.empty ? null : badge;
    }));
  }
  return map;
});

function unitBadge(entry: TaskListEntryDto, index: number) {
  return unitBadges.value.get(entry.task_id)?.[index] ?? null;
}

function toggle(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function kindIcon(key: RecordKind) {
  switch (key) {
    case 'data_batch': return GitCommitHorizontal;
    case 'room_recalc': return DoorOpen;
    case 'model_rebuild': return Package;
    default: return FilePlus2;
  }
}

const chipTone: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <!-- Header -->
    <div class="flex items-start justify-between border-b border-border px-5 py-3">
      <div>
        <div class="text-sm font-bold text-foreground">增量记录</div>
        <div class="mt-0.5 text-[11px] text-muted-foreground">
          每一轮保存窗口落地的账：数据批次、模型生成、房间重算。`/tasks` 只留最近 200 条。
        </div>
      </div>
      <div class="flex items-center gap-2">
        <LoaderCircle v-if="loading" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <label class="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-700"
          title="增量落地后自动把本轮重算过的生成根排进 RVM 核对队列；只处理打开之后落地的批次">
          自动校验
          <input v-model="autoEnabled" type="checkbox" role="switch" class="peer sr-only" data-testid="increment-rvm-auto" />
          <span class="relative inline-flex h-3.5 w-6 items-center rounded-full bg-gray-300 transition-colors peer-checked:bg-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-brand">
            <span class="absolute left-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform" :class="autoEnabled ? 'translate-x-2.5' : ''" />
          </span>
        </label>
        <button type="button"
          class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-white"
          @click="refresh">
          <RefreshCw class="h-3 w-3" /> 刷新
        </button>
      </div>
    </div>

    <!-- 任务表单独失败时的降级条幅：快照还在，但要说清这是旧账 -->
    <div v-if="error" class="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2" role="status">
      <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <div class="text-[11px] leading-relaxed text-amber-800">
        任务表暂时读不到，下面是上一次取到的快照：{{ error }}
      </div>
    </div>

    <div v-if="autoEnabled && waitingLogin > 0" class="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-1.5 text-[11px] text-amber-800" role="status" data-testid="increment-rvm-waiting-login">
      <TriangleAlert class="h-3.5 w-3.5 shrink-0 text-amber-600" />
      自动校验等待登录 · 已累计 {{ waitingLogin }} 根
      <button type="button" class="ml-auto rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold hover:bg-amber-100" @click="rvm.openLogin()">登录 E3D</button>
    </div>
    <div v-else-if="autoEnabled" class="flex items-center gap-2 border-b border-sky-200 bg-sky-50 px-5 py-1.5 text-[11px] text-sky-800" role="status">
      增量落地后自动入队 · 本次已入队 {{ autoQueued }} 根
      <button v-if="rvm.queueActive.value" type="button" class="ml-auto rounded border border-sky-300 bg-white px-2 py-0.5 font-semibold hover:bg-sky-100" @click="rvm.cancelQueue()">停止队列</button>
    </div>

    <!-- 批量栏 -->
    <div v-if="selected.size > 0" class="flex items-center gap-2 border-b border-sky-200 bg-sky-50 px-5 py-1.5 text-[11px]" data-testid="increment-rvm-batch">
      <span class="text-sky-800">已选 {{ selected.size }} 条 · 共 {{ selectedPending }} 根待校验</span>
      <button type="button" class="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-gray-700 hover:bg-gray-50" @click="selected = new Set()">
        <X class="h-3 w-3" /> 取消选择
      </button>
      <button type="button"
        class="inline-flex items-center gap-1 rounded-lg bg-foreground px-2 py-0.5 font-semibold text-background disabled:opacity-40"
        :disabled="selectedPending === 0"
        data-testid="increment-rvm-batch-check"
        @click="checkSelected">
        <ScanSearch class="h-3 w-3" /> RVM 校验 {{ selectedPending }} 根
      </button>
    </div>

    <!-- 类型筛 -->
    <div class="flex items-center gap-1.5 border-b border-border px-5 py-2">
      <input v-if="checkableEntries.length > 0" type="checkbox" class="mr-1 h-3 w-3"
        :checked="allSelected"
        aria-label="全选可校验的记录"
        @change="toggleAll" />
      <button v-for="item in filters" :key="item.key"
        type="button"
        class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors"
        :class="filter === item.key
          ? 'border-brand bg-brand-subtle text-brand'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'"
        @click="filter = item.key">
        {{ item.label }}
      </button>
      <span class="ml-auto text-[11px] text-muted-foreground">{{ entries.length }} 条记录</span>
    </div>

    <!-- 列表 -->
    <div class="flex-1 overflow-y-auto px-3 py-2">
      <div v-if="!loaded" class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <GitCommitHorizontal class="h-7 w-7" />
        <div class="text-xs">还没连上模型服务：增量账本读 `/api/v1/tasks`，连上后这里就有内容</div>
      </div>
      <div v-else-if="entries.length === 0" class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <GitCommitHorizontal class="h-7 w-7" />
        <div class="text-xs">还没有增量批次落地过：保存窗口进来之后，每一轮的账在这里按时间排</div>
      </div>

      <div v-for="entry in entries" :key="entry.task_id"
        class="mb-1 rounded-lg border bg-white"
        :class="selected.has(entry.task_id) ? 'border-sky-400' : 'border-gray-200'">
        <div class="flex items-start">
          <input v-if="checkable(entry)" type="checkbox" class="ml-3 mt-2.5 h-3 w-3 shrink-0"
            :checked="selected.has(entry.task_id)"
            :aria-label="`选择${recordKindLabel(entry.kind).label} ${entry.task_id}`"
            data-testid="increment-rvm-select"
            @change="toggleSelected(entry.task_id)" />
          <button type="button" class="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2 text-left" @click="toggle(entry.task_id)">
            <!-- 主行：类型 + 库号 + 保存窗口 + 状态芯片 -->
            <div class="flex items-center gap-2">
              <component :is="kindIcon(recordKindLabel(entry.kind).key)" class="h-3.5 w-3.5 shrink-0 text-brand" />
              <span class="text-xs font-bold text-foreground">{{ recordKindLabel(entry.kind).label }}</span>
              <span v-if="entry.dbnum != null" class="text-[11px] text-muted-foreground">库 {{ entry.dbnum }}</span>
              <span v-if="saveWindowLabel(entry)" class="font-mono text-[11px] text-muted-foreground">{{ saveWindowLabel(entry) }}</span>
              <span class="ml-auto flex items-center gap-1.5">
                <span class="rounded-full border px-2 py-0.5 text-[11px] font-medium" :class="chipTone[recordStateChip(entry.state).tone]">
                  {{ recordStateChip(entry.state).text }}
                </span>
                <ChevronDown class="h-3.5 w-3.5 text-muted-foreground transition-transform" :class="expanded.has(entry.task_id) && 'rotate-180'" />
              </span>
            </div>
            <!-- 次行：会话区间 + 变化摘要 + 单元进度 + 耗时 -->
            <div class="flex items-center gap-3 pl-5 text-[11px] text-muted-foreground">
              <span v-if="sesnoRangeLabel(entry)" class="font-mono">{{ sesnoRangeLabel(entry) }}</span>
              <span v-if="changeSummary(batchOf(entry))" class="text-gray-600">{{ changeSummary(batchOf(entry)) }}</span>
              <span v-if="entry.total_units != null">单元 {{ entry.units_done ?? 0 }}/{{ entry.total_units }}</span>
              <span v-if="elapsedLabel(entry)" class="ml-auto font-mono">{{ elapsedLabel(entry) }}</span>
            </div>
            <!-- RVM 校验汇总：只有落地后有生成根的记录才有 -->
            <div v-if="checkable(entry)" class="flex flex-wrap items-center gap-1.5 pl-5 text-[11px]" data-testid="increment-rvm-summary">
              <span v-if="summaryOf(entry).pending" class="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">待校验 {{ summaryOf(entry).pending }}</span>
              <span v-if="summaryOf(entry).running" class="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-600">运行中 {{ summaryOf(entry).running }}</span>
              <span v-if="summaryOf(entry).pass" class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">通过 {{ summaryOf(entry).pass }}</span>
              <span v-if="summaryOf(entry).mismatch" class="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">不一致 {{ summaryOf(entry).mismatch }}</span>
              <span v-if="summaryOf(entry).failed" class="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-600">失败 {{ summaryOf(entry).failed }}</span>
              <span v-if="summaryOf(entry).other" class="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-600">其它 {{ summaryOf(entry).other }}</span>
            </div>
          </button>
          <button v-if="checkable(entry)" type="button"
            class="mr-3 mt-2 inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            :disabled="pendingCount(entry) === 0"
            data-testid="increment-rvm-check"
            @click="checkOne(entry)">
            <ScanSearch class="h-3 w-3" />
            {{ pendingCount(entry) > 0 ? `RVM 校验 ${pendingCount(entry)} 根` : '已全部校验' }}
          </button>
        </div>

        <!-- 展开明细：批次判定 + 并入保存 + 逐单元 + 房间计数 + 告警 -->
        <div v-if="expanded.has(entry.task_id)" class="border-t border-gray-100 px-3 py-2 text-[11px]">
          <div v-if="isAbsorbed(entry)" class="flex items-center gap-1.5 py-0.5 text-brand">
            <GitMerge class="h-3.5 w-3.5" /> 已被运行中批次吸收
          </div>
          <template v-if="batchOf(entry)">
            <div class="flex items-center gap-1.5 py-0.5" :class="batchOf(entry)!.status === 'failed' ? 'text-red-700' : 'text-foreground'">
              <CircleCheck v-if="batchOf(entry)!.status === 'applied'" class="h-3.5 w-3.5 text-emerald-600" />
              <CircleX v-else-if="batchOf(entry)!.status === 'failed'" class="h-3.5 w-3.5 text-red-600" />
              <TriangleAlert v-else class="h-3.5 w-3.5 text-muted-foreground" />
              {{ batchOf(entry)!.status === 'applied' ? '已应用' : batchOf(entry)!.status === 'failed' ? '批次失败' : '已跳过' }}
            </div>
            <div v-if="batchOf(entry)!.message" class="py-0.5 pl-5" :class="batchOf(entry)!.status === 'failed' ? 'text-red-700' : 'text-muted-foreground'">
              {{ batchOf(entry)!.message }}
            </div>
            <div v-if="(batchOf(entry)!.merged_sesnos ?? []).length > 0" class="flex items-center gap-1.5 py-0.5 text-brand">
              <GitMerge class="h-3.5 w-3.5" /> 预览后并入 {{ batchOf(entry)!.merged_sesnos!.length }} 次保存
            </div>
            <div v-if="mergedSavesLabel(batchOf(entry)!)" class="py-0.5 pl-5 font-mono text-muted-foreground">
              {{ mergedSavesLabel(batchOf(entry)!) }}
            </div>
            <div v-if="changeSummary(batchOf(entry))" class="flex items-center gap-1.5 py-0.5 text-gray-600">
              <FilePlus2 class="h-3.5 w-3.5" /> {{ changeSummary(batchOf(entry)) }}
            </div>
          </template>

          <div v-if="roomCounts(entry)" class="flex items-center gap-1.5 py-0.5 text-gray-600">
            <DoorOpen class="h-3.5 w-3.5" />
            面板 {{ roomCounts(entry)!.panels }} · 成员 {{ roomCounts(entry)!.elements }} · 死信 {{ roomCounts(entry)!.dead_letters }}
          </div>

          <div v-for="(unit, ui) in unitsOf(entry)" :key="ui" class="flex items-center gap-1.5 py-0.5">
            <CircleCheck v-if="unit.status === 'generated'" class="h-3.5 w-3.5 text-emerald-600" />
            <CircleX v-else class="h-3.5 w-3.5 text-red-600" />
            <span class="text-foreground">{{ unit.noun }} {{ unit.root_refno }}</span>
            <span v-if="unitBadge(entry, ui)"
              :title="unitBadge(entry, ui)!.title"
              data-testid="increment-rvm-unit-status">
              <RvmStatusIcon :verdict="unitBadge(entry, ui)!.verdict" :outdated="unitBadge(entry, ui)!.outdated" />
            </span>
            <span class="text-muted-foreground">{{ unitKindLabel(unit.kind) }}</span>
            <span v-if="unit.message" class="truncate" :class="unit.status === 'failed' ? 'text-red-700' : 'text-muted-foreground'">{{ unit.message }}</span>
          </div>
          <div v-if="checkable(entry) && unitsOf(entry).length > UNIT_BADGE_LIMIT" class="py-0.5 pl-5 text-muted-foreground" data-testid="increment-rvm-unit-limit">
            只有前 {{ UNIT_BADGE_LIMIT }} 根显示核对状态，整批看上面的汇总
          </div>
          <div v-if="transformRoots(entry) > 0" class="py-0.5 pl-5 text-muted-foreground">
            其中 {{ transformRoots(entry) }} 根走刚体前移便宜路（只动方位，网格未重算）
          </div>

          <div v-for="(warning, wi) in warningsOf(entry)" :key="wi" class="py-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {{ warning }}
          </div>
          <div v-if="terminalTimes(entry)" class="py-0.5 pl-5 text-muted-foreground">{{ terminalTimes(entry) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
