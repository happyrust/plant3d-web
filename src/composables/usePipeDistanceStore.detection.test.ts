import { beforeEach, describe, expect, it, vi } from 'vitest';

import { needsAxisEstimateFallback, usePipeDistanceStore, type PipeDetectionOutcome } from './usePipeDistanceStore';

import type { SurfaceClearanceResponse } from '@/api/genModelV1Api';

import { GenModelV1ApiError } from '@/api/genModelV1Api';
import { pipeDistanceInputs } from '@/clearance/adapters/pipeDistanceRecords';
import { pipeRowGapEstimated } from '@/clearance/domain/pipeRowTypes';
import { surfaceClearanceToRecord } from '@/clearance/services/clearanceService';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';

const v1ApiMocks = vi.hoisted(() => ({
  genModelV1SurfaceClearance: vi.fn(),
  genModelV1SpatialNearbyBranches: vi.fn(),
  genModelV1SpatialCenterline: vi.fn(),
  genModelV1ModelBounds: vi.fn(),
}));

vi.mock('@/api/genModelV1Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/genModelV1Api')>();
  return {
    ...actual,
    genModelV1SurfaceClearance: v1ApiMocks.genModelV1SurfaceClearance,
    genModelV1SpatialNearbyBranches: v1ApiMocks.genModelV1SpatialNearbyBranches,
    genModelV1SpatialCenterline: v1ApiMocks.genModelV1SpatialCenterline,
    genModelV1ModelBounds: v1ApiMocks.genModelV1ModelBounds,
  };
});

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

/** 记录行断言辅助：无序管对键（记录 id 有向，断言批量的「哪几对」用无序键才稳）。 */
function pairKey(sourceRefno: string, targetRefno: string): string {
  return [sourceRefno, targetRefno].sort().join('|');
}

/** gen-model `/api/v1/spatial/centerline` 一根沿 X 方向的平行直管（E3D 世界 mm）。 */
function centerlineResponse(refno: string, yMm: number, odMm = 114.3) {
  return {
    refno,
    dbnum: 100,
    segment_count: 1,
    outside_diameter_mm: odMm,
    source_version: { dbnum: 100, sesno: 7, databases: [] },
    centerline_bbox: null,
    segments: [
      {
        refno: `${refno}~0_1`,
        order: 0,
        noun: 'TUBI',
        implicit: true,
        start: { x: 0, y: yMm, z: 0 },
        end: { x: 5000, y: yMm, z: 0 },
        length_mm: 5000,
        outside_diameter_mm: odMm,
        diameter_evidence: { source: 'catalogue', catalogue_od_mm: odMm, arrive_bore_mm: null },
      },
    ],
    warnings: [],
  };
}

/** 一根管的真实中心线（E3D 世界 mm）：依次给出各段的名词与起止点。 */
function polylineResponse(refno: string, segments: [noun: string, start: [number, number, number], end: [number, number, number]][], odMm = 114.3) {
  const point = ([x, y, z]: [number, number, number]) => ({ x, y, z });
  return {
    ...centerlineResponse(refno, 0, odMm),
    segment_count: segments.length,
    segments: segments.map(([noun, start, end], order) => ({
      refno: `${refno}~${order}`,
      order,
      noun,
      implicit: noun === 'TUBI',
      start: point(start),
      end: point(end),
      length_mm: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
      outside_diameter_mm: odMm,
      diameter_evidence: { source: 'catalogue', catalogue_od_mm: odMm, arrive_bore_mm: null },
    })),
  };
}

describe('usePipeDistanceStore · 净距检测', () => {
  beforeEach(() => {
    v1ApiMocks.genModelV1SurfaceClearance.mockReset();
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockReset();
    v1ApiMocks.genModelV1ModelBounds.mockReset();
    v1ApiMocks.genModelV1SpatialCenterline.mockReset();
    // 缺省每根管一条互不相干的直线（相距 1 m 以上），所有管对都不判相连；连排与相连的用例各自覆盖
    v1ApiMocks.genModelV1SpatialCenterline.mockImplementation(async (refno: string) => centerlineResponse(refno, 1000 * Number(refno.replace(/^.*_/, ''))));
    useClearanceStore().clearRecords();
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
    expect(store.pipeResults.value).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify(store.pipeResults.value));
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockRejectedValue(new Error('unavailable'));
    expect(await store.detectNearbyBrans('24381_1001')).toBe(false);
    expect(store.pipeResults.value).toEqual(saved);
    expect(store.detectError.value).toContain('原有结果已保留');
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValue({ ...nearby, truncated_candidates: true });
    expect(await store.detectNearbyBrans('24381_1001')).toBe(true);
    expect(store.detectError.value).toBeNull();
    expect(store.detectNotice.value).toContain('候选未全部计算');
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValue({ ...nearby, results: [], total_count: 0 });
    const last = JSON.parse(JSON.stringify(store.pipeResults.value));
    expect(await store.detectNearbyBrans('24381_1001')).toBe(true);
    expect(store.detectError.value).toBeNull();
    expect(store.detectNotice.value).toContain('没有找到周边 BRAN 管道');
    expect(store.pipeResults.value).toEqual(last);
    let done!: (value: unknown) => void;
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockImplementation(() => new Promise(resolve => { done = resolve; }));
    const pending = store.detectNearbyBrans('24381_1001');
    store.setBranRefnos(['24381_9999']);
    done(nearby);
    expect(await pending).toBe(false);
    expect(store.selectedBranRefnos.value).toEqual(['24381_9999']);
    expect(store.pipeResults.value).toEqual(last);
    const rangeChanged = store.detectNearbyBrans('24381_9999');
    store.maxDistance.value = 600;
    done(nearby);
    expect(await rangeChanged).toBe(false);
    expect(store.detectError.value).toContain('检测范围已变化');
    expect(store.pipeResults.value).toEqual(last);
    store.maxDistance.value = 500;
    store.setBranRefnos(['24381_1001']);
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockReset();
    v1ApiMocks.genModelV1SurfaceClearance.mockClear();
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValueOnce({ ...nearby, total_count: 3, has_more: true })
      .mockResolvedValueOnce({ ...nearby, total_count: 3, results: [{ refno: '24381_1004', noun: 'BRAN', distance: 30 }] });
    expect(await store.detectNearbyBrans('24381_1001')).toBe(true);
    expect(v1ApiMocks.genModelV1SpatialNearbyBranches.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(3);
    // N5：周边检测不替换用户的已选管道列表，候选另存于 nearbyGroup
    expect(store.selectedBranRefnos.value).toEqual(['24381_1001']);
    expect(store.nearbyGroup.value?.sourceRefno).toBe('24381_1001');
    expect(store.nearbyGroup.value?.candidateRefnos).toEqual(['24381_1002', '24381_1003', '24381_1004']);
    expect(store.detectError.value).toBeNull();
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValue({ ...nearby, total_count: 3, has_more: true });
    const unchanged = JSON.parse(JSON.stringify(store.pipeResults.value));
    expect(await store.detectNearbyBrans('24381_1001')).toBe(false);
    expect(store.detectError.value).toContain('分页没有进展');
    expect(store.pipeResults.value).toEqual(unchanged);
  });

  it('restores records as stale and isolates contexts including late requests', async () => {
    const storage = new Map<string, string>();
    const local = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
    const clearance = useClearanceStore();
    const store = usePipeDistanceStore();
    // 生产接线：pipe 与 clearance 两个 store 绑同一个上下文（ViewerPanel:826 一带）
    clearance.bindPersistence('project-A', local);
    store.bindPersistence('project-A', local);
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    await store.autoDetectBrans(['24381_1001', '24381_1002']);
    expect(store.pipeResults.value).toHaveLength(1);
    clearance.bindPersistence('project-B', local);
    store.bindPersistence('project-B', local);
    expect(store.pipeResults.value).toEqual([]);
    clearance.bindPersistence('project-A', local);
    store.bindPersistence('project-A', local);
    expect(store.pipeResults.value[0]).toMatchObject({
      status: 'stale',
      snapshot: { sourcePoint: [0.001, 0.002, 0.003], targetPoint: [0.001, 0.002, 0.323] },
      modelVersion: { sourceSesno: 1, targetSesno: 1 },
    });
    let resolve: ((value: unknown) => void) | undefined;
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = store.autoDetectBrans(['24381_1001', '24381_1002']);
    await vi.waitFor(() => expect(resolve).toBeDefined());
    clearance.bindPersistence('project-B', local, false);
    store.bindPersistence('project-B', local, false);
    resolve!(surfaceClearanceResponse());
    expect(await pending).toBe(false);
    expect(store.pipeResults.value).toEqual([]);
    v1ApiMocks.genModelV1SurfaceClearance.mockClear();
    expect(await store.autoDetectBrans(['24381_1001', '24381_1002'])).toBe(false);
    expect(v1ApiMocks.genModelV1SurfaceClearance).not.toHaveBeenCalled();
    store.detachPersistence();
    clearance.detachPersistence();
  });

  it('preserves corrupt saved data and retries quota failures from memory', async () => {
    const values = new Map<string, string>([['plant3d-pipe-distance-v1:broken', '{broken']]);
    let fail = false;
    const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (fail) throw new Error('quota'); values.set(key, value); } };
    const clearance = useClearanceStore();
    const store = usePipeDistanceStore();
    clearance.bindPersistence('broken', local);
    store.bindPersistence('broken', local);
    expect(store.persistRecords()).toBe(false);
    expect(values.get('plant3d-pipe-distance-v1:broken')).toBe('{broken');
    store.bindPersistence('valid', local);
    clearance.bindPersistence('valid', local);
    fail = true;
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    await store.autoDetectBrans(['24381_1001', '24381_1002']);
    store.bindPersistence('other', local);
    clearance.bindPersistence('other', local);
    store.bindPersistence('valid', local);
    clearance.bindPersistence('valid', local);
    expect(store.pipeResults.value[0]?.status).toBe('stale');
    fail = false;
    expect(store.persistRecords()).toBe(true);
    expect(store.persistenceError.value).toBeNull();
    store.detachPersistence();
    clearance.detachPersistence();
  });

  it('以第一个 refno 为源、其余逐个为目标向 gen-model 要外表面最近点，结果落 ClearanceRecord', async () => {
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
    expect(store.pipeResults.value).toHaveLength(1);
    expect(store.pipeResults.value[0]).toMatchObject({
      inputs: { sourceRefno: '24381_1001', targetRefno: '24381_1002', targetKind: 'any' },
      kind: 'component-to-component',
      snapshot: { distanceM: 0.32, sourcePoint: [0.001, 0.002, 0.003], targetPoint: [0.001, 0.002, 0.323] },
      provenance: { method: 'surface-to-surface', accuracyClass: 'exact-surface' },
      modelVersion: { sourceSesno: 1, targetSesno: 1 },
    });
    expect(store.activeResultId.value).toBe(store.pipeResults.value[0]!.id);
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
    expect(store.pipeResults.value.map((record) => [record.inputs.targetRefno, record.snapshot!.distanceM * 1000])).toEqual([
      ['24381_1002', 320],
      ['24381_1003', 640],
    ]);
    expect(store.detectError.value).toBeNull();
  });

  it('某一对 result 为 null 时其余照常出结果，没靠近的只汇总成一句提示', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(async ({ targetRefno }: { targetRefno: string }) =>
      targetRefno === '24381_1003'
        ? surfaceClearanceResponse({ result: null, warnings: ['beyond_max_distance'] })
        : surfaceClearanceResponse(),
    );
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003']);

    expect(store.pipeResults.value).toHaveLength(1);
    expect(store.pipeResults.value[0]!.inputs.targetRefno).toBe('24381_1002');
    expect(store.detectError.value).toBeNull();
    expect(store.detectNotice.value).toBe('另有 1 对在服务端最大距离内没有靠近，未出结果');
    expect(store.lastRunOutcome.value).toEqual({ total: 2, settled: 1, beyond: 1, connected: 0, failed: 0 });
  });

  it('某一对服务端报错（如 404 no_model_mesh）不拖垮整批，现存记录标 failed', async () => {
    const apiError = new Error('not_found: no_model_mesh');
    apiError.name = 'GenModelV1ApiError';
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(async ({ targetRefno }: { targetRefno: string }) => {
      if (targetRefno === '24381_1003') throw apiError;
      return surfaceClearanceResponse();
    });
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003']);

    expect(store.pipeResults.value).toHaveLength(1);
    expect(store.detectError.value).toBe('24381_1001 ↔ 24381_1003：not_found: no_model_mesh');

    // 下一轮同一对报错：那条记录不消失，标 failed 留住旧快照
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(async ({ targetRefno }: { targetRefno: string }) => {
      if (targetRefno === '24381_1002') throw apiError;
      return surfaceClearanceResponse();
    });
    await store.autoDetectBrans(['24381_1001', '24381_1002']);
    expect(store.pipeResults.value[0]?.status).toBe('failed');
    expect(store.pipeResults.value[0]?.snapshot?.distanceM).toBeCloseTo(0.32);
  });

  it('全部管对都没靠近时只给提示，不算失败', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(
      surfaceClearanceResponse({ result: null, warnings: [] }),
    );
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001', '24381_1002']);

    expect(store.lastRunSettledCount.value).toBe(0);
    expect(store.activeResultId.value).toBeNull();
    expect(store.detectError.value).toBeNull();
    expect(store.detectNotice.value).toBe('所选 1 对管道在服务端最大距离内都没有靠近，未出结果');
  });

  it('连排模式：三根平行管出两对相邻，每对各两条记录；中间管取不到中心线时整批不出结果，两端不成相邻（R13）', async () => {
    const yByRefno: Record<string, number> = { '24381_1001': 0, '24381_1002': 300, '24381_1003': 600 };
    v1ApiMocks.genModelV1SpatialCenterline.mockImplementation(async (refno: string) => centerlineResponse(refno, yByRefno[refno]!));
    const store = usePipeDistanceStore();
    store.setBranRefnos(['24381_1001', '24381_1002', '24381_1003']);

    expect(await store.runPipeRowDetection()).toBe(true);

    const records = store.pipeResults.value;
    // 只量相邻：3 管 → 2 对（1001↔1002、1002↔1003），不出 1001↔1003；每对中心距 + 推导间隔
    expect(records).toHaveLength(4);
    expect(records.every(r => r.id.startsWith('piperow:center:'))).toBe(true);
    expect(records.filter(r => r.pipeRow?.metric === 'center-distance')).toHaveLength(2);
    expect(records.filter(r => r.pipeRow?.metric === 'derived-gap')).toHaveLength(2);
    const pairKeys = new Set(records.map(r => pairKey(r.inputs.sourceRefno, r.inputs.targetRefno)));
    expect(pairKeys).toEqual(new Set([
      pairKey('24381_1001~0_1', '24381_1002~0_1'),
      pairKey('24381_1002~0_1', '24381_1003~0_1'),
    ]));
    const gap = records.find(r => r.pipeRow?.metric === 'derived-gap');
    expect(gap?.snapshot?.distanceM).toBeCloseTo(0.1857, 6);
    expect(gap?.pipeRow?.signedGapM).toBeCloseTo(0.1857, 6);
    expect(store.detectError.value).toBeNull();

    // 中间管取不到中心线：整批不归排，不能把剩下的 1001、1003 当成相邻；它参与的旧记录标 failed 留快照
    v1ApiMocks.genModelV1SpatialCenterline.mockImplementation(async (refno: string) => {
      if (refno === '24381_1002') throw new Error('centerline 404');
      return centerlineResponse(refno, yByRefno[refno]!);
    });
    expect(await store.runPipeRowDetection()).toBe(false);

    expect(store.pipeResults.value).toHaveLength(4);
    const failedRecords = store.pipeResults.value.filter(r => r.status === 'failed');
    expect(failedRecords).toHaveLength(4);
    expect(failedRecords.every(r =>
      r.provenance.source.refno === '24381_1002' || r.provenance.target.refno === '24381_1002')).toBe(true);
    expect(failedRecords[0]?.snapshot).not.toBeNull();
    const acrossMissing = pairKey('24381_1001~0_1', '24381_1003~0_1');
    expect(store.pipeResults.value.some(r => pairKey(r.inputs.sourceRefno, r.inputs.targetRefno) === acrossMissing)).toBe(false);
    expect(store.lastRowDetection.value).toBeNull();
    expect(store.lastRunSettledCount.value).toBe(0);
    expect(store.detectError.value).toContain('24381_1002');
    expect(store.detectError.value).toContain('本次不生成连排结果');

    // 用户把 1002 移出选择后重检：剩下两根相邻，是这次选择下的结论
    store.setBranRefnos(['24381_1001', '24381_1003']);
    expect(await store.runPipeRowDetection()).toBe(true);
    const current = store.pipeResults.value.filter(r => r.status === 'current');
    expect(current).toHaveLength(2);
    expect(new Set(current.map(r => pairKey(r.inputs.sourceRefno, r.inputs.targetRefno)))).toEqual(new Set([acrossMissing]));
    expect(current.find(r => r.pipeRow?.metric === 'center-distance')?.snapshot?.distanceM).toBeCloseTo(0.6, 6);
  });

  it('连排模式：同一 BRAN 的 U 形回折两条腿可以作为相邻成员成对', async () => {
    const uTurn = {
      refno: '24381_1001',
      dbnum: 100,
      segment_count: 3,
      outside_diameter_mm: 114.3,
      source_version: { dbnum: 100, sesno: 7, databases: [] },
      centerline_bbox: null,
      segments: [
        { refno: '24381_1001~0_1', order: 0, noun: 'TUBI', implicit: true,
          start: { x: 0, y: 0, z: 0 }, end: { x: 5000, y: 0, z: 0 },
          length_mm: 5000, outside_diameter_mm: 114.3,
          diameter_evidence: { source: 'catalogue', catalogue_od_mm: 114.3, arrive_bore_mm: null } },
        { refno: '24381_1001_2', order: 1, noun: 'ELBO', implicit: false,
          start: { x: 5000, y: 0, z: 0 }, end: { x: 5000, y: 300, z: 0 },
          length_mm: 300, outside_diameter_mm: 114.3,
          diameter_evidence: { source: 'catalogue', catalogue_od_mm: 114.3, arrive_bore_mm: null } },
        { refno: '24381_1001~3_4', order: 2, noun: 'TUBI', implicit: true,
          start: { x: 5000, y: 300, z: 0 }, end: { x: 0, y: 300, z: 0 },
          length_mm: 5000, outside_diameter_mm: 114.3,
          diameter_evidence: { source: 'catalogue', catalogue_od_mm: 114.3, arrive_bore_mm: null } },
      ],
      warnings: [],
    };
    v1ApiMocks.genModelV1SpatialCenterline.mockImplementation(async (refno: string) =>
      refno === '24381_1001' ? uTurn : centerlineResponse(refno, 600));
    const store = usePipeDistanceStore();
    store.setBranRefnos(['24381_1001', '24381_1002']);

    expect(await store.runPipeRowDetection()).toBe(true);

    const records = store.pipeResults.value;
    // 三条直段一排：腿1(y=0)↔腿2(y=300) 同 BRAN 相邻 + 腿2↔外管(y=600) → 2 对 × 2 条
    expect(records).toHaveLength(4);
    const pairKeys = new Set(records.map(r => pairKey(r.inputs.sourceRefno, r.inputs.targetRefno)));
    expect(pairKeys).toEqual(new Set([
      pairKey('24381_1001~0_1', '24381_1001~3_4'),
      pairKey('24381_1001~3_4', '24381_1002~0_1'),
    ]));
    const sameBranKey = pairKey('24381_1001~0_1', '24381_1001~3_4');
    const sameBran = records.find(r =>
      pairKey(r.inputs.sourceRefno, r.inputs.targetRefno) === sameBranKey
      && r.pipeRow?.metric === 'center-distance');
    expect(sameBran?.snapshot?.distanceM).toBeCloseTo(0.3, 6);
    expect(sameBran?.provenance.source.refno).toBe('24381_1001');
    expect(sameBran?.provenance.target.refno).toBe('24381_1001');
  });

  it('连排模式按直段测量：只在所选直段上归排；重量的整条直段上的旧结果被替换，别的直段上的结果不动', async () => {
    const od = { outside_diameter_mm: 114.3, diameter_evidence: { source: 'catalogue', catalogue_od_mm: 114.3, arrive_bore_mm: null } };
    /** 一根 L 形管（E3D 世界 mm）：x 向一截被法兰隔成两段直管，弯头后 y 向一截；`base` 是法兰的 refno 号，弯头接着编。 */
    const lShape = (refno: string, base: number, z: number) => {
      const flan = `24381_${base}`;
      const elbo = `24381_${base + 1}`;
      return {
        refno, dbnum: 100, segment_count: 5, outside_diameter_mm: 114.3,
        source_version: { dbnum: 100, sesno: 7, databases: [] }, centerline_bbox: null, warnings: [],
        segments: [
          { refno: `Head~${flan}`, order: 0, noun: 'TUBI', implicit: true, start: { x: 0, y: 0, z }, end: { x: 2000, y: 0, z }, length_mm: 2000, ...od },
          { refno: flan, order: 1, noun: 'FLAN', implicit: false, start: { x: 2000, y: 0, z }, end: { x: 2100, y: 0, z }, length_mm: 100, ...od },
          { refno: `${flan}~${elbo}`, order: 2, noun: 'TUBI', implicit: true, start: { x: 2100, y: 0, z }, end: { x: 5000, y: 0, z }, length_mm: 2900, ...od },
          { refno: elbo, order: 3, noun: 'ELBO', implicit: false, start: { x: 5000, y: 0, z }, end: { x: 5100, y: 100, z }, length_mm: 141, ...od },
          { refno: `${elbo}~Tail`, order: 4, noun: 'TUBI', implicit: true, start: { x: 5100, y: 100, z }, end: { x: 5100, y: 3000, z }, length_mm: 2900, ...od },
        ],
      };
    };
    const lines: Record<string, ReturnType<typeof lShape>> = {
      '24381_1001': lShape('24381_1001', 2, 0),
      '24381_1002': lShape('24381_1002', 12, 300),
    };
    v1ApiMocks.genModelV1SpatialCenterline.mockImplementation(async (refno: string) => lines[refno]);
    const store = usePipeDistanceStore();
    const measuredPairs = () => new Set(store.pipeResults.value.map(r => pairKey(r.inputs.sourceRefno, r.inputs.targetRefno)));
    const legB = pairKey('24381_3~Tail', '24381_13~Tail');

    // 整根量：x 向、y 向两截各一对
    store.setBranRefnos(['24381_1001', '24381_1002']);
    expect(await store.runPipeRowDetection({ alignMode: 'center' })).toBe(true);
    expect(measuredPairs()).toEqual(new Set([pairKey('Head~24381_2', 'Head~24381_12'), legB]));

    // 只选法兰后那两段直管：x 向那截换成子直段的结果，截面在子直段共同区段的中点；y 向那截的旧结果不动
    store.setTubeKeys(['24381_1001#24381_2-24381_3#0', '24381/1002#24381/12-24381/13#0']);
    expect(store.selectedBranRefnos.value).toEqual(['24381_1001', '24381_1002']);
    expect(store.selectedTubeKeys.value).toEqual(['24381_1001#24381_2-24381_3#0', '24381_1002#24381_12-24381_13#0']);
    expect(await store.runPipeRowDetection({ alignMode: 'center' })).toBe(true);
    expect(measuredPairs()).toEqual(new Set([pairKey('24381_2~24381_3', '24381_12~24381_13'), legB]));
    const afterFlange = store.pipeResults.value.find(r => r.inputs.sourceRefno !== '24381_3~Tail' && r.inputs.sourceRefno !== '24381_13~Tail');
    expect(afterFlange?.pipeRow?.section.point[0]).toBeCloseTo(3.55, 6);
    expect(store.lastRowDetection.value?.groups).toHaveLength(1);
    expect(store.detectNotice.value ?? '').not.toContain('所选直段');

    // 换成头上那两段（直段一端是 BRAN 自己 → 中心线的 Head~）：同一截上一次的直段结果也被换掉
    store.setTubeKeys(['24381_1001#24381_1001-24381_2#0', '24381_1002#24381_1002-24381_12#0']);
    expect(await store.runPipeRowDetection({ alignMode: 'center' })).toBe(true);
    expect(measuredPairs()).toEqual(new Set([pairKey('Head~24381_2', 'Head~24381_12'), legB]));
    const head = store.pipeResults.value.find(r => r.inputs.sourceRefno.startsWith('Head~'));
    expect(head?.pipeRow?.section.point[0]).toBeCloseTo(1, 6);

    // 选到中心线里没有的直段：如实提示，不参与
    store.addTubeKey('24381_1001#24381_8-24381_9#0');
    expect(await store.runPipeRowDetection({ alignMode: 'center' })).toBe(true);
    expect(store.detectNotice.value).toContain('24381_1001：1 段所选直段不在可归排的直段上');

    // 选择口径：整根选回就丢它的直段；某根的直段去光，它跟着移出选择
    store.addBranRefno('24381_1001');
    expect(store.selectedTubeKeys.value).toEqual(['24381_1002#24381_1002-24381_12#0']);
    store.removeTubeKey('24381_1002#24381_1002-24381_12#0');
    expect(store.selectedBranRefnos.value).toEqual(['24381_1001']);
    expect(store.selectedTubeKeys.value).toEqual([]);

    // 直段随抽屉设置存取；格式不对的直段键整份拒收
    store.setTubeKeys(['24381_1001#24381_2-24381_3#0', '24381_1002#24381_12-24381_13#0']);
    const snapshot = store.captureSnapshot();
    store.clearBranRefnos();
    store.prepareSnapshotRestore(snapshot)();
    expect(store.selectedBranRefnos.value).toEqual(['24381_1001', '24381_1002']);
    expect(store.selectedTubeKeys.value).toEqual(['24381_1001#24381_2-24381_3#0', '24381_1002#24381_12-24381_13#0']);
    expect(() => store.prepareSnapshotRestore({ ...snapshot, selectedTubeKeys: ['24381_1001'] })).toThrow();
  });

  it('连排缺省：相邻上限 1000 mm、最短共同区段 300 mm（选了直段时不限）；穿过件等诊断收进可展开的详情', async () => {
    const store = usePipeDistanceStore();
    expect(store.pipeRowMaxAdjacentMm.value).toBe(1000);
    expect(store.pipeRowMinCommonMm.value).toBe(300);
    /** 一根沿 x 的直管：y 定位置，[x0, x1] 定直段范围；唯一一段是头上的隐式管身 `Head~<refno>0`。 */
    const line = (refno: string, y: number, x0: number, x1: number, warnings: string[] = []) => {
      const base = centerlineResponse(refno, y);
      return { ...base, warnings, segments: [{ ...base.segments[0]!, refno: `Head~${refno}0`, start: { x: x0, y, z: 0 }, end: { x: x1, y, z: 0 }, length_mm: x1 - x0 }] };
    };
    const lines: Record<string, ReturnType<typeof line>> = {
      '24381_1001': line('24381_1001', 0, 0, 5000, ['3 个成员没有长度（穿过件），不参与走廊']),
      '24381_1002': line('24381_1002', 300, 0, 5000),
      '24381_1003': line('24381_1003', 1600, 0, 5000),
      '24381_1004': line('24381_1004', -300, 4800, 6000),
    };
    v1ApiMocks.genModelV1SpatialCenterline.mockImplementation(async (refno: string) => lines[refno]);
    const measuredPairs = () => new Set(store.pipeResults.value.map(r => pairKey(r.inputs.sourceRefno, r.inputs.targetRefno)));

    // 1003 离 1002 有 1300 mm，超过相邻上限不算邻管；1004 只和另外两根并排 200 mm（拐角那种），不出尺寸
    store.setBranRefnos(Object.keys(lines));
    expect(await store.runPipeRowDetection({ alignMode: 'center' })).toBe(true);
    expect(measuredPairs()).toEqual(new Set([pairKey('Head~24381_10010', 'Head~24381_10020')]));
    expect(store.detectNotice.value).toBeNull();
    expect(store.detectDiagnostics.value).toContain('24381_1001：3 个成员没有长度（穿过件），不参与走廊');

    // 手选的直段就是要量的地方：只并排 200 mm 也量
    store.setTubeKeys(['24381_1001#24381_1001-24381_10010#0', '24381_1004#24381_1004-24381_10040#0']);
    expect(await store.runPipeRowDetection({ alignMode: 'center' })).toBe(true);
    expect(measuredPairs()).toEqual(new Set([
      pairKey('Head~24381_10010', 'Head~24381_10020'),
      pairKey('Head~24381_10010', 'Head~24381_10040'),
    ]));

    // 清掉提示连诊断一起清
    store.detectNotice.value = null;
    expect(store.detectDiagnostics.value).toEqual([]);

    // 快照：这几格随抽屉设置存取；早先没有相邻上限、或存的是当时「不限」（null）的快照都按缺省 1000——超过一定距离的不是排管
    const snapshot = store.captureSnapshot() as Record<string, unknown>;
    expect(snapshot).toMatchObject({ pipeRowMaxAdjacentMm: 1000, pipeRowMinCommonMm: 300, pipeRowBothMetrics: false, pipeRowShowKeyPoints: false });
    const older = { ...snapshot };
    delete older.pipeRowMaxAdjacentMm;
    store.pipeRowMaxAdjacentMm.value = 2000;
    store.prepareSnapshotRestore(older)();
    expect(store.pipeRowMaxAdjacentMm.value).toBe(1000);
    store.prepareSnapshotRestore({ ...snapshot, pipeRowMaxAdjacentMm: null, pipeRowMinCommonMm: 500, pipeRowBothMetrics: true, pipeRowShowKeyPoints: true })();
    expect([store.pipeRowMaxAdjacentMm.value, store.pipeRowMinCommonMm.value, store.pipeRowBothMetrics.value, store.pipeRowKeyPoints.value])
      .toEqual([1000, 500, true, true]);
    expect(() => store.prepareSnapshotRestore({ ...snapshot, pipeRowMinCommonMm: 0 })).toThrow();
    store.prepareSnapshotRestore(snapshot)();
  });

  it('连排模式：检测途中清空结果，迟到的归排不写库', async () => {
    let resolveFirst!: (value: unknown) => void;
    v1ApiMocks.genModelV1SpatialCenterline
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementation(async (refno: string) => centerlineResponse(refno, 300));
    const store = usePipeDistanceStore();
    store.setBranRefnos(['24381_1001', '24381_1002']);

    const pending = store.runPipeRowDetection();
    store.clearResults();
    resolveFirst(centerlineResponse('24381_1001', 0));

    expect(await pending).toBe(false);
    expect(store.pipeResults.value).toEqual([]);
    expect(store.isDetecting.value).toBe(false);
  });

  it('连排模式：旧服务端中心线按成员外径估算；管底对齐的排进预览确认后才生成；列表按模式隔离', async () => {
    const yByRefno: Record<string, number> = { '24381_1001': 0, '24381_1002': 300, '24381_1003': 600 };
    // gen-model refactor 的响应形状：没有逐段 diameter_evidence、没有 source_version，隐式管身外径为 null
    const legacyLine = (refno: string) => ({
      refno,
      dbnum: 100,
      segment_count: 2,
      outside_diameter_mm: 114.3,
      centerline_bbox: null,
      warnings: [],
      segments: [
        { refno: `${refno}~${refno}_2`, order: 0, noun: 'TUBI', implicit: true,
          start: { x: 0, y: yByRefno[refno]!, z: 0 }, end: { x: 5000, y: yByRefno[refno]!, z: 0 },
          length_mm: 5000, outside_diameter_mm: null },
        { refno: `${refno}_2`, order: 1, noun: 'ELBO', implicit: false,
          start: { x: 5000, y: yByRefno[refno]!, z: 0 }, end: { x: 5100, y: yByRefno[refno]! + 100, z: 0 },
          length_mm: 141.4, outside_diameter_mm: 114.3 },
      ],
    });
    v1ApiMocks.genModelV1SpatialCenterline.mockImplementation(async (refno: string) => legacyLine(refno));
    const store = usePipeDistanceStore();
    store.setBranRefnos(Object.keys(yByRefno));

    expect(await store.runPipeRowDetection({ alignMode: 'center' })).toBe(true);
    const gaps = store.pipeResults.value.filter(r => r.pipeRow?.metric === 'derived-gap');
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) {
      expect(gap.pipeRow?.signedGapM).toBeCloseTo(0.1857, 6);
      expect(gap.pipeRow?.sourceOd.evidence).toBe('legacy-member');
      expect(pipeRowGapEstimated(gap.pipeRow)).toBe(true);
    }
    expect(store.detectError.value).toBeNull();
    expect(store.detectNotice.value).toContain('旧服务端');

    // 管底对齐：底点建立在估算外径上 → 排待确认，不直接出结果
    expect(await store.runPipeRowDetection({ alignMode: 'bottom' })).toBe(true);
    const held = store.lastRowDetection.value!.groups;
    expect(held).toHaveLength(1);
    expect(held[0]!.estimatedGrouping).toBe(true);
    expect(store.pipeResults.value.filter(r => r.pipeRow?.alignMode === 'bottom')).toHaveLength(0);
    expect(store.confirmPipeRowGroups([held[0]!.key])).toBe(4);
    const bottom = store.pipeResults.value.filter(r => r.pipeRow?.alignMode === 'bottom');
    expect(bottom).toHaveLength(4);
    expect(bottom.every(r => r.provenance.warnings.some(w => w.code === 'pipe_row_estimated_grouping'))).toBe(true);
    expect(store.confirmPipeRowGroups([held[0]!.key])).toBe(0);

    // 列表按模式隔离：中心与管底两套结果各在各的列表里，另一套可一键隐藏（与三维同一隐藏集）；
    // 缺省只列名义间隔，勾了「同时显示中心距」中心距才进列表
    store.detectionMode.value = 'pipe-row';
    store.pipeRowAlignMode.value = 'center';
    expect(store.visibleResults.value).toHaveLength(2);
    expect(store.visibleResults.value.every(r => r.pipeRow?.alignMode === 'center' && r.pipeRow.metric === 'derived-gap')).toBe(true);
    store.pipeRowBothMetrics.value = true;
    expect(store.visibleResults.value).toHaveLength(4);
    store.pipeRowBothMetrics.value = false;
    expect(store.otherModeVisibleCount.value).toBe(2);
    store.hideOtherModeResults();
    expect(store.otherModeVisibleCount.value).toBe(0);
    store.pipeRowAlignMode.value = 'bottom';
    expect(store.visibleResults.value).toHaveLength(0);
    store.resetResultFilters();
    expect(store.visibleResults.value).toHaveLength(2);
    store.detectionMode.value = 'all-pairs';
    expect(store.visibleResults.value).toHaveLength(0);
    store.pipeRowAlignMode.value = 'center';

    // 清空之后旧预览作废：不能再拿它确认
    store.clearResults();
    expect(store.confirmPipeRowGroups([held[0]!.key])).toBe(0);
    expect(store.detectError.value).toContain('预览已过期');
  });

  it('少于 2 个构件时不发请求', async () => {
    const store = usePipeDistanceStore();

    await store.autoDetectBrans(['24381_1001']);

    expect(v1ApiMocks.genModelV1SurfaceClearance).not.toHaveBeenCalled();
    expect(store.detectError.value).toContain('至少选择 2 个构件');
  });

  it('批量模式包含目标之间的管对，规范化重复输入且反向管对同一对只留同向的一条记录', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    const store = usePipeDistanceStore();
    await store.autoDetectBrans(['24381/1001', '24381_1002', '24381_1003', '24381_1001'], { pairMode: 'all-pairs' });
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(3);
    const pairs = store.pipeResults.value.map(record => pairKey(record.inputs.sourceRefno, record.inputs.targetRefno)).sort();
    expect(pairs).toEqual([pairKey('24381_1001', '24381_1002'), pairKey('24381_1001', '24381_1003'), pairKey('24381_1002', '24381_1003')].sort());
    await store.autoDetectBrans(['24381_1003', '24381_1002', '24381_1001'], { pairMode: 'all-pairs' });
    // 反序重跑：所有管对按 refno 定方向，同一对还是同一条记录
    expect(store.pipeResults.value.map(record => [record.inputs.sourceRefno, record.inputs.targetRefno])).toEqual([
      ['24381_1001', '24381_1002'], ['24381_1001', '24381_1003'], ['24381_1002', '24381_1003'],
    ]);
    expect(store.pipeResults.value.every(record => record.provenance.method === 'surface-to-surface')).toBe(true);
  });

  it('批量模式使用距离上限并保留接触零距，超限和无效端点不产生记录', async () => {
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
    expect(store.pipeResults.value).toHaveLength(1);
    expect(store.pipeResults.value[0]!.snapshot?.distanceM).toBe(0);
    expect(store.detectError.value).toContain('最近点无效');
    expect(store.detectNotice.value).toBe(`另有 1 对在 ${store.maxDistance.value} mm 内没有靠近，未出结果`);
  });

  it('失败超过 5 对时红字只列前 5 对，全部写进明细', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockRejectedValue(new Error('HTTP 503'));
    const store = usePipeDistanceStore();
    await store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003', '24381_1004'], { pairMode: 'all-pairs' });
    expect(store.detectError.value).toMatch(/^6 对计算失败：.*；其余见明细$/);
    expect(store.detectDiagnostics.value).toHaveLength(6);
    expect(store.detectDiagnostics.value).toContain('计算失败：24381_1001 ↔ 24381_1002：HTTP 503');
    expect(store.lastRunOutcome.value).toEqual({ total: 6, settled: 0, beyond: 0, connected: 0, failed: 6 });
  });

  it('清空或新批次使旧查询失效，且最多同时发出4个查询', async () => {
    const resolvers: (() => void)[] = [];
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(() => new Promise(resolve => {
      resolvers.push(() => resolve(surfaceClearanceResponse()));
    }));
    const store = usePipeDistanceStore();
    const pending = store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003', '24381_1004'], { pairMode: 'all-pairs' });
    await vi.waitFor(() => expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(4));
    store.clearResults();
    resolvers.forEach(resolve => resolve());
    expect(await pending).toBe(false);
    expect(store.pipeResults.value).toEqual([]);
    expect(store.isDetecting.value).toBe(false);
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(4);

    let finishOld!: () => void;
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementationOnce(() => new Promise(resolve => {
      finishOld = () => resolve(surfaceClearanceResponse());
    })).mockResolvedValue(surfaceClearanceResponse());
    const old = store.autoDetectBrans(['24381_1001', '24381_1002']);
    await vi.waitFor(() => expect(finishOld).toBeDefined());
    await store.autoDetectBrans(['24381_1003', '24381_1004']);
    finishOld();
    expect(await old).toBe(false);
    expect(store.pipeResults.value[0]).toMatchObject({ inputs: { sourceRefno: '24381_1003', targetRefno: '24381_1004' } });
  });

  it('清空后迟到的「没靠近」回包不把清掉的记录写回来', async () => {
    const store = usePipeDistanceStore();
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValueOnce(surfaceClearanceResponse());
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    expect(store.pipeResults.value).toHaveLength(1);
    let resolve: ((value: unknown) => void) | undefined;
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    await vi.waitFor(() => expect(resolve).toBeDefined());
    store.clearResults();
    resolve!(surfaceClearanceResponse({ result: null, warnings: ['beyond_max_distance: 500 mm 内两侧网格没有靠近到一起'] }));
    expect(await pending).toBe(false);
    expect(store.pipeResults.value).toEqual([]);
  });

  it('清空后迟到的失败回包不把清掉的记录写回来', async () => {
    const store = usePipeDistanceStore();
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValueOnce(surfaceClearanceResponse());
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    let reject: ((error: unknown) => void) | undefined;
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const pending = store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    await vi.waitFor(() => expect(reject).toBeDefined());
    store.clearResults();
    reject!(new Error('HTTP 503'));
    expect(await pending).toBe(false);
    expect(store.pipeResults.value).toEqual([]);
  });

  it('换上下文后迟到的「没靠近」回包不把旧上下文的记录写进新上下文', async () => {
    const storage = new Map<string, string>();
    const local = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
    const clearance = useClearanceStore();
    const store = usePipeDistanceStore();
    clearance.bindPersistence('project-A', local);
    store.bindPersistence('project-A', local);
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValueOnce(surfaceClearanceResponse());
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    let resolve: ((value: unknown) => void) | undefined;
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    await vi.waitFor(() => expect(resolve).toBeDefined());
    clearance.bindPersistence('project-B', local);
    store.bindPersistence('project-B', local);
    resolve!(surfaceClearanceResponse({ result: null, warnings: ['beyond_max_distance: 500 mm 内两侧网格没有靠近到一起'] }));
    expect(await pending).toBe(false);
    expect(store.pipeResults.value).toEqual([]);
    expect(storage.get('plant3d-clearance-v1:project-B') ?? '').not.toContain('24381_1001');
    store.detachPersistence();
    clearance.detachPersistence();
  });

  it('所有管对接替周边检测留下的反向记录，隐藏状态跟过来', async () => {
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    const store = usePipeDistanceStore();
    await store.autoDetectBrans(['24381_1002', '24381_1001']);
    const reverse = store.pipeResults.value[0]!;
    expect(reverse.inputs).toMatchObject({ sourceRefno: '24381_1002', targetRefno: '24381_1001' });
    store.toggleResultHidden(reverse.id);
    await store.autoDetectBrans(['24381_1002', '24381_1001'], { pairMode: 'all-pairs' });
    expect(store.pipeResults.value.map(record => [record.inputs.sourceRefno, record.inputs.targetRefno])).toEqual([['24381_1001', '24381_1002']]);
    expect(store.hiddenResultIds.value.has(store.pipeResults.value[0]!.id)).toBe(true);
  });

  it('恢复本机记录时，同一对管道两个方向的旧记录只留较新的一条', () => {
    const storage = new Map<string, string>();
    const local = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
    const clearance = useClearanceStore();
    const store = usePipeDistanceStore();
    clearance.bindPersistence('legacy', local);
    store.bindPersistence('legacy', local);
    const response = surfaceClearanceResponse() as unknown as SurfaceClearanceResponse;
    const older = clearance.upsertRecord(surfaceClearanceToRecord(response, pipeDistanceInputs('24381_1001', '24381_1002'), new Date('2026-10-01T00:00:00Z')));
    const newer = clearance.upsertRecord(surfaceClearanceToRecord(response, pipeDistanceInputs('24381_1002', '24381_1001'), new Date('2026-10-02T00:00:00Z')));
    clearance.setHidden(older.id, true);
    clearance.bindPersistence('other', local);
    store.bindPersistence('other', local);
    clearance.bindPersistence('legacy', local);
    store.bindPersistence('legacy', local);
    expect(store.pipeResults.value.map(record => record.id)).toEqual([newer.id]);
    expect(store.hiddenResultIds.value.has(newer.id)).toBe(true);
    store.detachPersistence();
    clearance.detachPersistence();
  });

  it('只有每一对都算失败时才用网格拟合兜底：超限、相连都是服务端的结论', () => {
    const outcome = (counts: Partial<PipeDetectionOutcome>): PipeDetectionOutcome => ({ total: 3, settled: 0, beyond: 0, connected: 0, failed: 0, ...counts });
    expect(needsAxisEstimateFallback(outcome({ failed: 3 }))).toBe(true);
    expect(needsAxisEstimateFallback(outcome({ failed: 2, beyond: 1 }))).toBe(false);
    expect(needsAxisEstimateFallback(outcome({ beyond: 3 }))).toBe(false);
    expect(needsAxisEstimateFallback(outcome({ connected: 1, failed: 2 }))).toBe(false);
    expect(needsAxisEstimateFallback(null)).toBe(false);
  });

  it('口径无效的回包把现存记录标过期', async () => {
    const store = usePipeDistanceStore();
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValueOnce(surfaceClearanceResponse());
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValueOnce(surfaceClearanceResponse({ accuracy_class: 'approximate' }));
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    expect(store.pipeResults.value.map(record => record.status)).toEqual(['stale']);
  });

  it('首尾相接的管对不发净距请求，汇总成「相连，不计净距」，之前存下的 0 mm 记录撤掉', async () => {
    const store = usePipeDistanceStore();
    // 取不到中心线时无从判相连，相接处的相交照常出一条 0 mm 记录
    v1ApiMocks.genModelV1SpatialCenterline.mockRejectedValue(new Error('offline'));
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse({
      result: { ...surfaceClearanceResponse().result, distance_mm: 0, intersects: true },
    }));
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    expect(store.pipeResults.value).toHaveLength(1);
    expect(store.detectDiagnostics.value).toEqual(['2 根管道取不到中心线，没判断它们与别的管道是否相连：24381_1001、24381_1002']);

    v1ApiMocks.genModelV1SpatialCenterline.mockImplementation(async (refno: string) => (refno === '24381_1001'
      ? polylineResponse(refno, [['TUBI', [0, 0, 0], [5000, 0, 0]]])
      : polylineResponse(refno, [['TUBI', [5000, 0, 0], [9000, 0, 0]]])));
    v1ApiMocks.genModelV1SurfaceClearance.mockClear();
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    expect(v1ApiMocks.genModelV1SurfaceClearance).not.toHaveBeenCalled();
    expect(store.pipeResults.value).toEqual([]);
    expect(store.detectError.value).toBeNull();
    expect(store.detectNotice.value).toBe('1 对相连（首尾或支管相接），不计净距');
    expect(store.detectDiagnostics.value).toEqual(['相连：24381_1001 ↔ 24381_1002（首尾相接）']);
    expect(store.lastRunOutcome.value).toEqual({ total: 1, settled: 0, beyond: 0, connected: 1, failed: 0 });
  });

  it('支管接在三通上是疑似相连：净距不超过 1 mm 按相连，否则照常出净距', async () => {
    v1ApiMocks.genModelV1SpatialCenterline.mockImplementation(async (refno: string) => (refno === '24381_1001'
      ? polylineResponse(refno, [['TUBI', [-1000, 0, 0], [0, 0, 0]], ['TEE', [0, 0, 0], [286, 0, 0]], ['TUBI', [286, 0, 0], [1286, 0, 0]]], 168.3)
      : polylineResponse(refno, [['TUBI', [143, 117, 0], [143, 1117, 0]]], 60.3)));
    const store = usePipeDistanceStore();
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValueOnce(surfaceClearanceResponse({
      result: { ...surfaceClearanceResponse().result, distance_mm: 0, intersects: true },
    }));
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(1);
    expect(store.pipeResults.value).toEqual([]);
    expect(store.detectDiagnostics.value).toEqual(['相连：24381_1001 ↔ 24381_1002（支管相接）']);

    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValueOnce(surfaceClearanceResponse({
      result: { ...surfaceClearanceResponse().result, distance_mm: 40 },
    }));
    await store.autoDetectBrans(['24381_1001', '24381_1002'], { pairMode: 'all-pairs' });
    expect(store.pipeResults.value.map(record => Math.round(record.snapshot!.distanceM * 1000))).toEqual([40]);
    expect(store.detectNotice.value).toBeNull();
  });

  it('服务端没有周边检测这条路由时提示版本不支持并收起入口；源管未加载 404 给出友好提示；查无此管的 404 照常报错', async () => {
    const store = usePipeDistanceStore();
    const notFound = (message: string) => new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/spatial/nearby/branches', message });
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockRejectedValueOnce(notFound('构件 24381/1001 不存在'));
    expect(await store.detectNearbyBrans('24381_1001')).toBe(false);
    expect(store.detectError.value).toBe('周边检测失败，原有结果已保留：构件 24381/1001 不存在');
    expect(store.nearbySupported.value).toBe(true);
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockRejectedValueOnce(notFound('构件 24381/1001 在模型投影与空间树里都没有包围盒（还没生成过模型）'));
    expect(await store.detectNearbyBrans('24381_1001')).toBe(false);
    expect(store.detectError.value).toContain('尚未加载管道 24381_1001 的模型包围盒');
    expect(store.nearbySupported.value).toBe(true);
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockRejectedValueOnce(notFound('HTTP 404 Not Found'));
    expect(await store.detectNearbyBrans('24381_1001')).toBe(false);
    expect(store.detectError.value).toBe('当前服务端版本不支持周边检测（需要更新 gen-model 后端），原有结果已保留');
    expect(store.nearbySupported.value).toBe(false);
  });

  it('列表结果按净距从近到远排序（相交置顶），周边分组同步按净距排序', async () => {
    const store = usePipeDistanceStore();
    store.maxDistance.value = 500;
    store.setBranRefnos(['24381_1001']);
    v1ApiMocks.genModelV1SpatialNearbyBranches.mockResolvedValue({
      results: [
        { refno: '24381/1002', noun: 'BRAN', distance: 10 },
        { refno: '24381/1003', noun: 'BRAN', distance: 20 },
        { refno: '24381/1004', noun: 'BRAN', distance: 30 },
      ],
      total_count: 3,
      has_more: false,
      truncated_candidates: false,
      radius: 500,
      center: { source: 'refno_aabb_center' },
      warnings: [],
    });
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(async ({ targetRefno }: { targetRefno: string }) => {
      if (targetRefno === '24381_1002') {
        return surfaceClearanceResponse({ result: { ...surfaceClearanceResponse().result, distance_mm: 350, intersects: false } });
      }
      if (targetRefno === '24381_1003') {
        return surfaceClearanceResponse({ result: { ...surfaceClearanceResponse().result, distance_mm: 120, intersects: false } });
      }
      return surfaceClearanceResponse({ result: { ...surfaceClearanceResponse().result, distance_mm: 0, intersects: true } });
    });

    expect(await store.detectNearbyBrans('24381_1001')).toBe(true);
    expect(store.selectedBranRefnos.value).toEqual(['24381_1001']);
    expect(store.listedResults.value.map(r => [r.inputs.targetRefno, Math.round(r.snapshot!.distanceM * 1000), r.snapshot!.intersects])).toEqual([
      ['24381_1004', 0, true],
      ['24381_1003', 120, false],
      ['24381_1002', 350, false],
    ]);
    expect(store.nearbyGroup.value?.records.map(r => r.inputs.targetRefno)).toEqual([
      '24381_1004',
      '24381_1003',
      '24381_1002',
    ]);
  });

  it('管对比管道多时先按模型包围盒预筛，盒距超过上限的管对不发净距请求', async () => {
    const xByRefno: Record<string, number> = { '24381_1001': 0, '24381_1002': 300, '24381_1003': 5000, '24381_1004': 9000 };
    v1ApiMocks.genModelV1ModelBounds.mockImplementation(async (refno: string) => ({
      refno, scope: 'subtree', min_mm: [xByRefno[refno]!, 0, 0], max_mm: [xByRefno[refno]! + 100, 100, 100],
      model_count: 1, source: 'test', stale: false, publication_status: 'published',
    }));
    v1ApiMocks.genModelV1SurfaceClearance.mockResolvedValue(surfaceClearanceResponse());
    const store = usePipeDistanceStore();
    await store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003', '24381_1004'], { pairMode: 'all-pairs' });
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledTimes(1);
    expect(v1ApiMocks.genModelV1SurfaceClearance).toHaveBeenCalledWith(expect.objectContaining({ sourceRefno: '24381_1001', targetRefno: '24381_1002' }));
    expect(store.lastRunOutcome.value).toEqual({ total: 6, settled: 1, beyond: 5, connected: 0, failed: 0 });
    expect(store.detectNotice.value).toBe('另有 5 对在 500 mm 内没有靠近，未出结果');
  });

  it('取消检测：已有结论的管对按管对序落库，之后到的回包丢掉', async () => {
    const resolvers: ((value: unknown) => void)[] = [];
    v1ApiMocks.genModelV1SurfaceClearance.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const store = usePipeDistanceStore();
    const pending = store.autoDetectBrans(['24381_1001', '24381_1002', '24381_1003'], { pairMode: 'all-pairs' });
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    resolvers[1]!(surfaceClearanceResponse());
    await vi.waitFor(() => expect(store.detectProgress.value).toEqual({ done: 1, total: 3 }));
    store.cancelDetection();
    resolvers[0]!(surfaceClearanceResponse());
    resolvers[2]!(surfaceClearanceResponse());
    expect(await pending).toBe(false);
    expect(store.pipeResults.value.map(record => [record.inputs.sourceRefno, record.inputs.targetRefno])).toEqual([['24381_1001', '24381_1003']]);
    expect(store.isDetecting.value).toBe(false);
    expect(store.detectProgress.value).toBeNull();
    expect(store.detectNotice.value).toBe('已取消：1 / 3 对已有结论，算出的结果已保留');
  });
});
