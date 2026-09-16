import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchNegativeNouns,
  normalizeBranRefno,
  queryBranCenterlineNearestClearance,
  queryNearbyByPosition,
  queryNearbyByRefno,
  queryNearbyRefnos,
  querySpatialIndex,
} from './genModelSpatialApi';

describe('genModelSpatialApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('querySpatialIndex 应保持 legacy /query 兼容路径', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, results: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await querySpatialIndex({
      mode: 'position',
      x: 10,
      y: 20,
      z: 30,
      radius: 40,
      nouns: 'PIPE,EQUI',
      max_results: 25,
      shape: 'sphere',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requestUrl, 'http://localhost');

    expect(url.pathname).toBe('/api/sqlite-spatial/query');
    expect(url.searchParams.get('mode')).toBe('position');
    expect(url.searchParams.get('x')).toBe('10');
    expect(url.searchParams.get('y')).toBe('20');
    expect(url.searchParams.get('z')).toBe('30');
    expect(url.searchParams.get('radius')).toBe('40');
    expect(url.searchParams.get('nouns')).toBe('PIPE,EQUI');
    expect(url.searchParams.get('max_results')).toBe('25');
    expect(url.searchParams.get('shape')).toBe('sphere');
  });

  it('fetchNegativeNouns 应调用 /negative-nouns 并返回服务端清单', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, nouns: ['NBOX', 'NCYL'] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchNegativeNouns();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requestUrl, 'http://localhost');

    expect(url.pathname).toBe('/api/sqlite-spatial/negative-nouns');
    expect(result).toEqual({ success: true, nouns: ['NBOX', 'NCYL'] });
  });

  it('queryNearbyByRefno 应调用 /nearby 且只发送 refno 中心参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, results: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await queryNearbyByRefno('24381_145018', 5000, {
      include_self: false,
      nouns: 'PIPE,EQUI',
      spec_values: '1,3',
      include_negative: true,
      max_results: 25,
      page: 2,
      per_page: 10,
      shape: 'sphere',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requestUrl, 'http://localhost');

    expect(url.pathname).toBe('/api/sqlite-spatial/nearby');
    expect(url.searchParams.get('refno')).toBe('24381_145018');
    expect(url.searchParams.get('radius')).toBe('5000');
    expect(url.searchParams.get('include_self')).toBe('false');
    expect(url.searchParams.get('include_negative')).toBe('true');
    expect(url.searchParams.get('nouns')).toBe('PIPE,EQUI');
    expect(url.searchParams.get('spec_values')).toBe('1,3');
    expect(url.searchParams.get('max_results')).toBe('25');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('per_page')).toBe('10');
    expect(url.searchParams.get('shape')).toBe('sphere');
    expect(url.searchParams.has('x')).toBe(false);
    expect(url.searchParams.has('y')).toBe(false);
    expect(url.searchParams.has('z')).toBe(false);
    expect(url.searchParams.has('mode')).toBe(false);
    expect(url.searchParams.has('distance')).toBe(false);
  });

  it('queryNearbyByPosition 应调用 /nearby 且只发送坐标中心参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, results: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await queryNearbyByPosition(10, 20, 30, 40, {
      nouns: 'PIPE,EQUI',
      spec_values: '2',
      include_negative: false,
      max_results: 25,
      page: 3,
      per_page: 20,
      shape: 'cube',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requestUrl, 'http://localhost');

    expect(url.pathname).toBe('/api/sqlite-spatial/nearby');
    expect(url.searchParams.get('x')).toBe('10');
    expect(url.searchParams.get('y')).toBe('20');
    expect(url.searchParams.get('z')).toBe('30');
    expect(url.searchParams.get('radius')).toBe('40');
    expect(url.searchParams.get('nouns')).toBe('PIPE,EQUI');
    expect(url.searchParams.get('spec_values')).toBe('2');
    expect(url.searchParams.get('include_negative')).toBe('false');
    expect(url.searchParams.get('max_results')).toBe('25');
    expect(url.searchParams.get('page')).toBe('3');
    expect(url.searchParams.get('per_page')).toBe('20');
    expect(url.searchParams.get('shape')).toBe('cube');
    expect(url.searchParams.has('refno')).toBe(false);
    expect(url.searchParams.has('mode')).toBe(false);
    expect(url.searchParams.has('distance')).toBe(false);
  });

  it('在 refno 模式下应保留 include_self 和 distance 参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, results: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await querySpatialIndex({
      mode: 'refno',
      refno: '24381_100818',
      distance: 5000,
      include_self: false,
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requestUrl, 'http://localhost');

    expect(url.searchParams.get('mode')).toBe('refno');
    expect(url.searchParams.get('refno')).toBe('24381_100818');
    expect(url.searchParams.get('distance')).toBe('5000');
    expect(url.searchParams.get('include_self')).toBe('false');
  });

  it('应透传 spec_values 专业过滤参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, results: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await querySpatialIndex({
      mode: 'position',
      x: 100,
      y: 200,
      z: 300,
      radius: 400,
      spec_values: '1,3',
      nouns: 'PIPE,EQUI',
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requestUrl, 'http://localhost');

    expect(url.searchParams.get('spec_values')).toBe('1,3');
    expect(url.searchParams.get('nouns')).toBe('PIPE,EQUI');
  });

  it('应透传服务端分页参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, results: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await querySpatialIndex({
      mode: 'refno',
      refno: '24381_145018',
      distance: 10000,
      max_results: 100,
      page: 2,
      per_page: 100,
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requestUrl, 'http://localhost');

    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(url.searchParams.get('max_results')).toBe('100');
  });

  it('queryBranCenterlineNearestClearance 应序列化 BRAN nearest-clearance 查询参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, nearest_by_group: {} }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await queryBranCenterlineNearestClearance({
      source_refno: 'pe:<24381/145018>',
      target_groups: ['wall', 'column'],
      radius: 5000,
      scope: 'same_dbnum',
      max_per_group: 2,
      debug: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requestUrl, 'http://localhost');

    expect(url.pathname).toBe('/api/sqlite-spatial/nearest-clearance');
    expect(url.searchParams.get('source_mode')).toBe('bran_centerline');
    expect(url.searchParams.get('source_refno')).toBe('24381_145018');
    expect(url.searchParams.get('target_groups')).toBe('wall,column');
    expect(url.searchParams.get('radius')).toBe('5000');
    expect(url.searchParams.get('scope')).toBe('same_dbnum');
    expect(url.searchParams.get('max_per_group')).toBe('2');
    expect(url.searchParams.get('debug')).toBe('true');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it('queryBranCenterlineNearestClearance 应使用 wall,column、5000mm 和 all_loaded 默认值', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, nearest_by_group: {} }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await queryBranCenterlineNearestClearance({ source_refno: '24381/145018' });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requestUrl, 'http://localhost');

    expect(url.searchParams.get('source_refno')).toBe('24381_145018');
    expect(url.searchParams.get('target_groups')).toBe('wall,column');
    expect(url.searchParams.get('radius')).toBe('5000');
    expect(url.searchParams.get('scope')).toBe('all_loaded');
  });

  it('normalizeBranRefno 应支持常见选中对象和手输格式', () => {
    expect(normalizeBranRefno('24381_145018')).toBe('24381_145018');
    expect(normalizeBranRefno('24381/145018')).toBe('24381_145018');
    expect(normalizeBranRefno('pe:<24381/145018>')).toBe('24381_145018');
    expect(normalizeBranRefno('=24381,145018')).toBe('24381_145018');
  });

  it('queryBranCenterlineNearestClearance：group_by=noun 不再补 wall,column 默认组，并透传 exclude_nouns / target_nouns / include_self', async () => {
    // 两次调用各要一份新的 Response：body 读过一次就不能再读
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ success: true, nearest_by_group: [], noun_counts: {} }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await queryBranCenterlineNearestClearance({
      source_refno: '24381_145018',
      group_by: 'noun',
      exclude_nouns: ['WELD', 'ATTA'],
      radius: 1500,
      max_per_group: 3,
    });

    let url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.searchParams.get('group_by')).toBe('noun');
    expect(url.searchParams.get('exclude_nouns')).toBe('WELD,ATTA');
    expect(url.searchParams.has('target_groups')).toBe(false);
    expect(url.searchParams.has('target_nouns')).toBe(false);
    expect(url.searchParams.get('max_per_group')).toBe('3');

    // 显式点名目标 + 放行自身：两种分桶方式下都照给
    await queryBranCenterlineNearestClearance({
      source_refno: '24381_145018',
      group_by: 'noun',
      target_nouns: ['SCTN', 'WALL'],
      target_groups: 'column',
      include_self: true,
    });

    url = new URL(String(fetchMock.mock.calls[1]?.[0]), 'http://localhost');
    expect(url.searchParams.get('target_nouns')).toBe('SCTN,WALL');
    expect(url.searchParams.get('target_groups')).toBe('column');
    expect(url.searchParams.get('include_self')).toBe('true');
  });

  it('queryNearbyByRefno：source_mode=bran_centerline 改打 /query?mode=bran_centerline，radius 变 distance，其余参数原样', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, results: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await queryNearbyByRefno('24381_145018', 1500, {
      source_mode: 'bran_centerline',
      include_self: false,
      nouns: 'SCTN,WALL',
      keyword: 'col',
      sort: 'distance',
      include_negative: false,
      page: 2,
      per_page: 50,
      shape: 'sphere',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/sqlite-spatial/query');
    expect(url.searchParams.get('mode')).toBe('bran_centerline');
    expect(url.searchParams.get('refno')).toBe('24381_145018');
    expect(url.searchParams.get('distance')).toBe('1500');
    expect(url.searchParams.has('radius')).toBe(false);
    expect(url.searchParams.has('source_mode')).toBe(false);
    expect(url.searchParams.get('include_self')).toBe('false');
    expect(url.searchParams.get('nouns')).toBe('SCTN,WALL');
    expect(url.searchParams.get('keyword')).toBe('col');
    expect(url.searchParams.get('sort')).toBe('distance');
    expect(url.searchParams.get('include_negative')).toBe('false');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('per_page')).toBe('50');
    expect(url.searchParams.get('shape')).toBe('sphere');
  });

  it('queryNearbyRefnos：中心线模式一页拉满 /query 并按 /nearby/refnos 口径拼 refnos / by_dbnum / by_spec_value / truncated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        total_count: 3,
        returned_count: 3,
        has_more: false,
        results: [
          { refno: '24381_1', noun: 'SCTN', spec_value: 13, distance: 120 },
          { refno: '24383_7', noun: 'WALL', spec_value: 11, distance: 300 },
          { refno: '24381_9', noun: 'COLU', spec_value: 13, distance: 450 },
        ],
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryNearbyRefnos({
      refno: '24381_145018',
      radius: 1500,
      source_mode: 'bran_centerline',
      include_self: false,
      page: 3,
      per_page: 20,
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/sqlite-spatial/query');
    expect(url.searchParams.get('mode')).toBe('bran_centerline');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('per_page')).toBe('10000');
    expect(url.searchParams.has('max_results')).toBe(false);

    expect(result).toEqual({
      success: true,
      refnos: ['24381_1', '24383_7', '24381_9'],
      by_dbnum: { '24381': ['24381_1', '24381_9'], '24383': ['24383_7'] },
      by_spec_value: { '13': ['24381_1', '24381_9'], '11': ['24383_7'] },
      total_count: 3,
      truncated: false,
      cap: 10000,
    });
  });

  it('queryNearbyRefnos：中心线模式一页装不下（has_more / 总数多于返回）要标 truncated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        total_count: 12000,
        returned_count: 1,
        has_more: true,
        results: [{ refno: '24381_1', noun: 'SCTN', spec_value: 13 }],
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryNearbyRefnos({ refno: '24381_145018', radius: 1500, source_mode: 'bran_centerline' });
    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.total_count).toBe(12000);
    expect(result.refnos).toEqual(['24381_1']);
  });
});
