import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpatialComputeStore, normalizeBranComputeRefno, resetSpatialComputeStore } from './useSpatialCompute';

import type { ModelSourceKind } from '@/model-source/ports';

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    viewerRef: { value: null },
  }),
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: { value: '' },
  }),
}));

// BRAN 净距按数据源分流：这组用例默认站在 legacy 一侧，v1 那几条自己切。
const sourceKindState: { kind: ModelSourceKind } = { kind: 'legacy' };
vi.mock('@/model-source/kind', () => ({
  getModelSourceKind: () => sourceKindState.kind,
}));

describe('useSpatialCompute BRAN nearest clearance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sourceKindState.kind = 'legacy';
    resetSpatialComputeStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSpatialComputeStore();
  });

  it('exposes BRAN scenario with BRAN labels and defaults', () => {
    const store = createSpatialComputeStore();
    store.setActiveScenario('branNearestClearance');

    expect(store.currentScenarioMeta.value.title).toContain('BRAN');
    expect(store.currentScenarioMeta.value.sourceLabel).toBe('BRAN Refno');
    expect(store.currentScenarioMeta.value.sourceHelp).not.toContain('SUPPO');
    expect(store.currentScenarioState.value.suppoRefno).toBe('24381_145018');
    expect(store.currentScenarioState.value.searchRadius).toBe('5000');
    // 目标类型不再是输入框：计算后由 noun_counts 生成 facet；输入侧只剩噪声类型排除。
    expect(store.currentScenarioMeta.value.fields).toEqual(['searchRadius', 'excludeNouns']);
    expect(store.currentScenarioState.value.excludeNouns).toBe('WELD,ATTA');
    expect(store.currentScenarioState.value.nounFacets).toEqual([]);
    expect(store.currentScenarioMeta.value.endpoint).toBe('/api/sqlite-spatial/nearest-clearance');
  });

  it('shows the gen-model-v1 endpoint for the BRAN scenario when that source is active; other scenarios untouched', () => {
    sourceKindState.kind = 'gen-model-v1';
    const store = createSpatialComputeStore();

    expect(store.scenarioList.find((item) => item.key === 'branNearestClearance')?.endpoint).toBe('/api/v1/spatial/nearest-clearance');
    expect(store.scenarioList.find((item) => item.key === 'wallDistance')?.endpoint).toBe('/api/space/wall-distance');
    store.setActiveScenario('branNearestClearance');
    expect(store.currentSummary.value).toContain('/api/v1/spatial/nearest-clearance');
  });

  /** `group_by=noun` 的响应：一桶一类，桶内按距离升序，`noun_counts` 是截断前计数。 */
  function nounCandidate(refno: string, noun: string, distance: number, segmentOrder: number) {
    return {
      refno,
      noun,
      distance_mm: distance,
      intersects: distance === 0,
      nearest: {
        source_segment_refno: `24381_1450${segmentOrder}`,
        source_segment_order: segmentOrder,
        source_point: { x: 1, y: 2, z: 3 },
        target_point: { x: 4, y: 5, z: 6 },
        vector: { dx: 3, dy: 3, dz: 3 },
      },
      annotation: { start_point: { x: 1, y: 2, z: 3 }, end_point: { x: 4, y: 5, z: 6 }, label_mm: distance },
    };
  }

  const nounGroupedResponse = {
    success: true,
    nearest_by_group: [
      { group: 'WALL', nouns: ['WALL'], candidates: [nounCandidate('24381_1', 'WALL', 1200.4, 3), nounCandidate('24381_11', 'WALL', 2600, 5)] },
      { group: 'COLU', nouns: ['COLU'], candidates: [nounCandidate('24381_2', 'COLU', 0, 4)] },
      { group: 'SCTN', nouns: ['SCTN'], candidates: [nounCandidate('24381_3', 'SCTN', 830, 5), nounCandidate('24381_31', 'SCTN', 910, 5), nounCandidate('24381_32', 'SCTN', 1500, 6)] },
    ],
    noun_counts: { WALL: 3, COLU: 1, SCTN: 7 },
    excluded_self_members: 37,
  };

  it('submits group_by=noun (no target filter, exclude_nouns, max_per_group) and builds the noun facet from noun_counts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(nounGroupedResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    const state = store.scenarios.branNearestClearance;
    state.suppoRefno = 'pe:<24381/145018>';

    await store.submitScenario('branNearestClearance');

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/sqlite-spatial/nearest-clearance');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      source_mode: 'bran_centerline',
      source_refno: '24381_145018',
      group_by: 'noun',
      exclude_nouns: 'WELD,ATTA',
      radius: '5000',
      scope: 'all_loaded',
      max_per_group: '3',
    });
    expect(state.error).toBe('');

    // facet：桶序（最近距离序）、count 取截断前计数、全部默认勾选
    expect(state.nounFacets).toEqual([
      { noun: 'WALL', count: 3, selected: true },
      { noun: 'COLU', count: 1, selected: true },
      { noun: 'SCTN', count: 7, selected: true },
    ]);
    expect(state.excludedSelfMembers).toBe(37);

    // 表：勾选类型的全部候选（2 + 1 + 3）；每类只有最近 1 条 drawn
    expect(state.resultRows).toHaveLength(6);
    expect(state.resultRows.map((row) => [row.refno, row.drawn])).toEqual([
      ['24381_1', true], ['24381_11', false],
      ['24381_2', true],
      ['24381_3', true], ['24381_31', false], ['24381_32', false],
    ]);
    expect(state.resultRows[0]).toEqual(expect.objectContaining({
      noun: 'WALL',
      targetGroup: 'WALL',
      distanceMm: 1200.4,
      sourceSegmentRefno: '24381_14503',
      sourceSegmentOrder: 3,
      candidateKey: 'WALL:24381_1',
      label: 'segment 24381_14503#3',
    }));
    expect(state.resultRows[2]?.label).toBe('相交 · segment 24381_14504#4');

    // 三维标注候选 = 每类最近 1 条，index 是桶内位置
    expect(state.annotationCandidates.map((item) => [item.targetGroup, item.candidate.refno, item.index])).toEqual([
      ['WALL', '24381_1', 0],
      ['COLU', '24381_2', 0],
      ['SCTN', '24381_3', 0],
    ]);
    expect(state.annotationCandidates[0]?.candidate.annotation?.label_mm).toBe(1200.4);
  });

  /** 一个 `Response` 的 body 只能读一次：连发两次的用例每次都要造新的。 */
  const freshNounGroupedResponse = () => new Response(JSON.stringify(nounGroupedResponse), { status: 200 });

  it('typed exclude_nouns are trimmed and sent; empty field sends none', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => freshNounGroupedResponse());
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    const state = store.scenarios.branNearestClearance;

    state.excludeNouns = ' weld , TUBI,';
    await store.submitScenario('branNearestClearance');
    expect(new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost').searchParams.get('exclude_nouns')).toBe('weld,TUBI');

    state.excludeNouns = '';
    await store.submitScenario('branNearestClearance');
    expect(new URL(String(fetchMock.mock.calls[1]?.[0]), 'http://localhost').searchParams.has('exclude_nouns')).toBe(false);
  });

  it('unchecking a noun facet drops that bucket from rows and annotations without refetching; re-checking restores it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(nounGroupedResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    const state = store.scenarios.branNearestClearance;
    await store.submitScenario('branNearestClearance');

    store.toggleBranNounFacet('SCTN');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.nounFacets.find((facet) => facet.noun === 'SCTN')?.selected).toBe(false);
    expect(state.resultRows.map((row) => row.noun)).toEqual(['WALL', 'WALL', 'COLU']);
    expect(state.annotationCandidates.map((item) => item.targetGroup)).toEqual(['WALL', 'COLU']);

    store.setAllBranNounFacets(false);
    expect(state.resultRows).toEqual([]);
    expect(state.annotationCandidates).toEqual([]);
    // 分桶原文还在，勾回来不用重新请求
    expect(state.branGroups).toHaveLength(3);

    store.setAllBranNounFacets(true);
    expect(state.resultRows).toHaveLength(6);
    expect(state.annotationCandidates).toHaveLength(3);
    // 未知类型忽略
    store.toggleBranNounFacet('NOPE');
    expect(state.annotationCandidates).toHaveLength(3);
  });

  it('per-candidate draw toggle adds / removes a dimension candidate; a hidden bucket keeps its toggles but does not draw', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => freshNounGroupedResponse());
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    const state = store.scenarios.branNearestClearance;
    await store.submitScenario('branNearestClearance');

    store.toggleBranCandidateDrawn('SCTN:24381_31');
    expect(state.resultRows.find((row) => row.refno === '24381_31')?.drawn).toBe(true);
    expect(state.annotationCandidates.map((item) => [item.candidate.refno, item.index])).toEqual([
      ['24381_1', 0], ['24381_2', 0], ['24381_3', 0], ['24381_31', 1],
    ]);

    store.toggleBranCandidateDrawn('SCTN:24381_3');
    expect(state.annotationCandidates.map((item) => item.candidate.refno)).toEqual(['24381_1', '24381_2', '24381_31']);

    store.toggleBranNounFacet('SCTN');
    expect(state.annotationCandidates.map((item) => item.candidate.refno)).toEqual(['24381_1', '24381_2']);
    store.toggleBranNounFacet('SCTN');
    expect(state.annotationCandidates.map((item) => item.candidate.refno)).toEqual(['24381_1', '24381_2', '24381_31']);

    // 重新计算：facet 与标注开关回到默认（全选、每类最近 1 条）
    await store.submitScenario('branNearestClearance');
    expect(state.drawnCandidateKeys).toEqual(['WALL:24381_1', 'COLU:24381_2', 'SCTN:24381_3']);
    expect(state.annotationCandidates).toHaveLength(3);
  });

  it('also supports legacy object-shaped nearest_by_group responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        nearest_by_group: {
          wall: [{
            refno: '24381_3',
            noun: 'STWALL',
            distance_mm: 99,
          }],
        },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();

    await store.submitScenario('branNearestClearance');

    const state = store.scenarios.branNearestClearance;
    expect(state.resultRows).toEqual([
      expect.objectContaining({
        refno: '24381_3',
        noun: 'STWALL',
        targetGroup: 'wall',
        distanceMm: 99,
        drawn: true,
      }),
    ]);
    expect(state.annotationCandidates[0]?.targetGroup).toBe('wall');
    // 老响应没有 noun_counts：count 退回桶内条数
    expect(state.nounFacets).toEqual([{ noun: 'wall', count: 1, selected: true }]);
  });

  it('parses success false as nearest-clearance error and clears stale payloads', async () => {
    const responses = [
      { success: true, nearest_by_group: { wall: [{ refno: 'old', noun: 'WALL', distance_mm: 1 }] } },
      { success: false, error: 'missing BRAN centerline data' },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[0]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[1]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    const state = store.scenarios.branNearestClearance;

    await store.submitScenario('branNearestClearance');
    expect(state.resultRows).toHaveLength(1);
    expect(state.annotationCandidates).toHaveLength(1);

    await store.submitScenario('branNearestClearance');
    expect(state.error).toBe('missing BRAN centerline data');
    expect(state.resultRows).toEqual([]);
    expect(state.annotationCandidates).toEqual([]);
  });

  it('does not allow an older slower response to overwrite newer rows', async () => {
    let resolveA!: (value: Response) => void;
    let resolveB!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveA = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveB = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    const state = store.scenarios.branNearestClearance;

    const requestA = store.submitScenario('branNearestClearance');
    const requestB = store.submitScenario('branNearestClearance');
    resolveB(new Response(JSON.stringify({
      success: true,
      nearest_by_group: { column: [{ refno: 'new', noun: 'COLU', distance_mm: 2 }] },
    }), { status: 200 }));
    await requestB;
    resolveA(new Response(JSON.stringify({
      success: true,
      nearest_by_group: { wall: [{ refno: 'old', noun: 'WALL', distance_mm: 1 }] },
    }), { status: 200 }));
    await requestA;

    expect(state.resultRows).toHaveLength(1);
    expect(state.resultRows[0]?.refno).toBe('new');
    expect(state.annotationCandidates[0]?.candidate.refno).toBe('new');
  });

  describe('gen-model-v1 source routes to /api/v1/spatial/nearest-clearance', () => {
    const v1Candidate = (refno: string, noun: string, distance: number) => ({
      refno,
      noun,
      dbnum: 24381,
      distance_mm: distance,
      intersects: distance === 0,
      aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      nearest: {
        source_segment_refno: '24381_145019~24381_145020',
        source_segment_order: 2,
        source_point: { x: 1, y: 2, z: 3 },
        target_point: { x: 4, y: 5, z: 6 },
        vector: { dx: 3, dy: 3, dz: 3 },
      },
      annotation: { start_point: { x: 1, y: 2, z: 3 }, end_point: { x: 4, y: 5, z: 6 }, label_mm: distance },
    });

    const v1Response = {
      success: true,
      source: {
        kind: 'bran_centerline',
        refno: '24381_145018',
        dbnum: 24381,
        aabb: null,
        segment_count: 12,
        centerline_bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 9, y: 9, z: 9 } },
        outside_diameter_mm: null,
      },
      distance_method: 'centerline_aabb_clearance_mm',
      unit: 'mm',
      query_bbox: null,
      resolved_filters: {
        target_nouns: [],
        target_groups: [],
        group_by: 'noun',
        exclude_nouns: ['ATTA', 'WELD'],
        scope: 'all_loaded',
        dbnums: null,
        radius: 1500,
        max_per_group: 3,
        include_self: false,
        surface: false,
      },
      nearest_by_group: [
        { group: 'WALL', nouns: ['WALL'], candidates: [v1Candidate('24381_7', 'WALL', 812.5), v1Candidate('24381_8', 'WALL', 1499)] },
        { group: 'SCTN', nouns: ['SCTN'], candidates: [v1Candidate('24381_9', 'SCTN', 830)] },
      ],
      noun_counts: { WALL: 3, SCTN: 7 },
      excluded_self_members: 5,
      warnings: [],
      spatial_state: 'ready',
      coverage: 'global-tree',
    };

    it('sends the panel fields as v1 query params (refno as a/b, group_by=noun, max_per_group) and builds the facet', async () => {
      sourceKindState.kind = 'gen-model-v1';
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(v1Response), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const store = createSpatialComputeStore();
      const state = store.scenarios.branNearestClearance;
      state.suppoRefno = 'pe:<24381/145018>';
      state.searchRadius = '1500';

      await store.submitScenario('branNearestClearance');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
      expect(url.pathname).toBe('/api/v1/spatial/nearest-clearance');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        source_refno: '24381/145018',
        source_mode: 'bran_centerline',
        group_by: 'noun',
        exclude_nouns: 'WELD,ATTA',
        radius: '1500',
        scope: 'all_loaded',
        max_per_group: '3',
      });
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');

      expect(state.error).toBe('');
      expect(state.nounFacets).toEqual([
        { noun: 'WALL', count: 3, selected: true },
        { noun: 'SCTN', count: 7, selected: true },
      ]);
      expect(state.excludedSelfMembers).toBe(5);
      expect(state.resultRows.map((row) => [row.refno, row.noun, row.drawn])).toEqual([
        ['24381_7', 'WALL', true],
        ['24381_8', 'WALL', false],
        ['24381_9', 'SCTN', true],
      ]);
      expect(state.resultRows[0]).toEqual(expect.objectContaining({
        targetGroup: 'WALL',
        distanceMm: 812.5,
        sourceSegmentRefno: '24381_145019~24381_145020',
        sourceSegmentOrder: 2,
      }));
      expect(state.annotationCandidates.map((item) => item.candidate.refno)).toEqual(['24381_7', '24381_9']);
      expect(state.annotationCandidates[0]?.candidate.annotation?.label_mm).toBe(812.5);
      expect(JSON.parse(state.responseText)).toMatchObject({ noun_counts: { WALL: 3, SCTN: 7 }, excluded_self_members: 5 });
    });

    it('surfaces the v1 error envelope message (422: source is not a BRAN) and clears stale rows', async () => {
      sourceKindState.kind = 'gen-model-v1';
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(v1Response), { status: 200 }))
        .mockResolvedValueOnce(new Response(
          JSON.stringify({ code: 'precondition', message: '24381_145018 不是 BRAN，不能按中心线量距', detail: null }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        ));
      vi.stubGlobal('fetch', fetchMock);
      const store = createSpatialComputeStore();
      const state = store.scenarios.branNearestClearance;

      await store.submitScenario('branNearestClearance');
      expect(state.resultRows).toHaveLength(3);
      expect(state.nounFacets).toHaveLength(2);

      await store.submitScenario('branNearestClearance');
      expect(state.error).toBe('24381_145018 不是 BRAN，不能按中心线量距');
      expect(state.resultRows).toEqual([]);
      expect(state.annotationCandidates).toEqual([]);
      expect(state.nounFacets).toEqual([]);
      expect(state.branGroups).toEqual([]);
      expect(state.responseText).toBe('');
      expect(state.loading).toBe(false);
    });
  });

  it('normalizes BRAN refno inputs for compute state', () => {
    expect(normalizeBranComputeRefno('24381_145018')).toBe('24381_145018');
    expect(normalizeBranComputeRefno('24381/145018')).toBe('24381_145018');
    expect(normalizeBranComputeRefno('<24381/145018>')).toBe('24381_145018');
    expect(normalizeBranComputeRefno('=24381,145018')).toBe('24381_145018');
  });
});
