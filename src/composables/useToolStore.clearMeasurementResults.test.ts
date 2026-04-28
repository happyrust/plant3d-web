import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

function setSearch(search: string) {
  window.history.replaceState({}, '', search);
}

describe('useToolStore - clearMeasurementResults', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
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
    } as Storage;
    (globalThis as unknown as { localStorage: Storage }).localStorage.clear();
    setSearch('?output_project=AvevaMarineSample&show_dbnum=7997');
    vi.resetModules();
  });

  it('清空测量应覆盖 classic、xeokit 和测量模式生成的尺寸，但保留普通尺寸标注', async () => {
    const { useToolStore } = await import('./useToolStore');
    const store = useToolStore();

    store.addMeasurement({
      id: 'classic-distance',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
    });
    store.addXeokitDistanceMeasurement({
      id: 'xeokit-distance',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [2, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 2,
    });
    store.addXeokitAngleMeasurement({
      id: 'xeokit-angle',
      kind: 'angle',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      corner: { entityId: 'e2', worldPos: [1, 0, 0] },
      target: { entityId: 'e3', worldPos: [1, 1, 0] },
      visible: true,
      approximate: false,
      createdAt: 3,
    });
    store.setCurrentXeokitDistanceDraft({
      id: 'draft-distance',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [3, 0, 0] },
      visible: true,
      approximate: true,
      createdAt: 4,
    });
    store.addDimension({
      id: 'pipe-structure-current',
      kind: 'linear_distance',
      origin: { entityId: 'pipe', worldPos: [0, 0, 0] },
      target: { entityId: 'wall', worldPos: [1, 0, 0] },
      offset: 0.3,
      direction: null,
      sourceToolMode: 'measure_pipe_to_structure',
      visible: true,
      createdAt: 5,
    });
    store.addDimension({
      id: 'dim-pipe-structure-legacy',
      kind: 'linear_distance',
      origin: { entityId: 'pipe', worldPos: [0, 0, 0] },
      target: { entityId: 'wall', worldPos: [2, 0, 0] },
      offset: 0.3,
      direction: null,
      visible: true,
      createdAt: 6,
    });
    store.addDimension({
      id: 'manual-dimension',
      kind: 'linear_distance',
      origin: { entityId: 'manual-a', worldPos: [0, 0, 0] },
      target: { entityId: 'manual-b', worldPos: [4, 0, 0] },
      offset: 0.5,
      direction: null,
      visible: true,
      createdAt: 7,
    });
    store.activeDimensionId.value = 'pipe-structure-current';

    store.clearMeasurementResults();
    await nextTick();

    expect(store.measurements.value).toEqual([]);
    expect(store.xeokitDistanceMeasurements.value).toEqual([]);
    expect(store.xeokitAngleMeasurements.value).toEqual([]);
    expect(store.currentXeokitDistanceDraft.value).toBeNull();
    expect(store.dimensions.value.map((record) => record.id)).toEqual(['manual-dimension']);
    expect(store.activeDimensionId.value).toBeNull();
  });
});
