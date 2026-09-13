import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { Matrix4 } from 'three';

const dtxLoaderMocks = vi.hoisted(() => ({
  loadDtxAabbProxyRefnos: vi.fn(),
}));

const dbMetaMocks = vi.hoisted(() => ({
  ensureDbMetaInfoLoaded: vi.fn(async () => undefined),
  getDbnumByRefno: vi.fn(() => 7997),
}));

/** 不注入取数函数时 store 走 `getModelSource().spatial`；缺省实现回「没有」，与改前真 fetch 打不通的效果一致。 */
const spatialSourceMocks = vi.hoisted(() => ({
  nearby: vi.fn(async (_params: SpatialNearbyParams): Promise<SpatialNearbyResult> => ({
    success: false,
    error: 'spatial source not mocked',
  })),
  nearbyRefnos: vi.fn(async (_params: SpatialNearbyParams): Promise<SpatialNearbyRefnosResult> => ({
    success: false,
    refnos: [],
    by_dbnum: {},
    by_spec_value: {},
    total_count: 0,
    truncated: false,
    cap: 0,
  })),
  negativeNouns: vi.fn(async (): Promise<NegativeNounsResult> => ({ success: false, nouns: [] })),
  /** 当前「数据源」：缺省 legacy（有专业维度）；v1 用例翻成 gen-model-v1 / specValues=false */
  state: { kind: 'legacy' as 'legacy' | 'gen-model-v1', specValues: true },
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    kind: spatialSourceMocks.state.kind,
    spatial: {
      nearby: spatialSourceMocks.nearby,
      nearbyRefnos: spatialSourceMocks.nearbyRefnos,
      negativeNouns: spatialSourceMocks.negativeNouns,
      capabilities: { specValues: spatialSourceMocks.state.specValues },
    },
  }),
}));

const batchLoadDeps = vi.hoisted(() => ({
  loadDbnoInstancesForVisibleRefnosDtx: vi.fn(async (_layer: unknown, _dbno: number, refnos: string[], _options?: Record<string, unknown>) => ({
    loadedRefnos: refnos,
    missingRefnos: [] as string[],
  })),
  isParquetAvailable: vi.fn(async () => false),
  triggerBatchGenerateSse: vi.fn(async () => ({ failedRefnos: [] as string[] })),
}));

vi.mock('@/composables/useDbnoInstancesDtxLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useDbnoInstancesDtxLoader')>();
  return {
    ...actual,
    loadDtxAabbProxyRefnos: dtxLoaderMocks.loadDtxAabbProxyRefnos,
    loadDbnoInstancesForVisibleRefnosDtx: batchLoadDeps.loadDbnoInstancesForVisibleRefnosDtx,
  };
});

vi.mock('@/composables/useDbnoInstancesParquetLoader', () => ({
  useDbnoInstancesParquetLoader: () => ({ isParquetAvailable: batchLoadDeps.isParquetAvailable }),
}));

vi.mock('@/api/genModelStreamGenerateApi', () => ({
  triggerBatchGenerateSse: batchLoadDeps.triggerBatchGenerateSse,
}));

vi.mock('@/composables/useDbMetaInfo', () => ({
  ensureDbMetaInfoLoaded: dbMetaMocks.ensureDbMetaInfoLoaded,
  getDbnumByRefno: dbMetaMocks.getDbnumByRefno,
  tryGetDbnumByRefno: dbMetaMocks.getDbnumByRefno,
}));

import {
  __resetNegativeNounRegistryForTests,
  createSpatialQueryStore,
  initializeSpatialQueryFromUrl,
  parseSpatialQueryUrlParams,
  resolveSceneWorldTransform,
} from './useSpatialQuery';

import type {
  NegativeNounsResult,
  SpatialNearbyParams,
  SpatialNearbyRefnosResult,
  SpatialNearbyResult,
  SpatialQueryResult,
} from '@/api/genModelSpatialApi';

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
    __resetNegativeNounRegistryForTests();
    spatialSourceMocks.state.kind = 'legacy';
    spatialSourceMocks.state.specValues = true;
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

  it('应向服务端透传 sort/keyword，并使用服务端全量分组计数与顺序', async () => {
    const viewer = createViewerStub();
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      truncated: false,
      total_count: 5,
      returned_count: 2,
      page: 1,
      per_page: 2,
      has_more: true,
      // 服务端已按 sort 在分页前排好序：这里故意让专业不是升序
      results: [
        { refno: 'server_only', noun: 'EQUI', spec_value: 2, name: 'Z-VESSEL', distance: 18 },
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, name: 'A-LINE', distance: 5 },
      ],
      groups: [
        { spec_value: 1, count: 3 },
        { spec_value: 2, count: 2 },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
    });

    store.draft.mode = 'range';
    store.draft.radius = 50;
    store.draft.keyword = 'line';
    store.draft.limit = 2;

    await store.submitQuery();

    // range 模式的排序口径是「先专业后距离」
    expect(queryNearbyByPosition).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      50,
      expect.objectContaining({ sort: 'spec_distance', keyword: 'line' }),
    );

    // 顺序沿用服务端返回的顺序，前端不再重排
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual([
      'server_only',
      'loaded_a',
    ]);
    expect(store.resultSet.value?.items.map((item) => item.name)).toEqual([
      'Z-VESSEL',
      'A-LINE',
    ]);

    // 分组小计取全量命中计数，而不是当前页的 1 条
    expect(store.resultSet.value?.groups.map((group) => [group.specValue, group.count])).toEqual([
      [1, 3],
      [2, 2],
    ]);
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
      // 负实体清单以服务端为唯一事实源，测试里注入桩数据
      fetchNegativeNouns: async () => ({ success: true, nouns: ['NBOX', 'NCYL'] }),
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
      fetchNegativeNouns: async () => ({ success: true, nouns: ['NBOX', 'NCYL'] }),
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

  it('负实体清单端点不可用时，应从 filter_options.is_negative 增量学习', async () => {
    const viewer = createViewerStub();
    viewer.scene.objects.loaded_negx = {
      id: 'loaded_negx',
      visible: true,
      aabb: [20, 0, 0, 30, 10, 10],
      noun: 'NNEW',
    } as any;
    viewer.scene.objectIds.push('loaded_negx');
    viewer.scene.getLoadedRefnos = () => ['loaded_a', 'loaded_negx'];
    viewer.scene.getAABB = vi.fn((ids: string[]) => {
      const first = ids[0];
      if (first === 'loaded_a') return [0, 0, 0, 10, 10, 10];
      if (first === 'loaded_negx') return [20, 0, 0, 30, 10, 10];
      return null;
    });
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      total_count: 2,
      returned_count: 2,
      page: 1,
      per_page: 100,
      has_more: false,
      filter_options: {
        include_negative: true,
        nouns: [
          { value: 'PIPE', count: 1 },
          { value: 'NNEW', count: 1, is_negative: true },
        ],
        spec_values: [{ value: 1, count: 2 }],
      },
      results: [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, distance: 5 },
        { refno: 'loaded_negx', noun: 'NNEW', spec_value: 1, distance: 18 },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
      fetchNegativeNouns: async () => {
        throw new Error('端点不可用');
      },
    });

    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;

    // 第一轮：开启负实体，响应的 filter_options 标记 NNEW 为负实体，注册表借此学习
    store.draft.includeNegative = true;
    await store.submitQuery();
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual([
      'loaded_a',
      'loaded_negx',
    ]);

    // 第二轮：关闭负实体；即便清单端点不可用，NNEW 已被学习并过滤
    store.draft.includeNegative = false;
    await store.submitQuery();
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a']);
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

  it('不注入取数函数时，四个取数点都经 getModelSource().spatial：nearby / nearbyRefnos / negativeNouns', async () => {
    const viewer = createViewerStub();
    spatialSourceMocks.negativeNouns.mockResolvedValueOnce({ success: true, nouns: ['NBOX'] });
    spatialSourceMocks.nearby.mockResolvedValueOnce({
      success: true,
      total_count: 3,
      returned_count: 2,
      page: 1,
      per_page: 2,
      has_more: true,
      results: [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, distance: 5 },
        { refno: 'server_only', noun: 'EQUI', spec_value: 2, distance: 18 },
      ],
    } satisfies SpatialQueryResult);
    spatialSourceMocks.nearbyRefnos.mockResolvedValueOnce({
      success: true,
      refnos: ['loaded_a', 'server_only', 'server_page2'],
      by_dbnum: { '7997': ['loaded_a', 'server_only', 'server_page2'] },
      by_spec_value: {},
      total_count: 3,
      truncated: false,
      cap: 100000,
    });

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
    });

    // 范围查询（点模式）：nearby 收到的是 queryNearbyByPosition 便捷函数展开后的同一份参数
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;
    store.draft.limit = 2;
    await store.submitQuery();

    expect(store.status.value).toBe('ready');
    expect(spatialSourceMocks.negativeNouns).toHaveBeenCalledTimes(1);
    expect(spatialSourceMocks.nearby).toHaveBeenCalledTimes(1);
    expect(spatialSourceMocks.nearby).toHaveBeenCalledWith(expect.objectContaining({
      x: 5,
      y: 5,
      z: 5,
      radius: 50,
      page: 1,
      per_page: 2,
      shape: 'sphere',
      include_negative: false,
    }));
    expect(spatialSourceMocks.nearby.mock.calls[0]?.[0]).not.toHaveProperty('refno');
    // 有下一页才取全集，且全集经 nearbyRefnos 而不是再打一次 nearby
    expect(spatialSourceMocks.nearbyRefnos).toHaveBeenCalledTimes(1);
    expect(spatialSourceMocks.nearbyRefnos).toHaveBeenCalledWith(expect.objectContaining({ x: 5, y: 5, z: 5, radius: 50 }));
    expect(store.resultSet.value?.fullMatches?.refnos).toEqual(['loaded_a', 'server_only', 'server_page2']);
    expect(store.resultSet.value?.fullMatches?.byDbnum).toEqual({ '7997': ['loaded_a', 'server_only', 'server_page2'] });

    // 距离查询（refno 模式）：同一个 nearby，参数带 refno 与 include_self
    spatialSourceMocks.nearby.mockResolvedValueOnce({
      success: true,
      center: { x: 1, y: 2, z: 3, source: 'refno_aabb_center' },
      total_count: 0,
      returned_count: 0,
      page: 1,
      per_page: 2,
      has_more: false,
      results: [],
    } satisfies SpatialQueryResult);
    store.draft.mode = 'distance';
    store.draft.distanceCenterSource = 'refno';
    store.draft.refno = '24381_145018';
    store.draft.radius = 800;
    await store.submitQuery();

    expect(spatialSourceMocks.nearby).toHaveBeenCalledTimes(2);
    expect(spatialSourceMocks.nearby.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      refno: '24381_145018',
      radius: 800,
      include_self: false,
      page: 1,
      per_page: 2,
    }));
    expect(spatialSourceMocks.nearby.mock.calls[1]?.[0]).not.toHaveProperty('x');
    // 负实体清单只拉一次，第二次查询不再打
    expect(spatialSourceMocks.negativeNouns).toHaveBeenCalledTimes(1);
    // 没有下一页就不取全集
    expect(spatialSourceMocks.nearbyRefnos).toHaveBeenCalledTimes(1);
  });

  it('gen-model-v1：结果带 dbnum / dbnum_groups / coverage 进结果集；范围查询默认排序退到按距离；按库分组的批量作用域与「仅显示本库」', async () => {
    spatialSourceMocks.state.kind = 'gen-model-v1';
    spatialSourceMocks.state.specValues = false;
    const viewer = createViewerStub();
    spatialSourceMocks.nearby.mockResolvedValueOnce({
      success: true,
      total_count: 3,
      returned_count: 3,
      page: 1,
      per_page: 100,
      has_more: false,
      results: [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 0, dbnum: 24381, distance: 5 },
        { refno: 'server_only', noun: 'EQUI', spec_value: 0, dbnum: 24383, distance: 18 },
        { refno: 'server_b', noun: 'BRAN', spec_value: 0, dbnum: 24381, distance: 30 },
      ],
      dbnum_groups: [{ dbnum: 24381, count: 2 }, { dbnum: 24383, count: 1 }],
      coverage: 'global-tree',
      spatial_state: 'ready',
    } satisfies SpatialQueryResult);
    const batchLoadRefnos = vi.fn(
      async (refnos: string[], _options?: { flyTo?: boolean; dbnumByRefno?: ReadonlyMap<string, number> }) => ({ ok: refnos, fail: [] }),
    );

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      batchLoadRefnos,
    });

    expect(store.spatialCapabilities.value).toEqual({ specValues: false });
    store.draft.mode = 'range';
    // legacy 下范围查询默认「按专业」；v1 没有专业维度，退到由近及远
    expect(store.draft.sortBy).toBe('distanceAsc');
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;
    await store.submitQuery();

    expect(store.status.value).toBe('ready');
    expect(store.resultSet.value?.items.map((item) => [item.refno, item.dbnum])).toEqual([
      ['loaded_a', 24381],
      ['server_only', 24383],
      ['server_b', 24381],
    ]);
    expect(store.resultSet.value?.dbnumGroups).toEqual([{ dbnum: 24381, count: 2 }, { dbnum: 24383, count: 1 }]);
    expect(store.resultSet.value?.coverage).toBe('global-tree');
    // 没有专业维度：本地分组只剩 spec 0 一组，计数仍是全量
    expect(store.resultSet.value?.groups.map((group) => [group.specValue, group.count])).toEqual([[0, 3]]);

    // 按库加载：只取该库的 refno，并把结果自带的 dbnum 作为分桶提示交给批量加载
    await store.loadResults({ dbnum: 24381, flyTo: false });
    expect(batchLoadRefnos).toHaveBeenCalledTimes(1);
    const [refnos, loadOptions] = batchLoadRefnos.mock.calls[0]!;
    expect(refnos).toEqual(['loaded_a', 'server_b']);
    expect(Array.from(loadOptions?.dbnumByRefno?.entries() ?? [])).toEqual([
      ['loaded_a', 24381],
      ['server_b', 24381],
    ]);

    // 仅显示本库：显示该库、隐藏其余，条目 visible 同步
    viewer.scene.setObjectsVisible.mockClear();
    store.showOnlyDbnumGroup(24383);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['server_only'], true);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['loaded_a', 'server_b'], false);
    expect(store.resultSet.value?.items.map((item) => [item.refno, item.visible])).toEqual([
      ['loaded_a', false],
      ['server_only', true],
      ['server_b', false],
    ]);
  });

  it('gen-model-v1：缺省批量加载跳过 parquet 与旧后端 SSE 生成，按结果自带 dbnum 分桶直接走 backend 加载', async () => {
    spatialSourceMocks.state.kind = 'gen-model-v1';
    spatialSourceMocks.state.specValues = false;
    const viewer = createViewerStub();
    viewer.__dtxLayer = { id: 'dtx' };
    spatialSourceMocks.nearby.mockResolvedValueOnce({
      success: true,
      total_count: 2,
      returned_count: 2,
      page: 1,
      per_page: 100,
      has_more: false,
      results: [
        { refno: 'server_only', noun: 'EQUI', spec_value: 0, dbnum: 24383, distance: 18, aabb: { min: { x: 20, y: 0, z: 0 }, max: { x: 30, y: 10, z: 10 } } },
        { refno: 'server_b', noun: 'BRAN', spec_value: 0, dbnum: 24381, distance: 30, aabb: { min: { x: 40, y: 0, z: 0 }, max: { x: 50, y: 10, z: 10 } } },
      ],
    } satisfies SpatialQueryResult);
    // 批量加载后 viewer 里要能看到这两个对象，否则会走 AABB 代理兜底
    batchLoadDeps.loadDbnoInstancesForVisibleRefnosDtx.mockImplementation(async (_layer, _dbno, refnos, _options) => {
      for (const refno of refnos) {
        viewer.scene.objects[refno] = { id: refno, visible: true, aabb: [0, 0, 0, 1, 1, 1] };
        viewer.scene.objectIds.push(refno);
      }
      return { loadedRefnos: refnos, missingRefnos: [] };
    });

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
    });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;
    await store.submitQuery();
    expect(store.status.value).toBe('ready');

    dbMetaMocks.getDbnumByRefno.mockClear();
    await store.loadResults({ onlyUnloaded: true, flyTo: false });

    expect(store.status.value).toBe('ready');
    expect(store.error.value).toBeNull();
    // 按服务端给的 dbnum 分桶，不再逐个查库号
    expect(dbMetaMocks.getDbnumByRefno).not.toHaveBeenCalled();
    const calls = batchLoadDeps.loadDbnoInstancesForVisibleRefnosDtx.mock.calls.map((call) => [call[1], call[2]]);
    expect(calls).toEqual(expect.arrayContaining([[24383, ['server_only']], [24381, ['server_b']]]));
    expect(calls).toHaveLength(2);
    expect(batchLoadDeps.loadDbnoInstancesForVisibleRefnosDtx.mock.calls[0]![3]).toEqual(expect.objectContaining({ dataSource: 'backend' }));
    // v1 下没有 parquet，也不再起旧后端的 SSE 批量生成
    expect(batchLoadDeps.isParquetAvailable).not.toHaveBeenCalled();
    expect(batchLoadDeps.triggerBatchGenerateSse).not.toHaveBeenCalled();
    expect(store.resultSet.value?.items.map((item) => [item.refno, item.loaded])).toEqual([
      ['server_only', true],
      ['server_b', true],
    ]);
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

  it('「加载当前页」（pages: current）只取当前页列出的条目；「只加载未加载」与缺省 pages 的批量作用域仍是整个命中集合', async () => {
    const viewer = createViewerStub();
    const batchLoadRefnos = vi.fn(async (refnos: string[]) => ({ ok: refnos, fail: [] }));

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      batchLoadRefnos,
    });

    // 第 1 页 2 条，全集 4 条（另两条在第 2 页）
    store.resultSet.value = {
      request: {
        mode: 'range',
        centerSource: 'coordinates',
        center: { x: 0, y: 0, z: 0 },
        radius: 100,
        shape: 'sphere',
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [] },
        limit: 2,
        sortBy: 'distanceAsc',
      },
      items: [
        { refno: 'loaded_a', noun: 'PIPE', specValue: 0, specName: '未知', dbnum: 7997, distance: 5, loaded: true, visible: true, matchedBy: 'merged' },
        { refno: 'server_only', noun: 'EQUI', specValue: 0, specName: '未知', dbnum: 7997, distance: 20, loaded: false, visible: false, matchedBy: 'server-spatial-index' },
      ],
      fullMatches: {
        refnos: ['loaded_a', 'server_only', 'server_page2_a', 'server_page2_b'],
        byDbnum: { '7997': ['loaded_a', 'server_only', 'server_page2_a', 'server_page2_b'] },
        bySpecValue: {},
        total: 4,
        truncated: false,
      },
      page: 1,
      perPage: 2,
      returnedCount: 2,
      totalPages: 2,
      hasMore: true,
      total: 4,
      loadedCount: 1,
      unloadedCount: 1,
      truncated: true,
      warnings: [],
      groups: [],
    };

    // countLoadTargets 与 loadResults 同一套取法：抽屉靠它在大批量前弹确认并显示数量
    expect(store.countLoadTargets({ pages: 'current', flyTo: true })).toBe(2);
    expect(store.countLoadTargets({ onlyUnloaded: true, flyTo: true })).toBe(3);
    expect(store.countLoadTargets({ dbnum: 7997, flyTo: true })).toBe(4);
    expect(store.countLoadTargets()).toBe(4);
    expect(batchLoadRefnos).not.toHaveBeenCalled();

    // 加载当前页：本页两条，第 2 页的不碰（改前这里拿到的是 fullMatches 的 4 条）
    await store.loadResults({ pages: 'current', flyTo: true });
    expect(batchLoadRefnos).toHaveBeenLastCalledWith(['loaded_a', 'server_only'], expect.objectContaining({ flyTo: true }));
    expect(store.resultSet.value?.loadedCount).toBe(2);
    expect(store.resultSet.value?.unloadedCount).toBe(0);
    expect(store.error.value).toBeNull();

    // 只加载未加载（缺省 pages）：整个命中集合里还没加载的——本页刚加载完，剩第 2 页两条
    await store.loadResults({ onlyUnloaded: true, flyTo: false });
    expect(batchLoadRefnos).toHaveBeenLastCalledWith(['server_page2_a', 'server_page2_b'], expect.objectContaining({ flyTo: false }));

    // 不指定 pages 也不限未加载（分组按钮 / 全部显示那一路）：整个命中集合
    await store.loadResults({ flyTo: false });
    expect(batchLoadRefnos).toHaveBeenLastCalledWith(
      ['loaded_a', 'server_only', 'server_page2_a', 'server_page2_b'],
      expect.objectContaining({ flyTo: false }),
    );
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

/**
 * DTX 缺省全局矩阵 = 0.001 缩放 + 重心化（`applyDtxGlobalTransformOnce`）：场景坐标是「米、已平移」，
 * 服务端与 `draft.center` 是 E3D mm。这里用 t=(-1,-2,-3) 模拟：mm 盒 [0,0,0,10,10,10] 在场景里是 [-1,-2,-3,-0.99,-1.99,-2.99]。
 */
const MM_TO_SCENE_MATRIX = new Matrix4().makeScale(0.001, 0.001, 0.001).setPosition(-1, -2, -3);
const LOADED_A_SCENE_AABB: [number, number, number, number, number, number] = [-1, -2, -3, -0.99, -1.99, -2.99];

function expectPointClose(actual: { x: number; y: number; z: number } | undefined, expected: [number, number, number], digits = 6) {
  expect(actual).toBeTruthy();
  expect(actual!.x).toBeCloseTo(expected[0], digits);
  expect(actual!.y).toBeCloseTo(expected[1], digits);
  expect(actual!.z).toBeCloseTo(expected[2], digits);
}

function expectAabbClose(actual: ArrayLike<number> | null | undefined, expected: number[], digits = 6) {
  expect(actual).toBeTruthy();
  expect(actual!.length).toBe(expected.length);
  expected.forEach((value, index) => expect(actual![index]).toBeCloseTo(value, digits));
}

describe('resolveSceneWorldTransform', () => {
  it('没有 DTXLayer、没有矩阵方法或矩阵是单位阵时都是恒等换算', () => {
    expect(resolveSceneWorldTransform(null).identity).toBe(true);
    expect(resolveSceneWorldTransform({ __dtxLayer: {} } as any).identity).toBe(true);
    expect(resolveSceneWorldTransform({ __dtxLayer: { getGlobalModelMatrix: () => null } } as any).identity).toBe(true);
    const identity = resolveSceneWorldTransform({ __dtxLayer: { getGlobalModelMatrix: () => new Matrix4() } } as any);
    expect(identity.identity).toBe(true);
    expect(identity.pointToWorldMm({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
    expect(identity.aabbToScene([0, 0, 0, 1, 1, 1])).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('0.001 缩放 + 重心化矩阵：点与盒在场景 ↔ mm 之间互逆', () => {
    const transform = resolveSceneWorldTransform({ __dtxLayer: { getGlobalModelMatrix: () => MM_TO_SCENE_MATRIX } } as any);
    expect(transform.identity).toBe(false);
    // 场景里选中盒的中心 (-0.995, -1.995, -2.995) 就是 mm 里的 (5, 5, 5)
    expectPointClose(transform.pointToWorldMm({ x: -0.995, y: -1.995, z: -2.995 }), [5, 5, 5]);
    expectPointClose(transform.pointToScene({ x: 5, y: 5, z: 5 }), [-0.995, -1.995, -2.995]);
    expectAabbClose(transform.aabbToWorldMm(LOADED_A_SCENE_AABB), [0, 0, 0, 10, 10, 10]);
    expectAabbClose(transform.aabbToScene([20, 0, 0, 30, 10, 10]), [-0.98, -2, -3, -0.97, -1.99, -2.99]);
    const roundTrip = transform.aabbToWorldMm(transform.aabbToScene([123.4, -56.7, 8.9, 234.5, 0, 90.1]));
    expectAabbClose(roundTrip, [123.4, -56.7, 8.9, 234.5, 0, 90.1], 6);
  });

  it('不可逆或含非数的矩阵退回恒等，不让查询带着 NaN 出门', () => {
    const singular = new Matrix4().makeScale(0, 0, 0);
    expect(resolveSceneWorldTransform({ __dtxLayer: { getGlobalModelMatrix: () => singular } } as any).identity).toBe(true);
    const nan = { elements: new Array(16).fill(Number.NaN) };
    expect(resolveSceneWorldTransform({ __dtxLayer: { getGlobalModelMatrix: () => nan } } as any).identity).toBe(true);
  });
});

describe('createSpatialQueryStore · 场景坐标 ↔ mm（plan 2026-09-13 §7 第 6 步 B4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetNegativeNounRegistryForTests();
    spatialSourceMocks.state.kind = 'gen-model-v1';
    spatialSourceMocks.state.specValues = false;
    dbMetaMocks.ensureDbMetaInfoLoaded.mockResolvedValue(undefined);
    dbMetaMocks.getDbnumByRefno.mockReturnValue(7997);
    dtxLoaderMocks.loadDtxAabbProxyRefnos.mockImplementation((_layer, _dbno, entries) => ({
      loadedRefnos: entries.filter((entry: any) => !!entry.aabb).map((entry: any) => String(entry.refno)),
      missingRefnos: entries.filter((entry: any) => !entry.aabb).map((entry: any) => String(entry.refno)),
      loadedObjects: entries.filter((entry: any) => !!entry.aabb).length,
      skippedObjects: 0,
    }));
  });

  /** 查看器桩：`getAABB` 回场景坐标（已乘全局矩阵），`__dtxLayer` 暴露那枚矩阵。 */
  function createScaledViewerStub() {
    const viewer = createViewerStub();
    viewer.__dtxLayer = { getGlobalModelMatrix: () => MM_TO_SCENE_MATRIX.clone() };
    viewer.scene.objects.loaded_a.aabb = LOADED_A_SCENE_AABB;
    viewer.scene.getAABB = vi.fn((ids: string[]) => (ids[0] === 'loaded_a' ? LOADED_A_SCENE_AABB : null));
    return viewer;
  }

  it('「当前选中」中心先换回 mm 再发服务端，本地扫描也按 mm 量距', async () => {
    const viewer = createScaledViewerStub();
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      truncated: false,
      total_count: 2,
      returned_count: 2,
      page: 1,
      per_page: 100,
      has_more: false,
      center: { x: 5, y: 5, z: 5, source: 'position' },
      filter_options: { include_negative: false, nouns: [{ value: 'PIPE', count: 1 }, { value: 'EQUI', count: 1 }], spec_values: [] },
      results: [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 0, distance: 0, aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } } },
        { refno: 'server_only', noun: 'EQUI', spec_value: 0, distance: 15, aabb: { min: { x: 20, y: 0, z: 0 }, max: { x: 30, y: 10, z: 10 } } },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
    });

    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;

    await store.submitQuery();

    expect(store.status.value).toBe('ready');
    expect(store.error.value).toBeNull();
    // 改前这里发出去的是场景坐标 (-0.995, -1.995, -2.995)
    const [x, y, z, radius] = queryNearbyByPosition.mock.calls[0]! as unknown as [number, number, number, number];
    expect(x).toBeCloseTo(5, 6);
    expect(y).toBeCloseTo(5, 6);
    expect(z).toBeCloseTo(5, 6);
    expect(radius).toBe(50);
    expectPointClose(store.draft.center, [5, 5, 5]);

    // 本地扫描按 mm 量距后命中 loaded_a，与服务端同一条合并成 merged（改前场景盒对 mm 中心相距上千 mm，本地扫不到）
    const local = store.resultSet.value?.items.find((item) => item.refno === 'loaded_a');
    expect(local?.matchedBy).toBe('merged');
    expect(local?.distance).toBe(0);
    expectPointClose(local?.position ?? undefined, [5, 5, 5]);
    expect(local?.bbox?.min.x).toBeCloseTo(0, 6);
    expect(local?.bbox?.max.x).toBeCloseTo(10, 6);
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a', 'server_only']);
  });

  it('「拾取中心」的 worldPos 是场景坐标，进草稿时换回 mm', async () => {
    const viewer = createScaledViewerStub();
    const pickedQueryCenter = ref<{ entityId: string; worldPos: [number, number, number] } | null>(null);
    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
    });

    pickedQueryCenter.value = { entityId: 'loaded_a', worldPos: [-0.995, -1.995, -2.995] };
    await nextTick();

    expect(store.draft.rangeCenterSource).toBe('pick');
    expectPointClose(store.draft.center, [5, 5, 5]);
  });

  it('场景里拿不到盒时，飞向结果项 bbox 要先从 mm 换到场景坐标', async () => {
    const viewer = createScaledViewerStub();
    viewer.__dtxAfterInstancesLoaded = vi.fn();
    delete viewer.scene.objects.server_only;
    const requestId = 'req-scaled';
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      createRequestId: () => requestId,
    });

    store.resultSet.value = {
      request: {
        mode: 'range',
        centerSource: 'coordinates',
        center: { x: 5, y: 5, z: 5 },
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
          specValue: 0,
          specName: '未知',
          distance: 15,
          loaded: false,
          visible: false,
          matchedBy: 'server-spatial-index',
          bbox: { min: { x: 20, y: 0, z: 0 }, max: { x: 30, y: 10, z: 10 } },
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
      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'showModelByRefnos' }));
    });
    const listener = addEventListenerSpy.mock.calls.find(([eventName]) => eventName === 'showModelByRefnosDone')?.[1] as EventListener;
    listener(new CustomEvent('showModelByRefnosDone', { detail: { requestId, ok: ['server_only'], fail: [], error: null } }));
    await activation;

    expect(store.error.value).toBeNull();
    // 代理盒按 mm 交给 DTXLayer（它渲染时自己乘全局矩阵）
    expect(dtxLoaderMocks.loadDtxAabbProxyRefnos).toHaveBeenCalledWith(
      viewer.__dtxLayer,
      7997,
      [expect.objectContaining({ refno: 'server_only', aabb: { min: [20, 0, 0], max: [30, 10, 10] } })],
    );
    // 飞行走场景坐标：mm [20,0,0,30,10,10] → [-0.98,-2,-3,-0.97,-1.99,-2.99]
    const flyCall = (viewer.cameraFlight.flyTo as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { aabb: number[] };
    expectAabbClose(flyCall.aabb, [-0.98, -2, -3, -0.97, -1.99, -2.99]);
  });
});
