import { describe, expect, it, vi } from 'vitest';

import {
  GEN_MODEL_V1_SPATIAL_CAPABILITIES,
  SPATIAL_TREE_UNSUPPORTED_MESSAGE,
  createGenModelV1SpatialSource,
  spatialCenterNotFoundMessage,
  spatialNearbyRefnosToLegacyResult,
  spatialNearbyToLegacyResult,
  spatialRoomsUnavailableMessage,
  spatialTreeToLegacyResult,
  toV1SpatialNearbyRequest,
} from './spatialSource';

import type { SpatialNearbyParams } from '@/api/genModelSpatialApi';

import {
  GenModelV1ApiError,
  type SpatialNearbyRefnosResponse,
  type SpatialNearbyResponse,
  type SpatialTreeResponse,
} from '@/api/genModelV1Api';

/** 与 gen-model `GET /api/v1/spatial/nearby/tree`（spec §4.13.5，ADR 0068）同形：两间房、跨房构件、一个未内联的单元。 */
function treeResponse(overrides: Partial<SpatialTreeResponse> = {}): SpatialTreeResponse {
  return {
    center: { x: 10, y: 20, z: 30, source: 'refno_aabb_center' },
    radius: 3000,
    shape: 'sphere',
    total_count: 3,
    candidate_count: 5,
    truncated_candidates: false,
    candidate_cap: 200000,
    leaves_inline: true,
    leaf_cap: 5000,
    leaf_count: 4,
    delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'],
    rooms: [
      {
        refno: '24381/35580',
        room_num: 'R432',
        name: '/1RX-RM04-R432',
        count: 3,
        specs: [
          {
            spec_value: 0,
            count: 1,
            unit_types: [],
            others: {
              count: 1,
              by_noun: [{ noun: 'PANE', count: 1, min_distance: 4, elements: [{ refno: '24381/4090', noun: 'PANE', distance: 4 }] }],
            },
          },
          {
            spec_value: 3,
            count: 2,
            unit_types: [
              {
                noun: 'BRAN',
                count: 2,
                units: [
                  {
                    refno: '24381/1200',
                    noun: 'BRAN',
                    name: '/B1',
                    count: 2,
                    min_distance: 1,
                    elements: [
                      { refno: '24381/1240', noun: 'TUBI', distance: 1 },
                      { refno: '24381/1241', noun: 'ELBO', distance: 2, shared_rooms: 2 },
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
        refno: '24381/1407',
        room_num: 'R143',
        name: null,
        count: 1,
        specs: [
          {
            spec_value: 3,
            count: 1,
            unit_types: [
              { noun: 'BRAN', count: 1, units: [{ refno: '24381/1200', noun: 'BRAN', name: '/B1', count: 1, min_distance: 2 }] },
            ],
            others: { count: 0, by_noun: [] },
          },
        ],
      },
    ],
    room_status: {
      rooms: [{ refno: '24381_35580', room_num: 'R432' }, { refno: '24381_1407', room_num: 'R143' }],
      source: 'memory',
      matched: 3,
      unresolved: 0,
      definition_version: 'v1',
      library_alignment_current: null,
    },
    warnings: ['房间过滤：1 个候选没有内存投影记录'],
    spatial_state: 'ready',
    coverage: 'global-tree',
    ...overrides,
  };
}

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
  it('入参：点模式 x,y,z → position，nouns / spec_values / rooms 逗号串拆数组，sort=spec_distance 同名直通（服务端按专业再距离排全集），per_page 缺省用 max_results', () => {
    const req = toV1SpatialNearbyRequest({
      x: 1,
      y: 2,
      z: 3,
      radius: 5000,
      shape: 'cube',
      nouns: 'EQUI, PIPE,,TUBI',
      spec_values: '1,3',
      rooms: '17496_8516, 17496/8600,',
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
      sort: 'spec_distance',
      includeSelf: undefined,
      includeNegative: false,
      specValues: [1, 3],
      rooms: ['17496_8516', '17496/8600'],
      page: 3,
      perPage: 250,
    });
    expect(req).not.toHaveProperty('spec_values');
    // 三档同名直通；不认识的值（老调用方拼出来的）退到 distance，不发一个服务端会 400 的名字。
    expect(toV1SpatialNearbyRequest({ x: 1, y: 2, z: 3, radius: 1, sort: 'distance' }).sort).toBe('distance');
    expect(toV1SpatialNearbyRequest({ x: 1, y: 2, z: 3, radius: 1, sort: 'spec' as unknown as SpatialNearbyParams['sort'] }).sort).toBe('distance');
    // 没给房间 / 专业就不带这两格（老断言原样成立）；专业值不是整数的丢掉。
    const plain = toV1SpatialNearbyRequest({ x: 1, y: 2, z: 3, radius: 1, spec_values: 'pipe' });
    expect(plain).not.toHaveProperty('rooms');
    expect(plain).not.toHaveProperty('specValues');
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

  it('出参：refno 归一 a_b、旧服务端没有 spec_value 时为 0、name null → 缺省、盒三元组 → {x,y,z}、dbnum 带出；没有 spec_groups 就不给专业 groups、dbnum_groups 透传；元数据原样', () => {
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
    expect(result.room_status).toBeUndefined();
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

  it('nearby/refnos：refnos 与 by_dbnum 里的 refno 都归一 a_b，旧服务端没有 by_spec_value 时为空，truncated / cap 取 truncated_results / result_cap', () => {
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

  it('专业 / 房间（ADR 0067）：spec_value 直取、spec_groups → 专业 groups、filter_options.spec_values 映射、by_spec_value 归一、room_status 与 warnings 原样带出', () => {
    const result = spatialNearbyToLegacyResult(
      { x: 10, y: 20, z: 30, radius: 5000, rooms: '17496_8516', spec_values: '1' },
      nearbyResponse({
        results: [
          {
            refno: '24383_71586',
            dbnum: 24383,
            noun: 'PIPE',
            spec_value: 1,
            name: null,
            aabb: { min: [0, 0, 0], max: [100, 200, 300] },
            distance: 123.4,
            within_radius: true,
          },
        ],
        spec_groups: [{ spec_value: 1, count: 4 }, { spec_value: 6, count: 3 }],
        filter_options: {
          nouns: [{ value: 'PIPE', count: 4, is_negative: false }],
          spec_values: [{ value: 1, count: 4 }, { value: 0, count: 2 }, { value: 6, count: 3 }],
        },
        room_status: {
          rooms: [{ refno: '17496_8516', room_num: 'A101' }],
          source: 'memory',
          matched: 7,
          unresolved: 2,
          definition_version: 'g1',
          library_alignment_current: null,
        },
        warnings: ['房间过滤：2 个候选没有内存投影记录、判不出房间归属，已从结果剔除（先显示它们再查会被纳入）'],
      }),
    );
    expect(result.results?.[0]?.spec_value).toBe(1);
    expect(result.groups).toEqual([{ spec_value: 1, count: 4 }, { spec_value: 6, count: 3 }]);
    expect(result.filter_options?.spec_values).toEqual([{ value: 1, count: 4 }, { value: 0, count: 2 }, { value: 6, count: 3 }]);
    expect(result.room_status).toEqual({
      rooms: [{ refno: '17496_8516', room_num: 'A101' }],
      source: 'memory',
      matched: 7,
      unresolved: 2,
      definition_version: 'g1',
      library_alignment_current: null,
    });
    expect(result.warnings?.[0]).toContain('2 个候选');

    const refnos = spatialNearbyRefnosToLegacyResult({
      refnos: ['24383/71586', '24381_145018'],
      by_dbnum: { '24383': ['24383/71586'], '24381': ['24381_145018'] },
      by_spec_value: { '1': ['24383/71586'], '0': ['24381_145018'] },
      total_count: 2,
      truncated_results: false,
      result_cap: 100000,
      center: { x: 0, y: 0, z: 0, source: 'position' },
      radius: 5000,
      shape: 'sphere',
      room_status: {
        rooms: [{ refno: '17496_8516', room_num: 'A101' }],
        source: 'durable',
        matched: 2,
        unresolved: 0,
        definition_version: 'g1',
        library_alignment_current: false,
      },
    });
    expect(refnos.by_spec_value).toEqual({ '1': ['24383_71586'], '0': ['24381_145018'] });
    expect(refnos.room_status?.source).toBe('durable');
    expect(refnos.room_status?.library_alignment_current).toBe(false);
  });

  it('rooms()：清单 refno 归一、status / reason 透传；旧构建 404 折成 unsupported；桩没给 rooms 就 unsupported；roomsOf 走 e3d.room.lookup 只取在册房间', async () => {
    const api = {
      nearby: vi.fn(async () => nearbyResponse()),
      nearbyRefnos: vi.fn(async (): Promise<SpatialNearbyRefnosResponse> => {
        throw new Error('unused');
      }),
      negativeNouns: vi.fn(async () => ({ nouns: [] })),
      rooms: vi.fn(async () => ({
        status: 'degraded' as const,
        reason: '2 块面板没有几何',
        definition_version: 'g1',
        rooms: [
          { refno: '17496/8516', room_num: 'A101', name: '/A101-RM', dbnum: 17496, panel_count: 6 },
          { refno: '17496_8600', room_num: 'B202', name: null, dbnum: null, panel_count: 0 },
        ],
      })),
      roomLookup: vi.fn(async (refno: string) => ({
        refno,
        memberships: [
          { roomRefno: '17496_8516', roomNum: 'A101', panelRefno: '17496_9000', insideCount: 8, centerDist: 100 },
          { roomRefno: null, roomNum: null, panelRefno: '17496_9001', insideCount: 2, centerDist: 900 },
          { roomRefno: '17496_8600', roomNum: 'B202', panelRefno: '17496_9002', insideCount: 1, centerDist: 950 },
          { roomRefno: '17496_8516', roomNum: 'A101', panelRefno: '17496_9003', insideCount: 1, centerDist: 999 },
        ],
        calculationStatus: 'computed' as const,
        roomMembership: true,
      })),
    };
    const source = createGenModelV1SpatialSource({ api });
    expect(await source.rooms()).toEqual({
      success: true,
      status: 'degraded',
      reason: '2 块面板没有几何',
      definition_version: 'g1',
      rooms: [
        { refno: '17496_8516', room_num: 'A101', name: '/A101-RM', dbnum: 17496, panel_count: 6 },
        { refno: '17496_8600', room_num: 'B202', name: null, dbnum: null, panel_count: 0 },
      ],
    });
    expect(await source.roomsOf('24381_145018')).toEqual(['17496_8516', '17496_8600']);
    expect(api.roomLookup).toHaveBeenCalledWith('24381_145018');

    const legacyBuild = createGenModelV1SpatialSource({
      api: {
        ...api,
        rooms: vi.fn(async () => {
          throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/spatial/rooms', message: 'no route' });
        }),
      },
    });
    const missingRoute = await legacyBuild.rooms();
    expect(missingRoute.status).toBe('unsupported');
    expect(missingRoute.rooms).toEqual([]);
    expect(missingRoute.reason).toContain('旧版');

    const bare = createGenModelV1SpatialSource({ api: { nearby: api.nearby, nearbyRefnos: api.nearbyRefnos, negativeNouns: api.negativeNouns } });
    expect((await bare.rooms()).status).toBe('unsupported');
    expect(await bare.roomsOf('24381_145018')).toEqual([]);
  });

  it('rooms= 给了而房间体制不可用（422 rooms_unavailable）折成 success:false + detail.status 那一句；别的 422 原样抛', async () => {
    const unavailable = new GenModelV1ApiError({
      code: 'precondition',
      status: 422,
      path: '/api/v1/spatial/nearby',
      message: '房间过滤此刻不可用（disabled）',
      detail: { reason: 'rooms_unavailable', status: 'disabled', message: 'room_membership=false：服务端未开启房间归属计算' },
    });
    const other = new GenModelV1ApiError({
      code: 'precondition',
      status: 422,
      path: '/api/v1/spatial/nearby',
      message: 'something else',
      detail: { reason: 'other' },
    });
    const api = {
      nearby: vi.fn(async (req: { rooms?: string[] }) => {
        if (req.rooms?.[0] === '17496_1') throw unavailable;
        throw other;
      }),
      nearbyRefnos: vi.fn(async (): Promise<SpatialNearbyRefnosResponse> => {
        throw unavailable;
      }),
      negativeNouns: vi.fn(async () => ({ nouns: [] })),
    };
    const source = createGenModelV1SpatialSource({ api });
    const result = await source.nearby({ x: 1, y: 2, z: 3, radius: 800, rooms: '17496_1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe(spatialRoomsUnavailableMessage('disabled', 'room_membership=false：服务端未开启房间归属计算'));
    expect(result.error).toContain('disabled');
    expect(result.error).toContain('room_membership=false');
    const thrown = await source.nearby({ x: 1, y: 2, z: 3, radius: 800, rooms: '17496_2' }).then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(thrown?.detail).toEqual({ reason: 'other' });
  });

  it('适配器：nearby / nearbyRefnos 把翻译后的请求交给 API；negativeNouns 包成 {success:true, nouns}；专业 + 房间两维都在', async () => {
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
    expect(source.capabilities).toEqual({ specValues: true, branCenterline: true, keywordMatchesName: false, nameSortExact: false, rooms: true, tree: true });
    expect(GEN_MODEL_V1_SPATIAL_CAPABILITIES.specValues).toBe(true);
    expect(GEN_MODEL_V1_SPATIAL_CAPABILITIES.rooms).toBe(true);
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

  it('房间层级树（ADR 0068）：refno 归一 a_b、五层原样、未内联的单元不带 elements、room_status / warnings 带出；请求与 nearby 同译、不发 sort / page', async () => {
    const mapped = spatialTreeToLegacyResult(treeResponse());
    expect(mapped.success).toBe(true);
    expect(mapped).toMatchObject({ total_count: 3, leaf_count: 4, leaves_inline: true, leaf_cap: 5000, inlined: null, delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'] });
    expect(mapped.rooms.map((room) => [room.refno, room.room_num, room.name, room.count])).toEqual([
      ['24381_35580', 'R432', '/1RX-RM04-R432', 3],
      ['24381_1407', 'R143', null, 1],
    ]);
    const r432 = mapped.rooms[0]!;
    expect(r432.specs.map((spec) => [spec.spec_value, spec.count])).toEqual([[0, 1], [3, 2]]);
    expect(r432.specs[0]!.others.by_noun[0]).toEqual({ noun: 'PANE', count: 1, min_distance: 4, elements: [{ refno: '24381_4090', noun: 'PANE', distance: 4 }] });
    const unit = r432.specs[1]!.unit_types[0]!.units[0]!;
    expect(unit).toMatchObject({ refno: '24381_1200', noun: 'BRAN', name: '/B1', count: 2, min_distance: 1 });
    expect(unit.elements).toEqual([
      { refno: '24381_1240', noun: 'TUBI', distance: 1 },
      { refno: '24381_1241', noun: 'ELBO', distance: 2, shared_rooms: 2 },
    ]);
    const notInlined = mapped.rooms[1]!.specs[0]!.unit_types[0]!.units[0]!;
    expect('elements' in notInlined).toBe(false);
    expect(mapped.room_status?.matched).toBe(3);
    expect(mapped.warnings).toEqual(['房间过滤：1 个候选没有内存投影记录']);
    expect(mapped.center).toEqual({ x: 10, y: 20, z: 30, source: 'refno_aabb_center' });

    const api = {
      nearby: vi.fn(async () => nearbyResponse()),
      nearbyRefnos: vi.fn(async (): Promise<SpatialNearbyRefnosResponse> => ({ refnos: [], by_dbnum: {}, total_count: 0, truncated_results: false, result_cap: 100000, center: { x: 0, y: 0, z: 0, source: 'position' }, radius: 1, shape: 'sphere' })),
      negativeNouns: vi.fn(async () => ({ nouns: [] })),
      nearbyTree: vi.fn(async () => treeResponse()),
    };
    const source = createGenModelV1SpatialSource({ api });
    const result = await source.tree({ refno: '24381_35580', radius: 3000, rooms: '24381_35580,24381_1407', sort: 'spec_distance', page: 2, per_page: 100, spec_values: '3' }, { unit: '24381_1200' });
    expect(result.success).toBe(true);
    expect(api.nearbyTree).toHaveBeenCalledWith(
      expect.objectContaining({ refno: '24381_35580', radius: 3000, rooms: ['24381_35580', '24381_1407'], specValues: [3], sort: 'spec_distance', page: 2, perPage: 100 }),
      { unit: '24381_1200' },
    );
    expect(source.capabilities.tree).toBe(true);

    // 桩没给 nearbyTree（旧测试桩 / 旧构建）：success:false + unsupported，store 退回平铺
    const bare = createGenModelV1SpatialSource({ api: { nearby: api.nearby, nearbyRefnos: api.nearbyRefnos, negativeNouns: api.negativeNouns } });
    expect(await bare.tree({ x: 1, y: 2, z: 3, radius: 800, rooms: '1_1' })).toMatchObject({ success: false, unsupported: true, error: SPATIAL_TREE_UNSUPPORTED_MESSAGE, rooms: [], total_count: 0 });

    // 旧构建 404：点模式 = 没有这条路由（unsupported）；refno 模式 = 中心没盒（同 nearby 的那一句，不是 unsupported）
    const notFound = new GenModelV1ApiError({ code: 'not_found', message: 'nope', status: 404, path: '/api/v1/spatial/nearby/tree' });
    const failing = createGenModelV1SpatialSource({ api: { ...api, nearbyTree: vi.fn(async () => { throw notFound; }) } });
    expect(await failing.tree({ x: 1, y: 2, z: 3, radius: 800, rooms: '1_1' })).toMatchObject({ success: false, unsupported: true });
    const missingCenter = await failing.tree({ refno: '24381_404', radius: 800, rooms: '1_1' });
    expect(missingCenter).toMatchObject({ success: false, error: spatialCenterNotFoundMessage('24381_404') });
    expect(missingCenter.unsupported).toBeUndefined();

    // 房间体制不可用（422 rooms_unavailable）折成 success:false + 那一句，不是 unsupported
    const unavailable = new GenModelV1ApiError({ code: 'precondition', message: 'x', status: 422, path: '/api/v1/spatial/nearby/tree', detail: { reason: 'rooms_unavailable', status: 'disabled', message: 'room_membership=false' } });
    const disabled = createGenModelV1SpatialSource({ api: { ...api, nearbyTree: vi.fn(async () => { throw unavailable; }) } });
    expect(await disabled.tree({ x: 1, y: 2, z: 3, radius: 800, rooms: '1_1' })).toMatchObject({ success: false, error: spatialRoomsUnavailableMessage('disabled', 'room_membership=false') });
  });

  it('roomTree()（ADR 0068，模型树「房间」页签）：把房间 refno 与过滤 / 选择器交给 rooms/{refno}/tree，响应同 tree() 映射；桩没给 → unsupported；404 / 400 / 422 各折成一句', async () => {
    const api = {
      nearby: vi.fn(async () => nearbyResponse()),
      nearbyRefnos: vi.fn(async (): Promise<SpatialNearbyRefnosResponse> => ({ refnos: [], by_dbnum: {}, total_count: 0, truncated_results: false, result_cap: 100000, center: { x: 0, y: 0, z: 0, source: 'position' }, radius: 1, shape: 'sphere' })),
      negativeNouns: vi.fn(async () => ({ nouns: [] })),
      roomTree: vi.fn(async () => treeResponse()),
    };
    const source = createGenModelV1SpatialSource({ api });
    const result = await source.roomTree('24381_35580', { margin: 500, nouns: ['PANE'], specValues: [3] }, { otherNoun: 'PANE' });
    expect(result.success).toBe(true);
    expect(result.rooms[0]).toMatchObject({ refno: '24381_35580', room_num: 'R432', count: 3 });
    expect(api.roomTree).toHaveBeenCalledWith(
      '24381_35580',
      { margin: 500, nouns: ['PANE'], keyword: undefined, includeNegative: undefined, dbnums: undefined, specValues: [3] },
      { otherNoun: 'PANE' },
    );
    // 不带过滤：全 undefined 的过滤对象 + 没有选择器
    await source.roomTree('24381_35580');
    expect(api.roomTree).toHaveBeenLastCalledWith('24381_35580', { margin: undefined, nouns: undefined, keyword: undefined, includeNegative: undefined, dbnums: undefined, specValues: undefined }, undefined);

    const bare = createGenModelV1SpatialSource({ api: { nearby: api.nearby, nearbyRefnos: api.nearbyRefnos, negativeNouns: api.negativeNouns } });
    expect(await bare.roomTree('24381_35580')).toMatchObject({ success: false, unsupported: true, error: SPATIAL_TREE_UNSUPPORTED_MESSAGE, rooms: [] });

    // 404 = 房间从没生成过面板模型（没有盒）；400 = 不在册 / 路径坏（服务端那句原样）；422 = 房间体制不可用
    const notFound = new GenModelV1ApiError({ code: 'not_found', message: 'nope', status: 404, path: '/api/v1/spatial/rooms/24381_35580/tree' });
    const missing = await createGenModelV1SpatialSource({ api: { ...api, roomTree: vi.fn(async () => { throw notFound; }) } }).roomTree('24381_35580');
    expect(missing.success).toBe(false);
    expect(missing.unsupported).toBeUndefined();
    expect(missing.error).toContain('24381_35580');
    expect(missing.error).toContain('包围盒');
    const badRequest = new GenModelV1ApiError({ code: 'bad_request', message: 'rooms 里的 1/1 不是在册房间', status: 400, path: '/api/v1/spatial/rooms/1_1/tree' });
    expect(await createGenModelV1SpatialSource({ api: { ...api, roomTree: vi.fn(async () => { throw badRequest; }) } }).roomTree('1_1'))
      .toMatchObject({ success: false, error: 'rooms 里的 1/1 不是在册房间' });
    const unavailable = new GenModelV1ApiError({ code: 'precondition', message: 'x', status: 422, path: '/api/v1/spatial/rooms/24381_35580/tree', detail: { reason: 'rooms_unavailable', status: 'disabled', message: 'room_membership=false' } });
    expect(await createGenModelV1SpatialSource({ api: { ...api, roomTree: vi.fn(async () => { throw unavailable; }) } }).roomTree('24381_35580'))
      .toMatchObject({ success: false, error: spatialRoomsUnavailableMessage('disabled', 'room_membership=false') });
    // 别的错误（503 spatial_not_ready）原样抛
    const notReady = new GenModelV1ApiError({ code: 'spatial_not_ready', message: 'tree building', status: 503, path: '/api/v1/spatial/rooms/24381_35580/tree' });
    await expect(createGenModelV1SpatialSource({ api: { ...api, roomTree: vi.fn(async () => { throw notReady; }) } }).roomTree('24381_35580')).rejects.toBe(notReady);
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
