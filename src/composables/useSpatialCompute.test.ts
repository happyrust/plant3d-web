import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSpatialComputeStore,
  normalizeBranComputeRefno,
  resetSpatialComputeStore,
} from './useSpatialCompute';

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    viewerRef: { value: null },
  }),
}));

vi.mock('@/composables/useSelectionStore', async () => {
  const { ref } = await import('vue');
  // 「跟随选中」的 watch 要真 ref 才触发；探针导出给用例直接改选中。
  const selectedRefno = ref<string | null>(null);
  return {
    useSelectionStore: () => ({ selectedRefno }),
    __selectedRefno: selectedRefno,
  };
});

describe('useSpatialCompute BRAN nearest clearance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    expect(store.currentScenarioMeta.value.endpoint).toBe('/api/v1/spatial/nearest-clearance');
  });

  it('BRAN 净距是唯一场景（旧后端 /api/space/* 的六个支架场景 2026-09-20 随 legacy 退役），走 gen-model-v1 端点', () => {
    const store = createSpatialComputeStore();

    expect(store.scenarioList.map((item) => item.key)).toEqual(['branNearestClearance']);
    expect(store.scenarioList[0]?.endpoint).toBe('/api/v1/spatial/nearest-clearance');
    expect(store.activeScenario.value).toBe('branNearestClearance');
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
    expect(url.pathname).toBe('/api/v1/spatial/nearest-clearance');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      source_mode: 'bran_centerline',
      source_refno: '24381/145018',
      group_by: 'noun',
      structural_angle_deg: '5',
      exclude_nouns: 'WELD,ATTA',
      radius: '5000',
      scope: 'all_loaded',
      max_per_group: '3',
      surface: 'true',
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
      label: '管表面到包围盒估算 · segment 24381_14503#3',
    }));
    expect(state.resultRows[2]?.label).toBe('相交 · 管表面到包围盒估算 · segment 24381_14504#4');

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

  it('preflights BRAN cloud results atomically and detaches them from later response mutation', async () => {
    const store = createSpatialComputeStore();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(freshNounGroupedResponse));
    await store.submitScenario('branNearestClearance');
    const before = store.scenarios.branNearestClearance.resultRows.map(row => row.label);
    const snapshot = store.captureSnapshot();
    expect(() => store.prepareSnapshotRestore({ ...snapshot, candidateProvenance: { broken: {} } })).toThrow();
    expect(store.scenarios.branNearestClearance.resultRows.map(row => row.label)).toEqual(before);
    const apply = store.prepareSnapshotRestore(snapshot);
    snapshot.branGroups.length = 0;
    apply();
    expect(store.scenarios.branNearestClearance.resultRows).toHaveLength(6);
    expect(store.scenarios.branNearestClearance.resultRows[0]?.label).toContain('过期');
    store.dispose();
  });

  it('restores BRAN selections and annotations as stale without crossing project contexts', async () => {
    const values = new Map<string, string>();
    const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = createSpatialComputeStore();
    store.bindPersistence('A', local);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(freshNounGroupedResponse));
    await store.submitScenario('branNearestClearance');
    const keys = [...store.scenarios.branNearestClearance.drawnCandidateKeys];
    store.bindPersistence('B', local);
    expect(store.scenarios.branNearestClearance.branGroups).toEqual([]);
    store.bindPersistence('A', local);
    expect(store.scenarios.branNearestClearance.resultRows).toHaveLength(6);
    expect(store.scenarios.branNearestClearance.drawnCandidateKeys).toEqual(keys);
    expect(store.scenarios.branNearestClearance.resultRows[0]?.label).toContain('过期');
    store.bindPersistence('history', local, false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await store.submitScenario('branNearestClearance');
    expect(fetchMock).not.toHaveBeenCalled();
    store.dispose();
  });

  it('persists auto-follow toggle and range distance with the snapshot; old snapshots read defaults', async () => {
    const values = new Map<string, string>();
    const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const fetchMock = vi.fn().mockImplementation(freshNounGroupedResponse);
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore({ resolveOwnerBran: () => null });
    store.bindPersistence('A', local);
    await store.submitScenario();
    store.setAutoFollowSelection(true);
    store.branRangeDistance.value = '3000';

    const snapshot = store.captureSnapshot();
    expect(snapshot.autoFollowSelection).toBe(true);
    expect(snapshot.rangeDistanceMm).toBe(3000);

    // 旧快照缺两格：不抛错、按缺省读（false / '5000'）
    const legacy = { ...snapshot } as Record<string, unknown>;
    delete legacy.autoFollowSelection;
    delete legacy.rangeDistanceMm;
    store.prepareSnapshotRestore(legacy)();
    expect(store.autoFollowSelection.value).toBe(false);
    expect(store.branRangeDistance.value).toBe('5000');

    store.setAutoFollowSelection(true);
    store.branRangeDistance.value = '3000';
    store.prepareSnapshotRestore(snapshot)();
    expect(store.autoFollowSelection.value).toBe(true);
    expect(store.branRangeDistance.value).toBe('3000');
    // 恢复不触发查询：fetch 仍只有 submit 那一次
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 型不对的两格照样打回
    expect(() => store.prepareSnapshotRestore({ ...snapshot, autoFollowSelection: 'yes' })).toThrow('格式无效');
    expect(() => store.prepareSnapshotRestore({ ...snapshot, rangeDistanceMm: 0 })).toThrow('格式无效');
    store.dispose();
  });

  it('rejects missing precision metadata and keeps the original snapshot intact', async () => {
    const values = new Map<string, string>();
    const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = createSpatialComputeStore();
    store.bindPersistence('A', local);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(freshNounGroupedResponse));
    await store.submitScenario('branNearestClearance');
    store.detachPersistence();
    const key = 'plant3d-bran-clearance-v1:A';
    const broken = JSON.parse(values.get(key)!);
    broken.data.candidateProvenance['WALL:24381_1'] = {};
    const raw = JSON.stringify(broken);
    values.set(key, raw);
    store.bindPersistence('A', local);
    expect(store.persistenceError.value).toContain('精度');
    expect(store.persistRecords()).toBe(false);
    expect(values.get(key)).toBe(raw);
    store.dispose();
  });

  it.each(['wall', 'column', 'beam', 'slab'] as const)('queries the independent %s structure group and preserves warnings', async (category) => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ...nounGroupedResponse, warnings: ['unclassified sections'] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    store.currentScenarioState.value.structureCategory = category;
    store.currentScenarioState.value.structuralAngleDeg = '3';
    await store.submitScenario();
    const query = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost').searchParams;
    expect(query.get('group_by')).toBe('target_groups');
    expect(query.get('target_groups')).toBe(category);
    expect(query.get('structural_angle_deg')).toBe('3');
    expect(store.currentScenarioState.value.warnings).toEqual(['unclassified sections']);
  });

  const surfaceResponse = () => ({
    success: true, unit: 'mm', accuracy_class: 'exact-surface', error_bound_mm: 0.5, warnings: [],
    result: { distance_mm: 600, intersects: false, witness: 'closest-points',
      source_leaf_refno: '24381/145019', source_point: { x: 100, y: 0, z: 0 }, target_point: { x: 100, y: 600, z: 0 } },
  });

  it('refines using the queried source, updates both points and distance, and preserves the annotation key', async () => {
    const fetchMock = vi.fn().mockImplementationOnce(async () => freshNounGroupedResponse())
      .mockImplementationOnce(async () => new Response(JSON.stringify(surfaceResponse()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    await store.submitScenario();
    store.currentScenarioState.value.suppoRefno = 'changed_input';
    await store.refineBranCandidate('WALL:24381_1');
    const query = new URL(String(fetchMock.mock.calls[1]?.[0]), 'http://localhost').searchParams;
    expect(query.get('source_refno')).toBe('24381/145018');
    expect(query.get('target_kind')).toBe('any');
    expect(store.currentScenarioState.value.resultRows[0]).toMatchObject({ candidateKey: 'WALL:24381_1', distanceMm: 600, drawn: true });
    expect(store.currentScenarioState.value.resultRows[0]?.label).toContain('实体外表面净距');
    expect(store.currentScenarioState.value.annotationCandidates[0]).toMatchObject({
      provenance: { method: 'surface-to-surface', accuracyClass: 'exact-surface' },
      candidate: { annotation: { label_mm: 600, start_point: { x: 100, y: 0, z: 0 }, end_point: { x: 100, y: 600, z: 0 } } },
    });
    expect(store.currentScenarioState.value.refiningKeys).toEqual([]);
  });

  it.each(['placeholder', 'invalid-distance', 'invalid-point', 'too-large-error', 'no-result'])('retains estimates when refinement returns %s', async (reason) => {
    const response = surfaceResponse();
    if (reason === 'placeholder') response.result.witness = 'aabb-overlap-center';
    if (reason === 'invalid-distance') response.result.distance_mm = -1;
    if (reason === 'invalid-point') response.result.source_point.x = NaN;
    if (reason === 'too-large-error') response.error_bound_mm = 11;
    const data = reason === 'no-result' ? { ...response, result: null } : response;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(async () => freshNounGroupedResponse())
      .mockImplementationOnce(async () => new Response(JSON.stringify(data), { status: 200 })));
    const store = createSpatialComputeStore();
    await store.submitScenario();
    await store.refineBranCandidate('WALL:24381_1');
    expect(store.currentScenarioState.value.resultRows[0]?.distanceMm).toBe(1200.4);
    expect(store.currentScenarioState.value.candidateProvenance['WALL:24381_1']).toBeUndefined();
    expect(store.currentScenarioState.value.error).toContain('保留包围盒估算');
  });

  it('discards refinement after reset and prevents duplicate pair requests', async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(async () => freshNounGroupedResponse())
      .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    await store.submitScenario();
    const pending = store.refineBranCandidate('WALL:24381_1');
    await store.refineBranCandidate('WALL:24381_1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    store.resetScenario();
    resolve(new Response(JSON.stringify(surfaceResponse()), { status: 200 }));
    await pending;
    expect(store.currentScenarioState.value.resultRows).toEqual([]);
    expect(store.currentScenarioState.value.warnings).toEqual([]);
  });

  it('refine-all upgrades every drawn candidate, honoring the concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const refineCalls: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/nearest-clearance')) return freshNounGroupedResponse();
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      refineCalls.push(new URL(url, 'http://localhost').searchParams.get('target_refno') ?? '');
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return new Response(JSON.stringify(surfaceResponse()), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    await store.submitScenario();

    await store.refineAllDrawnCandidates(2);

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(refineCalls.sort()).toEqual(['24381/1', '24381/2', '24381/3'].sort());
    expect(store.refineAllProgress).toEqual({ done: 3, total: 3 });
    expect(store.refiningAll.value).toBe(false);
    for (const item of store.currentScenarioState.value.annotationCandidates) {
      expect(item.provenance?.method).toBe('surface-to-surface');
    }
  });

  it('refine-all skips already-refined candidates and a second run is a no-op', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes('/nearest-clearance')
        ? freshNounGroupedResponse()
        : new Response(JSON.stringify(surfaceResponse()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    await store.submitScenario();
    await store.refineBranCandidate('WALL:24381_1');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await store.refineAllDrawnCandidates();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(store.refineAllProgress).toEqual({ done: 2, total: 2 });

    await store.refineAllDrawnCandidates();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('refine-all stops the queue on cancel and on reset', async () => {
    for (const stop of ['cancel', 'reset'] as const) {
      const resolvers: (() => void)[] = [];
      const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) =>
        String(input).includes('/nearest-clearance')
          ? freshNounGroupedResponse()
          : new Promise<Response>((done) => { resolvers.push(() => done(new Response(JSON.stringify(surfaceResponse()), { status: 200 }))); }));
      vi.stubGlobal('fetch', fetchMock);
      const store = createSpatialComputeStore();
      await store.submitScenario();

      const pending = store.refineAllDrawnCandidates(1);
      while (resolvers.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      resolvers[0]!();
      if (stop === 'cancel') store.cancelRefineAllDrawn();
      else store.resetScenario();
      await pending;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(store.refineAllProgress.done).toBe(1);
      expect(store.refineAllProgress.total).toBe(3);
      expect(store.refiningAll.value).toBe(false);
      store.dispose();
    }
  });

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
        structural_angle_deg: '5',
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
        structural_angle_deg: '5',
        exclude_nouns: 'WELD,ATTA',
        radius: '1500',
        scope: 'all_loaded',
        max_per_group: '3',
        surface: 'true',
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

describe('useSpatialCompute 跟随选中自动计算（autoFollowSelection）', () => {
  /** createSpatialComputeStore 直连出来的 store 不走单例 reset，逐一 dispose 才不串用例。 */
  const createdStores: ReturnType<typeof createSpatialComputeStore>[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    resetSpatialComputeStore();
    createdStores.length = 0;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const store of createdStores.splice(0)) store.dispose();
    (await selectedRefnoProbe()).value = null;
    resetSpatialComputeStore();
  });

  function makeStore(options: Parameters<typeof createSpatialComputeStore>[0]) {
    const store = createSpatialComputeStore(options);
    createdStores.push(store);
    return store;
  }

  async function selectedRefnoProbe(): Promise<{ value: string | null }> {
    const module = await import('@/composables/useSelectionStore');
    return (module as unknown as { __selectedRefno: { value: string | null } }).__selectedRefno;
  }

  /** 每次调用新建 Response——同一个 body 只能消费一次。 */
  function stubAutoFetch() {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(autoResponse), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function autoCandidate(refno: string, noun: string, distance: number) {
    return {
      refno,
      noun,
      distance_mm: distance,
      intersects: false,
      nearest: {
        source_segment_refno: '24381_145001',
        source_segment_order: 1,
        source_point: { x: 0, y: 0, z: 0 },
        target_point: { x: 1, y: 0, z: 0 },
        vector: { dx: 1, dy: 0, dz: 0 },
      },
      annotation: { start_point: { x: 0, y: 0, z: 0 }, end_point: { x: 1, y: 0, z: 0 }, label_mm: distance },
    };
  }

  const autoResponse = {
    success: true,
    nearest_by_group: [
      { group: 'WALL', nouns: ['WALL'], candidates: [autoCandidate('24381_1', 'WALL', 1200)] },
      { group: 'SCTN', nouns: ['SCTN'], candidates: [autoCandidate('24381_3', 'SCTN', 830)] },
    ],
    noun_counts: { WALL: 1, SCTN: 1 },
    excluded_self_members: 0,
  };

  it('打开开关且当前选中是管件：解到所属 BRAN 立即查询，默认标注每类最近一条', async () => {
    const fetchMock = stubAutoFetch();
    const selected = await selectedRefnoProbe();
    selected.value = '24381_777';
    const store = makeStore({
      resolveOwnerBran: (refno) => (refno === '24381_777' ? '24381_145018' : null),
      autoFollowDebounceMs: 0,
    });

    store.setAutoFollowSelection(true);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/v1/spatial/nearest-clearance');
    expect(url.searchParams.get('source_refno')).toBe('24381/145018');
    const state = store.scenarios.branNearestClearance;
    expect(state.suppoRefno).toBe('24381_145018');
    expect(state.queriedSourceRefno).toBe('24381_145018');
    // 每类默认画最近 1 条 → annotationCandidates 各桶 1 条
    expect(state.drawnCandidateKeys).toEqual(['WALL:24381_1', 'SCTN:24381_3']);
    expect(state.annotationCandidates).toHaveLength(2);
  });

  it('开着开关时：同一根 BRAN 的构件不重复查，非 BRAN 不清结果，换 BRAN 才重查', async () => {
    const fetchMock = stubAutoFetch();
    const selected = await selectedRefnoProbe();
    const branOf: Record<string, string | null> = {
      pipe_a: '24381_145018',
      pipe_a2: '24381_145018',
      pipe_b: '24381_999999',
      wall_1: null,
    };
    const store = makeStore({
      resolveOwnerBran: (refno) => branOf[refno] ?? null,
      autoFollowDebounceMs: 0,
    });
    store.setAutoFollowSelection(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();

    selected.value = 'pipe_a';
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(store.scenarios.branNearestClearance.queriedSourceRefno).toBe('24381_145018');

    selected.value = 'pipe_a2';
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    selected.value = 'wall_1';
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.scenarios.branNearestClearance.resultRows.length).toBeGreaterThan(0);

    selected.value = 'pipe_b';
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const url = new URL(String(fetchMock.mock.calls[1]?.[0]), 'http://localhost');
    expect(url.searchParams.get('source_refno')).toBe('24381/999999');
    await vi.waitFor(() => expect(store.scenarios.branNearestClearance.queriedSourceRefno).toBe('24381_999999'));
  });

  it('关掉开关后选中 BRAN 不再自动查询', async () => {
    const fetchMock = stubAutoFetch();
    const selected = await selectedRefnoProbe();
    const store = makeStore({
      resolveOwnerBran: (refno) => (refno.startsWith('pipe') ? '24381_145018' : null),
      autoFollowDebounceMs: 0,
    });
    store.setAutoFollowSelection(true);
    selected.value = 'pipe_a';
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    store.setAutoFollowSelection(false);
    selected.value = 'pipe_b';
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * #63 之前这里还有两组 describe：三维点选写进 BRAN 结果（`recordInteractiveBranClearance` /
 * `recordBranParallelSpacing`）。那条收尾路径已退役——交互式管-管/管-结构净距改写 ClearanceStore
 * （`useDtxTools.objectMeasure.test.ts` 管着新的记录形状与整组替换语义），这些函数连同候选构造器一并摘除。
 */
