import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

import { createComputationProvenance } from '@/measurement/domain/computationProvenance';

function setSearch(search: string) {
  window.history.replaceState({}, '', search);
}

describe('useToolStore - unifiedMeasurements computed', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
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

  it('初始空 store 返回空数组', async () => {
    const mod = await import('./useToolStore');
    const store = mod.useToolStore();
    expect(store.unifiedMeasurements.value).toEqual([]);
  });

  it('新增 classic 距离测量后聚合出现一条 source=classic 记录', async () => {
    const mod = await import('./useToolStore');
    const store = mod.useToolStore();

    store.addMeasurement({
      id: 'd1',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [10, 0, 0] },
      visible: true,
      createdAt: 1000,
    });
    await nextTick();

    const unified = store.unifiedMeasurements.value;
    expect(unified).toHaveLength(1);
    const record = unified[0];
    if (!record) throw new Error('missing unified record');
    expect(record.source).toBe('classic');
    expect(record.approximate).toBe(true);
    expect(record.provenance.accuracyClass).toBe('legacy-unknown');
    expect(record.id).toBe('d1');
  });

  it('新增 xeokit 距离测量后聚合包含 source=xeokit 且保留 approximate', async () => {
    const mod = await import('./useToolStore');
    const store = mod.useToolStore();

    store.addXeokitDistanceMeasurement({
      id: 'xd1',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [5, 0, 0] },
      visible: true,
      approximate: true,
      createdAt: 2000,
    });
    await nextTick();

    const unified = store.unifiedMeasurements.value;
    expect(unified).toHaveLength(1);
    const record = unified[0];
    if (!record) throw new Error('missing unified record');
    expect(record.source).toBe('xeokit');
    expect(record.approximate).toBe(true);
  });

  it('混合 classic + xeokit distance + xeokit angle：聚合数量 = 3 并保持顺序', async () => {
    const mod = await import('./useToolStore');
    const store = mod.useToolStore();

    store.addMeasurement({
      id: 'c',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
    });
    store.addXeokitDistanceMeasurement({
      id: 'x1',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [2, 0, 0] },
      visible: true,
      approximate: true,
      createdAt: 2,
    });
    store.addXeokitAngleMeasurement({
      id: 'x2',
      kind: 'angle',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      corner: { entityId: 'e2', worldPos: [1, 0, 0] },
      target: { entityId: 'e3', worldPos: [1, 1, 0] },
      visible: true,
      approximate: false,
      createdAt: 3,
    });
    await nextTick();

    const unified = store.unifiedMeasurements.value;
    expect(unified.map((r) => r.id)).toEqual(['c', 'x1', 'x2']);
    expect(unified.map((r) => r.source)).toEqual(['classic', 'xeokit', 'xeokit']);
    expect(unified.map((r) => r.kind)).toEqual(['distance', 'distance', 'angle']);
  });

  it('V7 只持久化统一数组并无损往返 provenance', async () => {
    const mod = await import('./useToolStore');
    const store = mod.useToolStore();
    const provenance = createComputationProvenance({
      method: 'semantic-point-pair',
      accuracyClass: 'exact-semantic',
      coordinateSpace: 'design-world',
      sourceModelVersion: 'model-v7',
      source: { entityId: 'e1', candidateId: 'p1' },
      target: { entityId: 'e2', candidateId: 'p2' },
    });

    store.addXeokitDistanceMeasurement({
      id: 'v7-distance',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0], designWorldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [1, 0, 0], designWorldPos: [1, 0, 0] },
      visible: true,
      approximate: true,
      provenance,
      createdAt: 7,
    });
    await nextTick();

    const exported = JSON.parse(store.exportJSON()) as Record<string, unknown>;
    expect(exported.version).toBe(7);
    expect(exported.measurements).toEqual([
      expect.objectContaining({
        id: 'v7-distance',
        source: 'xeokit',
        approximate: false,
        provenance,
      }),
    ]);
    expect(exported).not.toHaveProperty('xeokitDistanceMeasurements');
    expect(exported).not.toHaveProperty('xeokitAngleMeasurements');

    store.clearAll();
    store.importJSON(JSON.stringify(exported));

    expect(store.unifiedMeasurements.value).toEqual([
      expect.objectContaining({
        id: 'v7-distance',
        source: 'xeokit',
        approximate: false,
        provenance,
      }),
    ]);
  });

  it('删除 classic 测量后聚合同步变化', async () => {
    const mod = await import('./useToolStore');
    const store = mod.useToolStore();

    store.addMeasurement({
      id: 'to-remove',
      kind: 'distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
    });
    await nextTick();
    expect(store.unifiedMeasurements.value).toHaveLength(1);

    store.removeMeasurement('to-remove');
    await nextTick();

    expect(store.unifiedMeasurements.value).toEqual([]);
  });
});
