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

async function loadStore() {
  const mod = await import('./useToolStore');
  return mod.useToolStore();
}

describe('useToolStore - measurement source info', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
    localStorage.clear();
    window.history.replaceState({}, '', '?output_project=AvevaMarineSample&show_dbnum=7997');
  });

  it('normalizes valid sourceInfo and drops invalid source ids for new xeokit measurements', async () => {
    const store = await loadStore();
    store.clearAll();

    store.addXeokitDistanceMeasurement({
      id: 'x-source',
      kind: 'distance',
      origin: {
        entityId: 'ptset:24381_145018#1',
        worldPos: [0, 0, 0],
        sourceInfo: {
          source: 'ptset',
          candidateId: 'ptset:24381_145018#1',
          refno: '24381_145018',
          label: 'PTSET #1',
        },
      },
      target: {
        entityId: 'bad-source',
        worldPos: [1, 0, 0],
        sourceInfo: {
          source: 'unknown',
          candidateId: 'ignored',
        } as never,
      },
      visible: true,
      approximate: false,
      createdAt: 1,
    });

    expect(store.xeokitDistanceMeasurements.value[0]?.origin.sourceInfo).toEqual({
      source: 'ptset',
      candidateId: 'ptset:24381_145018#1',
      refno: '24381_145018',
      label: 'PTSET #1',
    });
    expect(store.xeokitDistanceMeasurements.value[0]?.target.sourceInfo).toBeUndefined();
  });

  it('persists and reloads measurement sourceInfo for xeokit records', async () => {
    const store = await loadStore();
    store.clearAll();
    store.addXeokitElevationPointMeasurement({
      id: 'x-elev',
      kind: 'elevation_point',
      point: {
        entityId: 'position:24381_145018',
        worldPos: [1, 2, 3],
        sourceInfo: {
          source: 'position',
          candidateId: 'position:24381_145018',
          refno: '24381_145018',
          label: 'Position 24381_145018',
        },
      },
      absoluteElevation: 3,
      relativeElevation: 3,
      visible: true,
      approximate: false,
      createdAt: 2,
    });
    await nextTick();

    vi.resetModules();
    const reloaded = await loadStore();

    expect(reloaded.xeokitElevationPointMeasurements.value[0]?.point.sourceInfo).toEqual({
      source: 'position',
      candidateId: 'position:24381_145018',
      refno: '24381_145018',
      label: 'Position 24381_145018',
    });
  });

  it('preserves independent sourceInfo for PTSET/PTSET, mesh/mesh, and mixed distance records', async () => {
    const store = await loadStore();
    store.clearAll();

    store.addXeokitDistanceMeasurement({
      id: 'ptset-to-ptset',
      kind: 'distance',
      origin: {
        entityId: 'ptset:24381_145018#1',
        worldPos: [0, 0, 0],
        sourceInfo: {
          source: 'ptset',
          candidateId: 'ptset:24381_145018#1',
          refno: '24381_145018',
          label: 'PTSET #1',
        },
      },
      target: {
        entityId: 'ptset:24381_145018#2',
        worldPos: [1, 0, 0],
        sourceInfo: {
          source: 'ptset',
          candidateId: 'ptset:24381_145018#2',
          refno: '24381_145018',
          label: 'PTSET #2',
        },
      },
      visible: true,
      approximate: false,
      createdAt: 3,
    });
    store.addXeokitDistanceMeasurement({
      id: 'mesh-to-mesh',
      kind: 'distance',
      origin: {
        entityId: 'o:24381_145018:0',
        worldPos: [0, 0, 0],
        sourceInfo: {
          source: 'mesh_pick_point',
          candidateId: 'mesh:o:24381_145018:0',
          refno: '24381_145018',
          label: 'Mesh Pick Point',
        },
      },
      target: {
        entityId: 'o:24381_145020:0',
        worldPos: [0, 1, 0],
        sourceInfo: {
          source: 'mesh_pick_point',
          candidateId: 'mesh:o:24381_145020:0',
          refno: '24381_145020',
          label: 'Mesh Pick Point',
        },
      },
      visible: true,
      approximate: false,
      createdAt: 4,
    });
    store.addXeokitDistanceMeasurement({
      id: 'ptset-to-mesh',
      kind: 'distance',
      origin: {
        entityId: 'ptset:24381_145018#1',
        worldPos: [0, 0, 0],
        sourceInfo: {
          source: 'ptset',
          candidateId: 'ptset:24381_145018#1',
          refno: '24381_145018',
          label: 'PTSET #1',
        },
      },
      target: {
        entityId: 'o:24381_145018:0',
        worldPos: [0, 0, 1],
        sourceInfo: {
          source: 'mesh_pick_point',
          refno: '24381_145018',
          label: 'Mesh Pick Point',
        },
      },
      visible: true,
      approximate: false,
      createdAt: 5,
    });

    const [ptsetToPtset, meshToMesh, mixed] = store.xeokitDistanceMeasurements.value;

    expect(ptsetToPtset?.origin.sourceInfo?.candidateId).toBe('ptset:24381_145018#1');
    expect(ptsetToPtset?.target.sourceInfo?.candidateId).toBe('ptset:24381_145018#2');
    expect(meshToMesh?.origin.sourceInfo?.source).toBe('mesh_pick_point');
    expect(meshToMesh?.origin.sourceInfo?.candidateId).not.toContain('ptset:');
    expect(meshToMesh?.target.sourceInfo?.source).toBe('mesh_pick_point');
    expect(meshToMesh?.target.sourceInfo?.candidateId).not.toContain('ptset:');
    expect(mixed?.origin.sourceInfo).toMatchObject({
      source: 'ptset',
      candidateId: 'ptset:24381_145018#1',
    });
    expect(mixed?.target.sourceInfo).toMatchObject({
      source: 'mesh_pick_point',
      refno: '24381_145018',
      label: 'Mesh Pick Point',
    });
    expect(mixed?.target.sourceInfo?.candidateId?.startsWith('ptset:')).not.toBe(true);
  });
});
