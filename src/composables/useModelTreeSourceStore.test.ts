import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetModelTreeSourceStoreForTests,
  DEFAULT_MODEL_TREE_DATA_SOURCE,
  getActiveModelTreeDataSource,
  MODEL_TREE_SOURCE_STORAGE_KEY,
  normalizeModelTreeDataSource,
  subscribeModelTreeDataSourceChange,
  useModelTreeSourceStore,
} from './useModelTreeSourceStore';

function createLocalStorageMock(): Storage {
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

describe('useModelTreeSourceStore', () => {
  beforeEach(() => {
    const storage = createLocalStorageMock();
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
    window.history.replaceState({}, '', '/');
    __resetModelTreeSourceStoreForTests();
  });

  it('默认为 direct（E3D 直读），且识别别名字面', () => {
    expect(DEFAULT_MODEL_TREE_DATA_SOURCE).toBe('direct');
    expect(getActiveModelTreeDataSource()).toBe('direct');
    expect(normalizeModelTreeDataSource('e3d')).toBe('direct');
    expect(normalizeModelTreeDataSource('database')).toBe('db');
    expect(normalizeModelTreeDataSource('surreal')).toBe('db');
    expect(normalizeModelTreeDataSource('unknown')).toBeNull();
  });

  it('优先读取 URL ?tree_source= 参数，其次 localStorage', () => {
    window.localStorage.setItem(MODEL_TREE_SOURCE_STORAGE_KEY, 'direct');
    window.history.replaceState({}, '', '/?tree_source=db');
    __resetModelTreeSourceStoreForTests();
    expect(getActiveModelTreeDataSource()).toBe('db');

    window.history.replaceState({}, '', '/');
    window.localStorage.setItem(MODEL_TREE_SOURCE_STORAGE_KEY, 'db');
    __resetModelTreeSourceStoreForTests();
    expect(getActiveModelTreeDataSource()).toBe('db');
  });

  it('setSource 与 toggleSource 会持久化并触发订阅通知', () => {
    const store = useModelTreeSourceStore();
    const listener = vi.fn();
    const unsubscribe = subscribeModelTreeDataSourceChange(listener);

    expect(store.isDirect.value).toBe(true);
    expect(store.setSource('direct')).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    expect(store.setSource('db')).toBe(true);
    expect(store.isDb.value).toBe(true);
    expect(window.localStorage.getItem(MODEL_TREE_SOURCE_STORAGE_KEY)).toBe('db');
    expect(listener).toHaveBeenCalledWith('db');

    expect(store.toggleSource()).toBe('direct');
    expect(store.isDirect.value).toBe(true);
    expect(window.localStorage.getItem(MODEL_TREE_SOURCE_STORAGE_KEY)).toBe('direct');
    expect(listener).toHaveBeenCalledWith('direct');

    unsubscribe();
    store.setSource('db');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
