import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RENDER_STYLE_PRESETS } from './useRenderStyleStore';

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

describe('useRenderStyleStore', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('无持久化值时默认使用 e3d 绘制样式', async () => {
    const { useRenderStyleStore } = await import('./useRenderStyleStore');

    const store = useRenderStyleStore();

    expect(store.currentStyle.value).toBe('e3d');
  });

  it('持久化的样式可回读', async () => {
    localStorage.setItem('viewer_render_style', 'xray');

    const { useRenderStyleStore } = await import('./useRenderStyleStore');

    const store = useRenderStyleStore();

    expect(store.currentStyle.value).toBe('xray');
  });

  it('未知持久化值回退到 e3d', async () => {
    localStorage.setItem('viewer_render_style', 'unknown-style');

    const { useRenderStyleStore } = await import('./useRenderStyleStore');

    const store = useRenderStyleStore();

    expect(store.currentStyle.value).toBe('e3d');
  });

  it('setRenderStyle 持久化到 viewer_render_style', async () => {
    const { useRenderStyleStore } = await import('./useRenderStyleStore');

    const store = useRenderStyleStore();
    store.setRenderStyle('wireframe');

    expect(localStorage.getItem('viewer_render_style')).toBe('wireframe');
    expect(store.currentStyle.value).toBe('wireframe');
  });

  it('预设覆盖五种绘制样式且参数完备', () => {
    expect(RENDER_STYLE_PRESETS.map((p) => p.mode)).toEqual([
      'e3d',
      'engineering',
      'pbr',
      'wireframe',
      'xray',
    ]);
    for (const preset of RENDER_STYLE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.opacityScale).toBeGreaterThanOrEqual(0);
      expect(preset.opacityScale).toBeLessThanOrEqual(1);
      expect(preset.flatness).toBeGreaterThanOrEqual(0);
      expect(preset.flatness).toBeLessThanOrEqual(1);
      expect(preset.specularScale).toBeGreaterThanOrEqual(0);
    }
  });

  it('E3D 预设=哑光+平涂+边线+深色渐变底', () => {
    const e3d = RENDER_STYLE_PRESETS.find((p) => p.mode === 'e3d')!;

    expect(e3d.specularScale).toBeLessThan(0.5);
    expect(e3d.flatness).toBeGreaterThan(0);
    expect(e3d.edges.enabled).toBe(true);
    expect(e3d.background).toBe('gradient_dark');
  });

  it('线框=填充全隐+全密度边线；X-ray=半透明', () => {
    const wireframe = RENDER_STYLE_PRESETS.find((p) => p.mode === 'wireframe')!;
    const xray = RENDER_STYLE_PRESETS.find((p) => p.mode === 'xray')!;

    expect(wireframe.opacityScale).toBe(0);
    expect(wireframe.edges.enabled).toBe(true);
    expect(xray.opacityScale).toBeGreaterThan(0);
    expect(xray.opacityScale).toBeLessThan(1);
  });
});
