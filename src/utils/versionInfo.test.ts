import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadVersionInfo } from './versionInfo';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('versionInfo', () => {
  it('应能解析 JSON 版本信息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        version: '1.2.3',
        commit: 'abc123',
        buildDate: '2026-03-16 10:00:00 UTC',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      })
    ));

    await expect(loadVersionInfo('/version.json')).resolves.toEqual({
      version: '1.2.3',
      commit: 'abc123',
      buildDate: '2026-03-16 10:00:00 UTC',
    });
  });

  it('在返回 HTML 时应静默回退为 null', async () => {
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'Content-Type': 'text/html; charset=utf-8',
      }),
      json,
    }));

    await expect(loadVersionInfo('/version.json')).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
  });
});
