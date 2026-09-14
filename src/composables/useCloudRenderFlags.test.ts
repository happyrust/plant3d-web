import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLOUD_RENDER_FLAG_STORAGE_KEY,
  isCloudRenderFlagEnabled,
  resetCloudRenderFlagCache,
  setCloudRenderFlag,
} from './useCloudRenderFlags';

/** 本测试环境没有 localStorage 全局；给一个内存实现，测持久化路径 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
  } as Storage;
}

describe('useCloudRenderFlags', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    window.history.replaceState({}, '', '/');
    resetCloudRenderFlagCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
    resetCloudRenderFlagCache();
  });

  it('默认全开', () => {
    expect(isCloudRenderFlagEnabled('cloudLabelLayoutV1')).toBe(true);
    expect(isCloudRenderFlagEnabled('cloudDirtyCache')).toBe(true);
  });

  it('localStorage 覆盖并持久化；坏 JSON 当没设', () => {
    setCloudRenderFlag('cloudDirtyCache', false);
    expect(isCloudRenderFlagEnabled('cloudDirtyCache')).toBe(false);
    expect(isCloudRenderFlagEnabled('cloudLabelLayoutV1')).toBe(true);
    expect(JSON.parse(localStorage.getItem(CLOUD_RENDER_FLAG_STORAGE_KEY)!)).toEqual({ cloudDirtyCache: false });

    localStorage.setItem(CLOUD_RENDER_FLAG_STORAGE_KEY, '{not json');
    resetCloudRenderFlagCache();
    expect(isCloudRenderFlagEnabled('cloudDirtyCache')).toBe(true);
  });

  it('URL 参数优先于 localStorage；未知名字与非法值忽略', () => {
    setCloudRenderFlag('cloudLabelLayoutV1', false);
    window.history.replaceState({}, '', '/?cloud_render_flags=cloudLabelLayoutV1:1,cloudDirtyCache:off,nope:1,cloudDirtyCache:maybe');
    resetCloudRenderFlagCache();
    expect(isCloudRenderFlagEnabled('cloudLabelLayoutV1')).toBe(true);
    expect(isCloudRenderFlagEnabled('cloudDirtyCache')).toBe(false);
  });
});
