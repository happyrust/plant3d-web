import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AnchorMissingError,
  ExpiredError,
  ModelVersionApiError,
  getCompareReadiness,
  getRelease,
  getReleaseDiff,
  getReleaseEvents,
  getRuntimeScene,
  getSnapshot,
  listAnchors,
  listReleases,
  resolveAnchor,
} from './modelVersionApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function versionOk(data: unknown): Response {
  return jsonResponse({ success: true, message: 'ok', data });
}

function historyOk(data: unknown): Response {
  return jsonResponse({ ok: true, data });
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn>, index = 0): URL {
  return new URL(String(fetchMock.mock.calls[index]?.[0]), 'http://localhost');
}

describe('modelVersionApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('MODE', 'test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('/api/model-version/*（success 包装）', () => {
    it('listReleases 应携带查询参数并解出 releases 数组', async () => {
      const fetchMock = vi.fn().mockResolvedValue(versionOk({
        project_name: 'AvevaMarineSample',
        releases: [{
          release_id: 'codex-ams1112-physical-897-quarantine',
          release_lifecycle: 'published',
          release_quality: 'quarantined_visual',
          dbnum: 1112,
          registered_at: '2026-07-18T10:00:00Z',
        }],
      }));
      vi.stubGlobal('fetch', fetchMock);

      const releases = await listReleases({
        project: 'AvevaMarineSample',
        dbnum: 1112,
        quality: 'quarantined_visual',
      });

      const url = calledUrl(fetchMock);
      expect(url.pathname).toBe('/api/model-version/releases');
      expect(url.searchParams.get('project')).toBe('AvevaMarineSample');
      expect(url.searchParams.get('dbnum')).toBe('1112');
      expect(url.searchParams.get('quality')).toBe('quarantined_visual');

      expect(releases).toHaveLength(1);
      expect(releases[0]?.release_id).toBe('codex-ams1112-physical-897-quarantine');
      expect(releases[0]?.release_lifecycle).toBe('published');
      expect(releases[0]?.release_quality).toBe('quarantined_visual');
    });

    it('success:false 应抛出携带后端 message 的 ModelVersionApiError', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ success: false, message: 'project not found', data: null }, 200),
      );
      vi.stubGlobal('fetch', fetchMock);

      const error = await listReleases({ project: 'Nope' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ModelVersionApiError);
      expect((error as ModelVersionApiError).message).toBe('project not found');
      expect(error).not.toBeInstanceOf(ExpiredError);
      expect(error).not.toBeInstanceOf(AnchorMissingError);
    });

    it('getRelease 应解出 release 字段', async () => {
      const fetchMock = vi.fn().mockResolvedValue(versionOk({
        release: { release_id: 'r-1', release_lifecycle: 'published' },
        manifest: {},
      }));
      vi.stubGlobal('fetch', fetchMock);

      const release = await getRelease('r-1', 'AvevaMarineSample');
      expect(calledUrl(fetchMock).pathname).toBe('/api/model-version/releases/r-1');
      expect(release.release_id).toBe('r-1');
    });

    it('getReleaseEvents 应容忍 events 为数组或嵌套 { release, events }', async () => {
      const flat = vi.fn().mockResolvedValue(versionOk({
        events: [{ release_status: 'published', reason: null, created_at: '2026-07-18T10:00:00Z' }],
      }));
      vi.stubGlobal('fetch', flat);
      const flatResult = await getReleaseEvents('r-1');
      expect(flatResult.events).toHaveLength(1);
      expect(flatResult.events[0]?.release_status).toBe('published');

      const nested = vi.fn().mockResolvedValue(versionOk({
        events: {
          release: { release_id: 'r-1' },
          events: [{ release_status: 'staged' }, { release_status: 'published' }],
        },
      }));
      vi.stubGlobal('fetch', nested);
      const nestedResult = await getReleaseEvents('r-1');
      expect(nestedResult.release?.release_id).toBe('r-1');
      expect(nestedResult.events.map((e) => e.release_status)).toEqual(['staged', 'published']);
    });

    it('getReleaseDiff 应解出 data.diff 的 rows 与 summary', async () => {
      const fetchMock = vi.fn().mockResolvedValue(versionOk({
        diff: {
          rows: [{ change_type: 'changed', refno_str: '17496/1', refno_u64: 123, noun: 'BRAN' }],
          summary: { added: 1, changed: 2, deleted: 3, unchanged: 4, total_old: 9, total_new: 8 },
        },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const diff = await getReleaseDiff({
        project: 'AvevaMarineSample',
        fromReleaseId: 'r-from',
        toReleaseId: 'r-to',
        limit: 5000,
        changeType: 'all',
      });

      const url = calledUrl(fetchMock);
      expect(url.pathname).toBe('/api/model-version/diff');
      expect(url.searchParams.get('from_release_id')).toBe('r-from');
      expect(url.searchParams.get('to_release_id')).toBe('r-to');
      expect(url.searchParams.get('limit')).toBe('5000');
      expect(url.searchParams.get('change_type')).toBe('all');

      expect(diff.rows).toHaveLength(1);
      expect(diff.rows[0]?.refno_str).toBe('17496/1');
      expect(diff.summary.changed).toBe(2);
    });

    it('getCompareReadiness 应解出 data.readiness', async () => {
      const fetchMock = vi.fn().mockResolvedValue(versionOk({
        readiness: {
          classification: 'quarantined_pair',
          production_ready: false,
          problems: ['quarantined_visual release'],
          warnings: [],
          recommended_action: 'diagnostic_only',
        },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const readiness = await getCompareReadiness({
        project: 'AvevaMarineSample',
        fromReleaseId: 'r-from',
        toReleaseId: 'r-to',
      });
      expect(readiness.production_ready).toBe(false);
      expect(readiness.classification).toBe('quarantined_pair');
      expect(readiness.recommended_action).toBe('diagnostic_only');
    });

    it('getRuntimeScene 应透传分页字段 has_more / next_offset', async () => {
      const fetchMock = vi.fn().mockResolvedValue(versionOk({
        release: { release_id: 'r-1' },
        scene: { components: [{ component_key: '1112:123' }] },
        has_more: true,
        next_offset: 2000,
      }));
      vi.stubGlobal('fetch', fetchMock);

      const scene = await getRuntimeScene('r-1', { offset: 0, limit: 2000, project: 'AvevaMarineSample' });
      const url = calledUrl(fetchMock);
      expect(url.pathname).toBe('/api/model-version/releases/r-1/runtime-scene');
      expect(url.searchParams.get('offset')).toBe('0');
      expect(url.searchParams.get('limit')).toBe('2000');
      expect(scene.has_more).toBe(true);
      expect(scene.next_offset).toBe(2000);
      expect(scene.scene?.components).toHaveLength(1);
    });

    it('HTTP 非 2xx 应抛 ModelVersionApiError 并带状态码', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ success: false, message: 'boom', data: null }, 502),
      );
      vi.stubGlobal('fetch', fetchMock);

      const error = await getReleaseDiff({
        project: 'p',
        fromReleaseId: 'a',
        toReleaseId: 'b',
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ModelVersionApiError);
      expect((error as ModelVersionApiError).status).toBe(502);
      expect((error as ModelVersionApiError).message).toBe('boom');
    });
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

    it('ok:false 其它 code 应抛一般 ModelVersionApiError（QueryFailed）', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        ok: false,
        error: { code: 'QueryFailed', message: 'list_anchors failed: db offline' },
      }, 502));
      vi.stubGlobal('fetch', fetchMock);

      const error = await listAnchors(1112).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ModelVersionApiError);
      expect(error).not.toBeInstanceOf(ExpiredError);
      expect(error).not.toBeInstanceOf(AnchorMissingError);
      expect((error as ModelVersionApiError).message).toContain('list_anchors failed');
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

  describe('AbortSignal（FR-033/034）', () => {
    it('应把 signal 透传给 fetch，abort 时抛出 AbortError 而非业务错误', async () => {
      const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
        }
        return Promise.resolve(versionOk({ releases: [] }));
      });
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      controller.abort();

      const error = await listReleases({ project: 'p' }, { signal: controller.signal })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe('AbortError');
      expect(error).not.toBeInstanceOf(ModelVersionApiError);
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    });

    it('未 abort 时同一 signal 不影响正常返回', async () => {
      const fetchMock = vi.fn().mockResolvedValue(versionOk({ releases: [{ release_id: 'r-1' }] }));
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      const releases = await listReleases(undefined, { signal: controller.signal });
      expect(releases).toHaveLength(1);
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    });
  });
});
