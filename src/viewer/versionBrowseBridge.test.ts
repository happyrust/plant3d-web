import { describe, expect, it, vi } from 'vitest';

import {
  createLazyBrowseApi,
  isVersionBrowseAttach,
  MODEL_VERSION_BROWSE_EVENT,
  requestVersionBrowseApi,
  respondVersionBrowseApi,
  watchVersionBrowseApi,
  type VersionBrowseApi,
} from './versionBrowseBridge';

/**
 * 面板 ↔ 三维的接口桥（spec `model-version-timeline-scrub`，tasks.md 15.4）。
 *
 * 这里钉的是**挂载顺序**：直达链接 `unit_refno` + `compare_autorun=1` 会让版本对比面板
 * 比视口先挂载，那时 `attach` 发出去没人听。早先只发 `attach` 等回调，面板拿到的永远是
 * `null`，`browseEnter` / `browseShow` 全部空转——浏览模式看着进去了，视口一帧都不装。
 */

function fakeApi(overrides: Partial<VersionBrowseApi> = {}): VersionBrowseApi {
  return {
    browseLayerReady: false,
    browseEnter: vi.fn(),
    browseShow: vi.fn(async () => {}),
    browsePending: vi.fn(),
    browseMissing: vi.fn(),
    browseBadge: vi.fn(),
    replaceSide: vi.fn(async () => {}),
    browseExit: vi.fn(),
    open: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('versionBrowseBridge', () => {
  it('视口先挂载时 attach 当场拿到接口', async () => {
    const api = fakeApi();
    const onAttach = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (isVersionBrowseAttach(detail)) detail.respond(api);
    };
    window.addEventListener(MODEL_VERSION_BROWSE_EVENT, onAttach);
    await expect(requestVersionBrowseApi()).resolves.toBe(api);
    window.removeEventListener(MODEL_VERSION_BROWSE_EVENT, onAttach);
  });

  it('面板先挂载：attach 悬着，视口挂载后广播 respond 才兑现', async () => {
    const api = fakeApi();
    let settled: VersionBrowseApi | null | undefined;
    void requestVersionBrowseApi().then((got) => { settled = got; });
    // 这一拍 attach 已经发完，没人回话
    await Promise.resolve();
    expect(settled).toBeUndefined();
    respondVersionBrowseApi(api);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(api);
  });

  it('长期监听：视口晚于面板挂载时也能把接口接上', () => {
    const seen: VersionBrowseApi[] = [];
    const off = watchVersionBrowseApi((api) => seen.push(api));
    const api = fakeApi();
    respondVersionBrowseApi(api);
    off();
    // 卸载后再广播不再回灌
    respondVersionBrowseApi(fakeApi());
    expect(seen).toEqual([api]);
  });

  it('转发对象在接口未就位时不炸，就位后转到真接口', async () => {
    let current: VersionBrowseApi | null = null;
    const lazy = createLazyBrowseApi(() => current);
    // 未就位：调用是空操作，不抛
    expect(() => lazy.browseEnter({ dbnum: 8000, unitRefnos: ['24384/23257'] })).not.toThrow();
    await expect(lazy.browseShow({ dbnum: 8000, sesno: 419, sessionTime: null, units: [] })).resolves.toBeUndefined();

    const api = fakeApi();
    current = api;
    lazy.browseEnter({ dbnum: 8000, unitRefnos: ['24384/23257'] });
    await lazy.browseShow({ dbnum: 8000, sesno: 419, sessionTime: null, units: [] });
    lazy.browseBadge('浏览 · sesno 419');
    lazy.browseExit();
    expect(api.browseEnter).toHaveBeenCalledTimes(1);
    expect(api.browseShow).toHaveBeenCalledTimes(1);
    expect(api.browseBadge).toHaveBeenCalledWith('浏览 · sesno 419');
    expect(api.browseExit).toHaveBeenCalledTimes(1);
  });

  it('转发对象透传 browseLayerReady，未就位时读作 false', () => {
    let current: VersionBrowseApi | null = null;
    const lazy = createLazyBrowseApi(() => current);
    // 未就位：不能是 `undefined`，否则 JSON 序列化会把这个字段整个丢掉，
    // 诊断里「图层没建」与「几何没装上」就分不开了
    expect(lazy.browseLayerReady).toBe(false);
    expect(JSON.parse(JSON.stringify({ ready: lazy.browseLayerReady }))).toEqual({ ready: false });

    current = fakeApi({ browseLayerReady: true });
    expect(lazy.browseLayerReady).toBe(true);
  });
});
