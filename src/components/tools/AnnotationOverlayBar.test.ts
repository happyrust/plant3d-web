import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, shallowRef } from 'vue';

const saveAnnotationSeverityMock = vi.hoisted(() => vi.fn());
const captureViewportMock = vi.hoisted(() => vi.fn());
const uploadCapturedScreenshotMock = vi.hoisted(() => vi.fn());
const requestActiveAnnotationCameraMock = vi.hoisted(() => vi.fn());
const emitToastMock = vi.hoisted(() => vi.fn());

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
    const setAnnotationProcessingEntryTarget = vi.fn();
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate,
    }));
    vi.doMock('@/composables/useReviewStore', () => ({
      useReviewStore: () => ({
        currentTask: ref(null),
      }),
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref({ id: 'reviewer-1', role: 'reviewer', name: 'R' }),
      }),
    }));
    vi.doMock('@/components/review/annotationProcessingEntry', () => ({
      setAnnotationProcessingEntryTarget,
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
    expect(setAnnotationProcessingEntryTarget).toHaveBeenCalledWith(expect.objectContaining({
      annotationId: 'text-1',
      annotationType: 'text',
    }));
    expect(ensurePanelAndActivate).toHaveBeenCalledWith('review');

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
    vi.doMock('@/composables/useReviewStore', () => ({
      useReviewStore: () => ({
        currentTask: ref(null),
      }),
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
    vi.doMock('@/composables/useReviewStore', () => ({
      useReviewStore: () => ({
        currentTask: ref(null),
      }),
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

  it('主工具栏 4 键平铺与抽屉冗余入口均能一次点击保存严重度', async () => {
    saveAnnotationSeverityMock.mockReset();
    vi.doMock('@/composables/useAnnotationSeveritySync', () => ({
      saveAnnotationSeverity: saveAnnotationSeverityMock,
    }));
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));
    vi.doMock('@/composables/useReviewStore', () => ({
      useReviewStore: () => ({
        currentTask: ref(null),
      }),
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
    saveAnnotationSeverityMock.mockImplementation(async (annotationType: string, annotationId: string, severity: string | undefined) => {
      store.updateAnnotationSeverity(annotationType, annotationId, severity);
      return true;
    });
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

    expect(host.querySelector('[data-testid="annotation-overlay-drag-handle"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="annotation-overlay-toolbar-severity-trigger"]')).toBeNull();
    const toolbarPrinciple = host.querySelector('[data-testid="annotation-overlay-toolbar-severity-principle"]') as HTMLButtonElement | null;
    expect(toolbarPrinciple).toBeTruthy();
    expect(toolbarPrinciple?.getAttribute('aria-pressed')).toBe('false');
    toolbarPrinciple?.click();
    await nextTick();
    await vi.waitFor(() => {
      expect(saveAnnotationSeverityMock).toHaveBeenCalled();
    });
    expect(saveAnnotationSeverityMock).toHaveBeenCalledWith('text', 'text-sev-1', 'principle', expect.any(Object));
    expect(store.annotations.value.find((a: any) => a.id === 'text-sev-1').severity).toBe('principle');
    await nextTick();
    expect(toolbarPrinciple?.getAttribute('aria-pressed')).toBe('true');

    const toolbarClear = host.querySelector('[data-testid="annotation-overlay-toolbar-severity-clear"]') as HTMLButtonElement | null;
    expect(toolbarClear).toBeTruthy();
    toolbarClear?.click();
    await nextTick();
    expect(store.annotations.value.find((a: any) => a.id === 'text-sev-1').severity).toBeUndefined();

    (host.querySelector('[data-testid="annotation-overlay-more"]') as HTMLButtonElement | null)?.click();
    await nextTick();

    const drawingBtn = host.querySelector('[data-testid="annotation-overlay-severity-drawing"]') as HTMLButtonElement | null;
    expect(drawingBtn).toBeTruthy();
    drawingBtn?.click();
    await nextTick();
    expect(store.annotations.value.find((a: any) => a.id === 'text-sev-1').severity).toBe('drawing');

    const batchSevBtn = host.querySelector('[data-testid="annotation-overlay-batch-severity-general"]') as HTMLButtonElement | null;
    expect(batchSevBtn).toBeTruthy();
    batchSevBtn?.click();
    await nextTick();
    expect(store.annotations.value.every((a: any) => a.severity === 'general')).toBe(true);

    const batchClear = host.querySelector('[data-testid="annotation-overlay-batch-severity-clear"]') as HTMLButtonElement | null;
    batchClear?.click();
    await nextTick();
    expect(store.annotations.value.every((a: any) => a.severity === undefined)).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });

  it('未登录用户在主工具栏与 drawer 中看到严重度按钮为 disabled', async () => {
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));
    vi.doMock('@/composables/useReviewStore', () => ({
      useReviewStore: () => ({
        currentTask: ref(null),
      }),
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

    const toolbarPrinciple = host.querySelector('[data-testid="annotation-overlay-toolbar-severity-principle"]') as HTMLButtonElement | null;
    const toolbarClear = host.querySelector('[data-testid="annotation-overlay-toolbar-severity-clear"]') as HTMLButtonElement | null;
    expect(toolbarPrinciple?.hasAttribute('disabled')).toBe(true);
    expect(toolbarClear?.hasAttribute('disabled')).toBe(true);

    (host.querySelector('[data-testid="annotation-overlay-more"]') as HTMLButtonElement | null)?.click();
    await nextTick();

    const principleBtn = host.querySelector('[data-testid="annotation-overlay-severity-principle"]') as HTMLButtonElement | null;
    const batchPrincipleBtn = host.querySelector('[data-testid="annotation-overlay-batch-severity-principle"]') as HTMLButtonElement | null;
    expect(principleBtn?.hasAttribute('disabled')).toBe(true);
    expect(batchPrincipleBtn?.hasAttribute('disabled')).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });

  it('未选中批注时点击 Camera 按钮 → 走 pending draft 流程（capture + upload + setPendingDraftAnnotationShot）', async () => {
    captureViewportMock.mockReset();
    uploadCapturedScreenshotMock.mockReset();
    requestActiveAnnotationCameraMock.mockReset();
    emitToastMock.mockReset();

    const fakeCapture = {
      blob: new Blob(['fake']),
      dataUrl: 'data:image/png;base64,fake',
      width: 800,
      height: 600,
      capturedAt: 1_730_000_000_000,
      format: 'image/png' as const,
    };
    const fakeAttachment = {
      id: 'att-pending-1',
      name: 'annotation-pending-1730000000000.png',
      url: '/files/att-pending-1.png',
      mimeType: 'image/png',
      type: 'image/png',
      size: 1234,
      width: 800,
      height: 600,
      uploadedAt: 1_730_000_001_000,
      capturedAt: 1_730_000_000_000,
    };

    captureViewportMock.mockResolvedValue(fakeCapture);
    uploadCapturedScreenshotMock.mockResolvedValue(fakeAttachment);

    vi.doMock('@/composables/useScreenshot', () => ({
      useScreenshot: () => ({
        captureViewport: captureViewportMock,
        uploadCapturedScreenshot: uploadCapturedScreenshotMock,
        isCapturing: ref(false),
      }),
    }));
    vi.doMock('@/composables/annotationCameraTrigger', () => ({
      requestActiveAnnotationCamera: requestActiveAnnotationCameraMock,
    }));
    vi.doMock('@/ribbon/toastBus', () => ({
      emitToast: emitToastMock,
    }));
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));
    vi.doMock('@/composables/useReviewStore', () => ({
      useReviewStore: () => ({
        currentTask: ref({ id: 'task-1', formId: 'form-1' }),
      }),
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
    // 关键：不选中任何批注，让 currentAnnotation === null

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true), statusText: ref('文字批注'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const cameraBtn = host.querySelector('[data-testid="annotation-overlay-camera"]') as HTMLButtonElement | null;
    expect(cameraBtn).toBeTruthy();
    expect(host.querySelector('[data-testid="annotation-overlay-camera-pending-dot"]')).toBeNull();
    cameraBtn?.click();
    await nextTick();

    await vi.waitFor(() => {
      expect(uploadCapturedScreenshotMock).toHaveBeenCalled();
    });
    expect(captureViewportMock).toHaveBeenCalledWith(expect.objectContaining({
      format: 'image/png',
      includeOverlays: true,
    }));
    expect(uploadCapturedScreenshotMock).toHaveBeenCalledWith('task-1', fakeCapture, expect.objectContaining({
      kind: 'annotation_shot_pending',
      formId: 'form-1',
    }));
    expect(requestActiveAnnotationCameraMock).not.toHaveBeenCalled();

    expect(store.pendingDraftAnnotationShot.value).toEqual(expect.objectContaining({
      attachmentId: 'att-pending-1',
      url: '/files/att-pending-1.png',
      taskId: 'task-1',
      formId: 'form-1',
    }));

    // pending 角标应该出现
    await nextTick();
    expect(host.querySelector('[data-testid="annotation-overlay-camera-pending-dot"]')).toBeTruthy();

    app.unmount();
    host.remove();
    host = null;
  });

  it('已选中批注时点击 Camera 按钮 → 通过 bus 唤起 AnnotationPanel active 弹窗，不动 pending', async () => {
    captureViewportMock.mockReset();
    uploadCapturedScreenshotMock.mockReset();
    requestActiveAnnotationCameraMock.mockReset();

    vi.doMock('@/composables/useScreenshot', () => ({
      useScreenshot: () => ({
        captureViewport: captureViewportMock,
        uploadCapturedScreenshot: uploadCapturedScreenshotMock,
        isCapturing: ref(false),
      }),
    }));
    vi.doMock('@/composables/annotationCameraTrigger', () => ({
      requestActiveAnnotationCamera: requestActiveAnnotationCameraMock,
    }));
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));
    vi.doMock('@/composables/useReviewStore', () => ({
      useReviewStore: () => ({
        currentTask: ref({ id: 'task-2', formId: 'form-2' }),
      }),
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
      id: 'text-active', entityId: 'e', worldPos: [0, 0, 0],
      visible: true, glyph: 'A', title: 'A', description: '', createdAt: 1,
    });
    store.activeAnnotationId.value = 'text-active';

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true), statusText: ref('文字批注'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const cameraBtn = host.querySelector('[data-testid="annotation-overlay-camera"]') as HTMLButtonElement | null;
    expect(cameraBtn).toBeTruthy();
    cameraBtn?.click();
    await nextTick();

    expect(requestActiveAnnotationCameraMock).toHaveBeenCalledTimes(1);
    expect(captureViewportMock).not.toHaveBeenCalled();
    expect(uploadCapturedScreenshotMock).not.toHaveBeenCalled();
    expect(store.pendingDraftAnnotationShot.value).toBeNull();

    app.unmount();
    host.remove();
    host = null;
  });
});
