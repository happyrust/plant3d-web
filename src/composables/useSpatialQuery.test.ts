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
  /** 在册房间清单（ADR 0067）；缺省「不支持」 */
  rooms: vi.fn(async (): Promise<SpatialRoomsResult> => ({ success: true, status: 'unsupported', reason: null, definition_version: null, rooms: [] })),
  /** 某构件所在房间；缺省没有归属 */
  roomsOf: vi.fn(async (_refno: string): Promise<string[]> => []),
  /** 房间层级树（ADR 0068）；缺省「不支持」，store 退回平铺 */
  tree: vi.fn(async (_params: SpatialNearbyParams, _only?: SpatialTreeLeafSelector): Promise<SpatialTreeResult> => ({
    success: false,
    unsupported: true,
    error: 'tree not mocked',
    total_count: 0,
    candidate_count: 0,
    truncated_candidates: false,
    candidate_cap: 0,
    leaves_inline: true,
    leaf_cap: 0,
    leaf_count: 0,
    delivery_unit_types: [],
    rooms: [],
  })),
  /** 当前「数据源」：缺省 legacy（有专业维度、不认房间、没有树）；v1 用例翻成 gen-model-v1 / rooms=true / tree=true */
  state: { kind: 'legacy' as 'legacy' | 'gen-model-v1', specValues: true, branCenterline: true, keywordMatchesName: true, nameSortExact: true, rooms: false, tree: false },
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    kind: spatialSourceMocks.state.kind,
    spatial: {
      nearby: spatialSourceMocks.nearby,
      nearbyRefnos: spatialSourceMocks.nearbyRefnos,
      negativeNouns: spatialSourceMocks.negativeNouns,
      rooms: spatialSourceMocks.rooms,
      roomsOf: spatialSourceMocks.roomsOf,
      tree: spatialSourceMocks.tree,
      capabilities: {
        specValues: spatialSourceMocks.state.specValues,
        rooms: spatialSourceMocks.state.rooms,
        branCenterline: spatialSourceMocks.state.branCenterline,
        keywordMatchesName: spatialSourceMocks.state.keywordMatchesName,
        nameSortExact: spatialSourceMocks.state.nameSortExact,
        tree: spatialSourceMocks.state.tree,
      },
    },
  }),
}));

const batchLoadDeps = vi.hoisted(() => ({
  loadDbnoInstancesForVisibleRefnosDtx: vi.fn(async (_layer: unknown, _dbno: number, refnos: string[], _options?: Record<string, unknown>) => ({
    loadedRefnos: refnos,
    missingRefnos: [] as string[],
  })),
}));

vi.mock('@/composables/useDbnoInstancesDtxLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useDbnoInstancesDtxLoader')>();
  return {
    ...actual,
    loadDtxAabbProxyRefnos: dtxLoaderMocks.loadDtxAabbProxyRefnos,
    loadDbnoInstancesForVisibleRefnosDtx: batchLoadDeps.loadDbnoInstancesForVisibleRefnosDtx,
  };
});

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
  SPATIAL_RADIUS_MAX_MM,
} from './useSpatialQuery';

import type {
  NegativeNounsResult,
  SpatialNearbyParams,
  SpatialNearbyRefnosResult,
  SpatialNearbyResult,
  SpatialQueryResult,
  SpatialRoomsResult,
  SpatialTreeLeafSelector,
  SpatialTreeResult,
} from '@/api/genModelSpatialApi';

import { GenModelV1ApiError } from '@/api/genModelV1Api';

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
    spatialSourceMocks.state.branCenterline = true;
    spatialSourceMocks.state.keywordMatchesName = true;
    spatialSourceMocks.state.nameSortExact = true;
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
    store.draft.rangeCenterSource = 'selected';
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

  it('distance「沿 BRAN 中心线」：refno 路径多带 source_mode，不扫本地，服务端回来的源 BRAN 自身被剔掉', async () => {
    const viewer = createViewerStub();
    const queryNearbyByPosition = vi.fn();
    const queryNearbyByRefno = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      total_count: 2,
      returned_count: 2,
      page: 1,
      per_page: 25,
      has_more: false,
      results: [
        // `/query?mode=bran_centerline` 还不剔源自身：BRAN 会以 0 距离回来
        { refno: 'loaded_a', noun: 'BRAN', spec_value: 1, distance: 0 },
        { refno: 'server_only', noun: 'SCTN', spec_value: 2, distance: 18 },
      ],
    }));

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
      queryNearbyByRefno,
    });

    store.draft.mode = 'distance';
    store.draft.distanceCenterSource = 'bran_centerline';
    store.draft.refno = 'loaded_a';
    store.draft.radius = 1500;
    store.draft.limit = 25;
    expect(store.canSubmit.value).toBe(true);

    await store.submitQuery();

    expect(queryNearbyByRefno).toHaveBeenCalledWith('loaded_a', 1500, expect.objectContaining({
      source_mode: 'bran_centerline',
      include_self: false,
      per_page: 25,
    }));
    expect(queryNearbyByPosition).not.toHaveBeenCalled();
    expect(store.status.value).toBe('ready');
    // 本地扫描没跑：草稿中心 (0,0,0) 半径内的 loaded_b 不会以 viewer-local 混进来；源 BRAN 自身那条也被剔掉
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_only']);
    expect(store.resultSet.value?.items[0]).toMatchObject({ refno: 'server_only', noun: 'SCTN', loaded: false, matchedBy: 'server-spatial-index' });
    // `/query` 不回 center：草稿中心保持不动，结果集也没有服务端中心
    expect(store.draft.center).toEqual({ x: 0, y: 0, z: 0 });
    expect(store.resultSet.value?.center).toBeNull();
  });

  it('distance「沿 BRAN 中心线」：当前数据源没有这一档能力时提交报错、不发请求', async () => {
    spatialSourceMocks.state.branCenterline = false;
    const queryNearbyByRefno = vi.fn();
    const store = createSpatialQueryStore({
      viewerRef: ref(null),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByRefno,
    });
    store.draft.mode = 'distance';
    store.draft.distanceCenterSource = 'bran_centerline';
    store.draft.refno = '24381_145018';
    store.draft.radius = 1500;

    await store.submitQuery();

    expect(store.status.value).toBe('error');
    expect(store.error.value).toContain('沿 BRAN 中心线');
    expect(queryNearbyByRefno).not.toHaveBeenCalled();
  });

  it('gen-model-v1：结果带 dbnum / dbnum_groups / coverage 进结果集；范围查询默认排序退到按距离；按库分组的批量作用域与「仅显示本库」', async () => {
    spatialSourceMocks.state.kind = 'gen-model-v1';
    spatialSourceMocks.state.specValues = false;
    spatialSourceMocks.state.branCenterline = false;
    spatialSourceMocks.state.keywordMatchesName = false;
    spatialSourceMocks.state.nameSortExact = false;
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

    expect(store.spatialCapabilities.value).toEqual({ specValues: false, rooms: false, branCenterline: false, keywordMatchesName: false, nameSortExact: false, tree: false });
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

  it('批量加载按结果自带 dbnum 分桶，直接经数据源（gen-model-v1）加载', async () => {
    spatialSourceMocks.state.kind = 'gen-model-v1';
    spatialSourceMocks.state.specValues = false;
    spatialSourceMocks.state.branCenterline = false;
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
    expect(batchLoadDeps.loadDbnoInstancesForVisibleRefnosDtx.mock.calls[0]![3]).toEqual(expect.objectContaining({ dataSource: 'gen-model-v1' }));
    // 服务端没回、但本地扫描命中的已加载 loaded_a 以 viewer-local 追加在服务端条目之后（P5），它本来就已加载、不进批量加载
    expect(store.resultSet.value?.items.map((item) => [item.refno, item.loaded, item.matchedBy])).toEqual([
      ['server_only', true, 'server-spatial-index'],
      ['server_b', true, 'server-spatial-index'],
      ['loaded_a', true, 'viewer-local'],
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
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [], rooms: [] },
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
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [], rooms: [] },
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
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [], rooms: [] },
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
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [], rooms: [] },
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

  it('点击未加载结果时应先请求加载，再飞行并选中（全局选中 store 也写，属性面板 / 模型树跟着走）', async () => {
    const viewer = createViewerStub();
    const requestId = 'req-1';
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const setSelectedRefno = vi.fn();

    const store = createSpatialQueryStore({
      viewerRef: { value: viewer },
      selection: { selectedRefno: { value: null }, setSelectedRefno } as any,
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
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [], rooms: [] },
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
    // 改前只改查看器高亮，不写 useSelectionStore，属性面板 / 模型树不跟
    expect(setSelectedRefno).toHaveBeenCalledWith('server_only');
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
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [], rooms: [] },
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

  it('spatial URL 半径超过服务端上限 100 m 时钳到 100 m（与抽屉 setRadiusMeters 同一道），不让整次查询被 400', () => {
    expect(SPATIAL_RADIUS_MAX_MM).toBe(100_000);
    expect(parseSpatialQueryUrlParams('?spatial_refno=24381_145019&spatial_radius=500&spatial_radius_unit=m')?.radius).toBe(100_000);
    expect(parseSpatialQueryUrlParams('?spatial_refno=24381_145019&spatial_radius=250000')?.radius).toBe(100_000);
    expect(parseSpatialQueryUrlParams('?spatial_refno=24381_145019&spatial_radius=100000')?.radius).toBe(100_000);
    expect(parseSpatialQueryUrlParams('?spatial_refno=24381_145019&spatial_radius=99999')?.radius).toBe(99_999);
  });

  it('「每页数量」清空 / 非正整数：canSubmit 为假；宿主脚本硬提交时 per_page 按缺省 100 发，半径也钳到 100 m', async () => {
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      total_count: 0,
      returned_count: 0,
      page: 1,
      per_page: 100,
      has_more: false,
      results: [],
    }));
    const store = createSpatialQueryStore({
      viewerRef: ref(null),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByPosition,
    });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'coordinates';
    store.draft.center = { x: 1, y: 2, z: 3 };
    store.draft.radius = 250_000;
    expect(store.canSubmit.value).toBe(true);
    expect(store.hasValidPageLimit.value).toBe(true);

    // v-model.number 清空写进 ''；0 / 1.5 / 负数也都不算
    (store.draft as unknown as { limit: unknown }).limit = '';
    expect(store.hasValidPageLimit.value).toBe(false);
    expect(store.canSubmit.value).toBe(false);
    store.draft.limit = 0;
    expect(store.canSubmit.value).toBe(false);
    store.draft.limit = 1.5;
    expect(store.canSubmit.value).toBe(false);
    store.draft.limit = 20;
    expect(store.canSubmit.value).toBe(true);

    // 绕过按钮硬提交（URL autorun / 宿主脚本）：请求不带坏值出门
    (store.draft as unknown as { limit: unknown }).limit = '';
    await store.submitQuery();
    expect(store.status.value).toBe('ready');
    expect(queryNearbyByPosition).toHaveBeenCalledWith(1, 2, 3, 100_000, expect.objectContaining({ per_page: 100 }));
    expect(store.resultSet.value?.request.limit).toBe(100);
    expect(store.resultSet.value?.request.radius).toBe(100_000);
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
    spatialSourceMocks.state.branCenterline = false;
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

  it('「当前选中」优先取子树盒（getSubtreeAABB）：BRAN 自身对象只有管子，成员盒并进来才与服务端 refno_aabb_center 同口径；取不到再退回 getAABB', () => {
    const viewer = createScaledViewerStub();
    // 自身（管子）盒 mm [0,0,0,10,10,10]（场景 LOADED_A_SCENE_AABB）；成员往 +x / +z 伸到 (20, 10, 30) → 子树盒中心 mm (10, 5, 15)
    const subtreeSceneAabb: [number, number, number, number, number, number] = [-1, -2, -3, -0.98, -1.99, -2.97];
    const getSubtreeAABB = vi.fn((ids: string[]) => (ids[0] === 'loaded_a' ? subtreeSceneAabb : null));
    (viewer.scene as unknown as { getSubtreeAABB: typeof getSubtreeAABB }).getSubtreeAABB = getSubtreeAABB;

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
    });

    store.applyCurrentSelection();
    expect(store.error.value).toBeNull();
    expect(getSubtreeAABB).toHaveBeenCalledWith(['loaded_a']);
    // 不是自身盒中心 (5, 5, 5)
    expectPointClose(store.draft.center, [10, 5, 15]);
    expect(store.draft.refno).toBe('loaded_a');

    // 子树盒解不出（null）→ 退回 getAABB 的自身盒
    getSubtreeAABB.mockReturnValue(null);
    store.applyCurrentSelection();
    expect(store.error.value).toBeNull();
    expectPointClose(store.draft.center, [5, 5, 5]);
  });

  it('「当前选中」选中的是没加载几何的 owner（PIPE / ZONE）：不报错，改发 refno 让服务端按子树盒解中心，center 回来写回草稿', async () => {
    const viewer = createScaledViewerStub();
    const selection = { selectedRefno: { value: 'pipe_1' as string | null } };
    const queryNearbyByRefno = vi.fn(async (): Promise<SpatialQueryResult> => ({
      success: true,
      truncated: false,
      total_count: 1,
      returned_count: 1,
      page: 1,
      per_page: 100,
      has_more: false,
      center: { x: 5963.8, y: 9972.2, z: 16552, source: 'refno_aabb_center', refno: 'pipe_1' },
      filter_options: { include_negative: false, nouns: [{ value: 'EQUI', count: 1 }], spec_values: [] },
      results: [
        { refno: 'server_only', noun: 'EQUI', spec_value: 0, distance: 15, aabb: { min: { x: 20, y: 0, z: 0 }, max: { x: 30, y: 10, z: 10 } } },
      ],
    }));
    const queryNearbyByPosition = vi.fn();

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: selection as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      queryNearbyByRefno,
      queryNearbyByPosition: queryNearbyByPosition as any,
    });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 1000;

    // 查看器里 pipe_1 自身与成员都没加载：不再报「无法解析当前选中构件的位置」，记下 refno 交给服务端
    store.applyCurrentSelection();
    expect(store.error.value).toBeNull();
    expect(store.selectedCenterRefno.value).toBe('pipe_1');
    expect(store.draft.refno).toBe('pipe_1');
    expect(store.draft.rangeCenterSource).toBe('selected');

    await store.submitQuery();
    expect(store.status.value).toBe('ready');
    expect(store.error.value).toBeNull();
    expect(queryNearbyByPosition).not.toHaveBeenCalled();
    expect(queryNearbyByRefno).toHaveBeenCalledTimes(1);
    expect(queryNearbyByRefno).toHaveBeenCalledWith('pipe_1', 1000, expect.objectContaining({ include_self: false, page: 1, shape: 'sphere' }));
    // 服务端按子树盒解出的中心写回草稿，兜底标记清掉；结果集仍记着中心来源是「当前选中」
    expectPointClose(store.draft.center, [5963.8, 9972.2, 16552]);
    expect(store.selectedCenterRefno.value).toBeNull();
    expect(store.resultSet.value?.request.centerSource).toBe('selected');
    expect(store.resultSet.value?.request.refno).toBe('pipe_1');
    expect(store.resultSet.value?.center).toMatchObject({ x: 5963.8, source: 'refno_aabb_center', refno: 'pipe_1' });
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_only']);

    // 再次提交仍走 refno（查看器还是没盒）；换成有盒的选中后回到点模式
    await store.submitQuery();
    expect(queryNearbyByRefno).toHaveBeenCalledTimes(2);
    expect(queryNearbyByPosition).not.toHaveBeenCalled();
    selection.selectedRefno.value = 'loaded_a';
    store.applyCurrentSelection();
    expect(store.selectedCenterRefno.value).toBeNull();
    expectPointClose(store.draft.center, [5, 5, 5]);

    // 兜底标记只在「范围 · 当前选中」下有效：切到手输坐标就作废
    selection.selectedRefno.value = 'pipe_1';
    store.applyCurrentSelection();
    expect(store.selectedCenterRefno.value).toBe('pipe_1');
    store.draft.rangeCenterSource = 'coordinates';
    await nextTick();
    expect(store.selectedCenterRefno.value).toBeNull();
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
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [], rooms: [] },
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

/** 2026-09-18 审核 P1–P8 的回归：翻页 / 排序不重解中心、可见性直读查看器、重查失败保留结果、本地独有命中、纯本地路径、恢复场景 */
describe('createSpatialQueryStore · 审核 P1–P8', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetNegativeNounRegistryForTests();
    spatialSourceMocks.state.kind = 'legacy';
    spatialSourceMocks.state.specValues = true;
    spatialSourceMocks.state.branCenterline = true;
    spatialSourceMocks.state.keywordMatchesName = true;
    spatialSourceMocks.state.nameSortExact = true;
    dbMetaMocks.ensureDbMetaInfoLoaded.mockResolvedValue(undefined);
    dbMetaMocks.getDbnumByRefno.mockReturnValue(7997);
  });

  const toolStoreStub = () => ({ pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() }) as any;

  function pageResponse(page: number, perPage: number, total: number, results: SpatialQueryResult['results']): SpatialQueryResult {
    return {
      success: true,
      total_count: total,
      returned_count: results?.length ?? 0,
      page,
      per_page: perPage,
      has_more: page * perPage < total,
      results,
    };
  }

  it('P1：翻页 / 改排序沿用上一次结果的请求，不按此刻的选中重解中心；清掉选中再翻页也不报错', async () => {
    const viewer = createViewerStub();
    const selection = { selectedRefno: { value: 'loaded_a' as string | null } };
    const queryNearbyByPosition = vi.fn(async (_x: number, _y: number, _z: number, _r: number, options: { page?: number }): Promise<SpatialQueryResult> => {
      const page = options.page ?? 1;
      return pageResponse(page, 1, 3, [{ refno: `server_p${page}`, noun: 'EQUI', spec_value: 2, distance: 18 + page }]);
    });

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: selection as any,
      toolStore: toolStoreStub(),
      queryNearbyByPosition: queryNearbyByPosition as any,
    });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;
    store.draft.limit = 1;

    await store.submitQuery();
    expect(store.status.value).toBe('ready');
    expect(queryNearbyByPosition).toHaveBeenLastCalledWith(5, 5, 5, 50, expect.objectContaining({ page: 1 }));
    expect(store.resultSet.value?.page).toBe(1);
    expect(store.resultSet.value?.totalPages).toBe(3);

    // 用户在查看器里换了选中（loaded_b 中心 (205,5,5)）再点「下一页」：第 2 页仍以 (5,5,5) 为中心，草稿也不被改写
    selection.selectedRefno.value = 'loaded_b';
    viewer.scene.selectedObjectIds = ['loaded_b'];
    await store.requeryResults({ page: 2 });
    expect(store.status.value).toBe('ready');
    expect(store.error.value).toBeNull();
    expect(queryNearbyByPosition).toHaveBeenLastCalledWith(5, 5, 5, 50, expect.objectContaining({ page: 2 }));
    expect(store.resultSet.value?.page).toBe(2);
    expect(store.resultSet.value?.request.center).toEqual({ x: 5, y: 5, z: 5 });
    expect(store.draft.refno).toBe('loaded_a');
    expect(store.draft.center).toEqual({ x: 5, y: 5, z: 5 });

    // 点空白清掉选中再翻页：改前报「请先选中一个模型」并把结果清空
    selection.selectedRefno.value = null;
    viewer.scene.selectedObjectIds = [];
    await store.requeryResults({ page: 3 });
    expect(store.status.value).toBe('ready');
    expect(store.error.value).toBeNull();
    expect(store.resultSet.value?.page).toBe(3);
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_p3']);

    // 改排序：同一中心、回到第 1 页、只换 sort
    await store.requeryResults({ sortBy: 'nameAsc' });
    expect(queryNearbyByPosition).toHaveBeenLastCalledWith(5, 5, 5, 50, expect.objectContaining({ page: 1, sort: 'name' }));
    expect(store.resultSet.value?.request.sortBy).toBe('nameAsc');
    expect(store.resultSet.value?.page).toBe(1);

    // 没有结果时 requery 退回正常提交（要解中心）：此刻没选中 → 报错
    store.clearResults();
    await store.requeryResults({ page: 1 });
    expect(store.status.value).toBe('error');
    expect(store.error.value).toBe('请先选中一个模型');
  });

  it('P4：翻页撞上 503 spatial_not_ready 保留第 1 页、错误文本带「约 N 秒后可重试」；「执行空间查询」失败仍清结果', async () => {
    const viewer = createViewerStub();
    const notReady = new GenModelV1ApiError({
      code: 'spatial_not_ready',
      status: 503,
      path: '/api/v1/spatial/nearby',
      message: 'spatial tree is loading',
      retryAfterMs: 5000,
    });
    let failNext = false;
    const queryNearbyByPosition = vi.fn(async (_x: number, _y: number, _z: number, _r: number, options: { page?: number }): Promise<SpatialQueryResult> => {
      if (failNext) throw notReady;
      const page = options.page ?? 1;
      return pageResponse(page, 1, 2, [{ refno: `server_p${page}`, noun: 'EQUI', spec_value: 2, distance: 18 }]);
    });

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: toolStoreStub(),
      queryNearbyByPosition: queryNearbyByPosition as any,
    });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;
    store.draft.limit = 1;

    await store.submitQuery();
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_p1']);

    failNext = true;
    await store.requeryResults({ page: 2 });
    expect(store.status.value).toBe('error');
    expect(store.error.value).toBe('spatial tree is loading（约 5 秒后可重试）');
    // 第 1 页还在
    expect(store.resultSet.value?.page).toBe(1);
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_p1']);

    // 「执行空间查询」失败：旧结果对应的不是这份草稿，照旧清掉
    await store.submitQuery();
    expect(store.status.value).toBe('error');
    expect(store.error.value).toContain('约 5 秒后可重试');
    expect(store.resultSet.value).toBeNull();
  });

  it('P3：refno 路由的请求勾「仅看当前可见」，服务端回来的「已加载但被隐藏」构件按查看器实际可见性剔掉，并提示本页后筛', async () => {
    const viewer = createViewerStub();
    viewer.scene.objects.loaded_a.visible = false;
    const queryNearbyByRefno = vi.fn(async (): Promise<SpatialQueryResult> => ({
      ...pageResponse(1, 100, 2, [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, distance: 5 },
        { refno: 'loaded_b', noun: 'PIPE', spec_value: 1, distance: 195 },
        { refno: 'server_only', noun: 'EQUI', spec_value: 2, distance: 18 },
      ]),
      center: { x: 5, y: 5, z: 5, source: 'refno_aabb_center', refno: 'src' },
    }));

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: toolStoreStub(),
      queryNearbyByRefno,
    });
    store.draft.mode = 'distance';
    store.draft.distanceCenterSource = 'refno';
    store.draft.refno = 'src';
    store.draft.radius = 500;
    store.draft.onlyVisible = true;

    await store.submitQuery();
    expect(store.status.value).toBe('ready');
    // 中心要服务端解，仍走服务端；loaded_a 隐藏 → 剔掉（改前 existing 缺省成「可见」放行，眼睛图标还画成可见）；
    // server_only 没加载、查看器里没有对象，沿用缺省可见（这一档由「仅看已加载」管）
    expect(queryNearbyByRefno).toHaveBeenCalledTimes(1);
    expect(store.resultSet.value?.items.map((item) => [item.refno, item.visible])).toEqual([
      ['loaded_b', true],
      ['server_only', true],
    ]);
    expect(store.resultSet.value?.localOnly).toBe(false);
    expect(store.resultSet.value?.warnings).toEqual(expect.arrayContaining([expect.stringContaining('只在本页内后筛')]));
  });

  it('P5：本地命中、服务端整个命中集合都没有的已加载构件（TUBI）以 viewer-local 追加在第 1 页末尾，计入「共 N 项」但不进页数', async () => {
    const viewer = createViewerStub();
    viewer.scene.objects.local_only_tubi = { id: 'local_only_tubi', visible: true, aabb: [12, 0, 0, 15, 3, 3], noun: 'TUBI' } as any;
    viewer.scene.objectIds.push('local_only_tubi');
    viewer.scene.getLoadedRefnos = () => ['loaded_a', 'loaded_b', 'local_only_tubi'];
    const aabbs: Record<string, [number, number, number, number, number, number]> = {
      loaded_a: [0, 0, 0, 10, 10, 10],
      loaded_b: [200, 0, 0, 210, 10, 10],
      local_only_tubi: [12, 0, 0, 15, 3, 3],
    };
    viewer.scene.getAABB = vi.fn((ids: string[]) => aabbs[ids[0]!] ?? null);

    // 没翻页：本页就是全集
    const singlePage = vi.fn(async (): Promise<SpatialQueryResult> => ({
      ...pageResponse(1, 100, 2, [
        { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, dbnum: 24381, distance: 5 },
        { refno: 'server_only', noun: 'EQUI', spec_value: 2, dbnum: 24383, distance: 18 },
      ]),
      groups: [{ spec_value: 1, count: 1 }, { spec_value: 2, count: 1 }],
      dbnum_groups: [{ dbnum: 24381, count: 1 }, { dbnum: 24383, count: 1 }],
    }));
    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: toolStoreStub(),
      queryNearbyByPosition: singlePage,
    });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;
    await store.submitQuery();

    expect(store.resultSet.value?.items.map((item) => [item.refno, item.matchedBy, item.loaded])).toEqual([
      ['loaded_a', 'merged', true],
      ['server_only', 'server-spatial-index', false],
      ['local_only_tubi', 'viewer-local', true],
    ]);
    expect(store.resultSet.value?.total).toBe(3);
    expect(store.resultSet.value?.returnedCount).toBe(3);
    expect(store.resultSet.value?.totalPages).toBe(1);
    expect(store.resultSet.value?.loadedCount).toBe(2);
    // 分组小计跟着加：TUBI 本地查不到专业 → spec 0 新成一组；按库计数（db_meta 桩给 7997）也多一组
    expect(store.resultSet.value?.groups.map((group) => [group.specValue, group.count])).toEqual([[0, 1], [1, 1], [2, 1]]);
    expect(store.resultSet.value?.dbnumGroups).toEqual([{ dbnum: 7997, count: 1 }, { dbnum: 24381, count: 1 }, { dbnum: 24383, count: 1 }]);

    // 有翻页：要先取全集才能判「整个集合都没有」；全集里没有它 → 追加，且并进 fullMatches
    const paged = vi.fn(async (_x: number, _y: number, _z: number, _r: number, options: { page?: number }): Promise<SpatialQueryResult> => {
      const page = options.page ?? 1;
      return pageResponse(page, 1, 2, page === 1
        ? [{ refno: 'loaded_a', noun: 'PIPE', spec_value: 1, distance: 5 }]
        : [{ refno: 'server_only', noun: 'EQUI', spec_value: 2, distance: 18 }]);
    });
    const nearbyRefnos = vi.fn(async (): Promise<SpatialNearbyRefnosResult> => ({
      success: true,
      refnos: ['loaded_a', 'server_only'],
      by_dbnum: {},
      by_spec_value: { '1': ['loaded_a'], '2': ['server_only'] },
      total_count: 2,
      truncated: false,
      cap: 100000,
    }));
    const pagedStore = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: toolStoreStub(),
      queryNearbyByPosition: paged as any,
      queryNearbyRefnos: nearbyRefnos,
    });
    pagedStore.draft.mode = 'range';
    pagedStore.draft.rangeCenterSource = 'selected';
    pagedStore.draft.radius = 50;
    pagedStore.draft.limit = 1;
    await pagedStore.submitQuery();

    expect(nearbyRefnos).toHaveBeenCalledTimes(1);
    expect(pagedStore.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a', 'local_only_tubi']);
    expect(pagedStore.resultSet.value?.total).toBe(3);
    expect(pagedStore.resultSet.value?.totalPages).toBe(2);
    expect(pagedStore.resultSet.value?.fullMatches?.refnos).toEqual(['loaded_a', 'server_only', 'local_only_tubi']);
    expect(pagedStore.resultSet.value?.fullMatches?.total).toBe(3);
    expect(pagedStore.resultSet.value?.fullMatches?.bySpecValue['0']).toEqual(['local_only_tubi']);

    // 第 2 页不再追加（它已经在第 1 页）
    await pagedStore.requeryResults({ page: 2 });
    expect(pagedStore.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_only']);
    expect(pagedStore.resultSet.value?.total).toBe(2);

    // 全集里有它（服务端其实收了）→ 不追加，等它在自己那页出现
    nearbyRefnos.mockResolvedValueOnce({
      success: true,
      refnos: ['loaded_a', 'local_only_tubi', 'server_only'],
      by_dbnum: {},
      by_spec_value: {},
      total_count: 3,
      truncated: false,
      cap: 100000,
    });
    await pagedStore.submitQuery();
    expect(pagedStore.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a']);

    // 全集取不到（接口失败）→ 没法证明它不在别的页，不追加
    nearbyRefnos.mockRejectedValueOnce(new Error('boom'));
    await pagedStore.submitQuery();
    expect(pagedStore.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a']);
    expect(pagedStore.resultSet.value?.fullMatches).toBeNull();
  });

  it('P6：点模式勾「仅看已加载 / 仅看当前可见」走纯本地路径：不打服务端、不分页、前端排序、关键字本地判', async () => {
    const viewer = createViewerStub();
    viewer.scene.objects.loaded_c = { id: 'loaded_c', visible: false, aabb: [30, 0, 0, 40, 10, 10], noun: 'VALV' } as any;
    viewer.scene.objectIds.push('loaded_c');
    viewer.scene.getLoadedRefnos = () => ['loaded_a', 'loaded_b', 'loaded_c'];
    const aabbs: Record<string, [number, number, number, number, number, number]> = {
      loaded_a: [0, 0, 0, 10, 10, 10],
      loaded_b: [200, 0, 0, 210, 10, 10],
      loaded_c: [30, 0, 0, 40, 10, 10],
    };
    viewer.scene.getAABB = vi.fn((ids: string[]) => aabbs[ids[0]!] ?? null);
    const queryNearbyByPosition = vi.fn();
    const queryNearbyRefnos = vi.fn();

    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: toolStoreStub(),
      queryNearbyByPosition,
      queryNearbyRefnos,
    });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'coordinates';
    store.draft.center = { x: 25, y: 5, z: 5 };
    store.draft.radius = 50;
    store.draft.limit = 1;
    store.draft.onlyLoaded = true;
    store.draft.sortBy = 'distanceAsc';

    await store.submitQuery();
    expect(store.status.value).toBe('ready');
    expect(queryNearbyByPosition).not.toHaveBeenCalled();
    expect(queryNearbyRefnos).not.toHaveBeenCalled();
    // 已加载的三个里 loaded_b 在半径外；loaded_c 隐藏但「仅看已加载」不管可见性；由近及远：c(5) 在 a(15) 前
    expect(store.resultSet.value?.items.map((item) => [item.refno, item.matchedBy, item.visible])).toEqual([
      ['loaded_c', 'viewer-local', false],
      ['loaded_a', 'viewer-local', true],
    ]);
    // 不分页：limit=1 也一次给全，页数 1、没有下一页（改前「共 1387 项，当前页 3 项」、70 页大半是空的）
    expect(store.resultSet.value?.localOnly).toBe(true);
    expect(store.resultSet.value?.total).toBe(2);
    expect(store.resultSet.value?.returnedCount).toBe(2);
    expect(store.resultSet.value?.totalPages).toBe(1);
    expect(store.resultSet.value?.hasMore).toBe(false);
    expect(store.resultSet.value?.warnings).toEqual([]);
    expect(store.resultSet.value?.center).toBeNull();
    expect(store.resultSet.value?.dbnumGroups).toEqual([{ dbnum: 7997, count: 2 }]);

    // 「仅看当前可见」再叠上去：隐藏的 loaded_c 出局
    store.draft.onlyVisible = true;
    await store.submitQuery();
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a']);

    // 改排序沿用同一请求，仍是纯本地
    store.draft.onlyVisible = false;
    await store.submitQuery();
    await store.requeryResults({ sortBy: 'nameAsc' });
    expect(queryNearbyByPosition).not.toHaveBeenCalled();
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a', 'loaded_c']);
    expect(store.resultSet.value?.request.sortBy).toBe('nameAsc');

    // 关键字没有服务端替它判，本地按 refno / noun 判
    store.draft.keyword = 'valv';
    await store.submitQuery();
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_c']);
  });

  it('P8：「恢复场景」除清 X-Ray 外，把「全部隐藏 / 仅显示本专业」动过的构件放回动之前的可见性；连做几步只记最初那一份', () => {
    const viewer = createViewerStub();
    // 查询前 loaded_b 本来就是隐藏的
    viewer.scene.objects.loaded_b.visible = false;
    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: toolStoreStub(),
    });
    const item = (refno: string, specValue: number, loaded: boolean, visible: boolean) => ({
      refno, noun: 'PIPE', specValue, specName: '未知', distance: 1, loaded, visible, matchedBy: 'merged' as const,
    });
    store.resultSet.value = {
      request: {
        mode: 'range', centerSource: 'coordinates', center: { x: 0, y: 0, z: 0 }, radius: 100, shape: 'sphere',
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, includeNegative: false, specValues: [], rooms: [] },
        limit: 100, sortBy: 'distanceAsc',
      },
      items: [item('loaded_a', 1, true, true), item('loaded_b', 2, true, false), item('server_only', 2, false, true)],
      page: 1, perPage: 100, returnedCount: 3, totalPages: 1, hasMore: false, total: 3,
      loadedCount: 2, unloadedCount: 1, truncated: false, warnings: [], groups: [],
    };

    store.setAllResultsVisible(false);
    store.setAllResultsVisible(true);
    store.showOnlySpecGroup(1);
    store.isolateResults();
    expect(store.resultSet.value?.items.map((i) => i.visible)).toEqual([true, true, true]);

    viewer.scene.setObjectsVisible.mockClear();
    viewer.scene.setObjectsXRayed.mockClear();
    store.restoreScene();
    expect(viewer.scene.setObjectsXRayed).toHaveBeenCalledWith(['loaded_a', 'loaded_b'], false);
    // loaded_a 原本可见、server_only 查看器里没有对象按可见；loaded_b 原本就是隐藏的，放回隐藏（改前只清 X-Ray，隐掉的回不来）
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['loaded_a', 'server_only'], true);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['loaded_b'], false);
    expect(store.resultSet.value?.items.map((i) => [i.refno, i.visible])).toEqual([
      ['loaded_a', true],
      ['loaded_b', false],
      ['server_only', true],
    ]);

    // 快照已清：再点一次只清 X-Ray
    viewer.scene.setObjectsVisible.mockClear();
    store.restoreScene();
    expect(viewer.scene.setObjectsVisible).not.toHaveBeenCalled();
  });

  it('低：「按名称」在不按名称排全集的源（gen-model-v1）下结果带提示、顺序仍沿用服务端；legacy、换按距离、纯本地路径都不提示', async () => {
    const viewer = createViewerStub();
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => pageResponse(1, 100, 2, [
      { refno: 'server_only', noun: 'EQUI', spec_value: 2, distance: 18 },
      { refno: 'loaded_a', noun: 'PIPE', spec_value: 1, distance: 5 },
    ]));
    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: toolStoreStub(),
      queryNearbyByPosition,
    });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'coordinates';
    store.draft.center = { x: 500, y: 500, z: 500 };
    store.draft.radius = 50;
    store.draft.sortBy = 'nameAsc';

    // legacy：服务端真按名称排全集，不提示
    await store.submitQuery();
    expect(store.status.value).toBe('ready');
    expect(store.resultSet.value?.warnings).toEqual([]);
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_only', 'loaded_a']);

    // gen-model-v1：只为本页补名字、全集按 Noun / Refno 近似排 → 提示；顺序仍沿用服务端（前端重排只改本页，跨页照旧不是名称序）
    spatialSourceMocks.state.kind = 'gen-model-v1';
    spatialSourceMocks.state.specValues = false;
    spatialSourceMocks.state.nameSortExact = false;
    await store.submitQuery();
    expect(store.resultSet.value?.warnings).toEqual([
      expect.stringContaining('「按名称」在当前源不按名称排整个命中集合'),
    ]);
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_only', 'loaded_a']);

    // 换成按距离：没有这条提示
    await store.requeryResults({ sortBy: 'distanceAsc' });
    expect(store.resultSet.value?.request.sortBy).toBe('distanceAsc');
    expect(store.resultSet.value?.warnings).toEqual([]);

    // 纯本地路径（「仅看已加载」）在前端按名称排，与服务端无关，不提示
    store.draft.sortBy = 'nameAsc';
    store.draft.onlyLoaded = true;
    await store.submitQuery();
    expect(store.resultSet.value?.localOnly).toBe(true);
    expect(store.resultSet.value?.warnings).toEqual([]);
  });

  it('低：完整命中集合被服务端截断 → 提示只取到 N / M 项与上限、批量操作只动取到的部分；全集取不到 → 提示退回当前页；没翻页两种都不提示', async () => {
    const viewer = createViewerStub();
    const paged = vi.fn(async (_x: number, _y: number, _z: number, _r: number, options: { page?: number }): Promise<SpatialQueryResult> => {
      const page = options.page ?? 1;
      return pageResponse(page, 1, 3, [{ refno: `server_p${page}`, noun: 'EQUI', spec_value: 2, distance: 18 + page }]);
    });
    const nearbyRefnos = vi.fn(async (): Promise<SpatialNearbyRefnosResult> => ({
      success: true,
      refnos: ['server_p1', 'server_p2'],
      by_dbnum: {},
      by_spec_value: { '2': ['server_p1', 'server_p2'] },
      total_count: 3,
      truncated: true,
      cap: 2,
    }));
    const store = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: toolStoreStub(),
      queryNearbyByPosition: paged as any,
      queryNearbyRefnos: nearbyRefnos,
    });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'coordinates';
    store.draft.center = { x: 500, y: 500, z: 500 };
    store.draft.radius = 50;
    store.draft.limit = 1;

    await store.submitQuery();
    expect(store.status.value).toBe('ready');
    expect(store.resultSet.value?.fullMatches).toEqual(expect.objectContaining({ truncated: true, cap: 2, total: 3 }));
    const truncatedWarning = store.resultSet.value?.warnings.find((warning) => warning.includes('完整命中集合已截断'));
    expect(truncatedWarning).toContain('只取到 2 / 3 项，服务端上限 2');
    expect(truncatedWarning).toContain('只加载未加载');
    expect(truncatedWarning).toContain('只作用于取到的这部分');
    // 批量作用域就是取到的那 2 条（改前静默地少动第 3 条）
    expect(store.countLoadTargets({ onlyUnloaded: true })).toBe(2);

    // 全集取不到（接口失败）→ 批量退回当前页，说出来；「已截断」那条不再出现
    nearbyRefnos.mockRejectedValueOnce(new Error('boom'));
    await store.requeryResults({ page: 2 });
    expect(store.status.value).toBe('ready');
    expect(store.resultSet.value?.fullMatches).toBeNull();
    expect(store.resultSet.value?.warnings).toEqual(expect.arrayContaining([expect.stringContaining('完整命中集合取不到')]));
    expect(store.resultSet.value?.warnings.some((warning) => warning.includes('已截断'))).toBe(false);
    expect(store.countLoadTargets({ onlyUnloaded: true })).toBe(1);

    // 没翻页：本页就是全集，不取全集、两种提示都没有
    const single = vi.fn(async (): Promise<SpatialQueryResult> => pageResponse(1, 100, 1, [{ refno: 'server_only', noun: 'EQUI', spec_value: 2, distance: 18 }]));
    nearbyRefnos.mockClear();
    const singleStore = createSpatialQueryStore({
      viewerRef: ref(viewer),
      selection: { selectedRefno: { value: null } } as any,
      toolStore: toolStoreStub(),
      queryNearbyByPosition: single,
      queryNearbyRefnos: nearbyRefnos,
    });
    singleStore.draft.mode = 'range';
    singleStore.draft.rangeCenterSource = 'coordinates';
    singleStore.draft.center = { x: 500, y: 500, z: 500 };
    singleStore.draft.radius = 50;
    await singleStore.submitQuery();
    expect(nearbyRefnos).not.toHaveBeenCalled();
    expect(singleStore.resultSet.value?.warnings.some((warning) => warning.includes('完整命中集合'))).toBe(false);
  });
});

describe('房间 / 专业过滤（ADR 0067，plan 2026-09-20）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetNegativeNounRegistryForTests();
    spatialSourceMocks.state.kind = 'gen-model-v1';
    spatialSourceMocks.state.specValues = true;
    spatialSourceMocks.state.rooms = true;
    spatialSourceMocks.state.branCenterline = true;
    spatialSourceMocks.state.keywordMatchesName = false;
    spatialSourceMocks.state.nameSortExact = false;
    spatialSourceMocks.rooms.mockResolvedValue({
      success: true,
      status: 'ready',
      reason: null,
      definition_version: 'g1',
      rooms: [
        { refno: '17496_1', room_num: 'A101', name: '/A101-RM', dbnum: 17496, panel_count: 4 },
        { refno: '17497_1', room_num: 'A101', name: '/A101-RM-B', dbnum: 17497, panel_count: 2 },
        { refno: '17496/2', room_num: 'B202', name: null, dbnum: 17496, panel_count: 3 },
      ],
    });
    spatialSourceMocks.roomsOf.mockResolvedValue([]);
  });

  function serverResult(overrides: Partial<SpatialQueryResult> = {}): SpatialQueryResult {
    return {
      success: true,
      truncated: false,
      total_count: 1,
      returned_count: 1,
      page: 1,
      per_page: 100,
      has_more: false,
      results: [{ refno: 'server_only', noun: 'EQUI', spec_value: 2, distance: 18 }],
      groups: [{ spec_value: 2, count: 1 }],
      dbnum_groups: [{ dbnum: 24381, count: 1 }],
      ...overrides,
    };
  }

  function makeStore(overrides: Parameters<typeof createSpatialQueryStore>[0] = {}) {
    const viewer = createViewerStub();
    return {
      viewer,
      store: createSpatialQueryStore({
        viewerRef: { value: viewer } as any,
        selection: { selectedRefno: { value: 'loaded_a' } } as any,
        toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
        ...overrides,
      }),
    };
  }

  it('在册清单：源认房间才拉；status / reason / 清单归一进 roomOptions；已 ready 不重拉，force 才重拉；源不认房间直接 unsupported', async () => {
    const { store } = makeStore();
    expect(store.roomsStatus.value).toEqual({ status: 'idle', reason: null });
    await store.loadRoomOptions();
    expect(spatialSourceMocks.rooms).toHaveBeenCalledTimes(1);
    expect(store.roomsStatus.value).toEqual({ status: 'ready', reason: null });
    expect(store.roomOptions.value).toEqual([
      { refno: '17496_1', roomNum: 'A101', name: '/A101-RM', dbnum: 17496, panelCount: 4 },
      { refno: '17497_1', roomNum: 'A101', name: '/A101-RM-B', dbnum: 17497, panelCount: 2 },
      { refno: '17496_2', roomNum: 'B202', name: null, dbnum: 17496, panelCount: 3 },
    ]);
    await store.loadRoomOptions();
    expect(spatialSourceMocks.rooms).toHaveBeenCalledTimes(1);
    await store.loadRoomOptions({ force: true });
    expect(spatialSourceMocks.rooms).toHaveBeenCalledTimes(2);

    spatialSourceMocks.rooms.mockResolvedValueOnce({ success: true, status: 'disabled', reason: 'room_membership=false', definition_version: null, rooms: [] });
    await store.loadRoomOptions({ force: true });
    expect(store.roomsStatus.value).toEqual({ status: 'disabled', reason: 'room_membership=false' });

    spatialSourceMocks.rooms.mockRejectedValueOnce(new Error('HTTP 500'));
    await store.loadRoomOptions({ force: true });
    expect(store.roomsStatus.value).toEqual({ status: 'error', reason: 'HTTP 500' });

    spatialSourceMocks.state.rooms = false;
    const { store: legacy } = makeStore();
    await legacy.loadRoomOptions();
    expect(legacy.roomsStatus.value.status).toBe('unsupported');
    expect(spatialSourceMocks.rooms).toHaveBeenCalledTimes(4);
  });

  it('已选房间：按 refno 去重加 / 删 / 清；手输房间号精确匹配、同号多间全加并报 duplicated、没有的进 missing', async () => {
    const { store } = makeStore();
    expect(store.addRooms([{ refno: '17496/9', roomNum: 'X9', name: null }, { refno: '17496_9', roomNum: 'X9', name: null }]))
      .toEqual([{ refno: '17496_9', roomNum: 'X9', name: null }]);
    expect(store.draft.rooms).toHaveLength(1);

    const result = await store.addRoomsByNumber(' a101, B202 ; Z999 ');
    expect(result.duplicated).toEqual(['a101']);
    expect(result.missing).toEqual(['Z999']);
    expect(result.added.map((room) => room.refno)).toEqual(['17496_1', '17497_1', '17496_2']);
    expect(store.draft.rooms.map((room) => room.refno)).toEqual(['17496_9', '17496_1', '17497_1', '17496_2']);

    // 再输一遍同号：已在已选里，不重复加
    expect((await store.addRoomsByNumber('A101')).added).toEqual([]);

    store.removeRoom('17497/1');
    expect(store.draft.rooms.map((room) => room.refno)).toEqual(['17496_9', '17496_1', '17496_2']);
    store.clearRooms();
    expect(store.draft.rooms).toEqual([]);
    expect(await store.addRoomsByNumber('   ')).toEqual({ added: [], missing: [], duplicated: [] });
  });

  it('「当前选中所在房间」：没选中报「请先选中」；有归属就按清单补房间号 / 名字加进已选，清单里没有的只带 refno；没归属报一句', async () => {
    const { store } = makeStore({ selection: { selectedRefno: { value: null } } as any, viewerRef: { value: { ...createViewerStub(), scene: { ...createViewerStub().scene, selectedObjectIds: [] } } } as any });
    expect(await store.applySelectedRefnoRooms()).toEqual({ refno: null, added: [], error: '请先选中一个模型' });

    spatialSourceMocks.roomsOf.mockResolvedValueOnce(['17496/1', '17496_77']);
    const { store: withSelection } = makeStore({ selection: { selectedRefno: { value: '24381/145018' } } as any });
    const result = await withSelection.applySelectedRefnoRooms();
    expect(spatialSourceMocks.roomsOf).toHaveBeenCalledWith('24381_145018');
    expect(result).toEqual({
      refno: '24381_145018',
      added: [
        { refno: '17496_1', roomNum: 'A101', name: '/A101-RM' },
        { refno: '17496_77', roomNum: '', name: null },
      ],
      error: null,
    });
    expect(withSelection.draft.rooms).toHaveLength(2);

    spatialSourceMocks.roomsOf.mockResolvedValueOnce([]);
    const empty = await withSelection.applySelectedRefnoRooms();
    expect(empty.added).toEqual([]);
    expect(empty.error).toContain('不在任何在册房间');

    spatialSourceMocks.roomsOf.mockRejectedValueOnce(new Error('lookup 500'));
    expect((await withSelection.applySelectedRefnoRooms()).error).toBe('lookup 500');
  });

  it('请求：已选房间的 refno 逗号串进 rooms=（nearby 与全集 refnos 都带）；没选房间就不带这一格；roomStatus 进结果集', async () => {
    const queryNearbyByPosition = vi.fn(async (_x: number, _y: number, _z: number, _radius: number, options?: { rooms?: string }): Promise<SpatialQueryResult> => serverResult({
      total_count: 2,
      has_more: true,
      per_page: 1,
      // 服务端只在请求带了 rooms 时给 room_status
      ...(options?.rooms
        ? {
          room_status: {
            rooms: [{ refno: '17496/1', room_num: 'A101' }],
            source: 'memory',
            matched: 2,
            unresolved: 1,
            definition_version: 'g1',
            library_alignment_current: null,
          },
          warnings: ['房间过滤：1 个候选没有内存投影记录、判不出房间归属，已从结果剔除（先显示它们再查会被纳入）'],
        }
        : {}),
    }));
    const queryNearbyRefnos = vi.fn(async (): Promise<SpatialNearbyRefnosResult> => ({
      success: true,
      refnos: ['server_only', 'other'],
      by_dbnum: { '24381': ['server_only', 'other'] },
      by_spec_value: { '2': ['server_only', 'other'] },
      total_count: 2,
      truncated: false,
      cap: 100000,
    }));
    const { store } = makeStore({ queryNearbyByPosition, queryNearbyRefnos });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'coordinates';
    store.draft.center = { x: 500, y: 500, z: 500 };
    store.draft.radius = 50;
    store.draft.limit = 1;
    store.addRooms([{ refno: '17496_1', roomNum: 'A101', name: null }, { refno: '17496_2', roomNum: 'B202', name: null }]);

    await store.submitQuery();
    expect(store.status.value).toBe('ready');
    expect(queryNearbyByPosition).toHaveBeenCalledWith(500, 500, 500, 50, expect.objectContaining({ rooms: '17496_1,17496_2' }));
    expect(queryNearbyRefnos).toHaveBeenCalledWith(expect.objectContaining({ rooms: '17496_1,17496_2' }));
    expect(store.resultSet.value?.request.filters.rooms).toEqual(['17496_1', '17496_2']);
    expect(store.resultSet.value?.roomStatus).toEqual({
      rooms: [{ refno: '17496_1', roomNum: 'A101' }],
      source: 'memory',
      matched: 2,
      unresolved: 1,
      definitionVersion: 'g1',
      libraryAlignmentCurrent: null,
    });
    expect(store.resultSet.value?.warnings.some((warning) => warning.includes('1 个候选'))).toBe(true);

    store.clearRooms();
    await store.submitQuery();
    const lastCall = queryNearbyByPosition.mock.calls.at(-1)!;
    expect(lastCall[4]).not.toHaveProperty('rooms');
    expect(store.resultSet.value?.roomStatus).toBeNull();
  });

  it('带房间过滤时本地独有命中不追加（归属只有服务端判得出），「仅看已加载」也不走纯本地路径', async () => {
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => serverResult());
    const { store } = makeStore({ queryNearbyByPosition });
    store.draft.mode = 'range';
    store.draft.rangeCenterSource = 'selected';
    store.draft.radius = 50;

    // 对照：没有房间过滤时，本地已加载的 loaded_a（不在服务端结果里）作为本地独有命中追加进来
    await store.submitQuery();
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_only', 'loaded_a']);

    store.addRooms([{ refno: '17496_1', roomNum: 'A101', name: null }]);
    await store.submitQuery();
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['server_only']);
    expect(store.resultSet.value?.total).toBe(1);

    // 「仅看已加载」+ 房间：改前走纯本地扫描（不打服务端）；现在必须问服务端，并在本页内后筛 + 提示
    store.draft.onlyLoaded = true;
    queryNearbyByPosition.mockClear();
    await store.submitQuery();
    expect(queryNearbyByPosition).toHaveBeenCalledTimes(1);
    expect(store.resultSet.value?.localOnly).toBe(false);
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual([]);
    expect(store.resultSet.value?.warnings.some((warning) => warning.includes('以服务端房间归属为准'))).toBe(true);

    store.clearRooms();
    queryNearbyByPosition.mockClear();
    await store.submitQuery();
    expect(queryNearbyByPosition).not.toHaveBeenCalled();
    expect(store.resultSet.value?.localOnly).toBe(true);
  });

  it('分组维度（Q11）：有专业维度缺省按专业、可切按库；没有专业维度的源只能按库，setGroupDimension 也拨不到专业', () => {
    const { store } = makeStore();
    expect(store.groupDimension.value).toBe('spec');
    store.setGroupDimension('dbnum');
    expect(store.groupDimension.value).toBe('dbnum');
    store.setGroupDimension('spec');
    expect(store.groupDimension.value).toBe('spec');

    // 数据源是页面级开关（换源 = 重新建 store），所以按建 store 时的能力定初值
    spatialSourceMocks.state.specValues = false;
    const { store: noSpec } = makeStore();
    expect(noSpec.groupDimension.value).toBe('dbnum');
    noSpec.setGroupDimension('spec');
    expect(noSpec.groupDimension.value).toBe('dbnum');
  });

  it('v1 源有了专业维度：范围查询缺省仍「先专业后距离」，spec_value 直接进结果项与分组', async () => {
    const queryNearbyByPosition = vi.fn(async (): Promise<SpatialQueryResult> => serverResult({
      results: [
        { refno: 'server_only', noun: 'EQUI', spec_value: 6, dbnum: 24381, distance: 18 },
        { refno: 'server_two', noun: 'PIPE', spec_value: 1, dbnum: 7997, distance: 20 },
      ],
      groups: [{ spec_value: 1, count: 1 }, { spec_value: 6, count: 1 }],
      dbnum_groups: [{ dbnum: 7997, count: 1 }, { dbnum: 24381, count: 1 }],
      total_count: 2,
      returned_count: 2,
    }));
    const { store } = makeStore({ queryNearbyByPosition });
    store.setMode('range');
    expect(store.draft.sortBy).toBe('specThenDistance');
    store.draft.rangeCenterSource = 'coordinates';
    store.draft.center = { x: 500, y: 500, z: 500 };
    store.draft.radius = 50;
    await store.submitQuery();
    expect(queryNearbyByPosition).toHaveBeenCalledWith(500, 500, 500, 50, expect.objectContaining({ sort: 'spec_distance' }));
    expect(store.resultSet.value?.items.map((item) => [item.refno, item.specValue, item.specName])).toEqual([
      ['server_only', 6, '结构系统'],
      ['server_two', 1, '管道系统'],
    ]);
    expect(store.resultSet.value?.groups.map((group) => [group.specValue, group.specName, group.count])).toEqual([
      [1, '管道系统', 1],
      [6, '结构系统', 1],
    ]);
    expect(store.resultSet.value?.dbnumGroups).toEqual([{ dbnum: 7997, count: 1 }, { dbnum: 24381, count: 1 }]);
  });
});

describe('房间层级树（ADR 0068，plan 2026-09-20 spatial-room-hierarchy-tree）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetNegativeNounRegistryForTests();
    spatialSourceMocks.state.kind = 'gen-model-v1';
    spatialSourceMocks.state.specValues = true;
    spatialSourceMocks.state.rooms = true;
    spatialSourceMocks.state.tree = true;
    spatialSourceMocks.state.branCenterline = true;
    spatialSourceMocks.state.keywordMatchesName = false;
    spatialSourceMocks.state.nameSortExact = false;
  });

  /** 两间房、跨房构件 shared_b（R2 里也出）、一个「其他构件」PANE；loaded_a 在查看器里已加载。 */
  function treeResult(overrides: Partial<SpatialTreeResult> = {}): SpatialTreeResult {
    return {
      success: true,
      total_count: 4,
      candidate_count: 6,
      truncated_candidates: false,
      candidate_cap: 200000,
      leaves_inline: true,
      leaf_cap: 5000,
      leaf_count: 5,
      inlined: null,
      delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'],
      center: { x: 5, y: 5, z: 5, source: 'refno_aabb_center' },
      radius: 3000,
      shape: 'sphere',
      room_status: { rooms: [{ refno: 'room_1', room_num: 'R1' }, { refno: 'room_2', room_num: 'R2' }], source: 'memory', matched: 4, unresolved: 0, definition_version: 'g1', library_alignment_current: null },
      rooms: [
        {
          refno: 'room_1',
          room_num: 'R1',
          name: '/R1-RM',
          count: 4,
          specs: [
            {
              spec_value: 0,
              count: 1,
              unit_types: [],
              others: { count: 1, by_noun: [{ noun: 'PANE', count: 1, min_distance: 30, elements: [{ refno: 'pane_1', noun: 'PANE', distance: 30 }] }] },
            },
            {
              spec_value: 1,
              count: 3,
              unit_types: [
                {
                  noun: 'BRAN',
                  count: 3,
                  units: [
                    {
                      refno: 'bran_1',
                      noun: 'BRAN',
                      name: '/B1',
                      count: 3,
                      min_distance: 0,
                      elements: [
                        { refno: 'loaded_a', noun: 'TUBI', distance: 0 },
                        { refno: 'server_only', noun: 'ELBO', distance: 15 },
                        { refno: 'shared_b', noun: 'TUBI', distance: 20, shared_rooms: 2 },
                      ],
                    },
                  ],
                },
              ],
              others: { count: 0, by_noun: [] },
            },
          ],
        },
        {
          refno: 'room_2',
          room_num: 'R2',
          name: null,
          count: 1,
          specs: [
            {
              spec_value: 1,
              count: 1,
              unit_types: [{ noun: 'BRAN', count: 1, units: [{ refno: 'bran_1', noun: 'BRAN', name: '/B1', count: 1, min_distance: 20, elements: [{ refno: 'shared_b', noun: 'TUBI', distance: 20, shared_rooms: 2 }] }] }],
              others: { count: 0, by_noun: [] },
            },
          ],
        },
      ],
      ...overrides,
    };
  }

  function facetResult(): SpatialQueryResult {
    return {
      success: true,
      total_count: 5,
      returned_count: 1,
      page: 1,
      per_page: 1,
      has_more: true,
      results: [{ refno: 'loaded_a', noun: 'TUBI', spec_value: 1, distance: 0 }],
      filter_options: { include_negative: false, nouns: [{ value: 'TUBI', count: 3 }, { value: 'PANE', count: 1 }], spec_values: [{ value: 1, count: 3 }, { value: 0, count: 1 }] },
      groups: [{ spec_value: 0, count: 1 }, { spec_value: 1, count: 4 }],
      dbnum_groups: [{ dbnum: 24381, count: 5 }],
    };
  }

  function makeStore(overrides: Parameters<typeof createSpatialQueryStore>[0] = {}) {
    const viewer = createViewerStub();
    const store = createSpatialQueryStore({
      viewerRef: { value: viewer } as any,
      selection: { selectedRefno: { value: 'loaded_a' } } as any,
      toolStore: { pickedQueryCenter: { value: null }, setToolMode: vi.fn(), setPickedQueryCenter: vi.fn() } as any,
      ...overrides,
    });
    store.setMode('range');
    store.draft.rangeCenterSource = 'coordinates';
    store.draft.center = { x: 500, y: 500, z: 500 };
    store.draft.radius = 3000;
    store.addRooms([{ refno: 'room_1', roomNum: 'R1', name: '/R1-RM' }, { refno: 'room_2', roomNum: 'R2', name: null }]);
    return { viewer, store };
  }

  it('选了房间且源有树：打树路由（带 rooms）+ 同参 nearby 只取 1 条拿 facet；结果集带 tree，items = 叶子按 refno 去重、按请求排序（范围缺省先专业后距离），total = 去重数、不分页、全集 = 整树', async () => {
    const fetchTree = vi.fn(async (_params: SpatialNearbyParams, _only?: SpatialTreeLeafSelector): Promise<SpatialTreeResult> => treeResult());
    const queryNearbyByPosition = vi.fn(async () => facetResult());
    const queryNearbyRefnos = vi.fn();
    const { store } = makeStore({ fetchTree, queryNearbyByPosition, queryNearbyRefnos });

    await store.submitQuery();

    expect(store.status.value).toBe('ready');
    expect(store.error.value).toBeNull();
    expect(fetchTree).toHaveBeenCalledTimes(1);
    expect(fetchTree.mock.calls[0]![0]).toEqual(expect.objectContaining({ x: 500, y: 500, z: 500, radius: 3000, rooms: 'room_1,room_2' }));
    // facet 那一发只取 1 条
    expect(queryNearbyByPosition).toHaveBeenCalledWith(500, 500, 500, 3000, expect.objectContaining({ per_page: 1, page: 1, rooms: 'room_1,room_2' }));
    // 叶子内联：全集就是整树，不另打 refnos
    expect(queryNearbyRefnos).not.toHaveBeenCalled();

    const result = store.resultSet.value!;
    expect(result.tree?.total_count).toBe(4);
    expect(result.items.map((item) => item.refno)).toEqual(['pane_1', 'loaded_a', 'server_only', 'shared_b']);
    expect(result.items.map((item) => item.specValue)).toEqual([0, 1, 1, 1]);
    expect(result.items.find((item) => item.refno === 'loaded_a')?.loaded).toBe(true);
    expect(result.items.find((item) => item.refno === 'server_only')?.loaded).toBe(false);
    expect(result.total).toBe(4);
    expect(result.totalPages).toBe(1);
    expect(result.hasMore).toBe(false);
    // 全集按树的遍历序（房间 → 专业 → 单元 → 构件），跨房构件只出现一次
    expect(result.fullMatches?.refnos).toEqual(['pane_1', 'loaded_a', 'server_only', 'shared_b']);
    expect(result.fullMatches?.bySpecValue).toEqual({ '0': ['pane_1'], '1': ['loaded_a', 'server_only', 'shared_b'] });
    // facet / 按库分组来自那一发 nearby，专业分组按树去重数
    expect(result.filterOptions?.specValues.map((spec) => [spec.value, spec.count])).toEqual([[1, 3], [0, 1]]);
    expect(result.dbnumGroups).toEqual([{ dbnum: 24381, count: 5 }]);
    expect(result.groups.map((group) => [group.specValue, group.count])).toEqual([[0, 1], [1, 3]]);
    expect(result.roomStatus?.matched).toBe(4);
    expect(result.center).toEqual(expect.objectContaining({ x: 5, y: 5, z: 5 }));
    // 服务端解出的中心写回草稿（与平铺态同）
    expect(store.draft.center).toEqual({ x: 5, y: 5, z: 5 });
  });

  it('树路由「不支持」（源 / 旧构建没这条）退回平铺分组：nearby 按草稿每页数打、结果集没有 tree；真错误（房间体制不可用）直接报错清结果', async () => {
    const queryNearbyByPosition = vi.fn(async () => ({ ...facetResult(), per_page: 100, has_more: false, total_count: 1 }));
    const { store } = makeStore({ queryNearbyByPosition });

    await store.submitQuery();
    expect(store.status.value).toBe('ready');
    expect(spatialSourceMocks.tree).toHaveBeenCalledTimes(1);
    // 树不支持 → 平铺：nearby 只打一次、每页数是草稿的（不是 facet 那一发的 1）
    const perPages = queryNearbyByPosition.mock.calls.map((call) => (call as unknown[])[4] as { per_page?: number }).map((options) => options.per_page);
    expect(perPages).toEqual([1, 100]);
    expect(store.resultSet.value?.tree).toBeUndefined();
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a']);

    const fetchTree = vi.fn(async (): Promise<SpatialTreeResult> => ({ ...treeResult(), success: false, error: '房间过滤此刻不可用（disabled）', rooms: [] }));
    const { store: failing } = makeStore({ fetchTree, queryNearbyByPosition });
    await failing.submitQuery();
    expect(failing.status.value).toBe('error');
    expect(failing.error.value).toBe('房间过滤此刻不可用（disabled）');
    expect(failing.resultSet.value).toBeNull();

    // 没选房间：树一次都不打
    const { store: noRooms } = makeStore({ fetchTree, queryNearbyByPosition });
    noRooms.clearRooms();
    fetchTree.mockClear();
    await noRooms.submitQuery();
    expect(fetchTree).not.toHaveBeenCalled();
    expect(noRooms.resultSet.value?.tree).toBeUndefined();
  });

  it('叶子未内联（超上限）：items 空、warning 说构件太多、全集另取 refnos；expandTreeLeaves 按 unit= 补叶子并并进 items；节点动作按 refno 作用', async () => {
    const stripped = (): SpatialTreeResult => {
      const tree = treeResult({ leaves_inline: false, leaf_count: 6000 });
      for (const room of tree.rooms) {
        for (const spec of room.specs) {
          for (const group of spec.unit_types) for (const unit of group.units) delete unit.elements;
          for (const group of spec.others.by_noun) delete group.elements;
        }
      }
      return tree;
    };
    const fetchTree = vi.fn(async (_params: SpatialNearbyParams, only?: SpatialTreeLeafSelector): Promise<SpatialTreeResult> => {
      if (only && 'unit' in only) {
        const partial = stripped();
        partial.inlined = `unit:${only.unit}`;
        partial.rooms[0]!.specs[1]!.unit_types[0]!.units[0]!.elements = [
          { refno: 'loaded_a', noun: 'TUBI', distance: 0 },
          { refno: 'server_only', noun: 'ELBO', distance: 15 },
          { refno: 'shared_b', noun: 'TUBI', distance: 20, shared_rooms: 2 },
        ];
        partial.rooms[1]!.specs[0]!.unit_types[0]!.units[0]!.elements = [{ refno: 'shared_b', noun: 'TUBI', distance: 20, shared_rooms: 2 }];
        return partial;
      }
      return stripped();
    });
    const queryNearbyByPosition = vi.fn(async () => facetResult());
    const queryNearbyRefnos = vi.fn(async (): Promise<SpatialNearbyRefnosResult> => ({
      success: true,
      refnos: ['loaded_a', 'server_only', 'shared_b', 'pane_1'],
      by_dbnum: {},
      by_spec_value: { '1': ['loaded_a', 'server_only', 'shared_b'], '0': ['pane_1'] },
      total_count: 4,
      truncated: false,
      cap: 100000,
    }));
    const { store, viewer } = makeStore({ fetchTree, queryNearbyByPosition, queryNearbyRefnos });

    await store.submitQuery();
    const result = store.resultSet.value!;
    expect(result.tree?.leaves_inline).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(4);
    expect(queryNearbyRefnos).toHaveBeenCalledTimes(1);
    expect(result.fullMatches?.refnos).toEqual(['loaded_a', 'server_only', 'shared_b', 'pane_1']);
    expect(result.warnings.some((warning) => warning.includes('6000') && warning.includes('5000'))).toBe(true);

    await store.expandTreeLeaves({ unit: 'bran_1' });
    expect(fetchTree).toHaveBeenLastCalledWith(expect.objectContaining({ rooms: 'room_1,room_2' }), { unit: 'bran_1' });
    const expanded = store.resultSet.value!;
    expect(expanded.tree?.rooms[0]?.specs[1]?.unit_types[0]?.units[0]?.elements?.map((leaf) => leaf.refno)).toEqual(['loaded_a', 'server_only', 'shared_b']);
    expect(expanded.tree?.rooms[1]?.specs[0]?.unit_types[0]?.units[0]?.elements?.length).toBe(1);
    // PANE 组还没取，仍没有 elements
    expect(expanded.tree?.rooms[0]?.specs[0]?.others.by_noun[0]?.elements).toBeUndefined();
    expect(expanded.items.map((item) => [item.refno, item.loaded])).toEqual([['loaded_a', true], ['server_only', false], ['shared_b', false]]);

    // 节点动作：只留这几个可见 / 隔离
    store.showOnlyRefnos(['loaded_a']);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['loaded_a'], true);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['server_only', 'shared_b', 'pane_1'], false);
    expect(store.resultSet.value?.items.find((item) => item.refno === 'server_only')?.visible).toBe(false);
    store.isolateRefnos(['shared_b', 'loaded_a']);
    expect(viewer.scene.setObjectsXRayed).toHaveBeenCalledWith(['loaded_a', 'loaded_b'], true);
    expect(viewer.scene.setObjectsXRayed).toHaveBeenCalledWith(['shared_b', 'loaded_a'], false);
  });
});
