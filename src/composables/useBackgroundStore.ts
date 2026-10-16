import { ref, readonly } from 'vue';

import {
  BACKGROUND_PRESETS,
  type BackgroundMode,
  type BackgroundPreset,
} from '@/viewer/dtx/DtxViewer';

const STORAGE_KEY = 'viewer_background_mode';

const currentMode = ref<BackgroundMode>(loadFromStorage());

function loadFromStorage(): BackgroundMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && BACKGROUND_PRESETS.some((p) => p.mode === raw)) {
      return raw as BackgroundMode;
    }
  } catch {
    // ignore
  }
  return 'gradient_engineering_gray';
}

function saveToStorage(mode: BackgroundMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function getPreset(mode: BackgroundMode): BackgroundPreset {
  return BACKGROUND_PRESETS.find((p) => p.mode === mode) ?? BACKGROUND_PRESETS[0];
}

/** 用户是否曾显式选过背景（有持久化值）；绘制样式预设据此决定是否套用默认背景 */
export function hasPersistedBackgroundMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function useBackgroundStore() {
  function setMode(mode: BackgroundMode): void {
    currentMode.value = mode;
    saveToStorage(mode);
  }

  return {
    mode: readonly(currentMode),
    presets: BACKGROUND_PRESETS,
    setMode,
    getPreset,
  };
}
