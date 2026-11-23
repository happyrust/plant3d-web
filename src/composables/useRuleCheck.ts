import { computed, reactive, ref } from 'vue';

import type { GenModelV1RequestOptions } from '@/api/genModelV1Api';

import {
  fetchAllRuleCatalogs,
  normalizeAttrResponse,
  normalizeBranResponse,
  normalizeRoomResponse,
  normalizeRuleRefnoToken,
  normalizeSpatialResponse,
  runAttrRuleCheck,
  runBranRuleCheck,
  runRoomRuleCheck,
  runSpatialRuleCheck,
  type RuleCheckEngine,
  type UnifiedRuleCatalogRow,
  type UnifiedRuleCheckBatchResult,
  type UnifiedRuleResult,
  type UnifiedRuleViolation,
} from '@/api/ruleCheckApi';

export type RuleCheckEngineFilter = 'all' | RuleCheckEngine;

export const RULE_CHECK_DISCIPLINES = ['水工', '布置', '仪控', '通风', '电气'] as const;

export const RULE_CHECK_ENGINE_LABELS: Record<RuleCheckEngineFilter, string> = {
  all: '全部引擎',
  spatial: '空间净距',
  bran: 'BRAN 拓扑',
  rooms: '房间语义',
  attrs: '属性/火灾分区',
};

function createInitialState() {
  return {
    catalog: [] as UnifiedRuleCatalogRow[],
    catalogLoaded: false,
    catalogLoading: false,
    catalogError: null as string | null,
    catalogWarnings: [] as string[],

    activeEngine: 'all' as RuleCheckEngineFilter,
    activeDiscipline: 'all' as string,
    searchKeyword: '',
    selectedRuleIds: [] as string[],

    branRefno: '',
    attrScopeText: '',

    running: false,
    runError: null as string | null,
    runWarnings: [] as string[],
    batches: [] as UnifiedRuleCheckBatchResult[],
    results: [] as UnifiedRuleResult[],
    totalElapsedMs: 0,
    lastRunAt: null as number | null,
    activeViolationKey: null as string | null,
  };
}

const state = reactive(createInitialState());
const activeController = ref<AbortController | null>(null);

export function resetRuleCheckStore() {
  activeController.value?.abort();
  activeController.value = null;
  Object.assign(state, createInitialState());
}

export function parseScopeRefnoList(raw: string): string[] {
  return raw
    .split(/[\s,，;；]+/)
    .map(normalizeRuleRefnoToken)
    .filter(Boolean);
}

export function useRuleCheck() {
  const filteredCatalog = computed<UnifiedRuleCatalogRow[]>(() => {
    const kw = state.searchKeyword.trim().toLowerCase();
    return state.catalog.filter((row) => {
      if (state.activeEngine !== 'all' && row.engine !== state.activeEngine) return false;
      if (state.activeDiscipline !== 'all' && row.discipline !== state.activeDiscipline) return false;
      if (!kw) return true;
      return (
        row.id.toLowerCase().includes(kw)
        || row.title.toLowerCase().includes(kw)
        || row.requirement.toLowerCase().includes(kw)
        || `#${row.issue}`.includes(kw)
        || String(row.issue).includes(kw)
      );
    });
  });

  const engineCounts = computed<Record<RuleCheckEngineFilter, number>>(() => {
    const counts: Record<RuleCheckEngineFilter, number> = {
      all: state.catalog.length,
      spatial: 0,
      bran: 0,
      rooms: 0,
      attrs: 0,
    };
    for (const row of state.catalog) {
      counts[row.engine] += 1;
    }
    return counts;
  });

  const disciplineCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = { all: 0 };
    for (const row of state.catalog) {
      if (state.activeEngine !== 'all' && row.engine !== state.activeEngine) continue;
      counts.all = (counts.all ?? 0) + 1;
      counts[row.discipline] = (counts[row.discipline] ?? 0) + 1;
    }
    return counts;
  });

  const allViolations = computed<UnifiedRuleViolation[]>(() =>
    state.results.flatMap((r) => r.violations),
  );

  const summaryStats = computed(() => {
    let violations = 0;
    let reminders = 0;
    let semiAuto = 0;
    let firezones = 0;
    let totalReported = 0;
    for (const r of state.results) {
      totalReported += r.violationTotal;
      for (const v of r.violations) {
        if (v.highlightColor) firezones += 1;
        if (v.severity === 'reminder') reminders += 1;
        else if (v.severity === 'semi_auto') semiAuto += 1;
        else violations += 1;
      }
    }
    return {
      rulesRun: state.results.length,
      totalReported,
      violations,
      reminders,
      semiAuto,
      firezones,
    };
  });

  async function loadCatalogs(options?: GenModelV1RequestOptions): Promise<void> {
    if (state.catalogLoading) return;
    state.catalogLoading = true;
    state.catalogError = null;
    try {
      const { rules, warnings } = await fetchAllRuleCatalogs(options);
      state.catalog = rules;
      state.catalogWarnings = warnings;
      state.catalogLoaded = true;
    } catch (err) {
      state.catalogError = err instanceof Error ? err.message : String(err);
    } finally {
      state.catalogLoading = false;
    }
  }

  function toggleRuleSelection(ruleId: string) {
    const idx = state.selectedRuleIds.indexOf(ruleId);
    if (idx >= 0) {
      state.selectedRuleIds.splice(idx, 1);
    } else {
      state.selectedRuleIds.push(ruleId);
    }
  }

  function selectAllFiltered() {
    const set = new Set(state.selectedRuleIds);
    for (const row of filteredCatalog.value) {
      set.add(row.id);
    }
    state.selectedRuleIds = Array.from(set);
  }

  function clearRuleSelection() {
    state.selectedRuleIds = [];
  }

  function setBranRefno(refno: string) {
    state.branRefno = refno.trim();
  }

  function appendScopeRefno(refno: string) {
    const normalized = normalizeRuleRefnoToken(refno);
    if (!normalized) return;
    const existing = parseScopeRefnoList(state.attrScopeText);
    existing.push(normalized);
    state.attrScopeText = existing.join(', ');
  }

  function clearResults() {
    state.batches = [];
    state.results = [];
    state.runWarnings = [];
    state.runError = null;
    state.totalElapsedMs = 0;
    state.activeViolationKey = null;
  }

  function cancelRun() {
    activeController.value?.abort();
    activeController.value = null;
    state.running = false;
  }

  async function runChecks(options?: GenModelV1RequestOptions): Promise<void> {
    if (state.running) {
      activeController.value?.abort();
    }
    const controller = new AbortController();
    activeController.value = controller;
    state.running = true;
    state.runError = null;
    state.runWarnings = [];
    state.batches = [];
    state.results = [];
    state.activeViolationKey = null;

    const reqOptions: GenModelV1RequestOptions = {
      ...options,
      signal: options?.signal ?? controller.signal,
    };

    try {
      const selectedSet = new Set(state.selectedRuleIds);
      const targetRows = selectedSet.size > 0
        ? state.catalog.filter((r) => selectedSet.has(r.id))
        : filteredCatalog.value;

      const byEngine: Record<RuleCheckEngine, string[]> = {
        spatial: [],
        bran: [],
        rooms: [],
        attrs: [],
      };
      for (const row of targetRows) {
        byEngine[row.engine].push(row.id);
      }

      const explicitEngines: RuleCheckEngine[] = state.activeEngine === 'all'
        ? (['spatial', 'bran', 'rooms', 'attrs'] as RuleCheckEngine[])
        : [state.activeEngine];

      const warnings: string[] = [];
      const tasks: Promise<UnifiedRuleCheckBatchResult>[] = [];
      const scopeRefnos = parseScopeRefnoList(state.attrScopeText);

      for (const eng of explicitEngines) {
        const ids = byEngine[eng];
        const runAllForEngine = state.catalog.length === 0
          || (selectedSet.size === 0 && state.activeDiscipline === 'all' && !state.searchKeyword.trim());
        if (!runAllForEngine && ids.length === 0) continue;
        const passIds = runAllForEngine ? undefined : ids;

        if (eng === 'spatial') {
          tasks.push(runSpatialRuleCheck(passIds, reqOptions).then(normalizeSpatialResponse));
        } else if (eng === 'bran') {
          const bran = state.branRefno.trim();
          if (!bran) {
            if (state.activeEngine === 'bran') {
              throw new Error('请先输入或从三维选择一条 BRAN 的 refno（如 24381_145018）再运行 BRAN 拓扑校验');
            }
            warnings.push('未填 BRAN refno，已跳过 BRAN 拓扑规则（切至「BRAN 拓扑」填入 refno 可单独运行）');
            continue;
          }
          tasks.push(runBranRuleCheck(bran, passIds, reqOptions).then(normalizeBranResponse));
        } else if (eng === 'rooms') {
          tasks.push(runRoomRuleCheck(passIds, reqOptions).then(normalizeRoomResponse));
        } else if (eng === 'attrs') {
          tasks.push(
            runAttrRuleCheck(
              passIds,
              scopeRefnos.length > 0 ? scopeRefnos : undefined,
              reqOptions,
            ).then(normalizeAttrResponse),
          );
        }
      }

      const settled = await Promise.allSettled(tasks);
      const batches: UnifiedRuleCheckBatchResult[] = [];
      for (const item of settled) {
        if (item.status === 'fulfilled') {
          batches.push(item.value);
          warnings.push(...item.value.warnings);
        } else {
          const msg = item.reason instanceof Error ? item.reason.message : String(item.reason);
          warnings.push(`部分引擎执行失败：${msg}`);
        }
      }

      if (batches.length === 0 && settled.length > 0 && settled.every((s) => s.status === 'rejected')) {
        const firstErr = (settled[0] as PromiseRejectedResult).reason;
        throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
      }

      state.batches = batches;
      state.results = batches.flatMap((b) => b.results);
      state.runWarnings = warnings;
      state.totalElapsedMs = batches.reduce((acc, b) => acc + (b.elapsedMs ?? 0), 0);
      state.lastRunAt = Date.now();
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        state.runError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (activeController.value === controller) {
        activeController.value = null;
      }
      state.running = false;
    }
  }

  return {
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
  };
}
