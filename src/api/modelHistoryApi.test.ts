import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AnchorMissingError,
  ExpiredError,
  ModelHistoryApiError,
  getSnapshot,
  listAnchors,
  resolveAnchor,
} from './modelHistoryApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function historyOk(data: unknown): Response {
  return jsonResponse({ ok: true, data });
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn>, index = 0): URL {
  return new URL(String(fetchMock.mock.calls[index]?.[0]), 'http://localhost');
}

describe('modelHistoryApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('MODE', 'test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('/api/model-history/*（ok 包装与错误分类）', () => {
    it('listAnchors 应解出 { dbnum, count, anchors }', async () => {
      const fetchMock = vi.fn().mockResolvedValue(historyOk({
        dbnum: 1112,
        count: 2,
        anchors: [
          { dbnum: 1112, sesno: 896, anchored_at: '2026-07-17T09:00:00Z' },
          { dbnum: 1112, sesno: 897, anchored_at: '2026-07-18T09:00:00Z' },
        ],
      }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await listAnchors(1112);
      const url = calledUrl(fetchMock);
      expect(url.pathname).toBe('/api/model-history/anchors');
      expect(url.searchParams.get('dbnum')).toBe('1112');
      expect(result.count).toBe(2);
      expect(result.anchors[1]?.sesno).toBe(897);
    });

    it('resolveAnchor 404 AnchorMissing 应抛 AnchorMissingError', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        ok: false,
        error: { code: 'AnchorMissing', message: '未找到 dbnum=1112 sesno<=1 的 sesno_version_anchor' },
      }, 404));
      vi.stubGlobal('fetch', fetchMock);

      const error = await resolveAnchor(1112, 1, true).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AnchorMissingError);
      expect((error as AnchorMissingError).status).toBe(404);
      expect((error as AnchorMissingError).message).toContain('sesno_version_anchor');

      const url = calledUrl(fetchMock);
      expect(url.pathname).toBe('/api/model-history/resolve-anchor');
      expect(url.searchParams.get('exact_only')).toBe('true');
    });

    it('snapshot HTTP 410 Expired 应抛 ExpiredError', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        ok: false,
        error: { code: 'Expired', message: 'history expired: dbnum=1112 sesno=10' },
      }, 410));
      vi.stubGlobal('fetch', fetchMock);

      const error = await getSnapshot(1112, 10, '17496/1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ExpiredError);
      expect((error as ExpiredError).status).toBe(410);

      const url = calledUrl(fetchMock);
      expect(url.pathname).toBe('/api/model-history/snapshot');
      expect(url.searchParams.get('refno')).toBe('17496/1');
    });

    it('ok:false 其它 code 应抛一般 ModelHistoryApiError（QueryFailed）', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        ok: false,
        error: { code: 'QueryFailed', message: 'list_anchors failed: db offline' },
      }, 502));
      vi.stubGlobal('fetch', fetchMock);

      const error = await listAnchors(1112).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ModelHistoryApiError);
      expect(error).not.toBeInstanceOf(ExpiredError);
      expect(error).not.toBeInstanceOf(AnchorMissingError);
      expect((error as ModelHistoryApiError).message).toContain('list_anchors failed');
    });

    it('resolveAnchor 正常命中应返回锚点（含 exact 标记）', async () => {
      const fetchMock = vi.fn().mockResolvedValue(historyOk({
        dbnum: 1112,
        sesno: 896,
        anchored_at: '2026-07-17T09:00:00Z',
        exact: false,
      }));
      vi.stubGlobal('fetch', fetchMock);

      const hit = await resolveAnchor(1112, 900);
      expect(hit.sesno).toBe(896);
      expect(hit.exact).toBe(false);
    });
  });

  describe('AbortSignal', () => {
    it('应把 signal 透传给 fetch，abort 时抛出 AbortError 而非业务错误', async () => {
      const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
        }
        return Promise.resolve(historyOk({ dbnum: 1112, count: 0, anchors: [] }));
      });
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      controller.abort();

      const error = await listAnchors(1112, undefined, { signal: controller.signal })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe('AbortError');
      expect(error).not.toBeInstanceOf(ModelHistoryApiError);
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    });

    it('未 abort 时同一 signal 不影响正常返回', async () => {
      const fetchMock = vi.fn().mockResolvedValue(historyOk({
        dbnum: 1112,
        count: 1,
        anchors: [{ dbnum: 1112, sesno: 896 }],
      }));
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      const result = await listAnchors(1112, undefined, { signal: controller.signal });
      expect(result.anchors).toHaveLength(1);
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    });
  });
});
