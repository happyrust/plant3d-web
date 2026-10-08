import { beforeEach, describe, expect, it, vi } from 'vitest';

const v1ApiMocks = vi.hoisted(() => ({
  genModelV1SurfaceClearance: vi.fn(),
  genModelV1SpatialNearbyBranches: vi.fn(),
}));

vi.mock('@/api/genModelV1Api', () => ({
  genModelV1SurfaceClearance: v1ApiMocks.genModelV1SurfaceClearance,
  genModelV1SpatialNearbyBranches: v1ApiMocks.genModelV1SpatialNearbyBranches,
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
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockReset();
    const store = usePipeDistanceStore();
    store.detachPersistence();
    store.clearResults();
    store.clearBranRefnos();
  });

  it('detects neighbours of the full finite branch with bounded exact queries and keeps drafts on query failure', async () => {
    const store = usePipeDistanceStore();
    store.maxDistance.value = 500;
    store.setBranRefnos(['24381_1001']);
    const nearby = { results: [1002, 1003].map(id => ({ refno: `24381/${id}`, noun: 'BRAN', distance: 20 })),
      total_count: 2, has_more: false, truncated_candidates: false, radius: 500, center: { source: 'refno_aabb_center' }, warnings: [] };
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValue(nearby);
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(async ({ targetRefno }: { targetRefno: string }) =>
      surfaceClearanceResponse({ result: { ...surfaceClearanceResponse().result, distance_mm: targetRefno.endsWith('1002') ? 320 : 600 } }));
    expect(await store.detectNearbyBrans('24381/1001')).toBe(true);
    expect(v1ApiMocks.genModelV1SpatialNearbyBranches).toHaveBeenCalledWith(expect.objectContaining({ refno: '24381_1001', radius: 500 }));
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(2);
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledWith(expect.objectContaining({ sourceRefno: '24381_1001', maxDistanceMm: 500, perpendicular: false }));
    expect(store.results.value).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify(store.results.value));
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockRejectedValue(new Error('unavailable'));
    expect(await store.detectNearbyBrans('24381_1001')).toBe(false);
    expect(store.results.value).toEqual(saved);
    expect(store.detectError.value).toContain('原有结果已保留');
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValue({ ...nearby, truncated_candidates: true });
    expect(await store.detectNearbyBrans('24381_1001')).toBe(true);
    expect(store.detectError.value).toContain('候选未全部计算');
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValue({ ...nearby, results: [], total_count: 0 });
    const last = JSON.parse(JSON.stringify(store.results.value));
    expect(await store.detectNearbyBrans('24381_1001')).toBe(true);
    expect(store.results.value).toEqual(last);
    let done!: (value: unknown) => void;
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockImplementation(() => new Promise(resolve => { done = resolve; }));
    const pending = store.detectNearbyBrans('24381_1001');
    store.setBranRefnos(['24381_9999']);
    done(nearby);
    expect(await pending).toBe(false);
    expect(store.selectedBranRefnos.value).toEqual(['24381_9999']);
    expect(store.results.value).toEqual(last);
    const rangeChanged = store.detectNearbyBrans('24381_9999');
    store.maxDistance.value = 600;
    done(nearby);
    expect(await rangeChanged).toBe(false);
    expect(store.detectError.value).toContain('检测范围已变化');
    expect(store.results.value).toEqual(last);
    store.maxDistance.value = 500;
    store.setBranRefnos(['24381_1001']);
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockReset();
    v1ApiMocks.genModelV1SurfaceClearance.mockClear();
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValueOnce({ ...nearby, total_count: 3, has_more: true })
      .mockResolvedValueOnce({ ...nearby, total_count: 3, results: [{ refno: '24381_1004', noun: 'BRAN', distance: 30 }] });
    expect(await store.detectNearbyBrans('24381_1001')).toBe(true);
    expect(v1ApiMocks.genModelV1SpatialNearbyBranches.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(3);
    expect(store.selectedBranRefnos.value).toEqual(['24381_1001', '24381_1002', '24381_1003', '24381_1004']);
    expect(store.detectError.value).toBeNull();
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValue({ ...nearby, total_count: 3, has_more: true });
    const unchanged = JSON.parse(JSON.stringify(store.results.value));
    expect(await store.detectNearbyBrans('24381_1001')).toBe(false);
    expect(store.detectError.value).toContain('分页没有进展');
    expect(store.results.value).toEqual(unchanged);
  });

  it('restores canonical mm points as stale and isolates contexts including late requests', async () => {
    const storage = new Map<string, string>();
    const local = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
    const store = usePipeDistanceStore();
    store.bindPersistence('project-A', local);
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { transformPoint: ([x, y, z]) => [x + 100, y, z] });
    store.bindPersistence('project-B', local);
    expect(store.results.value).toEqual([]);
    store.bindPersistence('project-A', local);
    expect(store.results.value[0]).toMatchObject({ status: 'stale', designPoints: { start: [1, 2, 3], end: [1, 2, 323] }, modelVersion: { sourceSesno: 1, targetSesno: 1 } });
    let resolve!: (value: unknown) => void;
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = store.autoDetectBrans(['24381_1001', '24381_1002']);
    store.bindPersistence('project-B', local, false);
    resolve(surfaceClearanceResponse());
    expect(await pending).toBe(false);
    expect(store.results.value).toEqual([]);
    v1ApiMocks.genModelV1SurfaceClearance.mockClear();
    expect(await store.autoDetectBrans(['24381_1001', '24381_1002'])).toBe(false);
    expect(v1ApiMocks.genModelV1SurfaceClearance).not.toHaveBeenCalled();
    store.detachPersistence();
  });

  it('preserves corrupt saved data and retries quota failures from memory', async () => {
    const values = new Map<string, string>([['plant3d-pipe-distance-v1:broken', '{broken']]);
    let fail = false;
    const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (fail) throw new Error('quota'); values.set(key, value); } };
    const store = usePipeDistanceStore();
    store.bindPersistence('broken', local);
    expect(store.persistRecords()).toBe(false);
    expect(values.get('plant3d-pipe-distance-v1:broken')).toBe('{broken');
    store.bindPersistence('valid', local);
    fail = true;
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    await store.autoDetectBrans(['24381_1001', '24381_1002']);
    store.bindPersistence('other', local);
    store.bindPersistence('valid', local);
    expect(store.results.value[0]?.status).toBe('stale');
    fail = false;
    expect(store.persistRecords()).toBe(true);
    expect(store.persistenceError.value).toBeNull();
    store.detachPersistence();
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

  it('批量模式包含目标之间的管对，规范化重复输入且反向管对保持同一标识', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    const store = usePipeDistanceStore();
    await store.autoDetectBrans(['24381/1001', '24381_1002', '24381_1003', '24381_1001'], { pairMode: 'all-pairs' });
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(3);
    expect(store.results.value.map(result => [result.pipeA, result.pipeB])).toEqual([
      ['24381_1001', '24381_1002'], ['24381_1001', '24381_1003'], ['24381_1002', '24381_1003'],
    ]);
    const identities = store.results.value.map(result => result.id).sort();
    await store.autoDetectBrans(['24381_1003', '24381_1002', '24381_1001'], { pairMode: 'all-pairs' });
    expect(store.results.value.map(result => result.id).sort()).toEqual(identities);
    expect(store.results.value.every(result => result.measurementKind === 'surface')).toBe(true);
  });

  it('批量模式使用距离上限并保留接触零距，超限和无效端点不产生标注', async () => {
    const store = usePipeDistanceStore();
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValueOnce(surfaceClearanceResponse({
      result: { ...surfaceClearanceResponse().result, distance_mm: 0, intersects: true },
    })).mockResolvedValueOnce(surfaceClearanceResponse({
      result: { ...surfaceClearanceResponse().result, distance_mm: store.maxDistance.value + 1 },
    })).mockResolvedValueOnce(surfaceClearanceResponse({
      result: { ...surfaceClearanceResponse().result, source_point: { x: NaN, y: 0, z: 0 } },
    }));
    await store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003'], { pairMode: 'all-pairs' });
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledWith(expect.objectContaining({ maxDistanceMm: store.maxDistance.value }));
    expect(store.results.value).toHaveLength(1);
    expect(store.results.value[0]!.distance).toBe(0);
    expect(store.detectError.value).toContain('最近点无效');
  });

  it('清空或新批次使旧查询失效，且最多同时发出4个查询', async () => {
    const resolvers: (() => void)[] = [];
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(() => new Promise(resolve => {
      resolvers.push(() => resolve(surfaceClearanceResponse()));
    }));
    const store = usePipeDistanceStore();
    const pending = store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003', '24381_1004'], { pairMode: 'all-pairs' });
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(4);
    store.clearResults();
    resolvers.forEach(resolve => resolve());
    expect(await pending).toBe(false);
    expect(store.results.value).toEqual([]);
    expect(store.isDetecting.value).toBe(false);
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(4);

    let finishOld!: () => void;
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementationOnce(() => new Promise(resolve => {
      finishOld = () => resolve(surfaceClearanceResponse());
    })).mockResolvedValue(surfaceClearanceResponse());
    const old = store.autoDetectBrans(['24381_1001', '24381_1002']);
    await store.autoDetectBrans(['24381_1003', '24381_1004']);
    finishOld();
    expect(await old).toBe(false);
    expect(store.results.value[0]).toMatchObject({ pipeA: '24381_1003', pipeB: '24381_1004' });
  });
});
