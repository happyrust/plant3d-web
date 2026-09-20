import { computed, ref } from 'vue';

/**
 * - `e3d`：web 自定的「E3D 风格」专业配色（类型基色 + 专业着色 + 重点构件强调）
 * - `e3dFactory`：出厂 E3D 3.1 的真实口径——autocolour 关、所有元素 lightgrey #bdbdbd（配 E3D 外观用，
 *   见 docs/rendering/e3d-sgl-look-prototype.md §2）
 */
export type DisplayTheme = 'default' | 'design3d' | 'e3d' | 'e3dFactory';

export const DISPLAY_THEMES: readonly DisplayTheme[] = Object.freeze(['default', 'design3d', 'e3d', 'e3dFactory']);

// v2：引入 e3d 主题并作为默认值。旧键（viewer_display_theme）曾在读取时被强制
// 归一化为 design3d，无法代表用户的真实选择，因此换键让所有会话迁移到 e3d。
const STORAGE_KEY = 'viewer_display_theme_v2';
const DEFAULT_THEME: DisplayTheme = 'e3d';

export function isDisplayTheme(value: unknown): value is DisplayTheme {
  return typeof value === 'string' && (DISPLAY_THEMES as readonly string[]).includes(value);
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
