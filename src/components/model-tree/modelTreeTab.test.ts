import { describe, expect, it } from 'vitest';

import { MODEL_TREE_TAB_STORAGE_KEY, readModelTreeTab, writeModelTreeTab } from '@/components/model-tree/modelTreeTab';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

describe('modelTreeTab（页签记忆，P3-a）', () => {
  it('没记过 / 记了坏值 / 没有存储 → pdms', () => {
    expect(readModelTreeTab(memoryStorage())).toBe('pdms');
    expect(readModelTreeTab(memoryStorage({ [MODEL_TREE_TAB_STORAGE_KEY]: 'diff' }))).toBe('pdms');
    expect(readModelTreeTab(null)).toBe('pdms');
  });

  it('写 room 再读回 room；写 pdms 覆盖', () => {
    const storage = memoryStorage();
    writeModelTreeTab('room', storage);
    expect(storage.map.get(MODEL_TREE_TAB_STORAGE_KEY)).toBe('room');
    expect(readModelTreeTab(storage)).toBe('room');
    writeModelTreeTab('pdms', storage);
    expect(readModelTreeTab(storage)).toBe('pdms');
  });

  it('存储抛异常（隐私模式 / 配额）：读回 pdms、写不抛', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(readModelTreeTab(broken)).toBe('pdms');
    expect(() => writeModelTreeTab('room', broken)).not.toThrow();
  });
});
