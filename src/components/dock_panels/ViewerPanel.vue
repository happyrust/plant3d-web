<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import {
  Aperture,
  Eye,
  EyeClosed,
  EyeOff,
  Focus,
  House,
  Ruler,
  ScanEye,
  Search,
  Settings,
  Waypoints,
  X,
} from 'lucide-vue-next';
import {
  Box3,
  Color,
  Matrix4,
  Vector2,
  Vector3,
} from 'three';

import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';
import {
  reviewRecordCreate,
  reviewRecordGetByTaskId,
  type ReviewSnapshotAnnotationPayload,
  type ReviewSnapshotMeasurementPayload,
} from '@/api/reviewApi';
import { useClearanceDimensionSync } from '@/clearance/composables/useClearanceDimensionSync';
import { useComponentToWallClearance } from '@/clearance/composables/useComponentToWallClearance';
import { type ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import { resolveViewerToolbarSelection } from '@/components/dock_panels/viewerToolbarSelection';
import PipeDistanceDrawer from '@/components/pipe-distance/PipeDistanceDrawer.vue';
import ReviewConfirmation from '@/components/review/ReviewConfirmation.vue';
import { buildReviewConfirmSnapshotPayload } from '@/components/review/reviewPanelActions';
import SpatialQueryDrawer from '@/components/spatial-query/SpatialQueryDrawer.vue';
import AnnotationOverlayBar from '@/components/tools/AnnotationOverlayBar.vue';
import MeasurementContextMenu from '@/components/tools/MeasurementContextMenu.vue';
import MeasurementOverlayBar from '@/components/tools/MeasurementOverlayBar.vue';
import MeasurementWizard from '@/components/tools/MeasurementWizard.vue';
import ObjectMeasureDrawer from '@/components/tools/ObjectMeasureDrawer.vue';
import { useAnnotationThree } from '@/composables/useAnnotationThree';
import { useBackgroundStore } from '@/composables/useBackgroundStore';
import { useConsoleStore } from '@/composables/useConsoleStore';
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo';
import {
  loadDbnoInstancesForVisibleRefnosDtx,
  applyMaterialConfigToLoadedDtx,
  resolveDtxNounByRefno,
  resolveDtxObjectIdsByRefno,
  resolveDtxObjectIdsByUnitRefno,
  resolveDtxRefnoByObjectId,
} from '@/composables/useDbnoInstancesDtxLoader';
import { useDisplayThemeStore, type DisplayTheme } from '@/composables/useDisplayThemeStore';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useDtxTools } from '@/composables/useDtxTools';
import { MeasurementAnnotationManager } from '@/composables/useMeasurementAnnotation';
import { useModelGeneration } from '@/composables/useModelGeneration';
import { useModelLoadStatus } from '@/composables/useModelLoadStatus';
import { collectPtsetEntries } from '@/composables/usePtsetVisualizationEntries';
import { usePtsetVisualizationThree } from '@/composables/usePtsetVisualizationThree';
import { useReviewStore } from '@/composables/useReviewStore';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useSpatialCompute } from '@/composables/useSpatialCompute';
import { initializeSpatialQueryFromUrl, useSpatialQuery } from '@/composables/useSpatialQuery';
import { useToolStore } from '@/composables/useToolStore';
import { useUnitSettingsStore, type LengthUnit } from '@/composables/useUnitSettingsStore';
import { useUserStore } from '@/composables/useUserStore';
import { applyLoadedModelHighlight, useViewerContext } from '@/composables/useViewerContext';
import { useXeokitMeasurementStyleStore } from '@/composables/useXeokitMeasurementStyleStore';
import {
  DIMENSION_XEOKIT_PREFIX,
  useXeokitMeasurementTools,
} from '@/composables/useXeokitMeasurementTools';
import {
  branClearanceToExternalDimensions,
  canEditUserDimension,
  createAngularEditSession,
  createDimensionSystem,
  createDtxDimensionViewerAdapter,
  createEmptyDimensionDocument,
  createLinearEditSession,
  createPlacementEditSession,
  createProjectedEditSession,
  createRadialEditSession,
  DtxDimensionAnchorResolver,
  DtxDimensionSnapPort,
  loadArchivedDimensionArchives,
  localDimensionDocumentId,
  LocalStorageDimensionCommandJournal,
  LocalStorageDimensionDocumentRepository,
  migrateLegacyDimensionArchives,
  ReviewDimensionRepository,
  type DimensionDocumentState,
  type DimensionSystem,
} from '@/dimension';
import { getOutputProjectFromUrl } from '@/lib/currentProject';
import { getModelSource } from '@/model-source';
import { onCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';
import {
  applyModelUnitRefnoVisibility,
  applyModelUnitVersionSide,
  collectModelUnitTargetObjectIds,
  DEFAULT_MODEL_UNIT_COMPARE_SIDE,
  DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
  getModelUnitCompareRenderPasses,
  MODEL_UNIT_VERSION_COMPARE_EVENT,
  MODEL_UNIT_VERSION_COMPARE_STATE_EVENT,
  type ModelUnitCompareViewMode,
  type ModelUnitVersionCompareEnvironment,
  type ModelUnitVersionCompareEventDetail,
  type ModelUnitVersionCompareOpenDetail,
  type ModelUnitVersionCompareRuntimeState,
  type ModelUnitVersionSide,
} from '@/utils/modelUnitVersionCompare';
import { SlopeAnnotation3D, WeldAnnotation3D } from '@/utils/three/annotation';
import { DTXLayer, DTXSelectionController, DTXViewCullController } from '@/utils/three/dtx';
import { DynamicPivotController } from '@/utils/three/dtx/DynamicPivotController';
import { loadModelDisplayConfig } from '@/utils/three/dtx/materialConfig';
import { DTXOverlayHighlighter } from '@/utils/three/dtx/selection/DTXOverlayHighlighter';
import {
  buildMeasurementComponentsText,
  buildMeasurementValueText,
} from '@/utils/xeokitMeasurementFormat';
import { CadGrid } from '@/viewer/dtx/dtxCadGrid';
import { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import { loadDtxPrimitiveDemo } from '@/viewer/dtx/dtxPrimitiveDemo';
import { DTXTileLodController } from '@/viewer/dtx/DTXTileLodController';
import { DtxViewer, type BackgroundMode } from '@/viewer/dtx/DtxViewer';
import { shouldStopShowDbnumLoad } from '@/viewer/dtx/showDbnumLoadPolicy';

defineProps<{
    params: {
        params: unknown;
        api: unknown;
        containerApi: unknown;
    };
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const mainCanvas = ref<HTMLCanvasElement>();
const overlayContainer = ref<HTMLElement | null>(null);

const store = useToolStore();
const userStore = useUserStore();
const reviewStore = useReviewStore();
const consoleStore = useConsoleStore();
const modelLoadStatus = useModelLoadStatus();
const unitSettings = useUnitSettingsStore();
const measurementStyle = useXeokitMeasurementStyleStore();
const selectionStore = useSelectionStore();
const spatialQueryStore = useSpatialQuery();
const spatialComputeStore = useSpatialCompute();
const viewerContext = useViewerContext();
const backgroundStore = useBackgroundStore();
const displayThemeStore = useDisplayThemeStore();
const clearanceStore = useClearanceStore();

const initError = ref<string | null>(null);

watch(
  initError,
  (message) => {
    viewerContext.viewerError.value = message;
  },
  { immediate: true }
);

const isDev = import.meta.env.DEV;

function normalizeRefnoKeyLike(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*[\\/_-]\s*(\d+)$/);
  if (!m) return s;
  return `${m[1]}_${m[2]}`;
}

function normalizeCompareRefno(raw: unknown): string {
  return normalizeRefnoKeyLike(String(raw ?? '')) || '';
}

function mergeRootRefnoWithVisibleRefnos(rootRefno: string, visibleRefnos: string[]): string[] {
  const root = normalizeRefnoKeyLike(rootRefno);
  const merged = new Set<string>();
  if (root) merged.add(root);
  for (const refno of visibleRefnos) {
    const normalized = normalizeRefnoKeyLike(String(refno || ''));
    if (normalized) merged.add(normalized);
  }
  return Array.from(merged);
}

function getSelectionStoreRefnos(): string[] {
  const rawSelectedRefnos = Array.isArray((selectionStore as any).selectedRefnos?.value)
    ? (selectionStore as any).selectedRefnos.value
    : (selectionStore.selectedRefno.value ? [selectionStore.selectedRefno.value] : []);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const refno of rawSelectedRefnos) {
    const normalized = normalizeRefnoKeyLike(String(refno ?? ''));
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isTruthyUrlQueryFlag(raw: string | null | undefined): boolean {
  const t = String(raw ?? '').trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes';
}

type CameraViewMode = 'cad_weak' | 'cad_flat' | 'normal';

function getCameraFovByMode(mode: CameraViewMode): number {
  switch (mode) {
    case 'cad_flat':
      return 18;
    case 'normal':
      return 45;
    case 'cad_weak':
    default:
      return 30;
  }
}

function clampGlobalEdgeThresholdAngle(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(60, Math.round(value)));
}

function clampFocusDimOpacityPercent(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(5, Math.min(100, Math.round(value)));
}

function syncGlobalEdgeOverlay(force = false): void {
  const dtxLayer = dtxLayerRef.value;
  const overlay = globalEdgeOverlayRef.value;
  if (!dtxLayer || !overlay) return;

  const revision = dtxLayer.visibilityRevision;
  if (!globalEdgeEnabled.value) {
    overlay.clear();
    lastGlobalEdgeRevision = revision;
    return;
  }

  if (!force && revision === lastGlobalEdgeRevision) return;
  lastGlobalEdgeRevision = revision;

  const objectIds = dtxLayer.getVisibleObjectIds();
  overlay.setHighlightedObjects(objectIds);
}

function applyCameraViewMode(mode: CameraViewMode): void {
  const viewer = dtxViewerRef.value;
  if (!viewer) return;
  const nextFov = getCameraFovByMode(mode);
  if (Math.abs((viewer.camera.fov || 0) - nextFov) < 1e-6) return;
  viewer.camera.fov = nextFov;
  viewer.camera.updateProjectionMatrix();
  requestRender();
}

function applyGlobalEdgeStyle(): void {
  const overlay = globalEdgeOverlayRef.value;
  if (!overlay) return;

  overlay.setStyle({
    showFill: false,
    edgeColor: 0x4b5563,
    edgeOpacity: 1,
    edgeLineWidth: 1,
    edgeThresholdAngle: clampGlobalEdgeThresholdAngle(globalEdgeThresholdAngle.value),
    edgeAlwaysOnTop: false,
  });
  lastGlobalEdgeRevision = -1;
  syncGlobalEdgeOverlay(true);
  requestRender();
}

function onCameraViewModeChange(mode: CameraViewMode): void {
  cameraViewMode.value = mode;
  applyCameraViewMode(mode);
  try {
    localStorage.setItem('dtx_camera_mode', mode);
  } catch {
    // ignore
  }
}

function onGlobalEdgeEnabledChange(enabled: boolean): void {
  globalEdgeEnabled.value = enabled;
  applyGlobalEdgeStyle();
  try {
    localStorage.setItem('dtx_global_edges', enabled ? '1' : '0');
  } catch {
    // ignore
  }
}

function onGlobalEdgeThresholdInput(value: number | string): void {
  const next = clampGlobalEdgeThresholdAngle(Number(value));
  if (next === globalEdgeThresholdAngle.value) return;
  globalEdgeThresholdAngle.value = next;
  applyGlobalEdgeStyle();
  try {
    localStorage.setItem('dtx_edge_angle', String(next));
  } catch {
    // ignore
  }
}

function onFocusTransparencyEnabledChange(enabled: boolean): void {
  focusTransparencyEnabled.value = enabled;
  compatViewerRef.value?.scene.setAutoFocusTransparencyEnabled(enabled, {
    dimOpacity: focusDimOpacityPercent.value / 100,
  });
  safeLsSet('dtx_focus_transparency', enabled ? '1' : '0');
  requestRender();
}

function onFocusDimOpacityInput(value: number | string): void {
  const next = clampFocusDimOpacityPercent(Number(value));
  if (next === focusDimOpacityPercent.value) return;
  focusDimOpacityPercent.value = next;
  compatViewerRef.value?.scene.setFocusDimOpacity(next / 100);
  safeLsSet('dtx_focus_opacity', String(next));
  requestRender();
}

type DtxTileLodUiConfig = {
    l1Px: number;
    l2Px: number;
    hysteresis: number;
    settleMs: number;
};

type DtxLodPrewarmUiConfig = {
    enabled: boolean;
    topK: number;
    minCount: number;
    concurrency: number;
};

function safeLsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function isDtxLodDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  const raw = q.get('dtx_lod_debug') ?? safeLsGet('dtx_lod_debug') ?? '0';
  return String(raw).trim() === '1';
}

function setDtxLodDebugEnabled(enabled: boolean): void {
  safeLsSet('dtx_lod_debug', enabled ? '1' : '0');
}

const lodDebugVisible = ref(isDev && isDtxLodDebugEnabled());
function closeLodDebugPanel(): void {
  lodDebugVisible.value = false;
  setDtxLodDebugEnabled(false);
}

function readDtxLodPrewarmConfigFromUrl(): DtxLodPrewarmUiConfig {
  if (typeof window === 'undefined') {
    return { enabled: false, topK: 80, minCount: 5, concurrency: 8 };
  }
  const q = new URLSearchParams(window.location.search);
  const enabledRaw =
        q.get('dtx_lod_prewarm') ?? safeLsGet('dtx_lod_prewarm') ?? '0';
  const topRaw =
        q.get('dtx_lod_prewarm_top') ??
        safeLsGet('dtx_lod_prewarm_top') ??
        '80';
  const minRaw =
        q.get('dtx_lod_prewarm_min') ??
        safeLsGet('dtx_lod_prewarm_min') ??
        '5';
  const concRaw =
        q.get('dtx_lod_prewarm_conc') ??
        safeLsGet('dtx_lod_prewarm_conc') ??
        '8';

  const topK0 = Number(topRaw);
  const minCount0 = Number(minRaw);
  const conc0 = Number(concRaw);

  return {
    enabled: String(enabledRaw).trim() !== '0',
    topK: Number.isFinite(topK0) && topK0 > 0 ? Math.floor(topK0) : 80,
    minCount:
            Number.isFinite(minCount0) && minCount0 > 0
              ? Math.floor(minCount0)
              : 5,
    concurrency:
            Number.isFinite(conc0) && conc0 > 0 ? Math.floor(conc0) : 8,
  };
}

const lodUiConfig = ref<DtxTileLodUiConfig>(readDtxTileLodConfigFromUrl());
const lodPrewarmUiConfig = ref<DtxLodPrewarmUiConfig>(
  readDtxLodPrewarmConfigFromUrl(),
);

let lodCfgPersistTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  lodUiConfig,
  (cfg) => {
    const ctl = tileLodControllerRef.value;
    if (ctl) {
      ctl.setConfig(cfg);
      const viewer = dtxViewerRef.value;
      if (viewer) ctl.requestUpdate(viewer.camera);
      requestRender();
    }

    if (lodCfgPersistTimer) clearTimeout(lodCfgPersistTimer);
    lodCfgPersistTimer = setTimeout(() => {
      safeLsSet('dtx_lod_l1px', String(cfg.l1Px));
      safeLsSet('dtx_lod_l2px', String(cfg.l2Px));
      safeLsSet('dtx_lod_hys', String(cfg.hysteresis));
      safeLsSet('dtx_lod_settle', String(cfg.settleMs));
    }, 200);
  },
  { deep: true },
);

let prewarmCfgPersistTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  lodPrewarmUiConfig,
  (cfg) => {
    if (prewarmCfgPersistTimer) clearTimeout(prewarmCfgPersistTimer);
    prewarmCfgPersistTimer = setTimeout(() => {
      safeLsSet('dtx_lod_prewarm', cfg.enabled ? '1' : '0');
      safeLsSet('dtx_lod_prewarm_top', String(cfg.topK));
      safeLsSet('dtx_lod_prewarm_min', String(cfg.minCount));
      safeLsSet('dtx_lod_prewarm_conc', String(cfg.concurrency));
      // 约定：本项目当前策略为只预热 L2
      safeLsSet('dtx_lod_prewarm_lods', 'L2');
    }, 200);
  },
  { deep: true },
);

// 统一工具栏（显示 / 测量 / 视图 分组，原左右两条竖排图标条合并）
const leftToolbarRef = ref<HTMLDivElement | null>(null);
const leftToolbarOpenMeasureMenu = ref(false);
const hasSelectedRefno = computed(() => !!selectionStore.selectedRefno.value);
const isMeasureModeActive = computed(() => {
  const mode = store.toolMode.value;
  return (
    mode === 'measure_distance' ||
    mode === 'measure_angle' ||
    mode === 'xeokit_measure_distance' ||
    mode === 'xeokit_measure_angle' ||
    mode === 'xeokit_measure_elevation_point' ||
    mode === 'xeokit_measure_elevation_delta' ||
    mode === 'measure_object_to_object' ||
    mode === 'measure_pipe_to_structure' ||
    mode === 'measure_pipe_to_pipe'
  );
});
const isNearestMeasurementWizardMode = computed(() => {
  const mode = store.toolMode.value;
  return (
    mode === 'measure_point_to_object' ||
    mode === 'measure_pipe_to_structure' ||
    mode === 'measure_pipe_to_pipe'
  );
});
const isXeokitMeasureMode = computed(() => {
  return (
    store.toolMode.value === 'xeokit_measure_distance' ||
    store.toolMode.value === 'xeokit_measure_angle' ||
    store.toolMode.value === 'xeokit_measure_elevation_point' ||
    store.toolMode.value === 'xeokit_measure_elevation_delta'
  );
});
const activeMeasureTools = computed(() => {
  return isXeokitMeasureMode.value ? xeokitMeasurementToolsRef.value : toolsRef.value;
});
const activeMeasureStatusText = computed(() => {
  const tools = activeMeasureTools.value;
  return tools ? tools.statusText.value : '';
});
const activeMeasureHoverText = computed(() => {
  // xeokit 测量：提示条第二行放拾取消息（E3D `!!alert.*` 对应的告警、已选第一项 / 求交已选、P-Point 加载中、
  // 未命中原因……）。它此前只喂给指针透镜的 subtitle，而透镜未吸附时不画——这些话一直没有可见出口（golden MD §36）。
  if (isXeokitMeasureMode.value) return xeokitMeasurementToolsRef.value?.pickPointMessage.value ?? '';
  return toolsRef.value?.hoverText?.value ?? '';
});

// 工具栏“设置”弹层
const toolbarSettingsOpen = ref(false);
const spatialQueryOpen = ref(false);
const pipeDistDrawerOpen = ref(false);

const dtxViewerRef = shallowRef<DtxViewer | null>(null);
const dtxLayerRef = shallowRef<DTXLayer | null>(null);
const showDbnumExtraDtxLayers: DTXLayer[] = [];
const attachedShowDbnumExtraDtxLayers = new WeakSet<DTXLayer>();
const modelUnitCompareState = ref<ModelUnitVersionCompareRuntimeState | null>(null);
function publishModelUnitCompareState(): void {
  const state = modelUnitCompareState.value;
  const detail: ModelUnitVersionCompareRuntimeState | null = state
    ? {
      ...state,
      environment: state.environment ? { ...state.environment } : undefined,
    }
    : null;
  window.dispatchEvent(new CustomEvent(MODEL_UNIT_VERSION_COMPARE_STATE_EVENT, { detail }));
}
watch(modelUnitCompareState, publishModelUnitCompareState, { deep: true });
let modelUnitCompareLayers: DTXLayer[] = [];
let modelUnitCompareOriginalVisibility = new Map<string, boolean>();
let modelUnitCompareTargetRefnos: string[] = [];
let modelUnitCompareCameraState: {
  position: Vector3;
  target: Vector3;
  near: number;
  far: number;
} | null = null;
let modelUnitCompareRunId = 0;
const selectionControllerRef = shallowRef<DTXSelectionController | null>(null);
const globalEdgeOverlayRef = shallowRef<DTXOverlayHighlighter | null>(null);
const viewCullControllerRef = shallowRef<DTXViewCullController | null>(null);
const pivotControllerRef = shallowRef<DynamicPivotController | null>(null);
const cadGridRef = shallowRef<CadGrid | null>(null);
const compatViewerRef = shallowRef<DtxCompatViewer | null>(null);
const tileLodControllerRef = shallowRef<DTXTileLodController | null>(null);
const toolsRef = shallowRef<ReturnType<typeof useDtxTools> | null>(null);
const xeokitMeasurementToolsRef = shallowRef<ReturnType<typeof useXeokitMeasurementTools> | null>(null);
const ptsetVisRef = shallowRef<ReturnType<
    typeof usePtsetVisualizationThree
> | null>(null);
const annotationSystemRef = shallowRef<ReturnType<
    typeof useAnnotationThree
> | null>(null);
const modelGenerationRef = shallowRef<ReturnType<
    typeof useModelGeneration
> | null>(null);
let dimensionSystem: DimensionSystem | null = null;
let offDimensionReviewBinding: (() => void) | null = null;
let offDimensionSelectionBinding: (() => void) | null = null;
let offLocalDimensionAutosave: (() => void) | null = null;
let localDimensionAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
let localDimensionAutosaveRunning = false;
let dimensionMountDisposed = false;
let dimensionInitializationVersion = 0;
const dimensionViewerAdapter = createDtxDimensionViewerAdapter({
  getCamera: () => dtxViewerRef.value?.camera,
  getMillimetresToScene: () => dtxLayerRef.value?.getGlobalModelMatrix(),
  getContainer: () => containerRef.value,
  requestRender,
  // 标签 billboard 避让管件包围盒：把标签周围的已加载构件交给尺寸内核。
  getDtxLayer: () => dtxLayerRef.value,
  // 标签也让开视口右上角的坐标 gizmo 覆盖层（屏幕矩形）。
  getOverlayElements: () => [dtxViewerRef.value?.getGizmoElement()],
});

/**
 * 尺寸叠层（标注、标签、文字）在整帧——含 OutlinePass / FXAA / 色调映射与
 * sRGB 输出——之后单独画一遍，直接进 sRGB 画布（ADR 0064）：文字不再被
 * FXAA 抹糊、平色不过 ACES、羽化边按 sRGB 混合。每处画完主场景都要调它。
 */
function renderDimensionOverlay(viewer: DtxViewer): void {
  dimensionSystem?.viewport.renderOverlay(viewer.renderer, viewer.camera);
}

function sceneWorldToDesignMetres(
  point: readonly [number, number, number],
): readonly [number, number, number] {
  const design = new Vector3(...point).applyMatrix4(
    dimensionViewerAdapter.getDesignToWorld().clone().invert(),
  );
  return [design.x, design.y, design.z];
}

function sceneDirectionToDesign(
  direction: readonly [number, number, number],
): readonly [number, number, number] {
  const origin = sceneWorldToDesignMetres([0, 0, 0]);
  const endpoint = sceneWorldToDesignMetres(direction);
  return [
    endpoint[0] - origin[0],
    endpoint[1] - origin[1],
    endpoint[2] - origin[2],
  ];
}

const cameraViewMode = ref<CameraViewMode>('cad_weak');
const globalEdgeEnabled = ref(false);
const globalEdgeThresholdAngle = ref(20);
const focusTransparencyEnabled = ref(false);
const focusDimOpacityPercent = ref(20);

let attachedToScene = false;
let shaderPrecompiled = false;
let lastGlobalEdgeRevision = -1;
let continuousRender = false;
let demoMode: 'none' | 'primitives' = 'none';
let demoPrimitiveCount = 1000;
let cadGridEnabled = true;

let rafId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let offRibbonCommand: (() => void) | null = null;
let offToolsInput: (() => void) | null = null;
let offXeokitToolsInput: (() => void) | null = null;
let offPtsetWatch: (() => void) | null = null;
let offBranClearanceWatch: (() => void) | null = null;
let offShowModelByRefnos: (() => void) | null = null;
let offModelUnitVersionCompare: (() => void) | null = null;
let offOpenSpatialQuery: (() => void) | null = null;
let offControlsChange: (() => void) | null = null;
let offPivotEvents: (() => void) | null = null;
let offGizmoEvents: (() => void) | null = null;
let offDocPointerDown: (() => void) | null = null;
let offKeydown: (() => void) | null = null;
let offAnnotationInteraction: (() => void) | null = null;
let offAnnotationVectorTextRebuilt: (() => void) | null = null;
let annotationVectorTextRebuildCount = 0;

let dtxGlobalTransformAppliedKey: string | null = null;
let dtxAutoFitAppliedKey: string | null = null;
let activeDbno: number | null = null;
let tileLodInitializedDbno: number | null = null;

const SHOW_DBNUM_DTX_LAYER_OPTIONS = {
  maxVertices: 2000000,
  maxIndices: 6000000,
  maxObjects: 260000,
};
const SHOW_DBNUM_LOAD_BATCH_SIZE = 100;
const SHOW_DBNUM_LAYER_MAX_OBJECTS = 180000;
const SHOW_DBNUM_LAYER_MAX_TRIANGLES = 32000000;

watch(
  () => [compatViewerRef.value, selectionStore.selectedRefno.value, selectionStore.selectedRefnos.value.join('|')] as const,
  () => {
    const compat = compatViewerRef.value;
    if (!compat || demoMode === 'primitives') return;

    const nextSelectedRefnos = getSelectionStoreRefnos();
    const nextSet = new Set(nextSelectedRefnos);
    const currentSelectedRefnos = compat.scene.selectedObjectIds
      .map((refno) => normalizeRefnoKeyLike(refno))
      .filter((refno): refno is string => !!refno);
    const currentSet = new Set(currentSelectedRefnos);

    const toDeselect = currentSelectedRefnos.filter((refno) => !nextSet.has(refno));
    const toSelect = nextSelectedRefnos.filter((refno) => !currentSet.has(refno));
    if (toDeselect.length === 0 && toSelect.length === 0) return;

    if (toDeselect.length > 0) {
      compat.scene.setObjectsSelected(toDeselect, false);
    }
    if (toSelect.length > 0) {
      compat.scene.ensureRefnos(toSelect, { computeAabb: false });
      compat.scene.setObjectsSelected(toSelect, true);
    }
    requestRender();
  },
  { immediate: true }
);

function readDtxScaleConfigFromUrl(): {
    scale: number;
    recenter: boolean;
    clip: boolean;
    autoFitOnLoad: boolean;
    } {
  const urlParams = new URLSearchParams(window.location.search);
  const units = String(urlParams.get('dtx_units') || '').trim().toLowerCase();
  const scaleStr = String(urlParams.get('dtx_scale') || '').trim();

  // 约定：
  // - dtx_scale=0.001 明确指定缩放
  // - dtx_units=mm => scale=0.001
  // - dtx_units=m/raw => scale=1
  // - 默认：按 mm 处理（scale=0.001），以缓解 z-fighting/大坐标精度问题
  // 一期新增：若 URL 未显式指定，则从设置读取 modelUnit 作为默认来源。
  let scale = unitSettings.modelUnit.value === 'mm' ? 0.001 : 1;
  if (units === 'm' || units === 'raw') scale = 1;
  if (units === 'mm') scale = 0.001;
  if (scaleStr) {
    const v = Number(scaleStr);
    if (Number.isFinite(v) && v > 0) scale = v;
  }

  const recenterParam = urlParams.get('dtx_recenter');
  const recenter =
        recenterParam === null ? unitSettings.recenter.value : recenterParam !== '0';
  const clipParam = urlParams.get('dtx_clip');
  const clip = clipParam === null ? unitSettings.clip.value : clipParam !== '0';

  const autoFitOnLoad = unitSettings.autoFitOnLoad.value;

  return { scale, recenter, clip, autoFitOnLoad };
}

function readDtxTileLodConfigFromUrl(): {
    l1Px: number;
    l2Px: number;
    hysteresis: number;
    settleMs: number;
    } {
  const urlParams = new URLSearchParams(window.location.search);
  const ls = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };

  const l1Raw = urlParams.get('dtx_lod_l1px') ?? ls('dtx_lod_l1px') ?? '200';
  const l2Raw = urlParams.get('dtx_lod_l2px') ?? ls('dtx_lod_l2px') ?? '80';
  const hRaw = urlParams.get('dtx_lod_hys') ?? ls('dtx_lod_hys') ?? '0.15';
  const sRaw = urlParams.get('dtx_lod_settle') ?? ls('dtx_lod_settle') ?? '250';

  const l1 = Number(l1Raw);
  const l2 = Number(l2Raw);
  const h = Number(hRaw);
  const s = Number(sRaw);

  return {
    l1Px: Number.isFinite(l1) && l1 > 0 ? Math.floor(l1) : 200,
    l2Px: Number.isFinite(l2) && l2 > 0 ? Math.floor(l2) : 80,
    hysteresis: Number.isFinite(h) && h >= 0 && h < 0.9 ? h : 0.15,
    settleMs: Number.isFinite(s) && s >= 0 ? Math.floor(s) : 250,
  };
}

function getDefaultCadGridSizeByUnit(modelUnit: string): number {
  switch (modelUnit) {
    case 'mm':
      return 100;
    case 'm':
      return 100;
    case 'raw':
      return 100000;
    default:
      return 100;
  }
}

function computeClipPlanesByDiag(diag: number): { near: number; far: number } {
  const d = Math.max(0, Number(diag) || 0);

  // 以 bbox 对角线长度为"分档"依据（单位：米）。
  // 配合 logarithmicDepthBuffer，收紧 far 值以提升深度精度。
  // far 只需覆盖"最远可视距离 ≈ 相机到模型最远点 ≈ 数倍对角线"。
  if (d <= 1) return { near: 0.01, far: 20 };
  if (d <= 10) return { near: 0.05, far: 100 };
  if (d <= 100) return { near: 0.1, far: 1000 };
  if (d <= 1000) return { near: 1, far: 10000 };
  return { near: 5, far: Math.min(100000, Math.max(20000, d * 20)) };
}

type DtxFocusBoxResult = {
  box: Box3;
  source: 'full' | 'robust';
  objectCount: number;
  keptObjectCount: number;
  fullDiag: number;
  focusDiag: number;
}

function getBoxDiag(box: Box3): number {
  if (!box || box.isEmpty()) return 0;
  const size = new Vector3();
  box.getSize(size);
  return size.length();
}

function medianValue(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function computeDtxFocusBox(dtxLayer: DTXLayer): DtxFocusBoxResult | null {
  const fullBox = dtxLayer.getBoundingBox();
  if (!fullBox || fullBox.isEmpty()) return null;

  const fullDiag = getBoxDiag(fullBox);
  const objectIds =
    typeof (dtxLayer as any).getVisibleObjectIds === 'function'
      ? (dtxLayer as any).getVisibleObjectIds()
      : (dtxLayer as any).getAllObjectIds?.() ?? [];

  if (!Array.isArray(objectIds) || objectIds.length < 30) {
    return {
      box: fullBox,
      source: 'full',
      objectCount: objectIds?.length ?? 0,
      keptObjectCount: objectIds?.length ?? 0,
      fullDiag,
      focusDiag: fullDiag,
    };
  }

  const items: { id: string; box: Box3; center: Vector3; distance: number }[] = [];
  for (const id of objectIds) {
    const box = dtxLayer.getObjectBoundingBox(String(id));
    if (!box || box.isEmpty()) continue;
    const center = new Vector3();
    box.getCenter(center);
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) continue;
    items.push({ id: String(id), box, center, distance: 0 });
  }

  if (items.length < 30) {
    return {
      box: fullBox,
      source: 'full',
      objectCount: items.length,
      keptObjectCount: items.length,
      fullDiag,
      focusDiag: fullDiag,
    };
  }

  const medianCenter = new Vector3(
    medianValue(items.map((item) => item.center.x)),
    medianValue(items.map((item) => item.center.y)),
    medianValue(items.map((item) => item.center.z)),
  );
  for (const item of items) {
    item.distance = item.center.distanceTo(medianCenter);
  }

  const keepCount = Math.max(30, Math.ceil(items.length * 0.98));
  const kept = items
    .slice()
    .sort((a, b) => a.distance - b.distance)
    .slice(0, keepCount);

  const robustBox = new Box3();
  for (const item of kept) {
    robustBox.union(item.box);
  }
  if (robustBox.isEmpty()) {
    return {
      box: fullBox,
      source: 'full',
      objectCount: items.length,
      keptObjectCount: items.length,
      fullDiag,
      focusDiag: fullDiag,
    };
  }

  const focusDiag = getBoxDiag(robustBox);
  const shouldUseRobust =
    focusDiag > 0 &&
    fullDiag / focusDiag >= 3 &&
    kept.length < items.length;

  return {
    box: shouldUseRobust ? robustBox : fullBox,
    source: shouldUseRobust ? 'robust' : 'full',
    objectCount: items.length,
    keptObjectCount: shouldUseRobust ? kept.length : items.length,
    fullDiag,
    focusDiag: shouldUseRobust ? focusDiag : fullDiag,
  };
}

function fitDtxViewerToBox(dtxViewer: DtxViewer, box: Box3, duration = 0): void {
  if (!box || box.isEmpty()) return;
  const center = new Vector3();
  const size = new Vector3();
  box.getCenter(center);
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = Math.max(maxDim * 2.5, 5);
  const position = new Vector3(
    center.x + distance * 0.8,
    center.y + distance * 0.6,
    center.z + distance * 0.8,
  );
  dtxViewer.flyTo(position, center, { duration });
}

function fitDtxViewerToFocusBox(dtxViewer: DtxViewer, dtxLayer: DTXLayer, duration = 0): DtxFocusBoxResult | null {
  const focus = computeDtxFocusBox(dtxLayer);
  if (!focus) return null;
  if (focus.source === 'robust') {
    console.info('[ViewerPanel] DTX auto-fit 使用鲁棒包围盒', {
      objectCount: focus.objectCount,
      keptObjectCount: focus.keptObjectCount,
      fullDiag: focus.fullDiag,
      focusDiag: focus.focusDiag,
    });
  }
  fitDtxViewerToBox(dtxViewer, focus.box, duration);
  return focus;
}

function applyDtxGlobalTransformOnce(dbno: number, dtxLayer: DTXLayer): void {
  const { scale, recenter } = readDtxScaleConfigFromUrl();
  if (!Number.isFinite(scale) || scale <= 0) return;

  const key = `${dbno}:${scale}:${recenter ? 1 : 0}`;
  if (dtxGlobalTransformAppliedKey === key) return;

  // 注意：DTXLayer.getBoundingBox() 会应用 globalModelMatrix。
  // 因此在首次归一化时，先临时置为 identity 再取“原始（mm）bbox”。
  const prevMatrix = dtxLayer.getGlobalModelMatrix();
  dtxLayer.setGlobalModelMatrix(new Matrix4());
  const rawBox = dtxLayer.getBoundingBox();
  if (rawBox.isEmpty()) {
    // 兜底：避免因 bbox 不可用导致把矩阵永久置为 identity
    dtxLayer.setGlobalModelMatrix(prevMatrix);
    return;
  }

  const centerMm = new Vector3();
  rawBox.getCenter(centerMm);

  const m = new Matrix4();
  if (scale !== 1) {
    m.makeScale(scale, scale, scale);
  }
  if (recenter) {
    m.setPosition(
      -centerMm.x * scale,
      -centerMm.y * scale,
      -centerMm.z * scale,
    );
  }
  dtxLayer.setGlobalModelMatrix(m);
  dimensionSystem?.notifyViewerChanged();

  dtxGlobalTransformAppliedKey = key;
}

function fitToDtxLayerBBoxOnce(dbno: number, dtxViewer: DtxViewer, dtxLayer: DTXLayer): void {
  const { scale, recenter, autoFitOnLoad } = readDtxScaleConfigFromUrl();
  if (!autoFitOnLoad) return;

  const key = `${dbno}:${scale}:${recenter ? 1 : 0}`;
  if (dtxAutoFitAppliedKey === key) return;

  const box = dtxLayer.getBoundingBox();
  if (!box || box.isEmpty()) return;

  fitDtxViewerToFocusBox(dtxViewer, dtxLayer, 0);
  dtxAutoFitAppliedKey = key;
}

function applyDtxCameraClipByLayerBBox(dtxViewer: DtxViewer, dtxLayer: DTXLayer): void {
  const { clip } = readDtxScaleConfigFromUrl();
  if (!clip) return;

  const box = dtxLayer.getBoundingBox();
  if (box.isEmpty()) return;

  const size = new Vector3();
  box.getSize(size);
  const diag = size.length();
  const { near, far } = computeClipPlanesByDiag(diag);

  // 额外保护：避免 far/near 比值过大导致深度精度崩溃
  const maxRatio = 2e4;
  let nextNear = near;
  let nextFar = far;
  if (nextFar / nextNear > maxRatio) {
    nextNear = Math.max(nextNear, nextFar / maxRatio);
  }
  if (nextFar <= nextNear * 1.01) {
    nextFar = nextNear * 100;
  }

  dtxViewer.camera.near = nextNear;
  dtxViewer.camera.far = nextFar;
  dtxViewer.camera.updateProjectionMatrix();
}

// 设置变更时，按需重算：全局矩阵、裁剪、网格与拾取索引（避免单位切换后不一致）。
watch(
  () => [
    unitSettings.modelUnit.value,
    unitSettings.recenter.value,
    unitSettings.clip.value,
  ],
  () => {
    const dtxViewer = dtxViewerRef.value;
    const dtxLayer = dtxLayerRef.value;
    if (!dtxViewer || !dtxLayer || activeDbno === null) return;

    try {
      applyDtxGlobalTransformOnce(activeDbno, dtxLayer);
    } catch (e) {
      console.warn('[ViewerPanel] DTX 全局变换应用失败', e);
    }

    try {
      selectionControllerRef.value?.refreshSpatialIndex();
    } catch {
      // ignore
    }

    try {
      viewCullControllerRef.value?.refreshSpatialIndex();
    } catch {
      // ignore
    }

    try {
      tileLodControllerRef.value?.onGlobalModelMatrixChanged();
    } catch {
      // ignore
    }

    try {
      cadGridRef.value?.fitToBoundingBox(dtxLayer.getBoundingBox());
    } catch {
      // ignore
    }

    try {
      applyDtxCameraClipByLayerBBox(dtxViewer, dtxLayer);
    } catch (e) {
      console.warn('[ViewerPanel] 相机裁剪面自适应失败', e);
    }

    requestRender();
  },
  { immediate: true },
);

// 模型单位/重心变更会改变全局矩阵（scale/translation），为避免既有标注错位，一期采取安全策略：有数据时自动清空。
watch(
  () => [unitSettings.modelUnit.value, unitSettings.recenter.value],
  ([nextUnit, nextRecenter], [prevUnit, prevRecenter]) => {
    if (prevUnit === undefined) return;
    if (nextUnit === prevUnit && nextRecenter === prevRecenter) return;
    if (activeDbno === null) return;

    const hasMarks =
            (store.measurements.value?.length ?? 0) > 0 ||
            (store.annotations.value?.length ?? 0) > 0 ||
            (store.cloudAnnotations.value?.length ?? 0) > 0 ||
            (store.rectAnnotations.value?.length ?? 0) > 0 ||
            (store.obbAnnotations.value?.length ?? 0) > 0;

    const hasPtset = (ptsetVisRef.value?.visualObjects.value?.size ?? 0) > 0;
    const hasBranClearance =
      (spatialComputeStore.scenarios.branNearestClearance.annotationCandidates.length ?? 0) > 0;

    if (!hasMarks && !hasPtset && !hasBranClearance) return;

    try {
      store.clearAll();
      ptsetVisRef.value?.clearAll();
      clearBranClearanceAnnotations();
      emitToast({
        message:
                    '模型单位/重心设置已变更：为避免错位，已清空测量/批注/点集/BRAN清距标注（可重新创建）',
      });
    } catch {
      // ignore
    }
    requestRender();
  },
);

function applyBackground(mode: BackgroundMode): void {
  const viewer = dtxViewerRef.value;
  if (!viewer) return;
  const preset = backgroundStore.getPreset(mode);
  if (mode === 'skybox') {
    viewer.loadCrossSkybox('/texture/skybox.png');
  } else if (preset.topColor === preset.bottomColor) {
    viewer.setSolidBackground(preset.topColor);
  } else {
    viewer.setGradientBackground(preset.topColor, preset.bottomColor);
  }
  requestRender();
}

function onBackgroundChange(mode: BackgroundMode): void {
  backgroundStore.setMode(mode);
  applyBackground(mode);
}

const displayThemePresets: { mode: DisplayTheme; label: string; colorHint: string }[] = [
  { mode: 'e3d', label: 'E3D', colorHint: '#4682B4' },
  { mode: 'default', label: '默认', colorHint: '#90a4ae' },
  { mode: 'design3d', label: '三维设计', colorHint: '#4CAF50' },
];

async function onDisplayThemeChange(theme: DisplayTheme): Promise<void> {
  displayThemeStore.setDisplayTheme(theme);
  const layer = dtxLayerRef.value;
  if (!layer || activeDbno === null) return;
  const config = await loadModelDisplayConfig();
  applyMaterialConfigToLoadedDtx(layer, activeDbno, config, theme);
  compatViewerRef.value?.scene.reapplyFocusTransparency();
  requestRender();
}

function toastNeedSelection(): void {
  emitToast({ message: '请先选择对象' });
}

function getToolbarSelection() {
  return resolveViewerToolbarSelection({
    selectedRefno: selectionStore.selectedRefno.value,
    sceneSelectedObjectIds: compatViewerRef.value?.scene.selectedObjectIds ?? [],
  });
}

/**
 * 递归收集子孙 refno（最多 3 层、200 个），用于组节点的显示/隐藏/定位
 */
async function collectDescendantRefnos(rootRefno: string, maxDepth = 3, maxTotal = 200): Promise<string[]> {
  const result: string[] = [];
  const queue: { refno: string; depth: number }[] = [{ refno: rootRefno, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0 && result.length < maxTotal) {
    const item = queue.shift()!;
    if (visited.has(item.refno)) continue;
    visited.add(item.refno);

    result.push(item.refno);

    if (item.depth >= maxDepth) continue;

    try {
      const resp = await getModelSource().tree.children(item.refno, 200);
      if (resp.success && resp.children) {
        for (const child of resp.children) {
          const childRefno = String(child.refno || '').trim().replace('/', '_');
          if (childRefno && !visited.has(childRefno)) {
            queue.push({ refno: childRefno, depth: item.depth + 1 });
          }
        }
      }
    } catch {
      // ignore children fetch errors
    }
  }

  return result;
}

async function getTargetRefnos(refno: string): Promise<string[]> {
  let targetRefnos = [refno];
  try {
    const resp = await getModelSource().tree.visibleInsts(refno);
    if (resp.success && resp.refnos && resp.refnos.length > 0) {
      targetRefnos = resp.refnos.map(r => String(r));
    }
  } catch {
    // ignore e3dGetVisibleInsts errors
  }

  // 检查当前 refnos 在 DTX 层是否有实际渲染对象
  const compat = compatViewerRef.value;
  if (compat) {
    const aabb = compat.scene.getAABB(targetRefnos);
    if (!aabb) {
      // DTX 层无对象 → 递归收集子孙 refno
      const descendants = await collectDescendantRefnos(refno);
      if (descendants.length > 1) {
        targetRefnos = descendants;
      }
    }
  }

  return targetRefnos;
}

function finiteNumberAttr(attrs: Record<string, unknown>, key: string): number | null {
  const raw = attrs[key];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function describeNoGeometryReason(refno: string): Promise<string | null> {
  try {
    const resp = await getModelSource().attributes.uiAttr(refno);
    if (!resp.success || !resp.attrs) return null;

    const type = String(resp.attrs.TYPE || '').trim().toUpperCase();
    if (type !== 'BOX') return null;

    const xlen = finiteNumberAttr(resp.attrs, 'XLEN');
    const ylen = finiteNumberAttr(resp.attrs, 'YLEN');
    const zlen = finiteNumberAttr(resp.attrs, 'ZLEN');
    if (xlen === null || ylen === null || zlen === null) return null;

    const isZeroSize = [xlen, ylen, zlen].every((value) => Math.abs(value) <= Number.EPSILON);
    if (!isZeroSize) return null;

    return `该 BOX 尺寸为 0（XLEN=${xlen}, YLEN=${ylen}, ZLEN=${zlen}），生成阶段不会写入 inst_relate/geo_relate，因此没有可绘制模型`;
  } catch {
    return null;
  }
}

async function hideSelected(): Promise<void> {
  const selection = getToolbarSelection();
  if (selection.sceneSelectedRefnos.length === 0 && !selection.primaryRefno) {
    toastNeedSelection();
    return;
  }

  const targetRefnos =
    selection.sceneSelectedRefnos.length > 0
      ? selection.sceneSelectedRefnos
      : await getTargetRefnos(selection.primaryRefno!);

  const compat = compatViewerRef.value;
  if (!compat) return;
  compat.scene.setObjectsVisible(targetRefnos, false);
  requestRender();
}

async function showSelected(): Promise<void> {
  const selection = getToolbarSelection();
  if (selection.sceneSelectedRefnos.length === 0 && !selection.primaryRefno) {
    toastNeedSelection();
    return;
  }

  const targetRefnos =
    selection.sceneSelectedRefnos.length > 0
      ? selection.sceneSelectedRefnos
      : await getTargetRefnos(selection.primaryRefno!);

  // 按需加载模型
  if (modelGenerationRef.value && selection.primaryRefno) {
    await modelGenerationRef.value.showModelByRefno(selection.primaryRefno, { flyTo: false });
  }

  const compat = compatViewerRef.value;
  if (!compat) return;
  compat.scene.setObjectsVisible(targetRefnos, true);
  requestRender();
}

function hasActiveXrayMode(): boolean {
  const compat = compatViewerRef.value;
  if (!compat) return false;
  for (const obj of Object.values(compat.scene.objects)) {
    if (obj.xrayed) return true;
  }
  return false;
}

async function toggleXraySelected(): Promise<void> {
  const compat = compatViewerRef.value;
  if (!compat) return;

  if (hasActiveXrayMode()) {
    const all = compat.scene.objectIds;
    if (all.length > 0) {
      compat.scene.setObjectsXRayed(all, false);
    }
    requestRender();
    return;
  }

  const selection = getToolbarSelection();
  if (selection.sceneSelectedRefnos.length === 0 && !selection.primaryRefno) {
    toastNeedSelection();
    return;
  }

  const targetRefnos =
    selection.sceneSelectedRefnos.length > 0
      ? selection.sceneSelectedRefnos
      : await getTargetRefnos(selection.primaryRefno!);

  if (modelGenerationRef.value && selection.primaryRefno) {
    await modelGenerationRef.value.showModelByRefno(selection.primaryRefno, { flyTo: false });
  }

  const all = compat.scene.objectIds;
  if (all.length > 0) {
    compat.scene.setObjectsXRayed(all, true);
  }
  if (targetRefnos.length > 0) {
    compat.scene.setObjectsXRayed(targetRefnos, false);
    compat.scene.setObjectsVisible(targetRefnos, true);
  }
  requestRender();
}

function hideAll(): void {
  const dtxLayer = dtxLayerRef.value;
  if (!dtxLayer) return;
  dtxLayer.setAllVisible(false);
  requestRender();
}

async function locateShowSelected(): Promise<void> {
  const selection = getToolbarSelection();
  if (selection.sceneSelectedRefnos.length === 0 && !selection.primaryRefno) {
    toastNeedSelection();
    return;
  }

  const targetRefnos =
    selection.sceneSelectedRefnos.length > 0
      ? selection.sceneSelectedRefnos
      : await getTargetRefnos(selection.primaryRefno!);

  // 按需加载模型
  if (modelGenerationRef.value && selection.primaryRefno) {
    await modelGenerationRef.value.showModelByRefno(selection.primaryRefno, { flyTo: false });
  }

  const compat = compatViewerRef.value;
  if (!compat) return;

  // 先确保可见，再定位
  compat.scene.setObjectsVisible(targetRefnos, true);
  const aabb = compat.scene.getAABB(targetRefnos);
  if (!aabb) {
    emitToast({ message: '定位失败：未获取到对象包围盒' });
    requestRender();
    return;
  }
  compat.cameraFlight.flyTo({ aabb, duration: 0.8, fit: true });
  requestRender();
}

type MeasureMode =
  | 'measure_distance'
  | 'measure_angle'
  | 'xeokit_measure_distance'
  | 'xeokit_measure_angle'
  | 'xeokit_measure_elevation_point'
  | 'xeokit_measure_elevation_delta'
  | 'none';

function setMeasureMode(next: MeasureMode): void {
  const mappedMode =
    next === 'measure_distance'
      ? 'xeokit_measure_distance'
      : next === 'measure_angle'
        ? 'xeokit_measure_angle'
        : next;

  if (mappedMode === 'none') {
    store.setToolMode('none');
    return;
  }

  if (store.toolMode.value === mappedMode) {
    store.setToolMode('none');
  } else {
    if (
      mappedMode === 'xeokit_measure_distance' ||
      mappedMode === 'xeokit_measure_angle' ||
      mappedMode === 'xeokit_measure_elevation_point' ||
      mappedMode === 'xeokit_measure_elevation_delta'
    ) {
      xeokitMeasurementToolsRef.value?.activate(mappedMode);
      if (!xeokitMeasurementToolsRef.value) {
        store.setToolMode(mappedMode);
      }
    } else {
      store.setToolMode(mappedMode);
    }
  }
  requestRender();
}

function exitXeokitMeasureMode(): void {
  if (
    store.toolMode.value !== 'xeokit_measure_distance' &&
    store.toolMode.value !== 'xeokit_measure_angle' &&
    store.toolMode.value !== 'xeokit_measure_elevation_point' &&
    store.toolMode.value !== 'xeokit_measure_elevation_delta'
  ) {
    return;
  }
  store.setMeasurementDetailsDrawerOpen(false);
  if (xeokitMeasurementToolsRef.value) {
    xeokitMeasurementToolsRef.value.deactivate();
  } else {
    store.setToolMode('none');
  }
  leftToolbarOpenMeasureMenu.value = false;
  requestRender();
}

function toggleLeftMeasureMenu(): void {
  leftToolbarOpenMeasureMenu.value = !leftToolbarOpenMeasureMenu.value;
}

function onLeftMeasureDistanceClick(): void {
  setMeasureMode('xeokit_measure_distance');
  leftToolbarOpenMeasureMenu.value = false;
}

function onLeftMeasureAngleClick(): void {
  setMeasureMode('xeokit_measure_angle');
  leftToolbarOpenMeasureMenu.value = false;
}

function onLeftMeasureElevationPointClick(): void {
  setMeasureMode('xeokit_measure_elevation_point');
  leftToolbarOpenMeasureMenu.value = false;
}

function onLeftMeasureElevationDeltaClick(): void {
  setMeasureMode('xeokit_measure_elevation_delta');
  leftToolbarOpenMeasureMenu.value = false;
}

function onLeftMeasureObjectToObjectClick(): void {
  setAutoNearestMode('measure_object_to_object');
  leftToolbarOpenMeasureMenu.value = false;
}

function onLeftMeasurePipeToStructureClick(): void {
  setAutoNearestMode('measure_pipe_to_structure');
  leftToolbarOpenMeasureMenu.value = false;
}

function onLeftMeasurePipeToPipeClick(): void {
  setAutoNearestMode('measure_pipe_to_pipe');
  leftToolbarOpenMeasureMenu.value = false;
}

function closeObjectMeasureMode(): void {
  if (store.toolMode.value !== 'measure_object_to_object') return;
  store.setToolMode('none');
  requestRender();
}

function resetObjectMeasureSelection(): void {
  if (store.toolMode.value !== 'measure_object_to_object') return;
  try {
    toolsRef.value?.cancelMeasurementInteraction?.();
  } catch {
    // ignore
  }
  requestRender();
}

function setAutoNearestMode(
  next: 'measure_object_to_object' | 'measure_pipe_to_structure' | 'measure_pipe_to_pipe',
): void {
  if (store.toolMode.value === next) {
    store.setToolMode('none');
  } else {
    store.setToolMode(next);
  }
  requestRender();
}

function clearBranClearanceAnnotations(): void {
  dimensionSystem?.replaceExternalSource('bran-clearance', []);
}

function syncBranClearanceDimensions(): void {
  const system = dimensionSystem;
  const candidates = spatialComputeStore.scenarios.branNearestClearance.annotationCandidates;
  if (!system || candidates.length === 0) {
    system?.replaceExternalSource('bran-clearance', []);
    return;
  }
  // 候选端点是 E3D 世界 mm（服务端算的、三维点选换算过的都是），Design Space 是同一原点的米：直接 /1000。
  // 此前这里套的是 designToWorld 的逆——那是 scene → design 的换算，对 mm 端点差一个 1000 倍还带着重定心平移。
  const result = branClearanceToExternalDimensions(
    candidates,
    point => [point[0] / 1000, point[1] / 1000, point[2] / 1000],
  );
  system.replaceExternalSource('bran-clearance', result.records);
  if (result.skipped.length > 0) {
    console.warn(
      '[bran-clearance] skipped incomplete dimension candidates',
      result.skipped,
    );
  }
}

/**
 * 构件 → 墙净距（`docs/plans/2026-09-17-component-to-wall-surface-clearance-plan.md` §6.3）：
 * 记录里的两点是 design-world 米，飞过去要走 designToWorld（mm → scene 的全局矩阵 × 1000），
 * 与 `DtxDimensionViewerAdapter` 同一口径。
 */
function flyToClearanceRecord(record: ClearanceRecord): void {
  const snapshot = record.snapshot;
  const compat = compatViewerRef.value;
  if (!snapshot || !compat) return;
  const millimetresToScene = dtxLayerRef.value?.getGlobalModelMatrix() ?? new Matrix4();
  const toScene = (point: readonly [number, number, number]) =>
    new Vector3(point[0] * 1000, point[1] * 1000, point[2] * 1000).applyMatrix4(millimetresToScene);
  const a = toScene(snapshot.sourcePoint);
  const b = toScene(snapshot.targetPoint);
  const pad = Math.max(a.distanceTo(b), 0.5);
  compat.cameraFlight.flyTo({
    aabb: [
      Math.min(a.x, b.x) - pad,
      Math.min(a.y, b.y) - pad,
      Math.min(a.z, b.z) - pad,
      Math.max(a.x, b.x) + pad,
      Math.max(a.y, b.y) + pad,
      Math.max(a.z, b.z) + pad,
    ],
    duration: 0.8,
    fit: true,
  });
  requestRender();
}

const componentToWallClearance = useComponentToWallClearance({
  toolStore: store,
  selectionStore,
  clearanceStore,
  toast: emitToast,
  onRecord: flyToClearanceRecord,
});
useClearanceDimensionSync(viewerContext.dimensionSystem, clearanceStore, requestRender);

function nextDimensionId(prefix: string): string {
  return typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function startDimensionCreation(
  kind: 'linear' | 'projected' | 'angular' | 'radial',
): void {
  const system = dimensionSystem;
  const snapPort = system?.snapPort;
  const user = userStore.currentUser.value;
  if (!system || !snapPort) {
    emitToast({ message: '尺寸系统或捕捉数据尚未就绪', level: 'warning' });
    return;
  }
  if (system.hasPendingRecovery()) {
    emitToast({ message: '请先在尺寸面板中恢复或放弃未保存修改', level: 'warning' });
    return;
  }
  if (!user) {
    emitToast({ message: '请先登录再创建尺寸', level: 'warning' });
    return;
  }
  store.setToolMode('none');
  const input = {
    snapPort,
    actor: { actorId: user.id, actorRole: String(user.role) },
    createDimensionId: () => nextDimensionId('dimension'),
    createCommandId: () => nextDimensionId('dimension-command'),
    now: Date.now,
    onPreview: (preview: Parameters<typeof system.viewport.setPreview>[0]) => {
      system.viewport.setPreview(preview);
    },
  };
  const session = kind === 'linear'
    ? createLinearEditSession(input)
    : kind === 'projected'
      ? createProjectedEditSession(input)
      : kind === 'angular'
        ? createAngularEditSession(input)
        : createRadialEditSession(input);
  system.pointer.start(session);
  requestRender();
}

function dimensionHistoryAction(action: 'undo' | 'redo'): void {
  const system = dimensionSystem;
  const user = userStore.currentUser.value;
  if (!system || !user) return;
  const actor = { actorId: user.id, actorRole: String(user.role) };
  const result = action === 'undo'
    ? system.document.undo(
      actor,
      Date.now(),
      nextDimensionId('dimension-command'),
    )
    : system.document.redo(
      actor,
      Date.now(),
      nextDimensionId('dimension-command'),
    );
  if (!result.ok) {
    emitToast({ message: `尺寸${action === 'undo' ? '撤销' : '重做'}失败：${result.reason}`, level: 'warning' });
  }
  requestRender();
}

function handleRibbonCommand(commandId: string) {
  switch (commandId) {
    case 'viewer.hide_selected':
      hideSelected();
      return;
    case 'viewer.show_selected':
      showSelected();
      return;
    case 'viewer.hide_all':
      hideAll();
      return;
    case 'viewer.locate_show_selected':
      locateShowSelected();
      return;
    case 'measurement.distance':
      setMeasureMode('xeokit_measure_distance');
      return;
    case 'measurement.elevation_point':
      setMeasureMode('xeokit_measure_elevation_point');
      return;
    case 'measurement.elevation_delta':
      setMeasureMode('xeokit_measure_elevation_delta');
      return;
    case 'measurement.angle':
      setMeasureMode('xeokit_measure_angle');
      return;
    case 'measurement.point_to_mesh':
      store.setToolMode('measure_point_to_object');
      requestRender();
      return;
    case 'measurement.object_to_object':
      setAutoNearestMode('measure_object_to_object');
      return;
    case 'measurement.pipe_to_structure':
      setAutoNearestMode('measure_pipe_to_structure');
      return;
    case 'measurement.pipe_to_pipe':
      setAutoNearestMode('measure_pipe_to_pipe');
      return;
    case 'measurement.clear':
      if (
        store.toolMode.value === 'xeokit_measure_distance' ||
        store.toolMode.value === 'xeokit_measure_angle' ||
        store.toolMode.value === 'xeokit_measure_elevation_point' ||
        store.toolMode.value === 'xeokit_measure_elevation_delta'
      ) {
        xeokitMeasurementToolsRef.value?.clearMeasurements();
      } else {
        store.clearMeasurements();
      }
      requestRender();
      return;
    case 'dimension.create.linear':
      startDimensionCreation('linear');
      return;
    case 'dimension.create.projected':
      startDimensionCreation('projected');
      return;
    case 'dimension.create.angular':
      startDimensionCreation('angular');
      return;
    case 'dimension.create.radial':
      startDimensionCreation('radial');
      return;
    case 'dimension.axis.x':
    case 'dimension.axis.y':
    case 'dimension.axis.z':
      dimensionSystem?.pointer.selectDesignAxis(commandId.slice(-1) as 'x' | 'y' | 'z');
      requestRender();
      return;
    case 'dimension.flip':
      dimensionSystem?.pointer.flipActiveSession();
      requestRender();
      return;
    case 'dimension.undo':
      dimensionHistoryAction('undo');
      return;
    case 'dimension.redo':
      dimensionHistoryAction('redo');
      return;
    case 'dimension.cancel':
      dimensionSystem?.pointer.pointerCancel();
      requestRender();
      return;
    case 'annotation.create':
      store.setToolMode('annotation');
      requestRender();
      return;
    case 'panel.pipeDistance.open':
      pipeDistDrawerOpen.value = true;
      rangeDrawerOpen.value = false;
      return;
    case 'panel.pipeDistance':
      pipeDistDrawerOpen.value = !pipeDistDrawerOpen.value;
      if (pipeDistDrawerOpen.value) rangeDrawerOpen.value = false;
      return;
    case 'clearance.componentToWall':
      componentToWallClearance.start();
      return;
    case 'clearance.clear':
      clearanceStore.clearRecords();
      requestRender();
      return;
    case 'tools.clear_all':
      store.clearAll();
      ptsetVisRef.value?.clearAll();
      requestRender();
      return;
  }
}

function ensureLayerAttached() {
  const dtxViewer = dtxViewerRef.value;
  const dtxLayer = dtxLayerRef.value;
  if (!dtxViewer || !dtxLayer) return;
  if (attachedToScene) return;
  if (!dtxLayer.getStats().compiled) return;
  dtxLayer.addToScene(dtxViewer.scene);
  attachedToScene = true;

  if (!shaderPrecompiled) {
    try {
      dtxViewer.renderer.compile(dtxViewer.scene, dtxViewer.camera);
      shaderPrecompiled = true;
    } catch (e) {
      console.warn(
        '[ViewerPanel] shader 预编译失败，将在首帧渲染时自动编译',
        e,
      );
    }
  }

  requestRender();
}

function createShowDbnumDtxLayer(dtxViewer: DtxViewer, sourceLayer: DTXLayer): DTXLayer {
  const layer = new DTXLayer({
    renderer: dtxViewer.renderer,
    debug: isDev,
    ...SHOW_DBNUM_DTX_LAYER_OPTIONS,
  });
  layer.setRenderer(dtxViewer.renderer);
  layer.setGlobalModelMatrix(sourceLayer.getGlobalModelMatrix());
  showDbnumExtraDtxLayers.push(layer);
  if (typeof window !== 'undefined') {
    (window as any).__dtxShowDbnumExtraLayers = showDbnumExtraDtxLayers;
  }
  return layer;
}

function ensureShowDbnumExtraLayerAttached(layer: DTXLayer, dtxViewer: DtxViewer): void {
  if (!layer.getStats().compiled) return;
  if (attachedShowDbnumExtraDtxLayers.has(layer)) return;
  layer.addToScene(dtxViewer.scene);
  attachedShowDbnumExtraDtxLayers.add(layer);
}

function updateShowDbnumExtraLayers(dtxViewer: DtxViewer): void {
  for (const layer of showDbnumExtraDtxLayers) {
    ensureShowDbnumExtraLayerAttached(layer, dtxViewer);
    layer.update(dtxViewer.camera);
  }
}

function getShowDbnumAllLayers(primaryLayer: DTXLayer): DTXLayer[] {
  return [primaryLayer, ...showDbnumExtraDtxLayers];
}

function disposeModelUnitCompareLayer(layer: DTXLayer): void {
  const index = showDbnumExtraDtxLayers.indexOf(layer);
  if (index >= 0) showDbnumExtraDtxLayers.splice(index, 1);
  attachedShowDbnumExtraDtxLayers.delete(layer);
  try {
    layer.dispose();
  } catch {
    // ignore
  }
}

function disposeModelUnitCompareRunLayers(layers: DTXLayer[]): void {
  for (const layer of layers) {
    const index = modelUnitCompareLayers.indexOf(layer);
    if (index < 0) continue;
    modelUnitCompareLayers.splice(index, 1);
    disposeModelUnitCompareLayer(layer);
  }
}

function collectLoadedRefnoVisibility(primaryLayer: DTXLayer, dbnum: number): Map<string, boolean> {
  const refnos = new Set<string>();
  for (const objectId of primaryLayer.getAllObjectIds()) {
    const refno = resolveDtxRefnoByObjectId(dbnum, objectId);
    if (refno) refnos.add(refno);
  }
  const visibility = new Map<string, boolean>();
  for (const refno of refnos) {
    visibility.set(
      refno,
      resolveDtxObjectIdsByRefno(dbnum, refno).some((objectId) => primaryLayer.isObjectVisible(objectId)),
    );
  }
  return visibility;
}

/**
 * 「最新环境模型」= 打开对比时视口里**已加载**的该 dbnum 模型（CONTEXT「模型版本查看」，Q12）：把已加载的 refno 按页面级开关
 * 重取一遍（gen-model-v1 = records + forceRefresh），保持各自的显隐，不整库加载。
 */
async function refreshModelUnitCompareEnvironment(
  detail: ModelUnitVersionCompareOpenDetail,
  runId: number,
): Promise<{ loadedRefnos: number; refreshing: false }> {
  const primaryLayer = dtxLayerRef.value;
  if (!primaryLayer) throw new Error('三维环境图层尚未就绪');

  const visibilityByRefno = collectLoadedRefnoVisibility(primaryLayer, detail.dbnum);
  const loadedRefnos = [...visibilityByRefno.keys()];
  if (loadedRefnos.length > 0) {
    await loadDbnoInstancesForVisibleRefnosDtx(primaryLayer, detail.dbnum, loadedRefnos, {
      forceReloadRefnos: loadedRefnos,
      replaceExistingObjects: true,
    });
    if (runId !== modelUnitCompareRunId) throw new Error('版本对比已取消');
    applyModelUnitRefnoVisibility(
      primaryLayer,
      visibilityByRefno,
      (refno) => resolveDtxObjectIdsByRefno(detail.dbnum, refno),
    );
  }

  return { loadedRefnos: loadedRefnos.length, refreshing: false };
}

function hideModelUnitCompareTarget(primaryLayer: DTXLayer, dbnum: number): void {
  const unitRefno = modelUnitCompareTargetRefnos[0] || '';
  primaryLayer.setObjectsVisible(collectModelUnitTargetObjectIds(
    unitRefno,
    modelUnitCompareTargetRefnos,
    (refno) => resolveDtxObjectIdsByRefno(dbnum, refno),
    (refno) => resolveDtxObjectIdsByUnitRefno(dbnum, refno),
  ), false);
}

function setModelUnitCompareSide(side: 'before' | 'after'): void {
  const state = modelUnitCompareState.value;
  if (!state || state.status !== 'ready') return;
  const [beforeLayer, afterLayer] = modelUnitCompareLayers;
  applyModelUnitVersionSide(beforeLayer, afterLayer, side);
  state.activeSide = side;
  if (isDev && typeof window !== 'undefined' && (window as any).__modelUnitVersionCompare) {
    (window as any).__modelUnitVersionCompare.activeSide = side;
  }
  requestRender();
}

function setModelUnitCompareViewMode(viewMode: ModelUnitCompareViewMode): void {
  const state = modelUnitCompareState.value;
  if (!state || state.status !== 'ready' || state.viewMode === viewMode) return;
  if (viewMode === 'split') {
    leftToolbarOpenMeasureMenu.value = false;
    dimensionSystem?.pointer.pointerCancel();
    toolsRef.value?.cancelMeasurementInteraction?.();
    exitXeokitMeasureMode();
    store.setToolMode('none');
    pivotControllerRef.value?.handleMouseUp();
  }
  state.viewMode = viewMode;
  if (isDev && typeof window !== 'undefined' && (window as any).__modelUnitVersionCompare) {
    (window as any).__modelUnitVersionCompare.viewMode = viewMode;
  }
  requestRender();
}

function isModelUnitSplitCompareReady(): boolean {
  return modelUnitCompareState.value?.status === 'ready'
    && modelUnitCompareState.value.viewMode === 'split'
    && modelUnitCompareLayers.length === 2;
}

function renderModelUnitCompareScene(viewer: DtxViewer): boolean {
  const state = modelUnitCompareState.value;
  const [beforeLayer, afterLayer] = modelUnitCompareLayers;
  if (!state || !beforeLayer || !afterLayer || !isModelUnitSplitCompareReady()) return false;

  const renderer = viewer.renderer;
  const camera = viewer.camera;
  const viewportSize = renderer.getSize(new Vector2());
  const passes = getModelUnitCompareRenderPasses(
    'split',
    state.activeSide,
    viewportSize.x,
    viewportSize.y,
  );
  const originalAspect = camera.aspect;
  let splitRenderError: unknown = null;
  try {
    renderer.setScissorTest(true);
    for (const pass of passes) {
      applyModelUnitVersionSide(beforeLayer, afterLayer, pass.side);
      renderer.setViewport(pass.x, pass.y, pass.width, pass.height);
      renderer.setScissor(pass.x, pass.y, pass.width, pass.height);
      camera.aspect = pass.width / Math.max(1, pass.height);
      camera.updateProjectionMatrix();
      renderer.render(viewer.scene, camera);
      renderDimensionOverlay(viewer);
    }
  } catch (error) {
    splitRenderError = error;
  } finally {
    applyModelUnitVersionSide(beforeLayer, afterLayer, state.activeSide);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewportSize.x, viewportSize.y);
    camera.aspect = originalAspect;
    camera.updateProjectionMatrix();
  }
  if (splitRenderError) {
    state.viewMode = 'single';
    emitToast({
      message: `双视口渲染失败，已回退单视口：${splitRenderError instanceof Error ? splitRenderError.message : String(splitRenderError)}`,
      level: 'error',
    });
    return false;
  }
  return true;
}

async function requestRefreshModelUnitCompareEnvironment(): Promise<void> {
  const state = modelUnitCompareState.value;
  const primaryLayer = dtxLayerRef.value;
  if (!state || state.status !== 'ready' || !state.environment || !primaryLayer || state.environment.refreshing) return;
  const runId = modelUnitCompareRunId;
  state.environment = { ...state.environment, refreshing: true, error: undefined };
  try {
    const environment = await refreshModelUnitCompareEnvironment(state.detail, runId);
    if (runId !== modelUnitCompareRunId || !modelUnitCompareState.value) return;
    hideModelUnitCompareTarget(primaryLayer, state.detail.dbnum);
    modelUnitCompareState.value.environment = environment;
    requestRender();
  } catch (error) {
    if (runId !== modelUnitCompareRunId || !modelUnitCompareState.value) return;
    const message = error instanceof Error ? error.message : String(error);
    modelUnitCompareState.value.environment = {
      ...state.environment,
      refreshing: false,
      error: message,
    };
    emitToast({ message: `最新环境刷新失败，已保留当前环境：${message}`, level: 'error' });
  }
}

function clearModelUnitVersionCompare(): void {
  modelUnitCompareRunId += 1;
  for (const layer of modelUnitCompareLayers.splice(0)) {
    disposeModelUnitCompareLayer(layer);
  }
  const primaryLayer = dtxLayerRef.value;
  const detail = modelUnitCompareState.value?.detail;
  if (primaryLayer && detail) {
    applyModelUnitRefnoVisibility(
      primaryLayer,
      modelUnitCompareOriginalVisibility,
      (refno) => resolveDtxObjectIdsByRefno(detail.dbnum, refno),
    );
  }
  modelUnitCompareOriginalVisibility = new Map();
  modelUnitCompareTargetRefnos = [];
  const viewer = dtxViewerRef.value;
  if (viewer && modelUnitCompareCameraState) {
    viewer.camera.position.copy(modelUnitCompareCameraState.position);
    viewer.controls.target.copy(modelUnitCompareCameraState.target);
    viewer.camera.near = modelUnitCompareCameraState.near;
    viewer.camera.far = modelUnitCompareCameraState.far;
    viewer.camera.updateProjectionMatrix();
    viewer.controls.update();
  }
  modelUnitCompareCameraState = null;
  modelUnitCompareState.value = null;
  if (isDev && typeof window !== 'undefined') {
    delete (window as any).__modelUnitVersionCompare;
  }
  requestRender();
}

function focusModelUnitVersionCompare(refno: string): void {
  const viewer = dtxViewerRef.value;
  const normalized = normalizeCompareRefno(refno);
  if (!viewer || !normalized || modelUnitCompareLayers.length === 0) return;

  const box = new Box3();
  const objectBox = new Box3();
  for (const layer of modelUnitCompareLayers) {
    for (const objectId of layer.getAllObjectIds()) {
      if (!objectId.includes(`:${normalized}:`)) continue;
      const found = layer.getObjectBoundingBoxInto(objectId, objectBox);
      if (found && !found.isEmpty()) box.union(found);
    }
  }
  if (box.isEmpty()) return;

  // 差异模式里定位的可能是幽灵构件（当前会话里已经没有它）：那时它已按「已删除」登记过，别用普通选中覆盖，
  // 否则属性面板又去拉当前会话、换回 404 红条
  const alreadyDeletedRegistered = selectionStore.selectedIsDeleted.value
    && selectionStore.selectedRefno.value === normalized;
  if (!alreadyDeletedRegistered) selectionStore.setSelectedRefno(normalized);
  viewer.fitClipPlanesToBox(box);
  const center = new Vector3();
  const size = new Vector3();
  box.getCenter(center);
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  viewer.flyTo(
    new Vector3(center.x + maxDim * 1.15, center.y - maxDim * 1.45, center.z + maxDim * 0.95),
    center,
    { duration: 500 },
  );
  requestRender();
}

async function openModelUnitVersionCompare(detail: ModelUnitVersionCompareOpenDetail): Promise<void> {
  clearModelUnitVersionCompare();
  const viewer = dtxViewerRef.value;
  const primaryLayer = dtxLayerRef.value;
  if (!viewer || !primaryLayer) {
    modelUnitCompareState.value = {
      detail,
      status: 'error',
      activeSide: 'after',
      viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
      error: '三维查看器尚未就绪',
    };
    return;
  }

  const runId = ++modelUnitCompareRunId;
  modelUnitCompareState.value = {
    detail,
    status: 'loading',
    activeSide: 'after',
    viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
  };
  modelUnitCompareCameraState = {
    position: viewer.camera.position.clone(),
    target: viewer.controls.target.clone(),
    near: viewer.camera.near,
    far: viewer.camera.far,
  };
  const runLayers: DTXLayer[] = [];

  try {
    const environmentResult = await refreshModelUnitCompareEnvironment(detail, runId)
      .then((environment) => ({ environment, error: undefined }))
      .catch((error: unknown) => ({
        environment: undefined,
        error: error instanceof Error ? error.message : String(error),
      }));
    if (runId !== modelUnitCompareRunId) return;
    const environment: ModelUnitVersionCompareEnvironment = environmentResult.environment ?? {
      loadedRefnos: collectLoadedRefnoVisibility(primaryLayer, detail.dbnum).size,
      refreshing: false as const,
      error: environmentResult.error,
    };
    modelUnitCompareTargetRefnos = Array.from(new Set([
      detail.unitRefno,
      ...detail.before.refnos.map(normalizeCompareRefno).filter(Boolean),
      ...detail.after.refnos.map(normalizeCompareRefno).filter(Boolean),
    ]));
    const currentVisibility = collectLoadedRefnoVisibility(primaryLayer, detail.dbnum);
    modelUnitCompareOriginalVisibility = new Map(
      modelUnitCompareTargetRefnos
        .map((refno) => [refno, currentVisibility.get(refno)] as const)
        .filter((entry): entry is readonly [string, boolean] => typeof entry[1] === 'boolean'),
    );
    hideModelUnitCompareTarget(primaryLayer, detail.dbnum);

    const beforeLayer = createShowDbnumDtxLayer(viewer, primaryLayer);
    const afterLayer = createShowDbnumDtxLayer(viewer, primaryLayer);
    runLayers.push(beforeLayer, afterLayer);
    modelUnitCompareLayers = [beforeLayer, afterLayer];
    // 两侧几何由版本对比面板经模型来源端口取好、随事件带来（ADR 0065 §2）；这里只往隔离图层里装，
    // 网格 URL 仍按页面级数据源走 `MeshSource`。「已删除单元版本」（tombstone）那一侧不装、显示删除空态。
    const sideHasGeometry = (side: ModelUnitVersionSide): boolean => side.version.impactKind !== 'tombstone';
    const commonOptions = {
      includeOwnedTubings: false,
      isolated: true,
      expectedRootRefno: detail.unitRefno,
    };
    const [beforeResult, afterResult] = await Promise.all([
      sideHasGeometry(detail.before) ? loadDbnoInstancesForVisibleRefnosDtx(beforeLayer, detail.dbnum, detail.before.refnos, {
        ...commonOptions,
        instanceEntriesByRefno: detail.before.entries,
        objectIdPrefix: 'unit-compare:a',
      }) : Promise.resolve(null),
      sideHasGeometry(detail.after) ? loadDbnoInstancesForVisibleRefnosDtx(afterLayer, detail.dbnum, detail.after.refnos, {
        ...commonOptions,
        instanceEntriesByRefno: detail.after.entries,
        objectIdPrefix: 'unit-compare:b',
      }) : Promise.resolve(null),
    ]);
    if (runId !== modelUnitCompareRunId) {
      disposeModelUnitCompareRunLayers(runLayers);
      return;
    }
    const beforeObjects = beforeResult?.loadedObjects ?? 0;
    const afterObjects = afterResult?.loadedObjects ?? 0;
    if (sideHasGeometry(detail.before) && beforeObjects === 0) {
      throw new Error(`版本 A（sesno ${detail.before.sesno}）没有可显示的几何对象`);
    }
    if (sideHasGeometry(detail.after) && afterObjects === 0) {
      throw new Error(`版本 B（sesno ${detail.after.sesno}）没有可显示的几何对象`);
    }
    const beforeColor = new Color(0x2563eb);
    const afterColor = new Color(0x10b981);
    // 比较层使用基础材质调色板着色；DTX 的颜色覆盖通道主要服务于选择态，
    // 在多 DTXLayer 并存时可能被共享的 shader program 复用为前一层纹理。
    for (const objectId of beforeLayer.getAllObjectIds()) {
      beforeLayer.setObjectMaterial(objectId, { color: beforeColor });
    }
    for (const objectId of afterLayer.getAllObjectIds()) {
      afterLayer.setObjectMaterial(objectId, { color: afterColor });
    }

    ensureShowDbnumExtraLayerAttached(beforeLayer, viewer);
    ensureShowDbnumExtraLayerAttached(afterLayer, viewer);
    applyModelUnitVersionSide(beforeLayer, afterLayer, DEFAULT_MODEL_UNIT_COMPARE_SIDE);
    const compareBox = computeDtxLayersBoundingBox([beforeLayer, afterLayer]);
    if (compareBox) {
      fitDtxViewerToBox(viewer, compareBox, 0);
      try {
        cadGridRef.value?.fitToBoundingBox(compareBox);
      } catch {
        // 网格适配失败不影响两个精确版本的模型加载与对比。
      }
    }

    modelUnitCompareState.value = {
      detail,
      status: 'ready',
      activeSide: DEFAULT_MODEL_UNIT_COMPARE_SIDE,
      viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
      environment,
    };
    if (isDev) {
      (window as any).__modelUnitVersionCompare = {
        unitRefno: detail.unitRefno,
        beforeSesno: detail.before.sesno,
        afterSesno: detail.after.sesno,
        beforeObjects,
        afterObjects,
        environmentLoadedRefnos: environment.loadedRefnos,
        activeSide: 'after',
        viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
      };
    }
    requestRender();
  } catch (error) {
    if (runId !== modelUnitCompareRunId) {
      disposeModelUnitCompareRunLayers(runLayers);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    clearModelUnitVersionCompare();
    modelUnitCompareState.value = {
      detail,
      status: 'error',
      activeSide: 'after',
      viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
      error: message,
    };
    emitToast({ message: `最小交付单元版本加载失败：${message}`, level: 'error' });
  }
}

function handleModelUnitVersionCompare(event: Event): void {
  const detail = (event as CustomEvent<ModelUnitVersionCompareEventDetail>).detail;
  if (!detail) return;
  if (detail.action === 'close') {
    clearModelUnitVersionCompare();
    return;
  }
  if (detail.action === 'focus') {
    focusModelUnitVersionCompare(detail.refno);
    return;
  }
  if (detail.action === 'set-side') {
    setModelUnitCompareSide(detail.side);
    return;
  }
  if (detail.action === 'set-view-mode') {
    setModelUnitCompareViewMode(detail.viewMode);
    return;
  }
  if (detail.action === 'refresh-environment') {
    void requestRefreshModelUnitCompareEnvironment();
    return;
  }
  if (detail.action === 'request-state') {
    publishModelUnitCompareState();
    return;
  }
  void openModelUnitVersionCompare(detail);
}

function computeDtxLayersBoundingBox(layers: DTXLayer[]): Box3 | null {
  const combined = new Box3();
  let hasBox = false;
  for (const layer of layers) {
    const box = layer.getBoundingBox();
    if (!box || box.isEmpty()) continue;
    combined.union(box);
    hasBox = true;
  }
  return hasBox ? combined : null;
}

function shouldRollShowDbnumLayer(layer: DTXLayer): boolean {
  const stats = layer.getStats();
  if (!stats.compiled || stats.totalObjects === 0) return false;
  return (
    stats.totalObjects >= SHOW_DBNUM_LAYER_MAX_OBJECTS ||
    stats.drawTriangleCount >= SHOW_DBNUM_LAYER_MAX_TRIANGLES
  );
}

function parseRefnoFromObjectId(objectId: string): string | null {
  if (!objectId) return null;
  if (!objectId.startsWith('o:')) return null;
  const parts = objectId.split(':');
  return parts.length >= 3 ? (parts[1] ?? null) : null;
}

function attachPicking() {
  const canvas = mainCanvas.value;
  const sel = selectionControllerRef.value;
  const compat = compatViewerRef.value;
  if (!canvas || !sel || !compat) return;

  const clickState = {
    down: null as { x: number; y: number } | null,
    moved: false,
    pointerId: null as number | null,
  };

  const onDown = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) return;
    // 工具模式开启时，交由 tools
    if (store.toolMode.value && store.toolMode.value !== 'none') return;
    if (e.button !== 0) return;
    clickState.down = { x: e.clientX, y: e.clientY };
    clickState.moved = false;
    clickState.pointerId = e.pointerId;
  };

  const onMove = (e: PointerEvent) => {
    if (!clickState.down) return;
    if (clickState.pointerId !== e.pointerId) return;
    const dx = e.clientX - clickState.down.x;
    const dy = e.clientY - clickState.down.y;
    if (dx * dx + dy * dy > 9) clickState.moved = true;
  };

  const onUp = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) {
      clickState.down = null;
      clickState.moved = false;
      clickState.pointerId = null;
      return;
    }
    // 工具模式开启时，交由 tools
    if (store.toolMode.value && store.toolMode.value !== 'none') return;

    // Shift+拖拽：框选由 useDtxTools 处理，这里不做 click picking
    if (e.shiftKey) {
      clickState.down = null;
      clickState.moved = false;
      clickState.pointerId = null;
      return;
    }

    const moved = clickState.moved;
    clickState.down = null;
    clickState.moved = false;
    clickState.pointerId = null;
    if (moved) return;

    const rect = canvas.getBoundingClientRect();
    const pos = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const hit = sel.pick(pos);

    // Ctrl/Cmd 键：追加/切换选中模式
    const additive = e.ctrlKey || e.metaKey;

    // Demo：DTX 基本体（不走 refno 选中逻辑，直接按 objectId 选中）
    if (demoMode === 'primitives') {
      if (!hit) {
        // 点击空白区域：非追加模式下清空选中
        if (!additive) {
          sel.clearSelection();
          requestRender();
        }
        return;
      }
      if (additive) {
        // Ctrl+点击：切换选中状态
        if (sel.isSelected(hit.objectId)) {
          sel.deselect(hit.objectId);
        } else {
          sel.select(hit.objectId, true);
        }
      } else {
        sel.clearSelection();
        sel.select(hit.objectId, false);
      }
      requestRender();
      return;
    }

    if (!hit) {
      // 点击空白区域：非追加模式下清空选中
      if (!additive) {
        const prev = compat.scene.selectedObjectIds;
        if (prev.length > 0) {
          compat.scene.setObjectsSelected(prev, false);
        }
        selectionStore.clearSelection();
        requestRender();
      }
      return;
    }

    const refno = parseRefnoFromObjectId(hit.objectId);
    if (!refno) return;

    if (additive) {
      // Ctrl+点击：切换选中状态
      const wasSelected = selectionStore.isSelected(refno);
      selectionStore.toggleSelectedRefno(refno);
      compat.scene.ensureRefnos([refno]);
      compat.scene.setObjectsSelected([refno], !wasSelected);
    } else {
      // 普通点击：单选（清空之前的选中）
      const prev = compat.scene.selectedObjectIds;
      if (prev.length > 0) {
        compat.scene.setObjectsSelected(prev, false);
      }
      selectionStore.setSelectedRefno(refno);
      compat.scene.ensureRefnos([refno]);
      compat.scene.setObjectsSelected([refno], true);
    }
    requestRender();
  };

  const onCancel = (e: PointerEvent) => {
    void e;
    clickState.down = null;
    clickState.moved = false;
    clickState.pointerId = null;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  (attachPicking as any)._cleanup = () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
  };
}

function detachPicking() {
  const cleanup = (attachPicking as any)._cleanup as (() => void) | undefined;
  cleanup?.();
  delete (attachPicking as any)._cleanup;
}

function attachToolsInput() {
  const canvas = mainCanvas.value;
  const tools = toolsRef.value;
  if (!canvas || !tools) return;

  const onDown = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) return;
    tools.onCanvasPointerDown(canvas, e);
    requestRender();
  };
  const onMove = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) return;
    tools.onCanvasPointerMove(canvas, e);
    requestRender();
  };
  const onUp = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) return;
    tools.onCanvasPointerUp(canvas, e);
    requestRender();
  };
  const onCancel = (e: PointerEvent) => {
    tools.onCanvasPointerCancel(canvas, e);
    requestRender();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  offToolsInput = () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
  };
}

function detachToolsInput() {
  offToolsInput?.();
  offToolsInput = null;
}

function getDimensionStorageScope(): string {
  const params = new URLSearchParams(window.location.search);
  const project = getOutputProjectFromUrl()
    || params.get('project_id')
    || '__default__';
  return `project=${project}|db=${params.get('show_dbnum') || '__all__'}`;
}

function getDimensionDocumentContext() {
  const task = reviewStore.currentTask.value;
  const formId = task?.formId?.trim() || undefined;
  const taskId = task?.id?.trim() || undefined;
  const localScope = getDimensionStorageScope();
  return {
    documentId: formId
      ? `dimension-document:form:${formId}`
      : taskId
        ? `dimension-document:task:${taskId}`
        : localDimensionDocumentId(localScope),
    taskId,
    formId,
    localScope,
  };
}

function createViewerDimensionRepository() {
  const repositoryContext = getDimensionDocumentContext();
  const localRepository = repositoryContext.taskId
    ? null
    : new LocalStorageDimensionDocumentRepository(
      window.localStorage,
      repositoryContext.localScope,
    );
  const apiRepository = new ReviewDimensionRepository({
    async loadRecords(context) {
      if (!context.taskId) return [];
      const response = await reviewRecordGetByTaskId(context.taskId, {
        formId: context.formId,
      });
      if (!response.success) {
        throw new Error(response.error_message || '加载尺寸校审记录失败');
      }
      return response.records ?? [];
    },
    async buildBaseRecord() {
      const context = getDimensionDocumentContext();
      if (!context.taskId) throw new Error('当前未关联校审任务');
      const payload = buildReviewConfirmSnapshotPayload({
        annotations: [...store.annotations.value],
        cloudAnnotations: [...store.cloudAnnotations.value],
        rectAnnotations: [...store.rectAnnotations.value],
        obbAnnotations: [...store.obbAnnotations.value],
        measurements:
          [...store.measurements.value] as ReviewSnapshotMeasurementPayload[],
        unifiedMeasurements: [...(store.unifiedMeasurements?.value ?? [])],
        legacyMeasurements: [...(store.legacyMeasurements?.value ?? [])],
        xeokitDistanceMeasurements: [...store.xeokitDistanceMeasurements.value],
        xeokitAngleMeasurements: [...store.xeokitAngleMeasurements.value],
        xeokitElevationPointMeasurements: [...store.xeokitElevationPointMeasurements.value],
        xeokitElevationDeltaMeasurements: [...store.xeokitElevationDeltaMeasurements.value],
      });
      return {
        taskId: context.taskId,
        formId: context.formId,
        type: 'batch' as const,
        annotations: payload.annotations as ReviewSnapshotAnnotationPayload[],
        cloudAnnotations:
          payload.cloudAnnotations as ReviewSnapshotAnnotationPayload[],
        rectAnnotations:
          payload.rectAnnotations as ReviewSnapshotAnnotationPayload[],
        obbAnnotations:
          payload.obbAnnotations as ReviewSnapshotAnnotationPayload[],
        measurements:
          payload.measurements as ReviewSnapshotMeasurementPayload[],
        note: '尺寸文档保存',
      };
    },
    saveRecord: reviewRecordCreate,
  });
  return {
    async load(context: { taskId?: string; formId?: string }) {
      const fallbackContext = getDimensionDocumentContext();
      const loaded = localRepository
        ? await localRepository.load(context)
        : context.taskId
          ? await apiRepository.load(context)
          : createEmptyDimensionDocument({
            documentId: fallbackContext.documentId,
            ...context,
          });
      if (loaded.records.length > 0 || loaded.baseVersion > 0) return loaded;
      const archives = loadArchivedDimensionArchives(
        window.localStorage,
        getDimensionStorageScope(),
      );
      if (archives.length === 0) return loaded;
      const user = userStore.currentUser.value;
      const migrated = migrateLegacyDimensionArchives(archives, {
        documentId: loaded.documentId,
        taskId: context.taskId,
        formId: context.formId,
        actorId: user?.id || 'legacy-migration',
        actorRole: String(user?.role || 'designer'),
      }).state;
      if (!localRepository) return migrated;
      const saved = await localRepository.save(migrated);
      return saved.ok ? saved.state : migrated;
    },
    save: (state: DimensionDocumentState) => (
      localRepository?.save(state) ?? apiRepository.save(state)
    ),
  };
}

function stopLocalDimensionAutosave(): void {
  offLocalDimensionAutosave?.();
  offLocalDimensionAutosave = null;
  if (localDimensionAutosaveTimer !== null) {
    clearTimeout(localDimensionAutosaveTimer);
    localDimensionAutosaveTimer = null;
  }
  localDimensionAutosaveRunning = false;
}

function bindLocalDimensionAutosave(system: DimensionSystem): void {
  stopLocalDimensionAutosave();
  const persist = async (): Promise<void> => {
    localDimensionAutosaveTimer = null;
    if (
      localDimensionAutosaveRunning
      || !system.document.dirty
      || system.hasPendingRecovery()
    ) return;
    localDimensionAutosaveRunning = true;
    try {
      const result = await system.persistDocument({ preserveHistory: true });
      if (!result) return;
      if (!result.ok) {
        if (result.reason === 'conflict') {
          system.stageRecovery(result.latest);
          emitToast({
            message: '本地尺寸草稿已在其他窗口更新，请在尺寸面板中处理冲突',
            level: 'warning',
          });
        } else {
          emitToast({
            message: `本地尺寸草稿保存失败：${result.message}`,
            level: 'error',
          });
        }
        return;
      }
      if (system.document.dirty) schedule();
    } finally {
      localDimensionAutosaveRunning = false;
    }
  };
  const schedule = (): void => {
    if (localDimensionAutosaveTimer !== null) {
      clearTimeout(localDimensionAutosaveTimer);
    }
    localDimensionAutosaveTimer = setTimeout(() => void persist(), 400);
  };
  offLocalDimensionAutosave = system.document.subscribe(() => schedule());
}

async function initializeDimensionViewport(): Promise<void> {
  const initializationVersion = ++dimensionInitializationVersion;
  const inputCanvas = mainCanvas.value;
  const container = containerRef.value;
  if (!inputCanvas || !container) return;

  dimensionSystem?.dispose();
  dimensionSystem = null;
  stopLocalDimensionAutosave();
  offDimensionReviewBinding?.();
  offDimensionReviewBinding = null;
  offDimensionSelectionBinding?.();
  offDimensionSelectionBinding = null;
  viewerContext.dimensionSystem.value = null;

  const context = getDimensionDocumentContext();
  const anchorResolver = new DtxDimensionAnchorResolver({
    loadCandidates: async (refno) => {
      const candidates = await xeokitMeasurementToolsRef.value
        ?.loadDimensionAnchorCandidates(refno) ?? [];
      return candidates.map(candidate => ({
        id: candidate.id,
        point: sceneWorldToDesignMetres(candidate.sceneWorld),
        accuracy: candidate.source === 'mesh_pick_point'
          ? 'approximate' as const
          : 'exact' as const,
        ...(candidate.direction
          ? { direction: sceneDirectionToDesign(candidate.direction) }
          : {}),
        ...(candidate.circle
          ? {
            circle: {
              center: sceneWorldToDesignMetres(candidate.circle.center),
              rim: sceneWorldToDesignMetres(candidate.circle.rim),
              normal: sceneDirectionToDesign(candidate.circle.normal),
            },
          }
          : {}),
        ...(candidate.arc
          ? {
            arc: {
              center: sceneWorldToDesignMetres(candidate.arc.center),
              rim: sceneWorldToDesignMetres(candidate.arc.rim),
              normal: sceneDirectionToDesign(candidate.arc.normal),
            },
          }
          : {}),
      }));
    },
  });
  const result = await createDimensionSystem({
    inputCanvas,
    viewer: dimensionViewerAdapter,
    journal: new LocalStorageDimensionCommandJournal(window.localStorage),
    context,
    repository: createViewerDimensionRepository(),
    snapPort: new DtxDimensionSnapPort({
      queryMeasurementCandidates: screen => (
        xeokitMeasurementToolsRef.value?.queryDimensionSnapCandidates(
          inputCanvas,
          screen,
        ) ?? []
      ),
      sceneWorldToDesignMetres,
    }),
    anchorResolver,
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id),
  });
  if (!result.ok) {
    (window as any).__dimensionSystemError = `${result.stage}: ${
      result.error instanceof Error ? result.error.message : String(result.error)
    }`;
    console.warn(
      '[dimension-v2] Development viewport initialization failed',
      result.stage,
      result.error,
    );
    return;
  }
  if (
    dimensionMountDisposed
    || initializationVersion !== dimensionInitializationVersion
  ) {
    result.system.dispose();
    return;
  }

  dimensionSystem = result.system;
  result.system.pointer.setEditSessionFactory((target) => {
    if (!['label', 'dimension', 'arc', 'leader'].includes(target.part)) {
      return null;
    }
    const record = result.system.document.state.records.find(
      item => item.id === target.dimensionId,
    );
    const user = userStore.currentUser.value;
    if (
      !record
      || !user
      || !canEditUserDimension(
        { id: user.id, role: String(user.role) },
        record,
      )
    ) {
      return null;
    }
    return createPlacementEditSession({
      record,
      actor: { actorId: user.id, actorRole: String(user.role) },
      createCommandId: () => nextDimensionId('dimension-command'),
      now: Date.now,
      onPreview: preview => result.system.viewport.setPreview(preview),
      placementAt: screen => result.system.viewport.placementAtScreen(
        record,
        screen,
      ),
    });
  });
  result.system.pointer.setCommitResultHandler((outcome) => {
    if (outcome.ok) return;
    const detail = outcome.reason === 'exception'
      ? outcome.error instanceof Error
        ? outcome.error.message
        : String(outcome.error)
      : outcome.reason;
    emitToast({ message: `尺寸修改失败：${detail}`, level: 'error' });
  });
  delete (window as any).__dimensionSystemError;
  offDimensionReviewBinding =
    useReviewStore().bindDimensionDocumentSession(result.system.document);
  if (!context.taskId) bindLocalDimensionAutosave(result.system);
  // 测量草稿进行中落点优先：暂停尺寸的悬停/左键选中（E3D 心智）。
  result.system.pointer.setInteractionGate(
    () => !xeokitMeasurementToolsRef.value?.currentMeasurement.value,
  );
  // 反向选择绑定：场景中点选尺寸图形 → 选中对应 xeokit 测量记录。
  offDimensionSelectionBinding = result.system.viewport.subscribeSelection((id) => {
    xeokitMeasurementToolsRef.value?.handleDimensionSelectionChange(id);
  });
  viewerContext.dimensionSystem.value = result.system;
  result.system.notifyViewerChanged();
  syncBranClearanceDimensions();
}

const measurementContextMenu = ref<{ x: number; y: number; id: string } | null>(null);
const measurementContextMenuRecord = computed(() => {
  const state = measurementContextMenu.value;
  if (!state) return null;
  return store.allXeokitMeasurements.value.find((item) => item.id === state.id) ?? null;
});

function closeMeasurementContextMenu(): void {
  measurementContextMenu.value = null;
}

/** 右键测量尺寸图形（canvas contextmenu + dimension hitTest）打开菜单。 */
function onViewerContextMenu(ev: MouseEvent): void {
  const system = viewerContext.dimensionSystem.value;
  const canvas = mainCanvas.value;
  const container = containerRef.value;
  if (!system || !canvas || !container) return;
  if (isModelUnitSplitCompareReady()) return;

  const rect = canvas.getBoundingClientRect();
  system.viewport.flushProjection();
  const hit = system.viewport.hitTest(
    [ev.clientX - rect.left, ev.clientY - rect.top],
    8,
  );
  const dimensionId = hit?.dimensionId ?? null;
  if (!dimensionId?.startsWith(DIMENSION_XEOKIT_PREFIX)) return;
  const measurementId = xeokitMeasurementToolsRef.value
    ?.resolveMeasurementIdFromDimensionId(dimensionId) ?? null;
  if (!measurementId) return;

  ev.preventDefault();
  ev.stopImmediatePropagation();
  system.viewport.setSelection(dimensionId);
  const containerRect = container.getBoundingClientRect();
  measurementContextMenu.value = {
    x: Math.min(ev.clientX - containerRect.left, Math.max(0, containerRect.width - 240)),
    y: Math.min(ev.clientY - containerRect.top, Math.max(0, containerRect.height - 340)),
    id: measurementId,
  };
  requestRender();
}

async function copyMeasurementText(text: string | null, successMessage: string): Promise<void> {
  if (!text) {
    emitToast({ message: '当前测量缺少可复制的数据', level: 'warning' });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    emitToast({ message: successMessage, level: 'success' });
  } catch {
    emitToast({ message: '复制失败：浏览器未授权剪贴板访问', level: 'error' });
  }
}

function onMeasurementMenuToggleAxis(): void {
  measurementStyle.updateStyle({
    distanceShowAxisBreakdown: !measurementStyle.state.distanceShowAxisBreakdown,
  });
}

function onMeasurementMenuChangeUnit(unit: LengthUnit): void {
  unitSettings.setDisplayUnit(unit);
}

function onMeasurementMenuCopyValue(): void {
  const record = measurementContextMenuRecord.value;
  if (!record) return;
  void copyMeasurementText(
    buildMeasurementValueText(record, unitSettings.displayUnit.value, unitSettings.precision.value),
    '测量值已复制',
  );
  closeMeasurementContextMenu();
}

function onMeasurementMenuCopyComponents(): void {
  const record = measurementContextMenuRecord.value;
  if (!record) return;
  void copyMeasurementText(
    buildMeasurementComponentsText(record, unitSettings.displayUnit.value, unitSettings.precision.value),
    '轴向分量已复制',
  );
  closeMeasurementContextMenu();
}

function onMeasurementMenuRepeat(): void {
  const repeated = xeokitMeasurementToolsRef.value?.repeatLastDistanceMeasurement() ?? false;
  if (!repeated) {
    emitToast({
      message: '无法继续测量：请先进入距离测量模式，且当前没有进行中的草稿',
      level: 'warning',
    });
  }
  closeMeasurementContextMenu();
  requestRender();
}

function onMeasurementMenuLocate(): void {
  const record = measurementContextMenuRecord.value;
  if (record) xeokitMeasurementToolsRef.value?.flyToMeasurement(record.id);
  closeMeasurementContextMenu();
}

function onMeasurementMenuToggleVisible(): void {
  const record = measurementContextMenuRecord.value;
  if (record) {
    xeokitMeasurementToolsRef.value?.setMeasurementVisible(record.id, !record.visible);
  }
  closeMeasurementContextMenu();
}

function onMeasurementMenuRemove(): void {
  const record = measurementContextMenuRecord.value;
  if (record) xeokitMeasurementToolsRef.value?.removeMeasurement(record.id);
  closeMeasurementContextMenu();
}

watch(
  () => [
    reviewStore.currentTask.value?.id ?? null,
    reviewStore.currentTask.value?.formId ?? null,
  ],
  () => {
    void initializeDimensionViewport();
  },
  { flush: 'post' },
);

/**
 * 处理容器尺寸变化：同步渲染方案
 * 在 setSize 后立即渲染一帧，消除黑屏闪烁
 */
function handleResize() {
  const el = containerRef.value;
  const dtxViewer = dtxViewerRef.value;
  if (!el || !dtxViewer) return;

  const rect = el.getBoundingClientRect();
  dtxViewer.setSize(rect.width, rect.height);
  selectionControllerRef.value?.resize(rect.width, rect.height);
  tileLodControllerRef.value?.setViewportSize(rect.width, rect.height);
  dimensionSystem?.notifyViewerChanged();

  // 更新三维标注系统的分辨率（LineMaterial 需要）
  annotationSystemRef.value?.setResolution(rect.width, rect.height);
  // 更新 overlay 标注分辨率（LineMaterial + CSS2DRenderer 需要）
  // 更新全局工程边线分辨率（LineMaterial 需要）
  globalEdgeOverlayRef.value?.setResolution(rect.width, rect.height);

  // 立即同步渲染一帧，避免黑屏闪烁
  renderFrameImmediate();
}

/**
 * 立即渲染一帧（同步执行，用于 resize 后防闪烁）
 */
function renderFrameImmediate() {
  const dtxViewer = dtxViewerRef.value;
  const dtxLayer = dtxLayerRef.value;
  if (!dtxViewer || !dtxLayer) return;

  cadGridRef.value?.update(dtxViewer.controls.target);
  ensureLayerAttached();
  dtxLayer.update(dtxViewer.camera);
  updateShowDbnumExtraLayers(dtxViewer);

  // resize 会改变 aspect/projectionMatrix，需更新视锥裁剪与 LOD（避免“旧裁剪状态”）
  viewCullControllerRef.value?.update(dtxViewer.camera);
  tileLodControllerRef.value?.requestUpdate(dtxViewer.camera);

  // 更新动态 pivot 控制器
  pivotControllerRef.value?.update();

  syncGlobalEdgeOverlay();

  const annotationSystem = annotationSystemRef.value;
  annotationSystem?.update(dtxViewer.camera);

  // 与 renderFrame 同序：工具层几何先按本帧相机 / 新尺寸重建，再渲染，标签与线条首帧就不错位
  const splitCompareReady = isModelUnitSplitCompareReady();
  if (!splitCompareReady) {
    dtxViewer.camera.updateMatrixWorld();
    toolsRef.value?.updateOverlayPositions();
  }

  const selection = selectionControllerRef.value;
  if (renderModelUnitCompareScene(dtxViewer)) {
    // 分屏共享同一场景和相机；版本层显隐由两个 viewport 的 render pass 控制。
  } else if (selection?.hasOutline()) {
    selection.renderOutline();
    renderDimensionOverlay(dtxViewer);
  } else {
    dtxViewer.renderer.render(dtxViewer.scene, dtxViewer.camera);
    renderDimensionOverlay(dtxViewer);
  }

  try {
    dtxViewer.gizmo?.render();
  } catch {
    // ignore
  }

  if (!splitCompareReady) {
    ptsetVisRef.value?.updateLabelPositions();
    annotationSystem?.renderLabels(dtxViewer.scene, dtxViewer.camera);
  }
}

let needsRender = true;
let isRendering = false;
const tmpCameraPos = new Vector3();
const tmpCameraTarget = new Vector3();
const tmpProjMatrix = new Matrix4();
let hasLastProjMatrix = false;
const CAMERA_EPS_SQ = 1e-12;

function scheduleFrame() {
  if (rafId !== null) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = null;
    renderFrame();
  });
}

function requestRender() {
  needsRender = true;
  scheduleFrame();
}

function renderFrame() {
  if (isRendering) return;
  isRendering = true;
  try {
    const dtxViewer = dtxViewerRef.value;
    const dtxLayer = dtxLayerRef.value;
    if (!dtxViewer || !dtxLayer) return;

    // 计算相机是否变化（支持 enableDamping / flyTo / resize 后的按需刷新）
    tmpCameraPos.copy(dtxViewer.camera.position);
    tmpCameraTarget.copy(dtxViewer.controls.target);
    if (!hasLastProjMatrix) {
      tmpProjMatrix.copy(dtxViewer.camera.projectionMatrix);
      hasLastProjMatrix = true;
    }
    dtxViewer.controls.update();
    const posDeltaSq = tmpCameraPos.distanceToSquared(
      dtxViewer.camera.position,
    );
    const targetDeltaSq = tmpCameraTarget.distanceToSquared(
      dtxViewer.controls.target,
    );
    const projChanged = !tmpProjMatrix.equals(dtxViewer.camera.projectionMatrix);
    const cameraChanged =
            posDeltaSq > CAMERA_EPS_SQ || targetDeltaSq > CAMERA_EPS_SQ || projChanged;
    if (projChanged) tmpProjMatrix.copy(dtxViewer.camera.projectionMatrix);

    if (!needsRender && !cameraChanged && !continuousRender) return;

    // CAD Grid（跟随 target 进行 snapping，模拟“无限地面网格”）
    cadGridRef.value?.update(dtxViewer.controls.target);

    ensureLayerAttached();
    dtxLayer.update(dtxViewer.camera);
    updateShowDbnumExtraLayers(dtxViewer);
    if (cameraChanged) {
      viewCullControllerRef.value?.update(dtxViewer.camera);
      tileLodControllerRef.value?.requestUpdate(dtxViewer.camera);
      dimensionSystem?.notifyViewerChanged();
    }

    syncGlobalEdgeOverlay();

    const annotationSystem = annotationSystemRef.value;
    annotationSystem?.update(dtxViewer.camera);

    const splitCompareReady = isModelUnitSplitCompareReady();
    if (!splitCompareReady) {
      // 工具层几何（云线轮廓 / 引线 / 盒边）要在本帧渲染**之前**按本帧相机重建：
      // 云线轮廓是贴在 ndcZ = 0（离相机约一个 near 距离）的 billboard 折线，若先渲染再更新，
      // 相机运动中每一帧画的都是上一帧相机前面那一小片，早已落到本帧近平面之外——轮廓在拖动期间整段消失、
      // 停下才出现。controls.update() 只改 position / quaternion，先把 matrixWorld / matrixWorldInverse 算出来再投影。
      dtxViewer.camera.updateMatrixWorld();
      toolsRef.value?.updateOverlayPositions();
    }

    const selection = selectionControllerRef.value;
    if (renderModelUnitCompareScene(dtxViewer)) {
      // 分屏共享同一场景和相机；版本层显隐由两个 viewport 的 render pass 控制。
    } else if (selection?.hasOutline()) {
      selection.renderOutline();
      renderDimensionOverlay(dtxViewer);
    } else {
      dtxViewer.renderer.render(dtxViewer.scene, dtxViewer.camera);
      renderDimensionOverlay(dtxViewer);
    }

    // ViewportGizmo 需要在主场景渲染后再渲染（会改 viewport/scissor）
    try {
      dtxViewer.gizmo?.render();
    } catch {
      // ignore
    }

    if (!splitCompareReady) {
      ptsetVisRef.value?.updateLabelPositions();

      // 三维标注系统更新
      annotationSystem?.renderLabels(dtxViewer.scene, dtxViewer.camera);
    }

    needsRender = false;

    if (continuousRender || cameraChanged || needsRender) {
      scheduleFrame();
    }
  } finally {
    isRendering = false;
  }
}

function openSpatialQueryDrawer(mode: 'range' | 'distance' = 'distance', options?: { useSelection?: boolean; autoSubmit?: boolean }): void {
  spatialQueryStore.setMode(mode);
  spatialQueryOpen.value = true;
  toolbarSettingsOpen.value = false;

  if (mode === 'range' && options?.useSelection) {
    spatialQueryStore.applyCurrentSelection();
  }

  if (options?.autoSubmit) {
    void spatialQueryStore.submitQuery(1);
  }
}

function onToolbarSpatialQueryClick(): void {
  openSpatialQueryDrawer(spatialQueryStore.draft.mode);
}

function onToolbarPipeNetworkClick(): void {
  emitToast({ message: '管网（BRAN）功能建设中（占位）' });
}

function toggleToolbarSettings(): void {
  toolbarSettingsOpen.value = !toolbarSettingsOpen.value;
  if (toolbarSettingsOpen.value) {
    spatialQueryOpen.value = false;
  }
}

function handleOpenSpatialQueryEvent(event: Event): void {
  const detail = (event as CustomEvent<{ mode?: 'range' | 'distance'; useSelection?: boolean; autoSubmit?: boolean }>).detail;
  openSpatialQueryDrawer(detail?.mode ?? 'distance', {
    useSelection: detail?.useSelection,
    autoSubmit: detail?.autoSubmit,
  });
}

onMounted(async () => {
  const canvas = mainCanvas.value;
  const container = containerRef.value;
  if (!canvas || !container) return;

  canvas.addEventListener('contextmenu', onViewerContextMenu, true);

  initError.value = null;
  needsRender = true;
  attachedToScene = false;
  shaderPrecompiled = false;
  continuousRender = false;
  dimensionMountDisposed = false;
  annotationVectorTextRebuildCount = 0;
  demoMode = 'none';
  demoPrimitiveCount = 1000;
  cadGridEnabled = true;
  cameraViewMode.value = 'cad_weak';
  globalEdgeEnabled.value = false;
  globalEdgeThresholdAngle.value = 20;
  focusTransparencyEnabled.value = false;
  focusDimOpacityPercent.value = 20;
  try {
    // DEV: localStorage.setItem('dtx_continuous_render','1') 可打开持续渲染（用于 profile）
    continuousRender =
            isDev && localStorage.getItem('dtx_continuous_render') === '1';

    const q = new URLSearchParams(window.location.search);
    const demo = String(
      q.get('dtx_demo') || localStorage.getItem('dtx_demo') || '',
    ).toLowerCase();
    if (demo === 'primitives') {
      demoMode = 'primitives';
      const cntRaw =
                q.get('dtx_demo_count') ||
                localStorage.getItem('dtx_demo_count') ||
                '1000';
      const cnt = Number(cntRaw);
      if (Number.isFinite(cnt) && cnt > 0) {
        demoPrimitiveCount = Math.floor(cnt);
      }
    }

    const gridRaw = q.get('dtx_grid') || localStorage.getItem('dtx_grid');
    if (gridRaw !== null && gridRaw !== undefined) {
      cadGridEnabled = String(gridRaw).trim() !== '0';
    }

    const cameraModeRaw =
            q.get('dtx_camera_mode') || localStorage.getItem('dtx_camera_mode');
    if (
      cameraModeRaw === 'cad_weak' ||
            cameraModeRaw === 'cad_flat' ||
            cameraModeRaw === 'normal'
    ) {
      cameraViewMode.value = cameraModeRaw;
    }

    const globalEdgesRaw =
            q.get('dtx_global_edges') || localStorage.getItem('dtx_global_edges');
    if (globalEdgesRaw !== null && globalEdgesRaw !== undefined) {
      globalEdgeEnabled.value = String(globalEdgesRaw).trim() !== '0';
    }

    const edgeAngleRaw =
            q.get('dtx_edge_angle') || localStorage.getItem('dtx_edge_angle');
    if (edgeAngleRaw !== null && edgeAngleRaw !== undefined) {
      globalEdgeThresholdAngle.value = clampGlobalEdgeThresholdAngle(
        Number(edgeAngleRaw),
      );
    }

    const focusTransparencyRaw =
            q.get('dtx_focus_transparency') || localStorage.getItem('dtx_focus_transparency');
    if (focusTransparencyRaw !== null && focusTransparencyRaw !== undefined) {
      focusTransparencyEnabled.value = String(focusTransparencyRaw).trim() !== '0';
    }

    const focusOpacityRaw =
            q.get('dtx_focus_opacity') || localStorage.getItem('dtx_focus_opacity');
    if (focusOpacityRaw !== null && focusOpacityRaw !== undefined) {
      focusDimOpacityPercent.value = clampFocusDimOpacityPercent(
        Number(focusOpacityRaw),
      );
    }
  } catch {
    // ignore
  }

  let dtxViewer: DtxViewer;
  try {
    dtxViewer = new DtxViewer({
      canvas,
      background: 0xe5e7eb,
      debug: isDev,
      gizmo: { enabled: true, placement: 'top-right', size: 100 },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    initError.value = msg;
    emitToast({ message: msg });
    return;
  }
  dtxViewerRef.value = dtxViewer;
  applyBackground(backgroundStore.mode.value);
  applyCameraViewMode(cameraViewMode.value);

  // CAD Grid：Three.js 常规渲染对象（与 DTX 混合渲染）
  try {
    const cadGrid = new CadGrid({
      enabled: cadGridEnabled,
      followTarget: true,
      initialSize: getDefaultCadGridSizeByUnit(unitSettings.modelUnit.value),
    });
    dtxViewer.scene.add(cadGrid.group);
    cadGridRef.value = cadGrid;
  } catch (e) {
    console.warn('[ViewerPanel] CAD grid 初始化失败', e);
  }

  const isShowDbnumModeAtInit = (() => {
    try {
      return new URLSearchParams(window.location.search).has('show_dbnum');
    } catch {
      return false;
    }
  })();
  const dtxLayer = new DTXLayer({
    renderer: dtxViewer.renderer,
    debug: isDev,
    ...(isShowDbnumModeAtInit ? SHOW_DBNUM_DTX_LAYER_OPTIONS : {}),
  });
  dtxLayer.setRenderer(dtxViewer.renderer);
  dtxLayerRef.value = dtxLayer;

  // 全局工程边线：深灰细线（无填充），用于接近 CAD 轮廓观感
  const globalEdgeOverlay = new DTXOverlayHighlighter(dtxViewer.scene, {
    showFill: false,
    edgeColor: 0x4b5563,
    edgeOpacity: 1,
    edgeLineWidth: 1,
    edgeThresholdAngle: 20,
    edgeAlwaysOnTop: false,
  });
  globalEdgeOverlay.setResolution(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
  globalEdgeOverlay.setGeometryGetter((objectId) =>
    dtxLayer.getObjectGeometryData(objectId),
  );
  globalEdgeOverlayRef.value = globalEdgeOverlay;
  lastGlobalEdgeRevision = -1;
  applyGlobalEdgeStyle();

  // 显示加速：View Frustum Culling（按对象 AABB）
  viewCullControllerRef.value = new DTXViewCullController({ dtxLayer });

  // 显示加速：Tile LOD（manifest.groups）
  tileLodControllerRef.value = new DTXTileLodController({
    dtxLayer,
    debug: isDev,
    requestRender,
  });
  try {
    const cfg = readDtxTileLodConfigFromUrl();
    tileLodControllerRef.value.setConfig(cfg);
  } catch {
    // ignore
  }

  const selectionController = new DTXSelectionController({
    dtxLayer,
    scene: dtxViewer.scene,
    camera: dtxViewer.camera,
    renderer: dtxViewer.renderer,
    container: canvas,
    selectionColor: 0xff4fd8,
    enableOutline: true,
    highlightMode: 'outline',
    outlineStyle: {
      edgeColor: 0xff9ae8,
      edgeStrength: 1.6,
      edgeGlow: 0,
      edgeThickness: 1.0,
      pulsePeriod: 0,
    },
  });
  selectionControllerRef.value = selectionController;

  // 初始化动态 Pivot 控制器
  const pivotController = new DynamicPivotController(
    dtxViewer.controls,
    selectionController,
    dtxLayer,
    dtxViewer.scene,
    {
      enabled: true,
      longPressDelay: 300,
      pinColor: '#FF6B35',
      pinSize: 32,
    }
  );
  pivotControllerRef.value = pivotController;

  if (demoMode === 'primitives') {
    try {
      loadDtxPrimitiveDemo(dtxLayer, {
        objectCount: demoPrimitiveCount,
      });
      ensureLayerAttached();
      selectionController.refreshSpatialIndex();

      const box = dtxLayer.getBoundingBox();
      cadGridRef.value?.fitToBoundingBox(box);
      const center = new Vector3();
      const size = new Vector3();
      box.getCenter(center);
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const distance = Math.max(maxDim * 2.5, 5);
      const position = new Vector3(
        center.x + distance * 0.8,
        center.y + distance * 0.6,
        center.z + distance * 0.8,
      );
      dtxViewer.flyTo(position, center, { duration: 0 });
      requestRender();
    } catch (e) {
      console.warn('[ViewerPanel] primitives demo 初始化失败', e);
    }
  }

  const compat = new DtxCompatViewer({
    dtxViewer,
    dtxLayer,
    selection: selectionController,
    requestRender,
  });
  compat.scene.setAutoFocusTransparencyEnabled(focusTransparencyEnabled.value, {
    dimOpacity: focusDimOpacityPercent.value / 100,
  });
  // 让 useModelGeneration 能识别 DTX 后端
  (compat as any).__dtxLayer = dtxLayer;
  (window as any).__dtxLayer = dtxLayer;
  (compat as any).__dtxAfterInstancesLoaded = (
    _dbno: number,
    loadedRefnos: string[],
  ) => {
    activeDbno = _dbno;
    clearBranClearanceAnnotations();
    spatialComputeStore.resetScenario('branNearestClearance');
    // 测试/自动化：暴露最近一次加载的 refno 列表，便于 Playwright 精确做期望值计算。
    (compat as any).__dtxLastLoadedDbno = _dbno;
    (compat as any).__dtxLastLoadedRefnos = loadedRefnos;
    // 按需实例加载：把树侧已有的可见/选中状态回放到新加载的对象（避免默认 visible=true 覆盖）
    compat.scene.applyStateToRefnos(loadedRefnos, { computeAabb: false });

    // 单位归一化（mm -> m）与原点重定位：降低大坐标与 z-fighting 风险
    try {
      applyDtxGlobalTransformOnce(_dbno, dtxLayer);
    } catch (e) {
      console.warn('[ViewerPanel] DTX 全局变换应用失败', e);
    }

    // 相机裁剪面按 bbox 尺寸分档收紧，提升深度精度
    try {
      applyDtxCameraClipByLayerBBox(dtxViewer, dtxLayer);
    } catch (e) {
      console.warn('[ViewerPanel] 相机裁剪面自适应失败', e);
    }

    // 按需在首次加载后 auto-fit（需在单位归一化后执行）
    try {
      fitToDtxLayerBBoxOnce(_dbno, dtxViewer, dtxLayer);
    } catch (e) {
      console.warn('[ViewerPanel] auto-fit 失败', e);
    }

    try {
      cadGridRef.value?.fitToBoundingBox(dtxLayer.getBoundingBox());
    } catch {
      // ignore
    }
    ensureLayerAttached();
    selectionController.refreshSpatialIndex();
    toolsRef.value?.refreshReadyState();
    xeokitMeasurementToolsRef.value?.refreshReadyState();
    try {
      viewCullControllerRef.value?.refreshSpatialIndex();
      viewCullControllerRef.value?.update(dtxViewer.camera);
    } catch {
      // ignore
    }
    try {
      tileLodControllerRef.value?.onGlobalModelMatrixChanged();
    } catch {
      // ignore
    }

    // Tile LOD：仅在首次切换到该 dbno 时初始化（Parquet 模式下不再读取 instances_*.json）
    if (tileLodInitializedDbno !== _dbno) {
      tileLodInitializedDbno = _dbno;
      tileLodControllerRef.value?.setManifest(_dbno, {
        dbno: _dbno,
        source: 'parquet',
      });
      tileLodControllerRef.value?.requestUpdate(dtxViewer.camera);
      requestRender();
    }
    if (dimensionSystem) {
      void dimensionSystem.refreshAnchors().then((report) => {
        if (report.invalidated > 0) {
          emitToast({
            message: `${report.invalidated} 条尺寸因模型锚点缺失已标记为 STALE`,
            level: 'warning',
          });
        }
      }).catch((error) => {
        console.warn('[dimension-v2] anchor refresh failed', error);
      });
    }
    requestRender();
  };
  compatViewerRef.value = compat;
  modelGenerationRef.value = useModelGeneration({ viewer: compat });

  const tools = useDtxTools({
    dtxViewerRef,
    dtxLayerRef,
    selectionRef: selectionControllerRef,
    overlayContainerRef: overlayContainer,
    store,
    compatViewerRef,
    requestRender,
    suppressStoreOverlays: false,
    // 管-墙/柱净距测量的结果写进 Dock 的 BRAN 净距那一份（同一张表、同一个 bran-clearance external source）
    recordBranClearance: spatialComputeStore.recordInteractiveBranClearance,
    // 管-管间距（两条 BRAN 平行直段的中心距）也写进同一份，一对平行直段一条
    recordBranParallelSpacing: spatialComputeStore.recordBranParallelSpacing,
  });
  toolsRef.value = tools;
  tools.refreshReadyState();

  const xeokitMeasurementTools = useXeokitMeasurementTools({
    dtxViewerRef,
    dtxLayerRef,
    selectionRef: selectionControllerRef,
    overlayContainerRef: overlayContainer,
    annotationSystemRef,
    getDimensionSystem: () => viewerContext.dimensionSystem.value,
    sceneWorldToDesignMetres,
    store,
    compatViewerRef,
    requestRender,
    suppressStoreMeasurements: false,
  });
  xeokitMeasurementToolsRef.value = xeokitMeasurementTools;
  xeokitMeasurementTools.refreshReadyState();

  const ptsetVis = usePtsetVisualizationThree(
    dtxViewerRef,
    overlayContainer,
    {
      requestRender,
      getGlobalModelMatrix: () =>
        dtxLayerRef.value?.getGlobalModelMatrix() ?? null,
    },
  );
  ptsetVisRef.value = ptsetVis;

  // 三维标注系统初始化
  const annotationSystem = useAnnotationThree(dtxViewerRef, overlayContainer, {
    requestRender,
    getGlobalModelMatrix: () =>
      dtxLayerRef.value?.getGlobalModelMatrix() ?? null,
  });
  annotationSystemRef.value = annotationSystem;
  offBranClearanceWatch?.();
  offBranClearanceWatch = watch(
    () => ({
      loading: spatialComputeStore.scenarios.branNearestClearance.loading,
      error: spatialComputeStore.scenarios.branNearestClearance.error,
      responseText: spatialComputeStore.scenarios.branNearestClearance.responseText,
      candidates: spatialComputeStore.scenarios.branNearestClearance.annotationCandidates.slice(),
    }),
    ({ loading, error, candidates }) => {
      if (loading || error || candidates.length === 0) {
        clearBranClearanceAnnotations();
        return;
      }
      syncBranClearanceDimensions();
    },
    { deep: true, immediate: true },
  );
  // 初始化 CSS2DRenderer
  if (overlayContainer.value && mainCanvas.value) {
    annotationSystem.initCSS2DRenderer(overlayContainer.value, mainCanvas.value);
    // 启用标注交互（点击选中、悬停高亮）
    annotationSystem.enableInteraction(mainCanvas.value);

    offAnnotationInteraction?.();
    offAnnotationInteraction = annotationSystem.onInteraction((ev) => {
      const id = typeof ev?.id === 'string' ? ev.id : null;
      if (!id) return;

      if (id.startsWith('meas_')) {
        const measurementId = id.slice('meas_'.length);

        if (ev.type === 'select') {
          store.activeMeasurementId.value = measurementId;
          return;
        }

        if (ev.type === 'deselect') {
          if (store.activeMeasurementId.value === measurementId) {
            store.activeMeasurementId.value = null;
          }
          return;
        }

        return;
      }

    });
  }

  // 测量标注：同步到三维标注系统（SolveSpace 风格 3D 标注）
  try {
    const mgr = new MeasurementAnnotationManager(annotationSystem, {
      getDimensionSystem: () => viewerContext.dimensionSystem.value,
      sceneWorldToDesignMetres,
    });
    const syncSelectedMeasurementAnnotation = () => {
      const activeId = store.activeMeasurementId.value;
      mgr.highlight(activeId);
      if (activeId) {
        annotationSystem.selectAnnotation(`meas_${activeId}`);
        return;
      }
      if (annotationSystem.selectedId.value?.startsWith('meas_')) {
        annotationSystem.selectAnnotation(null);
      }
    };
    mgr.setUnit(unitSettings.displayUnit.value as any);
    mgr.setPrecision(unitSettings.precision.value);
    mgr.sync(store.measurements.value as any);
    syncSelectedMeasurementAnnotation();

    watch(
      () => store.measurements.value,
      (measurements) => {
        mgr.sync(measurements as any);
        syncSelectedMeasurementAnnotation();
        requestRender();
      },
      { deep: true },
    );

    watch(
      () => store.activeMeasurementId.value,
      () => {
        syncSelectedMeasurementAnnotation();
        requestRender();
      },
    );

    watch(
      () => [unitSettings.displayUnit.value, unitSettings.precision.value] as const,
      ([unit, precision]) => {
        mgr.setUnit(unit as any);
        mgr.setPrecision(precision);
        mgr.sync(store.measurements.value as any);
        syncSelectedMeasurementAnnotation();
        requestRender();
      },
    );
  } catch (e) {
    console.warn('[ViewerPanel] 测量标注管理器初始化失败', e);
  }

  const urlParams = new URLSearchParams(window.location.search);
  const showDbnum = urlParams.get('show_dbnum');
  const showRefno = normalizeRefnoKeyLike(urlParams.get('show_refno') || '');
  // 调试入口（2026-09-12 MBD 长度尺寸显示优化 QW3）：`show_refno_select=0` 只加载该 BRAN、
  // 不把它置为选中，免得选中高亮盖住 MBD 尺寸线；缺省仍选中，行为不变。
  const showRefnoSelect = urlParams.get('show_refno_select') !== '0';
  const debugRefnoParam = urlParams.get('debug_refno');
  const showDbnumValue = (() => {
    const parsed = Number(showDbnum);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  })();
  const resolveDbnoForRefno = (refno: string): number | null => {
    if (showDbnumValue !== null) return showDbnumValue;
    if (activeDbno !== null) return activeDbno;
    try {
      return getDbnumByRefno(refno);
    } catch {
      return null;
    }
  };

  // 启动预拉：db_meta_info（关键，提供 refno->dbnum 映射）
  // demo 模式（primitives）不依赖后端数据，跳过预拉避免无后端时初始化失败。
  if (demoMode !== 'primitives' && !showDbnum) {
    try {
      await ensureDbMetaInfoLoaded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      initError.value = msg;
      emitToast({ message: msg });
      return;
    }
  }

  viewerContext.ptsetVis.value = ptsetVis as any;
  viewerContext.annotationSystem.value = annotationSystem;
  viewerContext.viewerRef.value = compat as any;
  viewerContext.overlayContainerRef.value = overlayContainer.value;
  viewerContext.store.value = store;
  viewerContext.tools.value = tools as any;
  viewerContext.xeokitMeasurementTools.value = xeokitMeasurementTools as any;

  if (typeof window !== 'undefined') {
    (window as any).__xeokitViewer = compat;
    (window as any).__dtxViewer = dtxViewer;
    (window as any).__viewerContext = viewerContext;
    (window as any).__viewerToolStore = store;
    (window as any).__xeokitMeasurementTools = xeokitMeasurementTools;
    (window as any).__viewerTools = tools;
    (window as any).__viewer = {
      store,
      tools,
      xeokitMeasurementTools,
    };
  }
  const onAnnotationVectorTextRebuilt = () => {
    annotationVectorTextRebuildCount += 1;
    requestRender();
  };
  window.addEventListener(
    'plant3d:annotation-vector-text-rebuilt',
    onAnnotationVectorTextRebuilt,
  );
  offAnnotationVectorTextRebuilt = () =>
    window.removeEventListener(
      'plant3d:annotation-vector-text-rebuilt',
      onAnnotationVectorTextRebuilt,
    );

  if (showRefno && demoMode !== 'primitives') {
    (async () => {
      try {
        emitToast({ message: `[信息] 正在加载 ${showRefno} …`, level: 'info' });
        console.log(`[show_refno] refno=${showRefno}`);
        if (showRefnoSelect) selectionStore.setSelectedRefno(showRefno);

        if (showDbnumValue === null) {
          await ensureDbMetaInfoLoaded();
        }

        const dbno = resolveDbnoForRefno(showRefno);
        if (dbno === null) {
          console.error(`[show_refno] 无法解析 ${showRefno} 的 dbnum`);
          emitToast({
            message: `[错误] 无法解析 dbnum（refno=${showRefno}）`,
            level: 'error',
          });
          return;
        }

        console.log(`[show_refno] refno=${showRefno} -> dbnum=${dbno}`);

        // 先查询可见子实例（容器节点本身没有几何数据）
        let loadRefnos = [showRefno];
        let visibleInstsUserHint: string | null = null;
        let noGeometryReason: string | null = null;
        try {
          const visResp = await getModelSource().tree.visibleInsts(showRefno);
          const visRefnos = visResp?.refnos ?? [];
          if (visRefnos.length > 0) {
            loadRefnos = mergeRootRefnoWithVisibleRefnos(showRefno, visRefnos);
            console.log(`[show_refno] visible-insts 返回 ${visRefnos.length} 个子实例，合并根节点后共 ${loadRefnos.length} 个 refno`);
          } else if (visResp?.success) {
            noGeometryReason = await describeNoGeometryReason(showRefno);
            visibleInstsUserHint =
              `可见子实例为 0（refno=${showRefno}），仅加载根节点；${noGeometryReason || '若为容器可能没有几何，请检查可见性或数据'}`;
          }
        } catch (e) {
          console.warn('[show_refno] visible-insts 查询失败，回退直接加载', e);
          visibleInstsUserHint = '查询可见子实例失败，已回退为仅加载根 refno';
        }
        if (visibleInstsUserHint) {
          emitToast({ message: `[警告] ${visibleInstsUserHint}`, level: 'warning' });
          consoleStore.addLog('warn', `[show_refno] ${visibleInstsUserHint}`);
        }

        const result = await loadDbnoInstancesForVisibleRefnosDtx(
          dtxLayer,
          dbno,
          loadRefnos,
          { lodAssetKey: 'L1', debug: true, dataSource: 'gen-model-v1' }
        );
        (compat as any).__dtxAfterInstancesLoaded?.(dbno, loadRefnos);

        requestRender();
        if (fitDtxViewerToFocusBox(dtxViewer, dtxLayer, 0)) {
          requestRender();
        }

        const detail =
          `对象 ${result.loadedObjects}（已加载 ${result.loadedRefnos}，跳过 ${result.skippedRefnos}，` +
          `mesh 缺失 ${result.missingBreakdown.mesh404Refnos.length}，无几何 ${result.missingBreakdown.noGeoRowsRefnos.length}）`;
        if (result.loadedObjects === 0) {
          noGeometryReason = noGeometryReason || await describeNoGeometryReason(showRefno);
          const reason = noGeometryReason ? `原因：${noGeometryReason}` : '请检查左侧可见性或 Parquet 数据';
          emitToast({
            message: `[警告] 加载结束但未绘制实例。${detail} ${reason}`,
            level: 'warning',
          });
          consoleStore.addLog('warn', `[show_refno] 加载结束但未绘制实例。${detail} ${reason}`);
        } else {
          emitToast({ message: `[成功] ${detail}`, level: 'success' });
        }
        console.log('[show_refno] ✅ 加载完成', result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[show_refno] 加载失败:', e);
        emitToast({ message: `[错误] 加载失败：${msg}`, level: 'error' });
      }
    })();
  }

  // show_dbnum URL 参数：整库加载（gen-model-v1：该库全部 SITE 逐个 ensure → records）。
  if (showDbnumValue !== null && !showRefno && demoMode !== 'primitives') {
    const dbno = showDbnumValue;
    if (Number.isFinite(dbno) && dbno > 0) {
      (async () => {
        const publishShowDbnumLoadResult = (payload: Record<string, unknown>) => {
          if (typeof window === 'undefined') return;
          (window as any).__dtxLastShowDbnumLoadResult = {
            dbno,
            updatedAt: new Date().toISOString(),
            ...payload,
          };
        };

        try {
          publishShowDbnumLoadResult({
            status: 'loading',
            refnoCount: 0,
            loadedRefnos: 0,
            skippedRefnos: 0,
            loadedObjects: 0,
            missingRefnos: 0,
            mesh404Refnos: 0,
            mesh404GeoHashes: 0,
            noGeoRowsRefnos: 0,
          });

          // 整库 = 该库全部 SITE 逐个 ensure → records，分批装入（plan P3-c / P3-f）；进度与收尾在 useModelGeneration 里。
          const generation = modelGenerationRef.value;
          if (!generation) throw new Error('模型加载器未初始化');
          emitToast({ message: `[信息] 正在从 gen-model 加载 dbnum=${dbno} 的全部 SITE…`, level: 'info' });
          const v1Result = await generation.showModelByDbnum(dbno, { flyTo: true });
          requestRender();
          publishShowDbnumLoadResult({
            status: !v1Result.loaded ? 'error' : v1Result.instanceCount === 0 ? 'empty' : v1Result.budgetLimited ? 'partial' : 'loaded',
            source: 'gen-model-v1',
            refnoCount: v1Result.refnoCount,
            loadedRefnos: v1Result.refnoCount,
            loadedObjects: v1Result.instanceCount,
            budgetLimited: v1Result.budgetLimited === true,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          publishShowDbnumLoadResult({ status: 'error', error: msg });
          console.error('[ViewerPanel] show_dbnum 加载失败:', e);
          emitToast({ message: `[错误] 加载失败：${msg}`, level: 'error' });
        }
      })();
    }
  }

  // debug_refno URL 参数：加载指定 refno 下的可见实例（如 debug_refno=24381_145018）
  const debugRefno = debugRefnoParam;
  if (debugRefno && !showDbnum && !showRefno && demoMode !== 'primitives') {
    // 支持 24381_145018 或 24381/145018 格式
    const refnoStr = debugRefno.replace('/', '_');
    (async () => {
      try {
        emitToast({ message: `[信息] 正在查询 ${refnoStr} 的可见实例…`, level: 'info' });
        console.log(`[debug_refno] refno=${refnoStr}`);

        // 1. 确保 db_meta_info 已加载，解析 refno → dbnum
        await ensureDbMetaInfoLoaded();
        let dbno: number;
        try {
          dbno = getDbnumByRefno(refnoStr);
        } catch {
          console.error(`[debug_refno] 无法解析 ${refnoStr} 的 dbnum`);
          emitToast({
            message: `[错误] 无法解析 dbnum（refno=${refnoStr}）`,
            level: 'error',
          });
          return;
        }
        console.log(`[debug_refno] refno=${refnoStr} → dbnum=${dbno}`);

        // 2. 查询该 refno 下的可见实例（经数据源端口：legacy = /api/e3d/visible-insts，gen-model-v1 = ensure → records）
        const visResp = await getModelSource().tree.visibleInsts(refnoStr);
        const refnos = mergeRootRefnoWithVisibleRefnos(refnoStr, visResp?.refnos ?? []);
        console.log(`[debug_refno] visible-insts 合并根节点后返回 ${refnos.length} 个 refno`, refnos.slice(0, 10));
        if (refnos.length === 0) {
          emitToast({
            message: `[警告] ${refnoStr} 下无可见实例（接口未返回子 refno）`,
            level: 'warning',
          });
          return;
        }
        emitToast({
          message: `[信息] 发现 ${refnos.length} 个实例，开始加载（dbnum=${dbno}）…`,
          level: 'info',
        });

        // 3. 加载实例到 DTX（gen-model-v1 ensure → records）
        const result = await loadDbnoInstancesForVisibleRefnosDtx(
          dtxLayer,
          dbno,
          refnos,
          {
            lodAssetKey: 'L1',
            debug: true,
            dataSource: 'gen-model-v1',
            forceReloadRefnos: refnos,
            replaceExistingObjects: true,
            includeOwnedTubings: true,
          }
        );
        (compat as any).__dtxAfterInstancesLoaded?.(dbno, refnos);

        // 4. 自适应视角
        requestRender();
        fitDtxViewerToFocusBox(dtxViewer, dtxLayer, 0);
        requestRender();

        const dbg =
          `对象 ${result.loadedObjects}（${refnos.length} 个 refno，mesh 缺失 ${result.missingBreakdown.mesh404Refnos.length}，` +
          `无几何 ${result.missingBreakdown.noGeoRowsRefnos.length}）`;
        if (result.loadedObjects === 0) {
          emitToast({ message: `[警告] 加载结束但未绘制实例。${dbg}`, level: 'warning' });
        } else {
          emitToast({ message: `[成功] ${dbg}`, level: 'success' });
        }
        console.log('[debug_refno] ✅ 加载完成', result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[debug_refno] 加载失败:', e);
        emitToast({ message: `[错误] debug_refno 加载失败：${msg}`, level: 'error' });
      }
    })();
  }

  const onControlsChange = () => {
    if (isRendering) {
      needsRender = true;
      return;
    }
    requestRender();
  };
  dtxViewer.controls.addEventListener('change', onControlsChange);
  offControlsChange = () =>
    dtxViewer.controls.removeEventListener('change', onControlsChange);

  // gizmo 交互/动画期间需要持续触发渲染（否则按需渲染会"停帧"）
  if (dtxViewer.gizmo) {
    const onGizmoChange = () => requestRender();
    const onGizmoStart = () => requestRender();
    const onGizmoEnd = () => requestRender();
    dtxViewer.gizmo.addEventListener('change', onGizmoChange);
    dtxViewer.gizmo.addEventListener('start', onGizmoStart);
    dtxViewer.gizmo.addEventListener('end', onGizmoEnd);
    offGizmoEvents = () => {
      try {
        dtxViewer.gizmo?.removeEventListener('change', onGizmoChange);
        dtxViewer.gizmo?.removeEventListener('start', onGizmoStart);
        dtxViewer.gizmo?.removeEventListener('end', onGizmoEnd);
      } catch {
        // ignore
      }
    };
  }

  selectionController.on('selectionChanged', () => requestRender());
  selectionController.on('flyTo', (ev: any) => {
    if (!ev?.position || !ev?.target) return;
    dtxViewer.flyTo(ev.position, ev.target, { duration: ev.duration });
  });

  // 添加鼠标事件监听器，用于动态 pivot（长按 300ms 触发）
  const onCanvasMouseDown = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) return;
    const rect = canvas.getBoundingClientRect();
    const canvasPos = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    pivotControllerRef.value?.handleMouseDown(canvasPos);
  };

  const onCanvasMouseMove = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) return;
    const rect = canvas.getBoundingClientRect();
    const canvasPos = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    pivotControllerRef.value?.handleMouseMove(canvasPos);
  };

  const onCanvasMouseUp = () => {
    pivotControllerRef.value?.handleMouseUp();
  };

  canvas.addEventListener('pointerdown', onCanvasMouseDown);
  canvas.addEventListener('pointermove', onCanvasMouseMove);
  canvas.addEventListener('pointerup', onCanvasMouseUp);
  canvas.addEventListener('pointercancel', onCanvasMouseUp);

  offPivotEvents = () => {
    canvas.removeEventListener('pointerdown', onCanvasMouseDown);
    canvas.removeEventListener('pointermove', onCanvasMouseMove);
    canvas.removeEventListener('pointerup', onCanvasMouseUp);
    canvas.removeEventListener('pointercancel', onCanvasMouseUp);
  };

  const onXeokitToolsPointerDown = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) return;
    xeokitMeasurementToolsRef.value?.onCanvasPointerDown(canvas, e);
  };
  const onXeokitToolsPointerMove = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) return;
    xeokitMeasurementToolsRef.value?.onCanvasPointerMove(canvas, e);
  };
  const onXeokitToolsPointerUp = (e: PointerEvent) => {
    if (isModelUnitSplitCompareReady()) return;
    xeokitMeasurementToolsRef.value?.onCanvasPointerUp(canvas, e);
  };
  const onXeokitToolsPointerCancel = (e: PointerEvent) => {
    xeokitMeasurementToolsRef.value?.onCanvasPointerCancel(canvas, e);
  };

  canvas.addEventListener('pointerdown', onXeokitToolsPointerDown);
  canvas.addEventListener('pointermove', onXeokitToolsPointerMove);
  canvas.addEventListener('pointerup', onXeokitToolsPointerUp);
  canvas.addEventListener('pointercancel', onXeokitToolsPointerCancel);

  offXeokitToolsInput = () => {
    canvas.removeEventListener('pointerdown', onXeokitToolsPointerDown);
    canvas.removeEventListener('pointermove', onXeokitToolsPointerMove);
    canvas.removeEventListener('pointerup', onXeokitToolsPointerUp);
    canvas.removeEventListener('pointercancel', onXeokitToolsPointerCancel);
  };

  // 兼容：批注/脚本会 dispatch showModelByRefnos，Viewer 侧统一接住并按需加载
  let showModelQueue: Promise<void> = Promise.resolve();
  const handleShowModelByRefnos = (ev: Event) => {
    if (demoMode === 'primitives') {
      console.warn(
        '[ViewerPanel] dtx_demo=primitives 模式下忽略 showModelByRefnos',
      );
      return;
    }
    const detail = (
            ev as CustomEvent<{ refnos?: unknown; regenModel?: boolean; dbnum?: number; sesno?: number }>
    ).detail;
    const raw = (detail as any)?.refnos;
    const refnos = Array.isArray(raw)
      ? raw
        .map((r: unknown) => String(r || '').replace(/\//g, '_'))
        .filter(Boolean)
      : [];
    if (refnos.length === 0) return;

    const unique = Array.from(new Set(refnos));
    const flyTo = !!(detail as any)?.flyTo;
    const highlight = !!(detail as any)?.highlight;
    // U0 回执守卫（useViewerContext.showModelByRefnosWithAck 的 shouldApply）：模型照常加载，
    // 但相机 / 高亮 / 选择在加载完那一刻再问一次调用方「还该动吗」——用户已切到别的任务就不动视口。
    const shouldApplyRaw = (detail as any)?.shouldApply;
    const shouldApply: (() => boolean) | null = typeof shouldApplyRaw === 'function' ? shouldApplyRaw : null;
    const applyAllowed = () => (shouldApply ? shouldApply() !== false : true);
    let suppressed = false;
    const requestIdRaw = (detail as any)?.requestId;
    const requestId =
            typeof requestIdRaw === 'string'
              ? requestIdRaw.trim()
              : String(requestIdRaw || '').trim();
    const hasRequestId = requestId.length > 0;
    console.info('[vis][event] showModelByRefnos', {
      raw_refno_count: refnos.length,
      unique_refno_count: unique.length,
      regenModel: !!(detail as any)?.regenModel,
      flyTo,
      highlight,
      requestId: hasRequestId ? requestId : undefined,
    });
    consoleStore.addLog(
      'info',
      `[vis][event] showModelByRefnos raw_refno_count=${refnos.length} unique_refno_count=${unique.length} regenModel=${(detail as any)?.regenModel ? 1 : 0} flyTo=${flyTo ? 1 : 0} highlight=${highlight ? 1 : 0}`,
    );
    const mg = modelGenerationRef.value;
    if (!mg) return;
    const dtxLayer = dtxLayerRef.value;

    const debugState: {
            runId: string;
            status: 'running' | 'done';
            requested: string[];
            ok: string[];
            fail: { refno: string; error: string | null; status: string }[];
            items: {
                refno: string;
                ok: boolean;
                error: string | null;
                status: string;
                loadDebug: any | null;
                dtxStatsBefore: any | null;
                dtxStatsAfter: any | null;
            }[];
            startedAt: number;
            finishedAt: number | null;
            error: string | null;
        } = {
          runId: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          status: 'running',
          requested: unique,
          ok: [],
          fail: [],
          items: [],
          startedAt: Date.now(),
          finishedAt: null,
          error: null,
        };
    if (isDev) {
      (window as any).__dtxShowModelByRefnos = debugState;
    }

    showModelQueue = showModelQueue
      .then(async () => {
        // 带守卫的单构件飞行不在加载里飞（那时还没法核对），加载完再核一次、自己飞
        const singleFlyTo = !highlight && flyTo && unique.length === 1;
        for (const r of unique) {
          const dtxStatsBefore =
                        (dtxLayer as any)?.getStats?.() ?? null;
          // `showModelByRefnos {dbnum, sesno}` 把某版本装进主图层的那条路 2026-09-18 删了（Q18）：
          // 版本只在隔离图层里看（单视口切换 / 双视口分屏），主层装旧版本会跟「最新环境模型」打架。
          const ok = await mg.showModelByRefno(r, {
            flyTo: singleFlyTo && !shouldApply,
            regenerate: !!(detail as any)?.regenModel,
          });
          const loadDebug = mg.lastLoadDebug?.value ?? null;
          const dtxStatsAfter =
                        (dtxLayer as any)?.getStats?.() ?? null;
          if (ok) {
            debugState.ok.push(r);
          } else {
            debugState.fail.push({
              refno: r,
              error: mg.error.value || null,
              status: mg.statusMessage.value || '',
            });
          }
          debugState.items.push({
            refno: r,
            ok,
            error: mg.error.value || null,
            status: mg.statusMessage.value || '',
            loadDebug,
            dtxStatsBefore,
            dtxStatsAfter,
          });
        }

        if (singleFlyTo && shouldApply && debugState.ok.length > 0) {
          const compat = compatViewerRef.value;
          if (!applyAllowed()) {
            suppressed = true;
          } else if (compat) {
            compat.scene.ensureRefnos(debugState.ok);
            const aabb = compat.scene.getAABB(debugState.ok);
            if (aabb) compat.cameraFlight.flyTo({ aabb, duration: 0.8, fit: true });
          }
        }
        if (highlight && debugState.ok.length > 0) {
          const compat = compatViewerRef.value;
          if (!applyAllowed()) {
            suppressed = true;
          } else if (compat) {
            applyLoadedModelHighlight({
              viewer: compat,
              refnos: debugState.ok,
              flyTo,
              setSelectedRefnos: (refnos) => selectionStore.setSelectedRefnos(refnos),
            });
          }
        }
        if (highlight && debugState.fail.length > 0) {
          debugState.error = debugState.ok.length > 0
            ? `${debugState.fail.length} 个关联元素加载失败，已高亮其余元素`
            : '关联元素全部加载失败';
        }
      })
      .catch((e) => {
        console.warn('[ViewerPanel] showModelByRefnos failed', e);
        debugState.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        debugState.status = 'done';
        debugState.finishedAt = Date.now();
        // 供外部 await：只在明确传入 requestId 时派发，避免影响既有调用方（批注/脚本）。
        if (hasRequestId) {
          window.dispatchEvent(
            new CustomEvent('showModelByRefnosDone', {
              detail: {
                requestId,
                requested: unique,
                ok: debugState.ok,
                fail: debugState.fail,
                error: debugState.error,
                suppressed,
              },
            }),
          );
        }
        requestRender();
      });
  };
  window.addEventListener('showModelByRefnos', handleShowModelByRefnos);
  offShowModelByRefnos = () =>
    window.removeEventListener(
      'showModelByRefnos',
      handleShowModelByRefnos,
    );

  window.addEventListener(MODEL_UNIT_VERSION_COMPARE_EVENT, handleModelUnitVersionCompare);
  offModelUnitVersionCompare = () =>
    window.removeEventListener(MODEL_UNIT_VERSION_COMPARE_EVENT, handleModelUnitVersionCompare);

  function renderPtsetEntries(contextRefno: string, entries: { refno: string; response: PtsetResponse }[]) {
    if (entries.length === 0) return;
    const [first, ...rest] = entries;
    ptsetVis.setPanelContext(contextRefno);
    ptsetVis.renderPtset(first.refno, first.response);
    for (const item of rest) {
      ptsetVis.appendPtset(item.refno, item.response, { setCurrent: false });
    }
    ptsetVis.flyToPtset();
    requestRender();
  }

  offPtsetWatch = watch(
    () => store.ptsetVisualizationRequest.value,
    async (request) => {
      if (!request) return;

      try {
        emitToast({ message: `正在加载点集数据: ${request.refno}` });
        // ptset 按需获取：尽量带上 dbno + batch_id（来自 meta_{dbno}.json）以确保与当前模型快照一致。
        const normalized = String(request.refno ?? '').trim().replace('/', '_');
        const refnoKey = normalizeRefnoKeyLike(request.refno) || request.refno;
        ptsetVis.setPanelContext(refnoKey);
        let dbno: number | null = null;
        try {
          dbno = getDbnumByRefno(normalized);
        } catch {
          dbno = null;
        }
        if (dbno == null) {
          emitToast({ message: `无法从 refno=${refnoKey} 解析 dbno，无法查询 ptset` });
          return;
        }

        // 取数走 ModelSource.keypoints 端口（gen-model-v1 `element/ptset`，成员点集 `include_members` 一次回）。
        const modelSource = getModelSource();
        const { entries, self, memberErrors } = await collectPtsetEntries(
          { keypoints: modelSource.keypoints },
          dbno,
          refnoKey,
        );

        if (entries.length === 1 && entries[0]!.refno === refnoKey) {
          renderPtsetEntries(refnoKey, entries);
          emitToast({ message: `已显示 ${entries[0]!.response.ptset.length} 个连接点` });
        } else if (entries.length > 0) {
          renderPtsetEntries(refnoKey, entries);
          const pointCount = entries.reduce((sum, item) => sum + item.response.ptset.length, 0);
          emitToast({
            message: `当前构件自身无 ptset，已显示 ${entries.length} 个子元件 ${pointCount} 个连接点`,
          });
        } else {
          const errorMsg = self.error_message || memberErrors[0] || '未找到点集数据';
          emitToast({ message: errorMsg });
          console.warn('[ptset]', errorMsg);
        }
      } catch (error) {
        console.error('[ptset] Failed to load ptset:', error);
        emitToast({ message: '加载点集数据失败' });
      } finally {
        store.clearPtsetVisualizationRequest();
      }
    },
    { immediate: true },
  );

  offRibbonCommand = onCommand(handleRibbonCommand);
  window.addEventListener('openSpatialQuery', handleOpenSpatialQueryEvent as EventListener);
  offOpenSpatialQuery = () => window.removeEventListener('openSpatialQuery', handleOpenSpatialQueryEvent as EventListener);
  initializeSpatialQueryFromUrl(window.location.search, spatialQueryStore, openSpatialQueryDrawer);

  // 点击工具栏外部时关闭“测量”下拉菜单（不影响当前工具模式）
  const onDocPointerDown = (ev: PointerEvent) => {
    if (!leftToolbarOpenMeasureMenu.value) return;
    const el = leftToolbarRef.value;
    const target = ev.target as Node | null;
    if (!el || !target) {
      leftToolbarOpenMeasureMenu.value = false;
      return;
    }
    if (el.contains(target)) return;
    leftToolbarOpenMeasureMenu.value = false;
  };
  document.addEventListener('pointerdown', onDocPointerDown, true);
  offDocPointerDown = () => {
    document.removeEventListener('pointerdown', onDocPointerDown, true);
  };

  const onKeydown = (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase() ?? '';
    const isEditable =
            tag === 'input' ||
            tag === 'textarea' ||
            (target as any)?.isContentEditable === true;
    if (isEditable) return;

    const dimensionResult = dimensionSystem?.pointer.keyDown(ev);
    if (dimensionResult?.consumed) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      requestRender();
      return;
    }

    if (ev.key === 'Escape') {
      // 在点选/框选 refno 模式中，Escape 取消当前拾取步骤
      if (store.toolMode.value === 'pick_refno' || store.toolMode.value === 'pick_refno_box') {
        store.cancelPickRefno();
        return;
      }
      // 云线是多步创建，Esc 先按步回退（拖框预览 → 锚点），退无可退才退出工具。
      // 吞掉事件：AnnotationOverlayBar 的 Esc 也挂在 window 上，不挡住会一次退两层。
      if (store.toolMode.value === 'annotation_cloud' && toolsRef.value?.rollbackCloudCreationStep?.()) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        requestRender();
        return;
      }
      if (
        store.toolMode.value === 'annotation' ||
        store.toolMode.value === 'annotation_cloud' ||
        store.toolMode.value === 'annotation_rect' ||
        store.toolMode.value === 'annotation_obb'
      ) {
        store.setToolMode('none');
        requestRender();
        return;
      }
      if (
        store.toolMode.value === 'xeokit_measure_distance' ||
        store.toolMode.value === 'xeokit_measure_angle' ||
        store.toolMode.value === 'xeokit_measure_elevation_point' ||
        store.toolMode.value === 'xeokit_measure_elevation_delta'
      ) {
        if (xeokitMeasurementToolsRef.value?.reset()) return;
        exitXeokitMeasureMode();
        return;
      }
      try {
        toolsRef.value?.cancelMeasurementInteraction?.();
      } catch {
        // ignore
      }
      requestRender();
      return;
    }

    if (ev.key === 'Tab' && store.toolMode.value === 'pick_refno') {
      // 光标处有多个重叠构件时，Tab / Shift+Tab 在候选之间轮换，替换当前已拾取的那个
      if (toolsRef.value?.cyclePickCandidate?.(ev.shiftKey ? -1 : 1)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        requestRender();
        return;
      }
    }

    if (ev.key === 'Enter') {
      // 在 pick_refno 模式中，Enter 确认拾取结果
      if (store.toolMode.value === 'pick_refno') {
        store.confirmPickRefno();
        return;
      }
    }

    if (ev.key === ' ' || ev.code === 'Space') {
      // E3D Repeat Measure：空格以上一条距离的终点为起点继续测量
      if (store.toolMode.value === 'xeokit_measure_distance') {
        const repeated = xeokitMeasurementToolsRef.value?.repeatLastDistanceMeasurement?.();
        if (repeated) {
          ev.preventDefault();
          requestRender();
          return;
        }
      }
    }

    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      const xeokitMid = store.activeXeokitMeasurementId.value;
      if (xeokitMid) {
        try {
          xeokitMeasurementToolsRef.value?.removeMeasurement(xeokitMid);
        } catch {
          // ignore
        }
        requestRender();
        return;
      }

      const mid = store.activeMeasurementId.value;
      if (mid) {
        try {
          toolsRef.value?.removeMeasurement(mid);
        } catch {
          // ignore
        }
        requestRender();
        return;
      }

    }
  };
  window.addEventListener('keydown', onKeydown);
  offKeydown = () => window.removeEventListener('keydown', onKeydown);

  resizeObserver = new ResizeObserver(() => handleResize());
  resizeObserver.observe(container);
  handleResize();

  attachPicking();
  attachToolsInput();
  await initializeDimensionViewport();
  requestRender();
});

onUnmounted(() => {
  viewerContext.viewerError.value = null;
  dimensionMountDisposed = true;
  dimensionInitializationVersion += 1;
  dimensionSystem?.dispose();
  dimensionSystem = null;
  stopLocalDimensionAutosave();
  offDimensionReviewBinding?.();
  offDimensionReviewBinding = null;
  offDimensionSelectionBinding?.();
  offDimensionSelectionBinding = null;
  mainCanvas.value?.removeEventListener('contextmenu', onViewerContextMenu, true);
  closeMeasurementContextMenu();
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
  detachPicking();
  detachToolsInput();
  offXeokitToolsInput?.();
  offXeokitToolsInput = null;

  offControlsChange?.();
  offControlsChange = null;

  offPivotEvents?.();
  offPivotEvents = null;

  offGizmoEvents?.();
  offGizmoEvents = null;

  offAnnotationInteraction?.();
  offAnnotationInteraction = null;

  offAnnotationVectorTextRebuilt?.();
  offAnnotationVectorTextRebuilt = null;

  offShowModelByRefnos?.();
  offShowModelByRefnos = null;

  offModelUnitVersionCompare?.();
  offModelUnitVersionCompare = null;
  clearModelUnitVersionCompare();

  offOpenSpatialQuery?.();
  offOpenSpatialQuery = null;

  offPtsetWatch?.();
  offPtsetWatch = null;

  offBranClearanceWatch?.();
  offBranClearanceWatch = null;

  try {
    ptsetVisRef.value?.clearAll();
  } catch {
    // ignore
  }
  ptsetVisRef.value = null;

  try {
    clearBranClearanceAnnotations();
  } catch {
    // ignore
  }

  // 仅清理引用（useAnnotationThree 内部已注册 onUnmounted 执行 dispose）
  annotationSystemRef.value = null;

  try {
    xeokitMeasurementToolsRef.value?.dispose();
  } catch {
    // ignore
  }
  xeokitMeasurementToolsRef.value = null;

  try {
    toolsRef.value?.dispose();
  } catch {
    // ignore
  }
  toolsRef.value = null;

  resizeObserver?.disconnect();
  resizeObserver = null;

  offRibbonCommand?.();
  offRibbonCommand = null;

  offDocPointerDown?.();
  offDocPointerDown = null;

  offKeydown?.();
  offKeydown = null;

  try {
    selectionControllerRef.value?.dispose();
  } catch {
    // ignore
  }
  selectionControllerRef.value = null;

  try {
    globalEdgeOverlayRef.value?.dispose();
  } catch {
    // ignore
  }
  globalEdgeOverlayRef.value = null;

  try {
    tileLodControllerRef.value?.dispose();
  } catch {
    // ignore
  }
  tileLodControllerRef.value = null;
  viewCullControllerRef.value = null;

  try {
    pivotControllerRef.value?.dispose();
  } catch {
    // ignore
  }
  pivotControllerRef.value = null;

  try {
    cadGridRef.value?.dispose();
  } catch {
    // ignore
  }
  cadGridRef.value = null;

  try {
    dtxLayerRef.value?.dispose();
  } catch {
    // ignore
  }
  dtxLayerRef.value = null;

  for (const layer of showDbnumExtraDtxLayers.splice(0)) {
    try {
      layer.dispose();
    } catch {
      // ignore
    }
  }

  try {
    dtxViewerRef.value?.dispose();
  } catch {
    // ignore
  }
  dtxViewerRef.value = null;

  try {
    compatViewerRef.value?.scene.setAutoFocusTransparencyEnabled(false);
  } catch {
    // ignore
  }
  compatViewerRef.value = null;
  try {
    delete (window as any).__xeokitViewer;
    delete (window as any).__dtxViewer;
    delete (window as any).__dtxLayer;
    delete (window as any).__viewerContext;
    delete (window as any).__viewerToolStore;
    delete (window as any).__xeokitMeasurementTools;
    delete (window as any).__viewerTools;
    delete (window as any).__viewer;
    delete (window as any).__dtxShowDbnumLayers;
    delete (window as any).__dtxShowDbnumExtraLayers;
  } catch {
    // ignore
  }
  viewerContext.viewerRef.value = null;
  viewerContext.overlayContainerRef.value = null;
  viewerContext.tools.value = null;
  viewerContext.xeokitMeasurementTools.value = null;
  viewerContext.ptsetVis.value = null;
  viewerContext.annotationSystem.value = null;
});
</script>

<template>
  <div ref="containerRef" class="viewer-panel-container">
    <canvas ref="mainCanvas" class="viewer" />
    <div v-show="modelUnitCompareState?.viewMode !== 'split'" ref="overlayContainer" class="xeokitOverlay" />

    <div v-if="modelUnitCompareState?.status === 'ready' && modelUnitCompareState.viewMode === 'split'"
      class="pointer-events-none absolute inset-0"
      style="z-index: 930"
      data-testid="viewer-model-unit-split-overlay">
      <div class="absolute inset-y-0 left-1/2 border-l border-white/80 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]" />
      <div class="absolute left-3 top-3 rounded bg-blue-600/90 px-2 py-1 text-xs font-semibold text-white shadow">
        A · sesno {{ modelUnitCompareState.detail.before.sesno }}
      </div>
      <div class="absolute left-[calc(50%+0.75rem)] top-3 rounded bg-emerald-600/90 px-2 py-1 text-xs font-semibold text-white shadow">
        B · sesno {{ modelUnitCompareState.detail.after.sesno }}
      </div>
    </div>

    <!-- DEV：LOD 调参面板（屏幕相关阈值 + L2 预热） -->
    <div v-if="lodDebugVisible"
      class="pointer-events-auto absolute left-3 top-3 w-[260px] rounded-md border border-border bg-background/90 p-2 text-foreground shadow-lg backdrop-blur"
      style="z-index: 950"
      @pointerdown.stop
      @wheel.stop>
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs font-medium">DTX LOD Debug</div>
        <button type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded border border-input bg-background hover:bg-muted"
          title="关闭"
          @click.stop="closeLodDebugPanel">
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground">L1 px</span>
          <input v-model.number="lodUiConfig.l1Px"
            type="number"
            min="1"
            step="1"
            class="h-8 rounded border border-input bg-background px-2" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground">L2 px</span>
          <input v-model.number="lodUiConfig.l2Px"
            type="number"
            min="1"
            step="1"
            class="h-8 rounded border border-input bg-background px-2" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground">滞回</span>
          <input v-model.number="lodUiConfig.hysteresis"
            type="number"
            min="0"
            max="0.89"
            step="0.01"
            class="h-8 rounded border border-input bg-background px-2" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground">settle ms</span>
          <input v-model.number="lodUiConfig.settleMs"
            type="number"
            min="0"
            step="10"
            class="h-8 rounded border border-input bg-background px-2" />
        </label>
      </div>

      <div class="mt-2 border-t border-border pt-2">
        <div class="text-xs font-medium">预热（L2，仅影响后续加载）</div>
        <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
          <label class="flex items-center gap-2">
            <input v-model="lodPrewarmUiConfig.enabled"
              type="checkbox"
              class="h-4 w-4" />
            <span>启用</span>
          </label>
          <div class="text-[10px] text-muted-foreground">
            keys: dtx_lod_prewarm*
          </div>
          <label class="flex flex-col gap-1">
            <span class="text-muted-foreground">topK</span>
            <input v-model.number="lodPrewarmUiConfig.topK"
              type="number"
              min="1"
              step="1"
              class="h-8 rounded border border-input bg-background px-2" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-muted-foreground">minCount</span>
            <input v-model.number="lodPrewarmUiConfig.minCount"
              type="number"
              min="1"
              step="1"
              class="h-8 rounded border border-input bg-background px-2" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-muted-foreground">并发</span>
            <input v-model.number="lodPrewarmUiConfig.concurrency"
              type="number"
              min="1"
              step="1"
              class="h-8 rounded border border-input bg-background px-2" />
          </label>
        </div>
      </div>
    </div>

    <div v-if="store.toolMode.value !== 'none' && activeMeasureTools && modelUnitCompareState?.viewMode !== 'split'"
      class="pointer-events-none absolute bottom-2 right-2 max-w-[min(30rem,calc(100%-4.5rem))] rounded-md border border-border bg-background/85 px-2 py-1 text-xs text-foreground shadow-sm backdrop-blur"
      style="z-index: 940">
      <div>{{ activeMeasureStatusText }}</div>
      <div v-if="activeMeasureHoverText" class="mt-1 text-muted-foreground">
        {{ activeMeasureHoverText }}
      </div>
    </div>

    <div v-if="modelLoadStatus.state.value.visible"
      class="pointer-events-none absolute bottom-2 left-2 w-[min(28rem,calc(100%-1rem))] rounded-md border border-border bg-background/90 px-3 py-2 text-xs text-foreground shadow-sm backdrop-blur"
      style="z-index: 940">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="truncate font-medium">
            {{ modelLoadStatus.state.value.message || '正在加载模型...' }}
          </div>
          <div v-if="modelLoadStatus.state.value.currentRefno" class="truncate text-[11px] text-muted-foreground">
            {{ modelLoadStatus.state.value.currentRefno }}
          </div>
        </div>
        <div class="shrink-0 tabular-nums text-muted-foreground">
          {{ modelLoadStatus.state.value.progress }}%
        </div>
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/80">
        <div class="h-full rounded-full bg-primary transition-all duration-200"
          :style="{ width: `${modelLoadStatus.state.value.progress}%` }" />
      </div>
    </div>

    <!-- 统一工具栏：显示 / 测量 / 视图 分组，图标+文字标签（原左右两条竖排图标条合并） -->
    <div v-show="modelUnitCompareState?.viewMode !== 'split'"
      ref="leftToolbarRef"
      class="pointer-events-auto absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-stretch gap-0.5 rounded-2xl border border-border/80 bg-background/95 p-1 shadow-xl backdrop-blur"
      style="z-index: 940"
      @pointerdown.stop
      @wheel.stop>
      <button type="button"
        class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click.stop="hideSelected">
        <EyeOff class="h-[18px] w-[18px]" />
        <span class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">隐藏（选中对象）</span>
      </button>
      <button type="button"
        class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click.stop="showSelected">
        <Eye class="h-[18px] w-[18px]" />
        <span class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">显示（选中对象）</span>
      </button>
      <button type="button"
        class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click.stop="toggleXraySelected">
        <ScanEye class="h-[18px] w-[18px]" />
        <span class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">X-ray（选中对象 / 已开启时点击取消）</span>
      </button>
      <button type="button"
        class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click.stop="hideAll">
        <EyeClosed class="h-[18px] w-[18px]" />
        <span class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">全部隐藏</span>
      </button>
      <button type="button"
        class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click.stop="locateShowSelected">
        <Focus class="h-[18px] w-[18px]" />
        <span class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">定位显示（选中对象）</span>
      </button>
      <button type="button"
        class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
        :class="focusTransparencyEnabled
          ? 'bg-primary/10 text-primary hover:bg-primary/15'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
        @click.stop="onFocusTransparencyEnabledChange(!focusTransparencyEnabled)">
        <Aperture class="h-[18px] w-[18px]" />
        <span class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">{{ focusTransparencyEnabled ? '关闭选中聚焦半透明' : '开启选中聚焦半透明' }}</span>
      </button>

      <div class="mx-1.5 my-1 h-px bg-border/70" />
      <!-- 测量（下拉：长度/角度） -->
      <div class="relative">
        <button type="button"
          class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
          :class="isMeasureModeActive || leftToolbarOpenMeasureMenu
            ? 'bg-primary/10 text-primary hover:bg-primary/15'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          @click.stop="toggleLeftMeasureMenu">
          <Ruler class="h-[18px] w-[18px]" />
          <span v-if="!leftToolbarOpenMeasureMenu"
            class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">测量（长度/角度/标高/间距）</span>
        </button>

        <div v-if="leftToolbarOpenMeasureMenu"
          class="absolute left-full top-0 ml-1.5 flex w-32 flex-col gap-0.5 rounded-lg border border-border bg-background/95 p-1 shadow-lg backdrop-blur"
          style="z-index: 941">
          <button type="button"
            class="flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs hover:bg-muted"
            :class="store.toolMode.value === 'xeokit_measure_distance' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasureDistanceClick">
            <Ruler class="h-3.5 w-3.5" />
            <span>长度测量</span>
          </button>
          <button type="button"
            class="flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs hover:bg-muted"
            :class="store.toolMode.value === 'xeokit_measure_elevation_point' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasureElevationPointClick">
            <Ruler class="h-3.5 w-3.5" />
            <span>点标高</span>
          </button>
          <button type="button"
            class="flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs hover:bg-muted"
            :class="store.toolMode.value === 'xeokit_measure_elevation_delta' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasureElevationDeltaClick">
            <Ruler class="h-3.5 w-3.5" />
            <span>高差</span>
          </button>
          <button type="button"
            class="flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs hover:bg-muted"
            :class="store.toolMode.value === 'xeokit_measure_angle' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasureAngleClick">
            <Ruler class="h-3.5 w-3.5" />
            <span>角度测量</span>
          </button>
          <button type="button"
            class="flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs hover:bg-muted"
            :class="store.toolMode.value === 'measure_object_to_object' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasureObjectToObjectClick">
            <Ruler class="h-3.5 w-3.5" />
            <span>构件最近点</span>
          </button>
          <button type="button"
            class="flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs hover:bg-muted"
            :class="store.toolMode.value === 'measure_pipe_to_structure' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasurePipeToStructureClick">
            <Ruler class="h-3.5 w-3.5" />
            <span>管-墙/柱</span>
          </button>
          <button type="button"
            class="flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs hover:bg-muted"
            :class="store.toolMode.value === 'measure_pipe_to_pipe' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasurePipeToPipeClick">
            <Ruler class="h-3.5 w-3.5" />
            <span>管-管</span>
          </button>
        </div>
      </div>

      <div class="mx-1.5 my-1 h-px bg-border/70" />
      <button type="button"
        class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
        :class="spatialQueryOpen
          ? 'bg-primary/10 text-primary hover:bg-primary/15'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
        @click.stop="onToolbarSpatialQueryClick">
        <Search class="h-[18px] w-[18px]" />
        <span class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">空间查询</span>
      </button>

      <button type="button"
        class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click.stop="onToolbarPipeNetworkClick">
        <Waypoints class="h-[18px] w-[18px]" />
        <span class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">管网（建设中）</span>
      </button>

      <!-- 设置（弹出配置） -->
      <div class="relative">
        <button type="button"
          class="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
          :class="toolbarSettingsOpen
            ? 'bg-primary/10 text-primary hover:bg-primary/15'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          @click.stop="toggleToolbarSettings">
          <Settings class="h-[18px] w-[18px]" />
          <span v-if="!toolbarSettingsOpen"
            class="pointer-events-none absolute left-full top-1/2 z-[960] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">查看工具设置</span>
        </button>

        <div v-if="toolbarSettingsOpen"
          class="absolute bottom-0 left-full ml-1.5 w-72 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur"
          style="z-index: 941"
          @pointerdown.stop
          @wheel.stop>
          <div class="text-sm font-medium">查看工具设置</div>

          <div class="mt-3 space-y-3">
            <!-- 背景切换 -->
            <div class="space-y-1">
              <label class="text-xs text-muted-foreground">场景背景</label>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="preset in backgroundStore.presets"
                  :key="preset.mode"
                  type="button"
                  class="flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:bg-muted"
                  :class="backgroundStore.mode.value === preset.mode ? 'border-ring bg-muted font-medium' : 'border-border'"
                  :title="preset.label"
                  @click.stop="onBackgroundChange(preset.mode)">
                  <span class="inline-block h-4 w-4 shrink-0 rounded-sm border border-border"
                    :style="{ background: `linear-gradient(to bottom, ${preset.topColor}, ${preset.bottomColor})` }" />
                  <span>{{ preset.label }}</span>
                </button>
              </div>
            </div>

            <!-- 显示主题 -->
            <div class="space-y-1">
              <label class="text-xs text-muted-foreground">显示主题</label>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="preset in displayThemePresets"
                  :key="preset.mode"
                  type="button"
                  class="flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:bg-muted"
                  :class="displayThemeStore.currentTheme.value === preset.mode ? 'border-ring bg-muted font-medium' : 'border-border'"
                  :title="preset.label"
                  @click.stop="onDisplayThemeChange(preset.mode)">
                  <span class="inline-block h-4 w-4 shrink-0 rounded-full border border-border"
                    :style="{ background: preset.colorHint }" />
                  <span>{{ preset.label }}</span>
                </button>
              </div>
            </div>

            <!-- 相机模式 -->
            <div class="space-y-1">
              <label class="text-xs text-muted-foreground">相机视角</label>
              <div class="grid grid-cols-3 gap-1.5">
                <button type="button"
                  class="h-8 rounded-md border px-2 text-xs transition-colors hover:bg-muted"
                  :class="cameraViewMode === 'cad_weak' ? 'border-ring bg-muted font-medium' : 'border-border'"
                  @click.stop="onCameraViewModeChange('cad_weak')">
                  弱透视
                </button>
                <button type="button"
                  class="h-8 rounded-md border px-2 text-xs transition-colors hover:bg-muted"
                  :class="cameraViewMode === 'cad_flat' ? 'border-ring bg-muted font-medium' : 'border-border'"
                  @click.stop="onCameraViewModeChange('cad_flat')">
                  近平行
                </button>
                <button type="button"
                  class="h-8 rounded-md border px-2 text-xs transition-colors hover:bg-muted"
                  :class="cameraViewMode === 'normal' ? 'border-ring bg-muted font-medium' : 'border-border'"
                  @click.stop="onCameraViewModeChange('normal')">
                  标准
                </button>
              </div>
            </div>

            <!-- 全局工程边线 -->
            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <label class="text-xs text-muted-foreground">全局工程边线</label>
                <button type="button"
                  class="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted"
                  :class="globalEdgeEnabled ? 'border-ring bg-muted font-medium' : 'border-border text-muted-foreground'"
                  @click.stop="onGlobalEdgeEnabledChange(!globalEdgeEnabled)">
                  {{ globalEdgeEnabled ? '已开启' : '已关闭' }}
                </button>
              </div>
              <div class="flex items-center justify-between">
                <label class="text-xs text-muted-foreground">边线角阈值</label>
                <span class="text-xs tabular-nums text-foreground">{{ globalEdgeThresholdAngle }}°</span>
              </div>
              <input v-model.number="globalEdgeThresholdAngle"
                type="range"
                min="1"
                max="60"
                class="w-full"
                :disabled="!globalEdgeEnabled"
                @input="onGlobalEdgeThresholdInput(globalEdgeThresholdAngle)" />
              <div class="text-[11px] text-muted-foreground">
                角度越小，边线越密；建议 15~25。
              </div>
            </div>

            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <label class="text-xs text-muted-foreground">选中聚焦半透明</label>
                <button type="button"
                  class="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted"
                  :class="focusTransparencyEnabled ? 'border-ring bg-muted font-medium' : 'border-border text-muted-foreground'"
                  @click.stop="onFocusTransparencyEnabledChange(!focusTransparencyEnabled)">
                  {{ focusTransparencyEnabled ? '已开启' : '已关闭' }}
                </button>
              </div>
              <div class="flex items-center justify-between">
                <label class="text-xs text-muted-foreground">未选中不透明度</label>
                <span class="text-xs tabular-nums text-foreground">{{ focusDimOpacityPercent }}%</span>
              </div>
              <input v-model.number="focusDimOpacityPercent"
                type="range"
                min="5"
                max="100"
                class="w-full"
                :disabled="!focusTransparencyEnabled"
                @input="onFocusDimOpacityInput(focusDimOpacityPercent)" />
              <div class="text-[11px] text-muted-foreground">
                数值越低，未选中对象越透明；建议 15~35。
              </div>
            </div>

            <div class="space-y-1">
              <label class="text-xs text-muted-foreground">空间查询</label>
              <div class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                查询条件、结果显隐和自动加载行为已统一移动到 Viewer 右侧“空间查询”面板中。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <SpatialQueryDrawer v-model:open="spatialQueryOpen" />

    <!-- 管道间距离标注控制面板 -->
    <PipeDistanceDrawer v-model:open="pipeDistDrawerOpen" />

    <div v-if="initError"
      class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur"
      style="z-index: 950">
      <div class="max-w-[520px] rounded-lg border border-border bg-background p-4 text-sm shadow">
        <div class="font-medium text-destructive">
          三维查看器初始化失败
        </div>
        <div class="mt-2 text-muted-foreground">{{ initError }}</div>
      </div>
    </div>

    <ObjectMeasureDrawer v-if="store.toolMode.value === 'measure_object_to_object' && toolsRef"
      :title="'构件最近点测量'"
      :subtitle="'点击模型或在模型树中双选两个构件'"
      :status-text="toolsRef.objectToObjectUiState.value.statusText"
      :source-refno="toolsRef.objectToObjectUiState.value.sourceRefno"
      :target-refno="toolsRef.objectToObjectUiState.value.targetRefno"
      :busy="toolsRef.objectToObjectUiState.value.busy"
      :can-reset="toolsRef.objectToObjectUiState.value.canReset"
      @close="closeObjectMeasureMode"
      @reset="resetObjectMeasureSelection" />

    <MeasurementWizard v-else-if="isNearestMeasurementWizardMode && toolsRef"
      :title="
        store.toolMode.value === 'measure_point_to_object'
          ? '点到面测量'
          : store.toolMode.value === 'measure_pipe_to_structure'
            ? '管-结构/墙 最近点测量'
            : '管-管 最近点测量'
      "
      :status-text="toolsRef.statusText.value"
      style="position: absolute; top: 12px; left: 12px; z-index: 940"
      @pointerdown.stop
      @wheel.stop />

    <AnnotationOverlayBar v-if="toolsRef && modelUnitCompareState?.viewMode !== 'split'" :tools="toolsRef">
      <template #footer>
        <!-- 问题7：批注上下文中「待保存证据」停靠进批注浮层栈底，右上只保留一列面板 -->
        <ReviewConfirmation variant="docked" />
      </template>
    </AnnotationOverlayBar>

    <MeasurementOverlayBar v-if="isXeokitMeasureMode && xeokitMeasurementToolsRef && modelUnitCompareState?.viewMode !== 'split'" :tools="xeokitMeasurementToolsRef" />

    <MeasurementContextMenu v-if="measurementContextMenu && measurementContextMenuRecord"
      :x="measurementContextMenu.x"
      :y="measurementContextMenu.y"
      :record="measurementContextMenuRecord"
      :axis-breakdown-enabled="measurementStyle.state.distanceShowAxisBreakdown"
      :display-unit="unitSettings.displayUnit.value"
      @close="closeMeasurementContextMenu"
      @toggle-axis="onMeasurementMenuToggleAxis"
      @change-unit="onMeasurementMenuChangeUnit"
      @copy-value="onMeasurementMenuCopyValue"
      @copy-components="onMeasurementMenuCopyComponents"
      @repeat="onMeasurementMenuRepeat"
      @locate="onMeasurementMenuLocate"
      @toggle-visible="onMeasurementMenuToggleVisible"
      @remove="onMeasurementMenuRemove" />

    <ReviewConfirmation v-if="!store.annotationOverlayVisible.value" />
  </div>
</template>
