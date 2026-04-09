import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryNearbyByPosition, querySpatialIndex } from './genModelSpatialApi';

describe('genModelSpatialApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('在 position 模式下应发送 x/y/z/radius 参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, results: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await queryNearbyByPosition(10, 20, 30, 40, {
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
});
