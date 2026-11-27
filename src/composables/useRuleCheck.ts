import { computed, reactive, shallowRef } from 'vue';

import type { GenModelV1RequestOptions } from '@/api/genModelV1Api';

import {
  fetchAllRuleCatalogs,
  normalizeAttrResponse,
  normalizeBranResponse,
  normalizeBranRunAllResponse,
  normalizeRoomResponse,
  normalizeRuleRefnoToken,
  normalizeSpatialResponse,
  runAttrRuleCheck,
  runBranRuleCheck,
  runBranRuleCheckAll,
  runRoomRuleCheck,
  runSpatialRuleCheck,
  type RuleCheckEngine,
  type UnifiedBranRunAllSummary,
  type UnifiedPreciseSummary,
  type UnifiedRuleCatalogRow,
  type UnifiedRuleCheckBatchResult,
  type UnifiedRuleResult,
  type UnifiedRuleViolation,
} from '@/api/ruleCheckApi';

export type RuleCheckEngineFilter = 'all' | RuleCheckEngine;

/** BRAN 拓扑规则的运行范围：单根 BRAN，或全项目逐根。 */
export type RuleCheckBranScope = 'single' | 'all';

export type RuleCheckEngineRunStatus = 'running' | 'done' | 'failed' | 'cancelled';

/** 一次运行里单个引擎的状态；用时是前端计的墙钟时间。 */
export interface RuleCheckEngineRun {
  engine: RuleCheckEngine;
  label: string;
  status: RuleCheckEngineRunStatus;
  startedAt: number | null;
  elapsedMs: number | null;
  rulesRun: number;
  violationTotal: number;
  error: string | null;
}

export const RULE_CHECK_ENGINE_ORDER: RuleCheckEngine[] = ['spatial', 'bran', 'rooms', 'attrs'];

interface EngineRunPlan {
  engine: RuleCheckEngine;
  label: string;
  run: (options: GenModelV1RequestOptions) => Promise<UnifiedRuleCheckBatchResult>;
}

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
    precise: false,
    branScope: 'single' as RuleCheckBranScope,

    running: false,
    runError: null as string | null,
    runWarnings: [] as string[],
    batches: [] as UnifiedRuleCheckBatchResult[],
    results: [] as UnifiedRuleResult[],
    engineRuns: [] as RuleCheckEngineRun[],
    /** 各引擎后端耗时之和。 */
    totalElapsedMs: 0,
    runStartedAt: null as number | null,
    /** 从点运行到最后一个引擎结束的墙钟时间。 */
    runElapsedMs: 0,
    lastRunAt: null as number | null,
    activeViolationKey: null as string | null,
  };
}

const state = reactive(createInitialState());
const activeController = shallowRef<AbortController | null>(null);
let lastPlans: EngineRunPlan[] = [];
let planWarnings: string[] = [];

export function resetRuleCheckStore() {
  activeController.value?.abort();
  activeController.value = null;
  lastPlans = [];
  planWarnings = [];
  Object.assign(state, createInitialState());
}

function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
    let precise: UnifiedPreciseSummary | null = null;
    if (state.batches.some((b) => b.precise)) {
      precise = { refinableRules: 0, aabbFindings: 0, cleared: 0, candidates: 0, exact: 0, unavailable: 0 };
      for (const r of state.results) {
        if (!r.precise?.refinable) continue;
        precise.refinableRules += 1;
        precise.aabbFindings += r.precise.aabbFindings;
        precise.cleared += r.precise.cleared;
        precise.candidates += r.precise.candidates;
        precise.exact += r.precise.exact;
        precise.unavailable += r.precise.unavailable;
      }
    }
    const runAllBatch = state.batches.find((b) => b.bransTotal !== undefined);
    const branAll: UnifiedBranRunAllSummary | null = runAllBatch
      ? {
        bransTotal: runAllBatch.bransTotal ?? 0,
        bransChecked: runAllBatch.bransChecked ?? 0,
        bransFailed: runAllBatch.bransFailed ?? 0,
      }
      : null;
    return {
      rulesRun: state.results.length,
      totalReported,
      violations,
      reminders,
      semiAuto,
      firezones,
      precise,
      branAll,
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
    state.engineRuns = [];
    state.runWarnings = [];
    state.runError = null;
    state.totalElapsedMs = 0;
    state.runElapsedMs = 0;
    state.runStartedAt = null;
    state.activeViolationKey = null;
    planWarnings = [];
  }

  function cancelRun() {
    activeController.value?.abort();
    activeController.value = null;
    const now = Date.now();
    for (const run of state.engineRuns) {
      if (run.status !== 'running') continue;
      run.status = 'cancelled';
      run.elapsedMs = now - (run.startedAt ?? now);
    }
    if (state.runStartedAt !== null) state.runElapsedMs = now - state.runStartedAt;
    state.running = false;
  }

  /** 按当前筛选与勾选拆出要跑的引擎；显式只跑 BRAN 却没填 refno 时抛错。 */
  function buildRunPlans(): { plans: EngineRunPlan[]; warnings: string[] } {
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
      ? RULE_CHECK_ENGINE_ORDER
      : [state.activeEngine];

    const warnings: string[] = [];
    const plans: EngineRunPlan[] = [];
    const scopeRefnos = parseScopeRefnoList(state.attrScopeText);
    const precise = state.precise;
    const runAllForEngine = state.catalog.length === 0
      || (selectedSet.size === 0 && state.activeDiscipline === 'all' && !state.searchKeyword.trim());

    for (const eng of explicitEngines) {
      const ids = byEngine[eng];
      if (!runAllForEngine && ids.length === 0) continue;
      const passIds = runAllForEngine ? undefined : ids;
      const label = RULE_CHECK_ENGINE_LABELS[eng];

      if (eng === 'spatial') {
        plans.push({
          engine: eng,
          label,
          run: (opts) => runSpatialRuleCheck(passIds, opts, { precise }).then(normalizeSpatialResponse),
        });
      } else if (eng === 'bran') {
        if (state.branScope === 'all') {
          plans.push({
            engine: eng,
            label: 'BRAN 全项目',
            run: (opts) => runBranRuleCheckAll(passIds, opts).then(normalizeBranRunAllResponse),
          });
          continue;
        }
        const bran = state.branRefno.trim();
        if (!bran) {
          if (state.activeEngine === 'bran') {
            throw new Error('请先输入或从三维选择一条 BRAN 的 refno（如 24381_145018）再运行 BRAN 拓扑校验');
          }
          warnings.push('未填 BRAN refno，已跳过 BRAN 拓扑规则（切至「BRAN 拓扑」填入 refno 可单独运行）');
          continue;
        }
        plans.push({
          engine: eng,
          label,
          run: (opts) => runBranRuleCheck(bran, passIds, opts).then(normalizeBranResponse),
        });
      } else if (eng === 'rooms') {
        plans.push({
          engine: eng,
          label,
          run: (opts) => runRoomRuleCheck(passIds, opts).then(normalizeRoomResponse),
        });
      } else if (eng === 'attrs') {
        const scope = scopeRefnos.length > 0 ? scopeRefnos : undefined;
        plans.push({
          engine: eng,
          label,
          run: (opts) => runAttrRuleCheck(passIds, scope, opts).then(normalizeAttrResponse),
        });
      }
    }
    return { plans, warnings };
  }

  function mergeBatch(engine: RuleCheckEngine, batch: UnifiedRuleCheckBatchResult) {
    const batches = [...state.batches.filter((b) => b.engine !== engine), batch];
    batches.sort((a, b) => RULE_CHECK_ENGINE_ORDER.indexOf(a.engine) - RULE_CHECK_ENGINE_ORDER.indexOf(b.engine));
    state.batches = batches;
    state.results = batches.flatMap((b) => b.results);
    state.runWarnings = [...planWarnings, ...batches.flatMap((b) => b.warnings)];
    state.totalElapsedMs = batches.reduce((acc, b) => acc + (b.elapsedMs ?? 0), 0);
  }

  /** 跑一个引擎并把结果并入当前结果，返回是否成功。 */
  async function executePlan(
    plan: EngineRunPlan,
    options: GenModelV1RequestOptions,
    signal: AbortSignal,
  ): Promise<boolean> {
    const run = state.engineRuns.find((r) => r.engine === plan.engine);
    if (!run) return false;
    run.status = 'running';
    run.startedAt = Date.now();
    run.elapsedMs = null;
    run.error = null;
    try {
      const batch = await plan.run(options);
      if (signal.aborted) {
        run.status = 'cancelled';
        return false;
      }
      mergeBatch(plan.engine, batch);
      run.status = 'done';
      run.rulesRun = batch.rulesRun;
      run.violationTotal = batch.results.reduce((acc, r) => acc + r.violationTotal, 0);
      return true;
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        run.status = 'cancelled';
      } else {
        run.status = 'failed';
        run.error = errorMessage(err);
      }
      return false;
    } finally {
      run.elapsedMs = Date.now() - (run.startedAt ?? Date.now());
    }
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
    state.engineRuns = [];
    state.totalElapsedMs = 0;
    state.runElapsedMs = 0;
    state.runStartedAt = Date.now();
    state.activeViolationKey = null;
    planWarnings = [];
    lastPlans = [];

    const reqOptions: GenModelV1RequestOptions = {
      ...options,
      signal: options?.signal ?? controller.signal,
    };

    try {
      const { plans, warnings } = buildRunPlans();
      planWarnings = warnings;
      lastPlans = plans;
      state.runWarnings = [...warnings];
      state.engineRuns = plans.map((plan) => ({
        engine: plan.engine,
        label: plan.label,
        status: 'running' as const,
        startedAt: state.runStartedAt,
        elapsedMs: null,
        rulesRun: 0,
        violationTotal: 0,
        error: null,
      }));

      const outcomes = await Promise.all(plans.map((plan) => executePlan(plan, reqOptions, controller.signal)));

      if (!controller.signal.aborted && outcomes.length > 0 && outcomes.every((ok) => !ok)) {
        const failed = state.engineRuns.find((r) => r.status === 'failed');
        if (failed?.error) state.runError = failed.error;
      }
      state.lastRunAt = Date.now();
    } catch (err) {
      if (!isAbortError(err)) {
        state.runError = errorMessage(err);
      }
    } finally {
      if (activeController.value === controller) {
        activeController.value = null;
        state.running = false;
        state.runElapsedMs = Date.now() - (state.runStartedAt ?? Date.now());
      }
    }
  }

  /** 单独重跑上一轮里的某个引擎，结果替换该引擎原有的结果。 */
  async function retryEngine(engine: RuleCheckEngine, options?: GenModelV1RequestOptions): Promise<void> {
    const plan = lastPlans.find((p) => p.engine === engine);
    const run = state.engineRuns.find((r) => r.engine === engine);
    if (!plan || !run || run.status === 'running') return;

    const current = activeController.value;
    if (state.running && current) {
      await executePlan(plan, { ...options, signal: options?.signal ?? current.signal }, current.signal);
      return;
    }

    const controller = new AbortController();
    activeController.value = controller;
    state.running = true;
    state.runError = null;
    try {
      await executePlan(plan, { ...options, signal: options?.signal ?? controller.signal }, controller.signal);
      state.lastRunAt = Date.now();
    } finally {
      if (activeController.value === controller) {
        activeController.value = null;
        state.running = false;
      }
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
    retryEngine,
  };
}
