import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P0-B Phase 1 迁移验证：
 * - 保留 `refno`（向后兼容，@deprecated）
 * - 新增 `refnos?: string[]`，通过 `normalizeAnnotationRecord` 自动双向镜像
 * - 导出 `getAnnotationRefnos` helper，让上游无差别读取 4 类批注的关联 refnos
 */

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

async function loadModule() {
  return import('./useToolStore');
}

describe('useToolStore refno/refnos migration (P0-B Phase 1)', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
    localStorage.clear();
    setSearch('?output_project=refno-migration-test');
  });

  describe('addAnnotation normalizes refno ↔ refnos', () => {
    it('legacy path: only refno provided → refnos derived as single-item array', async () => {
      const { useToolStore } = await loadModule();
      const store = useToolStore();
      store.clearAll();

      store.addAnnotation({
        id: 'a-only-refno',
        entityId: 'e1',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: 'legacy',
        description: '',
        createdAt: 1,
        refno: 'BRAN:1',
      });

      const rec = store.annotations.value.find((a) => a.id === 'a-only-refno');
      expect(rec?.refno).toBe('BRAN:1');
      expect(rec?.refnos).toEqual(['BRAN:1']);
    });

    it('new path: only refnos provided → refno becomes refnos[0]', async () => {
      const { useToolStore } = await loadModule();
      const store = useToolStore();
      store.clearAll();

      store.addAnnotation({
        id: 'a-only-refnos',
        entityId: 'e2',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '2',
        title: 'new',
        description: '',
        createdAt: 2,
        refnos: ['BRAN:2', 'BRAN:3'],
      });

      const rec = store.annotations.value.find((a) => a.id === 'a-only-refnos');
      expect(rec?.refnos).toEqual(['BRAN:2', 'BRAN:3']);
      expect(rec?.refno).toBe('BRAN:2');
    });

    it('both provided: refnos wins, refno is reset to refnos[0]', async () => {
      const { useToolStore } = await loadModule();
      const store = useToolStore();
      store.clearAll();

      store.addAnnotation({
        id: 'a-both',
        entityId: 'e3',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '3',
        title: 'both',
        description: '',
        createdAt: 3,
        refno: 'LEGACY',
        refnos: ['NEW:1', 'NEW:2'],
      });

      const rec = store.annotations.value.find((a) => a.id === 'a-both');
      expect(rec?.refnos).toEqual(['NEW:1', 'NEW:2']);
      // 不一致时应以 refnos 为准，refno 被重写成 refnos[0]，避免下游消费分叉
      expect(rec?.refno).toBe('NEW:1');
    });

    it('neither provided: both stay undefined', async () => {
      const { useToolStore } = await loadModule();
      const store = useToolStore();
      store.clearAll();

      store.addAnnotation({
        id: 'a-none',
        entityId: 'e4',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '4',
        title: 'none',
        description: '',
        createdAt: 4,
      });

      const rec = store.annotations.value.find((a) => a.id === 'a-none');
      expect(rec?.refno).toBeUndefined();
      expect(rec?.refnos).toBeUndefined();
    });

    it('empty strings / empty arrays are treated as unset', async () => {
      const { useToolStore } = await loadModule();
      const store = useToolStore();
      store.clearAll();

      store.addAnnotation({
        id: 'a-empty',
        entityId: 'e5',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '5',
        title: 'empty',
        description: '',
        createdAt: 5,
        refno: '',
        refnos: [],
      });

      const rec = store.annotations.value.find((a) => a.id === 'a-empty');
      expect(rec?.refno).toBeUndefined();
      expect(rec?.refnos).toBeUndefined();
    });
  });

  describe('getAnnotationRefnos helper', () => {
    it('returns refnos for text annotation with refnos set', async () => {
      const { getAnnotationRefnos } = await loadModule();
      expect(getAnnotationRefnos({ refnos: ['A', 'B'] })).toEqual(['A', 'B']);
    });

    it('returns [refno] for text annotation with only refno', async () => {
      const { getAnnotationRefnos } = await loadModule();
      expect(getAnnotationRefnos({ refno: 'X' })).toEqual(['X']);
    });

    it('returns [] when neither is set', async () => {
      const { getAnnotationRefnos } = await loadModule();
      expect(getAnnotationRefnos({})).toEqual([]);
    });

    it('refnos priority over refno when both are set', async () => {
      const { getAnnotationRefnos } = await loadModule();
      expect(getAnnotationRefnos({ refno: 'OLD', refnos: ['NEW'] })).toEqual(['NEW']);
    });

    it('returns a defensive copy (callers cannot mutate internal state)', async () => {
      const { getAnnotationRefnos } = await loadModule();
      const rec = { refnos: ['A', 'B'] };
      const read = getAnnotationRefnos(rec);
      read.push('C');
      expect(rec.refnos).toEqual(['A', 'B']);
    });

    it('works for cloud/rect/obb-shaped records (refnos-only API)', async () => {
      const { getAnnotationRefnos } = await loadModule();
      expect(getAnnotationRefnos({ refnos: ['C1', 'C2'] })).toEqual(['C1', 'C2']);
    });
  });
});
