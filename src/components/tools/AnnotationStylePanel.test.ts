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

describe('AnnotationStylePanel', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('应展示可联动的引线预览条', async () => {
    const [{ default: AnnotationStylePanel }, { useAnnotationStyleStore }] = await Promise.all([
      import('./AnnotationStylePanel.vue'),
      import('@/composables/useAnnotationStyleStore'),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(AnnotationStylePanel);
    app.mount(host);
    await nextTick();

    const store = useAnnotationStyleStore();
    store.updateStyle('text', {
      lineWidth: 7,
      haloLineWidth: 12,
      color: 0x123456,
    });
    await nextTick();

    const preview = host.querySelector('[data-testid="annotation-style-preview-text"]') as HTMLElement | null;
    const line = host.querySelector('[data-testid="annotation-style-preview-line-text"]') as HTMLElement | null;
    const halo = host.querySelector('[data-testid="annotation-style-preview-halo-text"]') as HTMLElement | null;

    expect(preview).toBeTruthy();
    expect(line?.style.height).toBe('7px');
    expect(halo?.style.height).toBe('12px');
    expect(line?.style.background).toContain('#123456');

    app.unmount();
    host.remove();
  });

  it('应支持一键套用引线样式预设', async () => {
    const [{ default: AnnotationStylePanel }, { useAnnotationStyleStore }] = await Promise.all([
      import('./AnnotationStylePanel.vue'),
      import('@/composables/useAnnotationStyleStore'),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(AnnotationStylePanel);
    app.mount(host);
    await nextTick();

    const presetButton = Array.from(host.querySelectorAll('button')).find((el) => el.textContent?.includes('强强调')) as HTMLButtonElement | undefined;
    expect(presetButton).toBeTruthy();

    presetButton?.click();
    await nextTick();

    const store = useAnnotationStyleStore();
    expect(store.style.text.lineWidth).toBeGreaterThan(4.5);
    expect(store.style.text.haloLineWidth).toBeGreaterThan(8);
    expect(store.style.cloud.lineWidth).toBeGreaterThan(4.75);

    app.unmount();
    host.remove();
  });

  it('应以带说明文案的预设卡片展示快捷主题', async () => {
    const [{ default: AnnotationStylePanel }] = await Promise.all([
      import('./AnnotationStylePanel.vue'),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(AnnotationStylePanel);
    app.mount(host);
    await nextTick();

    expect(host.textContent).toContain('柔和');
    expect(host.textContent).toContain('清晰');
    expect(host.textContent).toContain('强强调');
    expect(host.textContent).toContain('更轻更淡');
    expect(host.textContent).toContain('平衡清楚与克制');
    expect(host.textContent).toContain('适合重点标注');

    const cards = host.querySelectorAll('[data-testid^="annotation-style-preset-"]');
    expect(cards.length).toBe(3);

    app.unmount();
    host.remove();
  });
});
