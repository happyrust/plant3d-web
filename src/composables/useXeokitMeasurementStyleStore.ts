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
import {
  DEFAULT_MEASUREMENT_PICK_LAYER,
  normalizeMeasurementPickLayer,
  type MeasurementPickLayerConfig,
} from '@/measurement/pick/pickLayerModel';
import {
  DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION,
  normalizeMeasurementAngleUnitSelection,
  type MeasurementAngleUnitSelection,
} from '@/measurement/units/measurementAngleUnits';
import {
  DEFAULT_MEASUREMENT_UNIT_SELECTION,
  applyMeasurementUnitSelection,
  normalizeMeasurementUnitSelection,
  type MeasurementDisplayUnit,
  type MeasurementUnitSelection,
  type MeasurementUnitSystem,
} from '@/measurement/units/measurementUnits';

/**
 * 测量取点模式契约：
 * - `e3d`：设计点捕捉心智，P-Point 加载中一律不落点（即使表面点捕捉被手动开启）。
 * - `free_surface`：自由表面测量心智，表面点参与捕捉且不受 P-Point pending 拦截。
 */
export type MeasurementPickMode = 'e3d' | 'free_surface';

/**
 * 角度测量的两个 E3D 入口（`design.uic` `AVEVA.DesignGeneral.MenuMeasure`）：
 * `three-point` = Angle 3 Points（root / first / second），`two-line` = Angle 2 Lines（线 × 线 / 线 × 面）。
 */
export type AngleMeasureVariant = 'three-point' | 'two-line';

export function normalizeAngleMeasureVariant(value: unknown): AngleMeasureVariant {
  return value === 'two-line' ? 'two-line' : 'three-point';
}

/**
 * 距离测量的两档（结果卡 `Distance` 下拉）：`point-to-point` = E3D Measure Distance 的两点距离（缺省），
 * `shortest` = Web 增强「最短距离」——两组几何（点 / 无限线 / 无限面）的真最短距离 + witness（决策 d-619，
 * 不是 E3D parity：E3D 产品里的 Measure Shortest 永远是两拾中点距离，golden MD §32 / §33）。
 */
export type DistanceMeasureVariant = 'point-to-point' | 'shortest';

export function normalizeDistanceMeasureVariant(value: unknown): DistanceMeasureVariant {
  return value === 'shortest' ? 'shortest' : 'point-to-point';
}

/** 每个取点模式记住的用户 snap 偏好（按点源）。 */
export type MeasurementPickModeSnapMemory = Partial<
  Record<MeasurementPickMode, Partial<Record<MeasurementPickSourceId, boolean>>>
>;

export type XeokitMeasurementStyleConfig = {
  distanceKeepDimensions: boolean;
  distanceShowTotalLabel: boolean;
  distanceShowMarkers: boolean;
  distanceShowAxisBreakdown: boolean;
  /**
   * E3D「Show linear dimension」：是否显示两点间的直接斜线尺寸。
   * 它是显示选项，不决定测量结果是否保留。
   */
  showDirectLinearDimension: boolean;
  /**
   * E3D「Perpendicular to」：第二击的点源若带轴向 / 圆面几何，测的是起点到该
   * 无限线 / 无限面的垂距（结果表改为 Distance / Vertical / Horizontal / Direction，
   * 参考系固定 World）；点源无几何时退化为点到点（golden G4）。
   */
  perpendicularTo: boolean;
  /**
   * E3D Design 功能区「Measure」下拉里的两个角度入口：`Angle 3 Points`（三点角，
   * `measureAngle`）与 `Angle 2 Lines`（两线夹角，`measureLineAngleArc`：第一击拾线、
   * 第二击拾线或面，`gmfArc.radius2Lines` 出 ARC，结果表同一张）。Web 用一个开关代替两个按钮。
   */
  angleMeasureVariant: AngleMeasureVariant;
  /** 距离结果卡 `Distance` 下拉：Point to Point（缺省）/ Shortest（Web 增强，d-619）。 */
  distanceMeasureVariant: DistanceMeasureVariant;
  /** Web 扩展：测量完成后是否把临时结果保留为可管理的测量标注。 */
  keepMeasurementAnnotation: boolean;
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
  /**
   * E3D Positioning Control 拾取层：拾取过滤器（Any / Element / Ppoint …）×
   * 拾取类型（Snap / Cursor / Mid-Point / Fraction / Proportion / Distance / Intersect）
   * + Significant Snaps。与点源 show / snap 正交：点源决定候选从哪来，拾取层决定
   * 哪些候选能被拾中、拾中后位置如何派生（方案 2026-09-12 Phase A）。
   */
  measurementPickLayer: MeasurementPickLayerConfig;
  /**
   * E3D Measure Distance 窗体的 Units 框：Unit type（Default / Metric，英制不做见 Q4）
   * × Display Unit，记住上次选的那一档。测量会话级，优先级高于全局单位设置
   * （Default 档才回落到全局，= E3D 的 `!!distanceFmt`）。
   */
  measurementUnits: MeasurementUnitSelection;
  /**
   * E3D Measure Angle 窗体的 Units 框：Unit（Default / Degrees / Radians / Gradians）
   * × Decimal Places（0–8，缺省 2）。同样是测量会话级；小数位同时管角度值与两条 Direction。
   */
  measurementAngleUnits: MeasurementAngleUnitSelection;
};

const STORAGE_KEY_V1 = 'plant3d-web-xeokit-measurement-style-v1';
const STORAGE_KEY_V2 = 'plant3d-web-xeokit-measurement-style-v2';
const STORAGE_KEY_V3 = 'plant3d-web-xeokit-measurement-style-v3';
const STORAGE_KEY_V4 = 'plant3d-web-xeokit-measurement-style-v4';
const STORAGE_KEY_V5 = 'plant3d-web-xeokit-measurement-style-v5';
const STORAGE_KEY_V6 = 'plant3d-web-xeokit-measurement-style-v6';
const STORAGE_KEY_V7 = 'plant3d-web-xeokit-measurement-style-v7';
const STORAGE_KEY_V8 = 'plant3d-web-xeokit-measurement-style-v8';
const STORAGE_KEY_V9 = 'plant3d-web-xeokit-measurement-style-v9';
const DEFAULT_STORAGE_SCOPE = '__default__';

export const DEFAULT_XEOKIT_MEASUREMENT_STYLE: Readonly<XeokitMeasurementStyleConfig> = {
  distanceKeepDimensions: true,
  distanceShowTotalLabel: true,
  distanceShowMarkers: true,
  // 当前 World 笛卡尔坐标下默认显示三个轴向分量。
  distanceShowAxisBreakdown: true,
  showDirectLinearDimension: true,
  perpendicularTo: false,
  angleMeasureVariant: 'three-point',
  distanceMeasureVariant: 'point-to-point',
  keepMeasurementAnnotation: true,
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
  measurementPickLayer: DEFAULT_MEASUREMENT_PICK_LAYER,
  measurementUnits: DEFAULT_MEASUREMENT_UNIT_SELECTION,
  measurementAngleUnits: DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION,
};

function createDefaultMeasurementStyle(): XeokitMeasurementStyleConfig {
  return {
    ...DEFAULT_XEOKIT_MEASUREMENT_STYLE,
    measurementPickSources: cloneMeasurementPickSourceSettings(),
    measurementPickModeSnapMemory: {},
    measurementPickLayer: normalizeMeasurementPickLayer(DEFAULT_MEASUREMENT_PICK_LAYER),
    measurementUnits: { ...DEFAULT_MEASUREMENT_UNIT_SELECTION },
    measurementAngleUnits: { ...DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION },
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
    const rawV9 = localStorage.getItem(withStorageScope(STORAGE_KEY_V9, scope));
    const rawV8 = localStorage.getItem(withStorageScope(STORAGE_KEY_V8, scope));
    const rawV7 = localStorage.getItem(withStorageScope(STORAGE_KEY_V7, scope));
    const persistedV6 = localStorage.getItem(withStorageScope(STORAGE_KEY_V6, scope));
    // V9 只是多了 measurementPickLayer，V8 的字段语义不变。
    const rawV8OrNewer = rawV9 ?? rawV8;
    const rawV6OrNewer = rawV8OrNewer ?? rawV7 ?? persistedV6;
    const rawV5 = localStorage.getItem(withStorageScope(STORAGE_KEY_V5, scope));
    const raw = rawV6OrNewer
      ?? rawV5
      ?? localStorage.getItem(withStorageScope(STORAGE_KEY_V4, scope))
      ?? localStorage.getItem(withStorageScope(STORAGE_KEY_V3, scope))
      ?? localStorage.getItem(withStorageScope(STORAGE_KEY_V2, scope))
      ?? localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return createDefaultMeasurementStyle();

    const parsed = JSON.parse(raw) as Partial<XeokitMeasurementStyleConfig> & {
      /** V7 legacy field; it meant Web retention despite the old E3D label. */
      persistDimension?: boolean;
    };
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
    if (!rawV6OrNewer && !rawV5) {
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
    // V6 迁移：老用户一次性开启 World 轴向分量显示，之后可自行关闭并持久化。
    const distanceShowAxisBreakdown = rawV6OrNewer
      ? parsed.distanceShowAxisBreakdown ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowAxisBreakdown
      : true;
    // V8 把旧字段拆成 E3D 显示选项与 Web 结果保留选项。
    const showDirectLinearDimension = rawV8OrNewer
      ? parsed.showDirectLinearDimension
        ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.showDirectLinearDimension
      : true;
    const keepMeasurementAnnotation = rawV8OrNewer
      ? parsed.keepMeasurementAnnotation
        ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.keepMeasurementAnnotation
      : rawV7
        ? parsed.persistDimension
          ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.keepMeasurementAnnotation
        : true;
    const ptsetSetting = measurementPickSources.ptset;
    return {
      distanceKeepDimensions: parsed.distanceKeepDimensions ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceKeepDimensions,
      distanceShowTotalLabel: parsed.distanceShowTotalLabel ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowTotalLabel,
      distanceShowMarkers: parsed.distanceShowMarkers ?? DEFAULT_XEOKIT_MEASUREMENT_STYLE.distanceShowMarkers,
      distanceShowAxisBreakdown,
      showDirectLinearDimension,
      perpendicularTo: parsed.perpendicularTo === true,
      // 没有这一格就是三点角（E3D 两个按钮里 Web 原本只有这一个）。
      angleMeasureVariant: normalizeAngleMeasureVariant(parsed.angleMeasureVariant),
      // 没有这一格就是两点距离；脏值同样打回（V9 存储键不变，只多一格）。
      distanceMeasureVariant: normalizeDistanceMeasureVariant(parsed.distanceMeasureVariant),
      keepMeasurementAnnotation,
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
      // V8 及更早没有这一格：按 E3D 缺省（Any × Snap，Significant Snaps 开）起步。
      measurementPickLayer: normalizeMeasurementPickLayer(parsed.measurementPickLayer),
      // 同理：没有这一格就停在 Default 档（结果随全局单位设置，与改动前一致）。
      measurementUnits: normalizeMeasurementUnitSelection(parsed.measurementUnits),
      measurementAngleUnits: normalizeMeasurementAngleUnitSelection(parsed.measurementAngleUnits),
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
      localStorage.setItem(withStorageScope(STORAGE_KEY_V9), JSON.stringify(next));
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

/**
 * 改拾取层（过滤器 / 拾取类型 / 类型取值 / Significant Snaps / Pick Settings 的 Pline 端点与
 * Significant Snap Points 三档）。未知 id、不可用项与非法数值一律回 E3D 缺省
 * （`normalizeMeasurementPickLayer`），`values` 与 `significantSnapPoints` 按字段合并。
 */
function updateMeasurementPickLayer(
  patch: Partial<Omit<MeasurementPickLayerConfig, 'values' | 'significantSnapPoints'>> & {
    values?: Partial<MeasurementPickLayerConfig['values']>;
    significantSnapPoints?: Partial<MeasurementPickLayerConfig['significantSnapPoints']>;
  },
): void {
  const current = state.measurementPickLayer;
  const next = normalizeMeasurementPickLayer({
    filter: patch.filter ?? current.filter,
    pickType: patch.pickType ?? current.pickType,
    significantSnaps: patch.significantSnaps ?? current.significantSnaps,
    plineCut: patch.plineCut ?? current.plineCut,
    values: { ...current.values, ...(patch.values ?? {}) },
    significantSnapPoints: { ...current.significantSnapPoints, ...(patch.significantSnapPoints ?? {}) },
  });
  updateStyle({ measurementPickLayer: next });
}

/**
 * 改 Units 框（E3D `changeUnitType` + `selectUnitType`）：换回 Metric 时
 * Display Unit 回到上次选的那一档；Default 档下拉是灰的，此刻送来的 Display Unit 不落库。
 */
function updateMeasurementUnits(
  patch: Readonly<{ unitSystem?: MeasurementUnitSystem; displayUnit?: MeasurementDisplayUnit }>,
): void {
  updateStyle({
    measurementUnits: applyMeasurementUnitSelection(state.measurementUnits, patch),
  });
}

/**
 * 改角度 Units 框（E3D `gphAngleMeasure.setupForm`）：Decimal Places 只收 0–8 的整数，
 * 越界 / 非数字一律打回 2（E3D 那边同时弹 `Value must be between 0 and 8`，由调用方负责提示）。
 */
function updateMeasurementAngleUnits(patch: Partial<MeasurementAngleUnitSelection>): void {
  updateStyle({
    measurementAngleUnits: normalizeMeasurementAngleUnitSelection({
      ...state.measurementAngleUnits,
      ...patch,
    }),
  });
}

function resetStyle(): void {
  Object.assign(state, createDefaultMeasurementStyle());
}

export function useXeokitMeasurementStyleStore() {
  return {
    state,
    updateStyle,
    updateMeasurementPickSource,
    updateMeasurementPickLayer,
    updateMeasurementUnits,
    updateMeasurementAngleUnits,
    setMeasurementPickMode,
    resetStyle,
  };
}
