import { beforeEach, describe, expect, it, vi } from 'vitest';

const v1ApiMocks = vi.hoisted(() => ({
  genModelV1SurfaceClearance: vi.fn(),
}));

vi.mock('@/api/genModelV1Api', () => ({
  genModelV1SurfaceClearance: v1ApiMocks.genModelV1SurfaceClearance,
  isGenModelV1ApiError: (e: unknown) => e instanceof Error && e.name === 'GenModelV1ApiError',
}));

import { usePipeDistanceStore } from './usePipeDistanceStore';

/** gen-model `/api/v1/spatial/surface-clearance` 一对源 / 目标的响应（E3D 世界 mm） */
function surfaceClearanceResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    unit: 'mm',
    method: 'surface_to_surface',
    accuracy_class: 'exact-surface',
    error_bound_mm: 0.5,
    target_kind: 'any',
    source: { refno: '24381/1001', noun: 'BRAN', leaf_count: 3, triangle_count: 300 },
    target: { refno: '24381/1002', noun: 'BRAN', leaf_count: 2, triangle_count: 200 },
    result: {
      distance_mm: 320,
      intersects: false,
      source_point: { x: 1, y: 2, z: 3 },
      target_point: { x: 1, y: 2, z: 323 },
      vector: { dx: 0, dy: 0, dz: 320 },
      source_leaf_refno: '24381/1101',
      target_leaf_refno: '24381/1201',
      target_leaf_noun: 'TUBI',
      target_face: null,
      perpendicular: null,
      witness: 'closest-points',
    },
    model: { source_sesno: 1, target_sesno: 1 },
    timing_ms: { load: 1, query: 1, total: 2 },
    warnings: [],
    ...overrides,
  };
}

describe('usePipeDistanceStore · 净距检测', () => {
  beforeEach(() => {
    v1ApiMocks.genModelV1SurfaceClearance.mockReset();
    const store = usePipeDistanceStore();
    store.clearResults();
    store.clearBranRefnos();
  });

  it('以第一个 refno 为源、其余逐个为目标向 gen-model 要外表面最近点', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381/1001', '24381_1002']);

    expect(store.selectedBranRefnos.value).toEqual(['24381_1001', '24381_1002']);
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(1);
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledWith({
      sourceRefno: '24381_1001',
      targetRefno: '24381_1002',
      targetKind: 'any',
      perpendicular: false,
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

  it('多个目标时每个目标一发，结果按目标顺序排', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(async ({ targetRefno }: { targetRefno: string }) =>
      surfaceClearanceResponse({
        result: {
          ...surfaceClearanceResponse().result,
          distance_mm: targetRefno === '24381_1002' ? 320 : 640,
        },
      }),
    );
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003']);

    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(2);
    expect(store.results.value.map((r) => [r.pipeB, r.distance])).toEqual([
      ['24381_1002', 320],
      ['24381_1003', 640],
    ]);
    expect(store.detectError.value).toBeNull();
  });

  it('transformPoint 会作用到两个标注端点上', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002'], {
      transformPoint: ([x, y, z]) => [x * 2, y * 2, z * 2],
    });

    expect(store.results.value[0]).toMatchObject({
      start: [2, 4, 6],
      end: [2, 4, 646],
    });
  });

  it('某一对 result 为 null 时其余照常出结果，并把 warning 透出给用户', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(async ({ targetRefno }: { targetRefno: string }) =>
      targetRefno === '24381_1003'
        ? surfaceClearanceResponse({ result: null, warnings: ['beyond_max_distance'] })
        : surfaceClearanceResponse(),
    );
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003']);

    expect(store.results.value).toHaveLength(1);
    expect(store.results.value[0]!.pipeB).toBe('24381_1002');
    expect(store.detectError.value).toContain('24381_1003');
    expect(store.detectError.value).toContain('beyond_max_distance');
  });

  it('某一对服务端报错（如 404 no_model_mesh）不拖垮整批', async () => {
    const apiError = new Error('not_found: no_model_mesh');
    apiError.name = 'GenModelV1ApiError';
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(async ({ targetRefno }: { targetRefno: string }) => {
      if (targetRefno === '24381_1003') throw apiError;
      return surfaceClearanceResponse();
    });
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003']);

    expect(store.results.value).toHaveLength(1);
    expect(store.detectError.value).toContain('24381_1003：not_found: no_model_mesh');
  });

  it('全部目标都没结果时给出可读的失败原因', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(
      surfaceClearanceResponse({ result: null, warnings: [] }),
    );
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002']);

    expect(store.results.value).toHaveLength(0);
    expect(store.activeResultIndex.value).toBeNull();
    expect(store.detectError.value).toContain('两侧网格在最大距离内没有靠近');
  });

  it('少于 2 个构件时不发请求', async () => {
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001']);

    expect(v1ApiMocks.genModelV1SurfaceClearance).not.toHaveBeenCalled();
    expect(store.detectError.value).toContain('至少选择 2 个构件');
  });
});
