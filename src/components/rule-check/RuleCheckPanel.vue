<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
  ArrowRight,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronUp,
  CircleCheck,
  CirclePlay,
  CircleStop,
  CircleX,
  Copy,
  Crosshair,
  Download,
  FileJson,
  GitBranch,
  Layers,
  List,
  ListFilter,
  LoaderCircle,
  Play,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareMinus,
  TriangleAlert,
  X,
} from 'lucide-vue-next';

import RuleCheckViolationRow from './RuleCheckViolationRow.vue';

import type {
  RuleCheckEngine,
  UnifiedPreciseStats,
  UnifiedRuleCatalogRow,
  UnifiedRuleViolation,
} from '@/api/ruleCheckApi';

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
  describeRuleCheckError,
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

/** 火灾分区的检出同时计在它的严重度里，所以不与这三项并列，另作「其中」展示。 */
const SEVERITY_CHIPS: { key: SeverityCellKey; label: string; dot: string }[] = [
  { key: 'violation', label: '违规', dot: 'bg-red-600' },
  { key: 'reminder', label: '提醒', dot: 'bg-sky-600' },
  { key: 'semi_auto', label: '半自动', dot: 'bg-violet-600' },
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

type OverlaySegmentKey = 'off' | Exclude<RuleCheckOverlayMode, 'isolate'>;

const OVERLAY_SEGMENTS: { key: OverlaySegmentKey; label: string; title: string; testid: string }[] = [
  { key: 'off', label: '关', title: '还原构件颜色', testid: 'rule-check-clear-overlay-btn' },
  { key: 'firezone', label: '火灾', title: '按火灾分区红（扩散性）/ 黄（局部性）着色', testid: 'rule-check-firezone-overlay-btn' },
  { key: 'all', label: '严重度', title: '按严重度给全部涉事构件着色', testid: 'rule-check-all-overlay-btn' },
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
const listRef = ref<HTMLElement | null>(null);
const warningsOpen = ref(false);
const catalogOnlyHit = ref(false);
const collapsedSections = ref<string[]>([]);
const catalogErrorCopied = ref(false);
const clearArmed = ref(false);

/** 长列表一次渲染的条数；平铺和每组各自「再显示」一批。 */
const PAGE_SIZE = 50;
const flatLimit = ref(PAGE_SIZE);
const groupLimits = ref<Record<string, number>>({});

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

const renderedFlat = computed(() => visibleViolations.value.slice(0, flatLimit.value));

/** 键盘浏览的顺序与列表显示顺序一致，分组视图跳过折叠的组。 */
const navOrder = computed<{ violation: UnifiedRuleViolation; groupKey: string | null; index: number }[]>(() => {
  if (!groupByRule.value) {
    return visibleViolations.value.map((violation, index) => ({ violation, groupKey: null, index }));
  }
  return groupedViolations.value.flatMap((group) =>
    collapsedGroups.value.includes(group.key)
      ? []
      : group.violations.map((violation, index) => ({ violation, groupKey: group.key, index })),
  );
});

const activeNavIndex = computed(() =>
  navOrder.value.findIndex((item) => item.violation.key === state.activeViolationKey),
);

const truncatedResults = computed(() =>
  state.results.filter((r) => r.truncated || r.violationTotal > r.violations.length),
);

const truncatedByRule = computed(() => new Map(truncatedResults.value.map((r) => [`${r.engine}:${r.id}`, r])));

const truncatedNotice = computed(() => {
  const list = truncatedResults.value;
  if (list.length === 0) return null;
  if (list.length === 1) {
    const r = list[0]!;
    return `${r.id} 共 ${r.violationTotal} 项，后端只返回前 ${r.violations.length} 项；收窄专业或选集后重跑可看全部。`;
  }
  const missing = list.reduce((acc, r) => acc + Math.max(0, r.violationTotal - r.violations.length), 0);
  return `${list.length} 条规则结果过多，共有 ${missing} 项没有列出；收窄专业或选集后重跑可看全部。`;
});

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

const failedRuns = computed(() => (state.running ? [] : state.engineRuns.filter((r) => r.status === 'failed')));

const cancelledRuns = computed(() => (state.running ? [] : state.engineRuns.filter((r) => r.status === 'cancelled')));

const engineTimingsTitle = computed(() =>
  state.engineRuns.map((r) => `${r.label}：${r.status === 'done' ? engineRunTime(r) : engineRunText(r)}`).join('\n'),
);

/** 单个引擎的失败在结果区逐条说明，顶部只报其他错误。 */
const runErrorBanner = computed(() => {
  if (!state.runError) return null;
  if (failedRuns.value.some((r) => r.error === state.runError)) return null;
  return describeRuleCheckError(state.runError);
});

/** 四套目录一条规则都没拿到时的报错；目录加载本身不抛错，失败都记在告警里。 */
const catalogUnavailable = computed(() => {
  if (state.catalogLoading || state.catalog.length > 0) return null;
  if (state.catalogError) return state.catalogError;
  if (state.catalogLoaded && state.catalogWarnings.length > 0) return state.catalogWarnings[0]!;
  return null;
});

const ruleOutcomes = computed(() => {
  const map = new Map<string, number>();
  for (const r of state.results) map.set(`${r.engine}:${r.id}`, r.violationTotal);
  return map;
});

const failedEngines = computed(() => new Set(failedRuns.value.map((r) => r.engine)));

const hasRunOutcome = computed(() => hasEngineRuns.value || state.results.length > 0);

const catalogRows = computed(() =>
  catalogOnlyHit.value
    ? filteredCatalog.value.filter((row) => ['hit', 'failed'].includes(ruleOutcome(row).kind))
    : filteredCatalog.value,
);

const catalogSections = computed(() => {
  const order: string[] = [...RULE_CHECK_DISCIPLINES];
  const byDiscipline = new Map<string, UnifiedRuleCatalogRow[]>();
  for (const row of catalogRows.value) {
    const rows = byDiscipline.get(row.discipline) ?? [];
    rows.push(row);
    byDiscipline.set(row.discipline, rows);
  }
  const rank = (d: string) => (order.includes(d) ? order.indexOf(d) : order.length);
  return Array.from(byDiscipline.entries())
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([discipline, rows]) => ({
      discipline,
      rows,
      selected: rows.filter((r) => state.selectedRuleIds.includes(r.id)).length,
      hits: rows.filter((r) => ruleOutcome(r).kind === 'hit').length,
    }));
});

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
let clearArmTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (clearArmTimer) clearTimeout(clearArmTimer);
});

watch(visibleViolations, () => {
  flatLimit.value = PAGE_SIZE;
  groupLimits.value = {};
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

type RuleOutcomeKind = 'hit' | 'pass' | 'failed' | 'none';

function ruleOutcome(row: UnifiedRuleCatalogRow): { kind: RuleOutcomeKind; count: number } {
  const total = ruleOutcomes.value.get(`${row.engine}:${row.id}`);
  if (total !== undefined) return total > 0 ? { kind: 'hit', count: total } : { kind: 'pass', count: 0 };
  if (failedEngines.value.has(row.engine)) return { kind: 'failed', count: 0 };
  return { kind: 'none', count: 0 };
}

function outcomeLabel(outcome: { kind: RuleOutcomeKind; count: number }): string {
  if (outcome.kind === 'hit') return `${outcome.count} 项`;
  if (outcome.kind === 'pass') return '通过';
  if (outcome.kind === 'failed') return '失败';
  return '未运行';
}

function outcomeClass(kind: RuleOutcomeKind): string {
  if (kind === 'hit') return 'border-red-200 bg-red-50 text-red-700';
  if (kind === 'pass') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (kind === 'failed') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-border text-muted-foreground';
}

type CatalogSection = { discipline: string; rows: UnifiedRuleCatalogRow[]; selected: number };

function sectionSelectState(section: CatalogSection): 'all' | 'some' | 'none' {
  if (section.selected === 0) return 'none';
  return section.selected === section.rows.length ? 'all' : 'some';
}

function toggleSectionSelection(section: CatalogSection) {
  const ids = section.rows.map((r) => r.id);
  if (sectionSelectState(section) === 'all') {
    state.selectedRuleIds = state.selectedRuleIds.filter((id) => !ids.includes(id));
  } else {
    state.selectedRuleIds = Array.from(new Set([...state.selectedRuleIds, ...ids]));
  }
}

function toggleSection(discipline: string) {
  const idx = collapsedSections.value.indexOf(discipline);
  if (idx >= 0) collapsedSections.value.splice(idx, 1);
  else collapsedSections.value.push(discipline);
}

async function copyCatalogError() {
  try {
    await navigator.clipboard.writeText(
      [state.catalogError, ...state.catalogWarnings].filter(Boolean).join('\n'),
    );
  } catch {
    return;
  }
  catalogErrorCopied.value = true;
  setTimeout(() => {
    catalogErrorCopied.value = false;
  }, 1200);
}

function groupLimit(groupKey: string): number {
  return groupLimits.value[groupKey] ?? PAGE_SIZE;
}

function showMoreInGroup(groupKey: string) {
  groupLimits.value = { ...groupLimits.value, [groupKey]: groupLimit(groupKey) + PAGE_SIZE };
}

function scrollActiveIntoView() {
  const key = state.activeViolationKey;
  if (!key || !listRef.value) return;
  const row = Array.from(listRef.value.querySelectorAll<HTMLElement>('[data-violation-key]'))
    .find((el) => el.dataset.violationKey === key);
  row?.scrollIntoView?.({ block: 'nearest' });
}

function moveActive(delta: number) {
  const order = navOrder.value;
  if (order.length === 0) return;
  const current = activeNavIndex.value;
  const next = current < 0
    ? (delta > 0 ? 0 : order.length - 1)
    : Math.min(order.length - 1, Math.max(0, current + delta));
  const item = order[next]!;
  if (item.groupKey === null) {
    if (item.index >= flatLimit.value) flatLimit.value = item.index + 1;
  } else if (item.index >= groupLimit(item.groupKey)) {
    groupLimits.value = { ...groupLimits.value, [item.groupKey]: item.index + 1 };
  }
  state.activeViolationKey = item.violation.key;
  if (expandedKey.value !== null) expandedKey.value = item.violation.key;
  void nextTick(scrollActiveIntoView);
}

function handleListKeydown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName ?? '';
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveActive(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter') {
    const idx = activeNavIndex.value;
    if (idx < 0 || tag === 'BUTTON') return;
    event.preventDefault();
    void focusViolation(navOrder.value[idx]!.violation);
  } else if (event.key === 'Escape' && expandedKey.value !== null) {
    event.preventDefault();
    expandedKey.value = null;
  }
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

/** 清空要点两次：第一下只布防 3 秒，免得一次几分钟的全项目结果被误点清掉。 */
function handleClearClick() {
  if (clearArmTimer) clearTimeout(clearArmTimer);
  if (!clearArmed.value) {
    clearArmed.value = true;
    clearArmTimer = setTimeout(() => {
      clearArmed.value = false;
    }, 3000);
    return;
  }
  clearArmed.value = false;
  handleClearResults();
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
  listRef.value?.focus({ preventScroll: true });
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
      <span class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground/70"
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
        <span class="text-[11px] text-muted-foreground">运行后自动收起</span>
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
          <span class="font-mono text-[11px] opacity-80">{{ engineCounts[eng] }}</span>
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
          <span class="block text-[11px] leading-snug text-muted-foreground">
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
        data-testid="rule-check-catalog-tab"
        class="inline-flex items-center gap-1 border-b-2 py-1.5 text-[12px] font-medium transition-colors"
        :class="
          activeTab === 'catalog'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="activeTab = 'catalog'">
        规则目录
        <span class="rounded bg-muted px-1 font-mono text-[11px] tabular-nums text-foreground/70">{{ filteredCatalog.length }}</span>
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
        <span class="rounded px-1 font-mono text-[11px]"
          :class="summaryStats.totalReported > 0 ? 'bg-red-50 text-red-700' : 'bg-muted text-foreground/70'">
          {{ summaryStats.totalReported }}
        </span>
      </button>
    </div>

    <!-- 运行出错（单个引擎失败另在结果区逐条说明） -->
    <div v-if="runErrorBanner"
      data-testid="rule-check-run-error"
      class="flex items-start gap-1.5 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive"
      :title="state.runError ?? ''">
      <CircleX class="mt-px h-3.5 w-3.5 shrink-0" />
      <span class="min-w-0">{{ runErrorBanner }}</span>
    </div>

    <!-- Tab 1: 规则目录（按专业分组，运行后每条显示本次结果） -->
    <div v-if="activeTab === 'catalog'" class="flex flex-1 flex-col overflow-hidden">
      <div class="space-y-1.5 border-b border-border px-3 py-1.5">
        <div class="flex items-center gap-1.5">
          <div class="relative min-w-0 flex-1">
            <Search class="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <input v-model="state.searchKeyword"
              type="text"
              placeholder="搜索规则 id / 标题 / 规范要求 / #工单号…"
              class="w-full rounded border border-border bg-background py-1 pl-7 pr-2 text-[11px] focus:border-primary focus:outline-none" />
          </div>
          <button v-if="hasRunOutcome"
            type="button"
            data-testid="rule-check-catalog-only-hit"
            class="shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition-colors"
            :class="
              catalogOnlyHit
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted'
            "
            :aria-pressed="catalogOnlyHit"
            @click="catalogOnlyHit = !catalogOnlyHit">
            只看有检出
          </button>
        </div>
        <div class="flex items-center gap-1.5 text-[11px]">
          <span data-testid="rule-check-selection-hint"
            :class="state.selectedRuleIds.length > 0 ? 'text-primary' : 'text-muted-foreground'">
            {{ state.selectedRuleIds.length > 0 ? `已选 ${state.selectedRuleIds.length} 条，只运行已选` : '未勾选：运行当前筛选的全部规则' }}
          </span>
          <span class="flex-1" />
          <button type="button" class="text-primary hover:underline" @click="selectAllFiltered()">全选</button>
          <span class="text-muted-foreground">/</span>
          <button type="button" class="text-muted-foreground hover:underline" @click="clearRuleSelection()">清空</button>
        </div>
      </div>

      <div v-if="state.catalogWarnings.length > 0 && !catalogUnavailable"
        data-testid="rule-check-catalog-warnings"
        class="space-y-0.5 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-800 dark:text-amber-300">
        <div v-for="(w, i) in state.catalogWarnings" :key="i" class="flex items-start gap-1">
          <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0" />
          <span class="min-w-0">{{ w }}</span>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div v-if="state.catalogLoading" data-testid="rule-check-catalog-loading" class="space-y-3 px-3 py-3" aria-busy="true">
          <div v-for="n in 4" :key="n" class="flex animate-pulse items-start gap-2">
            <span class="h-3.5 w-3.5 shrink-0 rounded bg-muted" />
            <span class="flex-1 space-y-1.5">
              <span class="block h-2 w-20 rounded bg-muted" />
              <span class="block h-2 w-48 rounded bg-muted/70" />
            </span>
          </div>
          <div class="text-center text-[11px] text-muted-foreground">正在加载规则目录…</div>
        </div>
        <div v-else-if="catalogUnavailable"
          data-testid="rule-check-catalog-error"
          class="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
          <span class="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <PlugZap class="h-5 w-5 text-destructive" />
          </span>
          <div class="text-[13px] font-semibold text-foreground">规则目录加载失败</div>
          <div class="text-[11px] text-muted-foreground">{{ describeRuleCheckError(catalogUnavailable) }}。确认 gen-model 已启动后再试。</div>
          <div class="flex items-center gap-1.5 pt-1">
            <button type="button"
              data-testid="rule-check-catalog-retry"
              class="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
              @click="loadCatalogs()">
              <RotateCcw class="h-3 w-3" />
              重试
            </button>
            <button type="button"
              class="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
              @click="copyCatalogError()">
              <Copy class="h-3 w-3" />
              {{ catalogErrorCopied ? '已复制' : '复制错误信息' }}
            </button>
          </div>
        </div>
        <div v-else-if="catalogSections.length === 0" class="py-8 text-center text-muted-foreground">
          {{ catalogOnlyHit ? '本次没有检出的规则' : '无匹配规则条目' }}
        </div>
        <section v-for="section in catalogSections"
          :key="section.discipline"
          data-testid="rule-check-catalog-section">
          <div class="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-border bg-muted px-3 py-1">
            <button type="button"
              data-testid="rule-check-catalog-section-select"
              class="shrink-0"
              :title="sectionSelectState(section) === 'all' ? `取消勾选${section.discipline}全部规则` : `勾选${section.discipline}全部规则`"
              @click="toggleSectionSelection(section)">
              <component :is="sectionSelectState(section) === 'all' ? CheckSquare : sectionSelectState(section) === 'some' ? SquareMinus : Square"
                class="h-3.5 w-3.5"
                :class="sectionSelectState(section) === 'none' ? 'text-muted-foreground' : 'text-primary'" />
            </button>
            <button type="button"
              data-testid="rule-check-catalog-section-toggle"
              class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              :aria-expanded="!collapsedSections.includes(section.discipline)"
              @click="toggleSection(section.discipline)">
              <span class="text-[11px] font-semibold text-foreground">{{ section.discipline }}</span>
              <span class="truncate text-[11px] text-muted-foreground">
                {{ section.rows.length }} 条<template v-if="section.selected > 0"> · 已选 {{ section.selected }}</template><template v-if="hasRunOutcome && section.hits > 0"> · {{ section.hits }} 条有检出</template>
              </span>
              <span class="flex-1" />
              <component :is="collapsedSections.includes(section.discipline) ? ChevronRight : ChevronDown"
                class="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          </div>
          <template v-if="!collapsedSections.includes(section.discipline)">
            <div v-for="row in section.rows"
              :key="`${row.engine}:${row.id}`"
              data-testid="rule-check-catalog-row"
              class="flex cursor-pointer items-start gap-2 border-b border-border/60 px-3 py-2"
              :class="state.selectedRuleIds.includes(row.id) ? 'bg-primary/5' : 'hover:bg-muted/50'"
              @click="toggleRuleSelection(row.id)">
              <component :is="state.selectedRuleIds.includes(row.id) ? CheckSquare : Square"
                class="mt-0.5 h-3.5 w-3.5 shrink-0"
                :class="state.selectedRuleIds.includes(row.id) ? 'text-primary' : 'text-muted-foreground'" />
              <div class="min-w-0 flex-1 space-y-0.5">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono font-medium text-foreground">{{ row.id }}</span>
                  <span class="rounded border border-border px-1 text-[11px] text-muted-foreground">
                    {{ RULE_CHECK_ENGINE_LABELS[row.engine] }}
                  </span>
                  <span class="font-mono text-[11px] text-muted-foreground">#{{ row.issue }}</span>
                  <span class="flex-1" />
                  <span v-if="hasRunOutcome"
                    data-testid="rule-check-catalog-result"
                    :data-outcome="ruleOutcome(row).kind"
                    class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px text-[11px] tabular-nums"
                    :class="outcomeClass(ruleOutcome(row).kind)">
                    <span v-if="ruleOutcome(row).kind === 'hit'" class="h-1.5 w-1.5 rounded-full bg-red-600" aria-hidden="true" />
                    <Check v-else-if="ruleOutcome(row).kind === 'pass'" class="h-3 w-3" aria-hidden="true" />
                    {{ outcomeLabel(ruleOutcome(row)) }}
                  </span>
                </div>
                <div class="text-[11px] text-foreground">{{ row.title }}</div>
                <div class="font-mono text-[11px] text-muted-foreground">规范：{{ row.requirement }}</div>
              </div>
            </div>
          </template>
        </section>
      </div>
    </div>
    <!-- Tab 2: 校验结果与三维高亮定位 -->
    <div v-else class="flex flex-1 flex-col overflow-hidden">
      <!-- 运行中：分引擎进度（固定在顶部） -->
      <div v-if="state.running && hasEngineRuns" data-testid="rule-check-progress" class="space-y-1.5 border-b border-border px-3 py-2">
        <div class="flex items-center gap-1.5">
          <LoaderCircle class="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
          <span class="text-[13px] font-semibold">正在校验</span>
          <span class="font-mono text-[11px] tabular-nums text-muted-foreground">{{ engineRunsDone }} / {{ state.engineRuns.length }} 完成</span>
          <span class="flex-1" />
          <span class="text-[11px] text-muted-foreground">先完成的先出结果</span>
        </div>
        <div class="flex gap-0.5" aria-hidden="true">
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
          <component :is="engineRunIcon(run)" class="h-3.5 w-3.5 shrink-0" :class="engineRunIconClass(run)" aria-hidden="true" />
          <span class="w-[78px] shrink-0 truncate text-[12px] font-medium">{{ run.label }}</span>
          <span class="min-w-0 flex-1 truncate text-[11px]"
            :class="run.status === 'failed' ? 'text-red-700' : 'text-muted-foreground'"
            :title="engineRunText(run)">{{ engineRunText(run) }}</span>
          <button v-if="run.status === 'failed'"
            type="button"
            :data-testid="`rule-check-engine-retry-${run.engine}`"
            class="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border px-2 text-[11px] hover:bg-muted"
            @click="retryEngine(run.engine)">
            <RotateCcw class="h-3 w-3" aria-hidden="true" />
            重试
          </button>
          <span v-else class="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{{ engineRunTime(run) }}</span>
        </div>
      </div>

      <!-- 概览与列表一起滚动，只有工具条吸顶 -->
      <div ref="listRef"
        data-testid="rule-check-result-list"
        tabindex="0"
        class="relative flex-1 overflow-y-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40"
        @keydown="handleListKeydown">
        <!-- 引擎失败：写清原因，在这里重试 -->
        <div v-for="run in failedRuns"
          :key="`fail-${run.engine}`"
          data-testid="rule-check-engine-failure"
          class="border-b border-red-200 bg-red-50 px-3 py-2">
          <div class="flex items-center gap-1.5">
            <CircleX class="h-3.5 w-3.5 shrink-0 text-red-700" aria-hidden="true" />
            <span class="text-[12px] font-semibold text-red-700">{{ run.label }} 没有跑完</span>
            <span class="flex-1" />
            <button type="button"
              :data-testid="`rule-check-engine-failure-retry-${run.engine}`"
              class="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-red-300 bg-background px-2 text-[11px] font-medium text-red-700 hover:bg-red-100"
              @click="retryEngine(run.engine)">
              <RotateCcw class="h-3 w-3" aria-hidden="true" />
              重试
            </button>
          </div>
          <p class="mt-0.5 text-[12px] leading-snug text-red-900">
            {{ describeRuleCheckError(run.error ?? '') }}{{ state.engineRuns.length > failedRuns.length ? `；其余 ${state.engineRuns.length - failedRuns.length} 个引擎的结果照常显示` : '' }}。
          </p>
          <details class="mt-0.5 text-[11px] text-red-900/80">
            <summary class="cursor-pointer select-none">技术细节</summary>
            <div class="break-all font-mono">{{ run.error }}</div>
          </details>
        </div>

        <!-- 提示默认折叠 -->
        <div v-if="state.runWarnings.length > 0" class="border-b border-amber-200 bg-amber-50 text-amber-900">
          <button type="button"
            data-testid="rule-check-warnings-toggle"
            class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px]"
            :aria-expanded="warningsOpen"
            @click="warningsOpen = !warningsOpen">
            <TriangleAlert class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span class="shrink-0 font-semibold">{{ state.runWarnings.length }} 条提示</span>
            <span v-if="!warningsOpen" class="min-w-0 flex-1 truncate text-[11px] text-amber-900/80">{{ state.runWarnings[0] }}</span>
            <span v-else class="flex-1" />
            <component :is="warningsOpen ? ChevronUp : ChevronDown" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </button>
          <ul v-if="warningsOpen" data-testid="rule-check-warnings-list" class="space-y-0.5 px-3 pb-2 text-[12px]">
            <li v-for="(w, i) in state.runWarnings" :key="i" class="flex gap-1">
              <span aria-hidden="true">·</span>
              <span class="min-w-0">{{ w }}</span>
            </li>
          </ul>
        </div>

        <!-- 本次结果概览 -->
        <div v-if="state.batches.length > 0 || (!state.running && hasEngineRuns)"
          data-testid="rule-check-overview"
          class="space-y-2 px-3 pb-2 pt-2.5">
          <div class="flex items-center gap-1.5">
            <span class="shrink-0 text-[13px] font-semibold">本次结果</span>
            <span v-if="state.running" class="truncate text-[11px] text-muted-foreground">陆续并入中…</span>
            <span v-else
              data-testid="rule-check-run-meta"
              class="truncate text-[11px] tabular-nums text-muted-foreground"
              :title="engineTimingsTitle">
              {{ lastRunTime }} · 用时 {{ formatRuleCheckDuration(state.runElapsedMs) }}
            </span>
            <span class="flex-1" />
            <template v-if="state.results.length > 0">
              <button type="button"
                data-testid="rule-check-export-csv-btn"
                class="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] hover:bg-muted"
                title="导出中文 Excel 兼容 UTF-8 BOM CSV 报告"
                @click="handleExportCsv()">
                <Download class="h-3 w-3" aria-hidden="true" />
                CSV
              </button>
              <button type="button"
                data-testid="rule-check-export-json-btn"
                class="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] hover:bg-muted"
                title="导出完整结构化 JSON 校验报告"
                @click="handleExportJson()">
                <FileJson class="h-3 w-3" aria-hidden="true" />
                JSON
              </button>
            </template>
          </div>

          <div v-if="state.results.length > 0" class="flex flex-wrap items-center gap-1" role="group" aria-label="按严重度筛选">
            <button v-for="chip in SEVERITY_CHIPS"
              :key="chip.key"
              type="button"
              :data-testid="`rule-check-result-filter-${chip.key}`"
              class="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] transition-colors"
              :class="
                resultSeverityFilter === chip.key
                  ? 'border-foreground/50 bg-muted font-medium text-foreground'
                  : 'border-border bg-background text-foreground/80 hover:bg-muted/60'
              "
              :aria-pressed="resultSeverityFilter === chip.key"
              @click="toggleSeverityCell(chip.key)">
              <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="chip.dot" aria-hidden="true" />
              {{ chip.label }}
              <span class="font-mono tabular-nums"
                :class="resultSeverityCounts[chip.key] > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'">
                {{ resultSeverityCounts[chip.key] }}
              </span>
            </button>
            <template v-if="resultSeverityCounts.firezone > 0 || resultSeverityFilter === 'firezone'">
              <span class="px-0.5 text-muted-foreground" aria-hidden="true">·</span>
              <button type="button"
                data-testid="rule-check-result-filter-firezone"
                class="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] transition-colors"
                :class="
                  resultSeverityFilter === 'firezone'
                    ? 'border-foreground/50 bg-muted font-medium text-foreground'
                    : 'border-border bg-background text-foreground/80 hover:bg-muted/60'
                "
                :aria-pressed="resultSeverityFilter === 'firezone'"
                title="火灾分区标注也计在左侧的严重度里"
                @click="toggleSeverityCell('firezone')">
                其中火灾分区
                <span class="font-mono font-semibold tabular-nums">{{ resultSeverityCounts.firezone }}</span>
              </button>
            </template>
          </div>

          <div v-if="preciseSummary"
            data-testid="rule-check-precise-summary"
            class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px]"
            :title="`可精算规则 ${preciseSummary.refinableRules} 条`">
            <Sparkles class="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            <span class="font-semibold text-emerald-800">精确复核</span>
            <span class="font-mono tabular-nums text-foreground/80">估算 {{ preciseSummary.aabbFindings }}</span>
            <ArrowRight class="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            <span class="font-mono tabular-nums text-emerald-800">精算剔除 {{ preciseSummary.cleared }}</span>
            <ArrowRight class="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            <span class="font-mono font-semibold tabular-nums">保留 {{ Math.max(0, preciseSummary.aabbFindings - preciseSummary.cleared) }}</span>
            <span class="text-[11px]" :class="preciseSummary.unavailable > 0 ? 'text-amber-800' : 'text-muted-foreground'">
              · 缺网格 {{ preciseSummary.unavailable }} 对{{ preciseSummary.unavailable > 0 ? '，保留估算' : '' }}
            </span>
          </div>

          <div v-if="branAllSummary" data-testid="rule-check-bran-all-summary" class="flex items-center gap-1.5 text-[12px]">
            <GitBranch class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span class="font-medium text-foreground/80">全项目 BRAN</span>
            <span class="font-mono tabular-nums">已检 {{ branAllSummary.bransChecked }} / {{ branAllSummary.bransTotal }} 根</span>
            <span class="flex-1" />
            <span class="text-[11px]" :class="branAllSummary.bransFailed > 0 ? 'text-amber-800' : 'text-muted-foreground'">
              读取失败 {{ branAllSummary.bransFailed }} 根
            </span>
          </div>

          <div v-if="cancelledRuns.length > 0" class="text-[11px] text-amber-800">
            已取消 {{ cancelledRuns.map((r) => r.label).join('、') }}，结果不完整。
          </div>

          <div v-if="truncatedNotice"
            data-testid="rule-check-truncated-notice"
            class="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
            <TriangleAlert class="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
            <span class="min-w-0">{{ truncatedNotice }}</span>
          </div>

          <div v-if="!state.running" class="flex justify-end">
            <button type="button"
              data-testid="rule-check-clear-results-btn"
              class="text-[11px] hover:underline"
              :class="clearArmed ? 'font-medium text-red-700' : 'text-muted-foreground hover:text-foreground'"
              @click="handleClearClick()">
              {{ clearArmed ? '再点一次清空本次结果' : '清空结果' }}
            </button>
          </div>
        </div>

        <!-- 结果工具条（吸顶）：搜索 + 筛选托盘 + 视图切换 + 三维着色 -->
        <div v-if="allViolations.length > 0"
          data-testid="rule-check-result-toolbar"
          class="sticky top-0 z-10 space-y-1.5 border-y border-border bg-background px-3 py-1.5">
          <div class="flex items-center gap-1.5">
            <div class="relative min-w-0 flex-1">
              <Search class="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <input v-model="resultKeyword"
                type="text"
                data-testid="rule-check-result-search"
                placeholder="筛选结果：规则 / 房号 / refno / 详情…"
                aria-label="筛选结果"
                class="h-7 w-full rounded border border-border bg-background pl-7 pr-2 text-[12px] focus:border-primary focus:outline-none" />
            </div>
            <button type="button"
              data-testid="rule-check-filter-toggle"
              class="inline-flex h-7 shrink-0 items-center gap-1 rounded border px-2 text-[12px] transition-colors"
              :class="
                filterTrayOpen
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border bg-background text-foreground/80 hover:bg-muted'
              "
              :aria-expanded="filterTrayOpen"
              @click="filterTrayOpen = !filterTrayOpen">
              <ListFilter class="h-3.5 w-3.5" aria-hidden="true" />
              筛选
              <span v-if="trayFilterCount > 0" class="rounded-full bg-primary px-1.5 font-mono text-[11px] leading-4 text-primary-foreground">{{ trayFilterCount }}</span>
            </button>
            <div class="flex h-7 shrink-0 items-center rounded border border-border bg-muted/40 p-px" role="group" aria-label="列表视图">
              <button type="button"
                data-testid="rule-check-flat-view-btn"
                title="平铺列表"
                aria-label="平铺列表"
                class="inline-flex h-full w-7 items-center justify-center rounded-sm"
                :class="!groupByRule ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
                :aria-pressed="!groupByRule"
                @click="groupByRule = false">
                <List class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button"
                data-testid="rule-check-group-toggle-btn"
                title="按规则分组"
                aria-label="按规则分组"
                class="inline-flex h-full w-7 items-center justify-center rounded-sm"
                :class="groupByRule ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
                :aria-pressed="groupByRule"
                @click="groupByRule = true">
                <Layers class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div v-if="filterTrayOpen" data-testid="rule-check-filter-tray" class="space-y-1.5 rounded-md border border-border bg-muted/30 p-2">
            <div v-if="preciseSummary" class="flex items-center gap-1.5" data-testid="rule-check-accuracy-filter">
              <span class="w-8 shrink-0 text-[11px] text-muted-foreground">口径</span>
              <div class="flex rounded border border-border bg-background p-px">
                <button v-for="opt in ACCURACY_OPTIONS"
                  :key="opt.key"
                  type="button"
                  :data-testid="`rule-check-accuracy-filter-${opt.key}`"
                  class="rounded-sm px-2 py-0.5 text-[11px] transition-colors"
                  :class="
                    resultAccuracyFilter === opt.key
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-foreground/70 hover:text-foreground'
                  "
                  :aria-pressed="resultAccuracyFilter === opt.key"
                  @click="resultAccuracyFilter = opt.key">
                  {{ opt.label }} <span class="font-mono tabular-nums">{{ resultAccuracyCounts[opt.key] }}</span>
                </button>
              </div>
            </div>
            <div class="flex items-start gap-1.5">
              <span class="w-8 shrink-0 pt-0.5 text-[11px] text-muted-foreground">专业</span>
              <div class="flex flex-wrap gap-1">
                <button v-for="(count, disc) in resultDisciplineCounts"
                  :key="disc"
                  type="button"
                  :data-testid="`rule-check-discipline-filter-${disc}`"
                  class="rounded border px-1.5 py-0.5 text-[11px] transition-colors"
                  :class="
                    resultDisciplines.includes(String(disc))
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'border-border bg-background text-foreground/70 hover:bg-muted'
                  "
                  :aria-pressed="resultDisciplines.includes(String(disc))"
                  @click="toggleResultDiscipline(String(disc))">
                  {{ disc }} <span class="font-mono tabular-nums">{{ count }}</span>
                </button>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="w-8 shrink-0 text-[11px] text-muted-foreground">其他</span>
              <label v-if="hasCopyNamed" class="inline-flex items-center gap-1 text-[12px] text-foreground/80">
                <input v-model="copyOnly" type="checkbox" data-testid="rule-check-copy-only" class="rounded" />
                只看 Copy-of 副本
              </label>
              <label class="inline-flex items-center gap-1 text-[12px] text-foreground/80">
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
                class="text-[11px] text-primary hover:underline"
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
              class="inline-flex items-center gap-0.5 rounded-full border border-primary/30 bg-primary/10 py-px pl-2 pr-1 text-[11px] text-primary hover:bg-primary/15"
              :title="`移除：${chip.label}`"
              @click="chip.clear()">
              {{ chip.label }}
              <X class="h-3 w-3" aria-hidden="true" />
            </button>
            <span class="flex-1" />
            <span data-testid="rule-check-result-filtered-count" class="shrink-0 font-mono text-[11px] tabular-nums text-primary">{{ visibleViolations.length }}/{{ allViolations.length }}</span>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] text-muted-foreground">三维着色</span>
            <div class="flex rounded border border-border bg-muted/40 p-px" role="group" aria-label="三维着色">
              <button v-for="seg in OVERLAY_SEGMENTS"
                :key="seg.key"
                type="button"
                :data-testid="seg.testid"
                class="rounded-sm px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50"
                :class="
                  overlaySegment === seg.key
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-foreground/70 hover:text-foreground'
                "
                :disabled="isOverlaySegmentDisabled(seg.key)"
                :aria-pressed="overlaySegment === seg.key"
                :title="seg.title"
                @click="setOverlayMode(seg.key)">
                {{ seg.label }}<span v-if="seg.key === 'firezone'" class="ml-0.5 font-mono tabular-nums">{{ summaryStats.firezones }}</span>
              </button>
            </div>
            <label class="inline-flex items-center gap-1 text-[11px] text-foreground/70">
              <input v-model="overlayState.xrayOthers" type="checkbox" class="rounded" />
              透视其余
            </label>
            <span v-if="overlayState.activeMode === 'isolate'" class="text-[11px] font-medium text-primary">隔离显示中</span>
          </div>

          <!-- 激活着色时的实时图例 -->
          <div v-if="overlayState.activeMode !== null"
            data-testid="rule-check-overlay-legend"
            class="flex flex-wrap items-center gap-2 rounded bg-muted/50 px-2 py-1 text-[11px]">
            <span v-for="cat in OVERLAY_LEGEND_CATEGORIES.filter((c) => overlayState.categoryCounts[c] > 0)"
              :key="cat"
              class="inline-flex items-center gap-1">
              <span class="inline-block h-2 w-2 rounded-full"
                :style="{ backgroundColor: RULE_CHECK_OVERLAY_PALETTE[cat].hex }" />
              {{ RULE_CHECK_OVERLAY_PALETTE[cat].label }}
              <span class="font-mono tabular-nums text-foreground/70">{{ overlayState.categoryCounts[cat] }}</span>
            </span>
            <span class="ml-auto font-mono tabular-nums text-foreground/70">
              已着色 {{ overlayState.paintedRefnoCount }} 构件 / {{ overlayState.paintedObjectCount }} 图元
            </span>
          </div>
          <div v-if="overlayState.lastNotice" class="text-[11px] text-amber-800 dark:text-amber-300">
            {{ overlayState.lastNotice }}
          </div>
        </div>

        <div v-if="state.running && state.batches.length === 0" class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />
          正在执行规范校验…
        </div>
        <div v-else-if="state.results.length === 0 && hasEngineRuns" class="py-8 text-center text-muted-foreground">
          本次没有返回规则结果
        </div>
        <div v-else-if="state.results.length === 0"
          data-testid="rule-check-empty-not-run"
          class="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
          <span class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <CirclePlay class="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <div class="text-[13px] font-semibold text-foreground">点「{{ runLabel }}」开始</div>
          <div class="text-[12px] text-muted-foreground">
            {{
              catalogUnavailable
                ? '规则目录没加载成功，先到「规则目录」重试'
                : state.selectedRuleIds.length > 0
                  ? `只运行已勾选的 ${state.selectedRuleIds.length} 条规则`
                  : `没勾选规则时运行当前筛选的全部 ${filteredCatalog.length} 条`
            }}
          </div>
          <div class="text-[11px] text-muted-foreground">{{ settingsSummary }}</div>
        </div>
        <template v-else>
          <div v-if="allViolations.length === 0 && onlyViolationsFilter"
            data-testid="rule-check-all-passed"
            class="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
            <span class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
              <CircleCheck class="h-5 w-5 text-emerald-700" aria-hidden="true" />
            </span>
            <div class="text-[13px] font-semibold text-emerald-800">{{ summaryStats.rulesRun }} 条规则全部通过</div>
            <div class="text-[12px] text-muted-foreground">
              用时 {{ formatRuleCheckDuration(state.runElapsedMs) }}<template v-if="preciseSummary"> · 精确复核剔除 {{ preciseSummary.cleared }} 项误报</template>
            </div>
            <button type="button" class="text-[12px] font-medium text-primary hover:underline" @click="onlyViolationsFilter = false">
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
                      class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true" />
                    <span class="shrink-0 whitespace-nowrap font-mono text-[12px] font-semibold text-foreground">{{ group.ruleId }}</span>
                    <span class="truncate text-[12px] text-muted-foreground" :title="group.title">{{ group.title }}</span>
                  </button>
                  <span class="shrink-0 rounded-full bg-red-50 px-1.5 font-mono text-[11px] font-semibold tabular-nums text-red-700">
                    {{ group.violations.length }}
                  </span>
                  <button type="button"
                    data-testid="rule-check-focus-group-btn"
                    title="定位本组"
                    aria-label="定位本组"
                    class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
                    :disabled="group.allHighlightRefnos.length === 0"
                    @click="focusRefnos(group.allHighlightRefnos)">
                    <Crosshair class="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 pl-5 text-[11px] text-muted-foreground">
                  <span>{{ group.discipline }}</span>
                  <template v-if="groupPreciseLabel(group.key)">
                    <span aria-hidden="true">·</span>
                    <span data-testid="rule-check-group-precise" class="font-mono tabular-nums text-emerald-800">{{ groupPreciseLabel(group.key) }}</span>
                  </template>
                  <template v-if="truncatedByRule.get(group.key)">
                    <span aria-hidden="true">·</span>
                    <span data-testid="rule-check-group-truncated" class="text-amber-800">
                      只列前 {{ truncatedByRule.get(group.key)?.violations.length }} / {{ truncatedByRule.get(group.key)?.violationTotal }}
                    </span>
                  </template>
                </div>
              </div>
              <template v-if="!collapsedGroups.includes(group.key)">
                <RuleCheckViolationRow v-for="v in group.violations.slice(0, groupLimit(group.key))"
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
                <button v-if="group.violations.length > groupLimit(group.key)"
                  type="button"
                  data-testid="rule-check-group-show-more"
                  class="flex w-full items-center justify-center gap-1 border-b border-border py-2 text-[12px] font-medium text-primary hover:bg-muted/40"
                  @click="showMoreInGroup(group.key)">
                  <ChevronsDown class="h-3.5 w-3.5" aria-hidden="true" />
                  再显示 {{ Math.min(PAGE_SIZE, group.violations.length - groupLimit(group.key)) }} 条（本组还有 {{ group.violations.length - groupLimit(group.key) }} 条）
                </button>
              </template>
            </div>
          </template>

          <!-- 平铺视图 -->
          <template v-else>
            <RuleCheckViolationRow v-for="v in renderedFlat"
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
            <button v-if="visibleViolations.length > flatLimit"
              type="button"
              data-testid="rule-check-show-more"
              class="flex w-full items-center justify-center gap-1 border-b border-border py-2 text-[12px] font-medium text-primary hover:bg-muted/40"
              @click="flatLimit += PAGE_SIZE">
              <ChevronsDown class="h-3.5 w-3.5" aria-hidden="true" />
              再显示 {{ Math.min(PAGE_SIZE, visibleViolations.length - flatLimit) }} 条（还有 {{ visibleViolations.length - flatLimit }} 条）
            </button>
          </template>

          <div v-if="state.running" class="flex items-center justify-center gap-1.5 py-3 text-[11px] text-muted-foreground">
            <LoaderCircle class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            其余引擎跑完后自动并入
          </div>

          <!-- 显示通过的规则 -->
          <div v-if="!onlyViolationsFilter" class="bg-muted/20 px-3 py-2">
            <div class="mb-1 text-[12px] font-medium text-foreground/80">通过规则（0 违规）</div>
            <div class="flex flex-wrap gap-1">
              <span v-for="r in state.results.filter((x) => x.violationTotal === 0)"
                :key="`${r.engine}:${r.id}`"
                class="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-800">
                {{ r.id }}
              </span>
            </div>
          </div>
        </template>
      </div>

      <!-- 键盘浏览提示 -->
      <div v-if="allViolations.length > 0"
        data-testid="rule-check-result-footer"
        class="flex items-center gap-1.5 border-t border-border bg-muted/30 px-3 py-1 text-[11px] text-foreground/70">
        <kbd class="rounded border border-border bg-background px-1 font-mono text-[11px]">↑↓</kbd>切换
        <kbd class="rounded border border-border bg-background px-1 font-mono text-[11px]">Enter</kbd>定位
        <kbd class="rounded border border-border bg-background px-1 font-mono text-[11px]">Esc</kbd>收起
        <span class="flex-1" />
        <span data-testid="rule-check-result-position" class="font-mono tabular-nums">
          {{ activeNavIndex >= 0 ? `第 ${activeNavIndex + 1} / ${navOrder.length} 项` : `${visibleViolations.length} 项` }}
        </span>
      </div>
    </div>
  </div>
</template>
