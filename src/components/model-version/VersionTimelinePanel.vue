<script setup lang="ts">
/**
 * 版本时间线面板（specs/004-model-version-timeline T011/T012，FR-001…008）。
 *
 * - onMounted 从 URL(?project/output_project/dbnum) setFilters 后 loadTimeline；
 * - 按天分组垂直时间轴（store.dayGroups 已倒序）+ @tanstack/vue-virtual 虚拟滚动；
 * - 版本卡片：displayLabel/时间/双轴徽章 + diff 摘要懒加载（不阻塞列表，SC-002）；
 * - 粒度切换 releases|with-anchors（FR-007），锚点节点仅保留快照占位入口；
 * - A/B 钉选 + 底部对比栏：进入对比前 ensureReadiness，production_ready=false
 *   需显式「诊断查看」确认（FR-027）；非 published 版本默认置灰（FR-032）。
 * - 「应用差异到模型树」派发由 US2（T017）在本组件接线，此处不实现。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { useVirtualizer } from '@tanstack/vue-virtual';
import { AlertTriangle, Anchor, GitCompare, RefreshCw, X } from 'lucide-vue-next';

import type {
  AnchorView,
  Badge,
  BadgeTone,
  DiffSummaryEntry,
  ReleaseView,
  TimelineGranularity,
} from '@/composables/useVersionTimelineStore';

import {
  lifecycleBadge,
  qualityBadge,
  useVersionTimelineStore,
} from '@/composables/useVersionTimelineStore';

const store = useVersionTimelineStore();
const {
  releases,
  anchors,
  loading,
  error,
  anchorsError,
  granularity,
  diffSummaries,
  dayGroups,
  stage,
  pinnedA,
  pinnedB,
  currentReadiness,
} = store;

// ---------------------------------------------------------------------------
// 筛选行（FR-006）与诊断模式（FR-032）
// ---------------------------------------------------------------------------

const projectInput = ref('');
const dbnumInput = ref('');
const branchInput = ref('');
const diagnosticMode = ref(false);

function parseDbnum(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function applyFilters(): void {
  const nextProject = projectInput.value.trim() || undefined;
  const nextDbnum = parseDbnum(dbnumInput.value);
  const nextBranch = branchInput.value.trim() || undefined;
  // 分支为纯前端过滤；仅 project/dbnum 变化才需要重新请求
  const needsReload = nextProject !== store.filters.project || nextDbnum !== store.filters.dbnum;
  store.setFilters({ project: nextProject, dbnum: nextDbnum, branchId: nextBranch });
  if (needsReload) {
    void store.loadTimeline();
    if (granularity.value === 'with-anchors') void store.loadAnchors();
  }
}

function reload(): void {
  void store.loadTimeline();
  if (granularity.value === 'with-anchors') void store.loadAnchors();
}

function retryAnchors(): void {
  void store.loadAnchors();
}

function onGranularity(next: TimelineGranularity): void {
  void store.setGranularity(next);
}

function granularityClass(target: TimelineGranularity): string {
  return granularity.value === target
    ? 'border-primary bg-primary/10 font-medium text-primary'
    : 'border-input text-muted-foreground hover:bg-muted';
}

onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const project = params.get('project') || params.get('output_project') || '';
  const dbnumRaw = params.get('dbnum') || '';
  projectInput.value = project;
  dbnumInput.value = dbnumRaw;
  store.setFilters({
    project: project || undefined,
    dbnum: parseDbnum(dbnumRaw),
    branchId: branchInput.value.trim() || undefined,
  });
  void store.loadTimeline();
  if (granularity.value === 'with-anchors') void store.loadAnchors();
});

// ---------------------------------------------------------------------------
// 按天分组 → 扁平行 → 虚拟滚动（FR-002）
// ---------------------------------------------------------------------------

type FlatRow =
  | { type: 'day'; key: string; dayKey: string; count: number }
  | { type: 'node'; key: string; node: ReleaseView | AnchorView };

const flatRows = computed<FlatRow[]>(() => {
  const rows: FlatRow[] = [];
  for (const group of dayGroups.value) {
    rows.push({ type: 'day', key: `day:${group.dayKey}`, dayKey: group.dayKey, count: group.nodes.length });
    for (const node of group.nodes) {
      rows.push({ type: 'node', key: node.key, node });
    }
  }
  return rows;
});

const scrollRef = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(computed(() => ({
  count: flatRows.value.length,
  getScrollElement: () => scrollRef.value,
  estimateSize: (index: number) => {
    const row = flatRows.value[index];
    if (!row) return 40;
    if (row.type === 'day') return 34;
    return row.node.kind === 'anchor' ? 34 : 158;
  },
  overscan: 12,
})));

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

type RenderRow =
  | { kind: 'day'; key: string; index: number; start: number; dayKey: string; count: number }
  | { kind: 'release'; key: string; index: number; start: number; node: ReleaseView }
  | { kind: 'anchor'; key: string; index: number; start: number; node: AnchorView };

const renderRows = computed<RenderRow[]>(() => {
  const rows: RenderRow[] = [];
  for (const item of virtualRows.value) {
    const row = flatRows.value[item.index];
    if (!row) continue;
    if (row.type === 'day') {
      rows.push({ kind: 'day', key: row.key, index: item.index, start: item.start, dayKey: row.dayKey, count: row.count });
    } else if (row.node.kind === 'release') {
      rows.push({ kind: 'release', key: row.key, index: item.index, start: item.start, node: row.node });
    } else {
      rows.push({ kind: 'anchor', key: row.key, index: item.index, start: item.start, node: row.node });
    }
  }
  return rows;
});

function measureRow(el: unknown): void {
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el);
}

watch(
  () => flatRows.value.length,
  async () => {
    // 数据/筛选变化后等 DOM 更新再测量，确保虚拟列表拿到滚动容器尺寸
    await nextTick();
    if (scrollRef.value) virtualizer.value.measure();
  },
  { immediate: true },
);

const showLoading = computed(() => loading.value && flatRows.value.length === 0);

// ---------------------------------------------------------------------------
// diff 摘要懒加载（FR-005/SC-002）：仅对可见卡片按需请求，不阻塞列表
// ---------------------------------------------------------------------------

watch(
  () => renderRows.value
    .filter((row): row is Extract<RenderRow, { kind: 'release' }> => row.kind === 'release')
    .map((row) => row.node.releaseId),
  (releaseIds) => {
    for (const releaseId of releaseIds) void store.ensureDiffSummary(releaseId);
  },
  { immediate: true },
);

function diffSummaryOf(releaseId: string): DiffSummaryEntry | undefined {
  return diffSummaries.value.get(releaseId);
}

function retryDiffSummary(releaseId: string): void {
  void store.ensureDiffSummary(releaseId);
}

// ---------------------------------------------------------------------------
// 徽章与卡片展示
// ---------------------------------------------------------------------------

const badgeToneClass: Record<BadgeTone, string> = {
  green: 'border-success bg-success-subtle text-success',
  amber: 'border-warning bg-warning-subtle text-warning',
  red: 'border-danger bg-danger-subtle text-danger',
  gray: 'border-border bg-muted/40 text-muted-foreground',
};

function lifecycleBadgeOf(node: ReleaseView): Badge {
  return lifecycleBadge(node.lifecycle);
}

function qualityBadgeOf(node: ReleaseView): Badge {
  return qualityBadge(node.quality);
}

function qualityBadgeTitle(node: ReleaseView): string | undefined {
  const reason = node.record.release_quality_reason;
  return typeof reason === 'string' && reason ? reason : undefined;
}

function cardBorderClass(node: ReleaseView): string {
  if (pinnedA.value?.key === node.key || pinnedB.value?.key === node.key) return 'border-primary/60 shadow-sm';
  if (node.quality === 'quarantined_visual') return 'border-danger';
  return 'border-border';
}

function formatTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--:--';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function releaseTreeSesno(node: ReleaseView): number | undefined {
  if (!node.sesnoHint) return undefined;
  const sesno = Number(node.sesnoHint);
  return Number.isInteger(sesno) && sesno >= 0 ? sesno : undefined;
}

function releaseTreeTitle(node: ReleaseView): string {
  const sesno = releaseTreeSesno(node);
  return sesno === undefined
    ? '该发布记录没有可用的 sesno'
    : `查看 sesno ${sesno} 的历史模型树`;
}

function viewTreeAt(sesno: number, dbnum?: number): void {
  if (!Number.isInteger(sesno) || sesno < 0) return;

  const url = new URL(window.location.href);
  url.searchParams.delete('sesno');
  url.searchParams.set('tree_sesno', String(sesno));
  url.searchParams.set('e3d_source', 'backend');

  const project = store.filters.project ?? projectInput.value.trim();
  if (project) {
    url.searchParams.set('project', project);
    url.searchParams.set('output_project', project);
  }

  const targetDbnum = Number.isInteger(dbnum)
    ? dbnum
    : (store.filters.dbnum ?? parseDbnum(dbnumInput.value));
  if (targetDbnum !== undefined) {
    url.searchParams.set('dbnum', String(targetDbnum));
    url.searchParams.set('show_dbnum', String(targetDbnum));
  }

  window.location.assign(url.toString());
}

function viewReleaseTree(node: ReleaseView): void {
  const sesno = releaseTreeSesno(node);
  if (sesno === undefined) return;
  viewTreeAt(sesno, node.record.dbnum);
}

// ---------------------------------------------------------------------------
// A/B 钉选与进入对比（T012，FR-027/FR-032）
// ---------------------------------------------------------------------------

const readinessChecking = ref(false);
const confirmingDiagnostic = ref(false);

/** FR-032：非 published 生命周期默认不可作为快照/对比目标，诊断模式放开 */
function canPin(node: ReleaseView): boolean {
  return diagnosticMode.value || node.lifecycle === 'published';
}

function pinDisabledTitle(node: ReleaseView): string | undefined {
  if (canPin(node)) return undefined;
  return `未发布（${node.lifecycle || 'unknown'}）：快照/对比不可用，开启诊断模式后可选`;
}

function pinIndicator(node: ReleaseView): 'A' | 'B' | null {
  if (pinnedA.value?.key === node.key) return 'A';
  if (pinnedB.value?.key === node.key) return 'B';
  return null;
}

watch(stage, (next) => {
  if (next !== 'ready') confirmingDiagnostic.value = false;
});

async function onEnterCompare(): Promise<void> {
  if (stage.value !== 'ready' || readinessChecking.value) return;
  confirmingDiagnostic.value = false;
  readinessChecking.value = true;
  try {
    const readiness = await store.ensureReadiness();
    // 失败原因经 currentReadiness 的 error 态呈现（FR-033）
    if (!readiness) return;
    if (readiness.production_ready === false) {
      // FR-027：不可比/未就绪时展示原因，需显式确认「诊断查看」
      confirmingDiagnostic.value = true;
      return;
    }
    store.enterCompare();
  } finally {
    readinessChecking.value = false;
  }
}

function onConfirmDiagnostic(): void {
  confirmingDiagnostic.value = false;
  store.enterCompare();
}

function onCloseCompare(): void {
  store.closeCompare();
}

function formatIssue(issue: unknown): string {
  return typeof issue === 'string' ? issue : JSON.stringify(issue);
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background" data-testid="version-timeline-panel">
    <header class="shrink-0 border-b border-border px-3 py-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <div class="truncate text-sm font-semibold text-foreground">版本时间线</div>
          <span class="shrink-0 text-[11px] leading-4 text-muted-foreground">
            {{ releases.length }} 个版本 · {{ anchors.length }} 个锚点
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <label class="flex cursor-pointer select-none items-center gap-1 text-[11px] text-muted-foreground"
            title="开启后允许选择未发布版本用于快照/对比（FR-032）">
            <input v-model="diagnosticMode"
              type="checkbox"
              class="h-3 w-3"
              data-testid="version-timeline-diagnostic-toggle" />
            诊断模式
          </label>
          <button type="button"
            class="inline-flex h-6 w-6 items-center justify-center rounded border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="刷新"
            data-testid="version-timeline-refresh"
            @click="reload">
            <RefreshCw class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-1.5" data-testid="version-timeline-filter">
        <input v-model="projectInput"
          class="h-6 w-32 rounded border border-input bg-background px-1.5 text-[11px] text-foreground placeholder:text-muted-foreground"
          placeholder="项目"
          data-testid="version-timeline-filter-project"
          @change="applyFilters"
          @keyup.enter="applyFilters" />
        <input v-model="dbnumInput"
          class="h-6 w-20 rounded border border-input bg-background px-1.5 text-[11px] text-foreground placeholder:text-muted-foreground"
          placeholder="DB"
          data-testid="version-timeline-filter-dbnum"
          @change="applyFilters"
          @keyup.enter="applyFilters" />
        <input v-model="branchInput"
          class="h-6 w-24 rounded border border-input bg-background px-1.5 text-[11px] text-foreground placeholder:text-muted-foreground"
          placeholder="分支"
          data-testid="version-timeline-filter-branch"
          @change="applyFilters"
          @keyup.enter="applyFilters" />
      </div>

      <div class="mt-2 flex items-center gap-1" data-testid="version-timeline-granularity">
        <button type="button"
          class="rounded border px-2 py-0.5 text-[11px] leading-4 transition-colors"
          :class="granularityClass('releases')"
          @click="onGranularity('releases')">
          仅发布版本
        </button>
        <button type="button"
          class="rounded border px-2 py-0.5 text-[11px] leading-4 transition-colors"
          :class="granularityClass('with-anchors')"
          @click="onGranularity('with-anchors')">
          含会话锚点
        </button>
      </div>

      <div v-if="granularity === 'with-anchors' && anchorsError"
        class="mt-1.5 flex items-center gap-1.5 text-[11px] text-danger"
        data-testid="version-timeline-anchors-error">
        <span class="truncate">锚点加载失败：{{ anchorsError }}</span>
        <button type="button"
          class="shrink-0 underline"
          data-testid="version-timeline-anchors-retry"
          @click="retryAnchors">
          重试
        </button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col">
      <div v-if="showLoading"
        class="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-xs text-muted-foreground"
        data-testid="version-timeline-loading">
        <div class="w-full max-w-xs space-y-2">
          <div class="h-3 w-24 animate-pulse rounded bg-muted" />
          <div class="h-14 animate-pulse rounded bg-muted" />
          <div class="h-14 animate-pulse rounded bg-muted" />
        </div>
        <span>正在加载版本列表…</span>
      </div>

      <div v-else-if="error"
        class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
        data-testid="version-timeline-error">
        <AlertTriangle class="h-6 w-6 text-danger" />
        <div class="text-sm font-medium text-foreground">版本列表加载失败</div>
        <div class="max-w-full break-all text-xs text-muted-foreground">{{ error }}</div>
        <button type="button"
          class="mt-1 inline-flex h-7 items-center gap-1 rounded bg-primary px-3 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
          data-testid="version-timeline-retry"
          @click="reload">
          <RefreshCw class="h-3.5 w-3.5" />
          重试
        </button>
      </div>

      <div v-else-if="flatRows.length === 0"
        class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
        data-testid="version-timeline-empty">
        <div class="text-sm font-medium text-foreground">暂无版本数据</div>
        <div class="max-w-60 text-xs leading-5 text-muted-foreground">
          当前项目 / DB 尚未登记任何发布版本或会话锚点，模型发布后将在此展示版本演进
        </div>
        <button type="button"
          class="mt-1 inline-flex h-7 items-center gap-1 rounded border border-input px-3 text-xs text-foreground transition-colors hover:bg-muted"
          data-testid="version-timeline-empty-refresh"
          @click="reload">
          <RefreshCw class="h-3.5 w-3.5" />
          刷新
        </button>
      </div>

      <div v-else
        ref="scrollRef"
        class="relative min-h-0 flex-1 overflow-auto"
        data-testid="version-timeline-scroll">
        <div class="relative w-full" :style="{ height: `${totalSize}px` }">
          <div v-for="item in renderRows"
            :key="item.key"
            :ref="measureRow"
            :data-index="item.index"
            class="absolute left-0 top-0 w-full px-3"
            :style="{ transform: `translateY(${item.start}px)` }">
            <div v-if="item.kind === 'day'"
              class="flex items-center gap-2 pb-1.5 pt-3 text-xs font-medium text-foreground"
              data-testid="version-timeline-day">
              <span>{{ item.dayKey }}</span>
              <span class="text-[11px] font-normal text-muted-foreground">{{ item.count }} 项</span>
              <span class="h-px flex-1 bg-border" />
            </div>

            <article v-else-if="item.kind === 'release'"
              class="mb-2 rounded-md border bg-background p-2.5 text-xs"
              :class="cardBorderClass(item.node)"
              data-testid="version-card"
              :data-release-id="item.node.releaseId">
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="truncate text-[13px] font-semibold text-foreground" :title="item.node.releaseId">
                  {{ item.node.displayLabel }}
                </span>
                <span class="shrink-0 rounded border px-1.5 py-0.5 text-[11px] leading-4"
                  :class="badgeToneClass[lifecycleBadgeOf(item.node).tone]"
                  :data-tone="lifecycleBadgeOf(item.node).tone"
                  :title="lifecycleBadgeOf(item.node).detail"
                  data-testid="version-card-lifecycle-badge">{{ lifecycleBadgeOf(item.node).label }}</span>
                <span class="shrink-0 rounded border px-1.5 py-0.5 text-[11px] leading-4"
                  :class="badgeToneClass[qualityBadgeOf(item.node).tone]"
                  :data-tone="qualityBadgeOf(item.node).tone"
                  :title="qualityBadgeTitle(item.node)"
                  data-testid="version-card-quality-badge">{{ qualityBadgeOf(item.node).label }}</span>
                <span v-if="pinIndicator(item.node)"
                  class="ml-auto shrink-0 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-primary"
                  data-testid="version-card-pin-indicator">{{ pinIndicator(item.node) }}</span>
              </div>

              <div class="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4 text-muted-foreground">
                <span>{{ formatTime(item.node.timestamp) }}</span>
                <span v-if="item.node.sesnoHint">· sesno {{ item.node.sesnoHint }}</span>
                <span v-if="item.node.record.dbnum != null">· DB {{ item.node.record.dbnum }}</span>
                <span v-if="item.node.record.branch_id">· 分支 {{ item.node.record.branch_id }}</span>
              </div>

              <div class="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] leading-4"
                data-testid="version-card-diff-summary">
                <template v-if="diffSummaryOf(item.node.releaseId)?.status === 'ready'">
                  <span class="rounded bg-success-subtle px-1 font-medium text-success">+{{ diffSummaryOf(item.node.releaseId)?.added ?? 0 }}</span>
                  <span class="rounded bg-warning-subtle px-1 font-medium text-warning">~{{ diffSummaryOf(item.node.releaseId)?.changed ?? 0 }}</span>
                  <span class="rounded bg-danger-subtle px-1 font-medium text-danger">-{{ diffSummaryOf(item.node.releaseId)?.deleted ?? 0 }}</span>
                  <span class="text-muted-foreground">较上一版</span>
                </template>
                <template v-else-if="diffSummaryOf(item.node.releaseId)?.status === 'none'">
                  <span class="text-muted-foreground">初始版本</span>
                </template>
                <template v-else-if="diffSummaryOf(item.node.releaseId)?.status === 'error'">
                  <span class="text-danger" :title="diffSummaryOf(item.node.releaseId)?.error">摘要加载失败</span>
                  <button type="button"
                    class="text-foreground underline"
                    data-testid="version-card-diff-retry"
                    @click="retryDiffSummary(item.node.releaseId)">
                    重试
                  </button>
                </template>
                <template v-else>
                  <span class="text-muted-foreground">摘要加载中…</span>
                </template>
              </div>

              <div v-if="item.node.quality === 'quarantined_visual'"
                class="mt-1.5 flex items-center gap-1 rounded border border-danger bg-danger-subtle px-1.5 py-1 text-[11px] leading-4 text-danger"
                data-testid="version-card-quarantine-warning">
                <AlertTriangle class="h-3 w-3 shrink-0" />
                <span class="truncate" :title="qualityBadgeTitle(item.node)">质量隔离：不建议作为对比基准</span>
              </div>

              <div class="mt-2 flex flex-wrap items-center gap-1">
                <button type="button"
                  class="rounded border border-input px-1.5 py-0.5 text-[11px] leading-4 text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  :disabled="releaseTreeSesno(item.node) === undefined"
                  :title="releaseTreeTitle(item.node)"
                  data-testid="version-card-view-tree"
                  @click="viewReleaseTree(item.node)">
                  查看此版本树
                </button>
                <button type="button"
                  class="rounded border border-input px-1.5 py-0.5 text-[11px] leading-4 text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  :disabled="!canPin(item.node)"
                  :title="pinDisabledTitle(item.node)"
                  data-testid="version-card-pin-a"
                  @click="store.pinA(item.node.key)">
                  设为 A
                </button>
                <button type="button"
                  class="rounded border border-input px-1.5 py-0.5 text-[11px] leading-4 text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  :disabled="!canPin(item.node)"
                  :title="pinDisabledTitle(item.node)"
                  data-testid="version-card-pin-b"
                  @click="store.pinB(item.node.key)">
                  设为 B
                </button>
                <button type="button"
                  class="rounded border border-input px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  disabled
                  title="3D 加载（US5）提供"
                  data-testid="version-card-load-3d">
                  3D 加载
                </button>
              </div>
            </article>

            <div v-else
              class="mb-1.5 flex items-center gap-1.5 rounded border border-dashed border-border bg-muted/20 px-2 py-1 text-[11px] leading-4 text-muted-foreground"
              data-testid="anchor-node"
              :data-anchor-key="item.node.key">
              <Anchor class="h-3 w-3 shrink-0" />
              <span class="truncate">会话锚点 sesno {{ item.node.sesno }} · {{ formatTime(item.node.timestamp) }}</span>
              <span v-if="item.node.source" class="truncate">· {{ item.node.source }}</span>
              <button type="button"
                class="ml-auto shrink-0 rounded border border-input px-1.5 py-0.5 text-[11px] leading-4 text-foreground transition-colors hover:bg-muted"
                :title="`查看 sesno ${item.node.sesno} 的历史模型树`"
                data-testid="anchor-node-snapshot"
                @click="viewTreeAt(item.node.sesno, item.node.dbnum)">
                查看此时刻树
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer v-if="stage !== 'empty'"
      class="shrink-0 border-t border-border bg-background px-3 py-2"
      data-testid="version-timeline-compare-bar">
      <div class="flex items-center gap-1.5 text-xs">
        <span class="flex min-w-0 items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[11px] leading-4">
          <span class="shrink-0 font-semibold text-primary">A</span>
          <template v-if="pinnedA">
            <span class="truncate" :title="pinnedA.releaseId">{{ pinnedA.displayLabel }}</span>
            <button type="button"
              class="shrink-0 text-muted-foreground hover:text-foreground"
              title="清除 A"
              data-testid="version-timeline-clear-a"
              @click="store.clearA()">
              <X class="h-3 w-3" />
            </button>
          </template>
          <span v-else class="text-muted-foreground">未选择</span>
        </span>
        <span class="shrink-0 text-muted-foreground">→</span>
        <span class="flex min-w-0 items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[11px] leading-4">
          <span class="shrink-0 font-semibold text-success">B</span>
          <template v-if="pinnedB">
            <span class="truncate" :title="pinnedB.releaseId">{{ pinnedB.displayLabel }}</span>
            <button type="button"
              class="shrink-0 text-muted-foreground hover:text-foreground"
              title="清除 B"
              data-testid="version-timeline-clear-b"
              @click="store.clearB()">
              <X class="h-3 w-3" />
            </button>
          </template>
          <span v-else class="text-muted-foreground">未选择</span>
        </span>
        <div class="ml-auto flex shrink-0 items-center gap-1.5">
          <template v-if="stage === 'comparing'">
            <span class="text-[11px] text-success">已进入对比</span>
            <button type="button"
              class="inline-flex h-7 items-center rounded border border-input px-2 text-xs text-foreground transition-colors hover:bg-muted"
              data-testid="version-timeline-close-compare"
              @click="onCloseCompare">
              关闭对比
            </button>
          </template>
          <button v-else
            type="button"
            class="inline-flex h-7 items-center gap-1 rounded bg-primary px-2 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="stage !== 'ready' || readinessChecking"
            data-testid="version-timeline-enter-compare"
            @click="onEnterCompare">
            <GitCompare class="h-3.5 w-3.5" />
            {{ readinessChecking ? '检查中…' : '进入对比' }}
          </button>
        </div>
      </div>

      <div v-if="currentReadiness"
        class="mt-2 rounded border border-border bg-muted/20 px-2 py-1.5 text-[11px] leading-5"
        data-testid="version-timeline-readiness">
        <template v-if="currentReadiness.status === 'loading'">
          <span class="text-muted-foreground">可比性检查中…</span>
        </template>
        <template v-else-if="currentReadiness.status === 'error'">
          <span class="text-danger">可比性检查失败：{{ currentReadiness.error }}</span>
        </template>
        <template v-else-if="currentReadiness.readiness">
          <div class="text-foreground">
            结论 {{ currentReadiness.readiness.classification || '未知' }}
            · production_ready {{ currentReadiness.readiness.production_ready === false ? '否' : '是' }}
          </div>
          <ul v-if="(currentReadiness.readiness.problems ?? []).length" class="mt-0.5 list-inside list-disc text-danger">
            <li v-for="(problem, index) in currentReadiness.readiness.problems" :key="index">{{ formatIssue(problem) }}</li>
          </ul>
          <ul v-if="(currentReadiness.readiness.warnings ?? []).length" class="mt-0.5 list-inside list-disc text-warning">
            <li v-for="(warning, index) in currentReadiness.readiness.warnings" :key="index">{{ formatIssue(warning) }}</li>
          </ul>
          <div v-if="currentReadiness.readiness.recommended_action" class="mt-0.5 text-muted-foreground">
            建议：{{ currentReadiness.readiness.recommended_action }}
          </div>
        </template>
      </div>

      <div v-if="confirmingDiagnostic"
        class="mt-2 flex flex-wrap items-center gap-2 rounded border border-warning bg-warning-subtle px-2 py-1.5 text-[11px] leading-4 text-warning"
        data-testid="version-timeline-diagnostic-confirm">
        <span class="min-w-0 flex-1">该版本对未达生产就绪（production_ready=false），仅建议诊断查看。</span>
        <button type="button"
          class="shrink-0 rounded border border-warning bg-background px-2 py-0.5 font-medium text-warning transition-colors hover:bg-warning-subtle"
          data-testid="version-timeline-confirm-diagnostic"
          @click="onConfirmDiagnostic">
          诊断查看
        </button>
        <button type="button"
          class="shrink-0 rounded border border-input bg-background px-2 py-0.5 text-muted-foreground transition-colors hover:bg-muted"
          data-testid="version-timeline-cancel-diagnostic"
          @click="confirmingDiagnostic = false">
          取消
        </button>
      </div>
    </footer>
  </section>
</template>
