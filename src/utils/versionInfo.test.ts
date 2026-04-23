import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadVersionInfo } from './versionInfo';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('versionInfo', () => {
  it('UTC 时间的 buildDate 应转换为跨时区稳定的「北京时间」字符串', async () => {
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
      buildDate: '2026-03-16 18:00:00 北京时间',
    });
  });

  it('UTC+8 时间的 buildDate 保持墙钟时间不变', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        version: '1.2.3',
        commit: 'abc123',
        buildDate: '2026-03-16 18:00:00 UTC+8',
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
      buildDate: '2026-03-16 18:00:00 北京时间',
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
