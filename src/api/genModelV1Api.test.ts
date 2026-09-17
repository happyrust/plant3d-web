import { describe, expect, it, vi } from 'vitest';

import {
  fromV1Refno,
  GenModelV1ApiError,
  genModelV1DbnumModelEnsure,
  genModelV1DbnumModelRoots,
  genModelV1Fetch,
  genModelV1MeshUrl,
  genModelV1ModelEnsure,
  genModelV1ModelRecords,
  genModelV1SpatialNearby,
  genModelV1SpatialCenterline,
  genModelV1SpatialNearbyRefnos,
  genModelV1SpatialNearestClearance,
  genModelV1SpatialNegativeNouns,
  genModelV1SurfaceClearance,
  genModelV1TaskGet,
  genModelV1TreeChildren,
  isGenModelV1ApiError,
  isValidGeoHash,
  MAX_MODEL_RECORDS_ROOTS,
  toV1Refno,
} from './genModelV1Api';

const BASE = 'http://gm.test:8022';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function fetchMockReturning(response: Response) {
  return vi.fn<typeof fetch>(async () => response);
}

function fetchMockWithStalledJsonBody() {
  let requestSignal: AbortSignal | null = null;
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    requestSignal = init?.signal ?? null;
    const signal = requestSignal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"status":"ok"'));
        const abort = () => controller.error(signal?.reason ?? new Error('request aborted'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { fetchImpl, requestSignal: () => requestSignal };
}

describe('refno 双向转换（本仓 a_b ⇄ gen-model a/b）', () => {
  it('toV1Refno 把 a_b / a/b / 带空白的写法都压成 a/b', () => {
    expect(toV1Refno('24381_145018')).toBe('24381/145018');
    expect(toV1Refno('24381/145018')).toBe('24381/145018');
    expect(toV1Refno('  24381 _ 145018 ')).toBe('24381/145018');
  });

  it('fromV1Refno 把服务端回的 a_b / a/b 都压成 a_b', () => {
    expect(fromV1Refno('24381_145018')).toBe('24381_145018');
    expect(fromV1Refno('24381/145018')).toBe('24381_145018');
  });

  it('不是 refno 形状的值原样返回，交给服务端 400', () => {
    expect(toV1Refno('root:AvevaMarineSample:/ALL')).toBe('root:AvevaMarineSample:/ALL');
    expect(fromV1Refno('abc')).toBe('abc');
  });
});

describe('genModelV1Fetch 基座', () => {
  it('GET 把身份三元组与 query 一起放进 URL，refno 转成 a/b', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(200, { source: 'direct', parent: '24381/2', nodes: [] }));
    const resp = await genModelV1TreeChildren('24381_2', {
      baseUrl: BASE,
      fetchImpl,
      identity: { project: 'AvevaMarineSample', mdb: 'ALL' },
    });
    expect(resp.parent).toBe('24381/2');
    const [url, init] = fetchImpl.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe(`${BASE}/api/v1/tree/children`);
    expect(parsed.searchParams.get('refno')).toBe('24381/2');
    expect(parsed.searchParams.get('project')).toBe('AvevaMarineSample');
    expect(parsed.searchParams.get('mdb')).toBe('ALL');
    expect(parsed.searchParams.has('namespace')).toBe(false);
    expect(init?.method).toBe('GET');
  });

  it('POST 把身份并进 JSON body；ensure 默认不带 force', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(200, { status: 'AlreadyAvailable', generation_root: '24381/145018' }));
    const resp = await genModelV1ModelEnsure({ refno: '24381_145018' }, { baseUrl: BASE, fetchImpl, identity: { project: 'P' } });
    expect(resp.status).toBe('AlreadyAvailable');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/api/v1/model/ensure`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ project: 'P', refno: '24381/145018' });
  });

  it('model/records：单根发 generation_root、多根发 generation_roots（spec §4.5.2），都转成 a/b；两个都给 / 都不给 / 超 64 根在客户端就 400', async () => {
    const single = fetchMockReturning(jsonResponse(200, { source: 'model-memory', items: [], total: 0, truncated: false, next_cursor: null, generation_root: '24381/145018' }));
    await genModelV1ModelRecords({ generationRoot: '24381_145018', limit: 5000 }, { baseUrl: BASE, fetchImpl: single });
    expect(String(single.mock.calls[0]![0])).toBe(`${BASE}/api/v1/model/records`);
    expect(JSON.parse(String(single.mock.calls[0]![1]?.body))).toEqual({ generation_root: '24381/145018', limit: 5000 });

    const batch = fetchMockReturning(jsonResponse(200, {
      source: 'model-memory', items: [], total: 0, truncated: false, next_cursor: null,
      generation_roots: ['24381/145018', '24381/145052'], roots: [{ generation_root: '24381/145018', total: 0 }, { generation_root: '24381/145052', total: 0 }],
    }));
    const resp = await genModelV1ModelRecords({ generationRoots: ['24381_145018', '24381/145052'], limit: 5000, cursor: 5000 }, { baseUrl: BASE, fetchImpl: batch });
    expect(JSON.parse(String(batch.mock.calls[0]![1]?.body))).toEqual({ generation_roots: ['24381/145018', '24381/145052'], limit: 5000, cursor: 5000 });
    expect(resp.roots).toHaveLength(2);

    const never = fetchMockReturning(jsonResponse(200, {}));
    for (const req of [
      {},
      { generationRoot: '24381_145018', generationRoots: ['24381_145018'] },
      { generationRoots: [] },
      { generationRoots: Array.from({ length: MAX_MODEL_RECORDS_ROOTS + 1 }, (_, i) => `24381_${i}`) },
    ]) {
      const error = await genModelV1ModelRecords(req, { baseUrl: BASE, fetchImpl: never }).then(() => null, (e: unknown) => e);
      expect(isGenModelV1ApiError(error)).toBe(true);
      expect((error as GenModelV1ApiError).code).toBe('bad_request');
    }
    expect(never).not.toHaveBeenCalled();
    expect(MAX_MODEL_RECORDS_ROOTS).toBe(64);
  });

  it('整库入口三发（spec §4.5.3）：ensure 是 POST 空体 + 身份、roots 是 GET、tasks/{id} 按 id 取（只查自己发起的那一个）', async () => {
    const ensure = fetchMockReturning(jsonResponse(202, {
      task_id: 'dbnum-model-ensure-7997-1', dbnum: 7997, expected_roots: 2720, state: 'queued',
      model_source: 'memory', model_source_reason: 'read-through', durable: false,
    }));
    const receipt = await genModelV1DbnumModelEnsure(7997, { baseUrl: BASE, fetchImpl: ensure, identity: { project: 'P' } });
    expect(receipt.expected_roots).toBe(2720);
    expect(receipt.durable).toBe(false);
    expect(String(ensure.mock.calls[0]![0])).toBe(`${BASE}/api/v1/dbnums/7997/model/ensure`);
    expect(ensure.mock.calls[0]![1]?.method).toBe('POST');
    expect(JSON.parse(String(ensure.mock.calls[0]![1]?.body))).toEqual({ project: 'P' });

    const roots = fetchMockReturning(jsonResponse(200, {
      source: 'direct', dbnum: 7997, total: 1, roots: [{ generation_root: '24381/145018', noun: 'EQUI', name: '/PUMP-01' }],
    }));
    const listed = await genModelV1DbnumModelRoots(7997, { baseUrl: BASE, fetchImpl: roots });
    expect(listed.roots[0]!.generation_root).toBe('24381/145018');
    expect(String(roots.mock.calls[0]![0])).toBe(`${BASE}/api/v1/dbnums/7997/model/roots`);
    expect(roots.mock.calls[0]![1]?.method).toBe('GET');

    // 实时半边（plan 2026-09-10 §12）：只要就绪的根 → `?ready=1`，行上带 `ready`
    const readyRoots = fetchMockReturning(jsonResponse(200, {
      source: 'direct', dbnum: 7997, total: 2720, ready_total: 1, only_ready: true,
      roots: [{ generation_root: '24381/145018', noun: 'EQUI', name: '/PUMP-01', ready: true }],
    }));
    const ready = await genModelV1DbnumModelRoots(7997, {
      baseUrl: BASE,
      fetchImpl: readyRoots,
      ready: true,
      taskId: 'dbnum-model-ensure-7997-1',
      identity: { project: 'P' },
    });
    expect(ready.only_ready).toBe(true);
    expect(ready.roots[0]!.ready).toBe(true);
    const readyUrl = new URL(String(readyRoots.mock.calls[0]![0]));
    expect(readyUrl.pathname).toBe('/api/v1/dbnums/7997/model/roots');
    expect(readyUrl.searchParams.get('ready')).toBe('1');
    expect(readyUrl.searchParams.get('task_id')).toBe('dbnum-model-ensure-7997-1');
    expect(readyUrl.searchParams.get('project')).toBe('P');

    const task = fetchMockReturning(jsonResponse(200, {
      task_id: 'dbnum-model-ensure-7997-1', kind: 'dbnum_model_ensure', state: 'running', units_done: 12, total_units: 2720,
    }));
    const entry = await genModelV1TaskGet('dbnum-model-ensure-7997-1', { baseUrl: BASE, fetchImpl: task });
    expect(entry.units_done).toBe(12);
    expect(String(task.mock.calls[0]![0])).toBe(`${BASE}/api/v1/tasks/dbnum-model-ensure-7997-1`);
  });

  it('非 2xx 的 {code,message,detail} 信封原样透出为 GenModelV1ApiError', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(422, {
      code: 'container',
      message: 'SITE 不能做生成根',
      detail: null,
    }));
    const error = await genModelV1Fetch('/api/v1/model/ensure', { baseUrl: BASE, fetchImpl, method: 'POST', body: {} })
      .then(() => null, (e: unknown) => e);
    expect(isGenModelV1ApiError(error)).toBe(true);
    const apiError = error as GenModelV1ApiError;
    expect(apiError.code).toBe('container');
    expect(apiError.status).toBe(422);
    expect(apiError.message).toBe('SITE 不能做生成根');
    expect(apiError.isContainer).toBe(true);
    expect(apiError.isNotFound).toBe(false);
  });

  it('非 JSON 的错误页保留 HTTP 状态并兜 code（404 / 405 / 501 / 504）', async () => {
    const notFound = await genModelV1Fetch('/x', {
      baseUrl: BASE,
      fetchImpl: fetchMockReturning(new Response('<html>nginx 404</html>', { status: 404, statusText: 'Not Found' })),
    }).then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(notFound?.code).toBe('not_found');
    expect(notFound?.isNotFound).toBe(true);

    for (const status of [405, 501]) {
      const unsupported = await genModelV1Fetch('/api/v1/dbnums/7997/model/ensure', {
        baseUrl: BASE,
        fetchImpl: fetchMockReturning(new Response('<html>fallback</html>', { status })),
        method: 'POST',
      }).then(() => null, (e: unknown) => e as GenModelV1ApiError);
      expect(unsupported?.status).toBe(status);
      expect(unsupported?.code).toBe('internal');
    }

    const timeout = await genModelV1Fetch('/x', {
      baseUrl: BASE,
      fetchImpl: fetchMockReturning(new Response('', { status: 504, statusText: 'Gateway Timeout' })),
    }).then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(timeout?.code).toBe('timeout');
    expect(timeout?.isPending).toBe(true);
  });

  it('202 generation_pending 走错误通道，Retry-After 变成 retryAfterMs', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(
      202,
      { code: 'generation_pending', generation_root: '24381/145018' },
      { 'Retry-After': '5' },
    ));
    const error = await genModelV1ModelEnsure({ refno: '24381/145018' }, { baseUrl: BASE, fetchImpl })
      .then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(error?.code).toBe('generation_pending');
    expect(error?.status).toBe(202);
    expect(error?.isPending).toBe(true);
    expect(error?.retryAfterMs).toBe(5000);
  });

  it('fetch 本身抛错归为 network，isRetryable 为真', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await genModelV1Fetch('/api/v1/health', { baseUrl: BASE, fetchImpl })
      .then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(error?.code).toBe('network');
    expect(error?.status).toBe(0);
    expect(error?.isRetryable).toBe(true);
    expect(error?.message).toContain('Failed to fetch');
  });

  it('响应头已到但正文停滞时，请求超时仍会中止正文读取', async () => {
    const stalled = fetchMockWithStalledJsonBody();
    const error = await genModelV1Fetch('/api/v1/health', {
      baseUrl: BASE,
      fetchImpl: stalled.fetchImpl,
      timeoutMs: 20,
    }).then(() => null, (e: unknown) => e as GenModelV1ApiError);

    expect(error?.code).toBe('network');
    expect(error?.abortSource).toBe('timeout');
    expect(error?.message).toContain('请求超时');
    expect(stalled.requestSignal()?.aborted).toBe(true);
  });

  it('响应头已到但正文停滞时，外部 abort 仍会中止正文读取', async () => {
    const stalled = fetchMockWithStalledJsonBody();
    const outer = new AbortController();
    const pending = genModelV1Fetch('/api/v1/health', {
      baseUrl: BASE,
      fetchImpl: stalled.fetchImpl,
      signal: outer.signal,
      timeoutMs: 5_000,
    });
    await vi.waitFor(() => expect(stalled.fetchImpl).toHaveBeenCalledTimes(1));

    outer.abort(new Error('caller cancelled'));
    const error = await pending.then(() => null, (e: unknown) => e as GenModelV1ApiError);

    expect(error?.code).toBe('cancelled');
    expect(error?.isCancelled).toBe(true);
    expect(error?.isRetryable).toBe(false);
    expect(error?.abortSource).toBe('caller');
    expect(error?.message).toContain('caller cancelled');
    expect(stalled.requestSignal()?.aborted).toBe(true);
  });

  it('2xx 但正文不是 JSON → invalid_response', async () => {
    const error = await genModelV1Fetch('/api/v1/health', {
      baseUrl: BASE,
      fetchImpl: fetchMockReturning(new Response('<html>login</html>', { status: 200 })),
    }).then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(error?.code).toBe('invalid_response');
  });
});

describe('genModelV1MeshUrl / isValidGeoHash（与服务端 mesh_glb::is_valid_geo_hash 同一道门）', () => {
  it('内容寻址键放行，拼成 /api/v1/meshes/{hash}.mesh（rkyv 直连口径）', () => {
    expect(genModelV1MeshUrl('12240963882128803248', BASE)).toBe(`${BASE}/api/v1/meshes/12240963882128803248.mesh`);
    expect(genModelV1MeshUrl('e3d_baked_v2_deadbeef', '/gm')).toBe('/gm/api/v1/meshes/e3d_baked_v2_deadbeef.mesh');
  });

  it('路径花招与非法字符在客户端就拦下', () => {
    for (const bad of ['', '..', '../1', 'a/b', 'a\\b', '1.mesh', 'x y', 'a'.repeat(129)]) {
      expect(isValidGeoHash(bad)).toBe(false);
      expect(() => genModelV1MeshUrl(bad, BASE)).toThrow(GenModelV1ApiError);
    }
  });
});

describe('spatial/*（spec §4.13：GET，参数进 query）', () => {
  it('nearby：refno 转 a/b，nouns / dbnums 逗号拼接，include_self=false 显式发出，没给的格不出现在 URL', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(200, { results: [], center: { x: 0, y: 0, z: 0, source: 'refno_aabb_center' } }));
    await genModelV1SpatialNearby(
      { refno: '24381_145018', radius: 5000, shape: 'cube', nouns: ['PIPE', 'EQUI'], dbnums: [24381, 24383], includeSelf: false, sort: 'distance', page: 2, perPage: 500 },
      { baseUrl: BASE, fetchImpl, identity: { project: 'P', mdb: 'M' } },
    );
    const parsed = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(parsed.origin + parsed.pathname).toBe(`${BASE}/api/v1/spatial/nearby`);
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe('GET');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      project: 'P',
      mdb: 'M',
      refno: '24381/145018',
      radius: '5000',
      shape: 'cube',
      nouns: 'PIPE,EQUI',
      dbnums: '24381,24383',
      include_self: 'false',
      sort: 'distance',
      page: '2',
      per_page: '500',
    });
  });

  it('nearby 点模式：x/y/z 逐个进 query（0 也要发），refno 不出现', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(200, { results: [] }));
    await genModelV1SpatialNearby({ position: { x: 0, y: -12.5, z: 3000 }, radius: 100, includeNegative: true }, { baseUrl: BASE, fetchImpl });
    const parsed = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ x: '0', y: '-12.5', z: '3000', radius: '100', include_negative: 'true' });
  });

  it('nearby/refnos 同参但不发 page / per_page；negative-nouns 不带参数', async () => {
    const refnos = fetchMockReturning(jsonResponse(200, { refnos: [], by_dbnum: {}, total_count: 0, truncated_results: false, result_cap: 100000 }));
    await genModelV1SpatialNearbyRefnos({ refno: '24381/145018', radius: 800, includeSelf: false, page: 3, perPage: 50 }, { baseUrl: BASE, fetchImpl: refnos });
    const parsed = new URL(String(refnos.mock.calls[0]![0]));
    expect(parsed.pathname).toBe('/api/v1/spatial/nearby/refnos');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ refno: '24381/145018', radius: '800', include_self: 'false' });

    const negative = fetchMockReturning(jsonResponse(200, { nouns: ['NBOX'] }));
    const resp = await genModelV1SpatialNegativeNouns({ baseUrl: BASE, fetchImpl: negative });
    expect(String(negative.mock.calls[0]![0])).toBe(`${BASE}/api/v1/spatial/negative-nouns`);
    expect(resp.nouns).toEqual(['NBOX']);
  });

  it('503 spatial_not_ready 走错误信封：code 原样、isRetryable 为真、Retry-After 进 retryAfterMs', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(
      503,
      { code: 'spatial_not_ready', message: 'spatial tree is loading', detail: { state: 'loading' } },
      { 'Retry-After': '5' },
    ));
    const error = await genModelV1SpatialNearby({ refno: '24381_145018', radius: 800 }, { baseUrl: BASE, fetchImpl })
      .then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(error?.code).toBe('spatial_not_ready');
    expect(error?.status).toBe(503);
    expect(error?.isRetryable).toBe(true);
    expect(error?.retryAfterMs).toBe(5000);
    expect(error?.detail).toEqual({ state: 'loading' });
  });

  it('nearest-clearance：全部格都进 query（refno 转 a/b，清单逗号拼接，布尔显式发出），路径与方法对', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(200, { success: true, nearest_by_group: [], noun_counts: {}, excluded_self_members: 0, warnings: [] }));
    await genModelV1SpatialNearestClearance(
      {
        sourceRefno: '24381_145018',
        sourceMode: 'bran_centerline',
        targetGroups: ['wall', 'column'],
        targetNouns: ['EQUI', 'SUPPO'],
        groupBy: 'noun',
        excludeNouns: ['WELD', 'ATTA'],
        radius: 1500,
        scope: 'same_dbnum',
        dbnums: [24381, 24383],
        maxPerGroup: 3,
        includeSelf: false,
        surface: true,
        debug: true,
      },
      { baseUrl: BASE, fetchImpl, identity: { project: 'P' } },
    );
    const parsed = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(parsed.origin + parsed.pathname).toBe(`${BASE}/api/v1/spatial/nearest-clearance`);
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe('GET');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      project: 'P',
      source_refno: '24381/145018',
      source_mode: 'bran_centerline',
      target_groups: 'wall,column',
      target_nouns: 'EQUI,SUPPO',
      group_by: 'noun',
      exclude_nouns: 'WELD,ATTA',
      radius: '1500',
      scope: 'same_dbnum',
      dbnums: '24381,24383',
      max_per_group: '3',
      include_self: 'false',
      surface: 'true',
      debug: 'true',
    });
  });

  it('surface-clearance：GET，两个 refno 转 a/b，可选格缺省不出现、给了显式发出，422 target_not_wall 的 detail 原样透出', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(200, {
      success: true, unit: 'mm', method: 'surface_to_surface', accuracy_class: 'exact-surface', error_bound_mm: 0.5,
      target_kind: 'wall', source: { refno: '24384/22582', noun: 'ELBO', leaf_count: 1, triangle_count: 12 },
      target: { refno: '17496/105912', noun: 'WALL', leaf_count: 2, triangle_count: 312 }, result: null,
      model: { source_sesno: 586, target_sesno: 729 }, timing_ms: { load: 0, query: 0, total: 1 }, warnings: [],
    }));
    const resp = await genModelV1SurfaceClearance(
      { sourceRefno: '24384_22582', targetRefno: '17496/105912' },
      { baseUrl: BASE, fetchImpl, identity: { project: 'P' } },
    );
    expect(resp.method).toBe('surface_to_surface');
    let parsed = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(parsed.origin + parsed.pathname).toBe(`${BASE}/api/v1/spatial/surface-clearance`);
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe('GET');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      project: 'P',
      source_refno: '24384/22582',
      target_refno: '17496/105912',
    });

    const fetchAll = fetchMockReturning(jsonResponse(200, { success: true, result: null, warnings: [] }));
    await genModelV1SurfaceClearance(
      { sourceRefno: '24384_22582', targetRefno: '24384_22678', targetKind: 'any', perpendicular: false, maxDistanceMm: 2000, debug: true },
      { baseUrl: BASE, fetchImpl: fetchAll },
    );
    parsed = new URL(String(fetchAll.mock.calls[0]![0]));
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      source_refno: '24384/22582',
      target_refno: '24384/22678',
      target_kind: 'any',
      perpendicular: 'false',
      max_distance_mm: '2000',
      debug: 'true',
    });

    const notWall = fetchMockReturning(jsonResponse(422, {
      code: 'precondition',
      message: 'target_kind=wall 要求目标是墙族（CWALL / WALL / PANE / GWALL / STWALL），24384/22678 是 BEND',
      detail: { reason: 'target_not_wall', refno: '24384/22678', noun: 'BEND' },
    }));
    const error = await genModelV1SurfaceClearance(
      { sourceRefno: '24384_22582', targetRefno: '24384_22678' },
      { baseUrl: BASE, fetchImpl: notWall },
    ).then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(error?.status).toBe(422);
    expect(error?.code).toBe('precondition');
    expect(error?.detail).toEqual({ reason: 'target_not_wall', refno: '24384/22678', noun: 'BEND' });
  });

  it('nearest-clearance：只给 source_refno 时 URL 里只有它（缺省全部交给服务端），空清单不出现', async () => {
    const fetchImpl = fetchMockReturning(jsonResponse(200, { success: true, nearest_by_group: [] }));
    const resp = await genModelV1SpatialNearestClearance(
      { sourceRefno: '24381/145018', targetGroups: [], excludeNouns: [], dbnums: [] },
      { baseUrl: BASE, fetchImpl },
    );
    const parsed = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ source_refno: '24381/145018' });
    expect(resp.nearest_by_group).toEqual([]);
  });

  it('nearest-clearance：源不是 BRAN 的 422 precondition 与库里没有的 404 not_found 都走错误信封', async () => {
    const precondition = fetchMockReturning(jsonResponse(422, { code: 'precondition', message: '不是 BRAN', detail: null }));
    const e1 = await genModelV1SpatialNearestClearance({ sourceRefno: '24381_1' }, { baseUrl: BASE, fetchImpl: precondition })
      .then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(isGenModelV1ApiError(e1)).toBe(true);
    expect(e1?.code).toBe('precondition');
    expect(e1?.message).toBe('不是 BRAN');

    const notFound = fetchMockReturning(jsonResponse(404, { code: 'not_found', message: 'refno 24381_2 不存在', detail: null }));
    const e2 = await genModelV1SpatialNearestClearance({ sourceRefno: '24381_2' }, { baseUrl: BASE, fetchImpl: notFound })
      .then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(e2?.isNotFound).toBe(true);
    expect(e2?.isRetryable).toBe(false);
  });

  it('centerline：refno 转 a/b 进 query，路径 /api/v1/spatial/centerline，线段表原样回来', async () => {
    const body = {
      refno: '24381_145018',
      dbnum: 24381,
      segment_count: 2,
      outside_diameter_mm: 114.3,
      centerline_bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 0, z: 0 } },
      segments: [
        { refno: '24381_145019', order: 0, noun: 'ELBO', implicit: false, start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 }, length_mm: 10, outside_diameter_mm: 114.3 },
        { refno: '24381_145019~24381_145020', order: 1, noun: 'TUBI', implicit: true, start: { x: 10, y: 0, z: 0 }, end: { x: 100, y: 0, z: 0 }, length_mm: 90, outside_diameter_mm: null },
      ],
      warnings: ['1 个成员没有长度（穿过件），不参与走廊'],
    };
    const fetchImpl = fetchMockReturning(jsonResponse(200, body));
    const resp = await genModelV1SpatialCenterline('24381_145018', { baseUrl: BASE, fetchImpl, identity: { project: 'P' } });
    const parsed = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(parsed.origin + parsed.pathname).toBe(`${BASE}/api/v1/spatial/centerline`);
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe('GET');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ project: 'P', refno: '24381/145018' });
    expect(resp.segments).toHaveLength(2);
    expect(resp.segments[1]).toMatchObject({ implicit: true, noun: 'TUBI', outside_diameter_mm: null });
    expect(resp.outside_diameter_mm).toBe(114.3);
  });

  it('centerline：不是 BRAN 的 422 precondition 走错误信封', async () => {
    const precondition = fetchMockReturning(jsonResponse(422, { code: 'precondition', message: '不是 BRAN', detail: null }));
    const error = await genModelV1SpatialCenterline('24381_1', { baseUrl: BASE, fetchImpl: precondition })
      .then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(isGenModelV1ApiError(error)).toBe(true);
    expect(error?.code).toBe('precondition');
    expect(error?.status).toBe(422);
  });
});
