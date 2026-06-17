import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import type { AnnotationScreenshot } from '@/types/auth';

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

function mockUser(userId: string | null) {
  const currentUser = { value: userId ? { id: userId, name: 'Mock', role: 'designer' } : null };
  vi.doMock('./useUserStore', () => ({
    useUserStore: () => ({ currentUser }),
  }));
}

async function loadStore() {
  const mod = await import('./useToolStore');
  return mod.useToolStore();
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

function makeScreenshot(id: string, capturedAt = 1_710_000_000_000): AnnotationScreenshot {
  return {
    attachmentId: id,
    name: `${id}.png`,
    url: `/files/${id}.png`,
    mimeType: 'image/png',
    size: 2048,
    width: 1280,
    height: 720,
    uploadedAt: capturedAt + 100,
    capturedAt,
  };
}

describe('useToolStore - annotation screenshot', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
    localStorage.clear();
    setSearch('?output_project=Sample&show_dbnum=0');
  });

  it('四类批注都可 set/get/clear screenshot，且重复设置会覆盖旧图', async () => {
    mockUser(null);
    const store = await loadStore();
    store.clearAll();

    store.addAnnotation({
      id: 'text-1', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: '1', title: 't', description: '', createdAt: 1,
    });
    store.addCloudAnnotation({
      id: 'cloud-1', objectIds: ['o1'], anchorWorldPos: [0, 0, 0],
      visible: true, title: 'c', description: '', createdAt: 2,
    });
    store.addRectAnnotation({
      id: 'rect-1', objectIds: ['o2'], obb: sampleObb, anchorWorldPos: [0, 0, 0],
      visible: true, title: 'r', description: '', createdAt: 3,
    });
    store.addObbAnnotation({
      id: 'obb-1', objectIds: ['o3'], obb: sampleObb, labelWorldPos: [0, 0, 1],
      anchor: { kind: 'top_center' }, visible: true, title: 'o', description: '', createdAt: 4,
    });

    expect(store.setAnnotationScreenshot('text', 'text-1', makeScreenshot('att-text-v1'))).toBe(true);
    expect(store.setAnnotationScreenshot('cloud', 'cloud-1', makeScreenshot('att-cloud-v1'))).toBe(true);
    expect(store.setAnnotationScreenshot('rect', 'rect-1', makeScreenshot('att-rect-v1'))).toBe(true);
    expect(store.setAnnotationScreenshot('obb', 'obb-1', makeScreenshot('att-obb-v1'))).toBe(true);

    expect(store.getAnnotationScreenshot('text', 'text-1')?.attachmentId).toBe('att-text-v1');
    expect(store.getAnnotationScreenshot('cloud', 'cloud-1')?.attachmentId).toBe('att-cloud-v1');
    expect(store.getAnnotationScreenshot('rect', 'rect-1')?.attachmentId).toBe('att-rect-v1');
    expect(store.getAnnotationScreenshot('obb', 'obb-1')?.attachmentId).toBe('att-obb-v1');

    expect(store.setAnnotationScreenshot('text', 'text-1', makeScreenshot('att-text-v2'))).toBe(true);
    expect(store.getAnnotationScreenshot('text', 'text-1')?.attachmentId).toBe('att-text-v2');

    expect(store.clearAnnotationScreenshot('text', 'text-1')).toBe(true);
    expect(store.clearAnnotationScreenshot('cloud', 'cloud-1')).toBe(true);
    expect(store.clearAnnotationScreenshot('rect', 'rect-1')).toBe(true);
    expect(store.clearAnnotationScreenshot('obb', 'obb-1')).toBe(true);

    expect(store.getAnnotationScreenshot('text', 'text-1')).toBeNull();
    expect(store.getAnnotationScreenshot('cloud', 'cloud-1')).toBeNull();
    expect(store.getAnnotationScreenshot('rect', 'rect-1')).toBeNull();
    expect(store.getAnnotationScreenshot('obb', 'obb-1')).toBeNull();
  });

  it('截图字段会写入 localStorage，并在重载 store 后恢复', async () => {
    mockUser(null);
    const store = await loadStore();
    store.clearAll();

    store.addAnnotation({
      id: 'text-persist', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: '1', title: 'persist', description: '', createdAt: 1,
    });
    const screenshot = makeScreenshot('att-persist');
    expect(store.setAnnotationScreenshot('text', 'text-persist', screenshot)).toBe(true);

    await nextTick();

    vi.resetModules();
    mockUser(null);
    const restoredStore = await loadStore();
    expect(restoredStore.getAnnotationScreenshot('text', 'text-persist')).toEqual(screenshot);
  });
});
