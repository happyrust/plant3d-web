import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeMbdV2HttpFailure, fetchMbdV2PipeData, resolveMbdApiBaseUrl } from './mbdV2Api';

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
});

describe('fetchMbdV2PipeData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it('空 refno 不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMbdV2PipeData('   ')).resolves.toEqual({
      ok: false,
      error: 'MBD V2 refno must not be empty',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
