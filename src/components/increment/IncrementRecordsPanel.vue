<script setup lang="ts">
/**
 * 「增量记录」面板：gen-model `/api/v1/tasks` 的只读账本服。
 *
 * 每一轮增量（保存窗口 → 数据批次 → 模型生成 → 房间重算）在这里按时间轴排：
 * 保存窗口、增删改三数、逐单元发布方式（整根重算 / 刚体前移 ADR-066）、房间轮的
 * 面板 / 成员 / 死信计数。d-195 的口径没松——纯展示，不订阅、不反推、不据此
 * 重载任何已加载的根。
 *
 * 轮询节拍 5s，只在面板活着的时候打；`/tasks` 服务端是 200 条窗口，更早的批次
 * 看不到了就照实说，不猜。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

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
  TriangleAlert,
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

import {
  genModelV1Tasks,
  isGenModelV1ApiError,
  type TaskListEntryDto,
} from '@/api/genModelV1Api';

const POLL_MS = 5000;

const tasks = ref<TaskListEntryDto[]>([]);
/** 还没成功取到过一次时为 false（画「还没连上」而不是空账本） */
const loaded = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const expanded = ref(new Set<string>());
const filter = ref<RecordKind | 'all'>('all');

const filters: { key: RecordKind | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'data_batch', label: '数据批次' },
  { key: 'room_recalc', label: '房间' },
  { key: 'model_rebuild', label: '模型重建' },
];

const entries = computed(() =>
  tasks.value.filter((entry) => filter.value === 'all' || recordKindLabel(entry.kind).key === filter.value),
);

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  loading.value = true;
  try {
    const list = await genModelV1Tasks();
    tasks.value = Array.isArray(list.tasks) ? list.tasks : [];
    loaded.value = true;
    error.value = null;
  } catch (cause) {
    // 失败不作废上一份快照：账本停在旧数据，条幅照实说为什么没换代。
    error.value = isGenModelV1ApiError(cause)
      ? cause.message
      : (cause instanceof Error ? cause.message : String(cause));
  } finally {
    inFlight = false;
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), POLL_MS);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

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

    <!-- 类型筛 -->
    <div class="flex items-center gap-1.5 border-b border-border px-5 py-2">
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
        class="mb-1 rounded-lg border border-gray-200 bg-white">
        <button type="button" class="flex w-full flex-col gap-1 px-3 py-2 text-left" @click="toggle(entry.task_id)">
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
        </button>

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
            <span class="text-muted-foreground">{{ unitKindLabel(unit.kind) }}</span>
            <span v-if="unit.message" class="truncate" :class="unit.status === 'failed' ? 'text-red-700' : 'text-muted-foreground'">{{ unit.message }}</span>
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
