<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
  ArrowRight,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleStop,
  CircleX,
  Crosshair,
  Download,
  FileJson,
  GitBranch,
  Layers,
  List,
  ListFilter,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  X,
} from 'lucide-vue-next';

import RuleCheckViolationRow from './RuleCheckViolationRow.vue';

import type { RuleCheckEngine, UnifiedPreciseStats, UnifiedRuleViolation } from '@/api/ruleCheckApi';

import {
  parseScopeRefnoList,
  RULE_CHECK_DISCIPLINES,
  RULE_CHECK_ENGINE_LABELS,
  useRuleCheck,
  type RuleCheckBranScope,
  type RuleCheckEngineFilter,
  type RuleCheckEngineRun,
} from '@/composables/useRuleCheck';
import {
  RULE_CHECK_OVERLAY_PALETTE,
  useRuleCheckOverlay,
  type RuleCheckOverlayCategory,
  type RuleCheckOverlayMode,
} from '@/composables/useRuleCheckOverlay';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useSpatialQuery } from '@/composables/useSpatialQuery';
import { useViewerContext } from '@/composables/useViewerContext';
import {
  buildRuleCheckCsv,
  buildRuleCheckJson,
  formatExportTimestamp,
  triggerTextDownload,
} from '@/utils/ruleCheckExport';
import {
  countViolationsByAccuracy,
  countViolationsByDiscipline,
  countViolationsByResultSeverity,
  filterRuleViolations,
  formatRuleCheckClock,
  formatRuleCheckDuration,
  groupViolationsByRule,
  ruleViolationKey,
  type RuleCheckResultAccuracyFilter,
  type RuleCheckResultSeverityFilter,
} from '@/utils/ruleCheckResultView';

const ruleCheck = useRuleCheck();
const {
  state,
  filteredCatalog,
  engineCounts,
  disciplineCounts,
  allViolations,
  summaryStats,
  loadCatalogs,
  toggleRuleSelection,
  selectAllFiltered,
  clearRuleSelection,
  setBranRefno,
  appendScopeRefno,
  clearResults,
  cancelRun,
  runChecks,
  retryEngine,
} = ruleCheck;

const selectionStore = useSelectionStore();
const viewerContext = useViewerContext();
const spatialQuery = useSpatialQuery();
const { overlayState, applyOverlay, clearOverlay } = useRuleCheckOverlay();

const OVERLAY_LEGEND_CATEGORIES: RuleCheckOverlayCategory[] = [
  'firezone_red',
  'firezone_yellow',
  'violation',
  'semi_auto',
  'reminder',
];

type SeverityCellKey = Exclude<RuleCheckResultSeverityFilter, 'all'>;

const SEVERITY_CELLS: { key: SeverityCellKey; label: string; dot: string }[] = [
  { key: 'violation', label: '违规', dot: 'bg-destructive' },
  { key: 'reminder', label: '提醒', dot: 'bg-sky-500' },
  { key: 'semi_auto', label: '半自动', dot: 'bg-violet-500' },
  { key: 'firezone', label: '火灾分区', dot: 'bg-amber-500' },
];

const SEVERITY_LABELS: Record<RuleCheckResultSeverityFilter, string> = {
  all: '全部',
  violation: '违规',
  reminder: '提醒',
  semi_auto: '半自动',
  firezone: '火灾分区',
};

const ACCURACY_OPTIONS: { key: RuleCheckResultAccuracyFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'exact', label: '精算' },
  { key: 'aabb', label: '估算' },
];

const BRAN_SCOPE_OPTIONS: { key: RuleCheckBranScope; label: string }[] = [
  { key: 'single', label: '单根' },
  { key: 'all', label: '全项目' },
];

const ENGINE_OPTIONS: RuleCheckEngineFilter[] = ['all', 'spatial', 'bran', 'rooms', 'attrs'];

const ENGINE_SHORT_LABELS: Record<RuleCheckEngine, string> = {
  spatial: '空间',
  bran: 'BRAN',
  rooms: '房间',
  attrs: '属性',
};

type OverlaySegmentKey = 'off' | Exclude<RuleCheckOverlayMode, 'isolate'>;

const OVERLAY_SEGMENTS: { key: OverlaySegmentKey; label: string; testid: string }[] = [
  { key: 'off', label: '关', testid: 'rule-check-clear-overlay-btn' },
  { key: 'firezone', label: '火灾', testid: 'rule-check-firezone-overlay-btn' },
  { key: 'all', label: '分级', testid: 'rule-check-all-overlay-btn' },
];

const activeTab = ref<'catalog' | 'results'>('catalog');
const settingsOpen = ref(state.engineRuns.length === 0 && state.results.length === 0);
const filterTrayOpen = ref(false);
const onlyViolationsFilter = ref(true);
const resultSeverityFilter = ref<RuleCheckResultSeverityFilter>('all');
const resultAccuracyFilter = ref<RuleCheckResultAccuracyFilter>('all');
const resultDisciplines = ref<string[]>([]);
const onlyRuleKey = ref<string | null>(null);
const copyOnly = ref(false);
const resultKeyword = ref('');
const groupByRule = ref(false);
const collapsedGroups = ref<string[]>([]);
const expandedKey = ref<string | null>(null);
const nowMs = ref(Date.now());

const runLabel = computed(() =>
  state.selectedRuleIds.length > 0 ? `运行已选 (${state.selectedRuleIds.length})` : '执行校验',
);

const showPreciseToggle = computed(
  () => state.activeEngine === 'all' || state.activeEngine === 'spatial',
);

const showBranInput = computed(
  () => state.activeEngine === 'bran' || state.activeEngine === 'all',
);

const showScopeInput = computed(
  () => state.activeEngine === 'attrs' || state.activeEngine === 'all',
);

const settingsSummary = computed(() => {
  const parts = [
    state.activeEngine === 'all' ? '全部引擎' : RULE_CHECK_ENGINE_LABELS[state.activeEngine],
    state.activeDiscipline === 'all' ? '全专业' : state.activeDiscipline,
  ];
  if (state.selectedRuleIds.length > 0) parts.push(`已选 ${state.selectedRuleIds.length} 条`);
  if (showPreciseToggle.value && state.precise) parts.push('精确复核');
  if (showBranInput.value) {
    const bran = state.branRefno.trim();
    parts.push(state.branScope === 'all' ? 'BRAN 全项目' : bran ? `BRAN ${bran}` : 'BRAN 未填');
  }
  const scopeCount = showScopeInput.value ? parseScopeRefnoList(state.attrScopeText).length : 0;
  if (scopeCount > 0) parts.push(`选集 ${scopeCount}`);
  return parts.join(' · ');
});

const preciseSummary = computed(() => summaryStats.value.precise);

const branAllSummary = computed(() => summaryStats.value.branAll);

const resultAccuracyCounts = computed(() => countViolationsByAccuracy(allViolations.value));

const resultDisciplineCounts = computed(() => countViolationsByDiscipline(allViolations.value));

const hasCopyNamed = computed(() => allViolations.value.some((v) => v.copyNamed === true));

const preciseStatsByRule = computed(() => {
  const map = new Map<string, UnifiedPreciseStats>();
  for (const r of state.results) {
    if (r.precise?.refinable) map.set(`${r.engine}:${r.id}`, r.precise);
  }
  return map;
});

const resultSeverityCounts = computed(() => countViolationsByResultSeverity(allViolations.value));

const severityBarSegments = computed(() => {
  const c = resultSeverityCounts.value;
  return [
    { key: 'violation', n: c.violation, cls: 'bg-destructive' },
    { key: 'reminder', n: c.reminder, cls: 'bg-sky-500' },
    { key: 'semi_auto', n: c.semi_auto, cls: 'bg-violet-500' },
  ].filter((s) => s.n > 0);
});

const visibleViolations = computed(() =>
  filterRuleViolations(allViolations.value, {
    severity: resultSeverityFilter.value,
    keyword: resultKeyword.value,
    accuracy: resultAccuracyFilter.value,
    disciplines: resultDisciplines.value,
    ruleKey: onlyRuleKey.value,
    copyOnly: copyOnly.value,
  }),
);

const groupedViolations = computed(() => groupViolationsByRule(visibleViolations.value));

const trayFilterCount = computed(
  () => (resultAccuracyFilter.value !== 'all' ? 1 : 0) + resultDisciplines.value.length + (copyOnly.value ? 1 : 0),
);

const isResultFiltered = computed(
  () => resultSeverityFilter.value !== 'all'
    || resultAccuracyFilter.value !== 'all'
    || resultDisciplines.value.length > 0
    || onlyRuleKey.value !== null
    || copyOnly.value
    || resultKeyword.value.trim().length > 0,
);

const activeFilterChips = computed(() => {
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (resultSeverityFilter.value !== 'all') {
    chips.push({
      key: 'severity',
      label: `严重度：${SEVERITY_LABELS[resultSeverityFilter.value]}`,
      clear: () => { resultSeverityFilter.value = 'all'; },
    });
  }
  if (resultAccuracyFilter.value !== 'all') {
    chips.push({
      key: 'accuracy',
      label: `口径：${resultAccuracyFilter.value === 'exact' ? '精算' : '估算'}`,
      clear: () => { resultAccuracyFilter.value = 'all'; },
    });
  }
  for (const disc of resultDisciplines.value) {
    chips.push({ key: `disc:${disc}`, label: `专业：${disc}`, clear: () => toggleResultDiscipline(disc) });
  }
  if (onlyRuleKey.value) {
    const ruleId = onlyRuleKey.value.slice(onlyRuleKey.value.indexOf(':') + 1);
    chips.push({ key: 'rule', label: `规则：${ruleId}`, clear: () => { onlyRuleKey.value = null; } });
  }
  if (copyOnly.value) {
    chips.push({ key: 'copy', label: '只看副本', clear: () => { copyOnly.value = false; } });
  }
  return chips;
});

const hasEngineRuns = computed(() => state.engineRuns.length > 0);

const engineRunsDone = computed(() => state.engineRuns.filter((r) => r.status !== 'running').length);

const runningClock = computed(() =>
  state.runStartedAt === null ? '00:00' : formatRuleCheckClock(nowMs.value - state.runStartedAt),
);

const lastRunTime = computed(() =>
  state.lastRunAt === null
    ? ''
    : new Date(state.lastRunAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
);

const overlaySegment = computed<OverlaySegmentKey | null>(() => {
  if (overlayState.activeMode === null) return 'off';
  return overlayState.activeMode === 'isolate' ? null : overlayState.activeMode;
});

let clockTimer: ReturnType<typeof setInterval> | null = null;

watch(
  () => state.running,
  (running) => {
    if (running && !clockTimer) {
      nowMs.value = Date.now();
      clockTimer = setInterval(() => {
        nowMs.value = Date.now();
      }, 1000);
    } else if (!running && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
});

onMounted(() => {
  if (!state.catalogLoaded && !state.catalogLoading) {
    void loadCatalogs();
  }
});

function engineOptionLabel(eng: RuleCheckEngineFilter): string {
  return eng === 'all' ? '全部' : RULE_CHECK_ENGINE_LABELS[eng];
}

function engineRunIcon(run: RuleCheckEngineRun) {
  if (run.status === 'running') return LoaderCircle;
  if (run.status === 'done') return CircleCheck;
  if (run.status === 'failed') return CircleX;
  return CircleStop;
}

function engineRunIconClass(run: RuleCheckEngineRun): string {
  if (run.status === 'running') return 'animate-spin text-primary';
  if (run.status === 'done') return 'text-emerald-600';
  if (run.status === 'failed') return 'text-destructive';
  return 'text-muted-foreground';
}

function engineRunBarClass(run: RuleCheckEngineRun): string {
  if (run.status === 'running') return 'bg-primary/60 animate-pulse';
  if (run.status === 'done') return 'bg-emerald-500';
  if (run.status === 'failed') return 'bg-destructive';
  return 'bg-muted-foreground/40';
}

function engineRunText(run: RuleCheckEngineRun): string {
  if (run.status === 'running') return run.label === 'BRAN 全项目' ? '全项目逐根检查…' : '运行中…';
  if (run.status === 'done') return `${run.rulesRun} 条 · 检出 ${run.violationTotal}`;
  if (run.status === 'failed') return run.error ?? '失败';
  return '已取消';
}

function engineRunTime(run: RuleCheckEngineRun): string {
  if (run.status === 'running') {
    return run.startedAt === null ? '' : formatRuleCheckClock(nowMs.value - run.startedAt);
  }
  return run.elapsedMs === null ? '' : formatRuleCheckDuration(run.elapsedMs);
}

function toggleGroupCollapsed(groupKey: string) {
  const idx = collapsedGroups.value.indexOf(groupKey);
  if (idx >= 0) collapsedGroups.value.splice(idx, 1);
  else collapsedGroups.value.push(groupKey);
}

function toggleSeverityCell(key: SeverityCellKey) {
  resultSeverityFilter.value = resultSeverityFilter.value === key ? 'all' : key;
}

function toggleResultDiscipline(disc: string) {
  const idx = resultDisciplines.value.indexOf(disc);
  if (idx >= 0) resultDisciplines.value.splice(idx, 1);
  else resultDisciplines.value.push(disc);
}

function clearAllFilters() {
  resultSeverityFilter.value = 'all';
  resultAccuracyFilter.value = 'all';
  resultDisciplines.value = [];
  onlyRuleKey.value = null;
  copyOnly.value = false;
  resultKeyword.value = '';
}

function resetResultView() {
  clearAllFilters();
  collapsedGroups.value = [];
  expandedKey.value = null;
  filterTrayOpen.value = false;
}

async function handleRunChecks() {
  clearOverlay();
  resetResultView();
  settingsOpen.value = false;
  activeTab.value = 'results';
  await runChecks();
}

function handleClearResults() {
  clearOverlay();
  resetResultView();
  clearResults();
}

function isOverlaySegmentDisabled(key: OverlaySegmentKey): boolean {
  if (overlayState.applying) return true;
  if (key === 'firezone') return summaryStats.value.firezones === 0;
  if (key === 'all') return allViolations.value.length === 0;
  return false;
}

async function setOverlayMode(key: OverlaySegmentKey) {
  if (key === 'off') {
    clearOverlay();
    return;
  }
  if (overlayState.activeMode === key) return;
  await applyOverlay(visibleViolations.value, { mode: key, xrayOthers: overlayState.xrayOthers });
}

function handleExportCsv() {
  const csv = buildRuleCheckCsv(visibleViolations.value);
  triggerTextDownload(
    csv,
    `rule-check-report-${formatExportTimestamp()}.csv`,
    'text/csv;charset=utf-8;',
  );
}

function handleExportJson() {
  const failures = state.engineRuns
    .filter((r) => r.status === 'failed')
    .map((r) => `${r.label} 执行失败：${r.error ?? ''}`);
  const json = buildRuleCheckJson({
    summary: {
      ...summaryStats.value,
      totalElapsedMs: state.totalElapsedMs,
    },
    warnings: [...state.catalogWarnings, ...state.runWarnings, ...failures],
    batches: state.batches,
    results: state.results,
    violations: visibleViolations.value,
  });
  triggerTextDownload(
    json,
    `rule-check-report-${formatExportTimestamp()}.json`,
    'application/json;charset=utf-8;',
  );
}

function handleFillBranFromSelection() {
  const refno = selectionStore.selectedRefno.value;
  if (refno) {
    setBranRefno(refno);
  }
}

function handleAppendScopeFromSelection() {
  const refno = selectionStore.selectedRefno.value;
  if (refno) {
    appendScopeRefno(refno);
  }
}

function groupPreciseLabel(groupKey: string): string | null {
  const stats = preciseStatsByRule.value.get(groupKey);
  if (!stats) return null;
  return `估算 ${stats.aabbFindings} → 精算剔除 ${stats.cleared}`;
}

/** 装载/可见/高亮指定构件集合，并将三维相机飞至联合包围盒。 */
async function focusRefnos(rawRefnos: string[]) {
  const refnos = rawRefnos.filter(Boolean);
  if (refnos.length === 0) return;

  selectionStore.setSelectedRefno(refnos[0]!);
  const viewer = viewerContext.viewerRef.value;
  if (!viewer?.scene) return;

  await spatialQuery.ensureRefnosLoaded(refnos).catch(() => null);
  viewer.scene.ensureRefnos(refnos);
  viewer.scene.setObjectsVisible(refnos, true);
  viewer.scene.setObjectsSelected(refnos, true);
  const aabb = viewer.scene.getAABB(refnos) ?? viewer.scene.getAABB([refnos[0]!]) ?? null;
  if (aabb) {
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }
}

/** 点击定位 → 装载/可见/高亮全部关联构件，并将三维相机飞至其联合包围盒。 */
async function focusViolation(violation: UnifiedRuleViolation) {
  state.activeViolationKey = violation.key;
  await focusRefnos(violation.highlightRefnos);
}

function handleSelectViolation(violation: UnifiedRuleViolation) {
  state.activeViolationKey = violation.key;
  expandedKey.value = expandedKey.value === violation.key ? null : violation.key;
}

async function handleIsolateViolation(violation: UnifiedRuleViolation) {
  state.activeViolationKey = violation.key;
  await applyOverlay([violation], { mode: 'isolate', xrayOthers: true });
  await focusRefnos(violation.highlightRefnos);
}

function handleOnlyRule(violation: UnifiedRuleViolation) {
  onlyRuleKey.value = ruleViolationKey(violation);
}
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground text-xs">
    <!-- 顶部栏 -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <ShieldCheck class="h-4 w-4 shrink-0 text-primary" />
      <span class="truncate text-sm font-semibold">规范校验</span>
      <span class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
        data-testid="rule-check-total-count">
        {{ engineCounts.all }} 条
      </span>
      <span class="flex-1" />
      <template v-if="state.running">
        <span data-testid="rule-check-run-clock" class="font-mono text-[11px] text-muted-foreground">已用 {{ runningClock }}</span>
        <button type="button"
          data-testid="rule-check-cancel-btn"
          class="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
          @click="cancelRun()">
          <X class="h-3 w-3" />
          取消
        </button>
      </template>
      <template v-else>
        <button type="button"
          class="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          :disabled="state.catalogLoading"
          title="重新加载四套引擎规则目录"
          @click="loadCatalogs()">
          <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': state.catalogLoading }" />
        </button>
        <button type="button"
          data-testid="rule-check-run-btn"
          class="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          :disabled="state.catalogLoading"
          @click="handleRunChecks()">
          <Play class="h-3 w-3" />
          {{ runLabel }}
        </button>
      </template>
    </div>

    <!-- 运行设置：运行后收成一行摘要 -->
    <button v-if="!settingsOpen"
      type="button"
      data-testid="rule-check-settings-summary"
      class="flex w-full items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5 text-left hover:bg-muted/50"
      @click="settingsOpen = true">
      <SlidersHorizontal class="h-3 w-3 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate text-[11px] text-foreground/80">{{ settingsSummary }}</span>
      <span class="shrink-0 text-[11px] font-medium text-primary">调整</span>
      <ChevronDown class="h-3 w-3 shrink-0 text-primary" />
    </button>
    <div v-else data-testid="rule-check-settings" class="space-y-2 border-b border-border bg-muted/20 px-3 py-2">
      <div class="flex items-center gap-1.5">
        <SlidersHorizontal class="h-3 w-3 text-muted-foreground" />
        <span class="text-[11px] font-semibold text-foreground/80">运行设置</span>
        <span class="text-[10px] text-muted-foreground/70">运行后自动收起</span>
        <span class="flex-1" />
        <button type="button"
          data-testid="rule-check-settings-toggle"
          class="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
          @click="settingsOpen = false">
          收起
          <ChevronUp class="h-3 w-3" />
        </button>
      </div>

      <div class="flex flex-wrap gap-0.5 rounded-md border border-border bg-background p-0.5">
        <button v-for="eng in ENGINE_OPTIONS"
          :key="eng"
          type="button"
          class="flex flex-auto flex-col items-center whitespace-nowrap rounded px-1.5 py-0.5 transition-colors"
          :class="state.activeEngine === eng ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="state.activeEngine = eng">
          <span class="text-[11px] font-medium">{{ engineOptionLabel(eng) }}</span>
          <span class="font-mono text-[10px] opacity-80">{{ engineCounts[eng] }}</span>
        </button>
      </div>

      <div class="flex flex-wrap gap-1">
        <button type="button"
          class="rounded border px-2 py-0.5 text-[11px]"
          :class="
            state.activeDiscipline === 'all'
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-border bg-background text-muted-foreground hover:bg-muted'
          "
          @click="state.activeDiscipline = 'all'">
          全专业 <span class="font-mono">{{ disciplineCounts.all ?? 0 }}</span>
        </button>
        <button v-for="disc in RULE_CHECK_DISCIPLINES"
          :key="disc"
          type="button"
          class="rounded border px-2 py-0.5 text-[11px]"
          :class="
            state.activeDiscipline === disc
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-border bg-background text-muted-foreground hover:bg-muted'
          "
          @click="state.activeDiscipline = disc">
          {{ disc }} <span class="font-mono">{{ disciplineCounts[disc] ?? 0 }}</span>
        </button>
      </div>

      <!-- 精确复核：最小净距类规则按三维网格精算 -->
      <label v-if="showPreciseToggle"
        data-testid="rule-check-precise-toggle"
        class="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5"
        :class="state.precise ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'">
        <input v-model="state.precise"
          type="checkbox"
          data-testid="rule-check-precise-input"
          class="peer sr-only" />
        <span class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40"
          :class="state.precise ? 'bg-primary' : 'bg-muted-foreground/40'"
          aria-hidden="true">
          <span class="absolute h-3 w-3 rounded-full bg-white shadow transition-transform"
            :class="state.precise ? 'translate-x-3.5' : 'translate-x-0.5'" />
        </span>
        <span class="min-w-0 space-y-0.5">
          <span class="block text-[11px] font-medium text-foreground">精确复核（网格外表面距离）</span>
          <span class="block text-[10px] leading-snug text-muted-foreground">
            最小净距类规则先用包围盒估算初筛，再按三维网格精算剔除误报；缺网格的保留估算结果，耗时会增加。
          </span>
        </span>
      </label>

      <!-- BRAN 与交互选集输入 -->
      <div v-if="showBranInput" class="flex items-center gap-1.5">
        <label class="w-10 shrink-0 text-[11px] text-muted-foreground">BRAN</label>
        <div class="flex shrink-0 overflow-hidden rounded border border-border bg-background" data-testid="rule-check-bran-scope">
          <button v-for="opt in BRAN_SCOPE_OPTIONS"
            :key="opt.key"
            type="button"
            :data-testid="`rule-check-bran-scope-${opt.key}`"
            class="px-1.5 py-1 text-[11px] transition-colors"
            :class="
              state.branScope === opt.key
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted'
            "
            @click="state.branScope = opt.key">
            {{ opt.label }}
          </button>
        </div>
        <input v-model="state.branRefno"
          type="text"
          :disabled="state.branScope === 'all'"
          :placeholder="state.branScope === 'all' ? '全项目逐根运行 BRAN 拓扑规则（耗时较长）' : '如 24381_145018（BRAN 拓扑规则必填）'"
          class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus:border-primary focus:outline-none disabled:opacity-50" />
        <button type="button"
          class="shrink-0 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          title="填入当前三维选中构件的 refno"
          :disabled="state.branScope === 'all'"
          @click="handleFillBranFromSelection()">
          取选中
        </button>
      </div>

      <div v-if="showScopeInput" class="flex items-center gap-1.5">
        <label class="w-10 shrink-0 text-[11px] text-muted-foreground">选集</label>
        <input v-model="state.attrScopeText"
          type="text"
          placeholder="可选：逗号分隔 refno（通道/火灾/点选支架）"
          class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus:border-primary focus:outline-none" />
        <button type="button"
          class="shrink-0 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
          title="按序追加当前三维选中构件"
          @click="handleAppendScopeFromSelection()">
          +选中
        </button>
      </div>
    </div>

    <!-- 主视图切换 Tab -->
    <div class="flex items-center gap-4 border-b border-border px-3">
      <button type="button"
        class="inline-flex items-center gap-1 border-b-2 py-1.5 text-[12px] font-medium transition-colors"
        :class="
          activeTab === 'catalog'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="activeTab = 'catalog'">
        规则目录
        <span class="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{{ filteredCatalog.length }}</span>
      </button>
      <button type="button"
        data-testid="rule-check-results-tab"
        class="inline-flex items-center gap-1 border-b-2 py-1.5 text-[12px] font-medium transition-colors"
        :class="
          activeTab === 'results'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="activeTab = 'results'">
        校验结果
        <span class="rounded px-1 font-mono text-[10px]"
          :class="summaryStats.totalReported > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'">
          {{ summaryStats.totalReported }}
        </span>
      </button>
      <span class="flex-1" />
      <div v-if="activeTab === 'catalog'" class="flex items-center gap-1.5 text-[11px]">
        <button type="button" class="text-primary hover:underline" @click="selectAllFiltered()">全选</button>
        <span class="text-muted-foreground">/</span>
        <button type="button" class="text-muted-foreground hover:underline" @click="clearRuleSelection()">清空</button>
      </div>
    </div>

    <!-- 错误与告警提示 -->
    <div v-if="state.catalogError || state.runError" class="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-destructive">
      {{ state.runError || state.catalogError }}
    </div>
    <div v-if="state.catalogWarnings.length > 0 || state.runWarnings.length > 0"
      class="max-h-20 overflow-y-auto border-b border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-800 dark:text-amber-300">
      <div v-for="(w, i) in [...state.catalogWarnings, ...state.runWarnings]" :key="i">
        · {{ w }}
      </div>
    </div>

    <!-- Tab 1: 规则目录 -->
    <div v-if="activeTab === 'catalog'" class="flex flex-1 flex-col overflow-hidden">
      <div class="border-b border-border px-3 py-1.5">
        <div class="relative">
          <Search class="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
          <input v-model="state.searchKeyword"
            type="text"
            placeholder="搜索规则 id / 标题 / 规范要求 / #工单号…"
            class="w-full rounded border border-border bg-background py-1 pl-7 pr-2 text-[11px] focus:border-primary focus:outline-none" />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto divide-y divide-border">
        <div v-if="state.catalogLoading" class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <LoaderCircle class="h-4 w-4 animate-spin" />
          正在加载规则目录…
        </div>
        <div v-else-if="filteredCatalog.length === 0" class="py-8 text-center text-muted-foreground">
          无匹配规则条目
        </div>
        <div v-for="row in filteredCatalog"
          :key="`${row.engine}:${row.id}`"
          class="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-muted/50"
          @click="toggleRuleSelection(row.id)">
          <component :is="state.selectedRuleIds.includes(row.id) ? CheckSquare : Square"
            class="mt-0.5 h-3.5 w-3.5 shrink-0"
            :class="state.selectedRuleIds.includes(row.id) ? 'text-primary' : 'text-muted-foreground'" />
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-mono font-medium text-foreground">{{ row.id }}</span>
              <span class="rounded bg-muted px-1 py-0.2 text-[10px] text-muted-foreground">{{ row.discipline }}</span>
              <span class="rounded border border-border px-1 py-0.2 text-[10px] text-muted-foreground">
                {{ RULE_CHECK_ENGINE_LABELS[row.engine] }}
              </span>
              <span class="font-mono text-[10px] text-muted-foreground">#{{ row.issue }}</span>
            </div>
            <div class="text-[11px] text-foreground">{{ row.title }}</div>
            <div class="font-mono text-[10px] text-muted-foreground">规范：{{ row.requirement }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: 校验结果与三维高亮定位 -->
    <div v-else class="flex flex-1 flex-col overflow-hidden">
      <!-- 运行中：分引擎进度 -->
      <div v-if="state.running && hasEngineRuns" data-testid="rule-check-progress" class="space-y-1.5 border-b border-border px-3 py-2">
        <div class="flex items-center gap-1.5">
          <LoaderCircle class="h-3.5 w-3.5 animate-spin text-primary" />
          <span class="text-[12px] font-semibold">正在校验</span>
          <span class="font-mono text-[11px] text-muted-foreground">{{ engineRunsDone }} / {{ state.engineRuns.length }} 完成</span>
          <span class="flex-1" />
          <span class="text-[10px] text-muted-foreground">先完成的先出结果</span>
        </div>
        <div class="flex gap-0.5">
          <span v-for="run in state.engineRuns"
            :key="run.engine"
            class="h-1 flex-1 rounded-full"
            :class="engineRunBarClass(run)" />
        </div>
        <div v-for="run in state.engineRuns"
          :key="run.engine"
          :data-testid="`rule-check-engine-run-${run.engine}`"
          :data-status="run.status"
          class="flex items-center gap-1.5">
          <component :is="engineRunIcon(run)" class="h-3.5 w-3.5 shrink-0" :class="engineRunIconClass(run)" />
          <span class="w-[72px] shrink-0 truncate text-[11px] font-medium">{{ run.label }}</span>
          <span class="min-w-0 flex-1 truncate text-[10px]"
            :class="run.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
            :title="engineRunText(run)">{{ engineRunText(run) }}</span>
          <button v-if="run.status === 'failed'"
            type="button"
            :data-testid="`rule-check-engine-retry-${run.engine}`"
            class="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
            @click="retryEngine(run.engine)">
            <RotateCcw class="h-3 w-3" />
            重试
          </button>
          <span v-else class="shrink-0 font-mono text-[10px] text-muted-foreground">{{ engineRunTime(run) }}</span>
        </div>
      </div>

      <!-- 本次结果概览：统计格兼作严重度筛选 -->
      <div v-if="state.batches.length > 0 || (!state.running && hasEngineRuns)"
        data-testid="rule-check-overview"
        class="space-y-2 border-b border-border px-3 py-2">
        <div class="flex items-center gap-1.5">
          <span class="shrink-0 text-[12px] font-semibold">本次结果</span>
          <span v-if="state.running" class="truncate text-[11px] text-muted-foreground">陆续并入中…</span>
          <span v-else data-testid="rule-check-run-meta" class="truncate text-[11px] text-muted-foreground">
            {{ lastRunTime }} · 用时 {{ formatRuleCheckDuration(state.runElapsedMs) }}
          </span>
          <span class="flex-1" />
          <template v-if="state.results.length > 0">
            <button type="button"
              data-testid="rule-check-export-csv-btn"
              class="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted"
              title="导出中文 Excel 兼容 UTF-8 BOM CSV 报告"
              @click="handleExportCsv()">
              <Download class="h-3 w-3" />
              CSV
            </button>
            <button type="button"
              data-testid="rule-check-export-json-btn"
              class="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted"
              title="导出完整结构化 JSON 校验报告"
              @click="handleExportJson()">
              <FileJson class="h-3 w-3" />
              JSON
            </button>
          </template>
          <button v-if="!state.running"
            type="button"
            data-testid="rule-check-clear-results-btn"
            class="shrink-0 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
            @click="handleClearResults()">
            清空
          </button>
        </div>

        <template v-if="state.results.length > 0">
          <div class="grid grid-cols-4 gap-1">
            <button v-for="cell in SEVERITY_CELLS"
              :key="cell.key"
              type="button"
              :data-testid="`rule-check-result-filter-${cell.key}`"
              class="rounded-md border px-1.5 py-1 text-left transition-colors"
              :class="
                resultSeverityFilter === cell.key
                  ? 'border-foreground/60 bg-muted/60'
                  : 'border-border bg-background hover:bg-muted/40'
              "
              :aria-pressed="resultSeverityFilter === cell.key"
              @click="toggleSeverityCell(cell.key)">
              <span class="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="cell.dot" />
                <span class="truncate">{{ cell.label }}</span>
              </span>
              <span class="block font-mono text-sm font-semibold"
                :class="resultSeverityCounts[cell.key] > 0 ? 'text-foreground' : 'text-muted-foreground/50'">
                {{ resultSeverityCounts[cell.key] }}
              </span>
            </button>
          </div>
          <div v-if="severityBarSegments.length > 0" class="flex h-1 gap-px overflow-hidden rounded-full bg-border">
            <span v-for="seg in severityBarSegments"
              :key="seg.key"
              class="h-full basis-0"
              :class="seg.cls"
              :style="{ flexGrow: seg.n }" />
          </div>
        </template>

        <div v-if="preciseSummary"
          data-testid="rule-check-precise-summary"
          class="space-y-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-[11px]">
          <div class="flex items-center gap-1.5">
            <Sparkles class="h-3 w-3 text-emerald-700" />
            <span class="font-semibold text-emerald-700">精确复核</span>
            <span class="flex-1" />
            <span class="text-[10px]" :class="preciseSummary.unavailable > 0 ? 'text-amber-700' : 'text-muted-foreground'">
              缺网格 {{ preciseSummary.unavailable }} 对{{ preciseSummary.unavailable > 0 ? '，保留估算' : '' }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-x-1.5 font-mono">
            <span class="text-foreground/80">估算 {{ preciseSummary.aabbFindings }}</span>
            <ArrowRight class="h-3 w-3 text-muted-foreground" />
            <span class="text-emerald-700">精算剔除 {{ preciseSummary.cleared }}</span>
            <ArrowRight class="h-3 w-3 text-muted-foreground" />
            <span class="font-semibold">保留 {{ Math.max(0, preciseSummary.aabbFindings - preciseSummary.cleared) }}</span>
            <span class="text-[10px] text-muted-foreground">· 可精算规则 {{ preciseSummary.refinableRules }} 条</span>
          </div>
        </div>

        <div v-if="branAllSummary" data-testid="rule-check-bran-all-summary" class="flex items-center gap-1.5 text-[11px]">
          <GitBranch class="h-3 w-3 text-muted-foreground" />
          <span class="font-medium text-foreground/80">全项目 BRAN</span>
          <span class="font-mono">已检 {{ branAllSummary.bransChecked }} / {{ branAllSummary.bransTotal }} 根</span>
          <span class="flex-1" />
          <span class="text-[10px]" :class="branAllSummary.bransFailed > 0 ? 'text-amber-700' : 'text-muted-foreground'">
            读取失败 {{ branAllSummary.bransFailed }} 根
          </span>
        </div>

        <div v-if="!state.running && hasEngineRuns" data-testid="rule-check-engine-status" class="flex flex-wrap gap-1">
          <span v-for="run in state.engineRuns"
            :key="run.engine"
            :data-testid="`rule-check-engine-chip-${run.engine}`"
            :data-status="run.status"
            class="inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px]"
            :class="
              run.status === 'failed'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border bg-muted/40 text-foreground/80'
            "
            :title="run.status === 'failed' ? `${run.label}：${run.error ?? ''}` : run.label">
            <component :is="engineRunIcon(run)" class="h-3 w-3" :class="engineRunIconClass(run)" />
            {{ ENGINE_SHORT_LABELS[run.engine] }}
            <button v-if="run.status === 'failed'"
              type="button"
              :data-testid="`rule-check-engine-retry-${run.engine}`"
              class="font-medium underline-offset-2 hover:underline"
              @click="retryEngine(run.engine)">
              重试
            </button>
            <span v-else class="font-mono text-muted-foreground">{{ engineRunTime(run) }}</span>
          </span>
        </div>
      </div>

      <!-- 结果工具条：搜索 + 筛选托盘 + 视图切换 + 三维着色 -->
      <div v-if="allViolations.length > 0" class="space-y-1.5 border-b border-border px-3 py-1.5">
        <div class="flex items-center gap-1.5">
          <div class="relative min-w-0 flex-1">
            <Search class="pointer-events-none absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
            <input v-model="resultKeyword"
              type="text"
              data-testid="rule-check-result-search"
              placeholder="筛选结果：规则 / 房号 / refno / 详情…"
              class="w-full rounded border border-border bg-background py-0.5 pl-6 pr-2 text-[11px] focus:border-primary focus:outline-none" />
          </div>
          <button type="button"
            data-testid="rule-check-filter-toggle"
            class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors"
            :class="
              filterTrayOpen
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-background text-foreground/80 hover:bg-muted'
            "
            :aria-expanded="filterTrayOpen"
            @click="filterTrayOpen = !filterTrayOpen">
            <ListFilter class="h-3 w-3" />
            筛选
            <span v-if="trayFilterCount > 0" class="rounded-full bg-primary px-1 font-mono text-[9px] text-primary-foreground">{{ trayFilterCount }}</span>
          </button>
          <div class="flex shrink-0 rounded border border-border bg-muted/40 p-px">
            <button type="button"
              data-testid="rule-check-flat-view-btn"
              title="平铺列表"
              class="inline-flex h-5 w-6 items-center justify-center rounded-sm"
              :class="!groupByRule ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="!groupByRule"
              @click="groupByRule = false">
              <List class="h-3 w-3" />
            </button>
            <button type="button"
              data-testid="rule-check-group-toggle-btn"
              title="按规则分组"
              class="inline-flex h-5 w-6 items-center justify-center rounded-sm"
              :class="groupByRule ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="groupByRule"
              @click="groupByRule = true">
              <Layers class="h-3 w-3" />
            </button>
          </div>
        </div>

        <div v-if="filterTrayOpen" data-testid="rule-check-filter-tray" class="space-y-1.5 rounded-md border border-border bg-muted/30 p-2">
          <div v-if="preciseSummary" class="flex items-center gap-1.5" data-testid="rule-check-accuracy-filter">
            <span class="w-7 shrink-0 text-[10px] text-muted-foreground">口径</span>
            <div class="flex rounded border border-border bg-background p-px">
              <button v-for="opt in ACCURACY_OPTIONS"
                :key="opt.key"
                type="button"
                :data-testid="`rule-check-accuracy-filter-${opt.key}`"
                class="rounded-sm px-1.5 py-0.5 text-[10px] transition-colors"
                :class="
                  resultAccuracyFilter === opt.key
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="resultAccuracyFilter = opt.key">
                {{ opt.label }} <span class="font-mono">{{ resultAccuracyCounts[opt.key] }}</span>
              </button>
            </div>
          </div>
          <div class="flex items-start gap-1.5">
            <span class="w-7 shrink-0 pt-0.5 text-[10px] text-muted-foreground">专业</span>
            <div class="flex flex-wrap gap-1">
              <button v-for="(count, disc) in resultDisciplineCounts"
                :key="disc"
                type="button"
                :data-testid="`rule-check-discipline-filter-${disc}`"
                class="rounded border px-1.5 py-0.5 text-[10px] transition-colors"
                :class="
                  resultDisciplines.includes(String(disc))
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted'
                "
                @click="toggleResultDiscipline(String(disc))">
                {{ disc }} <span class="font-mono">{{ count }}</span>
              </button>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="w-7 shrink-0 text-[10px] text-muted-foreground">其他</span>
            <label v-if="hasCopyNamed" class="inline-flex items-center gap-1 text-[11px] text-foreground/80">
              <input v-model="copyOnly" type="checkbox" data-testid="rule-check-copy-only" class="rounded" />
              只看 Copy-of 副本
            </label>
            <label class="inline-flex items-center gap-1 text-[11px] text-foreground/80">
              <input :checked="!onlyViolationsFilter"
                type="checkbox"
                data-testid="rule-check-show-passed"
                class="rounded"
                @change="onlyViolationsFilter = !($event.target as HTMLInputElement).checked" />
              显示通过的规则
            </label>
            <span class="flex-1" />
            <button type="button"
              data-testid="rule-check-clear-filters"
              class="text-[10px] text-primary hover:underline"
              @click="clearAllFilters()">
              清除全部
            </button>
          </div>
        </div>

        <div v-if="isResultFiltered" class="flex flex-wrap items-center gap-1">
          <button v-for="chip in activeFilterChips"
            :key="chip.key"
            type="button"
            data-testid="rule-check-active-filter"
            class="inline-flex items-center gap-0.5 rounded-full border border-primary/30 bg-primary/10 py-px pl-1.5 pr-1 text-[10px] text-primary hover:bg-primary/15"
            :title="`移除：${chip.label}`"
            @click="chip.clear()">
            {{ chip.label }}
            <X class="h-2.5 w-2.5" />
          </button>
          <span class="flex-1" />
          <span data-testid="rule-check-result-filtered-count" class="shrink-0 font-mono text-[10px] text-primary">{{ visibleViolations.length }}/{{ allViolations.length }}</span>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[10px] text-muted-foreground">三维着色</span>
          <div class="flex rounded border border-border bg-muted/40 p-px">
            <button v-for="seg in OVERLAY_SEGMENTS"
              :key="seg.key"
              type="button"
              :data-testid="seg.testid"
              class="rounded-sm px-2 py-0.5 text-[10px] transition-colors disabled:opacity-40"
              :class="
                overlaySegment === seg.key
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              "
              :disabled="isOverlaySegmentDisabled(seg.key)"
              :aria-pressed="overlaySegment === seg.key"
              @click="setOverlayMode(seg.key)">
              {{ seg.label }}<span v-if="seg.key === 'firezone'" class="ml-0.5 font-mono">{{ summaryStats.firezones }}</span>
            </button>
          </div>
          <label class="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <input v-model="overlayState.xrayOthers" type="checkbox" class="rounded" />
            透视其余
          </label>
          <span v-if="overlayState.activeMode === 'isolate'" class="text-[10px] font-medium text-primary">隔离显示中</span>
        </div>

        <!-- 激活着色时的实时图例 -->
        <div v-if="overlayState.activeMode !== null"
          data-testid="rule-check-overlay-legend"
          class="flex flex-wrap items-center gap-2 rounded bg-muted/50 px-2 py-1 text-[10px]">
          <span v-for="cat in OVERLAY_LEGEND_CATEGORIES.filter((c) => overlayState.categoryCounts[c] > 0)"
            :key="cat"
            class="inline-flex items-center gap-1">
            <span class="inline-block h-2 w-2 rounded-full"
              :style="{ backgroundColor: RULE_CHECK_OVERLAY_PALETTE[cat].hex }" />
            {{ RULE_CHECK_OVERLAY_PALETTE[cat].label }}
            <span class="font-mono text-muted-foreground">{{ overlayState.categoryCounts[cat] }}</span>
          </span>
          <span class="ml-auto font-mono text-muted-foreground">
            已着色 {{ overlayState.paintedRefnoCount }} 构件 / {{ overlayState.paintedObjectCount }} 图元
          </span>
        </div>
        <div v-if="overlayState.lastNotice" class="text-[10px] text-amber-700 dark:text-amber-300">
          {{ overlayState.lastNotice }}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div v-if="state.running && state.batches.length === 0" class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <LoaderCircle class="h-4 w-4 animate-spin" />
          正在执行规范校验…
        </div>
        <div v-else-if="state.results.length === 0" class="py-8 text-center text-muted-foreground">
          {{ hasEngineRuns ? '本次没有返回规则结果' : '点击右上角「执行校验」运行规则评测' }}
        </div>
        <template v-else>
          <div v-if="allViolations.length === 0 && onlyViolationsFilter" class="space-y-1 py-8 text-center">
            <div class="text-emerald-600">全部 {{ summaryStats.rulesRun }} 条已执行规则 0 违规通过</div>
            <button type="button" class="text-[11px] text-primary hover:underline" @click="onlyViolationsFilter = false">
              查看通过的规则
            </button>
          </div>
          <div v-else-if="visibleViolations.length === 0" class="py-8 text-center text-muted-foreground">
            当前筛选条件下无匹配违规项
          </div>

          <!-- 分组视图 -->
          <template v-else-if="groupByRule">
            <div v-for="group in groupedViolations"
              :key="group.key"
              data-testid="rule-check-violation-group">
              <div class="border-b border-border bg-muted/40 px-3 py-1.5">
                <div class="flex items-center gap-1.5">
                  <button type="button"
                    data-testid="rule-check-group-header"
                    class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    :aria-expanded="!collapsedGroups.includes(group.key)"
                    @click="toggleGroupCollapsed(group.key)">
                    <component :is="collapsedGroups.includes(group.key) ? ChevronRight : ChevronDown"
                      class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span class="shrink-0 whitespace-nowrap font-mono font-semibold text-foreground">{{ group.ruleId }}</span>
                    <span class="truncate text-[11px] text-muted-foreground" :title="group.title">{{ group.title }}</span>
                  </button>
                  <span class="shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 font-mono text-[10px] font-semibold text-destructive">
                    {{ group.violations.length }}
                  </span>
                  <button type="button"
                    data-testid="rule-check-focus-group-btn"
                    title="定位本组"
                    class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
                    :disabled="group.allHighlightRefnos.length === 0"
                    @click="focusRefnos(group.allHighlightRefnos)">
                    <Crosshair class="h-3 w-3" />
                  </button>
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 pl-5 text-[10px] text-muted-foreground">
                  <span>{{ group.discipline }}</span>
                  <template v-if="groupPreciseLabel(group.key)">
                    <span class="text-muted-foreground/50">·</span>
                    <span data-testid="rule-check-group-precise" class="font-mono text-emerald-700">{{ groupPreciseLabel(group.key) }}</span>
                  </template>
                </div>
              </div>
              <template v-if="!collapsedGroups.includes(group.key)">
                <RuleCheckViolationRow v-for="v in group.violations"
                  :key="v.key"
                  :violation="v"
                  :active="state.activeViolationKey === v.key"
                  :expanded="expandedKey === v.key"
                  :show-rule="false"
                  :precise-run="preciseSummary !== null"
                  @select="handleSelectViolation"
                  @focus="focusViolation"
                  @isolate="handleIsolateViolation"
                  @only-rule="handleOnlyRule" />
              </template>
            </div>
          </template>

          <!-- 平铺视图 -->
          <template v-else>
            <RuleCheckViolationRow v-for="v in visibleViolations"
              :key="v.key"
              :violation="v"
              :active="state.activeViolationKey === v.key"
              :expanded="expandedKey === v.key"
              :show-rule="true"
              :precise-run="preciseSummary !== null"
              @select="handleSelectViolation"
              @focus="focusViolation"
              @isolate="handleIsolateViolation"
              @only-rule="handleOnlyRule" />
          </template>

          <div v-if="state.running" class="flex items-center justify-center gap-1.5 py-3 text-[10px] text-muted-foreground">
            <LoaderCircle class="h-3 w-3 animate-spin" />
            其余引擎跑完后自动并入
          </div>

          <!-- 显示通过的规则 -->
          <div v-if="!onlyViolationsFilter" class="bg-muted/20 px-3 py-2">
            <div class="mb-1 text-[11px] font-medium text-muted-foreground">通过规则（0 违规）</div>
            <div class="flex flex-wrap gap-1">
              <span v-for="r in state.results.filter((x) => x.violationTotal === 0)"
                :key="`${r.engine}:${r.id}`"
                class="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">
                {{ r.id }}
              </span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
