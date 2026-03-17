import { reactive, watch } from 'vue';

export type XeokitMeasurementStyleConfig = {
  distanceShowTotalLabel: boolean;
  distanceShowMarkers: boolean;
  distanceShowAxisBreakdown: boolean;
  angleShowLabel: boolean;
  angleShowMarkers: boolean;
};

const STORAGE_KEY = 'plant3d-web-xeokit-measurement-style-v1';

export const DEFAULT_XEOKIT_MEASUREMENT_STYLE: Readonly<XeokitMeasurementStyleConfig> = {
  distanceShowTotalLabel: true,
  distanceShowMarkers: true,
  distanceShowAxisBreakdown: false,
  angleShowLabel: true,
  angleShowMarkers: true,
};

function loadPersisted(): XeokitMeasurementStyleConfig {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_XEOKIT_MEASUREMENT_STYLE };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_XEOKIT_MEASUREMENT_STYLE };

    const parsed = JSON.parse(raw) as Partial<XeokitMeasurementStyleConfig>;
    return {
      distanceShowTotalLabel: parsed.distanceShowTotalLabel ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowTotalLabel,
      distanceShowMarkers: parsed.distanceShowMarkers ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowMarkers,
      distanceShowAxisBreakdown: parsed.distanceShowAxisBreakdown ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowAxisBreakdown,
      angleShowLabel: parsed.angleShowLabel ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.angleShowLabel,
      angleShowMarkers: parsed.angleShowMarkers ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.angleShowMarkers,
    };
  } catch {
    return { ...DEFAULT_XEOKIT_MEASUREMENT_STYLE };
  }
}

const state = reactive<XeokitMeasurementStyleConfig>(loadPersisted());

watch(
  () => ({ ...state }),
  (next) => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
  },
  { deep: true },
);

function updateStyle(patch: Partial<XeokitMeasurementStyleConfig>): void {
  Object.assign(state, patch);
}

function resetStyle(): void {
  Object.assign(state, DEFAULT_XEOKIT_MEASUREMENT_STYLE);
}

export function useXeokitMeasurementStyleStore() {
  return {
    state,
    updateStyle,
    resetStyle,
  };
}
