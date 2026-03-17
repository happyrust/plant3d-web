import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, shallowRef } from 'vue';

describe('MeasurementPanel', () => {
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

  it('应支持列表选中、外部选中回写和清空测量', async () => {
    const selectedId = ref<string | null>(null);
    const selectAnnotation = vi.fn((id: string | null) => {
      selectedId.value = id;
    });
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        mbdPipeVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation,
          selectedId,
        }),
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearMeasurements();
    store.addMeasurement({
      id: 'm1',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
    });
    store.addMeasurement({
      id: 'm2',
      kind: 'angle',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      corner: { entityId: 'e2', worldPos: [1, 0, 0] },
      target: { entityId: 'e3', worldPos: [1, 1, 0] },
      visible: true,
      createdAt: 2,
    });
    store.activeMeasurementId.value = null;
    await nextTick();

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn((id: string) => {
          store.removeMeasurement(id);
        }),
      },
    });
    app.mount(host);
    await nextTick();

    const row1 = host.querySelector('[data-testid="measurement-row-m1"]') as HTMLElement | null;
    expect(row1).toBeTruthy();
    row1?.click();
    await nextTick();

    expect(store.activeMeasurementId.value).toBe('m1');
    expect(selectAnnotation).toHaveBeenLastCalledWith('meas_m1');
    expect(row1?.getAttribute('data-selected')).toBe('true');

    store.activeMeasurementId.value = 'm2';
    await nextTick();

    expect(selectAnnotation).toHaveBeenLastCalledWith('meas_m2');
    const row2 = host.querySelector('[data-testid="measurement-row-m2"]') as HTMLElement | null;
    expect(row2?.getAttribute('data-selected')).toBe('true');

    const clearButton = host.querySelector('[data-testid="measurement-clear-all"]') as HTMLButtonElement | null;
    expect(clearButton).toBeTruthy();
    clearButton?.click();
    await nextTick();

    expect(store.measurements.value).toEqual([]);
    expect(store.activeMeasurementId.value).toBeNull();
    expect(selectAnnotation).toHaveBeenLastCalledWith(null);

    app.unmount();
    host.remove();
    host = null;
  });

  it('在 xeokit 测量模式下应通过 dock 测量面板展示 xeokit 记录并同步 xmeas 选中', async () => {
    const selectedId = ref<string | null>(null);
    const selectAnnotation = vi.fn((id: string | null) => {
      selectedId.value = id;
    });
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef({
          ready: ref(true),
          statusText: ref('xeokit ready'),
          activate: vi.fn(),
          deactivate: vi.fn(),
          flyToMeasurement: vi.fn(),
          removeMeasurement: vi.fn(),
          clearMeasurements: vi.fn(),
        }),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        mbdPipeVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation,
          selectedId,
        }),
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearMeasurements();
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    store.addXeokitDistanceMeasurement({
      id: 'x1',
      kind: 'distance',
      origin: { entityId: 'o1', worldPos: [0, 0, 0] },
      target: { entityId: 'o2', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 10,
    });
    store.activeXeokitMeasurementId.value = null;
    await nextTick();

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(false),
        statusText: ref('classic ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const row = host.querySelector('[data-testid="measurement-row-x1"]') as HTMLElement | null;
    expect(row).toBeTruthy();
    row?.click();
    await nextTick();

    expect(store.activeXeokitMeasurementId.value).toBe('x1');
    expect(selectAnnotation).toHaveBeenLastCalledWith('xmeas_x1');

    const styleAxis = host.querySelector('[data-testid="measurement-style-distance-axis"]') as HTMLInputElement | null;
    expect(styleAxis).toBeTruthy();
    expect(styleAxis?.checked).toBe(false);
    if (styleAxis) {
      styleAxis.checked = true;
      styleAxis.dispatchEvent(new Event('change'));
    }
    await nextTick();

    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    expect(useXeokitMeasurementStyleStore().state.distanceShowAxisBreakdown).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });

  it('测量列表应直接展示当前选中和显示状态标签', async () => {
    const selectedId = ref<string | null>(null);
    const selectAnnotation = vi.fn((id: string | null) => {
      selectedId.value = id;
    });
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef({
          ready: ref(true),
          statusText: ref('xeokit ready'),
          activate: vi.fn(),
          deactivate: vi.fn(),
          flyToMeasurement: vi.fn(),
          removeMeasurement: vi.fn(),
          clearMeasurements: vi.fn(),
        }),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        mbdPipeVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation,
          selectedId,
        }),
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    store.addXeokitDistanceMeasurement({
      id: 'x-visible',
      kind: 'distance',
      origin: { entityId: 'o1', worldPos: [0, 0, 0] },
      target: { entityId: 'o2', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 11,
    });
    store.addXeokitDistanceMeasurement({
      id: 'x-hidden',
      kind: 'distance',
      origin: { entityId: 'o3', worldPos: [0, 0, 0] },
      target: { entityId: 'o4', worldPos: [1, 1, 0] },
      visible: false,
      approximate: false,
      createdAt: 12,
    });
    store.activeXeokitMeasurementId.value = 'x-visible';
    await nextTick();

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(false),
        statusText: ref('classic ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const selectedBadge = host.querySelector(
      '[data-testid="measurement-selected-badge-x-visible"]',
    ) as HTMLElement | null;
    const visibleBadge = host.querySelector(
      '[data-testid="measurement-visibility-badge-x-visible"]',
    ) as HTMLElement | null;
    const hiddenBadge = host.querySelector(
      '[data-testid="measurement-visibility-badge-x-hidden"]',
    ) as HTMLElement | null;

    expect(selectedBadge?.textContent).toContain('当前选中');
    expect(visibleBadge?.textContent).toContain('显示中');
    expect(hiddenBadge?.textContent).toContain('已隐藏');

    app.unmount();
    host.remove();
    host = null;
  });

  it('测量列表应展示对象摘要，并标识近似测量记录', async () => {
    const selectedId = ref<string | null>(null);
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef({
          ready: ref(true),
          statusText: ref('xeokit ready'),
          activate: vi.fn(),
          deactivate: vi.fn(),
          flyToMeasurement: vi.fn(),
          removeMeasurement: vi.fn(),
          clearMeasurements: vi.fn(),
        }),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        mbdPipeVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId,
        }),
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_angle');
    store.addXeokitAngleMeasurement({
      id: 'x-approx',
      kind: 'angle',
      origin: { entityId: 'origin-node', worldPos: [0, 0, 0] },
      corner: { entityId: 'corner-node', worldPos: [1, 0, 0] },
      target: { entityId: 'target-node', worldPos: [1, 1, 0] },
      visible: true,
      approximate: true,
      createdAt: 13,
    });
    await nextTick();

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(false),
        statusText: ref('classic ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const approxBadge = host.querySelector(
      '[data-testid="measurement-approximate-badge-x-approx"]',
    ) as HTMLElement | null;
    const summary = host.querySelector(
      '[data-testid="measurement-summary-x-approx"]',
    ) as HTMLElement | null;

    expect(approxBadge?.textContent).toContain('近似');
    expect(summary?.textContent).toContain('起点 origin-node');
    expect(summary?.textContent).toContain('拐点 corner-node');
    expect(summary?.textContent).toContain('终点 target-node');

    app.unmount();
    host.remove();
    host = null;
  });

  it('当前测量切换时应将对应记录滚动到可见区域', async () => {
    const selectedId = ref<string | null>(null);
    const selectAnnotation = vi.fn((id: string | null) => {
      selectedId.value = id;
    });
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef({
          ready: ref(true),
          statusText: ref('xeokit ready'),
          activate: vi.fn(),
          deactivate: vi.fn(),
          flyToMeasurement: vi.fn(),
          removeMeasurement: vi.fn(),
          clearMeasurements: vi.fn(),
        }),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        mbdPipeVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation,
          selectedId,
        }),
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    store.addXeokitDistanceMeasurement({
      id: 'x1',
      kind: 'distance',
      origin: { entityId: 'o1', worldPos: [0, 0, 0] },
      target: { entityId: 'o2', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });
    store.addXeokitDistanceMeasurement({
      id: 'x2',
      kind: 'distance',
      origin: { entityId: 'o3', worldPos: [0, 0, 0] },
      target: { entityId: 'o4', worldPos: [2, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 2,
    });
    store.activeXeokitMeasurementId.value = null;
    await nextTick();

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(false),
        statusText: ref('classic ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const row = host.querySelector('[data-testid="measurement-row-x1"]') as HTMLElement | null;
    const scrollIntoView = vi.fn();
    if (row) {
      (row as any).scrollIntoView = scrollIntoView;
    }

    store.activeXeokitMeasurementId.value = 'x1';
    await nextTick();
    await nextTick();

    expect(scrollIntoView).toHaveBeenCalled();

    app.unmount();
    host.remove();
    host = null;
  });

  it('当前选中项应突出主动作，隐藏记录应直接提供恢复显示入口', async () => {
    const selectedId = ref<string | null>(null);
    const selectAnnotation = vi.fn((id: string | null) => {
      selectedId.value = id;
    });
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef({
          ready: ref(true),
          statusText: ref('xeokit ready'),
          activate: vi.fn(),
          deactivate: vi.fn(),
          flyToMeasurement: vi.fn(),
          removeMeasurement: vi.fn(),
          clearMeasurements: vi.fn(),
        }),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        mbdPipeVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation,
          selectedId,
        }),
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    store.addXeokitDistanceMeasurement({
      id: 'x-selected',
      kind: 'distance',
      origin: { entityId: 'o1', worldPos: [0, 0, 0] },
      target: { entityId: 'o2', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 21,
    });
    store.addXeokitDistanceMeasurement({
      id: 'x-hidden-action',
      kind: 'distance',
      origin: { entityId: 'o3', worldPos: [0, 0, 0] },
      target: { entityId: 'o4', worldPos: [1, 1, 0] },
      visible: false,
      approximate: false,
      createdAt: 22,
    });
    store.activeXeokitMeasurementId.value = 'x-selected';
    await nextTick();

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(false),
        statusText: ref('classic ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const flyButton = host.querySelector(
      '[data-testid="measurement-fly-button-x-selected"]',
    ) as HTMLButtonElement | null;
    const visibilityButton = host.querySelector(
      '[data-testid="measurement-visibility-button-x-hidden-action"]',
    ) as HTMLButtonElement | null;

    expect(flyButton?.className).toContain('bg-primary');
    expect(visibilityButton?.textContent).toContain('恢复显示');

    app.unmount();
    host.remove();
    host = null;
  });

  it('样式设置应提供默认说明，并支持一键恢复默认样式', async () => {
    const selectedId = ref<string | null>(null);
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef({
          ready: ref(true),
          statusText: ref('xeokit ready'),
          activate: vi.fn(),
          deactivate: vi.fn(),
          flyToMeasurement: vi.fn(),
          removeMeasurement: vi.fn(),
          clearMeasurements: vi.fn(),
        }),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        mbdPipeVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId,
        }),
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }, { useXeokitMeasurementStyleStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    useXeokitMeasurementStyleStore().updateStyle({
      distanceShowAxisBreakdown: true,
      distanceShowMarkers: false,
    });

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(false),
        statusText: ref('classic ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect(host.textContent).toContain('默认仅显示总长');

    const resetButton = host.querySelector('[data-testid="measurement-style-reset"]') as HTMLButtonElement | null;
    expect(resetButton).toBeTruthy();
    resetButton?.click();
    await nextTick();

    expect(useXeokitMeasurementStyleStore().state.distanceShowAxisBreakdown).toBe(false);
    expect(useXeokitMeasurementStyleStore().state.distanceShowMarkers).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });

  it('样式设置应显示当前效果预览，并在切换开关后实时更新', async () => {
    const selectedId = ref<string | null>(null);
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef({
          ready: ref(true),
          statusText: ref('xeokit ready'),
          activate: vi.fn(),
          deactivate: vi.fn(),
          flyToMeasurement: vi.fn(),
          removeMeasurement: vi.fn(),
          clearMeasurements: vi.fn(),
        }),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        mbdPipeVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId,
        }),
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }, { useXeokitMeasurementStyleStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    useXeokitMeasurementStyleStore().resetStyle();

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(false),
        statusText: ref('classic ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const preview = host.querySelector('[data-testid="measurement-style-distance-preview"]') as HTMLElement | null;
    expect(preview?.textContent).toContain('总长标签');
    expect(preview?.textContent).toContain('端点');
    expect(preview?.textContent).not.toContain('XYZ 分解');

    const styleAxis = host.querySelector('[data-testid="measurement-style-distance-axis"]') as HTMLInputElement | null;
    if (styleAxis) {
      styleAxis.checked = true;
      styleAxis.dispatchEvent(new Event('change'));
    }
    await nextTick();

    expect(preview?.textContent).toContain('XYZ 分解');

    app.unmount();
    host.remove();
    host = null;
  });

  it('样式设置应按长度和角度分组展示，并提供可随开关更新的 XYZ 分解说明', async () => {
    const selectedId = ref<string | null>(null);
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef({
          ready: ref(true),
          statusText: ref('xeokit ready'),
          activate: vi.fn(),
          deactivate: vi.fn(),
          flyToMeasurement: vi.fn(),
          removeMeasurement: vi.fn(),
          clearMeasurements: vi.fn(),
        }),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        mbdPipeVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId,
        }),
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }, { useXeokitMeasurementStyleStore }] =
      await Promise.all([
        import('./MeasurementPanel.vue'),
        import('@/composables/useToolStore'),
        import('@/composables/useXeokitMeasurementStyleStore'),
      ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    useXeokitMeasurementStyleStore().resetStyle();

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(false),
        statusText: ref('classic ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const distanceSection = host.querySelector(
      '[data-testid="measurement-style-distance-section"]',
    ) as HTMLElement | null;
    const angleSection = host.querySelector(
      '[data-testid="measurement-style-angle-section"]',
    ) as HTMLElement | null;
    const distanceNote = host.querySelector(
      '[data-testid="measurement-style-distance-note"]',
    ) as HTMLElement | null;

    expect(distanceSection).toBeTruthy();
    expect(angleSection).toBeTruthy();
    expect(distanceNote?.textContent).toContain('开启后会额外显示 X / Y / Z 三段分量线和标签');

    const styleAxis = host.querySelector(
      '[data-testid="measurement-style-distance-axis"]',
    ) as HTMLInputElement | null;
    if (styleAxis) {
      styleAxis.checked = true;
      styleAxis.dispatchEvent(new Event('change'));
    }
    await nextTick();

    expect(distanceNote?.textContent).toContain('当前会同时显示总长和 X / Y / Z 分量标签');

    app.unmount();
    host.remove();
    host = null;
  });
});
