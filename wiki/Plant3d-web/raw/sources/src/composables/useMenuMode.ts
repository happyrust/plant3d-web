import { computed, ref } from 'vue';

export type MenuMode = 'ribbon' | 'hierarchical';

const STORAGE_KEY = 'plant3d-menu-mode';

function loadMenuMode(): MenuMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'ribbon' || raw === 'hierarchical') return raw;
  } catch { /* ignore */ }
  return 'hierarchical';
}

function saveMenuMode(mode: MenuMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* ignore */ }
}

const menuMode = ref<MenuMode>(loadMenuMode());

const isRibbonMode = computed(() => menuMode.value === 'ribbon');
const isHierarchicalMode = computed(() => menuMode.value === 'hierarchical');

function setMenuMode(mode: MenuMode) {
  menuMode.value = mode;
  saveMenuMode(mode);
}

function toggleMenuMode() {
  setMenuMode(menuMode.value === 'ribbon' ? 'hierarchical' : 'ribbon');
}

export function useMenuMode() {
  return {
    menuMode,
    isRibbonMode,
    isHierarchicalMode,
    setMenuMode,
    toggleMenuMode,
  };
}
