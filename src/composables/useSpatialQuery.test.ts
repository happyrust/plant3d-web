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
    expect(store.resultSet.value?.total).toBe(2);
    expect(store.resultSet.value?.loadedCount).toBe(1);
    expect(store.resultSet.value?.unloadedCount).toBe(1);
    expect(store.resultSet.value?.items.map((item) => [item.refno, item.loaded])).toEqual([
      ['loaded_a', true],
      ['server_only', false],
    ]);
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
