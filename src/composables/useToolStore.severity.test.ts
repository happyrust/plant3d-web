import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function mockUser(userId: string | null) {
  const currentUser = { value: userId ? { id: userId, name: 'Mock', role: 'designer' } : null };
  vi.doMock('./useUserStore', () => ({
    useUserStore: () => ({ currentUser }),
  }));
}

const sampleObb = {
  center: [0, 0, 0] as [number, number, number],
  axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
  halfSize: [1, 1, 1] as [number, number, number],
  corners: [
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ] as [
    [number, number, number], [number, number, number], [number, number, number], [number, number, number],
    [number, number, number], [number, number, number], [number, number, number], [number, number, number],
  ],
};

describe('useToolStore - annotation severity', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
    localStorage.clear();
    setSearch('?output_project=Sample&show_dbnum=0');
  });

  it('updateAnnotationSeverity 可为 4 种类型批注设置合法严重度', async () => {
    mockUser(null);
    const store = await loadStore();
    store.clearAll();

    store.addAnnotation({
      id: 't-1', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: '1', title: 't', description: '', createdAt: 1,
    });
    store.addCloudAnnotation({
      id: 'c-1', objectIds: ['o1'], anchorWorldPos: [0, 0, 0],
      visible: true, title: 'c', description: '', createdAt: 2, refnos: ['o1'],
    });
    store.addRectAnnotation({
      id: 'r-1', objectIds: ['o2'], obb: sampleObb, anchorWorldPos: [0, 0, 0],
      visible: true, title: 'r', description: '', createdAt: 3, refnos: ['o2'],
    });
    store.addObbAnnotation({
      id: 'o-1', objectIds: ['o3'], obb: sampleObb, labelWorldPos: [0, 0, 1],
      anchor: { kind: 'top_center' }, visible: true, title: 'o', description: '', createdAt: 4, refnos: ['o3'],
    });

    expect(store.updateAnnotationSeverity('text', 't-1', 'critical')).toBe(true);
    expect(store.updateAnnotationSeverity('cloud', 'c-1', 'severe')).toBe(true);
    expect(store.updateAnnotationSeverity('rect', 'r-1', 'normal')).toBe(true);
    expect(store.updateAnnotationSeverity('obb', 'o-1', 'suggestion')).toBe(true);

    expect(store.annotations.value[0].severity).toBe('critical');
    expect(store.cloudAnnotations.value[0].severity).toBe('severe');
    expect(store.rectAnnotations.value[0].severity).toBe('normal');
    expect(store.obbAnnotations.value[0].severity).toBe('suggestion');
  });

  it('updateAnnotationSeverity 非法值会被规范化为 undefined', async () => {
    mockUser(null);
    const store = await loadStore();
    store.clearAll();

    store.addAnnotation({
      id: 't-bad', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: '1', title: 't', description: '', createdAt: 1,
    });

    store.updateAnnotationSeverity('text', 't-bad', 'severe');
    expect(store.annotations.value[0].severity).toBe('severe');

    store.updateAnnotationSeverity('text', 't-bad', 'wtf' as unknown as 'severe');
    expect(store.annotations.value[0].severity).toBeUndefined();

    store.updateAnnotationSeverity('text', 't-bad', undefined);
    expect(store.annotations.value[0].severity).toBeUndefined();
  });

  it('updateAnnotationSeverity 对不存在的 id 返回 false 且不影响其它批注', async () => {
    mockUser(null);
    const store = await loadStore();
    store.clearAll();

    store.addAnnotation({
      id: 't-1', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: '1', title: 't', description: '', createdAt: 1,
    });

    expect(store.updateAnnotationSeverity('text', 'no-such-id', 'critical')).toBe(false);
    expect(store.annotations.value[0].severity).toBeUndefined();
  });

  it('add* 自动回填 authorId：当前登录用户可用时写入；未登录时保持 undefined', async () => {
    mockUser('user-42');
    const store = await loadStore();
    store.clearAll();

    store.addAnnotation({
      id: 't-auto', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: '1', title: 't', description: '', createdAt: 1,
    });
    expect(store.annotations.value[0].authorId).toBe('user-42');

    vi.resetModules();
    mockUser(null);
    const store2 = await loadStore();
    store2.clearAll();

    store2.addCloudAnnotation({
      id: 'c-auto', objectIds: ['o1'], anchorWorldPos: [0, 0, 0],
      visible: true, title: 'c', description: '', createdAt: 2, refnos: ['o1'],
    });
    expect(store2.cloudAnnotations.value[0].authorId).toBeUndefined();
  });

  it('add* 已显式携带 authorId 时不会被 store 覆盖', async () => {
    mockUser('user-99');
    const store = await loadStore();
    store.clearAll();

    store.addAnnotation({
      id: 't-explicit', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: '1', title: 't', description: '', createdAt: 1,
      authorId: 'explicit-author',
    });
    expect(store.annotations.value[0].authorId).toBe('explicit-author');
  });
});
