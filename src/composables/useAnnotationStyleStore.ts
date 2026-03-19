import { reactive, watch } from 'vue';

export type AnnotationLeaderStyleConfig = {
  color: number
  haloColor: number
  lineWidth: number
  haloLineWidth: number
  opacity: number
  haloOpacity: number
}

export type AnnotationStyleConfig = {
  text: AnnotationLeaderStyleConfig
  cloud: AnnotationLeaderStyleConfig
  rect: AnnotationLeaderStyleConfig
  obb: AnnotationLeaderStyleConfig
}

export type AnnotationStylePreset = 'soft' | 'clear' | 'bold';

const STORAGE_KEY = 'plant3d-web-annotation-style-v1';

export const DEFAULT_ANNOTATION_STYLE: Readonly<AnnotationStyleConfig> = {
  text: {
    color: 0xef4444,
    haloColor: 0xfecaca,
    lineWidth: 4.75,
    haloLineWidth: 8.5,
    opacity: 0.96,
    haloOpacity: 0.52,
  },
  cloud: {
    color: 0xef4444,
    haloColor: 0xfecaca,
    lineWidth: 4.75,
    haloLineWidth: 8.5,
    opacity: 0.96,
    haloOpacity: 0.52,
  },
  rect: {
    color: 0x0f172a,
    haloColor: 0xcbd5e1,
    lineWidth: 4.75,
    haloLineWidth: 8.5,
    opacity: 0.95,
    haloOpacity: 0.48,
  },
  obb: {
    color: 0x14b8a6,
    haloColor: 0x99f6e4,
    lineWidth: 4.75,
    haloLineWidth: 8.5,
    opacity: 0.95,
    haloOpacity: 0.5,
  },
};

const ANNOTATION_STYLE_PRESETS: Record<AnnotationStylePreset, AnnotationStyleConfig> = {
  soft: {
    text: { color: 0xef4444, haloColor: 0xfee2e2, lineWidth: 4.2, haloLineWidth: 6.8, opacity: 0.93, haloOpacity: 0.36 },
    cloud: { color: 0xef4444, haloColor: 0xfee2e2, lineWidth: 4.2, haloLineWidth: 6.8, opacity: 0.93, haloOpacity: 0.36 },
    rect: { color: 0x0f172a, haloColor: 0xe2e8f0, lineWidth: 4.2, haloLineWidth: 6.8, opacity: 0.92, haloOpacity: 0.3 },
    obb: { color: 0x14b8a6, haloColor: 0xccfbf1, lineWidth: 4.2, haloLineWidth: 6.8, opacity: 0.92, haloOpacity: 0.34 },
  },
  clear: {
    text: { ...DEFAULT_ANNOTATION_STYLE.text },
    cloud: { ...DEFAULT_ANNOTATION_STYLE.cloud },
    rect: { ...DEFAULT_ANNOTATION_STYLE.rect },
    obb: { ...DEFAULT_ANNOTATION_STYLE.obb },
  },
  bold: {
    text: { color: 0xdc2626, haloColor: 0xfecaca, lineWidth: 6.8, haloLineWidth: 11.5, opacity: 1, haloOpacity: 0.6 },
    cloud: { color: 0xdc2626, haloColor: 0xfecaca, lineWidth: 6.8, haloLineWidth: 11.5, opacity: 1, haloOpacity: 0.6 },
    rect: { color: 0x020617, haloColor: 0xcbd5e1, lineWidth: 6.8, haloLineWidth: 11.5, opacity: 1, haloOpacity: 0.5 },
    obb: { color: 0x0f766e, haloColor: 0x99f6e4, lineWidth: 6.8, haloLineWidth: 11.5, opacity: 1, haloOpacity: 0.56 },
  },
};

function loadPersisted(): AnnotationStyleConfig {
  if (typeof localStorage === 'undefined') {
    return {
      text: { ...DEFAULT_ANNOTATION_STYLE.text },
      cloud: { ...DEFAULT_ANNOTATION_STYLE.cloud },
      rect: { ...DEFAULT_ANNOTATION_STYLE.rect },
      obb: { ...DEFAULT_ANNOTATION_STYLE.obb },
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        text: { ...DEFAULT_ANNOTATION_STYLE.text },
        cloud: { ...DEFAULT_ANNOTATION_STYLE.cloud },
        rect: { ...DEFAULT_ANNOTATION_STYLE.rect },
        obb: { ...DEFAULT_ANNOTATION_STYLE.obb },
      };
    }

    const parsed = JSON.parse(raw) as Partial<AnnotationStyleConfig>;
    return {
      text: { ...DEFAULT_ANNOTATION_STYLE.text, ...(parsed.text ?? {}) },
      cloud: { ...DEFAULT_ANNOTATION_STYLE.cloud, ...(parsed.cloud ?? {}) },
      rect: { ...DEFAULT_ANNOTATION_STYLE.rect, ...(parsed.rect ?? {}) },
      obb: { ...DEFAULT_ANNOTATION_STYLE.obb, ...(parsed.obb ?? {}) },
    };
  } catch {
    return {
      text: { ...DEFAULT_ANNOTATION_STYLE.text },
      cloud: { ...DEFAULT_ANNOTATION_STYLE.cloud },
      rect: { ...DEFAULT_ANNOTATION_STYLE.rect },
      obb: { ...DEFAULT_ANNOTATION_STYLE.obb },
    };
  }
}

function persistStyle(style: AnnotationStyleConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
  } catch {
    // ignore storage failures so runtime usage and tests stay resilient
  }
}

const state = reactive<AnnotationStyleConfig>(loadPersisted());

watch(
  () => ({
    text: { ...state.text },
    cloud: { ...state.cloud },
    rect: { ...state.rect },
    obb: { ...state.obb },
  }),
  (val) => {
    persistStyle(val);
  },
  { deep: true },
);

export function useAnnotationStyleStore() {
  function resetToDefaults(kind?: keyof AnnotationStyleConfig) {
    if (kind) {
      Object.assign(state[kind], DEFAULT_ANNOTATION_STYLE[kind]);
      persistStyle(state);
      return;
    }
    Object.assign(state.text, DEFAULT_ANNOTATION_STYLE.text);
    Object.assign(state.cloud, DEFAULT_ANNOTATION_STYLE.cloud);
    Object.assign(state.rect, DEFAULT_ANNOTATION_STYLE.rect);
    Object.assign(state.obb, DEFAULT_ANNOTATION_STYLE.obb);
    persistStyle(state);
  }

  function updateStyle(kind: keyof AnnotationStyleConfig, partial: Partial<AnnotationLeaderStyleConfig>) {
    Object.assign(state[kind], partial);
    persistStyle(state);
  }

  function applyPreset(preset: AnnotationStylePreset) {
    const next = ANNOTATION_STYLE_PRESETS[preset];
    Object.assign(state.text, next.text);
    Object.assign(state.cloud, next.cloud);
    Object.assign(state.rect, next.rect);
    Object.assign(state.obb, next.obb);
    persistStyle(state);
  }

  return {
    style: state,
    resetToDefaults,
    updateStyle,
    applyPreset,
  };
}
