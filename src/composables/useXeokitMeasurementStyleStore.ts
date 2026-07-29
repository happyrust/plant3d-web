import { reactive, watch } from 'vue';

import {
  DEFAULT_POSITION_SNAP_PX,
  MEASUREMENT_PICK_SOURCE_IDS,
  cloneMeasurementPickSourceSettings,
  measurementPickSettingsFromLegacy,
  type MeasurementPickSourceId,
  type MeasurementPickSourceSetting,
  type MeasurementPickSourceSettings,
} from './useMeasurementPickSources';

import { DEFAULT_PTSET_SNAP_PX } from '@/composables/usePtsetSnap';
import { getOutputProjectFromUrl } from '@/lib/filesOutput';

/**
 * 测量取点模式契约：
 * - `e3d`：设计点捕捉心智，P-Point 加载中一律不落点（即使表面点捕捉被手动开启）。
 * - `free_surface`：自由表面测量心智，表面点参与捕捉且不受 P-Point pending 拦截。
 */
export type MeasurementPickMode = 'e3d' | 'free_surface';

/** 每个取点模式记住的用户 snap 偏好（按点源）。 */
export type MeasurementPickModeSnapMemory = Partial<
  Record<MeasurementPickMode, Partial<Record<MeasurementPickSourceId, boolean>>>
>;

export type XeokitMeasurementStyleConfig = {
  distanceKeepDimensions: boolean;
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
  /** 测量取点模式（E3D 设计捕捉 / 自由表面测量）。 */
  measurementPickMode: MeasurementPickMode;
  /** 测量点源显示/捕捉配置。 */
  measurementPickSources: MeasurementPickSourceSettings;
  /** 各取点模式记住的 snap 偏好；首次进入某模式才应用该模式默认值。 */
  measurementPickModeSnapMemory: MeasurementPickModeSnapMemory;
};

const STORAGE_KEY_V1 = 'plant3d-web-xeokit-measurement-style-v1';
const STORAGE_KEY_V2 = 'plant3d-web-xeokit-measurement-style-v2';
const STORAGE_KEY_V3 = 'plant3d-web-xeokit-measurement-style-v3';
const STORAGE_KEY_V4 = 'plant3d-web-xeokit-measurement-style-v4';
const STORAGE_KEY_V5 = 'plant3d-web-xeokit-measurement-style-v5';
const STORAGE_KEY_V6 = 'plant3d-web-xeokit-measurement-style-v6';
const DEFAULT_STORAGE_SCOPE = '__default__';

export const DEFAULT_XEOKIT_MEASUREMENT_STYLE: Readonly<XeokitMeasurementStyleConfig> = {
  distanceKeepDimensions: true,
  distanceShowTotalLabel: true,
  distanceShowMarkers: true,
  // E3D 默认体验：距离结果默认显示 E/N/U 轴向分量。
  distanceShowAxisBreakdown: true,
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
  measurementPickMode: 'e3d',
  measurementPickSources: cloneMeasurementPickSourceSettings(),
  measurementPickModeSnapMemory: {},
};

function createDefaultMeasurementStyle(): XeokitMeasurementStyleConfig {
  return {
    ...DEFAULT_XEOKIT_MEASUREMENT_STYLE,
    measurementPickSources: cloneMeasurementPickSourceSettings(),
    measurementPickModeSnapMemory: {},
  };
}

function cloneSnapMemory(input: unknown): MeasurementPickModeSnapMemory {
  if (!input || typeof input !== 'object') return {};
  const out: MeasurementPickModeSnapMemory = {};
  for (const mode of ['e3d', 'free_surface'] as const) {
    const entry = (input as Record<string, unknown>)[mode];
    if (!entry || typeof entry !== 'object') continue;
    const snapBySource: Partial<Record<MeasurementPickSourceId, boolean>> = {};
    for (const [source, snap] of Object.entries(entry)) {
      if (typeof snap === 'boolean') {
        snapBySource[source as MeasurementPickSourceId] = snap;
      }
    }
    out[mode] = snapBySource;
  }
  return out;
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
    const rawV6 = localStorage.getItem(withStorageScope(STORAGE_KEY_V6, scope));
    const rawV5 = localStorage.getItem(withStorageScope(STORAGE_KEY_V5, scope));
    const raw = rawV6
      ?? rawV5
      ?? localStorage.getItem(withStorageScope(STORAGE_KEY_V4, scope))
      ?? localStorage.getItem(withStorageScope(STORAGE_KEY_V3, scope))
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
    if (!rawV6 && !rawV5) {
      measurementPickSources.position = {
        ...measurementPickSources.position,
        show: true,
        snap: true,
        thresholdPx: Math.max(
          measurementPickSources.position.thresholdPx,
          DEFAULT_POSITION_SNAP_PX,
        ),
      };
    }
    // V6 迁移：老用户一次性切到 E3D 默认的轴向分量显示，之后可自行关闭并持久化。
    const distanceShowAxisBreakdown = rawV6
      ? parsed.distanceShowAxisBreakdown ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowAxisBreakdown
      : true;
    const ptsetSetting = measurementPickSources.ptset;
    return {
      distanceKeepDimensions: parsed.distanceKeepDimensions ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceKeepDimensions,
      distanceShowTotalLabel: parsed.distanceShowTotalLabel ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowTotalLabel,
      distanceShowMarkers: parsed.distanceShowMarkers ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowMarkers,
      distanceShowAxisBreakdown,
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
      measurementPickMode: parsed.measurementPickMode === 'free_surface' ? 'free_surface' : 'e3d',
      measurementPickSources,
      measurementPickModeSnapMemory: cloneSnapMemory(parsed.measurementPickModeSnapMemory),
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
      localStorage.setItem(withStorageScope(STORAGE_KEY_V6), JSON.stringify(next));
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

  // 模式与 snap 配置可以自由组合：关闭表面点捕捉不再静默切换模式
  // （隐式状态变更会让浮动条按钮"自己跳变"，见 r3 评审 §1 #3）。
  Object.assign(state, next);
}

/** 模式默认 snap 契约（仅首次进入该模式、无记忆时应用）。 */
function applyModeDefaultSnap(
  mode: MeasurementPickMode,
  sources: MeasurementPickSourceSettings,
): void {
  if (mode === 'e3d') {
    sources.ptset = { ...sources.ptset, snap: true };
    sources.position = { ...sources.position, snap: true };
    sources.mesh_pick_point = { ...sources.mesh_pick_point, snap: false };
    return;
  }
  sources.mesh_pick_point = { ...sources.mesh_pick_point, show: true, snap: true };
}

/**
 * 切换测量取点模式：记住当前模式的 snap 偏好；目标模式有记忆则恢复记忆，
 * 首次进入才应用该模式的默认契约（模式=默认策略，而非强制覆盖用户配置）。
 */
function setMeasurementPickMode(mode: MeasurementPickMode): void {
  const previousMode = state.measurementPickMode;
  if (mode === previousMode) return;
  const sources = cloneMeasurementPickSourceSettings(state.measurementPickSources);
  const memory: MeasurementPickModeSnapMemory = {
    ...state.measurementPickModeSnapMemory,
    [previousMode]: Object.fromEntries(
      MEASUREMENT_PICK_SOURCE_IDS.map((id) => [id, sources[id].snap]),
    ),
  };

  const remembered = memory[mode];
  if (remembered) {
    for (const id of MEASUREMENT_PICK_SOURCE_IDS) {
      const snap = remembered[id];
      if (typeof snap === 'boolean') {
        sources[id] = { ...sources[id], snap };
      }
    }
    if (mode === 'free_surface' && sources.mesh_pick_point.snap) {
      sources.mesh_pick_point = { ...sources.mesh_pick_point, show: true };
    }
  } else {
    applyModeDefaultSnap(mode, sources);
  }

  updateStyle({
    measurementPickMode: mode,
    measurementPickSources: sources,
    measurementPickModeSnapMemory: memory,
  });
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
    setMeasurementPickMode,
    resetStyle,
  };
}
