import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

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
    expect(unified[0].source).toBe('classic');
    expect(unified[0].approximate).toBe(false);
    expect(unified[0].id).toBe('d1');
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
    expect(unified[0].source).toBe('xeokit');
    expect(unified[0].approximate).toBe(true);
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
