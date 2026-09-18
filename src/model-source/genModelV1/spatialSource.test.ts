import { describe, expect, it, vi } from 'vitest';

import {
  GEN_MODEL_V1_SPATIAL_CAPABILITIES,
  createGenModelV1SpatialSource,
  spatialCenterNotFoundMessage,
  spatialNearbyRefnosToLegacyResult,
  spatialNearbyToLegacyResult,
  toV1SpatialNearbyRequest,
} from './spatialSource';

import type { SpatialNearbyParams } from '@/api/genModelSpatialApi';

import {
  GenModelV1ApiError,
  type SpatialNearbyRefnosResponse,
  type SpatialNearbyResponse,
} from '@/api/genModelV1Api';

/** 与 gen-model `GET /api/v1/spatial/nearby`（spec §4.13 / plan §3.1）同形。 */
function nearbyResponse(overrides: Partial<SpatialNearbyResponse> = {}): SpatialNearbyResponse {
  return {
    results: [
      {
        refno: '24383_71586',
        dbnum: 24383,
        noun: 'PIPE',
        name: null,
        aabb: { min: [0, 0, 0], max: [100, 200, 300] },
        distance: 123.4,
        within_radius: true,
      },
      {
        refno: '24381/145018',
        dbnum: 24381,
        noun: 'BRAN',
        name: '/P-101-B1',
        aabb: { min: [1, 2, 3], max: [4, 5, 6] },
        distance: 0,
        within_radius: true,
      },
    ],
    center: { x: 10, y: 20, z: 30, source: 'position' },
    radius: 5000,
    shape: 'sphere',
    total_count: 7,
    returned_count: 2,
    page: 1,
    per_page: 2,
    has_more: true,
    candidate_count: 9,
    truncated_candidates: false,
    candidate_cap: 200000,
    groups: [{ dbnum: 24383, count: 4 }, { dbnum: 24381, count: 3 }],
    filter_options: {
      nouns: [
        { value: 'PIPE', count: 4, is_negative: false },
        { value: 'NBOX', count: 1, is_negative: true },
      ],
    },
    spatial_state: 'ready',
    coverage: 'global-tree',
    ...overrides,
  };
}

describe('gen-model-v1 spatialSource', () => {
  it('入参：点模式 x,y,z → position，nouns 逗号串拆数组，spec_distance 折成 distance，spec_values 丢弃，per_page 缺省用 max_results', () => {
    const req = toV1SpatialNearbyRequest({
      x: 1,
      y: 2,
      z: 3,
      radius: 5000,
      shape: 'cube',
      nouns: 'EQUI, PIPE,,TUBI',
      spec_values: '1,3',
      keyword: ' P-101 ',
      sort: 'spec_distance',
      include_negative: false,
      page: 3,
      max_results: 250,
    });
    expect(req).toEqual({
      refno: undefined,
      position: { x: 1, y: 2, z: 3 },
      radius: 5000,
      shape: 'cube',
      nouns: ['EQUI', 'PIPE', 'TUBI'],
      keyword: 'P-101',
      sort: 'distance',
      includeSelf: undefined,
      includeNegative: false,
      page: 3,
      perPage: 250,
    });
    expect(req).not.toHaveProperty('spec_values');
  });

  it('入参：refno 模式带 include_self，坐标即便同时给了也不当 position；sort=name 原样、没给 sort 就不发', () => {
    const req = toV1SpatialNearbyRequest({ refno: ' 24381_145018 ', x: 1, y: 2, z: 3, radius: 800, include_self: false, sort: 'name', per_page: 100 });
    expect(req.refno).toBe('24381_145018');
    expect(req.position).toBeUndefined();
    expect(req.includeSelf).toBe(false);
    expect(req.sort).toBe('name');
    expect(req.perPage).toBe(100);
    expect(toV1SpatialNearbyRequest({ radius: 1 }).sort).toBeUndefined();
    expect(toV1SpatialNearbyRequest({ x: 1, y: 2, radius: 1 }).position).toBeUndefined();
  });

  it('出参：refno 归一 a_b、spec_value 一律 0、name null → 缺省、盒三元组 → {x,y,z}、dbnum 带出；专业 groups 不给、dbnum_groups 透传；元数据原样', () => {
    const params: SpatialNearbyParams = { x: 10, y: 20, z: 30, radius: 5000, include_negative: true };
    const result = spatialNearbyToLegacyResult(params, nearbyResponse());

    expect(result.success).toBe(true);
    expect(result.results).toEqual([
      {
        refno: '24383_71586',
        dbnum: 24383,
        noun: 'PIPE',
        spec_value: 0,
        name: undefined,
        aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 200, z: 300 } },
        distance: 123.4,
      },
      {
        refno: '24381_145018',
        dbnum: 24381,
        noun: 'BRAN',
        spec_value: 0,
        name: '/P-101-B1',
        aabb: { min: { x: 1, y: 2, z: 3 }, max: { x: 4, y: 5, z: 6 } },
        distance: 0,
      },
    ]);
    expect(result.center).toEqual({ x: 10, y: 20, z: 30, source: 'position' });
    expect(result.groups).toBeUndefined();
    expect(result.dbnum_groups).toEqual([{ dbnum: 24383, count: 4 }, { dbnum: 24381, count: 3 }]);
    expect(result.filter_options).toEqual({
      nouns: [
        { value: 'PIPE', count: 4, is_negative: false },
        { value: 'NBOX', count: 1, is_negative: true },
      ],
      spec_values: [],
      include_negative: true,
    });
    expect(result).toMatchObject({
      radius: 5000,
      shape: 'sphere',
      total_count: 7,
      returned_count: 2,
      page: 1,
      per_page: 2,
      has_more: true,
      candidate_count: 9,
      candidate_cap: 200000,
      truncated_candidates: false,
      coverage: 'global-tree',
      spatial_state: 'ready',
    });
  });

  it('出参：refno 模式把归一后的 refno 挂进 center（旧契约的 center.refno），include_negative 缺省回 false', () => {
    const result = spatialNearbyToLegacyResult(
      { refno: '24381/145018', radius: 800 },
      nearbyResponse({ center: { x: 1, y: 2, z: 3, source: 'refno_aabb_center' } }),
    );
    expect(result.center).toEqual({ x: 1, y: 2, z: 3, source: 'refno_aabb_center', refno: '24381_145018' });
    expect(result.filter_options?.include_negative).toBe(false);
  });

  it('nearby/refnos：refnos 与 by_dbnum 里的 refno 都归一 a_b，by_spec_value 为空，truncated / cap 取 truncated_results / result_cap', () => {
    const resp: SpatialNearbyRefnosResponse = {
      refnos: ['24383/71586', '24381_145018'],
      by_dbnum: { '24383': ['24383/71586'], '24381': ['24381_145018'] },
      total_count: 2,
      truncated_results: true,
      result_cap: 100000,
      center: { x: 0, y: 0, z: 0, source: 'position' },
      radius: 5000,
      shape: 'sphere',
    };
    expect(spatialNearbyRefnosToLegacyResult(resp)).toEqual({
      success: true,
      refnos: ['24383_71586', '24381_145018'],
      by_dbnum: { '24383': ['24383_71586'], '24381': ['24381_145018'] },
      by_spec_value: {},
      total_count: 2,
      truncated: true,
      cap: 100000,
    });
  });

  it('适配器：nearby / nearbyRefnos 把翻译后的请求交给 API；negativeNouns 包成 {success:true, nouns}；无专业维度', async () => {
    const api = {
      nearby: vi.fn(async () => nearbyResponse()),
      nearbyRefnos: vi.fn(async (): Promise<SpatialNearbyRefnosResponse> => ({
        refnos: ['24383/71586'],
        by_dbnum: { '24383': ['24383/71586'] },
        total_count: 1,
        truncated_results: false,
        result_cap: 100000,
        center: { x: 0, y: 0, z: 0, source: 'position' },
        radius: 5000,
        shape: 'sphere',
      })),
      negativeNouns: vi.fn(async () => ({ nouns: ['NBOX', 'NCYL'] })),
    };
    const source = createGenModelV1SpatialSource({ api });

    const nearby = await source.nearby({ x: 10, y: 20, z: 30, radius: 5000, nouns: 'PIPE', page: 1, per_page: 2 });
    expect(api.nearby).toHaveBeenCalledWith(expect.objectContaining({ position: { x: 10, y: 20, z: 30 }, radius: 5000, nouns: ['PIPE'], page: 1, perPage: 2 }));
    expect(nearby.success).toBe(true);
    expect(nearby.results?.[0]?.refno).toBe('24383_71586');

    const refnos = await source.nearbyRefnos({ refno: '24381_145018', radius: 800, include_self: false });
    expect(api.nearbyRefnos).toHaveBeenCalledWith(expect.objectContaining({ refno: '24381_145018', radius: 800, includeSelf: false }));
    expect(refnos).toMatchObject({ success: true, refnos: ['24383_71586'], by_dbnum: { '24383': ['24383_71586'] } });

    expect(await source.negativeNouns()).toEqual({ success: true, nouns: ['NBOX', 'NCYL'] });
    expect(source.capabilities).toEqual({ specValues: false, branCenterline: true, keywordMatchesName: false, nameSortExact: false });
    expect(GEN_MODEL_V1_SPATIAL_CAPABILITIES.specValues).toBe(false);
  });

  it('中心线：source_mode 只在给了 refno 时随请求发出；服务端的 warnings 带进结果，center.source 原样', async () => {
    expect(toV1SpatialNearbyRequest({ refno: '24381_145018', radius: 1500, source_mode: 'bran_centerline' }).sourceMode)
      .toBe('bran_centerline');
    expect(toV1SpatialNearbyRequest({ refno: '24381_145018', radius: 1500 }).sourceMode).toBeUndefined();
    expect(toV1SpatialNearbyRequest({ x: 1, y: 2, z: 3, radius: 1500, source_mode: 'bran_centerline' }).sourceMode)
      .toBeUndefined();

    const api = {
      nearby: vi.fn(async () =>
        nearbyResponse({
          center: { x: 1, y: 2, z: 3, source: 'bran_centerline' },
          source: {
            kind: 'bran_centerline',
            refno: '24381_145018',
            segment_count: 36,
            centerline_bbox: { min: [0, 0, 0], max: [1000, 1000, 0] },
            outside_diameter_mm: 219.1,
          },
          warnings: ['1 个成员没有长度（穿过件），不参与走廊'],
        }),
      ),
      nearbyRefnos: vi.fn(async (): Promise<SpatialNearbyRefnosResponse> => ({
        refnos: [],
        by_dbnum: {},
        total_count: 0,
        truncated_results: false,
        result_cap: 100000,
        center: { x: 1, y: 2, z: 3, source: 'bran_centerline' },
        radius: 1500,
        shape: 'sphere',
      })),
      negativeNouns: vi.fn(async () => ({ nouns: [] })),
    };
    const source = createGenModelV1SpatialSource({ api });

    const result = await source.nearby({ refno: '24381_145018', radius: 1500, source_mode: 'bran_centerline', include_self: false });
    expect(api.nearby).toHaveBeenCalledWith(
      expect.objectContaining({ refno: '24381_145018', sourceMode: 'bran_centerline', includeSelf: false }),
    );
    expect(result.center?.source).toBe('bran_centerline');
    expect(result.warnings).toEqual(['1 个成员没有长度（穿过件），不参与走廊']);
    expect(spatialNearbyToLegacyResult({ refno: '24381_145018', radius: 1500 }, nearbyResponse())).not.toHaveProperty('warnings');
  });

  it('错误分型：refno 模式 not_found 折成 success:false + 「先显示该构件」；spatial_not_ready 原样抛出且 isRetryable；点模式 not_found 也原样抛', async () => {
    const notFound = new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/spatial/nearby', message: 'no aabb for refno' });
    const notReady = new GenModelV1ApiError({
      code: 'spatial_not_ready',
      status: 503,
      path: '/api/v1/spatial/nearby',
      message: 'spatial tree is loading',
      detail: { state: 'loading' },
      retryAfterMs: 5000,
    });
    const api = {
      nearby: vi.fn(async (req: { refno?: string }) => {
        if (req.refno === '24381_404') throw notFound;
        if (req.refno === '24381_503') throw notReady;
        throw notFound;
      }),
      nearbyRefnos: vi.fn(async () => {
        throw notReady;
      }),
      negativeNouns: vi.fn(async () => ({ nouns: [] })),
    };
    const source = createGenModelV1SpatialSource({ api });

    const missing = await source.nearby({ refno: '24381_404', radius: 800 });
    expect(missing.success).toBe(false);
    expect(missing.results).toEqual([]);
    expect(missing.error).toBe(spatialCenterNotFoundMessage('24381_404'));
    expect(missing.error).toContain('24381_404');
    expect(missing.error).toContain('先显示该构件');

    const stalled = await source.nearby({ refno: '24381_503', radius: 800 }).then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(stalled?.code).toBe('spatial_not_ready');
    expect(stalled?.isRetryable).toBe(true);
    expect(stalled?.retryAfterMs).toBe(5000);

    const pointNotFound = await source.nearby({ x: 1, y: 2, z: 3, radius: 800 }).then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(pointNotFound?.code).toBe('not_found');

    const refnosStalled = await source.nearbyRefnos({ x: 1, y: 2, z: 3, radius: 800 }).then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(refnosStalled?.isRetryable).toBe(true);
  });
});
