import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

describe('AnnotationPanel', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        storage.set(key, String(value));
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    };
    localStorage.clear();
    vi.resetModules();
  });

  it('reviewer path hides legacy OBB affordances and terminology', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: {
        template: '<div data-testid="review-comments-panel-stub" />',
      },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref(null),
      }),
    }));

    const [{ default: AnnotationPanel }] = await Promise.all([
      import('./AnnotationPanel.vue'),
    ]);

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect(host.textContent).not.toContain('OBB');
    expect(host.textContent).not.toContain('框选');
    expect(host.textContent).toContain('文字');
    expect(host.textContent).toContain('云线');
    expect(host.textContent).toContain('矩形');

    app.unmount();
    host.remove();
    host = null;
  });

  it('不应再为矩形和云线批注弹出编辑框', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: {
        template: '<div data-testid="review-comments-panel-stub" />',
      },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref(null),
      }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.addCloudAnnotation({
      id: 'cloud-1',
      objectIds: ['demo:1'],
      anchorWorldPos: [1, 2, 3],
      leaderEndWorldPos: [2, 3, 4],
      screenOffset: { x: 20, y: -10 },
      cloudSize: { width: 100, height: 60 },
      visible: true,
      title: '云线批注 1',
      description: '',
      createdAt: 1,
      refnos: ['demo:1'],
    });
    store.addRectAnnotation({
      id: 'rect-1',
      objectIds: ['demo:2'],
      obb: {
        center: [3, 4, 5],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [1, 1, 1],
        corners: [
          [2, 3, 4], [4, 3, 4], [4, 5, 4], [2, 5, 4],
          [2, 3, 6], [4, 3, 6], [4, 5, 6], [2, 5, 6],
        ],
      },
      anchorWorldPos: [3, 4, 5],
      leaderEndWorldPos: [5, 6, 7],
      visible: true,
      title: '矩形批注 1',
      description: '',
      createdAt: 2,
      refnos: ['demo:2'],
    });
    store.pendingRectAnnotationEditId.value = 'rect-1';

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect(host.textContent).not.toContain('编辑云线批注');
    expect(host.textContent).not.toContain('编辑矩形批注');

    app.unmount();
    host.remove();
    host = null;
  });

  it('应展示当前类型与当前选中批注摘要，并高亮对应类型卡片', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: {
        template: '<div data-testid="review-comments-panel-stub" />',
      },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref(null),
      }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('annotation_cloud');
    store.addCloudAnnotation({
      id: 'cloud-focus-1',
      objectIds: ['demo:cloud:1'],
      anchorWorldPos: [1, 2, 3],
      visible: true,
      title: '云线焦点批注',
      description: '用于验证当前摘要',
      createdAt: 1,
      refnos: ['demo:cloud:1'],
    });
    store.activeCloudAnnotationId.value = 'cloud-focus-1';

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('云线批注模式'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect((host.querySelector('[data-testid="annotation-panel-current-type-label"]') as HTMLElement | null)?.textContent).toContain('云线批注');
    expect((host.querySelector('[data-testid="annotation-panel-current-selection-label"]') as HTMLElement | null)?.textContent).toContain('云线焦点批注');
    expect((host.querySelector('[data-testid="annotation-panel-section-cloud"]') as HTMLElement | null)?.getAttribute('data-active')).toBe('true');
    expect((host.querySelector('[data-testid="annotation-panel-section-text"]') as HTMLElement | null)?.getAttribute('data-active')).toBe('false');

    app.unmount();
    host.remove();
    host = null;
  });

  it('选中文字批注后，应提供最小化与恢复展开入口', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: {
        template: '<div data-testid="review-comments-panel-stub" />',
      },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref(null),
      }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.addAnnotation({
      id: 'text-min-1',
      entityId: 'entity-min-1',
      worldPos: [1, 2, 3],
      labelWorldPos: [3, 4, 5],
      collapsed: false,
      visible: true,
      glyph: 'A1',
      title: '可最小化文字批注',
      description: '测试入口',
      createdAt: 1,
    });
    store.activeAnnotationId.value = 'text-min-1';

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('文字批注模式'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const toggleButton = host.querySelector('[data-testid="annotation-panel-text-collapse-toggle"]') as HTMLButtonElement | null;
    expect(toggleButton?.textContent).toContain('最小化');

    toggleButton?.click();
    await nextTick();
    expect(store.annotations.value[0].collapsed).toBe(true);

    const expandButton = host.querySelector('[data-testid="annotation-panel-text-collapse-toggle"]') as HTMLButtonElement | null;
    expect(expandButton?.textContent).toContain('恢复展开');

    expandButton?.click();
    await nextTick();
    expect(store.annotations.value[0].collapsed).toBe(false);

    app.unmount();
    host.remove();
    host = null;
  });
});
