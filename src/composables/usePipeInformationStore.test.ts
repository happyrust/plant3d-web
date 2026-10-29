import { afterEach, describe, expect, it } from 'vitest';

import { usePipeInformationStore } from './usePipeInformationStore';

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

const RECORD = {
  refno: '24381_145018', name: '/PIPE-1/B1', sesno: 1, anchorMm: [0, 0, 0],
  fetchedAt: '2026-10-29T00:00:00.000Z', fields: [], warnings: [],
};

function seed(storage: ReturnType<typeof memoryStorage>, scope: string) {
  storage.data.set(`plant3d-pipe-information-v1:${scope}`, JSON.stringify({
    version: 1, scope,
    data: { coordinateSpace: 'e3d-world-mm', records: [RECORD], showAnnotations: true, hiddenRefnos: [] },
  }));
}

describe('usePipeInformationStore 本机恢复', () => {
  afterEach(() => {
    const store = usePipeInformationStore();
    store.detachPersistence();
    store.clear();
  });

  it('打开页面恢复的历史卡片默认不上屏，手动开启后显示，落盘保留用户偏好', () => {
    const storage = memoryStorage();
    seed(storage, 'scope-A');
    const store = usePipeInformationStore();
    store.bindPersistence('scope-A', storage);

    expect(store.records.value).toHaveLength(1);
    expect(store.showAnnotations.value).toBe(false);
    expect(store.visibleRecords.value).toEqual([]);

    store.persistRecords();
    const saved = JSON.parse(storage.data.get('plant3d-pipe-information-v1:scope-A')!);
    expect(saved.data.showAnnotations).toBe(true);

    store.showAnnotations.value = true;
    expect(store.visibleRecords.value.map(item => item.refno)).toEqual(['24381_145018']);
  });

  it('没有历史卡片时不挂闸门', () => {
    const storage = memoryStorage();
    const store = usePipeInformationStore();
    store.bindPersistence('scope-empty', storage);
    expect(store.showAnnotations.value).toBe(true);
  });
});
