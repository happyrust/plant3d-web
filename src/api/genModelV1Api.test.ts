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

  it('非 JSON 的错误页按 HTTP 状态兜一个 code（404 → not_found，504 → timeout）', async () => {
    const notFound = await genModelV1Fetch('/x', {
      baseUrl: BASE,
      fetchImpl: fetchMockReturning(new Response('<html>nginx 404</html>', { status: 404, statusText: 'Not Found' })),
    }).then(() => null, (e: unknown) => e as GenModelV1ApiError);
    expect(notFound?.code).toBe('not_found');
    expect(notFound?.isNotFound).toBe(true);

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
