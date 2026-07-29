import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const dtxLoaderMocks = vi.hoisted(() => ({
  loadDtxAabbProxyRefnos: vi.fn(),
}));

const dbMetaMocks = vi.hoisted(() => ({
  ensureDbMetaInfoLoaded: vi.fn(async () => undefined),
  getDbnumByRefno: vi.fn(() => 7997),
}));

vi.mock('@/composables/useDbnoInstancesDtxLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useDbnoInstancesDtxLoader')>();
  return {
    ...actual,
    loadDtxAabbProxyRefnos: dtxLoaderMocks.loadDtxAabbProxyRefnos,
  };
});

vi.mock('@/composables/useDbMetaInfo', () => ({
  ensureDbMetaInfoLoaded: dbMetaMocks.ensureDbMetaInfoLoaded,
  getDbnumByRefno: dbMetaMocks.getDbnumByRefno,
  tryGetDbnumByRefno: dbMetaMocks.getDbnumByRefno,
}));

import {
  createSpatialQueryStore,
  initializeSpatialQueryFromUrl,
  parseSpatialQueryUrlParams,
} from './useSpatialQuery';

import type { SpatialQueryResult } from '@/api/genModelSpatialApi';

function createViewerStub() {
  const selected = new Set<string>();
  const visibility = new Map<string, boolean>([
    ['loaded_a', true],
    ['loaded_b', true],
  ]);
  const aabbMap = new Map<string, [number, number, number, number, number, number]>([
    ['loaded_a', [0, 0, 0, 10, 10, 10]],
    ['loaded_b', [200, 0, 0, 210, 10, 10]],
    ['server_only', [20, 0, 0, 30, 10, 10]],
  ]);

  return {
    scene: {
      objects: {
        loaded_a: { id: 'loaded_a', visible: true, aabb: aabbMap.get('loaded_a') },
        loaded_b: { id: 'loaded_b', visible: true, aabb: aabbMap.get('loaded_b') },
      } as Record<string, { id: string; visible: boolean; aabb?: [number, number, number, number, number, number] }>,
      objectIds: ['loaded_a', 'loaded_b'],
      getLoadedRefnos: () => ['loaded_a', 'loaded_b'],
      selectedObjectIds: ['loaded_a'],
      ensureRefnos: vi.fn(),
      setObjectsVisible: vi.fn((ids: string[], visible: boolean) => {
        ids.forEach((id) => visibility.set(id, visible));
      }),
      setObjectsSelected: vi.fn((ids: string[], value: boolean) => {
        ids.forEach((id) => {
          if (value) {
            selected.add(id);
          } else {
            selected.delete(id);
          }
        });
      }),
      setObjectsXRayed: vi.fn(),
      getAABB: vi.fn((ids: string[]) => {
        const first = ids[0];
        return first ? aabbMap.get(first) ?? null : null;
      }),
    },
    cameraFlight: {
      flyTo: vi.fn(),
    },
  } as any;
}

describe('createSpatialQueryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMetaMocks.ensureDbMetaInfoLoaded.mockResolvedValue(undefined);
    dbMetaMocks.getDbnumByRefno.mockReturnValue(7997);
    dtxLoaderMocks.loadDtxAabbProxyRefnos.mockImplementation((_layer, _dbno, entries) => ({
      loadedRefnos: entries.filter((entry: any) => !!entry.aabb).map((entry: any) => String(entry.refno)),
      missingRefnos: entries.filter((entry: any) => !entry.aabb).map((entry: any) => String(entry.refno)),
      loadedObjects: entries.filter((entry: any) => !!entry.aabb).length,
      skippedObjects: 0,
    }));
  });

  it('范围查询应合并本地已加载结果和服务端未加载结果', async () => {
    const viewer = createViewerStub();
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      truncated: false,
      total_count: 3,
      returned_count: 2,
      page: 1,
      per_page: 100,
      has_more: false,
      filter_options: {
        include_negative: false,
        nouns: [
          { value: 'PIPE', count: 1 },
          { value: 'EQUI', count: 1 },
        ],
        spec_values: [
          { value: 1, count: 1 },
          { value: 2, count: 1 },
        ],
      },
      results: [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, distance: 5 },
        { refno: 'server_only', noun: 'EQUI', spec_value: 2, distance: 18 },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
    });

    store.draft.mode = 'range';
    store.draft.centerSource = 'selected';
    store.draft.radius = 50;

    await store.submitQuery();

    expect(store.status.value).toBe('ready');
    expect(queryNearbyByPosition).toHaveBeenCalledWith(5, 5, 5, 50, expect.any(Object));
    expect(store.resultSet.value?.total).toBe(3);
    expect(store.resultSet.value?.returnedCount).toBe(2);
    expect(store.resultSet.value?.loadedCount).toBe(1);
    expect(store.resultSet.value?.unloadedCount).toBe(1);
    expect(store.resultSet.value?.items.map((item) => [item.refno, item.loaded])).toEqual([
      ['loaded_a', true],
      ['server_only', false],
    ]);
    expect(store.resultSet.value?.filterOptions).toEqual({
      includeNegative: false,
      nouns: [
        { value: 'PIPE', count: 1, isNegative: false },
        { value: 'EQUI', count: 1, isNegative: false },
      ],
      specValues: [
        { value: 1, count: 1, label: '管道系统' },
        { value: 2, count: 1, label: '电气系统' },
      ],
    });
  });

  it('范围查询应透传 specValues 并按专业过滤结果', async () => {
    const viewer = createViewerStub();
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      truncated: false,
      total_count: 2,
      returned_count: 2,
      page: 1,
      per_page: 100,
      has_more: false,
      results: [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, distance: 5 },
        { refno: 'server_only', noun: 'EQUI', spec_value: 2, distance: 18 },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
    });

    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;
    store.draft.specValues = [1];

    await store.submitQuery();

    expect(queryNearbyByPosition).toHaveBeenCalledWith(5, 5, 5, 50, expect.objectContaining({
      spec_values: '1',
      page: 1,
      per_page: 100,
    }));
    expect(queryNearbyByPosition.mock.calls[0]?.[4]).not.toHaveProperty('max_results');
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a']);
    expect(store.resultSet.value?.groups.map((group) => group.specValue)).toEqual([1]);
  });

  it('默认应隐藏服务端和本地负实体结果且向后端传 include_negative=false', async () => {
    const viewer = createViewerStub();
    viewer.scene.objects.loaded_neg = {
      id: 'loaded_neg',
      visible: true,
      aabb: [20, 0, 0, 30, 10, 10],
      noun: 'NBOX',
    } as any;
    viewer.scene.objectIds.push('loaded_neg');
    viewer.scene.getLoadedRefnos = () => ['loaded_a', 'loaded_neg'];
    viewer.scene.getAABB = vi.fn((ids: string[]) => {
      const first = ids[0];
      if (first === 'loaded_a') return [0, 0, 0, 10, 10, 10];
      if (first === 'loaded_neg') return [20, 0, 0, 30, 10, 10];
      return null;
    });
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      total_count: 3,
      returned_count: 3,
      page: 1,
      per_page: 100,
      has_more: false,
      results: [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, distance: 5 },
        { refno: 'loaded_neg', noun: 'NBOX', spec_value: 1, distance: 18 },
        { refno: 'server_neg', noun: 'NCYL', spec_value: 1, distance: 20 },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
    });

    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;

    await store.submitQuery();

    expect(queryNearbyByPosition.mock.calls[0]?.[4]).toEqual(expect.objectContaining({
      include_negative: false,
    }));
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a']);
    expect(store.resultSet.value?.request.filters.includeNegative).toBe(false);
  });

  it('开启负实体后应包含负实体结果并透传 include_negative', async () => {
    const viewer = createViewerStub();
    viewer.scene.objects.loaded_neg = {
      id: 'loaded_neg',
      visible: true,
      aabb: [20, 0, 0, 30, 10, 10],
      noun: 'NBOX',
    } as any;
    viewer.scene.objectIds.push('loaded_neg');
    viewer.scene.getLoadedRefnos = () => ['loaded_a', 'loaded_neg'];
    viewer.scene.getAABB = vi.fn((ids: string[]) => {
      const first = ids[0];
      if (first === 'loaded_a') return [0, 0, 0, 10, 10, 10];
      if (first === 'loaded_neg') return [20, 0, 0, 30, 10, 10];
      return null;
    });
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      total_count: 3,
      returned_count: 3,
      page: 1,
      per_page: 100,
      has_more: false,
      results: [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, distance: 5 },
        { refno: 'loaded_neg', noun: 'NBOX', spec_value: 1, distance: 18 },
        { refno: 'server_neg', noun: 'NCYL', spec_value: 1, distance: 20 },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
    });

    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;
    store.draft.includeNegative = true;

    await store.submitQuery();

    expect(queryNearbyByPosition.mock.calls[0]?.[4]).toEqual(expect.objectContaining({
      include_negative: true,
    }));
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual([
      'loaded_a',
      'loaded_neg',
      'server_neg',
    ]);
  });

  it('翻页查询应把 page 和 per_page 传给服务端并保留总数', async () => {
    const viewer = createViewerStub();
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      truncated: true,
      total_count: 25,
      returned_count: 1,
      page: 2,
      per_page: 20,
      has_more: false,
      results: [
        { refno: 'server_only', noun: 'EQUI', spec_value: 2, distance: 18 },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
    });

    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;
    store.draft.limit = 20;

    await store.submitQuery(2);

    expect(queryNearbyByPosition).toHaveBeenCalledWith(5, 5, 5, 50, expect.objectContaining({
      page: 2,
      per_page: 20,
    }));
    expect(queryNearbyByPosition.mock.calls[0]?.[4]).not.toHaveProperty('max_results');
    expect(store.resultSet.value?.page).toBe(2);
    expect(store.resultSet.value?.perPage).toBe(20);
    expect(store.resultSet.value?.total).toBe(25);
    expect(store.resultSet.value?.totalPages).toBe(2);
  });

  it('distance refno 查询应走 nearby refno 路径并保留服务端中心和元数据', async () => {
    const viewer = createViewerStub();
    const queryNearbyByPosition = vi.fn();
    const querySpatialIndex = vi.fn();
    const queryNearbyByRefno = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      center: {
        x: 100,
        y: 200,
        z: 300,
        source: 'world_transform',
        refno: 'loaded_a',
      },
      radius: 75,
      shape: 'cube',
      query_bbox: {
        min: { x: 25, y: 125, z: 225 },
        max: { x: 175, y: 275, z: 375 },
      },
      total_count: 12,
      returned_count: 1,
      page: 2,
      per_page: 10,
      has_more: true,
      truncated: true,
      truncated_candidates: true,
      truncated_results: false,
      candidate_count: 50,
      candidate_cap: 50,
      result_cap: 100,
      results: [
        {
          refno: 'server_only',
          noun: 'EQUI',
          spec_value: 2,
          distance: 18,
          aabb: {
            min: { x: 90, y: 190, z: 290 },
            max: { x: 110, y: 210, z: 310 },
          },
        },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
      queryNearbyByRefno,
      querySpatialIndex,
    });

    store.draft.mode = 'distance';
    store.draft.distanceCenterSource = 'refno';
    store.draft.refno = 'loaded_a';
    store.draft.radius = 75;
    store.draft.shape = 'cube';
    store.draft.nounText = 'EQUI';
    store.draft.specValues = [2];
    store.draft.limit = 10;

    await store.submitQuery(2);

    expect(queryNearbyByRefno).toHaveBeenCalledWith('loaded_a', 75, expect.objectContaining({
      include_self: false,
      nouns: 'EQUI',
      spec_values: '2',
      page: 2,
      per_page: 10,
      shape: 'cube',
      include_negative: false,
    }));
    expect(queryNearbyByRefno.mock.calls[0]?.[2]).not.toHaveProperty('max_results');
    expect(queryNearbyByPosition).not.toHaveBeenCalled();
    expect(querySpatialIndex).not.toHaveBeenCalled();
    expect(store.status.value).toBe('ready');
    expect(store.draft.center).toEqual({ x: 100, y: 200, z: 300 });
    expect(store.resultSet.value?.request.center).toEqual({ x: 100, y: 200, z: 300 });
    expect(store.resultSet.value?.center).toEqual({
      x: 100,
      y: 200,
      z: 300,
      source: 'world_transform',
      refno: 'loaded_a',
    });
    expect(store.resultSet.value?.queryBBox).toEqual({
      min: { x: 25, y: 125, z: 225 },
      max: { x: 175, y: 275, z: 375 },
    });
    expect(store.resultSet.value?.total).toBe(12);
    expect(store.resultSet.value?.returnedCount).toBe(1);
    expect(store.resultSet.value?.page).toBe(2);
    expect(store.resultSet.value?.perPage).toBe(10);
    expect(store.resultSet.value?.hasMore).toBe(true);
    expect(store.resultSet.value?.truncated).toBe(true);
    expect(store.resultSet.value?.truncatedCandidates).toBe(true);
    expect(store.resultSet.value?.truncatedResults).toBe(false);
    expect(store.resultSet.value?.candidateCount).toBe(50);
    expect(store.resultSet.value?.candidateCap).toBe(50);
    expect(store.resultSet.value?.resultCap).toBe(100);
    expect(store.resultSet.value?.items[0]).toMatchObject({
      refno: 'server_only',
      noun: 'EQUI',
      specValue: 2,
      distance: 18,
      bbox: {
        min: { x: 90, y: 190, z: 290 },
        max: { x: 110, y: 210, z: 310 },
      },
    });
    expect(store.resultSet.value?.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('更多结果'),
      expect.stringContaining('候选'),
    ]));
  });

  it('distance coordinate 查询应走 nearby 坐标路径且不调用 refno 或 legacy query', async () => {
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      center: {
        x: 10,
        y: 20,
        z: 30,
        source: 'point_input',
      },
      total_count: 0,
      returned_count: 0,
      page: 1,
      per_page: 25,
      has_more: false,
      results: [],
    }));
    const queryNearbyByRefno = vi.fn();
    const querySpatialIndex = vi.fn();

    const store = createSpatialQueryStore({
      viewerRef: { value: null },
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
      queryNearbyByRefno,
      querySpatialIndex,
    });

    store.draft.mode = 'distance';
    store.draft.distanceCenterSource = 'coordinates';
    store.draft.center = { x: 10, y: 20, z: 30 };
    store.draft.radius = 40;
    store.draft.limit = 25;

    await store.submitQuery();

    expect(queryNearbyByPosition).toHaveBeenCalledWith(10, 20, 30, 40, expect.objectContaining({
      page: 1,
      per_page: 25,
      shape: 'sphere',
      include_negative: false,
    }));
    expect(queryNearbyByPosition.mock.calls[0]?.[4]).not.toHaveProperty('max_results');
    expect(queryNearbyByRefno).not.toHaveBeenCalled();
    expect(querySpatialIndex).not.toHaveBeenCalled();
    expect(store.resultSet.value?.center).toEqual({
      x: 10,
      y: 20,
      z: 30,
      source: 'point_input',
    });
  });

  it('批量加载当前筛选结果时应走精确 refno 批量加载并刷新统计', async () => {
    const viewer = createViewerStub();
    const batchLoadRefnos = vi.fn(async (refnos: string[]) => ({
      ok: refnos,
      fail: [],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      batchLoadRefnos,
    });

    store.resultSet.value = {
      request: {
        mode: 'range',
        centerSource: 'coordinates',
        center: { x: 0, y: 0, z: 0 },
        radius: 100,
        shape: 'sphere',
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [] },
        limit: 100,
        sortBy: 'specThenDistance',
      },
      items: [
        {
          refno: 'loaded_a',
          noun: 'PIPE',
          specValue: 1,
          specName: '管道系统',
          distance: 5,
          loaded: true,
          visible: true,
          matchedBy: 'viewer-local',
        },
        {
          refno: 'server_only',
          noun: 'EQUI',
          specValue: 2,
          specName: '电气系统',
          distance: 20,
          loaded: false,
          visible: false,
          matchedBy: 'server-spatial-index',
        },
      ],
      page: 1,
      perPage: 100,
      returnedCount: 2,
      totalPages: 1,
      hasMore: false,
      total: 2,
      loadedCount: 1,
      unloadedCount: 1,
      truncated: false,
      warnings: [],
      groups: [],
    };

    await store.loadResults({ onlyUnloaded: true, flyTo: true });

    expect(batchLoadRefnos).toHaveBeenCalledWith(['server_only'], expect.objectContaining({ flyTo: true }));
    expect(store.resultSet.value?.loadedCount).toBe(2);
    expect(store.resultSet.value?.unloadedCount).toBe(0);
    expect(store.resultSet.value?.items.find((item) => item.refno === 'server_only')?.loaded).toBe(true);
    expect(store.resultSet.value?.items.find((item) => item.refno === 'server_only')?.visible).toBe(true);
  });

  it('批量加载失败但结果有服务端 AABB 时，应生成空间查询代理模型兜底显示', async () => {
    const viewer = createViewerStub();
    viewer.__dtxLayer = {};
    viewer.__dtxAfterInstancesLoaded = vi.fn();
    const batchLoadRefnos = vi.fn(async () => ({
      ok: [],
      fail: [{ refno: 'server_only', error: '加载模型失败' }],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      batchLoadRefnos,
    });

    store.resultSet.value = {
      request: {
        mode: 'distance',
        centerSource: 'coordinates',
        center: { x: 0, y: 0, z: 0 },
        radius: 100,
        shape: 'sphere',
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [] },
        limit: 100,
        sortBy: 'distanceAsc',
      },
      items: [
        {
          refno: 'server_only',
          noun: 'EQUI',
          specValue: 2,
          specName: '电气系统',
          distance: 20,
          loaded: false,
          visible: false,
          matchedBy: 'server-spatial-index',
          bbox: {
            min: { x: 20, y: 0, z: 0 },
            max: { x: 30, y: 10, z: 10 },
          },
        },
      ],
      page: 1,
      perPage: 100,
      returnedCount: 1,
      totalPages: 1,
      hasMore: false,
      total: 1,
      loadedCount: 0,
      unloadedCount: 1,
      truncated: false,
      warnings: [],
      groups: [],
    };

    await store.loadResults({ onlyUnloaded: true, flyTo: true });

    expect(batchLoadRefnos).toHaveBeenCalledWith(['server_only'], expect.objectContaining({ flyTo: true }));
    expect(dtxLoaderMocks.loadDtxAabbProxyRefnos).toHaveBeenCalledWith(
      viewer.__dtxLayer,
      7997,
      [expect.objectContaining({
        refno: 'server_only',
        noun: 'EQUI',
        specValue: 2,
      })],
    );
    expect(viewer.__dtxAfterInstancesLoaded).toHaveBeenCalledWith(7997, ['server_only']);
    expect(store.error.value).toBeNull();
    expect(store.resultSet.value?.loadedCount).toBe(1);
    expect(store.resultSet.value?.unloadedCount).toBe(0);
    expect(store.resultSet.value?.items[0]?.loaded).toBe(true);
    expect(store.resultSet.value?.items[0]?.visible).toBe(true);
  });

  it('批量加载返回 ok 但 viewer 中没有可绘制对象时，应改用 AABB 代理模型兜底显示', async () => {
    const viewer = createViewerStub();
    viewer.__dtxLayer = {};
    viewer.__dtxAfterInstancesLoaded = vi.fn();
    viewer.scene.getAABB = vi.fn(() => null);
    delete viewer.scene.objects.server_only;

    const batchLoadRefnos = vi.fn(async () => ({
      ok: ['server_only'],
      fail: [],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      batchLoadRefnos,
    });

    store.resultSet.value = {
      request: {
        mode: 'distance',
        centerSource: 'coordinates',
        center: { x: 0, y: 0, z: 0 },
        radius: 100,
        shape: 'sphere',
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [] },
        limit: 100,
        sortBy: 'distanceAsc',
      },
      items: [
        {
          refno: 'server_only',
          noun: 'EQUI',
          specValue: 2,
          specName: '电气系统',
          distance: 20,
          loaded: false,
          visible: false,
          matchedBy: 'server-spatial-index',
          bbox: {
            min: { x: 20, y: 0, z: 0 },
            max: { x: 30, y: 10, z: 10 },
          },
        },
      ],
      page: 1,
      perPage: 100,
      returnedCount: 1,
      totalPages: 1,
      hasMore: false,
      total: 1,
      loadedCount: 0,
      unloadedCount: 1,
      truncated: false,
      warnings: [],
      groups: [],
    };

    await store.loadResults({ onlyUnloaded: true });

    expect(batchLoadRefnos).toHaveBeenCalledWith(['server_only'], expect.objectContaining({ flyTo: undefined }));
    expect(dtxLoaderMocks.loadDtxAabbProxyRefnos).toHaveBeenCalledWith(
      viewer.__dtxLayer,
      7997,
      [expect.objectContaining({
        refno: 'server_only',
        noun: 'EQUI',
        specValue: 2,
      })],
    );
    expect(store.error.value).toBeNull();
    expect(store.resultSet.value?.loadedCount).toBe(1);
    expect(store.resultSet.value?.unloadedCount).toBe(0);
    expect(store.resultSet.value?.items[0]?.loaded).toBe(true);
    expect(store.resultSet.value?.items[0]?.visible).toBe(true);
  });

  it('点击未加载结果时应先请求加载，再飞行并选中', async () => {
    const viewer = createViewerStub();
    const requestId = 'req-1';
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      createRequestId: () => requestId,
    });

    store.resultSet.value = {
      request: {
        mode: 'distance',
        centerSource: 'coordinates',
        center: { x: 0, y: 0, z: 0 },
        radius: 100,
        shape: 'sphere',
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [] },
        limit: 100,
        sortBy: 'distanceAsc',
      },
      items: [
        {
          refno: 'server_only',
          noun: 'EQUI',
          specValue: 2,
          specName: '电气系统',
          distance: 20,
          loaded: false,
          visible: true,
          matchedBy: 'server-spatial-index',
        },
      ],
      page: 1,
      perPage: 100,
      returnedCount: 1,
      totalPages: 1,
      hasMore: false,
      total: 1,
      loadedCount: 0,
      unloadedCount: 1,
      truncated: false,
      warnings: [],
      groups: [],
    };

    const activation = store.activateResult(store.resultSet.value.items[0]!);
    await vi.waitFor(() => {
      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'showModelByRefnos',
        detail: expect.objectContaining({
          refnos: ['server_only'],
          requestId,
        }),
      }));
      expect(addEventListenerSpy).toHaveBeenCalledWith('showModelByRefnosDone', expect.any(Function));
    });

    const listener = addEventListenerSpy.mock.calls.find(([eventName]) => eventName === 'showModelByRefnosDone')?.[1] as EventListener;
    expect(listener).toBeTruthy();

    viewer.scene.objects.server_only = { id: 'server_only', visible: true, aabb: [20, 0, 0, 30, 10, 10] };
    viewer.scene.objectIds.push('server_only');

    listener(new CustomEvent('showModelByRefnosDone', {
      detail: {
        requestId,
        ok: ['server_only'],
        fail: [],
        error: null,
      },
    }));

    await activation;
    await nextTick();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('showModelByRefnosDone', listener);
    expect(viewer.scene.setObjectsSelected).toHaveBeenCalledWith(['server_only'], true);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalled();
    expect(store.resultSet.value.items[0]?.loaded).toBe(true);
    expect(store.activeResultRefno.value).toBe('server_only');
  });

  it('显示/隐藏、隔离和恢复动作应作用于当前返回 refno 且不清空结果集', () => {
    const viewer = createViewerStub();
    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
    });

    store.resultSet.value = {
      request: {
        mode: 'distance',
        centerSource: 'coordinates',
        center: { x: 0, y: 0, z: 0 },
        radius: 100,
        shape: 'sphere',
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [] },
        limit: 100,
        sortBy: 'distanceAsc',
      },
      items: [
        {
          refno: 'loaded_a',
          noun: 'PIPE',
          specValue: 1,
          specName: '管道系统',
          distance: 5,
          loaded: true,
          visible: true,
          matchedBy: 'viewer-local',
        },
        {
          refno: 'server_only',
          noun: 'EQUI',
          specValue: 2,
          specName: '电气系统',
          distance: 20,
          loaded: false,
          visible: false,
          matchedBy: 'server-spatial-index',
        },
      ],
      page: 1,
      perPage: 100,
      returnedCount: 2,
      totalPages: 1,
      hasMore: false,
      total: 2,
      loadedCount: 1,
      unloadedCount: 1,
      truncated: false,
      warnings: [],
      groups: [],
    };

    store.setAllResultsVisible(false);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['loaded_a', 'server_only'], false);
    expect(store.resultSet.value?.items.map((item) => item.visible)).toEqual([false, false]);

    store.setAllResultsVisible(true);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['loaded_a', 'server_only'], true);
    expect(store.resultSet.value?.items.map((item) => item.visible)).toEqual([true, true]);

    store.toggleResultVisible(store.resultSet.value.items[0]!);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['loaded_a'], false);
    expect(store.resultSet.value?.items[0]?.visible).toBe(false);

    store.isolateResults();
    expect(viewer.scene.setObjectsXRayed).toHaveBeenCalledWith(['loaded_a', 'loaded_b'], true);
    expect(viewer.scene.setObjectsXRayed).toHaveBeenCalledWith(['loaded_a', 'server_only'], false);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['loaded_a', 'server_only'], true);
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a', 'server_only']);

    store.restoreScene();
    expect(viewer.scene.setObjectsXRayed).toHaveBeenCalledWith(['loaded_a', 'loaded_b'], false);
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a', 'server_only']);
  });

  it('解析 spatial URL 参数并初始化抽屉草稿，autorun 只透传一次', () => {
    const parsed = parseSpatialQueryUrlParams('?spatial_refno=24381/145019&spatial_radius=1000&spatial_shape=cube&spatial_autorun=1');
    expect(parsed).toEqual({
      refno: '24381_145019',
      radius: 1000,
      shape: 'cube',
      autorun: true,
    });

    const store = {
      draft: {
        mode: 'range',
        rangeCenterSource: 'selected',
        distanceCenterSource: 'coordinates',
        refno: '',
        center: { x: 9, y: 8, z: 7 },
        radius: 10,
        shape: 'sphere',
        nounText: 'PIPE',
        keyword: 'old',
        onlyLoaded: true,
        onlyVisible: true,
        includeNegative: false,
        specValues: [1],
        limit: 5,
      },
      resetQuery: vi.fn(),
      setMode: vi.fn((mode: 'range' | 'distance') => {
        store.draft.mode = mode;
      }),
      submitQuery: vi.fn(),
    };
    const openDrawer = vi.fn((_mode: 'range' | 'distance', options?: { autoSubmit?: boolean }) => {
      if (options?.autoSubmit) {
        store.submitQuery(1);
      }
    });

    const applied = initializeSpatialQueryFromUrl(
      '?spatial_refno=24381/145019&spatial_radius=1000&spatial_shape=cube&spatial_autorun=1',
      store,
      openDrawer,
    );

    expect(applied).toBe(true);
    expect(store.resetQuery).toHaveBeenCalledTimes(1);
    expect(store.setMode).toHaveBeenCalledWith('distance');
    expect(store.draft.mode).toBe('distance');
    expect(store.draft.distanceCenterSource).toBe('refno');
    expect(store.draft.refno).toBe('24381_145019');
    expect(store.draft.radius).toBe(1000);
    expect(store.draft.shape).toBe('cube');
    expect(openDrawer).toHaveBeenCalledWith('distance', {
      useSelection: false,
      autoSubmit: true,
    });
    expect(store.submitQuery).toHaveBeenCalledTimes(1);
    expect(store.submitQuery).toHaveBeenCalledWith(1);
  });

  it('spatial URL 显式使用 m 单位时应转换为内部 mm 半径', () => {
    const parsed = parseSpatialQueryUrlParams('?spatial_refno=24381/145019&spatial_radius=5&spatial_radius_unit=m&spatial_shape=sphere');
    expect(parsed).toEqual({
      refno: '24381_145019',
      radius: 5000,
      shape: 'sphere',
      autorun: false,
    });
  });

  it('spatial URL 没有 autorun 时只打开并填充，不触发查询', () => {
    const store = {
      draft: {
        mode: 'distance',
        rangeCenterSource: 'selected',
        distanceCenterSource: 'coordinates',
        refno: '',
        center: { x: 0, y: 0, z: 0 },
        radius: 10,
        shape: 'sphere',
        nounText: '',
        keyword: '',
        onlyLoaded: false,
        onlyVisible: false,
        includeNegative: false,
        specValues: [],
        limit: 100,
      },
      resetQuery: vi.fn(),
      setMode: vi.fn((mode: 'range' | 'distance') => {
        store.draft.mode = mode;
      }),
      submitQuery: vi.fn(),
    };
    const openDrawer = vi.fn();

    const applied = initializeSpatialQueryFromUrl(
      '?spatial_refno=24381_145019&spatial_radius=1000&spatial_shape=sphere',
      store,
      openDrawer,
    );

    expect(applied).toBe(true);
    expect(store.draft.refno).toBe('24381_145019');
    expect(store.draft.radius).toBe(1000);
    expect(openDrawer).toHaveBeenCalledWith('distance', {
      useSelection: false,
      autoSubmit: false,
    });
    expect(store.submitQuery).not.toHaveBeenCalled();
  });
});
