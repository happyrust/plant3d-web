import { beforeEach, describe, expect, it, vi } from 'vitest';

const spatialApiMocks = vi.hoisted(() => ({
  postSpaceNearestPoints: vi.fn(),
}));

vi.mock('@/api/genModelSpatialApi', () => ({
  postSpaceNearestPoints: spatialApiMocks.postSpaceNearestPoints,
}));

import { usePipeDistanceStore } from './usePipeDistanceStore';

function nearestPointsResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    unit: 'mm',
    source: { refno: '24381_1001', noun: 'BRAN', kind: 'bran_centerline' },
    results: [
      {
        refno: '24381_1002',
        noun: 'BRAN',
        spec_value: 1,
        distance_mm: 320,
        intersects: false,
        method: 'centerline_aabb',
        source_point: { x: 1, y: 2, z: 3 },
        target_point: { x: 1, y: 2, z: 323 },
        vector: { dx: 0, dy: 0, dz: 320 },
        aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe('usePipeDistanceStore · 净距检测', () => {
  beforeEach(() => {
    spatialApiMocks.postSpaceNearestPoints.mockReset();
    const store = usePipeDistanceStore();
    store.clearResults();
    store.clearBranRefnos();
  });

  it('以第一个 refno 为源、其余为目标调用服务端最近点', async () => {
    spatialApiMocks.postSpaceNearestPoints.mockResolvedValue(nearestPointsResponse());
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381/1001', '24381_1002']);

    expect(store.selectedBranRefnos.value).toEqual(['24381_1001', '24381_1002']);
    expect(spatialApiMocks.postSpaceNearestPoints).toHaveBeenCalledWith({
      source_refno: '24381_1001',
      target_refnos: ['24381_1002'],
      max_results: 1,
    });
    expect(store.detectError.value).toBeNull();
    expect(store.results.value).toHaveLength(1);
    expect(store.results.value[0]).toMatchObject({
      pipeA: '24381_1001',
      pipeB: '24381_1002',
      distance: 320,
      start: [1, 2, 3],
      end: [1, 2, 323],
    });
    expect(store.activeResultIndex.value).toBe(0);
  });

  it('transformPoint 会作用到两个标注端点上', async () => {
    spatialApiMocks.postSpaceNearestPoints.mockResolvedValue(nearestPointsResponse());
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002'], {
      transformPoint: ([x, y, z]) => [x * 2, y * 2, z * 2],
    });

    expect(store.results.value[0]).toMatchObject({
      start: [2, 4, 6],
      end: [2, 4, 646],
    });
  });

  it('服务端退回包围盒口径时把 warning 透出给用户', async () => {
    spatialApiMocks.postSpaceNearestPoints.mockResolvedValue(
      nearestPointsResponse({ warnings: ['BRAN 中心线获取失败，已退回包围盒口径: boom'] }),
    );
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002']);

    expect(store.results.value).toHaveLength(1);
    expect(store.detectError.value).toContain('已退回包围盒口径');
  });

  it('少于 2 个构件时不发请求', async () => {
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001']);

    expect(spatialApiMocks.postSpaceNearestPoints).not.toHaveBeenCalled();
    expect(store.detectError.value).toContain('至少选择 2 个构件');
  });
});
