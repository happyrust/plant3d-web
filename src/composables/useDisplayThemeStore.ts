import { computed, ref } from 'vue';

export type DisplayTheme = 'default' | 'design3d';

const STORAGE_KEY = 'viewer_display_theme';

function loadPersistedTheme(): DisplayTheme {
  if (typeof window === 'undefined' || !window.localStorage) return 'default';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === 'design3d') return 'design3d';
  return 'default';
}

const currentTheme = ref<DisplayTheme>(loadPersistedTheme());

export function useDisplayThemeStore() {
  const isDesign3dTheme = computed(() => currentTheme.value === 'design3d');

  function setDisplayTheme(theme: DisplayTheme) {
    currentTheme.value = theme;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  }

  return {
    currentTheme,
    isDesign3dTheme,
    setDisplayTheme,
  };
}
