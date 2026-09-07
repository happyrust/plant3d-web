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

  it('无持久化值时默认使用 e3d', async () => {
    const { useDisplayThemeStore } = await import('./useDisplayThemeStore');

    const store = useDisplayThemeStore();

    expect(store.currentTheme.value).toBe('e3d');
  });

  it('旧版 v1 键（曾被强制归一化为 design3d）不再生效，迁移到 e3d', async () => {
    localStorage.setItem('viewer_display_theme', 'design3d');

    const { useDisplayThemeStore } = await import('./useDisplayThemeStore');

    const store = useDisplayThemeStore();

    expect(store.currentTheme.value).toBe('e3d');
  });

  it('v2 键保存的 design3d 持久化值保持不变', async () => {
    localStorage.setItem('viewer_display_theme_v2', 'design3d');

    const { useDisplayThemeStore } = await import('./useDisplayThemeStore');

    const store = useDisplayThemeStore();

    expect(store.currentTheme.value).toBe('design3d');
  });

  it('setDisplayTheme 持久化到 v2 键并可回读', async () => {
    const { useDisplayThemeStore } = await import('./useDisplayThemeStore');

    const store = useDisplayThemeStore();
    store.setDisplayTheme('e3d');

    expect(localStorage.getItem('viewer_display_theme_v2')).toBe('e3d');
    expect(store.currentTheme.value).toBe('e3d');
  });
});
