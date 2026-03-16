import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, shallowRef } from 'vue';

describe('XeokitMeasurementPanel', () => {
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

  it('应支持 xeokit 测量列表选中、外部选中回写和清空', async () => {
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

    const [{ default: XeokitMeasurementPanel }, { useToolStore }] = await Promise.all([
      import('./XeokitMeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
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
      visible: true,
      approximate: false,
      createdAt: 2,
    });
    store.activeXeokitMeasurementId.value = null;
    await nextTick();

    const app = createApp(XeokitMeasurementPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        currentMeasurement: ref(null),
        activate: vi.fn(),
        deactivate: vi.fn(),
        reset: vi.fn(),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn((id: string) => {
          store.removeXeokitMeasurement(id);
        }),
        clearMeasurements: vi.fn(() => {
          store.clearXeokitMeasurements();
        }),
      },
    });
    app.mount(host);
    await nextTick();

    const row = host.querySelector('[data-testid="xeokit-measurement-row-x1"]') as HTMLElement | null;
    expect(row).toBeTruthy();
    row?.click();
    await nextTick();

    expect(store.activeXeokitMeasurementId.value).toBe('x1');
    expect(selectAnnotation).toHaveBeenLastCalledWith('xmeas_x1');

    store.activeXeokitMeasurementId.value = 'x2';
    await nextTick();
    expect(selectAnnotation).toHaveBeenLastCalledWith('xmeas_x2');

    const clearButton = host.querySelector('[data-testid="xeokit-measurement-clear-all"]') as HTMLButtonElement | null;
    expect(clearButton).toBeTruthy();
    clearButton?.click();
    await nextTick();

    expect(store.xeokitDistanceMeasurements.value).toEqual([]);
    expect(store.xeokitAngleMeasurements.value).toEqual([]);
    expect(store.activeXeokitMeasurementId.value).toBeNull();

    app.unmount();
    host.remove();
    host = null;
  });

  it('应在未命中可拾取面时显示 pointer lens 的等待提示', async () => {
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
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [{ default: XeokitMeasurementPanel }, { useToolStore }] = await Promise.all([
      import('./XeokitMeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.xeokitHoverState.value = {
      visible: false,
      snapped: false,
      entityId: null,
      objectId: null,
      worldPos: null,
      canvasPos: { x: 10, y: 20 },
    };
    store.xeokitPointerLensState.value = {
      visible: true,
      snapped: false,
      title: '等待终点',
      subtitle: '当前未命中可拾取面',
      canvasPos: { x: 10, y: 20 },
    };

    const app = createApp(XeokitMeasurementPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        currentMeasurement: ref(null),
        activate: vi.fn(),
        deactivate: vi.fn(),
        reset: vi.fn(),
        flyToMeasurement: vi.fn(),
        removeMeasurement: vi.fn(),
        clearMeasurements: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const hoverHint = host.querySelector('[data-testid="xeokit-hover-hint"]');
    expect(hoverHint?.textContent).toContain('等待终点');
    expect(hoverHint?.textContent).toContain('当前未命中可拾取面');

    app.unmount();
    host.remove();
    host = null;
  });
});
