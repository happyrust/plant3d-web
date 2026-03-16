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
});
