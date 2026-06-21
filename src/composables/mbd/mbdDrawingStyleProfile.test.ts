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

describe('useMbdDrawingStyleStore', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('persists MBD dimension style changes', async () => {
    const { useMbdDrawingStyleStore } = await import('./mbdDrawingStyleProfile');
    const store = useMbdDrawingStyleStore();

    store.updateSection('dimension', {
      lineColor: 0x123456,
      lineWidthPx: 7.25,
    });
    await nextTick();

    const raw = localStorage.getItem('plant3d-web-mbd-drawing-style-v1');
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!);
    expect(saved.dimension.lineColor).toBe(0x123456);
    expect(saved.dimension.lineWidthPx).toBe(7.25);
  });

  it('applies presets and resets to defaults', async () => {
    const {
      DEFAULT_MBD_DRAWING_STYLE_PROFILE,
      useMbdDrawingStyleStore,
    } = await import('./mbdDrawingStyleProfile');
    const store = useMbdDrawingStyleStore();

    store.applyPreset('light');
    expect(store.profile.dimension.lineWidthPx).toBeLessThan(DEFAULT_MBD_DRAWING_STYLE_PROFILE.dimension.lineWidthPx);

    store.resetToDefaults();
    expect(store.profile.dimension.lineWidthPx).toBe(DEFAULT_MBD_DRAWING_STYLE_PROFILE.dimension.lineWidthPx);
    expect(store.profile.pipeEmphasis.bodyColor).toBe(DEFAULT_MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bodyColor);
  });
});
