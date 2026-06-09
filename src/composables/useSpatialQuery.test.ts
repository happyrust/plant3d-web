import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { createSpatialQueryStore } from './useSpatialQuery';

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
    expect(store.resultSet.value?.items.map((item) => item.refno)).toEqual(['loaded_a']);
    expect(store.resultSet.value?.groups.map((group) => group.specValue)).toEqual([1]);
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
      max_results: 20,
    }));
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
      shape: 'sphere',
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
    store.draft.nounText = 'EQUI';
    store.draft.specValues = [2];
    store.draft.limit = 10;

    await store.submitQuery(2);

    expect(queryNearbyByRefno).toHaveBeenCalledWith('loaded_a', 75, expect.objectContaining({
      include_self: false,
      nouns: 'EQUI',
      spec_values: '2',
      max_results: 10,
      page: 2,
      per_page: 10,
      shape: 'sphere',
    }));
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
      max_results: 25,
      page: 1,
      per_page: 25,
      shape: 'sphere',
    }));
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
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, specValues: [] },
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
        filters: { nouns: [], keyword: '', onlyLoaded: false, onlyVisible: false, specValues: [] },
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
});
