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

describe('useDisplayThemeStore', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('无持久化值时默认使用 design3d', async () => {
    const { useDisplayThemeStore } = await import('./useDisplayThemeStore');

    const store = useDisplayThemeStore();

    expect(store.currentTheme.value).toBe('design3d');
  });

  it('历史 default 持久化值会自动迁移到 design3d', async () => {
    localStorage.setItem('viewer_display_theme', 'default');

    const { useDisplayThemeStore } = await import('./useDisplayThemeStore');

    const store = useDisplayThemeStore();

    expect(store.currentTheme.value).toBe('design3d');
  });

  it('已保存的 design3d 持久化值保持不变', async () => {
    localStorage.setItem('viewer_display_theme', 'design3d');

    const { useDisplayThemeStore } = await import('./useDisplayThemeStore');

    const store = useDisplayThemeStore();

    expect(store.currentTheme.value).toBe('design3d');
  });
});
