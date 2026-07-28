import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, shallowRef } from 'vue';

describe('MeasurementOverlayBar', () => {
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

  it('应在测量模式下显示底部操作条，并支持打开 dock 测量面板与删除当前测量', async () => {
    const selectAnnotation = vi.fn();
    const ensurePanelAndActivate = vi.fn();
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate,
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation,
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [
      { default: MeasurementOverlayBar },
      { useToolStore },
      { useXeokitMeasurementStyleStore },
    ] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore() as any;
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    measurementStyle.updateMeasurementPickSource('ptset', { show: true, snap: true });
    measurementStyle.updateMeasurementPickSource('position', { show: true, snap: true });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: false, snap: false });
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    store.addXeokitDistanceMeasurement({
      id: 'x1',
      kind: 'distance',
      origin: { entityId: 'o:1', worldPos: [0, 0, 0] },
      target: { entityId: 'o:2', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });
    store.addXeokitAngleMeasurement({
      id: 'x2',
      kind: 'angle',
      origin: { entityId: 'o:1', worldPos: [0, 0, 0] },
      corner: { entityId: 'o:2', worldPos: [1, 0, 0] },
      target: { entityId: 'o:3', worldPos: [1, 1, 0] },
      visible: false,
      approximate: false,
      createdAt: 2,
    });
    store.activeXeokitMeasurementId.value = 'x1';

    const tools = {
      ready: ref(true),
      statusText: ref('距离测量：第一击创建测量，随后 hover 预览'),
      currentMeasurement: ref(null),
      hasVisibleMeasurements: ref(true),
      hasHiddenMeasurements: ref(true),
      flyToMeasurement: vi.fn(),
      setMeasurementVisible: vi.fn((id: string, visible: boolean) => {
        store.updateXeokitMeasurementVisible(id, visible);
      }),
      setAllMeasurementsVisible: vi.fn((visible: boolean) => {
        store.allXeokitMeasurements.value.forEach((item: any) => {
          store.updateXeokitMeasurementVisible(item.id, visible);
        });
      }),
      removeMeasurement: vi.fn((id: string) => {
        store.removeXeokitMeasurement(id);
      }),
      clearMeasurements: vi.fn(() => {
        store.clearXeokitMeasurements();
      }),
      deactivate: vi.fn(() => {
        store.setToolMode('none');
      }),
    };

    const app = createApp(MeasurementOverlayBar, { tools });
    app.mount(host);
    await nextTick();

    expect(host.querySelector('[data-testid="measurement-overlay-bar"]')).toBeTruthy();
    const currentVisibilityButton = host.querySelector('[data-testid="measurement-overlay-current-visibility"]') as HTMLButtonElement | null;
    const allVisibilityButton = host.querySelector('[data-testid="measurement-overlay-all-visibility"]') as HTMLButtonElement | null;
    const exitButton = host.querySelector('[data-testid="measurement-overlay-exit"]') as HTMLButtonElement | null;
    expect(currentVisibilityButton?.textContent?.trim()).toBe('');
    expect(currentVisibilityButton?.title).toBe('隐藏当前');
    expect(allVisibilityButton?.textContent?.trim()).toBe('');
    expect(allVisibilityButton?.title).toBe('全部显示');
    expect(exitButton?.textContent?.trim()).toBe('');
    expect(exitButton?.title).toBe('退出测量');
    expect(host.querySelector('[data-testid="measurement-overlay-source-picker"]')?.textContent).toContain('P-Point');
    expect(host.querySelector('[data-testid="measurement-overlay-source-picker"]')?.textContent).toContain('实例原点');
    expect(host.querySelector('[data-testid="measurement-overlay-source-picker"]')?.textContent).toContain('模型表面点');

    const pointSetInput = host.querySelector('[data-testid="measurement-overlay-source-ptset"]') as HTMLInputElement | null;
    const centerPointInput = host.querySelector('[data-testid="measurement-overlay-source-position"]') as HTMLInputElement | null;
    const meshInput = host.querySelector('[data-testid="measurement-overlay-source-mesh"]') as HTMLInputElement | null;
    expect(pointSetInput?.checked).toBe(true);
    expect(centerPointInput?.checked).toBe(true);
    expect(meshInput?.checked).toBe(false);

    if (meshInput) {
      meshInput.checked = true;
      meshInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.show).toBe(false);
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.snap).toBe(true);

    if (centerPointInput) {
      centerPointInput.checked = false;
      centerPointInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.position.show).toBe(true);
    expect(measurementStyle.state.measurementPickSources.position.snap).toBe(false);

    if (pointSetInput) {
      pointSetInput.checked = false;
      pointSetInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.ptset.show).toBe(true);
    expect(measurementStyle.state.measurementPickSources.ptset.snap).toBe(false);

    (host.querySelector('[data-testid="measurement-overlay-details-toggle"]') as HTMLButtonElement)?.click();
    await nextTick();
    expect(ensurePanelAndActivate).toHaveBeenCalledWith('measurement');

    (host.querySelector('[data-testid="measurement-overlay-delete-current"]') as HTMLButtonElement)?.click();
    await nextTick();
    expect(store.activeXeokitMeasurementId.value).toBeNull();
    expect(store.allXeokitMeasurements.value.map((item: any) => item.id)).toEqual(['x2']);

    app.unmount();
    host.remove();
    host = null;
  });

  it('点击退出按钮后，应退出测量模式并关闭详情抽屉', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [{ default: MeasurementOverlayBar }, { useToolStore }] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');

    const deactivate = vi.fn(() => {
      store.setToolMode('none');
    });

    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        currentMeasurement: ref(null),
        hasVisibleMeasurements: ref(false),
        hasHiddenMeasurements: ref(false),
        flyToMeasurement: vi.fn(),
        setMeasurementVisible: vi.fn(),
        setAllMeasurementsVisible: vi.fn(),
        removeMeasurement: vi.fn(),
        clearMeasurements: vi.fn(),
        deactivate,
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="measurement-overlay-exit"]') as HTMLButtonElement | null)?.click();
    await nextTick();

    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(store.toolMode.value).toBe('none');

    app.unmount();
    host.remove();
    host = null;
  });

  it('无当前选中测量时，应禁用当前项操作按钮', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [{ default: MeasurementOverlayBar }, { useToolStore }] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    store.activeXeokitMeasurementId.value = null;

    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        currentMeasurement: ref(null),
        hasVisibleMeasurements: ref(false),
        hasHiddenMeasurements: ref(false),
        flyToMeasurement: vi.fn(),
        setMeasurementVisible: vi.fn(),
        setAllMeasurementsVisible: vi.fn(),
        removeMeasurement: vi.fn(),
        clearMeasurements: vi.fn(),
        deactivate: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect((host.querySelector('[data-testid="measurement-overlay-fly-current"]') as HTMLButtonElement | null)?.disabled).toBe(true);
    expect((host.querySelector('[data-testid="measurement-overlay-current-visibility"]') as HTMLButtonElement | null)?.disabled).toBe(true);
    expect((host.querySelector('[data-testid="measurement-overlay-delete-current"]') as HTMLButtonElement | null)?.disabled).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });

  it('取点模式切换应写入样式 store 并联动表面点捕捉', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [
      { default: MeasurementOverlayBar },
      { useToolStore },
      { useXeokitMeasurementStyleStore },
    ] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore() as any;
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');

    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        currentMeasurement: ref(null),
        hasVisibleMeasurements: ref(false),
        hasHiddenMeasurements: ref(false),
        flyToMeasurement: vi.fn(),
        setMeasurementVisible: vi.fn(),
        setAllMeasurementsVisible: vi.fn(),
        removeMeasurement: vi.fn(),
        clearMeasurements: vi.fn(),
        deactivate: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect(host.querySelector('[data-testid="measurement-overlay-pick-mode"]')).toBeTruthy();

    (host.querySelector('[data-testid="measurement-overlay-mode-free"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(measurementStyle.state.measurementPickMode).toBe('free_surface');
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.snap).toBe(true);
    expect((host.querySelector('[data-testid="measurement-overlay-source-mesh"]') as HTMLInputElement | null)?.checked).toBe(true);

    (host.querySelector('[data-testid="measurement-overlay-mode-e3d"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(measurementStyle.state.measurementPickMode).toBe('e3d');
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.snap).toBe(false);
    expect(measurementStyle.state.measurementPickSources.ptset.snap).toBe(true);
    expect(measurementStyle.state.measurementPickSources.position.snap).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });

  it('连续测量开关仅在距离模式显示，切换后写入 store 状态', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [{ default: MeasurementOverlayBar }, { useToolStore }] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.continuousDistanceMeasureEnabled.value = false;
    store.setToolMode('xeokit_measure_distance');

    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        currentMeasurement: ref(null),
        hasVisibleMeasurements: ref(false),
        hasHiddenMeasurements: ref(false),
        flyToMeasurement: vi.fn(),
        setMeasurementVisible: vi.fn(),
        setAllMeasurementsVisible: vi.fn(),
        removeMeasurement: vi.fn(),
        clearMeasurements: vi.fn(),
        deactivate: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const checkbox = host.querySelector('[data-testid="measurement-overlay-continuous"]') as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    expect(checkbox?.checked).toBe(false);

    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(store.continuousDistanceMeasureEnabled.value).toBe(true);

    store.setToolMode('xeokit_measure_angle');
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-continuous"]')).toBeNull();

    app.unmount();
    host.remove();
    host = null;
  });
});
