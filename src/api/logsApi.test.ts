import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogsApiError, fetchLogTypes, fetchLogs } from './logsApi';

describe('logsApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('MODE', 'test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('应请求日志类型目录', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          types: [
            { id: 'review.workflow', name: '校审流转历史', filters: ['form_id', 'task_id'], admin_only: false },
            { id: 'api.request', name: '接口日志', filters: ['form_id'], admin_only: true },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const types = await fetchLogTypes();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/logs/types');
    expect(types).toHaveLength(2);
    expect(types[0]?.id).toBe('review.workflow');
  });

  it('应携带过滤参数查询日志', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          type: 'api.request',
          entries: [
            {
              ts_ms: 1765000000000,
              type: 'api.request',
              level: 'warn',
              summary: 'POST /api/review/tasks → 400 (12ms)',
              detail: {},
              correlation: { form_id: 'FORM-1', request_id: 'req-1' },
            },
          ],
          next_cursor: '1765000000000',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const resp = await fetchLogs({
      type: 'api.request',
      formId: 'FORM-1',
      level: 'warn',
      limit: 20,
      cursor: '1765000099999',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/logs');
    expect(url.searchParams.get('type')).toBe('api.request');
    expect(url.searchParams.get('form_id')).toBe('FORM-1');
    expect(url.searchParams.get('level')).toBe('warn');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('cursor')).toBe('1765000099999');

    expect(resp.entries).toHaveLength(1);
    expect(resp.entries[0]?.correlation.form_id).toBe('FORM-1');
    expect(resp.next_cursor).toBe('1765000000000');
  });

  it('无权限时应抛出带后端文案的 LogsApiError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: '当前角色无权查看该类型日志' }), {
        status: 403,
        statusText: 'Forbidden',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLogs({ type: 'api.request' })).rejects.toMatchObject({
      name: 'LogsApiError',
      status: 403,
      message: '当前角色无权查看该类型日志',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    try {
      vi.stubGlobal('fetch', fetchMock);
      await fetchLogs({ type: 'api.request' });
    } catch (error) {
      expect(error).toBeInstanceOf(LogsApiError);
    }
  });
});
