import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MBD_FETCH_TIMEOUT_MS,
  MBD_OBJECT_ROUTE_FALLBACK_NOTE,
  MBD_RESPONSE_MAX_BYTES,
  fetchMbdV2ObjectData,
  fetchMbdV2PipeData,
} from './mbdV2Api';

/**
 * #103 M7：按对象取数走 `/api/mbd/v2/object/{refno}`，护栏与管道端点共用；灰度期后端还没有这条
 * 路由时（404 且正文不是错误信封）回退 `/pipe/{refno}` 一次并留一句说明。
 */

const EQUI = '24381_200001';

/** 读取器到位前服务端回的设备包：只有信封，外加一条 `layout.not_implemented`。 */
const equipmentPayload = {
  version: 'v2',
  annotation_type: 'em4_equi',
  subject: { refno: EQUI, noun: 'EQUI' },
  input_refno: EQUI,
  branch_refno: EQUI,
  primitives: [],
  meta: { geometry_space: 'design_m', notes: ['solver-note'] },
  issues: [{
    id: 'layout.not_implemented',
    severity: 'warning',
    category: 'other',
    message: 'em4_equi 的标注还没有实现',
  }],
};

/** 只有 `/pipe` 的老后端回的包：没有信封字段。 */
const pipePayload = {
  version: 'v2',
  input_refno: EQUI,
  branch_refno: EQUI,
  primitives: [],
  meta: { geometry_space: 'design_m', notes: [] },
  issues: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestedPaths(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost').pathname);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('fetchMbdV2ObjectData', () => {
  it('requests /api/mbd/v2/object/{refno} and passes annotation_type / subject through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(equipmentPayload));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMbdV2ObjectData(` ${EQUI} `);

    expect(requestedPaths(fetchMock)).toEqual([`/api/mbd/v2/object/${EQUI}`]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.annotation_type).toBe('em4_equi');
    expect(result.data.subject).toEqual({ refno: EQUI, noun: 'EQUI' });
    expect(result.data.issues.map(issue => issue.id)).toEqual(['layout.not_implemented']);
    // 没有回退就没有回退说明。
    expect(result.data.meta.notes).toEqual(['solver-note']);
  });

  it('encodes the refno the same way as the pipe route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(equipmentPayload));
    vi.stubGlobal('fetch', fetchMock);

    await fetchMbdV2ObjectData('24381/200001');

    expect(requestedPaths(fetchMock)).toEqual(['/api/mbd/v2/object/24381%2F200001']);
  });

  it('sends nothing for an empty refno', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMbdV2ObjectData('   ')).resolves.toEqual({
      ok: false,
      error: 'MBD V2 refno must not be empty',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('422 not_annotatable: the envelope message reaches the panel and nothing falls back', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      code: 'not_annotatable',
      message: 'refno 24381/1（ATTA）不是可出 MBD 标注的对象',
      detail: null,
    }, 422));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMbdV2ObjectData('24381_1')).resolves.toEqual({
      ok: false,
      error: 'refno 24381/1（ATTA）不是可出 MBD 标注的对象',
    });
    expect(requestedPaths(fetchMock)).toEqual(['/api/mbd/v2/object/24381_1']);
  });

  it('404 with a not_found envelope is a real answer: no fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      code: 'not_found',
      message: '库里没有 refno 24381/999999',
      detail: null,
    }, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMbdV2ObjectData('24381_999999')).resolves.toEqual({
      ok: false,
      error: '库里没有 refno 24381/999999',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an empty body (axum unknown route)', null],
    ['a proxy error page', '<html><body>404 Not Found</body></html>'],
    ['JSON that is not an error envelope', JSON.stringify({ error: 'no route' })],
  ])('404 with %s: retries /pipe once and notes the fallback', async (_label, body) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(body, { status: 404 }))
      .mockResolvedValueOnce(json(pipePayload));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMbdV2ObjectData(EQUI);

    expect(requestedPaths(fetchMock)).toEqual([
      `/api/mbd/v2/object/${EQUI}`,
      `/api/mbd/v2/pipe/${EQUI}`,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.annotation_type).toBeUndefined();
    expect(result.data.meta.notes).toEqual([MBD_OBJECT_ROUTE_FALLBACK_NOTE]);
  });

  it('a failed fallback keeps the pipe reason and says the object route was missing', async () => {
    const reason = 'refno 24381/200001（EQUI）不是派生隐式管身的路由容器，没有管道尺寸标注';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(json({ code: 'precondition', message: reason, detail: null }, 422));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMbdV2ObjectData(EQUI)).resolves.toEqual({
      ok: false,
      error: `${reason}；${MBD_OBJECT_ROUTE_FALLBACK_NOTE}`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forwards partial to the contract parser on the fallback request', async () => {
    const futurePayload = { ...pipePayload, primitives: [{ kind: 'future_dim', id: 'future-1' }] };
    const respond = () => vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(json(futurePayload));

    vi.stubGlobal('fetch', respond());
    const strict = await fetchMbdV2ObjectData(EQUI);
    expect(strict.ok).toBe(false);

    vi.stubGlobal('fetch', respond());
    const partial = await fetchMbdV2ObjectData(EQUI, { partial: true });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.diagnostics).toEqual([
      { id: 'future-1', reason: '还不认识的图元 kind：future_dim' },
    ]);
    expect(partial.data.meta.notes).toEqual([MBD_OBJECT_ROUTE_FALLBACK_NOTE]);
  });

  it.each([
    [500, ''],
    [502, '<html><body>Bad Gateway</body></html>'],
    [405, ''],
  ])('status %i does not fall back', async (status, body) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMbdV2ObjectData(EQUI);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`status ${status}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies the Content-Length guard to the object route', async () => {
    const textSpy = vi.fn();
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': String(MBD_RESPONSE_MAX_BYTES + 1) }),
      text: textSpy,
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await fetchMbdV2ObjectData(EQUI);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('响应过大');
    expect(textSpy).not.toHaveBeenCalled();
  });

  it('timeout: an object request that never settles ends as ok:false, without a fallback', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchMbdV2ObjectData(EQUI);
    await vi.advanceTimersByTimeAsync(MBD_FETCH_TIMEOUT_MS);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('超时');
      expect(result.error).toContain(`/api/mbd/v2/object/${EQUI}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('timeout on the fallback request: the pipe request gets its own budget', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchMbdV2ObjectData(EQUI);
    await vi.advanceTimersByTimeAsync(MBD_FETCH_TIMEOUT_MS);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('超时');
      expect(result.error).toContain(`/api/mbd/v2/pipe/${EQUI}`);
      expect(result.error).toContain(MBD_OBJECT_ROUTE_FALLBACK_NOTE);
    }
  });

  it('caller abort: AbortError is rethrown and no fallback request is made', async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const pending = fetchMbdV2ObjectData(EQUI, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caller abort during the fallback request is rethrown as AbortError too', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const pending = fetchMbdV2ObjectData(EQUI, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchMbdV2PipeData stays on the pipe route', () => {
  it('a 404 without an envelope is reported as before, with no second request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMbdV2PipeData(EQUI)).resolves.toEqual({
      ok: false,
      error: 'MBD V2 API responded with status 404',
    });
    expect(requestedPaths(fetchMock)).toEqual([`/api/mbd/v2/pipe/${EQUI}`]);
  });
});
