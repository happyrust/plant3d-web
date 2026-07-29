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
    vi.doUnmock('@/composables/usePipeDistanceStore');
    vi.doUnmock('@/composables/useConfirmDialogStore');
    vi.doUnmock('@/ribbon/commandBus');
    vi.doMock('@/components/review/measurementPathLookup', () => {
      const normalize = (raw: unknown) => {
        let value = String(raw ?? '').trim();
        const objectId = value.match(/^o:([^:]+):\d+$/i);
        if (objectId?.[1]) value = objectId[1].trim();
        return /^\d+[/,_]\d+$/.test(value) ? value.replace(/[/,]/g, '_') : value;
      };
      const format = (raw: unknown) => {
        const normalized = normalize(raw);
        const refno = normalized.match(/^(\d+)_(\d+)$/);
        return refno ? `${refno[1]}/${refno[2]}` : normalized || '-';
      };
      return {
        resolveMeasurementEntityPath: vi.fn(async (rawEntityId: unknown) => {
          const fallbackLabel = format(rawEntityId);
          return {
            rawEntityId: String(rawEntityId ?? ''),
            refno: normalize(rawEntityId),
            fallbackLabel,
            displayName: fallbackLabel,
            displayPath: fallbackLabel,
            nodes: [],
            status: 'fallback',
          };
        }),
      };
    });
  });

  it('应支持列表选中、外部选中回写和清空测量', async () => {
    const confirmOpen = vi.fn(async () => true);
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
        annotationSystem: shallowRef({
          selectAnnotation,
          selectedId,
        }),
      }),
    }));
    vi.doMock('@/composables/useConfirmDialogStore', () => ({
      useConfirmDialogStore: () => ({
        open: confirmOpen,
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
      origin: { entityId: 'o:24381_145018:0', worldPos: [0, 0, 0] },
      target: { entityId: '24381_145019', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
    });
    store.addMeasurement({
      id: 'm2',
      kind: 'angle',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      corner: { entityId: 'e2', worldPos: [1, 0, 0] },
      target: { entityId: 'e3', worldPos: [1, 1, 0] },
      visible: false,
      createdAt: 2,
    });
    store.activeMeasurementId.value = null;
    await nextTick();
    const flyToMeasurement = vi.fn();
    const removeMeasurement = vi.fn((id: string) => {
      store.removeMeasurement(id);
    });

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToMeasurement,
        removeMeasurement,
      },
    });
    app.mount(host);
    await nextTick();

    const row1 = host.querySelector('[data-testid="measurement-row-m1"]') as HTMLElement | null;
    expect(row1).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-summary-m1"]')?.textContent).toContain(
      '起点 24381/145018 -> 终点 24381/145019',
    );
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

    const visibilityButton = host.querySelector(
      '[data-testid="measurement-toggle-all-visible"]',
    ) as HTMLButtonElement | null;
    expect(visibilityButton?.textContent).toContain('全部显示');
    visibilityButton?.click();
    await nextTick();
    expect(store.measurements.value.every((item: any) => item.visible)).toBe(true);
    expect(visibilityButton?.textContent).toContain('全部隐藏');

    visibilityButton?.click();
    await nextTick();
    expect(store.measurements.value.every((item: any) => !item.visible)).toBe(true);

    (host.querySelector('[data-testid="measurement-fly-button-m1"]') as HTMLButtonElement | null)
      ?.click();
    expect(flyToMeasurement).toHaveBeenCalledWith('m1');

    (host.querySelector('[data-testid="measurement-visibility-button-m1"]') as HTMLButtonElement | null)
      ?.click();
    await nextTick();
    expect(store.measurements.value.find((item: any) => item.id === 'm1')?.visible).toBe(true);

    const deleteButton = Array.from(row2?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === '删除');
    deleteButton?.click();
    await nextTick();
    expect(removeMeasurement).toHaveBeenCalledWith('m2');
    expect(store.measurements.value.map((item: any) => item.id)).toEqual(['m1']);

    const clearButton = host.querySelector('[data-testid="measurement-clear-all"]') as HTMLButtonElement | null;
    expect(clearButton).toBeTruthy();
    clearButton?.click();
    await Promise.resolve();
    await nextTick();

    expect(confirmOpen).toHaveBeenCalledWith({
      title: '清空全部测量',
      message: '将删除全部 1 条测量，此操作不可撤销。',
      confirmText: '清空',
    });
    expect(store.measurements.value).toEqual([]);
    expect(store.activeMeasurementId.value).toBeNull();
    expect(selectAnnotation).toHaveBeenLastCalledWith(null);
    expect(clearButton?.disabled).toBe(true);
    clearButton?.click();
    await Promise.resolve();
    expect(confirmOpen).toHaveBeenCalledTimes(1);

    app.unmount();
    host.remove();
    host = null;
  });

  it('取消清空确认时应保留现有测量', async () => {
    const confirmOpen = vi.fn(async () => false);
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
        annotationSystem: shallowRef(null),
      }),
    }));
    vi.doMock('@/composables/useConfirmDialogStore', () => ({
      useConfirmDialogStore: () => ({
        open: confirmOpen,
      }),
    }));

    const [{ default: MeasurementPanel }, { useToolStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearMeasurements();
    store.addMeasurement({
      id: 'm-keep',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
    });

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="measurement-clear-all"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    await nextTick();

    expect(confirmOpen).toHaveBeenCalledTimes(1);
    expect(store.measurements.value.map((item: any) => item.id)).toEqual(['m-keep']);

    app.unmount();
    host.remove();
    host = null;
  });

  it('应展示管-管净距入口、同步状态并触发统一命令', async () => {
    const emitCommand = vi.fn();
    const selectedBranRefnos = ref(['BRAN-001', 'BRAN-002']);
    const results = ref([
      {
        id: 'clearance-1',
        distance: 120,
        pipeA: 'BRAN-001',
        pipeB: 'BRAN-002',
        start: [0, 0, 0],
        end: [120, 0, 0],
      },
    ]);
    const isDetecting = ref(false);
    const detectError = ref<string | null>(null);
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/ribbon/commandBus', () => ({
      emitCommand,
    }));
    vi.doMock('@/composables/usePipeDistanceStore', () => ({
      usePipeDistanceStore: () => ({
        showAnnotations: ref(true),
        maxDistance: ref(500),
        maxAngle: ref(5),
        selectedBranRefnos,
        results,
        activeResultIndex: ref(0),
        isDetecting,
        detectError,
        addBranRefno: vi.fn(),
        removeBranRefno: vi.fn(),
        clearBranRefnos: vi.fn(),
        setActiveResult: vi.fn(),
        runDetection: vi.fn(),
        clearResults: vi.fn(),
      }),
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
        annotationSystem: shallowRef(null),
      }),
    }));

    const { default: MeasurementPanel } = await import('./MeasurementPanel.vue');

    const app = createApp(MeasurementPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const card = host.querySelector('[data-testid="measurement-pipe-distance-card"]') as HTMLElement | null;
    const selectedCount = host.querySelector(
      '[data-testid="measurement-pipe-distance-selected-count"]',
    ) as HTMLElement | null;
    const resultCount = host.querySelector(
      '[data-testid="measurement-pipe-distance-result-count"]',
    ) as HTMLElement | null;
    const status = host.querySelector('[data-testid="measurement-pipe-distance-status"]') as HTMLElement | null;
    const openButton = host.querySelector(
      '[data-testid="measurement-open-pipe-distance"]',
    ) as HTMLButtonElement | null;

    expect(card?.textContent).toContain('管-管净距');
    expect(card?.textContent).toContain('选择多根 BRAN 管道');
    expect(selectedCount?.textContent).toContain('2');
    expect(resultCount?.textContent).toContain('1');
    expect(status?.textContent).toContain('已生成 1 条净距结果');

    isDetecting.value = true;
    await nextTick();
    expect(status?.textContent).toContain('正在检测管道间净距');

    isDetecting.value = false;
    detectError.value = '检测失败: 管段数据缺失';
    await nextTick();
    expect(status?.textContent).toContain('检测失败: 管段数据缺失');

    openButton?.click();
    await nextTick();

    expect(emitCommand).toHaveBeenCalledWith('measurement.pipe_to_pipe');

    app.unmount();
    host.remove();
    host = null;
  });

  it('在 xeokit 测量模式下应通过 dock 测量面板展示 xeokit 记录并同步 xmeas 选中', async () => {
    const selectedId = ref<string | null>(null);
    const selectAnnotation = vi.fn((id: string | null) => {
      selectedId.value = id;
    });
    const setAllMeasurementsVisible = vi.fn();
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
          setAllMeasurementsVisible,
        }),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
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

    (host.querySelector('[data-testid="measurement-toggle-all-visible"]') as HTMLButtonElement | null)
      ?.click();
    expect(setAllMeasurementsVisible).toHaveBeenCalledWith(false);

    const styleAxis = host.querySelector('[data-testid="measurement-style-distance-axis"]') as HTMLInputElement | null;
    expect(styleAxis).toBeTruthy();
    // E3D 默认体验：轴向分量默认开启。
    expect(styleAxis?.checked).toBe(true);
    if (styleAxis) {
      styleAxis.checked = false;
      styleAxis.dispatchEvent(new Event('change'));
    }
    await nextTick();

    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    expect(useXeokitMeasurementStyleStore().state.distanceShowAxisBreakdown).toBe(false);

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
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId,
        }),
      }),
    }));

    const [
      { default: MeasurementPanel },
      { useToolStore },
      { useUnitSettingsStore },
      { useXeokitMeasurementStyleStore },
    ] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useUnitSettingsStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    useUnitSettingsStore().setDisplayUnit('mm');
    useXeokitMeasurementStyleStore().updateStyle({
      distanceShowAxisBreakdown: false,
      distanceShowMarkers: false,
      elevationDatum: 1.25,
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

    expect(host.textContent).toContain('默认显示总长与 E/N/U 轴向分量');

    const datumInput = host.querySelector(
      '[data-testid="measurement-elevation-datum"]',
    ) as HTMLInputElement | null;
    expect(datumInput?.value).toBe('1250');
    if (datumInput) {
      datumInput.value = '2500';
      datumInput.dispatchEvent(new Event('change'));
    }
    await nextTick();
    expect(useXeokitMeasurementStyleStore().state.elevationDatum).toBe(2.5);

    const resetButton = host.querySelector('[data-testid="measurement-style-reset"]') as HTMLButtonElement | null;
    expect(resetButton).toBeTruthy();
    resetButton?.click();
    await nextTick();

    // 恢复默认 = E3D 默认：轴向分量开启。
    expect(useXeokitMeasurementStyleStore().state.distanceShowAxisBreakdown).toBe(true);
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
    // E3D 默认开启轴向分量。
    expect(preview?.textContent).toContain('E/N/U 分量');

    const styleAxis = host.querySelector('[data-testid="measurement-style-distance-axis"]') as HTMLInputElement | null;
    if (styleAxis) {
      styleAxis.checked = false;
      styleAxis.dispatchEvent(new Event('change'));
    }
    await nextTick();

    expect(preview?.textContent).not.toContain('E/N/U 分量');

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
    // E3D 默认开启轴向分量。
    expect(distanceNote?.textContent).toContain('当前距离结果会同时显示总长和 E / N / U 轴向分量');

    const styleAxis = host.querySelector(
      '[data-testid="measurement-style-distance-axis"]',
    ) as HTMLInputElement | null;
    if (styleAxis) {
      styleAxis.checked = false;
      styleAxis.dispatchEvent(new Event('change'));
    }
    await nextTick();

    expect(distanceNote?.textContent).toContain('开启后距离结果会额外显示 E / N / U 轴向分量');

    app.unmount();
    host.remove();
    host = null;
  });

  it('样式设置应提供测量点源显示、捕捉和阈值控制', async () => {
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
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();

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

    const ptsetShow = host.querySelector(
      '[data-testid="measurement-source-ptset-show"]',
    ) as HTMLInputElement | null;
    const meshSnap = host.querySelector(
      '[data-testid="measurement-source-mesh_pick_point-snap"]',
    ) as HTMLInputElement | null;
    const meshThreshold = host.querySelector(
      '[data-testid="measurement-source-mesh_pick_point-threshold"]',
    ) as HTMLInputElement | null;

    expect(ptsetShow?.checked).toBe(true);
    expect(meshSnap?.checked).toBe(false);
    expect(meshThreshold?.disabled).toBe(true);

    if (ptsetShow) {
      ptsetShow.checked = false;
      ptsetShow.dispatchEvent(new Event('change'));
    }
    if (meshSnap) {
      meshSnap.checked = true;
      meshSnap.dispatchEvent(new Event('change'));
    }
    await nextTick();

    expect(measurementStyle.state.measurementPickSources.ptset.show).toBe(false);
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.snap).toBe(true);
    expect(meshThreshold?.disabled).toBe(false);

    if (meshThreshold) {
      meshThreshold.value = '99';
      meshThreshold.dispatchEvent(new Event('change'));
    }
    await nextTick();

    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.thresholdPx).toBe(40);
    expect(measurementStyle.state.keypointSnapEnabled).toBe(true);
    expect(measurementStyle.state.keypointSnapPx).toBe(12);

    app.unmount();
    host.remove();
    host = null;
  });

  it('测量点源 UI 文案和状态应区分 P-Point、Item 原点与模型表面点捕捉', async () => {
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
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();

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

    const sourceSection = host.querySelector(
      '[data-testid="measurement-style-snap-section"]',
    ) as HTMLElement | null;
    const ptsetShow = host.querySelector(
      '[data-testid="measurement-source-ptset-show"]',
    ) as HTMLInputElement | null;
    const ptsetSnap = host.querySelector(
      '[data-testid="measurement-source-ptset-snap"]',
    ) as HTMLInputElement | null;
    const ptsetThreshold = host.querySelector(
      '[data-testid="measurement-source-ptset-threshold"]',
    ) as HTMLInputElement | null;
    const positionSnap = host.querySelector(
      '[data-testid="measurement-source-position-snap"]',
    ) as HTMLInputElement | null;
    const meshShow = host.querySelector(
      '[data-testid="measurement-source-mesh_pick_point-show"]',
    ) as HTMLInputElement | null;
    const meshSnap = host.querySelector(
      '[data-testid="measurement-source-mesh_pick_point-snap"]',
    ) as HTMLInputElement | null;
    const meshThreshold = host.querySelector(
      '[data-testid="measurement-source-mesh_pick_point-threshold"]',
    ) as HTMLInputElement | null;

    expect(sourceSection?.textContent).toContain('P-Point 设计关键点');
    expect(sourceSection?.textContent).toContain('Item 原点');
    expect(sourceSection?.textContent).toContain('不等同于 E3D Item 端点');
    expect(sourceSection?.textContent).toContain('模型表面点');
    expect(sourceSection?.textContent).toContain('屏幕像素');
    expect(sourceSection?.textContent).toContain('小于或等于阈值时可捕捉');
    expect(ptsetShow?.checked).toBe(true);
    expect(ptsetSnap?.checked).toBe(true);
    expect(ptsetThreshold?.disabled).toBe(false);
    expect(ptsetThreshold?.value).toBe('12');
    expect(positionSnap?.checked).toBe(true);
    expect(meshShow?.checked).toBe(true);
    expect(meshSnap?.checked).toBe(false);
    expect(meshThreshold?.disabled).toBe(true);
    expect(meshThreshold?.value).toBe('12');

    if (ptsetShow) {
      ptsetShow.checked = false;
      ptsetShow.dispatchEvent(new Event('change'));
    }
    await nextTick();

    expect(measurementStyle.state.measurementPickSources.ptset.show).toBe(false);
    expect(measurementStyle.state.measurementPickSources.ptset.snap).toBe(true);
    expect(ptsetSnap?.checked).toBe(true);
    expect(ptsetThreshold?.disabled).toBe(false);

    if (ptsetSnap) {
      ptsetSnap.checked = false;
      ptsetSnap.dispatchEvent(new Event('change'));
    }
    await nextTick();

    expect(measurementStyle.state.measurementPickSources.ptset.show).toBe(false);
    expect(measurementStyle.state.measurementPickSources.ptset.snap).toBe(false);
    expect(ptsetThreshold?.disabled).toBe(true);
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.show).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });

  it('阈值输入应按像素边界归一化，并在面板重挂载后保持 store 状态', async () => {
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
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();

    const mountPanel = () => {
      const app = createApp(MeasurementPanel, {
        tools: {
          ready: ref(false),
          statusText: ref('classic ready'),
          flyToMeasurement: vi.fn(),
          removeMeasurement: vi.fn(),
        },
      });
      app.mount(host!);
      return app;
    };

    let app = mountPanel();
    await nextTick();

    const ptsetThreshold = host.querySelector(
      '[data-testid="measurement-source-ptset-threshold"]',
    ) as HTMLInputElement | null;
    const meshSnap = host.querySelector(
      '[data-testid="measurement-source-mesh_pick_point-snap"]',
    ) as HTMLInputElement | null;
    const meshThreshold = host.querySelector(
      '[data-testid="measurement-source-mesh_pick_point-threshold"]',
    ) as HTMLInputElement | null;

    if (ptsetThreshold) {
      ptsetThreshold.value = '';
      ptsetThreshold.dispatchEvent(new Event('change'));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.ptset.thresholdPx).toBe(12);

    if (ptsetThreshold) {
      ptsetThreshold.value = '-1';
      ptsetThreshold.dispatchEvent(new Event('change'));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.ptset.thresholdPx).toBe(4);

    if (ptsetThreshold) {
      ptsetThreshold.value = '40';
      ptsetThreshold.dispatchEvent(new Event('change'));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.ptset.thresholdPx).toBe(40);

    if (meshSnap) {
      meshSnap.checked = true;
      meshSnap.dispatchEvent(new Event('change'));
    }
    await nextTick();
    expect(meshThreshold?.disabled).toBe(false);

    if (meshThreshold) {
      meshThreshold.value = '7';
      meshThreshold.dispatchEvent(new Event('change'));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.snap).toBe(true);
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.thresholdPx).toBe(7);

    app.unmount();
    host.innerHTML = '';
    app = mountPanel();
    await nextTick();

    const remountedPtsetThreshold = host.querySelector(
      '[data-testid="measurement-source-ptset-threshold"]',
    ) as HTMLInputElement | null;
    const remountedMeshSnap = host.querySelector(
      '[data-testid="measurement-source-mesh_pick_point-snap"]',
    ) as HTMLInputElement | null;
    const remountedMeshThreshold = host.querySelector(
      '[data-testid="measurement-source-mesh_pick_point-threshold"]',
    ) as HTMLInputElement | null;

    expect(remountedPtsetThreshold?.value).toBe('40');
    expect(remountedMeshSnap?.checked).toBe(true);
    expect(remountedMeshThreshold?.disabled).toBe(false);
    expect(remountedMeshThreshold?.value).toBe('7');

    app.unmount();
    host.remove();
    host = null;
  });
});
