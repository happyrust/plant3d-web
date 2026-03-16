import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
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
  };
}

function setSearch(search: string) {
  window.history.replaceState({}, '', search);
}

async function loadStore() {
  const mod = await import('./useToolStore');
  return mod.useToolStore();
}

describe('useToolStore - persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
    localStorage.clear();
    setSearch('?output_project=AvevaMarineSample&show_dbnum=7997');
  });

  it('should maintain text/cloud/rect annotations in memory', async () => {
    const store = await loadStore();
    store.clearAll();

    store.addAnnotation({
      id: 'text-1',
      entityId: 'entity-1',
      worldPos: [1, 2, 3],
      visible: true,
      glyph: '1',
      title: 'Text',
      description: '',
      createdAt: Date.now(),
    });

    store.addCloudAnnotation({
      id: 'cloud-1',
      objectIds: ['bran_1'],
      anchorWorldPos: [4, 5, 6],
      visible: true,
      title: 'Cloud',
      description: '',
      createdAt: Date.now(),
      refnos: ['bran_1'],
    });

    store.addRectAnnotation({
      id: 'rect-1',
      objectIds: ['bran_2'],
      obb: {
        center: [7, 8, 9],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [1, 1, 1],
        corners: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
      },
      anchorWorldPos: [7, 8, 9],
      visible: true,
      title: 'Rect',
      description: '',
      createdAt: Date.now(),
      refnos: ['bran_2'],
    });

    expect(store.annotations.value).toHaveLength(1);
    expect(store.cloudAnnotations.value).toHaveLength(1);
    expect(store.rectAnnotations.value).toHaveLength(1);
    expect(store.annotations.value[0].worldPos).toEqual([1, 2, 3]);
    expect(store.cloudAnnotations.value[0].anchorWorldPos).toEqual([4, 5, 6]);
    expect(store.rectAnnotations.value[0].obb.center).toEqual([7, 8, 9]);
  });

  it('should expose and clear pending cloud annotation editor state', async () => {
    const store = await loadStore();
    store.clearAll();

    store.addCloudAnnotation({
      id: 'cloud-pending-1',
      objectIds: ['bran_1'],
      anchorWorldPos: [1, 1, 1],
      visible: true,
      title: 'Cloud Pending',
      description: '',
      createdAt: Date.now(),
      refnos: ['bran_1'],
    });

    expect(store.pendingCloudAnnotationEditId.value).toBe('cloud-pending-1');

    store.removeCloudAnnotation('cloud-pending-1');
    expect(store.pendingCloudAnnotationEditId.value).toBeNull();
  });

  it('should isolate persisted annotations by output_project and show_dbnum', async () => {
    setSearch('?output_project=ProjectA&show_dbnum=1001');
    vi.resetModules();
    const storeA = await loadStore();
    storeA.clearAll();
    storeA.addAnnotation({
      id: 'text-a',
      entityId: 'entity-a',
      worldPos: [1, 2, 3],
      visible: true,
      glyph: 'A',
      title: 'Text A',
      description: '',
      createdAt: Date.now(),
    });
    await nextTick();

    setSearch('?output_project=ProjectB&show_dbnum=2002');
    vi.resetModules();
    const storeB = await loadStore();
    expect(storeB.annotations.value).toHaveLength(0);

    setSearch('?output_project=ProjectA&show_dbnum=1001');
    vi.resetModules();
    const storeAReloaded = await loadStore();
    expect(storeAReloaded.annotations.value).toHaveLength(1);
    expect(storeAReloaded.annotations.value[0].title).toBe('Text A');
  });

  it('should ignore legacy global storage to avoid cross-project annotation leakage', async () => {
    localStorage.setItem('plant3d-web-tools-v4', JSON.stringify({
      version: 4,
      measurements: [],
      annotations: [{
        id: 'legacy-text',
        entityId: 'legacy-entity',
        worldPos: [9, 9, 9],
        visible: true,
        glyph: 'L',
        title: 'Legacy Text',
        description: '',
        createdAt: Date.now(),
      }],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      dimensions: [],
    }));

    setSearch('?output_project=ScopedProject&show_dbnum=3003');
    vi.resetModules();
    const store = await loadStore();

    expect(store.annotations.value).toHaveLength(0);
    expect(store.cloudAnnotations.value).toHaveLength(0);
    expect(store.rectAnnotations.value).toHaveLength(0);
  });

  it('should persist xeokit measurements without polluting classic measurements', async () => {
    const store = await loadStore();
    store.clearAll();

    store.addXeokitDistanceMeasurement({
      id: 'x-dist-1',
      kind: 'distance',
      origin: { entityId: 'o:1', worldPos: [0, 0, 0] },
      target: { entityId: 'o:2', worldPos: [1, 2, 3] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });
    store.addXeokitAngleMeasurement({
      id: 'x-ang-1',
      kind: 'angle',
      origin: { entityId: 'o:1', worldPos: [0, 0, 0] },
      corner: { entityId: 'o:2', worldPos: [1, 0, 0] },
      target: { entityId: 'o:3', worldPos: [1, 1, 0] },
      visible: true,
      approximate: false,
      createdAt: 2,
    });

    store.setCurrentXeokitDistanceDraft({
      id: 'draft-1',
      kind: 'distance',
      origin: { entityId: 'o:4', worldPos: [0, 0, 0] },
      target: { entityId: 'o:4', worldPos: [0, 0, 0] },
      visible: true,
      approximate: true,
      createdAt: 3,
    });
    await nextTick();

    expect(store.measurements.value).toHaveLength(0);
    expect(store.xeokitDistanceMeasurements.value).toHaveLength(1);
    expect(store.xeokitAngleMeasurements.value).toHaveLength(1);

    vi.resetModules();
    const reloaded = await loadStore();
    expect(reloaded.measurements.value).toHaveLength(0);
    expect(reloaded.xeokitDistanceMeasurements.value).toHaveLength(1);
    expect(reloaded.xeokitAngleMeasurements.value).toHaveLength(1);
    expect(reloaded.currentXeokitDistanceDraft.value).toBeNull();
  });
});
