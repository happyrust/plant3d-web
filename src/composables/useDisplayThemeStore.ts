import { computed, ref } from 'vue';

export type DisplayTheme = 'default' | 'design3d' | 'e3d';

// v2：引入 e3d 主题并作为默认值。旧键（viewer_display_theme）曾在读取时被强制
// 归一化为 design3d，无法代表用户的真实选择，因此换键让所有会话迁移到 e3d。
const STORAGE_KEY = 'viewer_display_theme_v2';
const DEFAULT_THEME: DisplayTheme = 'e3d';

function isDisplayTheme(value: string | null): value is DisplayTheme {
  return value === 'default' || value === 'design3d' || value === 'e3d';
}

function loadPersistedTheme(): DisplayTheme {
  if (typeof window === 'undefined' || !window.localStorage || typeof window.localStorage.getItem !== 'function') {
    return DEFAULT_THEME;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (isDisplayTheme(raw)) return raw;
  return DEFAULT_THEME;
}

const currentTheme = ref<DisplayTheme>(loadPersistedTheme());

export function useDisplayThemeStore() {
  const isDesign3dTheme = computed(() => currentTheme.value === 'design3d');
  const isE3dTheme = computed(() => currentTheme.value === 'e3d');

  function setDisplayTheme(theme: DisplayTheme) {
    currentTheme.value = theme;
    if (
      typeof window !== 'undefined'
      && window.localStorage
      && typeof window.localStorage.setItem === 'function'
    ) {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  }

  return {
    currentTheme,
    isDesign3dTheme,
    isE3dTheme,
    setDisplayTheme,
  };
}
