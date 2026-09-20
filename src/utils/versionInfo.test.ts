import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadVersionInfo, versionInfoFromGenModelHealth } from './versionInfo';

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

    // 10:00 UTC = 当天 18:00 北京时间（UTC+8）；格式化按 Asia/Shanghai 墙钟，与运行机器时区无关
    await expect(loadVersionInfo('/version.json')).resolves.toEqual({
      version: '1.2.3',
      commit: 'abc123',
      buildDate: '2026-03-16 18:00:00 北京时间',
    });
  });

  it('从 gen-model health 的 version + build_id 拼出后端版本三元组', () => {
    expect(versionInfoFromGenModelHealth({
      status: 'ok',
      version: '0.1.28',
      build_id: '0.1.28+g65dacd576ebd.1789896841',
    })).toEqual({
      version: '0.1.28',
      commit: '65dacd576ebd',
      buildDate: '2026-09-20 17:34:01 北京时间',
    });
    // 没有 build_id 的旧构建：只有版本号，其余「未知」
    expect(versionInfoFromGenModelHealth({ version: '0.1.21' })).toEqual({
      version: '0.1.21',
      commit: '未知',
      buildDate: '未知',
    });
    expect(versionInfoFromGenModelHealth({ status: 'ok' })).toBeNull();
    expect(versionInfoFromGenModelHealth(null)).toBeNull();
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
