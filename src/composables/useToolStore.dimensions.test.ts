import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

type PersistedStateV3 = {
  version: 3
  measurements: unknown[]
  annotations: unknown[]
  obbAnnotations: unknown[]
  cloudAnnotations: unknown[]
  rectAnnotations: unknown[]
}

describe('useToolStore - dimensions', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
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
    }
    ;(globalThis as any).localStorage.clear();
    vi.resetModules();
  });

  it('should migrate v3 payload and initialize dimensions to []', async () => {
    const payloadV3: PersistedStateV3 = {
      version: 3,
      measurements: [],
      annotations: [],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
    };
    localStorage.setItem('plant3d-web-tools-v3', JSON.stringify(payloadV3));

    const mod = await import('./useToolStore');
    const store = mod.useToolStore();

    expect(Array.isArray((store as any).dimensions?.value)).toBe(true);
    expect((store as any).dimensions.value).toEqual([]);
  });

  it('should add a linear dimension record and persist to v4 storage', async () => {
    const mod = await import('./useToolStore');
    const store = mod.useToolStore() as any;

    store.addDimension({
      id: 'd1',
      kind: 'linear_distance',
      origin: { entityId: 'e1', worldPos: [0, 0, 0] },
      target: { entityId: 'e2', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
      offset: 0.5,
      direction: [0, 1, 0],
    });

    await nextTick();

    const raw = localStorage.getItem('plant3d-web-tools-v4');
    expect(raw).toBeTruthy();
    const parsed = raw ? JSON.parse(raw) : null;
    expect(parsed?.version).toBe(4);
    expect(Array.isArray(parsed?.dimensions)).toBe(true);
    expect(parsed.dimensions.length).toBe(1);
    expect(parsed.dimensions[0].id).toBe('d1');
  });
});
