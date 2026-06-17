import { reactive, watch } from 'vue';

import {
  cloneMeasurementPickSourceSettings,
  measurementPickSettingsFromLegacy,
  type MeasurementPickSourceId,
  type MeasurementPickSourceSetting,
  type MeasurementPickSourceSettings,
} from './useMeasurementPickSources';

import { DEFAULT_PTSET_SNAP_PX } from '@/composables/usePtsetSnap';
import { getOutputProjectFromUrl } from '@/lib/filesOutput';

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
  /** 测量点源显示/捕捉配置。 */
  measurementPickSources: MeasurementPickSourceSettings;
};

const STORAGE_KEY_V1 = 'plant3d-web-xeokit-measurement-style-v1';
const STORAGE_KEY_V2 = 'plant3d-web-xeokit-measurement-style-v2';
const STORAGE_KEY_V3 = 'plant3d-web-xeokit-measurement-style-v3';
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
  keypointSnapEnabled: false,
  keypointSnapPx: DEFAULT_PTSET_SNAP_PX,
  measurementPickSources: cloneMeasurementPickSourceSettings(),
};

function createDefaultMeasurementStyle(): XeokitMeasurementStyleConfig {
  return {
    ...DEFAULT_XEOKIT_MEASUREMENT_STYLE,
    measurementPickSources: cloneMeasurementPickSourceSettings(),
  };
}

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
    return createDefaultMeasurementStyle();
  }

  try {
    const raw = localStorage.getItem(withStorageScope(STORAGE_KEY_V3, scope))
      ?? localStorage.getItem(withStorageScope(STORAGE_KEY_V2, scope))
      ?? localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return createDefaultMeasurementStyle();

    const parsed = JSON.parse(raw) as Partial<XeokitMeasurementStyleConfig>;
    const legacySnapEnabled = parsed.keypointSnapEnabled ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.keypointSnapEnabled;
    const legacySnapPx = Number.isFinite(parsed.keypointSnapPx)
      ? Number(parsed.keypointSnapPx)
      : DEFAULT_XEOKIT_MEASUREMENT_STYLE.keypointSnapPx;
    const measurementPickSources = parsed.measurementPickSources
      ? cloneMeasurementPickSourceSettings(parsed.measurementPickSources)
      : measurementPickSettingsFromLegacy({
        keypointSnapEnabled: legacySnapEnabled,
        keypointSnapPx: legacySnapPx,
      });
    const ptsetSetting = measurementPickSources.ptset;
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
      keypointSnapEnabled: ptsetSetting.snap,
      keypointSnapPx: ptsetSetting.thresholdPx,
      measurementPickSources,
    };
  } catch {
    return createDefaultMeasurementStyle();
  }
}

const state = reactive<XeokitMeasurementStyleConfig>(loadPersisted());

watch(
  () => ({ ...state }),
  (next) => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(withStorageScope(STORAGE_KEY_V3), JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
  },
  { deep: true },
);

function updateStyle(patch: Partial<XeokitMeasurementStyleConfig>): void {
  const next = { ...patch };

  if (patch.measurementPickSources) {
    next.measurementPickSources = cloneMeasurementPickSourceSettings(patch.measurementPickSources);
    next.keypointSnapEnabled = next.measurementPickSources.ptset.snap;
    next.keypointSnapPx = next.measurementPickSources.ptset.thresholdPx;
  }

  if (patch.keypointSnapEnabled !== undefined || patch.keypointSnapPx !== undefined) {
    const ptsetEnabled = patch.keypointSnapEnabled ?? state.keypointSnapEnabled;
    const ptsetPx = patch.keypointSnapPx ?? state.keypointSnapPx;
    next.measurementPickSources = cloneMeasurementPickSourceSettings({
      ...state.measurementPickSources,
      ptset: {
        ...state.measurementPickSources.ptset,
        snap: ptsetEnabled,
        thresholdPx: ptsetPx,
      },
    });
    next.keypointSnapEnabled = ptsetEnabled;
    next.keypointSnapPx = next.measurementPickSources.ptset.thresholdPx;
  }

  Object.assign(state, next);
}

function updateMeasurementPickSource(
  source: MeasurementPickSourceId,
  patch: Partial<MeasurementPickSourceSetting>,
): void {
  const next = cloneMeasurementPickSourceSettings({
    ...state.measurementPickSources,
    [source]: {
      ...state.measurementPickSources[source],
      ...patch,
    },
  });
  updateStyle({ measurementPickSources: next });
}

function resetStyle(): void {
  Object.assign(state, createDefaultMeasurementStyle());
}

export function useXeokitMeasurementStyleStore() {
  return {
    state,
    updateStyle,
    updateMeasurementPickSource,
    resetStyle,
  };
}
