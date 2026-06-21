import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

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

describe('MbdAnnotationStylePanel', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('renders presets and applies a style preset', async () => {
    const [{ default: MbdAnnotationStylePanel }, { useMbdDrawingStyleStore }] = await Promise.all([
      import('./MbdAnnotationStylePanel.vue'),
      import('@/composables/mbd/mbdDrawingStyleProfile'),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(MbdAnnotationStylePanel);
    app.mount(host);
    await nextTick();

    expect(host.textContent).toContain('图纸增强');
    expect(host.textContent).toContain('深色轮廓');
    expect(host.textContent).toContain('轻量审核');

    const preset = host.querySelector('[data-testid="mbd-style-preset-dark"]') as HTMLButtonElement | null;
    expect(preset).toBeTruthy();
    preset?.click();
    await nextTick();

    const store = useMbdDrawingStyleStore();
    expect(store.profile.dimension.lineColor).toBe(0xe11d48);
    expect(store.profile.modelEdges.lineWidthPx).toBe(4.2);

    app.unmount();
    host.remove();
  });
});
