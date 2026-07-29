import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeBranRefno,
  queryBranCenterlineNearestClearance,
  queryNearbyByPosition,
  queryNearbyByRefno,
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
});
