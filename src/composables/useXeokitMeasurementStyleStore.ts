import { reactive, watch } from 'vue';

import { getOutputProjectFromUrl } from '@/lib/filesOutput';
import { DEFAULT_PTSET_SNAP_PX } from '@/composables/usePtsetSnap';

export type XeokitMeasurementStyleConfig = {
  distanceShowTotalLabel: boolean;
  distanceShowMarkers: boolean;
  distanceShowAxisBreakdown: boolean;
  angleShowLabel: boolean;
  angleShowMarkers: boolean;
  elevationDatum: number;
  elevationPointShowAbsoluteLabel: boolean;
  elevationPointShowRelativeLabel: boolean;
  elevationPointShowMarker: boolean;
  elevationPointShowLeader: boolean;
  elevationDeltaShowEndpointLabels: boolean;
  elevationDeltaShowDeltaLabel: boolean;
  elevationDeltaShowVerticalGuide: boolean;
  elevationDeltaShowMarkers: boolean;
  /** 测量时是否启用关键点(ptset)捕捉。 */
  keypointSnapEnabled: boolean;
  /** 关键点捕捉的屏幕像素阈值。 */
  keypointSnapPx: number;
};

const STORAGE_KEY_V1 = 'plant3d-web-xeokit-measurement-style-v1';
const STORAGE_KEY_V2 = 'plant3d-web-xeokit-measurement-style-v2';
const DEFAULT_STORAGE_SCOPE = '__default__';

export const DEFAULT_XEOKIT_MEASUREMENT_STYLE: Readonly<XeokitMeasurementStyleConfig> = {
  distanceShowTotalLabel: true,
  distanceShowMarkers: true,
  distanceShowAxisBreakdown: false,
  angleShowLabel: true,
  angleShowMarkers: true,
  elevationDatum: 0,
  elevationPointShowAbsoluteLabel: true,
  elevationPointShowRelativeLabel: true,
  elevationPointShowMarker: true,
  elevationPointShowLeader: true,
  elevationDeltaShowEndpointLabels: true,
  elevationDeltaShowDeltaLabel: true,
  elevationDeltaShowVerticalGuide: true,
  elevationDeltaShowMarkers: true,
  keypointSnapEnabled: true,
  keypointSnapPx: DEFAULT_PTSET_SNAP_PX,
};

function getCurrentStorageScope(): string {
  if (typeof window === 'undefined') return DEFAULT_STORAGE_SCOPE;
  try {
    const params = new URLSearchParams(window.location.search);
    const project = getOutputProjectFromUrl() || params.get('project_id') || DEFAULT_STORAGE_SCOPE;
    const dbnum = params.get('show_dbnum') || '__all__';
    return `project=${project}|db=${dbnum}`;
  } catch {
    return DEFAULT_STORAGE_SCOPE;
  }
}

function withStorageScope(storageKey: string, scope = getCurrentStorageScope()): string {
  return `${storageKey}:${scope}`;
}

function loadPersisted(scope = getCurrentStorageScope()): XeokitMeasurementStyleConfig {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_XEOKIT_MEASUREMENT_STYLE };
  }

  try {
    const raw = localStorage.getItem(withStorageScope(STORAGE_KEY_V2, scope))
      ?? localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return { ...DEFAULT_XEOKIT_MEASUREMENT_STYLE };

    const parsed = JSON.parse(raw) as Partial<XeokitMeasurementStyleConfig>;
    return {
      distanceShowTotalLabel: parsed.distanceShowTotalLabel ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowTotalLabel,
      distanceShowMarkers: parsed.distanceShowMarkers ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowMarkers,
      distanceShowAxisBreakdown: parsed.distanceShowAxisBreakdown ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowAxisBreakdown,
      angleShowLabel: parsed.angleShowLabel ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.angleShowLabel,
      angleShowMarkers: parsed.angleShowMarkers ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.angleShowMarkers,
      elevationDatum: Number.isFinite(parsed.elevationDatum) ? Number(parsed.elevationDatum) : DEFAULT_XEOKIT_MEASUREMENT_STYLE.elevationDatum,
      elevationPointShowAbsoluteLabel: parsed.elevationPointShowAbsoluteLabel ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.elevationPointShowAbsoluteLabel,
      elevationPointShowRelativeLabel: parsed.elevationPointShowRelativeLabel ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.elevationPointShowRelativeLabel,
      elevationPointShowMarker: parsed.elevationPointShowMarker ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.elevationPointShowMarker,
      elevationPointShowLeader: parsed.elevationPointShowLeader ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.elevationPointShowLeader,
      elevationDeltaShowEndpointLabels: parsed.elevationDeltaShowEndpointLabels ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.elevationDeltaShowEndpointLabels,
      elevationDeltaShowDeltaLabel: parsed.elevationDeltaShowDeltaLabel ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.elevationDeltaShowDeltaLabel,
      elevationDeltaShowVerticalGuide: parsed.elevationDeltaShowVerticalGuide ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.elevationDeltaShowVerticalGuide,
      elevationDeltaShowMarkers: parsed.elevationDeltaShowMarkers ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.elevationDeltaShowMarkers,
      keypointSnapEnabled: parsed.keypointSnapEnabled ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.keypointSnapEnabled,
      keypointSnapPx: Number.isFinite(parsed.keypointSnapPx) ? Number(parsed.keypointSnapPx) : DEFAULT_XEOKIT_MEASUREMENT_STYLE.keypointSnapPx,
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
      localStorage.setItem(withStorageScope(STORAGE_KEY_V2), JSON.stringify(next));
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
