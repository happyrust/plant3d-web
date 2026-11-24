import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import {
  createScopedResultPersistence,
  pruneScopedPersistenceKeys,
  SCOPED_PERSISTENCE_KEY_LIMIT,
} from './scopedResultPersistence';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    key: (index: number) => [...data.keys()][index] ?? null,
    keys: () => [...data.keys()],
  };
}

describe('scoped result persistence', () => {
  it('写入时带上 savedAt', () => {
    const source = ref(1);
    const storage = memoryStorage();
    const persistence = createScopedResultPersistence({
      prefix: 'plant3d-test-v1',
      sources: [source],
      capture: () => ({ n: source.value }),
      restore: () => {},
      invalidate: () => {},
    });
    persistence.bindPersistence('scope-a', storage);
    source.value = 2;

    const envelope = JSON.parse(storage.getItem('plant3d-test-v1:scope-a') ?? '');
    expect(envelope.version).toBe(1);
    expect(envelope.scope).toBe('scope-a');
    expect(envelope.data).toEqual({ n: 2 });
    expect(typeof envelope.savedAt).toBe('string');
    expect(Number.isFinite(Date.parse(envelope.savedAt))).toBe(true);
    persistence.dispose();
  });

  it('每个前缀只保留最近 20 个键，没有 savedAt 的旧键先删', () => {
    const storage = memoryStorage();
    for (let index = 0; index < SCOPED_PERSISTENCE_KEY_LIMIT + 1; index += 1) {
      const savedAt = index === 0 ? undefined : new Date(Date.UTC(2026, 0, index)).toISOString();
      storage.setItem(`plant3d-test-v1:old-${index}`, JSON.stringify({
        version: 1,
        scope: `old-${index}`,
        ...(savedAt ? { savedAt } : {}),
        data: { n: index },
      }));
    }
    storage.setItem('other-prefix:keep', JSON.stringify({ savedAt: '2020-01-01T00:00:00.000Z' }));

    pruneScopedPersistenceKeys(storage, 'plant3d-test-v1', 'plant3d-test-v1:current');

    const keys = storage.keys().filter((key) => key.startsWith('plant3d-test-v1:'));
    expect(keys).toHaveLength(SCOPED_PERSISTENCE_KEY_LIMIT);
    expect(keys).not.toContain('plant3d-test-v1:old-0');
    expect(storage.getItem('other-prefix:keep')).toBeTruthy();
  });

  it('当前键即使更旧也留在这 20 个里', () => {
    const storage = memoryStorage();
    storage.setItem('plant3d-test-v1:current', JSON.stringify({
      version: 1,
      scope: 'current',
      savedAt: '2020-01-01T00:00:00.000Z',
      data: { n: 0 },
    }));
    for (let index = 1; index <= SCOPED_PERSISTENCE_KEY_LIMIT; index += 1) {
      storage.setItem(`plant3d-test-v1:new-${index}`, JSON.stringify({
        version: 1,
        scope: `new-${index}`,
        savedAt: new Date(Date.UTC(2026, 0, index)).toISOString(),
        data: { n: index },
      }));
    }

    pruneScopedPersistenceKeys(storage, 'plant3d-test-v1', 'plant3d-test-v1:current');

    const keys = storage.keys().filter((key) => key.startsWith('plant3d-test-v1:'));
    expect(keys).toHaveLength(SCOPED_PERSISTENCE_KEY_LIMIT);
    expect(keys).toContain('plant3d-test-v1:current');
    expect(keys).not.toContain('plant3d-test-v1:new-1');
  });
});
