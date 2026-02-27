import { ref, readonly } from 'vue'
import {
  BACKGROUND_PRESETS,
  type BackgroundMode,
  type BackgroundPreset,
} from '@/viewer/dtx/DtxViewer'

const STORAGE_KEY = 'viewer_background_mode'

const currentMode = ref<BackgroundMode>(loadFromStorage())

function loadFromStorage(): BackgroundMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && BACKGROUND_PRESETS.some((p) => p.mode === raw)) {
      return raw as BackgroundMode
    }
  } catch {
    // ignore
  }
  return 'gradient_solidworks'
}

function saveToStorage(mode: BackgroundMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

export function getPreset(mode: BackgroundMode): BackgroundPreset {
  return BACKGROUND_PRESETS.find((p) => p.mode === mode) ?? BACKGROUND_PRESETS[0]
}

export function useBackgroundStore() {
  function setMode(mode: BackgroundMode): void {
    currentMode.value = mode
    saveToStorage(mode)
  }

  return {
    mode: readonly(currentMode),
    presets: BACKGROUND_PRESETS,
    setMode,
    getPreset,
  }
}
