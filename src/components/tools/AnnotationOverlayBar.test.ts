import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, shallowRef } from 'vue';

const saveAnnotationSeverityMock = vi.hoisted(() => vi.fn());
const saveAnnotationBasicFieldsMock = vi.hoisted(() => vi.fn());

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

  it('云线模式支持使用当前选择、点选/框选追加、移除和取消返回', async () => {
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

    const [
      { default: AnnotationOverlayBar },
      { useToolStore },
    ] = await Promise.all([
      import('./AnnotationOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    const selectedRefnos = ref(['REF/A', 'REF/B']);
    store.setToolMode('annotation_cloud');

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true), statusText: ref('云线批注'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
        selectionStore: { selectedRefnos },
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="annotation-cloud-target-current"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.cloudTargetRefnos.value).toEqual(['REF/A', 'REF/B']);

    (host.querySelector('[data-testid="annotation-cloud-target-remove-REF/A"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.cloudTargetRefnos.value).toEqual(['REF/B']);

    (host.querySelector('[data-testid="annotation-cloud-target-pick"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.toolMode.value).toBe('pick_refno');
    expect(host.querySelector('[data-testid="annotation-cloud-targets"]')).toBeTruthy();
    store.addPickedRefno('REF/C');
    store.confirmPickRefno();
    await nextTick();
    expect(store.toolMode.value).toBe('annotation_cloud');
    expect(store.cloudTargetRefnos.value).toEqual(['REF/B', 'REF/C']);

    (host.querySelector('[data-testid="annotation-cloud-target-box"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.toolMode.value).toBe('pick_refno_box');
    store.confirmPickRefno();
    await nextTick();
    expect(store.toolMode.value).toBe('annotation_cloud');
    expect(store.cloudTargetRefnos.value).toEqual(['REF/B', 'REF/C']);

    (host.querySelector('[data-testid="annotation-cloud-target-box"]') as HTMLButtonElement).click();
    await nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(store.toolMode.value).toBe('annotation_cloud');
    expect(store.cloudTargetRefnos.value).toEqual(['REF/B', 'REF/C']);

    (host.querySelector('[data-testid="annotation-cloud-target-clear"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.cloudTargetRefnos.value).toEqual([]);

    app.unmount();
    host.remove();
    host = null;
  });

  it('选择层级切换会改变点选/框选的 noun 过滤（元件=[] / 分支=[BRAN]）', async () => {
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));
    vi.doMock('@/composables/useReviewStore', () => ({
      useReviewStore: () => ({ currentTask: ref(null) }),
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref({ id: 'reviewer-1', role: 'reviewer', name: 'R' }),
      }),
    }));

    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    const [
      { default: AnnotationOverlayBar },
      { useToolStore },
    ] = await Promise.all([
      import('./AnnotationOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('annotation_cloud');

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true), statusText: ref('云线批注'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
        selectionStore: { selectedRefnos: ref([]) },
      },
    });
    app.mount(host);
    await nextTick();

    expect(store.cloudTargetLevel.value).toBe('element');
    (host.querySelector('[data-testid="annotation-cloud-target-pick"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.toolMode.value).toBe('pick_refno');
    expect(store.pickRefnoFilter.value).toEqual([]);
    store.confirmPickRefno();
    await nextTick();

    (host.querySelector('[data-testid="annotation-cloud-level-branch"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.cloudTargetLevel.value).toBe('branch');
    (host.querySelector('[data-testid="annotation-cloud-target-pick"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.pickRefnoFilter.value).toEqual(['BRAN']);
    store.confirmPickRefno();
    await nextTick();

    (host.querySelector('[data-testid="annotation-cloud-target-box"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.toolMode.value).toBe('pick_refno_box');
    expect(store.pickRefnoFilter.value).toEqual(['BRAN']);
    store.confirmPickRefno();
    await nextTick();

    (host.querySelector('[data-testid="annotation-cloud-level-element"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.cloudTargetLevel.value).toBe('element');

    app.unmount();
    host.remove();
    host = null;
  });

  it('云线三步向导随目标/锚点推进，并在闸门拦截时闪红对应步骤', async () => {
    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));
    vi.doMock('@/composables/useReviewStore', () => ({
      useReviewStore: () => ({ currentTask: ref(null) }),
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

    const pendingCloudAnchor = ref<{ refno: string } | null>(null);
    const cloudGateBlock = ref<{ step: 'target' | 'anchor'; at: number } | null>(null);
    const clearPendingCloudAnchor = vi.fn(() => {
      pendingCloudAnchor.value = null;
    });

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('云线批注：请先选择目标元素'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
        pendingCloudAnchor,
        clearPendingCloudAnchor,
        cloudGateBlock,
        selectionStore: { selectedRefnos: ref([]) },
      },
    });
    app.mount(host);
    await nextTick();

    const stepState = (key: string) => host!
      .querySelector(`[data-testid="annotation-cloud-step-${key}"]`)
      ?.getAttribute('data-state');

    // 初始：停在第 1 步
    expect(stepState('target')).toBe('active');
    expect(stepState('anchor')).toBe('todo');
    expect(host.querySelector('[data-testid="annotation-cloud-hint"]')?.textContent)
      .toContain('请先选择目标元素');

    // 关联元素后推进到第 2 步
    store.addCloudTargetRefnos(['REF/A']);
    await nextTick();
    expect(stepState('target')).toBe('done');
    expect(stepState('anchor')).toBe('active');
    expect(host.querySelector('[data-testid="annotation-cloud-step-back"]')).toBeFalsy();

    // 锚点就绪后推进到第 3 步，并出现「重选锚点」
    pendingCloudAnchor.value = { refno: 'REF/A' };
    await nextTick();
    expect(stepState('anchor')).toBe('done');
    expect(stepState('outline')).toBe('active');

    (host.querySelector('[data-testid="annotation-cloud-step-back"]') as HTMLButtonElement).click();
    await nextTick();
    expect(clearPendingCloudAnchor).toHaveBeenCalled();
    expect(stepState('anchor')).toBe('active');

    // 闸门拦截时对应步骤闪红
    cloudGateBlock.value = { step: 'anchor', at: Date.now() };
    await nextTick();
    expect(host.querySelector('[data-testid="annotation-cloud-step-anchor"]')?.className)
      .toContain('border-destructive');

    app.unmount();
    host.remove();
    host = null;
  });

  it('选择模型元素后反向显示关联云线，并支持激活定位', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    const [{ default: AnnotationOverlayBar }, { useToolStore }] = await Promise.all([
      import('./AnnotationOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('none');
    store.addCloudAnnotation({
      id: 'cloud-related',
      objectIds: ['REF/A'],
      anchorWorldPos: [0, 0, 0],
      visible: true,
      title: '阀门问题',
      description: '',
      createdAt: 1,
      bindings: [
        { refno: 'REF/ANCHOR', role: 'anchor', createdAt: 1 },
        { refno: 'REF/A', role: 'member', noun: 'VALV', createdAt: 1 },
      ],
    });
    const selectedRefnos = ref(['REF/ANCHOR']);
    const flyToCloudAnnotation = vi.fn();
    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true), statusText: ref(''),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation, flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
        selectionStore: { selectedRefnos },
      },
    });
    app.mount(host);
    await nextTick();

    expect(host.querySelector('[data-testid="annotation-related-clouds"]')).toBeFalsy();

    selectedRefnos.value = ['REF/A'];
    await nextTick();
    expect(host.querySelector('[data-testid="annotation-related-clouds"]')?.textContent).toContain('阀门问题');

    (host.querySelector('[data-testid="annotation-related-cloud-cloud-related"]') as HTMLButtonElement).click();
    await nextTick();
    expect(store.activeCloudAnnotationId.value).toBe('cloud-related');
    expect(flyToCloudAnnotation).toHaveBeenCalledWith('cloud-related');

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

  it('云线创建还有步骤可回退时，Escape 只退这一步、不退出云线工具', async () => {
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
    store.setCloudTargetRefnos(['=24381/145019']);
    store.setToolMode('annotation_cloud');

    // 先报「已消费一步」，再报「退无可退」，模拟锚点 → 退出工具两次按键
    const rollbackCloudCreationStep = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('云线批注'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        rollbackCloudCreationStep,
      },
    });
    app.mount(host);
    await nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(rollbackCloudCreationStep).toHaveBeenCalledTimes(1);
    expect(store.toolMode.value).toBe('annotation_cloud');
    expect(store.cloudTargetRefnos.value).toEqual(['=24381/145019']);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(store.toolMode.value).toBe('none');

    app.unmount();
    host.remove();
    host = null;
  });

  it('主工具栏与更多抽屉均提供错误类型快捷，具备权限时能保存严重度', async () => {
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
    (host.querySelector('[data-testid="annotation-overlay-toolbar-severity-trigger"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    const toolbarPrinciple = host.querySelector('[data-testid="annotation-overlay-toolbar-severity-principle"]') as HTMLButtonElement | null;
    expect(toolbarPrinciple).toBeTruthy();
    toolbarPrinciple?.click();
    await nextTick();
    await vi.waitFor(() => {
      expect(saveAnnotationSeverityMock).toHaveBeenCalled();
    });
    expect(saveAnnotationSeverityMock).toHaveBeenCalledWith('text', 'text-sev-1', 'principle', expect.any(Object));
    expect(store.annotations.value.find((a: any) => a.id === 'text-sev-1').severity).toBe('principle');

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

    const trigger = host.querySelector('[data-testid="annotation-overlay-toolbar-severity-trigger"]') as HTMLButtonElement | null;
    expect(trigger?.hasAttribute('disabled')).toBe(true);

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

  it('浮层可见性同步到 store.annotationOverlayVisible，footer slot 停靠在栈底（问题7）', async () => {
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

    const [{ default: AnnotationOverlayBar }, { useToolStore }, { h }] = await Promise.all([
      import('./AnnotationOverlayBar.vue'),
      import('@/composables/useToolStore'),
      import('vue'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('annotation_cloud');

    const tools = {
      ready: ref(true), statusText: ref('云线批注'),
      flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
      flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
      removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
    };
    const app = createApp({
      render: () => h(AnnotationOverlayBar, { tools }, {
        footer: () => h('div', { 'data-testid': 'docked-footer-probe' }, '待保存证据'),
      }),
    });
    app.mount(host);
    await nextTick();

    // 批注上下文中：浮层可见，footer slot 渲染在栈底，store 标志为 true
    expect(store.annotationOverlayVisible.value).toBe(true);
    expect(host.querySelector('[data-testid="docked-footer-probe"]')).toBeTruthy();

    // 退出批注上下文：浮层隐藏，标志复位，footer 随之消失（右下角浮动版将接管）
    store.setToolMode('none');
    await nextTick();
    expect(store.annotationOverlayVisible.value).toBe(false);
    expect(host.querySelector('[data-testid="docked-footer-probe"]')).toBeNull();

    // 重新进入后卸载组件也要复位标志
    store.setToolMode('annotation_cloud');
    await nextTick();
    expect(store.annotationOverlayVisible.value).toBe(true);
    app.unmount();
    expect(store.annotationOverlayVisible.value).toBe(false);

    host.remove();
    host = null;
  });

  it('云线创建上下文里新增一条云线时显示“已创建”成功反馈（问题：画完零反馈）', async () => {
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

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true), statusText: ref('云线批注：请先选择目标元素'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    // 初始：无“已创建”横幅
    expect(host.querySelector('[data-testid="annotation-cloud-created"]')).toBeNull();

    // 模拟 useDtxTools 画完云线：cloudAnnotations 数量 +1
    store.addCloudAnnotation({
      id: 'cloud-new', objectIds: ['x'], anchorWorldPos: [0, 0, 0],
      visible: true, title: '云线批注 1', description: '', createdAt: 1, refnos: ['x'],
    });
    await nextTick();

    // 出现成功横幅，且三步向导全部标记完成
    expect(host.querySelector('[data-testid="annotation-cloud-created"]')).toBeTruthy();
    const outlineStep = host.querySelector('[data-testid="annotation-cloud-step-outline"]') as HTMLElement | null;
    expect(outlineStep?.getAttribute('data-state')).toBe('done');
    // 成功态下不再同时显示“请先选择目标元素”提示，避免文案自相矛盾
    expect(host.querySelector('[data-testid="annotation-cloud-hint"]')).toBeNull();

    app.unmount();
    host.remove();
    host = null;
  });

  it('刚创建云线后向导卡内联“错误类型 + 描述”表单，开始选下一条目标时收起（审查项6）', async () => {
    saveAnnotationSeverityMock.mockReset();
    saveAnnotationBasicFieldsMock.mockReset();
    vi.doMock('@/composables/useAnnotationSeveritySync', () => ({
      saveAnnotationSeverity: saveAnnotationSeverityMock,
      saveAnnotationBasicFields: saveAnnotationBasicFieldsMock,
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
    saveAnnotationBasicFieldsMock.mockResolvedValue(true);
    store.clearAll();
    store.setToolMode('annotation_cloud');

    const app = createApp(AnnotationOverlayBar, {
      tools: {
        ready: ref(true), statusText: ref('云线批注：请先选择目标元素'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    // 初始：没有详情表单
    expect(host.querySelector('[data-testid="annotation-cloud-detail-form"]')).toBeNull();

    // 模拟画完一条云线
    store.addCloudAnnotation({
      id: 'cloud-detail-1', objectIds: ['x'], anchorWorldPos: [0, 0, 0],
      visible: true, title: '云线批注 1', description: '', createdAt: 1, refnos: ['x'],
    });
    await nextTick();

    // 详情表单出现，可直接设错误类型
    expect(host.querySelector('[data-testid="annotation-cloud-detail-form"]')).toBeTruthy();
    const principleBtn = host.querySelector('[data-testid="annotation-cloud-detail-severity-principle"]') as HTMLButtonElement | null;
    expect(principleBtn).toBeTruthy();
    expect(principleBtn?.hasAttribute('disabled')).toBe(false);
    principleBtn?.click();
    await vi.waitFor(() => {
      expect(saveAnnotationSeverityMock).toHaveBeenCalledWith('cloud', 'cloud-detail-1', 'principle', expect.any(Object));
    });
    await nextTick();
    expect(store.cloudAnnotations.value.find((a: any) => a.id === 'cloud-detail-1').severity).toBe('principle');

    // 描述失焦保存
    const textarea = host.querySelector('[data-testid="annotation-cloud-detail-description"]') as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    textarea!.value = '阀门方向画反了';
    textarea!.dispatchEvent(new Event('input'));
    await nextTick();
    textarea!.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => {
      expect(saveAnnotationBasicFieldsMock).toHaveBeenCalledWith(
        'cloud', 'cloud-detail-1', { description: '阀门方向画反了' }, expect.any(Object),
      );
    });

    // 开始为下一条云线选目标：详情表单让位
    store.addCloudTargetRefnos(['next-target-refno']);
    await nextTick();
    expect(host.querySelector('[data-testid="annotation-cloud-detail-form"]')).toBeNull();

    app.unmount();
    host.remove();
    host = null;
  });
});
