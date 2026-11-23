import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MBD_BATCH_ROUTE_FALLBACK_NOTE,
  MBD_FETCH_TIMEOUT_MS,
  MBD_RESPONSE_MAX_BYTES,
  describeMbdV2HttpFailure,
  fetchMbdV2ObjectData,
  fetchMbdV2ObjectsData,
  fetchMbdV2PipeData,
  resetMbdBatchFallbackCacheForTests,
  resolveMbdApiBaseUrl,
} from './mbdV2Api';

describe('resolveMbdApiBaseUrl', () => {
  it('uses a dedicated MBD backend port without redirecting the other APIs', () => {
    expect(resolveMbdApiBaseUrl({
      search: '?backendPort=3101&mbdBackendPort=18084',
      envBase: '',
      browserHostname: '127.0.0.1',
    })).toBe('http://127.0.0.1:18084');
  });

  it('uses the dedicated environment base when no query override exists', () => {
    expect(resolveMbdApiBaseUrl({
      search: '',
      envBase: 'http://localhost:18084/',
      browserHostname: '127.0.0.1',
    })).toBe('http://localhost:18084');
  });

  it('falls back to the normal backend when no dedicated MBD backend exists', () => {
    expect(resolveMbdApiBaseUrl({
      search: '?backendPort=3101',
      envBase: '',
      browserHostname: '127.0.0.1',
    })).toBe('');
  });

  /**
   * `?mbdBackend` 能把整条 MBD 通道指到任意主机（含外网）。缺省必须收紧：
   * 生产构建里忽略该参数，回落到常规后端 / VITE_MBD_API_BASE_URL。
   */
  it('ignores ?mbdBackend unless the caller opts in (production tightening)', () => {
    const search = '?mbdBackend=https://evil.example';
    expect(resolveMbdApiBaseUrl({
      search,
      envBase: '',
      browserHostname: 'app.example.com',
    })).toBe('');
    expect(resolveMbdApiBaseUrl({
      search,
      envBase: 'http://localhost:18084',
      browserHostname: 'app.example.com',
    })).toBe('http://localhost:18084');
  });

  it('still honours ?mbdBackend for dev builds that pass the override flag', () => {
    expect(resolveMbdApiBaseUrl({
      search: '?mbdBackend=http://127.0.0.1:18084/',
      envBase: '',
      browserHostname: 'app.example.com',
      allowQueryBackendOverride: true,
    })).toBe('http://127.0.0.1:18084');
  });
});

describe('describeMbdV2HttpFailure', () => {
  // gen-model web_service::mbd::api_error 的信封原样（2026-09-18 在 :18822 上抓的 422）
  const hvacEnvelope = JSON.stringify({
    code: 'precondition',
    message: 'refno 24381/30278（BRAN）的属主是 HVAC，风管不出管道尺寸标注',
    detail: null,
  });

  it('透出错误信封里的 message，而不是只留状态码', () => {
    expect(describeMbdV2HttpFailure(422, hvacEnvelope))
      .toBe('refno 24381/30278（BRAN）的属主是 HVAC，风管不出管道尺寸标注');
  });

  it('信封 message 两端空白去掉', () => {
    expect(describeMbdV2HttpFailure(404, JSON.stringify({ code: 'not_found', message: '  库里没有  ' })))
      .toBe('库里没有');
  });

  it('正文为空只剩状态码（与旧文案一致）', () => {
    expect(describeMbdV2HttpFailure(502, '')).toBe('MBD V2 API responded with status 502');
    expect(describeMbdV2HttpFailure(502, '   ')).toBe('MBD V2 API responded with status 502');
  });

  it('正文不是 JSON（代理错误页）：状态码 + 正文前 200 字，不吞线索', () => {
    const html = '<html><body>Bad Gateway</body></html>';
    expect(describeMbdV2HttpFailure(502, html))
      .toBe(`MBD V2 API responded with status 502: ${html}`);
    const long = 'x'.repeat(500);
    expect(describeMbdV2HttpFailure(500, long))
      .toBe(`MBD V2 API responded with status 500: ${'x'.repeat(200)}`);
  });

  it('JSON 里没有可用的 message（缺字段 / 非字符串 / 空串 / 非对象）也走兜底', () => {
    expect(describeMbdV2HttpFailure(422, JSON.stringify({ code: 'precondition' })))
      .toBe('MBD V2 API responded with status 422: {"code":"precondition"}');
    expect(describeMbdV2HttpFailure(422, JSON.stringify({ message: 42 })))
      .toBe('MBD V2 API responded with status 422: {"message":42}');
    expect(describeMbdV2HttpFailure(422, JSON.stringify({ message: '' })))
      .toBe('MBD V2 API responded with status 422: {"message":""}');
    expect(describeMbdV2HttpFailure(422, '"just a string"'))
      .toBe('MBD V2 API responded with status 422: "just a string"');
    expect(describeMbdV2HttpFailure(422, 'null'))
      .toBe('MBD V2 API responded with status 422: null');
  });

  it('#135 保持 not_annotatable 已中文化信封（如 17496_73858）原样不变', () => {
    const notAnnotatable = JSON.stringify({
      code: 'not_annotatable',
      message: 'refno 17496_73858（CMFI）是不做尺寸标注的几何/容器节点',
      detail: { refno: '17496_73858', kind: 'CMFI' },
    });
    expect(describeMbdV2HttpFailure(422, notAnnotatable))
      .toBe('refno 17496_73858（CMFI）是不做尺寸标注的几何/容器节点');
  });

  it('#135 将旧后端 422 根错误半截英文信封（如 32573_1）按 detail.issues.rule_id 转译成完整中文', () => {
    const legacyRootError = JSON.stringify({
      code: 'precondition',
      message: 'BRAN 32573/1 建不起可信的成员结点视图：every branch member was skipped for missing geometry',
      detail: {
        branch_refno: '32573_1',
        issues: [{
          id: 'issue-0',
          severity: 'error',
          category: 'data',
          rule_id: 'adapter.no_members_with_geometry',
          message: 'every branch member was skipped for missing geometry',
        }],
      },
    });
    const text = describeMbdV2HttpFailure(422, legacyRootError);
    expect(text).toContain('32573/1');
    expect(text).toContain('管件都缺少可用几何');
    expect(text).not.toContain('every branch member was skipped');
  });
});

describe('fetchMbdV2PipeData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('非 2xx：ok:false 且 error 是信封里的 message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'precondition',
          message: 'refno 24381/30278（BRAN）的属主是 HVAC，风管不出管道尺寸标注',
          detail: null,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMbdV2PipeData('24381_30278');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/mbd/v2/pipe/24381_30278');
    expect(result).toEqual({
      ok: false,
      error: 'refno 24381/30278（BRAN）的属主是 HVAC，风管不出管道尺寸标注',
    });
  });

  it('非 2xx 且正文为空：沿用旧的状态码文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(fetchMbdV2PipeData('24381_1')).resolves.toEqual({
      ok: false,
      error: 'MBD V2 API responded with status 404',
    });
  });

  it('partial 透传到契约解析：不认识的 kind 在 partial 下不再整包失败', async () => {
    const payload = {
      version: 'v2',
      input_refno: 'future',
      branch_refno: 'future',
      primitives: [{ kind: 'future_dim', id: 'future-1' }],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    };
    const respond = () => new Response(
      JSON.stringify(payload),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(respond())));
    const strictDefault = await fetchMbdV2PipeData('24381_1');
    expect(strictDefault.ok).toBe(false);

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(respond())));
    const partial = await fetchMbdV2PipeData('24381_1', { partial: true });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.diagnostics).toEqual([
      { id: 'future-1', reason: '还不认识的图元 kind：future_dim' },
    ]);
  });

  it('空 refno 不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMbdV2PipeData('   ')).resolves.toEqual({
      ok: false,
      error: 'MBD V2 refno must not be empty',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('超时：fetch 永不 settle 时在 MBD_FETCH_TIMEOUT_MS 后返回 ok:false', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchMbdV2PipeData('24381_145018');
    await vi.advanceTimersByTimeAsync(MBD_FETCH_TIMEOUT_MS);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('超时');
      expect(result.error).toContain('15');
    }
    vi.useRealTimers();
  });

  it('Content-Length 超过上限：不读正文直接返回 ok:false', async () => {
    const textSpy = vi.fn();
    const oversized = String(MBD_RESPONSE_MAX_BYTES + 1);
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': oversized }),
      text: textSpy,
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await fetchMbdV2PipeData('24381_145018');

    expect(result).toEqual({
      ok: false,
      error: `MBD V2 API 响应过大：${MBD_RESPONSE_MAX_BYTES + 1} 字节，`
        + `超过上限 ${MBD_RESPONSE_MAX_BYTES} 字节`,
    });
    expect(textSpy).not.toHaveBeenCalled();
  });

  it('Content-Length 缺失（chunked）：放行并正常解析', async () => {
    const payload = {
      version: 'v2',
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      primitives: [],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    };
    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.headers.get('content-length')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await fetchMbdV2PipeData('24381_145018');

    expect(result).toMatchObject({ ok: true });
  });

  it('调用方 signal 主动 abort：AbortError 原样抛出而不是 ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(() => {})));
    const controller = new AbortController();

    const pending = fetchMbdV2PipeData('24381_145018', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('#135 fetchMbdV2ObjectData 在 422 带 detail.issues 时同时返回完整中文 error 与原始 issues 列表', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'precondition',
          message: 'BRAN 32573/1 建不起可信的成员结点视图：every branch member was skipped for missing geometry',
          detail: {
            branch_refno: '32573_1',
            issues: [{
              id: 'issue-0',
              severity: 'error',
              category: 'data',
              rule_id: 'adapter.no_members_with_geometry',
              message: 'every branch member was skipped for missing geometry',
            }],
          },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    ));

    const result = await fetchMbdV2ObjectData('32573_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('32573/1');
    expect(result.error).toContain('管件都缺少可用几何');
    expect(result.error).not.toContain('every branch member was skipped');
    expect(result.issues).toEqual([{
      id: 'issue-0',
      severity: 'error',
      category: 'data',
      rule_id: 'adapter.no_members_with_geometry',
      message: 'every branch member was skipped for missing geometry',
    }]);
  });

  it('无 Content-Length 的 chunked 流超过 MBD_RESPONSE_MAX_BYTES 时立即取消并返回 ok:false', async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    let readCount = 0;
    const chunk = new Uint8Array(Math.ceil(MBD_RESPONSE_MAX_BYTES / 2) + 16);
    const stream = {
      getReader: () => ({
        read: async () => {
          readCount += 1;
          if (readCount <= 3) return { done: false, value: chunk };
          return { done: true, value: undefined };
        },
        cancel: cancelSpy,
        releaseLock: () => {},
      }),
    };
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: stream,
      text: vi.fn(),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await fetchMbdV2PipeData('24381_145018');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('响应过大');
    }
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(readCount).toBe(2);
  });

  it('503 SOURCE_CHANGED 按 Retry-After 自动退避重拉并在恢复后成功', async () => {
    vi.useFakeTimers();
    const validPayload = {
      version: 'v2',
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      primitives: [],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ code: 'SOURCE_CHANGED', message: '库 7999 在读取期间变化，请重新读取', detail: null }),
        { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '1' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify(validPayload),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchMbdV2ObjectData('24381_145018');
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    vi.useRealTimers();
  });
});

describe('fetchMbdV2ObjectsData', () => {
  afterEach(() => {
    resetMbdBatchFallbackCacheForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('多对象走 POST /api/mbd/v2/objects 并按入参顺序返回成功与单条失败', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        items: [
          {
            input_refno: 'A',
            ok: true,
            data: {
              version: 'v2',
              input_refno: 'A',
              branch_refno: 'A',
              primitives: [],
              meta: { geometry_space: 'design_m', notes: [] },
              issues: [],
            },
          },
          {
            input_refno: 'B',
            ok: false,
            status: 422,
            code: 'not_annotatable',
            message: 'PIPE B 没有 MBD 标注',
            detail: { refno: 'B', noun: 'PIPE' },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchMbdV2ObjectsData(['A', 'B']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(rawUrl), 'http://localhost').pathname).toBe('/api/mbd/v2/objects');
    expect((init as RequestInit).method).toBe('POST');
    expect(out.fallbackNote).toBeUndefined();
    expect(out.results).toHaveLength(2);
    expect(out.results[0]?.ok).toBe(true);
    expect(out.results[1]).toEqual({ ok: false, error: 'PIPE B 没有 MBD 标注' });
  });

  it('老后端批量端点回裸 404 时透明回退到逐对象 GET /object/{refno} 并记住降级', async () => {
    const okPkg = (refno: string) => new Response(
      JSON.stringify({
        version: 'v2',
        input_refno: refno,
        branch_refno: refno,
        primitives: [],
        meta: { geometry_space: 'design_m', notes: [] },
        issues: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const fetchMock = vi.fn(async (rawUrl: unknown) => {
      const pathname = new URL(String(rawUrl), 'http://localhost').pathname;
      if (pathname === '/api/mbd/v2/objects') return new Response('', { status: 404 });
      if (pathname.endsWith('/A')) return okPkg('A');
      if (pathname.endsWith('/B')) return okPkg('B');
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchMbdV2ObjectsData(['A', 'B']);
    expect(first.fallbackNote).toBe(MBD_BATCH_ROUTE_FALLBACK_NOTE);
    expect(first.results.every(r => r.ok)).toBe(true);

    // 第二次直接跳过 /objects
    fetchMock.mockClear();
    const second = await fetchMbdV2ObjectsData(['A', 'B']);
    expect(second.fallbackNote).toBe(MBD_BATCH_ROUTE_FALLBACK_NOTE);
    const calledPaths = fetchMock.mock.calls.map(c => new URL(String(c[0]), 'http://localhost').pathname);
    expect(calledPaths).not.toContain('/api/mbd/v2/objects');
  });
});
