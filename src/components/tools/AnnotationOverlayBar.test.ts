import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, shallowRef } from 'vue';

describe('AnnotationOverlayBar', () => {
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

  it('应在批注模式或存在当前批注时显示 toolbar，并支持打开 dock 批注面板', async () => {
    const ensurePanelAndActivate = vi.fn();
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate,
    }));

    const [{ default: AnnotationOverlayBar }, { useToolStore }] = await Promise.all([
      import('./AnnotationOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('annotation');
    store.addAnnotation({
      id: 'text-1',
      entityId: 'entity-1',
      worldPos: [1, 2, 3],
      visible: true,
      glyph: '1',
      title: 'Text 1',
      description: '',
      createdAt: 1,
    });

    const tools = {
      ready: ref(true),
      statusText: ref('文字批注'),
      flyToAnnotation: vi.fn(),
      removeAnnotation: vi.fn((id: string) => {
        store.removeAnnotation(id);
      }),
      flyToCloudAnnotation: vi.fn(),
      flyToRectAnnotation: vi.fn(),
      flyToObbAnnotation: vi.fn(),
      removeCloudAnnotation: vi.fn(),
      removeRectAnnotation: vi.fn(),
      removeObbAnnotation: vi.fn(),
    };

    const app = createApp(AnnotationOverlayBar, { tools });
    app.mount(host);
    await nextTick();

    expect(host.querySelector('[data-testid="annotation-overlay-bar"]')).toBeTruthy();

    (host.querySelector('[data-testid="annotation-overlay-details-toggle"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(ensurePanelAndActivate).toHaveBeenCalledWith('annotation');

    // 展开抽屉后访问删除按钮
    (host.querySelector('[data-testid="annotation-overlay-more"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    (host.querySelector('[data-testid="annotation-overlay-delete-current"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(store.annotations.value).toHaveLength(0);
    expect(store.activeAnnotationId.value).toBeNull();

    app.unmount();
    host.remove();
    host = null;
  });

  it('应支持切换四种批注模式，并按当前批注类型执行批量动作', async () => {
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    const [{ default: AnnotationOverlayBar }, { useToolStore }] = await Promise.all([
      import('./AnnotationOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('annotation_cloud');
    store.addCloudAnnotation({
      id: 'cloud-1',
      objectIds: ['cloud-1'],
      anchorWorldPos: [0, 0, 0],
      visible: true,
      title: 'Cloud 1',
      description: '',
      createdAt: 1,
      refnos: ['cloud-1'],
    });
    store.addCloudAnnotation({
      id: 'cloud-2',
      objectIds: ['cloud-2'],
      anchorWorldPos: [1, 1, 1],
      visible: false,
      title: 'Cloud 2',
      description: '',
      createdAt: 2,
      refnos: ['cloud-2'],
    });
    store.activeCloudAnnotationId.value = 'cloud-1';

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('云线批注'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn((id: string) => {
          store.removeCloudAnnotation(id);
        }),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="annotation-overlay-mode-rect"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(store.toolMode.value).toBe('annotation_rect');

    (host.querySelector('[data-testid="annotation-overlay-mode-rect"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(store.toolMode.value).toBe('none');

    store.setToolMode('annotation_cloud');
    await nextTick();

    // 展开抽屉后访问批量操作按钮
    (host.querySelector('[data-testid="annotation-overlay-more"]') as HTMLButtonElement | null)?.click();
    await nextTick();

    const typeVisibilityButton = host.querySelector('[data-testid="annotation-overlay-type-visibility"]') as HTMLButtonElement | null;
    expect(typeVisibilityButton?.title).toBe('当前类型全部显示');
    typeVisibilityButton?.click();
    await nextTick();
    expect(store.cloudAnnotations.value.every((item: any) => item.visible)).toBe(true);

    (host.querySelector('[data-testid="annotation-overlay-all-visibility"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(store.cloudAnnotations.value.every((item: any) => item.visible === false)).toBe(true);

    (host.querySelector('[data-testid="annotation-overlay-type-clear"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(store.cloudAnnotations.value).toHaveLength(0);

    app.unmount();
    host.remove();
    host = null;
  });

  it('按 Escape 或点击退出后，应退出批注模式；若仍有 active 批注则 toolbar 继续显示', async () => {
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    const [{ default: AnnotationOverlayBar }, { useToolStore }] = await Promise.all([
      import('./AnnotationOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('annotation');
    store.addAnnotation({
      id: 'text-esc',
      entityId: 'entity-esc',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: 'E',
      title: 'Esc',
      description: '',
      createdAt: 1,
    });
    store.activeAnnotationId.value = 'text-esc';

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('文字批注'),
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

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(store.toolMode.value).toBe('none');
    expect(host.querySelector('[data-testid="annotation-overlay-bar"]')).toBeTruthy();

    (host.querySelector('[data-testid="annotation-overlay-exit"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(store.toolMode.value).toBe('none');
    expect(host.querySelector('[data-testid="annotation-overlay-bar"]')).toBeTruthy();

    store.activeAnnotationId.value = null;
    await nextTick();
    expect(host.querySelector('[data-testid="annotation-overlay-bar"]')).toBeFalsy();

    app.unmount();
    host.remove();
    host = null;
  });

  it('更多抽屉中提供当前批注/批量严重度快捷，具备权限时能写入 store', async () => {
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref({ id: 'reviewer-1', role: 'reviewer', name: 'R' }),
      }),
    }));

    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    const [{ default: AnnotationOverlayBar }, { useToolStore }] = await Promise.all([
      import('./AnnotationOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('annotation');
    store.addAnnotation({
      id: 'text-sev-1',
      entityId: 'e-1',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: 'A',
      title: 'A',
      description: '',
      createdAt: 1,
    });
    store.addAnnotation({
      id: 'text-sev-2',
      entityId: 'e-2',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: 'B',
      title: 'B',
      description: '',
      createdAt: 2,
    });
    store.activeAnnotationId.value = 'text-sev-1';

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true), statusText: ref('文字批注'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="annotation-overlay-more"]') as HTMLButtonElement | null)?.click();
    await nextTick();

    const critBtn = host.querySelector('[data-testid="annotation-overlay-severity-critical"]') as HTMLButtonElement | null;
    expect(critBtn).toBeTruthy();
    expect(critBtn?.hasAttribute('disabled')).toBe(false);
    critBtn?.click();
    await nextTick();
    expect(store.annotations.value.find((a: any) => a.id === 'text-sev-1').severity).toBe('critical');

    const batchSevBtn = host.querySelector('[data-testid="annotation-overlay-batch-severity-severe"]') as HTMLButtonElement | null;
    expect(batchSevBtn).toBeTruthy();
    batchSevBtn?.click();
    await nextTick();
    expect(store.annotations.value.every((a: any) => a.severity === 'severe')).toBe(true);

    const batchClear = host.querySelector('[data-testid="annotation-overlay-batch-severity-clear"]') as HTMLButtonElement | null;
    batchClear?.click();
    await nextTick();
    expect(store.annotations.value.every((a: any) => a.severity === undefined)).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });

  it('未登录用户在 drawer 中看到严重度按钮为 disabled', async () => {
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({ currentUser: ref(null) }),
    }));

    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    const [{ default: AnnotationOverlayBar }, { useToolStore }] = await Promise.all([
      import('./AnnotationOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('annotation');
    store.addAnnotation({
      id: 'text-anon', entityId: 'e', worldPos: [0, 0, 0],
      visible: true, glyph: 'A', title: 'A', description: '', createdAt: 1,
    });
    store.activeAnnotationId.value = 'text-anon';

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true), statusText: ref('文字批注'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="annotation-overlay-more"]') as HTMLButtonElement | null)?.click();
    await nextTick();

    const critBtn = host.querySelector('[data-testid="annotation-overlay-severity-critical"]') as HTMLButtonElement | null;
    const batchCritBtn = host.querySelector('[data-testid="annotation-overlay-batch-severity-critical"]') as HTMLButtonElement | null;
    expect(critBtn?.hasAttribute('disabled')).toBe(true);
    expect(batchCritBtn?.hasAttribute('disabled')).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });
});
