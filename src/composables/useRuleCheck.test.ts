import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchAllRuleCatalogsMock,
  runSpatialRuleCheckMock,
  runBranRuleCheckMock,
  runBranRuleCheckAllMock,
  runRoomRuleCheckMock,
  runAttrRuleCheckMock,
} = vi.hoisted(() => ({
  fetchAllRuleCatalogsMock: vi.fn(),
  runSpatialRuleCheckMock: vi.fn(),
  runBranRuleCheckMock: vi.fn(),
  runBranRuleCheckAllMock: vi.fn(),
  runRoomRuleCheckMock: vi.fn(),
  runAttrRuleCheckMock: vi.fn(),
}));

vi.mock('@/api/ruleCheckApi', async () => {
  const actual = await vi.importActual<typeof import('@/api/ruleCheckApi')>('@/api/ruleCheckApi');
  return {
    ...actual,
    fetchAllRuleCatalogs: fetchAllRuleCatalogsMock,
    runSpatialRuleCheck: runSpatialRuleCheckMock,
    runBranRuleCheck: runBranRuleCheckMock,
    runBranRuleCheckAll: runBranRuleCheckAllMock,
    runRoomRuleCheck: runRoomRuleCheckMock,
    runAttrRuleCheck: runAttrRuleCheckMock,
  };
});

import { parseScopeRefnoList, resetRuleCheckStore, useRuleCheck } from './useRuleCheck';

describe('useRuleCheck', () => {
  beforeEach(() => {
    resetRuleCheckStore();
    fetchAllRuleCatalogsMock.mockReset();
    runSpatialRuleCheckMock.mockReset();
    runBranRuleCheckMock.mockReset();
    runBranRuleCheckAllMock.mockReset();
    runRoomRuleCheckMock.mockReset();
    runAttrRuleCheckMock.mockReset();

    fetchAllRuleCatalogsMock.mockResolvedValue({
      rules: [
        { engine: 'spatial', id: 'HYD-001', issue: 315, discipline: '水工', title: '水工净距', requirement: '>=300mm' },
        { engine: 'bran', id: 'INST-222', issue: 222, discipline: '仪控', title: '直管段', requirement: '>=5D' },
        { engine: 'rooms', id: 'ELEC-250', issue: 250, discipline: '电气', title: '配电室通道', requirement: '>=1500mm' },
        { engine: 'attrs', id: 'ELEC-282', issue: 282, discipline: '电气', title: '火灾分区', requirement: '红黄标注' },
      ],
      warnings: [],
    });
  });

  it('parses comma/space separated scope refnos and normalizes slashes', () => {
    expect(parseScopeRefnoList('24381/1, 24381_2；24381/3')).toEqual([
      '24381_1',
      '24381_2',
      '24381_3',
    ]);
  });

  it('loads catalogs and filters by engine, discipline, and keyword', async () => {
    const store = useRuleCheck();
    await store.loadCatalogs();

    expect(store.state.catalogLoaded).toBe(true);
    expect(store.engineCounts.value).toEqual({ all: 4, spatial: 1, bran: 1, rooms: 1, attrs: 1 });
    expect(store.disciplineCounts.value['电气']).toBe(2);

    store.state.activeDiscipline = '电气';
    expect(store.filteredCatalog.value.map((r) => r.id)).toEqual(['ELEC-250', 'ELEC-282']);

    store.state.searchKeyword = '#282';
    expect(store.filteredCatalog.value.map((r) => r.id)).toEqual(['ELEC-282']);
  });

  it('skips bran with warning when activeEngine=all and branRefno is empty, and runs other engines', async () => {
    runSpatialRuleCheckMock.mockResolvedValue({
      tree_state: 'ready',
      rules_run: 1,
      elapsed_ms: 10,
      warnings: [],
      results: [
        {
          id: 'HYD-001',
          issue: 315,
          discipline: '水工',
          title: '水工净距',
          requirement: '>=300mm',
          unit: 'mm',
          source_items: 2,
          target_items: 2,
          violation_total: 1,
          truncated: false,
          violations: [
            {
              source: { refno: '24381_1', noun: 'PIPE' },
              target: { refno: '24381_2', noun: 'WALL' },
              measured_mm: 180,
              threshold_mm: 300,
              margin_mm: -120,
              highlight_refnos: ['24381_1', '24381_2'],
            },
          ],
        },
      ],
    });
    runRoomRuleCheckMock.mockResolvedValue({
      tree_state: 'ready',
      room_count: 1,
      rules_run: 1,
      elapsed_ms: 5,
      warnings: [],
      results: [],
    });
    runAttrRuleCheckMock.mockResolvedValue({
      tree_state: 'ready',
      rules_run: 1,
      elapsed_ms: 3,
      warnings: [],
      results: [
        {
          id: 'ELEC-282',
          issue: 282,
          discipline: '电气',
          title: '火灾分区',
          requirement: '红黄',
          checked_items: 1,
          violation_total: 1,
          truncated: false,
          violations: [
            {
              source_refno: '24381_9',
              source_noun: 'CTRAY',
              highlight_color: 'yellow',
              highlight_refnos: ['24381_9'],
              detail: '局部性火灾',
            },
          ],
        },
      ],
    });

    const store = useRuleCheck();
    await store.loadCatalogs();
    await store.runChecks();

    expect(runBranRuleCheckMock).not.toHaveBeenCalled();
    expect(store.state.runWarnings.some((w) => w.includes('未填 BRAN refno'))).toBe(true);
    expect(store.summaryStats.value.violations).toBe(2);
    expect(store.summaryStats.value.firezones).toBe(1);
    expect(store.summaryStats.value.precise).toBeNull();
    expect(store.state.totalElapsedMs).toBe(18);
  });

  it('requires branRefno when explicitly running bran engine', async () => {
    const store = useRuleCheck();
    await store.loadCatalogs();
    store.state.activeEngine = 'bran';
    await store.runChecks();

    expect(store.state.runError).toContain('BRAN');
  });

  it('passes ordered scopeRefnos when running attrs engine with selected rules', async () => {
    runAttrRuleCheckMock.mockResolvedValue({ elapsed_ms: 2, results: [] });

    const store = useRuleCheck();
    await store.loadCatalogs();
    store.state.activeEngine = 'attrs';
    store.toggleRuleSelection('ELEC-282');
    store.appendScopeRefno('24381/10');
    store.appendScopeRefno('24381/20');
    await store.runChecks();

    expect(runAttrRuleCheckMock).toHaveBeenCalledWith(
      ['ELEC-282'],
      ['24381_10', '24381_20'],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('passes the precise flag to the spatial engine and sums precise stats of refinable rules', async () => {
    runSpatialRuleCheckMock.mockResolvedValue({
      tree_state: 'Ready',
      precise: true,
      rules_run: 2,
      elapsed_ms: 40,
      warnings: [],
      results: [
        {
          id: 'HYD-001',
          issue: 315,
          discipline: '水工',
          title: '水工净距',
          requirement: '>=300mm',
          unit: 'mm',
          source_items: 5,
          target_items: 5,
          violation_total: 1,
          truncated: false,
          precise: { refinable: true, aabb_findings: 4, candidates: 6, exact: 5, unavailable: 1, cleared: 3 },
          violations: [
            {
              source: { refno: '24381_1', noun: 'PIPE' },
              target: { refno: '24381_2', noun: 'WALL' },
              measured_mm: 120,
              threshold_mm: 300,
              margin_mm: -180,
              highlight_refnos: ['24381_1', '24381_2'],
              accuracy: 'exact-surface',
              exact_surface_mm: 120,
            },
          ],
        },
        {
          id: 'HYD-009',
          issue: 316,
          discipline: '水工',
          title: '上方净空',
          requirement: '<=100mm',
          unit: 'mm',
          source_items: 2,
          target_items: 2,
          violation_total: 0,
          truncated: false,
          precise: { refinable: false, aabb_findings: 2, candidates: 0, exact: 0, unavailable: 0, cleared: 0 },
          violations: [],
        },
      ],
    });

    const store = useRuleCheck();
    await store.loadCatalogs();
    store.state.activeEngine = 'spatial';
    store.state.precise = true;
    await store.runChecks();

    expect(runSpatialRuleCheckMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { precise: true },
    );
    expect(store.summaryStats.value.precise).toEqual({
      refinableRules: 1,
      aabbFindings: 4,
      cleared: 3,
      candidates: 6,
      exact: 5,
      unavailable: 1,
    });
  });

  it('runs project-wide BRAN without a refno when the BRAN scope is all', async () => {
    runBranRuleCheckAllMock.mockResolvedValue({
      brans_total: 10,
      brans_checked: 9,
      brans_failed: 1,
      rules_run: 1,
      elapsed_ms: 1500,
      warnings: [],
      results: [],
    });

    const store = useRuleCheck();
    await store.loadCatalogs();
    store.state.activeEngine = 'bran';
    store.state.branScope = 'all';
    await store.runChecks();

    expect(store.state.runError).toBeNull();
    expect(runBranRuleCheckMock).not.toHaveBeenCalled();
    expect(runBranRuleCheckAllMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(store.summaryStats.value.branAll).toEqual({ bransTotal: 10, bransChecked: 9, bransFailed: 1 });
    expect(store.state.totalElapsedMs).toBe(1500);
  });
});
