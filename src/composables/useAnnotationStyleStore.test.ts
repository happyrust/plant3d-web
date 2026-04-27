import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe('useAnnotationStyleStore', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('应提供四类批注引线的默认样式', async () => {
    const { DEFAULT_ANNOTATION_STYLE, useAnnotationStyleStore } = await import('./useAnnotationStyleStore');

    const store = useAnnotationStyleStore();

    expect(store.style.text).toEqual(DEFAULT_ANNOTATION_STYLE.text);
    expect(store.style.cloud).toEqual(DEFAULT_ANNOTATION_STYLE.cloud);
    expect(store.style.rect).toEqual(DEFAULT_ANNOTATION_STYLE.rect);
    expect(store.style.obb).toEqual(DEFAULT_ANNOTATION_STYLE.obb);
  });

  it('更新样式后应持久化，并驱动 buildAnnotationLeaderStyle 读取最新值', async () => {
    const { useAnnotationStyleStore } = await import('./useAnnotationStyleStore');
    const { buildAnnotationLeaderStyle } = await import('./useDtxTools');

    const store = useAnnotationStyleStore();
    store.updateStyle('text', {
      lineWidth: 6.25,
      haloLineWidth: 10.5,
      haloOpacity: 0.38,
    });

    expect(buildAnnotationLeaderStyle('text')).toMatchObject({
      linewidth: 6.25,
      haloLinewidth: 10.5,
      haloOpacity: 0.38,
    });

    await nextTick();

    const raw = localStorage.getItem('plant3d-web-annotation-style-v1');
    expect(raw).toBeTruthy();
    const parsed = raw ? JSON.parse(raw) : null;
    expect(parsed?.text?.lineWidth).toBe(6.25);
    expect(parsed?.text?.haloLineWidth).toBe(10.5);
    expect(parsed?.text?.haloOpacity).toBe(0.38);
  });

  it('套用预设后应批量更新并持久化四类批注样式', async () => {
    const { useAnnotationStyleStore } = await import('./useAnnotationStyleStore');
    const store = useAnnotationStyleStore();

    store.applyPreset('bold');
    await nextTick();

    expect(store.style.text.lineWidth).toBe(6.8);
    expect(store.style.cloud.haloLineWidth).toBe(11.5);
    expect(store.style.rect.opacity).toBe(1);
    expect(store.style.obb.haloOpacity).toBe(0.56);

    const raw = localStorage.getItem('plant3d-web-annotation-style-v1');
    expect(raw).toBeTruthy();
    const parsed = raw ? JSON.parse(raw) : null;
    expect(parsed?.text?.lineWidth).toBe(6.8);
    expect(parsed?.cloud?.haloLineWidth).toBe(11.5);
    expect(parsed?.rect?.opacity).toBe(1);
    expect(parsed?.obb?.haloOpacity).toBe(0.56);
  });
});
