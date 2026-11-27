<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Download,
  FileJson,
  Flame,
  Layers,
  List,
  Loader2,
  Palette,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  X,
} from 'lucide-vue-next';

import type { UnifiedPreciseStats, UnifiedRuleViolation } from '@/api/ruleCheckApi';

import {
  RULE_CHECK_DISCIPLINES,
  RULE_CHECK_ENGINE_LABELS,
  useRuleCheck,
  type RuleCheckBranScope,
  type RuleCheckEngineFilter,
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
  countViolationsByResultSeverity,
  filterRuleViolations,
  groupViolationsByRule,
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

const activeTab = ref<'catalog' | 'results'>('catalog');
const onlyViolationsFilter = ref(true);
const resultSeverityFilter = ref<RuleCheckResultSeverityFilter>('all');
const resultAccuracyFilter = ref<RuleCheckResultAccuracyFilter>('all');
const resultKeyword = ref('');
const groupByRule = ref(false);
const collapsedGroups = ref<string[]>([]);

const RESULT_SEVERITY_OPTIONS: { key: RuleCheckResultSeverityFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'violation', label: '违规' },
  { key: 'reminder', label: '提醒' },
  { key: 'semi_auto', label: '半自动' },
  { key: 'firezone', label: '火灾分区' },
];

const ACCURACY_OPTIONS: { key: RuleCheckResultAccuracyFilter; label: string }[] = [
  { key: 'all', label: '全部口径' },
  { key: 'exact', label: '精算' },
  { key: 'aabb', label: '估算' },
];

const BRAN_SCOPE_OPTIONS: { key: RuleCheckBranScope; label: string }[] = [
  { key: 'single', label: '单根' },
  { key: 'all', label: '全项目' },
];

const ENGINE_OPTIONS: RuleCheckEngineFilter[] = ['all', 'spatial', 'bran', 'rooms', 'attrs'];

const COPY_BADGE_TITLE = '源或目标（或其所在 BRAN / PIPE）叫 E3D 复制名 Copy-of-…：多半是复制后没挪开、与原件重叠的副本';

const showPreciseToggle = computed(
  () => state.activeEngine === 'all' || state.activeEngine === 'spatial',
);

const preciseSummary = computed(() => summaryStats.value.precise);

const branAllSummary = computed(() => summaryStats.value.branAll);

const resultAccuracyCounts = computed(() => countViolationsByAccuracy(allViolations.value));

const preciseStatsByRule = computed(() => {
  const map = new Map<string, UnifiedPreciseStats>();
  for (const r of state.results) {
    if (r.precise?.refinable) map.set(`${r.engine}:${r.id}`, r.precise);
  }
  return map;
});

const showBranInput = computed(
  () => state.activeEngine === 'bran' || state.activeEngine === 'all',
);

const showScopeInput = computed(
  () => state.activeEngine === 'attrs' || state.activeEngine === 'all',
);

const resultSeverityCounts = computed(() => countViolationsByResultSeverity(allViolations.value));

const visibleViolations = computed(() =>
  filterRuleViolations(allViolations.value, {
    severity: resultSeverityFilter.value,
    keyword: resultKeyword.value,
    accuracy: resultAccuracyFilter.value,
  }),
);

const groupedViolations = computed(() => groupViolationsByRule(visibleViolations.value));

const isResultFiltered = computed(
  () => resultSeverityFilter.value !== 'all'
    || resultAccuracyFilter.value !== 'all'
    || resultKeyword.value.trim().length > 0,
);

function toggleGroupCollapsed(groupKey: string) {
  const idx = collapsedGroups.value.indexOf(groupKey);
  if (idx >= 0) collapsedGroups.value.splice(idx, 1);
  else collapsedGroups.value.push(groupKey);
}

onMounted(() => {
  if (!state.catalogLoaded && !state.catalogLoading) {
    void loadCatalogs();
  }
});

async function handleRunChecks() {
  clearOverlay();
  resultSeverityFilter.value = 'all';
  resultAccuracyFilter.value = 'all';
  resultKeyword.value = '';
  collapsedGroups.value = [];
  activeTab.value = 'results';
  await runChecks();
}

function handleClearResults() {
  clearOverlay();
  resultSeverityFilter.value = 'all';
  resultAccuracyFilter.value = 'all';
  resultKeyword.value = '';
  collapsedGroups.value = [];
  clearResults();
}

async function handleToggleOverlay(mode: RuleCheckOverlayMode) {
  if (overlayState.activeMode === mode) {
    clearOverlay();
    return;
  }
  await applyOverlay(visibleViolations.value, { mode, xrayOthers: overlayState.xrayOthers });
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
  const json = buildRuleCheckJson({
    summary: {
      ...summaryStats.value,
      totalElapsedMs: state.totalElapsedMs,
    },
    warnings: [...state.catalogWarnings, ...state.runWarnings],
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

function severityBadge(v: UnifiedRuleViolation): { label: string; cls: string } {
  if (v.highlightColor === 'red') {
    return { label: '扩散性火灾', cls: 'bg-red-500/15 text-red-600 border-red-500/30' };
  }
  if (v.highlightColor === 'yellow') {
    return { label: '局部性火灾', cls: 'bg-amber-500/15 text-amber-700 border-amber-500/30' };
  }
  if (v.severity === 'reminder') {
    return { label: '提醒', cls: 'bg-sky-500/15 text-sky-700 border-sky-500/30' };
  }
  if (v.severity === 'semi_auto') {
    return { label: '半自动复核', cls: 'bg-violet-500/15 text-violet-700 border-violet-500/30' };
  }
  return { label: '违规', cls: 'bg-destructive/15 text-destructive border-destructive/30' };
}

/** 精算行始终标注；估算只在本次开了精确复核时标注（未开时全部结果都是包围盒口径）。 */
function accuracyBadge(v: UnifiedRuleViolation): { label: string; cls: string; title: string } | null {
  if (v.accuracy === 'exact') {
    return {
      label: '精算',
      cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
      title: '三维网格外表面距离',
    };
  }
  if (v.accuracy === 'aabb' && preciseSummary.value) {
    return {
      label: '估算',
      cls: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
      title: '包围盒距离：缺网格或规则不参与精算',
    };
  }
  return null;
}

/** 实测值已扣隔热层时，另列未扣的网格外表面距。 */
function exactSurfaceNote(v: UnifiedRuleViolation): string | null {
  if (v.exactSurfaceMm === undefined || v.measuredMm === undefined) return null;
  if (Math.abs(v.exactSurfaceMm - v.measuredMm) < 0.05) return null;
  return `外表面 ${v.exactSurfaceMm.toFixed(1)}${v.unit ? ` ${v.unit}` : ''}`;
}

function groupPreciseLabel(groupKey: string): string | null {
  const stats = preciseStatsByRule.value.get(groupKey);
  if (!stats) return null;
  return `估算 ${stats.aabbFindings} → 剔除 ${stats.cleared}`;
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

/** 点击违规行 → 装载/可见/高亮全部关联构件，并将三维相机飞至其联合包围盒。 */
async function focusViolation(violation: UnifiedRuleViolation) {
  state.activeViolationKey = violation.key;
  await focusRefnos(violation.highlightRefnos);
}
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground text-xs">
    <!-- 顶部栏 -->
    <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-semibold text-sm truncate">规范校验</span>
        <span class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
          data-testid="rule-check-total-count">
          {{ engineCounts.all }} 条
        </span>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button"
          class="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          :disabled="state.catalogLoading"
          title="重新加载四套引擎规则目录"
          @click="loadCatalogs()">
          <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': state.catalogLoading }" />
          刷新目录
        </button>
        <button v-if="state.running"
          type="button"
          class="inline-flex items-center gap-1 rounded bg-destructive px-2.5 py-1 text-[11px] font-medium text-destructive-foreground hover:opacity-90"
          @click="cancelRun()">
          <X class="h-3 w-3" />
          取消
        </button>
        <button v-else
          type="button"
          data-testid="rule-check-run-btn"
          class="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          :disabled="state.catalogLoading"
          @click="handleRunChecks()">
          <Play class="h-3 w-3" />
          {{ state.selectedRuleIds.length > 0 ? `运行已选 (${state.selectedRuleIds.length})` : '执行校验' }}
        </button>
      </div>
    </div>

    <!-- 引擎与专业筛选 -->
    <div class="space-y-2 border-b border-border px-3 py-2">
      <div class="flex flex-wrap gap-1">
        <button v-for="eng in ENGINE_OPTIONS"
          :key="eng"
          type="button"
          class="rounded border px-2 py-0.5 text-[11px] transition-colors"
          :class="
            state.activeEngine === eng
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-muted'
          "
          @click="state.activeEngine = eng">
          {{ RULE_CHECK_ENGINE_LABELS[eng] }}
          <span class="ml-0.5 font-mono opacity-80">{{ engineCounts[eng] }}</span>
        </button>
      </div>

      <div class="flex flex-wrap gap-1">
        <button type="button"
          class="rounded border px-2 py-0.5 text-[11px]"
          :class="
            state.activeDiscipline === 'all'
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-border text-muted-foreground hover:bg-muted'
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
              : 'border-border text-muted-foreground hover:bg-muted'
          "
          @click="state.activeDiscipline = disc">
          {{ disc }} <span class="font-mono">{{ disciplineCounts[disc] ?? 0 }}</span>
        </button>
      </div>

      <!-- 精确复核：最小净距类规则按三维网格精算 -->
      <label v-if="showPreciseToggle"
        data-testid="rule-check-precise-toggle"
        class="flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5"
        :class="state.precise ? 'border-primary/40 bg-primary/5' : 'border-border'">
        <input v-model="state.precise"
          type="checkbox"
          data-testid="rule-check-precise-input"
          class="mt-0.5 rounded" />
        <span class="min-w-0 space-y-0.5">
          <span class="block text-[11px] font-medium text-foreground">精确复核（网格外表面距离）</span>
          <span class="block text-[10px] leading-snug text-muted-foreground">
            最小净距类规则先用包围盒估算初筛，再按三维网格精算剔除误报；缺网格的保留估算结果，耗时会增加。
          </span>
        </span>
      </label>

      <!-- BRAN 与交互选集输入 -->
      <div v-if="showBranInput" class="flex items-center gap-1.5">
        <label class="w-16 shrink-0 text-[11px] text-muted-foreground">BRAN</label>
        <div class="flex shrink-0 overflow-hidden rounded border border-border" data-testid="rule-check-bran-scope">
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
          class="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          title="填入当前三维选中构件的 refno"
          :disabled="state.branScope === 'all'"
          @click="handleFillBranFromSelection()">
          取选中
        </button>
      </div>

      <div v-if="showScopeInput" class="flex items-center gap-1.5">
        <label class="w-16 shrink-0 text-[11px] text-muted-foreground">交互选集</label>
        <input v-model="state.attrScopeText"
          type="text"
          placeholder="可选：逗号分隔 refno（通道/火灾/点选支架）"
          class="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus:border-primary focus:outline-none" />
        <button type="button"
          class="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
          title="按序追加当前三维选中构件"
          @click="handleAppendScopeFromSelection()">
          +选中
        </button>
      </div>
    </div>

    <!-- 主视图切换 Tab -->
    <div class="flex items-center justify-between border-b border-border px-3">
      <div class="flex">
        <button type="button"
          class="border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors"
          :class="
            activeTab === 'catalog'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'catalog'">
          规则目录 ({{ filteredCatalog.length }})
        </button>
        <button type="button"
          data-testid="rule-check-results-tab"
          class="border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors"
          :class="
            activeTab === 'results'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'results'">
          校验结果 ({{ summaryStats.totalReported }})
        </button>
      </div>
      <div v-if="activeTab === 'catalog'" class="flex items-center gap-1.5 text-[11px]">
        <button type="button" class="text-primary hover:underline" @click="selectAllFiltered()">全选</button>
        <span class="text-muted-foreground">/</span>
        <button type="button" class="text-muted-foreground hover:underline" @click="clearRuleSelection()">清空</button>
      </div>
      <div v-else-if="state.results.length > 0" class="flex items-center gap-2 text-[11px]">
        <label class="inline-flex items-center gap-1 text-muted-foreground">
          <input v-model="onlyViolationsFilter" type="checkbox" class="rounded" />
          仅看有检出
        </label>
        <button type="button" class="text-muted-foreground hover:underline" @click="handleClearResults()">清空</button>
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
          <Loader2 class="h-4 w-4 animate-spin" />
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
      <div v-if="state.results.length > 0"
        class="grid grid-cols-4 gap-1.5 border-b border-border bg-muted/30 px-3 py-2 text-center">
        <div class="rounded border border-border bg-card py-1">
          <div class="font-mono text-sm font-semibold">{{ summaryStats.rulesRun }}</div>
          <div class="text-[10px] text-muted-foreground">已跑规则</div>
        </div>
        <div class="rounded border border-border bg-card py-1">
          <div class="font-mono text-sm font-semibold text-destructive">{{ summaryStats.violations }}</div>
          <div class="text-[10px] text-muted-foreground">违规项</div>
        </div>
        <div class="rounded border border-border bg-card py-1">
          <div class="font-mono text-sm font-semibold text-amber-600">
            {{ summaryStats.reminders + summaryStats.semiAuto + summaryStats.firezones }}
          </div>
          <div class="text-[10px] text-muted-foreground">提醒/标注</div>
        </div>
        <div class="rounded border border-border bg-card py-1">
          <div class="font-mono text-sm font-semibold">{{ state.totalElapsedMs }} ms</div>
          <div class="text-[10px] text-muted-foreground">耗时</div>
        </div>
      </div>

      <!-- 精确复核与全项目 BRAN 的运行汇总 -->
      <div v-if="preciseSummary || branAllSummary"
        data-testid="rule-check-run-summary"
        class="space-y-0.5 border-b border-border bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
        <div v-if="preciseSummary" data-testid="rule-check-precise-summary" class="flex flex-wrap items-center gap-x-2">
          <span class="font-medium text-foreground">精确复核</span>
          <span>估算 <span class="font-mono">{{ preciseSummary.aabbFindings }}</span> 项</span>
          <span>→ 精算剔除 <span class="font-mono text-emerald-700">{{ preciseSummary.cleared }}</span> 项误报</span>
          <span>
            · 缺网格
            <span class="font-mono" :class="preciseSummary.unavailable > 0 ? 'text-amber-700' : ''">{{ preciseSummary.unavailable }}</span>
            对
          </span>
          <span>· 可精算规则 <span class="font-mono">{{ preciseSummary.refinableRules }}</span> 条</span>
        </div>
        <div v-if="branAllSummary" data-testid="rule-check-bran-all-summary" class="flex flex-wrap items-center gap-x-2">
          <span class="font-medium text-foreground">全项目 BRAN</span>
          <span>
            已检 <span class="font-mono">{{ branAllSummary.bransChecked }}</span>/<span class="font-mono">{{ branAllSummary.bransTotal }}</span> 根
          </span>
          <span>
            · 读取失败
            <span class="font-mono" :class="branAllSummary.bransFailed > 0 ? 'text-amber-700' : ''">{{ branAllSummary.bransFailed }}</span>
            根
          </span>
        </div>
      </div>

      <!-- 三维着色覆盖层与报告导出工具条 -->
      <div v-if="state.results.length > 0"
        class="space-y-1.5 border-b border-border bg-card/60 px-3 py-1.5">
        <div class="flex flex-wrap items-center justify-between gap-1.5">
          <div class="flex flex-wrap items-center gap-1">
            <button type="button"
              data-testid="rule-check-firezone-overlay-btn"
              class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40"
              :class="
                overlayState.activeMode === 'firezone'
                  ? 'border-red-500 bg-red-500/15 font-medium text-red-600'
                  : 'border-border bg-background hover:bg-muted'
              "
              :disabled="overlayState.applying || summaryStats.firezones === 0"
              title="按火灾分区红（扩散性）/黄（局部性）对三维构件批量着色"
              @click="handleToggleOverlay('firezone')">
              <Flame class="h-3 w-3" />
              火灾着色 ({{ summaryStats.firezones }})
            </button>
            <button type="button"
              data-testid="rule-check-all-overlay-btn"
              class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40"
              :class="
                overlayState.activeMode === 'all'
                  ? 'border-primary bg-primary/15 font-medium text-primary'
                  : 'border-border bg-background hover:bg-muted'
              "
              :disabled="overlayState.applying || allViolations.length === 0"
              title="按火灾色与违规分级对全部涉事构件批量着色"
              @click="handleToggleOverlay('all')">
              <Palette class="h-3 w-3" />
              分级着色
            </button>
            <label class="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <input v-model="overlayState.xrayOthers" type="checkbox" class="rounded" />
              背景透视
            </label>
            <button v-if="overlayState.activeMode !== null"
              type="button"
              data-testid="rule-check-clear-overlay-btn"
              class="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              @click="clearOverlay()">
              <RotateCcw class="h-3 w-3" />
              还原
            </button>
          </div>
          <div class="flex items-center gap-1">
            <button type="button"
              data-testid="rule-check-export-csv-btn"
              class="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
              title="导出中文 Excel 兼容 UTF-8 BOM CSV 报告"
              @click="handleExportCsv()">
              <Download class="h-3 w-3" />
              CSV
            </button>
            <button type="button"
              data-testid="rule-check-export-json-btn"
              class="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
              title="导出完整结构化 JSON 校验报告"
              @click="handleExportJson()">
              <FileJson class="h-3 w-3" />
              JSON
            </button>
          </div>
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

      <!-- 结果筛选与按规则分组工具条 -->
      <div v-if="allViolations.length > 0"
        class="space-y-1.5 border-b border-border bg-background px-3 py-1.5">
        <div class="flex flex-wrap items-center justify-between gap-1">
          <div class="flex flex-wrap gap-1">
            <button v-for="opt in RESULT_SEVERITY_OPTIONS"
              :key="opt.key"
              type="button"
              :data-testid="`rule-check-result-filter-${opt.key}`"
              class="rounded border px-1.5 py-0.5 text-[10px] transition-colors"
              :class="
                resultSeverityFilter === opt.key
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              "
              @click="resultSeverityFilter = opt.key">
              {{ opt.label }} <span class="font-mono">{{ resultSeverityCounts[opt.key] }}</span>
            </button>
          </div>
          <button type="button"
            data-testid="rule-check-group-toggle-btn"
            class="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
            :class="groupByRule ? 'border-primary bg-primary/10 text-primary font-medium' : 'text-muted-foreground'"
            title="切换按规则分组折叠视图或平铺列表"
            @click="groupByRule = !groupByRule">
            <component :is="groupByRule ? Layers : List" class="h-3 w-3" />
            {{ groupByRule ? '按规则分组' : '平铺列表' }}
          </button>
        </div>
        <div v-if="preciseSummary" class="flex flex-wrap items-center gap-1" data-testid="rule-check-accuracy-filter">
          <button v-for="opt in ACCURACY_OPTIONS"
            :key="opt.key"
            type="button"
            :data-testid="`rule-check-accuracy-filter-${opt.key}`"
            class="rounded border px-1.5 py-0.5 text-[10px] transition-colors"
            :class="
              resultAccuracyFilter === opt.key
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-muted'
            "
            @click="resultAccuracyFilter = opt.key">
            {{ opt.label }} <span class="font-mono">{{ resultAccuracyCounts[opt.key] }}</span>
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="relative flex-1">
            <Search class="pointer-events-none absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
            <input v-model="resultKeyword"
              type="text"
              data-testid="rule-check-result-search"
              placeholder="筛选结果：规则 / 房号 / refno / 详情…"
              class="w-full rounded border border-border bg-background py-0.5 pl-6 pr-2 text-[11px] focus:border-primary focus:outline-none" />
          </div>
          <span v-if="isResultFiltered"
            data-testid="rule-check-result-filtered-count"
            class="shrink-0 font-mono text-[10px] text-primary">
            {{ visibleViolations.length }}/{{ allViolations.length }}
          </span>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto divide-y divide-border">
        <div v-if="state.running" class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          正在执行规范校验…
        </div>
        <div v-else-if="state.results.length === 0" class="py-8 text-center text-muted-foreground">
          点击右上角「执行校验」运行规则评测
        </div>
        <template v-else>
          <div v-if="allViolations.length === 0 && onlyViolationsFilter" class="py-8 text-center text-emerald-600">
            全部 {{ summaryStats.rulesRun }} 条已执行规则 0 违规通过
          </div>
          <div v-else-if="visibleViolations.length === 0" class="py-8 text-center text-muted-foreground">
            当前筛选条件下无匹配违规项
          </div>

          <!-- 分组视图 -->
          <template v-else-if="groupByRule">
            <div v-for="group in groupedViolations"
              :key="group.key"
              data-testid="rule-check-violation-group"
              class="divide-y divide-border/60">
              <div class="flex items-center justify-between gap-2 bg-muted/40 px-3 py-1.5">
                <button type="button"
                  data-testid="rule-check-group-header"
                  class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  @click="toggleGroupCollapsed(group.key)">
                  <component :is="collapsedGroups.includes(group.key) ? ChevronRight : ChevronDown"
                    class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span class="font-mono font-semibold text-foreground">{{ group.ruleId }}</span>
                  <span class="rounded bg-muted px-1 text-[10px] text-muted-foreground">{{ group.discipline }}</span>
                  <span class="truncate text-[11px] text-muted-foreground">{{ group.title }}</span>
                  <span v-if="groupPreciseLabel(group.key)"
                    data-testid="rule-check-group-precise"
                    class="shrink-0 font-mono text-[10px] text-emerald-700">
                    {{ groupPreciseLabel(group.key) }}
                  </span>
                  <span class="shrink-0 rounded bg-destructive/15 px-1.5 font-mono text-[10px] text-destructive">
                    {{ group.violations.length }}
                  </span>
                </button>
                <button type="button"
                  data-testid="rule-check-focus-group-btn"
                  class="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] hover:border-primary hover:text-primary disabled:opacity-40"
                  :disabled="group.allHighlightRefnos.length === 0"
                  @click="focusRefnos(group.allHighlightRefnos)">
                  <Crosshair class="h-3 w-3" />
                  定位本组
                </button>
              </div>
              <template v-if="!collapsedGroups.includes(group.key)">
                <div v-for="v in group.violations"
                  :key="v.key"
                  data-testid="rule-check-violation-row"
                  class="space-y-1 pl-6 pr-3 py-2 transition-colors hover:bg-muted/50"
                  :class="{ 'bg-primary/5': state.activeViolationKey === v.key }">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-1 min-w-0">
                      <span class="rounded border px-1.5 py-0.2 text-[10px] font-medium"
                        :class="severityBadge(v).cls">
                        {{ severityBadge(v).label }}
                      </span>
                      <span v-if="accuracyBadge(v)"
                        data-testid="rule-check-accuracy-badge"
                        class="rounded border px-1.5 py-0.2 text-[10px] font-medium"
                        :class="accuracyBadge(v)?.cls"
                        :title="accuracyBadge(v)?.title">
                        {{ accuracyBadge(v)?.label }}
                      </span>
                      <span v-if="v.copyNamed"
                        data-testid="rule-check-copy-badge"
                        class="rounded border border-border bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground"
                        :title="COPY_BADGE_TITLE">
                        Copy-of 副本
                      </span>
                      <span v-if="v.roomNum" class="font-mono text-[10px] text-muted-foreground">房 {{ v.roomNum }}</span>
                      <span v-if="v.branchRefno" class="font-mono text-[10px] text-muted-foreground">BRAN {{ v.branchRefno }}</span>
                      <span v-if="v.hasColumn" class="rounded bg-amber-500/15 px-1 text-[10px] text-amber-700">有柱</span>
                    </div>
                    <button type="button"
                      data-testid="rule-check-focus-btn"
                      class="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:border-primary hover:text-primary disabled:opacity-40"
                      :disabled="v.highlightRefnos.length === 0"
                      @click="focusViolation(v)">
                      <Crosshair class="h-3 w-3" />
                      定位高亮
                    </button>
                  </div>
                  <div class="text-[11px] leading-snug text-foreground">{{ v.detail }}</div>
                  <div class="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    <span v-if="v.measuredMm !== undefined">实测 {{ v.measuredMm.toFixed(1) }}{{ v.unit ? ` ${v.unit}` : '' }}</span>
                    <span v-if="v.thresholdMm !== undefined">阈值 {{ v.thresholdMm.toFixed(1) }}{{ v.unit ? ` ${v.unit}` : '' }}</span>
                    <span v-if="exactSurfaceNote(v)">{{ exactSurfaceNote(v) }}</span>
                    <span v-if="v.highlightRefnos.length > 0">高亮 {{ v.highlightRefnos.join(', ') }}</span>
                  </div>
                </div>
              </template>
            </div>
          </template>

          <!-- 平铺视图 -->
          <template v-else>
            <div v-for="v in visibleViolations"
              :key="v.key"
              data-testid="rule-check-violation-row"
              class="space-y-1 px-3 py-2 transition-colors hover:bg-muted/50"
              :class="{ 'bg-primary/5': state.activeViolationKey === v.key }">
              <div class="flex items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-1 min-w-0">
                  <span class="rounded border px-1.5 py-0.2 text-[10px] font-medium"
                    :class="severityBadge(v).cls">
                    {{ severityBadge(v).label }}
                  </span>
                  <span v-if="accuracyBadge(v)"
                    data-testid="rule-check-accuracy-badge"
                    class="rounded border px-1.5 py-0.2 text-[10px] font-medium"
                    :class="accuracyBadge(v)?.cls"
                    :title="accuracyBadge(v)?.title">
                    {{ accuracyBadge(v)?.label }}
                  </span>
                  <span v-if="v.copyNamed"
                    data-testid="rule-check-copy-badge"
                    class="rounded border border-border bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground"
                    :title="COPY_BADGE_TITLE">
                    Copy-of 副本
                  </span>
                  <span class="font-mono font-medium">{{ v.ruleId }}</span>
                  <span class="rounded bg-muted px-1 text-[10px] text-muted-foreground">{{ v.discipline }}</span>
                  <span v-if="v.roomNum" class="font-mono text-[10px] text-muted-foreground">房 {{ v.roomNum }}</span>
                  <span v-if="v.branchRefno" class="font-mono text-[10px] text-muted-foreground">BRAN {{ v.branchRefno }}</span>
                  <span v-if="v.hasColumn" class="rounded bg-amber-500/15 px-1 text-[10px] text-amber-700">有柱</span>
                </div>
                <button type="button"
                  data-testid="rule-check-focus-btn"
                  class="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:border-primary hover:text-primary disabled:opacity-40"
                  :disabled="v.highlightRefnos.length === 0"
                  @click="focusViolation(v)">
                  <Crosshair class="h-3 w-3" />
                  定位高亮
                </button>
              </div>
              <div class="text-[11px] leading-snug text-foreground">{{ v.detail }}</div>
              <div class="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
                <span v-if="v.measuredMm !== undefined">实测 {{ v.measuredMm.toFixed(1) }}{{ v.unit ? ` ${v.unit}` : '' }}</span>
                <span v-if="v.thresholdMm !== undefined">阈值 {{ v.thresholdMm.toFixed(1) }}{{ v.unit ? ` ${v.unit}` : '' }}</span>
                <span v-if="exactSurfaceNote(v)">{{ exactSurfaceNote(v) }}</span>
                <span v-if="v.highlightRefnos.length > 0">高亮 {{ v.highlightRefnos.join(', ') }}</span>
              </div>
            </div>
          </template>

          <!-- 非过滤模式下展示 0 违规通过规则汇总 -->
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
