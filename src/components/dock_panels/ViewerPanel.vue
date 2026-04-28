<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import {
  Aperture,
  Eye,
  EyeOff,
  Focus,
  Eraser,
  GitCompare,
  Ruler,
  ScanEye,
  Search,
  Settings,
} from 'lucide-vue-next';
import { Matrix4, Plane, Vector2, Vector3 } from 'three';

import { e3dGetChildren, e3dGetVisibleInsts } from '@/api/genModelE3dApi';
import { pdmsGetPtsetWithContext } from '@/api/genModelPdmsAttrApi';
import { getMbdPipeAnnotations } from '@/api/mbdPipeApi';
import { resolveViewerToolbarSelection } from '@/components/dock_panels/viewerToolbarSelection';
import PipeDistanceDrawer from '@/components/pipe-distance/PipeDistanceDrawer.vue';
import ReviewConfirmation from '@/components/review/ReviewConfirmation.vue';
import SpatialQueryDrawer from '@/components/spatial-query/SpatialQueryDrawer.vue';
import AnnotationOverlayBar from '@/components/tools/AnnotationOverlayBar.vue';
import MeasurementOverlayBar from '@/components/tools/MeasurementOverlayBar.vue';
import MeasurementWizard from '@/components/tools/MeasurementWizard.vue';
import ObjectMeasureDrawer from '@/components/tools/ObjectMeasureDrawer.vue';
import {
  createLatestOnlyGate,
  ExternalAnnotationRegistry,
  shouldClearMbdRequest,
  type MbdPipeAnnotationRequestLike,
} from '@/composables/mbd/mbdRequestSync';
import { useAnnotationThree } from '@/composables/useAnnotationThree';
import { useBackgroundStore } from '@/composables/useBackgroundStore';
import { useConsoleStore } from '@/composables/useConsoleStore';
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo';
import { loadDbnoInstancesForVisibleRefnosDtx, applyMaterialConfigToLoadedDtx } from '@/composables/useDbnoInstancesDtxLoader';
import {
  getDbnoInstancesManifest,
  getDbnoInstancesMeta,
} from '@/composables/useDbnoInstancesJsonLoader';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';
import { DimensionAnnotationManager } from '@/composables/useDimensionAnnotation';
import { useDisplayThemeStore, type DisplayTheme } from '@/composables/useDisplayThemeStore';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useDtxTools } from '@/composables/useDtxTools';
import { useMbdPipeAnnotationThree } from '@/composables/useMbdPipeAnnotationThree';
import { MeasurementAnnotationManager } from '@/composables/useMeasurementAnnotation';
import { useModelGeneration } from '@/composables/useModelGeneration';
import { useModelLoadStatus } from '@/composables/useModelLoadStatus';
import { usePtsetVisualizationThree } from '@/composables/usePtsetVisualizationThree';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useSpatialQuery } from '@/composables/useSpatialQuery';
import { useToolStore, type DimensionKind } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { useXeokitMeasurementTools } from '@/composables/useXeokitMeasurementTools';
import {
  branCameraPresets,
  demoMbdPipeData,
  getMbdPipeDemoConfig,
  resolveMbdPipeDemoCaseFromUrl,
} from '@/debug/injectMbdPipeDemo';
import { onCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';
import { AngleDimension3D, LinearDimension3D, SlopeAnnotation3D, WeldAnnotation3D } from '@/utils/three/annotation';
import { computeDimensionOffsetDir } from '@/utils/three/annotation/utils/computeDimensionOffsetDir';
import { DTXLayer, DTXSelectionController, DTXViewCullController } from '@/utils/three/dtx';
import { DynamicPivotController } from '@/utils/three/dtx/DynamicPivotController';
import { loadModelDisplayConfig } from '@/utils/three/dtx/materialConfig';
import { DTXOverlayHighlighter } from '@/utils/three/dtx/selection/DTXOverlayHighlighter';
import { CadGrid } from '@/viewer/dtx/dtxCadGrid';
import { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import { loadDtxPrimitiveDemo } from '@/viewer/dtx/dtxPrimitiveDemo';
import { DTXTileLodController } from '@/viewer/dtx/DTXTileLodController';
import { DtxViewer, type BackgroundMode } from '@/viewer/dtx/DtxViewer';

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
const consoleStore = useConsoleStore();
const modelLoadStatus = useModelLoadStatus();
const unitSettings = useUnitSettingsStore();
const selectionStore = useSelectionStore();
const spatialQueryStore = useSpatialQuery();
const viewerContext = useViewerContext();
const backgroundStore = useBackgroundStore();
const displayThemeStore = useDisplayThemeStore();

const initError = ref<string | null>(null);

watch(
  initError,
  (message) => {
    viewerContext.viewerError.value = message;
  },
  { immediate: true }
);

const isDev = import.meta.env.DEV;

const dimensionAnnoMgrRef = shallowRef<DimensionAnnotationManager | null>(null);

function normalizeRefnoKeyLike(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*[\\/_-]\s*(\d+)$/);
  if (!m) return s;
  return `${m[1]}_${m[2]}`;
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

/** 与 GET /api/mbd/pipe 的 debug 查询参数对齐；生产包也可用 ?mbd_debug=1 拉取 debug_info */
function isMbdApiDebugFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    return isTruthyUrlQueryFlag(q.get('mbd_debug'));
  } catch {
    return false;
  }
}

function readMbdDimModeFromUrl(): 'classic' | 'rebarviz' | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = String(q.get('mbd_dim_mode') || '')
      .trim()
      .toLowerCase();
    if (raw === 'classic') return 'classic';
    if (raw === 'rebarviz') return 'rebarviz';
  } catch {
    // ignore
  }
  return null;
}

function readMbdDimTextModeFromUrl(): 'backend' | 'auto' | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = String(q.get('mbd_text_mode') || '')
      .trim()
      .toLowerCase();
    if (raw === 'backend') return 'backend';
    if (raw === 'auto') return 'auto';
  } catch {
    // ignore
  }
  return null;
}

function resolveMbdApiMode(mode: 'layout_first' | 'construction' | 'inspection') {
  return mode;
}

function readMbdArrowSizeFromUrl(): number | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = Number(String(q.get('mbd_arrow_size') || '').trim());
    if (Number.isFinite(raw)) return Math.max(6, Math.min(40, raw));
  } catch {
    // ignore
  }
  return null;
}

function readMbdArrowAngleFromUrl(): number | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = Number(String(q.get('mbd_arrow_angle') || '').trim());
    if (Number.isFinite(raw)) return Math.max(8, Math.min(40, raw));
  } catch {
    // ignore
  }
  return null;
}

function readMbdLineWidthFromUrl(): number | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = Number(String(q.get('mbd_line_width') || '').trim());
    if (Number.isFinite(raw)) return Math.max(1, Math.min(6, raw));
  } catch {
    // ignore
  }
  return null;
}

function readMbdArrowStyleFromUrl(): 'open' | 'filled' | 'tick' | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = String(q.get('mbd_arrow_style') || '')
      .trim()
      .toLowerCase();
    if (raw === 'open' || raw === 'filled' || raw === 'tick') return raw;
  } catch {
    // ignore
  }
  return null;
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

// URL 预加载：通过 ?mbd_refno= 或 ?mbd_pipe= 自动触发 MBD 管道标注（mbd_refno 优先）。
// 示例：/?output_project=AvevaMarineSample&mbd_refno=24381_145018
// 兼容：/?output_project=AvevaMarineSample&mbd_pipe=24381/145018
// 调试：加 &mbd_debug=1 可在非 dev 构建下仍请求后端 debug_info（并打印到控制台）
(() => {
  try {
    const q = new URLSearchParams(window.location.search);
    const demo = String(q.get('dtx_demo') || '').toLowerCase();
    if (demo === 'primitives') return;

    const raw = q.get('mbd_refno') ?? q.get('mbd_pipe');
    const refno = raw ? String(raw).trim() : '';
    if (!refno) return;
    store.requestMbdPipeAnnotation(refno);
  } catch {
    // ignore
  }
})();

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

// 左侧竖直工具栏（快捷操作）
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
    mode === 'measure_object_to_object' ||
    mode === 'measure_pipe_to_structure' ||
    mode === 'measure_pipe_to_pipe'
  );
});
const isXeokitMeasureMode = computed(() => {
  return (
    store.toolMode.value === 'xeokit_measure_distance' ||
    store.toolMode.value === 'xeokit_measure_angle'
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
  if (isXeokitMeasureMode.value) return '';
  return toolsRef.value?.hoverText?.value ?? '';
});

// 右侧竖直工具栏（查看/快捷）
const rightToolbarOpenSettings = ref(false);
const spatialQueryOpen = ref(false);
const pipeDistDrawerOpen = ref(false);

const dtxViewerRef = shallowRef<DtxViewer | null>(null);
const dtxLayerRef = shallowRef<DTXLayer | null>(null);
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
const mbdPipeVisRef = shallowRef<ReturnType<
    typeof useMbdPipeAnnotationThree
> | null>(null);
const annotationSystemRef = shallowRef<ReturnType<
    typeof useAnnotationThree
> | null>(null);
const modelGenerationRef = shallowRef<ReturnType<
    typeof useModelGeneration
> | null>(null);

const cameraViewMode = ref<CameraViewMode>('cad_weak');
const globalEdgeEnabled = ref(false);
const globalEdgeThresholdAngle = ref(20);
const focusTransparencyEnabled = ref(false);
const focusDimOpacityPercent = ref(20);

let attachedToScene = false;
let shaderPrecompiled = false;
let lastGlobalEdgeRevision = -1;
let continuousRender = false;
let demoMode: 'none' | 'primitives' | 'mbd_pipe' = 'none';
let demoPrimitiveCount = 1000;
let cadGridEnabled = true;

// ── 标注右键菜单状态 ──
const dimContextMenu = ref<{
    visible: boolean;
    x: number;
    y: number;
    dimId: string;
    kind: DimensionKind | null;
    isReference: boolean;
    supplementary: boolean;
}>({
  visible: false,
  x: 0,
  y: 0,
  dimId: '',
  kind: null,
  isReference: false,
  supplementary: false,
});
let rafId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let offRibbonCommand: (() => void) | null = null;
let offToolsInput: (() => void) | null = null;
let offXeokitToolsInput: (() => void) | null = null;
let offPtsetWatch: (() => void) | null = null;
let offMbdPipeWatch: (() => void) | null = null;
let offShowModelByRefnos: (() => void) | null = null;
let offOpenSpatialQuery: (() => void) | null = null;
let offControlsChange: (() => void) | null = null;
let offPivotEvents: (() => void) | null = null;
let offGizmoEvents: (() => void) | null = null;
let offDocPointerDown: (() => void) | null = null;
let offKeydown: (() => void) | null = null;
let offAnnotationInteraction: (() => void) | null = null;

let dtxGlobalTransformAppliedKey: string | null = null;
let dtxAutoFitAppliedKey: string | null = null;
let activeDbno: number | null = null;
let tileLodInitializedDbno: number | null = null;

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

  dtxGlobalTransformAppliedKey = key;
}

function fitToDtxLayerBBoxOnce(dbno: number, dtxViewer: DtxViewer, dtxLayer: DTXLayer): void {
  const { scale, recenter, autoFitOnLoad } = readDtxScaleConfigFromUrl();
  if (!autoFitOnLoad) return;

  const key = `${dbno}:${scale}:${recenter ? 1 : 0}`;
  if (dtxAutoFitAppliedKey === key) return;

  const box = dtxLayer.getBoundingBox();
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
  dtxViewer.flyTo(position, center, { duration: 0 });
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
            (store.dimensions.value?.length ?? 0) > 0 ||
            (store.annotations.value?.length ?? 0) > 0 ||
            (store.cloudAnnotations.value?.length ?? 0) > 0 ||
            (store.rectAnnotations.value?.length ?? 0) > 0 ||
            (store.obbAnnotations.value?.length ?? 0) > 0;

    const hasPtset = (ptsetVisRef.value?.visualObjects.value?.size ?? 0) > 0;
    const hasMbdPipe = !!mbdPipeVisRef.value?.currentData.value;

    if (!hasMarks && !hasPtset && !hasMbdPipe) return;

    try {
      store.clearAll();
      ptsetVisRef.value?.clearAll();
      mbdPipeVisRef.value?.clearAll();
      emitToast({
        message:
                    '模型单位/重心设置已变更：为避免错位，已清空测量/批注/点集/MBD管道标注（可重新创建）',
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
  const preset = backgroundStore.getPreset(mode);
  dimensionAnnoMgrRef.value?.setBackgroundColor(preset.bottomColor);
}

const displayThemePresets: { mode: DisplayTheme; label: string; colorHint: string }[] = [
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
      const resp = await e3dGetChildren(item.refno, 200);
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
    const resp = await e3dGetVisibleInsts(refno);
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

type MeasureMode = 'measure_distance' | 'measure_angle' | 'xeokit_measure_distance' | 'xeokit_measure_angle' | 'none';

function setMeasureMode(next: MeasureMode): void {
  const mappedMode =
    next === 'measure_distance' ? 'xeokit_measure_distance' : next === 'measure_angle' ? 'xeokit_measure_angle' : next;

  if (mappedMode === 'none') {
    store.setToolMode('none');
    return;
  }

  if (store.toolMode.value === mappedMode) {
    store.setToolMode('none');
  } else {
    if (mappedMode === 'xeokit_measure_distance' || mappedMode === 'xeokit_measure_angle') {
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
    store.toolMode.value !== 'xeokit_measure_angle'
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

function setDimensionMode(next: 'dimension_linear' | 'dimension_angle'): void {
  if (store.toolMode.value === next) {
    store.setToolMode('none');
  } else {
    store.setToolMode(next);
    try {
      ensurePanelAndActivate('dimension');
    } catch {
      // ignore
    }
  }
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

function onLeftMeasureObjectToObjectClick(): void {
  setAutoNearestMode('measure_object_to_object');
  leftToolbarOpenMeasureMenu.value = false;
}

function onLeftMeasurePipeToStructureClick(): void {
  setAutoNearestMode('measure_pipe_to_structure');
  leftToolbarOpenMeasureMenu.value = false;
}

function onLeftMeasurePipeToPipeClick(): void {
  openPipeDistanceDrawer();
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

function openPipeDistanceDrawer(): void {
  pipeDistDrawerOpen.value = true;
  rangeDrawerOpen.value = false;
  if (store.toolMode.value === 'measure_pipe_to_pipe') {
    store.setToolMode('none');
  }
  leftToolbarOpenMeasureMenu.value = false;
  requestRender();
}

function togglePipeDistanceDrawer(): void {
  pipeDistDrawerOpen.value = !pipeDistDrawerOpen.value;
  if (pipeDistDrawerOpen.value) {
    rangeDrawerOpen.value = false;
  }
  if (store.toolMode.value === 'measure_pipe_to_pipe') {
    store.setToolMode('none');
  }
  requestRender();
}

function syncMbdAnnotationsToInteraction(): void {
  const annotationSystem = annotationSystemRef.value;
  const mbdPipeVis = mbdPipeVisRef.value;
  if (!annotationSystem || !mbdPipeVis) return;

  const nextIds = new Set<string>();

  for (const [dimId, dim] of mbdPipeVis.getDimAnnotations()) {
    const interactionId = `mbd_dim_${dimId}`;
    annotationSystem.registerExternalAnnotation(interactionId, dim as any);
    nextIds.add(interactionId);
  }
  for (const [weldId, weld] of mbdPipeVis.getWeldAnnotations()) {
    const interactionId = `mbd_weld_${weldId}`;
    annotationSystem.registerExternalAnnotation(interactionId, weld as any);
    nextIds.add(interactionId);
  }
  for (const [slopeId, slope] of mbdPipeVis.getSlopeAnnotations()) {
    const interactionId = `mbd_slope_${slopeId}`;
    annotationSystem.registerExternalAnnotation(interactionId, slope as any);
    nextIds.add(interactionId);
  }
  for (const [bendId, bend] of mbdPipeVis.getBendAnnotations()) {
    const interactionId = `mbd_bend_${bendId}`;
    annotationSystem.registerExternalAnnotation(interactionId, bend as any);
    nextIds.add(interactionId);
  }

  mbdInteractionRegistry.sync(
    nextIds,
    () => {
      // MBD 标注已在前面 register，这里只需同步 registry 集合。
    },
    (id) => {
      annotationSystem.unregisterExternalAnnotation(id);
    },
  );
}

function clearMbdAnnotationsFromInteraction(): void {
  const annotationSystem = annotationSystemRef.value;
  if (!annotationSystem) {
    mbdInteractionRegistry.clear(() => {
      // ignore
    });
    return;
  }
  mbdInteractionRegistry.clear((id) => {
    annotationSystem.unregisterExternalAnnotation(id);
  });
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
      openPipeDistanceDrawer();
      return;
    case 'measurement.clear':
      store.clearMeasurementResults();
      requestRender();
      return;
    case 'dimension.linear':
      setDimensionMode('dimension_linear');
      return;
    case 'dimension.angle':
      setDimensionMode('dimension_angle');
      return;
    case 'dimension.clear':
      store.clearDimensions();
      requestRender();
      return;
    case 'annotation.create':
      store.setToolMode('annotation');
      requestRender();
      return;
    case 'panel.dimension':
      try {
        ensurePanelAndActivate('dimension');
      } catch {
        // ignore
      }
      return;
    case 'panel.mbdPipe':
      try {
        ensurePanelAndActivate('mbdPipe');
      } catch {
        // ignore
      }
      return;
    case 'panel.pipeDistance':
      togglePipeDistanceDrawer();
      return;
    case 'mbd.generate': {
      // 一条龙：用当前选中 refno 触发 MBD 管道标注生成（复用 store watcher 链路）。
      try {
        ensurePanelAndActivate('mbdPipe');
      } catch {
        // ignore
      }
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.uiTab.value = 'dims';
      }

      const refno = selectionStore.selectedRefno.value;
      if (!refno) {
        emitToast({
          message:
                        '请先选中一个构件（模型树/场景），再生成 MBD 管道标注',
        });
        return;
      }

      store.requestMbdPipeAnnotation(refno);
      return;
    }
    case 'mbd.dim.segment':
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.showDimSegment.value =
                    !mbdPipeVisRef.value.showDimSegment.value;
      }
      requestRender();
      return;
    case 'mbd.dim.chain':
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.showDimChain.value =
                    !mbdPipeVisRef.value.showDimChain.value;
      }
      requestRender();
      return;
    case 'mbd.dim.overall':
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.showDimOverall.value =
                    !mbdPipeVisRef.value.showDimOverall.value;
      }
      requestRender();
      return;
    case 'mbd.dim.port':
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.showDimPort.value =
                    !mbdPipeVisRef.value.showDimPort.value;
      }
      requestRender();
      return;
    case 'mbd.weld':
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.showWelds.value =
                    !mbdPipeVisRef.value.showWelds.value;
      }
      requestRender();
      return;
    case 'mbd.slope':
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.showSlopes.value =
                    !mbdPipeVisRef.value.showSlopes.value;
      }
      requestRender();
      return;
    case 'mbd.segments':
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.showSegments.value =
                    !mbdPipeVisRef.value.showSegments.value;
      }
      requestRender();
      return;
    case 'mbd.labels':
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.showLabels.value =
                    !mbdPipeVisRef.value.showLabels.value;
      }
      requestRender();
      return;
    case 'mbd.toggle_all':
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.isVisible.value =
                    !mbdPipeVisRef.value.isVisible.value;
      }
      requestRender();
      return;
    case 'mbd.flyTo':
      mbdPipeVisRef.value?.flyTo();
      requestRender();
      return;
    case 'mbd.clear':
      mbdPipeVisRef.value?.clearAll();
      requestRender();
      return;
    case 'mbd.settings':
      try {
        ensurePanelAndActivate('mbdPipe');
      } catch {
        // ignore
      }
      if (mbdPipeVisRef.value) {
        mbdPipeVisRef.value.uiTab.value = 'settings';
      }
      requestRender();
      return;
    case 'tools.clear_all':
      store.clearAll();
      ptsetVisRef.value?.clearAll();
      mbdPipeVisRef.value?.clearAll();
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
    tools.onCanvasPointerDown(canvas, e);
    requestRender();
  };
  const onMove = (e: PointerEvent) => {
    tools.onCanvasPointerMove(canvas, e);
    requestRender();
  };
  const onUp = (e: PointerEvent) => {
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

function intersectPlaneFromMouseEvent(e: MouseEvent, plane: Plane): Vector3 | null {
  const canvas = mainCanvas.value;
  const dtxViewer = dtxViewerRef.value;
  if (!canvas || !dtxViewer) return null;

  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  const ndc = new Vector3(x, y, 0.5);
  ndc.unproject(dtxViewer.camera);
  const dir = ndc.sub(dtxViewer.camera.position).normalize();
  const rayOrigin = dtxViewer.camera.position.clone();

  const denom = plane.normal.dot(dir);
  if (Math.abs(denom) < 1e-8) return null;
  const t = -(rayOrigin.dot(plane.normal) + plane.constant) / denom;
  if (!Number.isFinite(t)) return null;
  return dir.multiplyScalar(t).add(rayOrigin);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function computeDimensionOffsetDirectionByCamera(
  start: Vector3,
  end: Vector3,
  camera: any,
): Vector3 | null {
  // 保持原语义：退化时返回 null，由调用方自行决定 fallback（锁定方向/XY 垂线等）。
  return computeDimensionOffsetDir(start, end, camera as any);
}

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

  // 更新三维标注系统的分辨率（LineMaterial 需要）
  annotationSystemRef.value?.setResolution(rect.width, rect.height);
  // 更新 MBD 管道标注分辨率（LineMaterial + CSS2DRenderer 需要）
  mbdPipeVisRef.value?.setResolution(rect.width, rect.height);

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

  // resize 会改变 aspect/projectionMatrix，需更新视锥裁剪与 LOD（避免“旧裁剪状态”）
  viewCullControllerRef.value?.update(dtxViewer.camera);
  tileLodControllerRef.value?.requestUpdate(dtxViewer.camera);

  // 更新动态 pivot 控制器
  pivotControllerRef.value?.update();

  syncGlobalEdgeOverlay();

  const selection = selectionControllerRef.value;
  if (selection?.hasOutline()) {
    selection.renderOutline();
  } else {
    dtxViewer.renderer.render(dtxViewer.scene, dtxViewer.camera);
  }

  try {
    dtxViewer.gizmo?.render();
  } catch {
    // ignore
  }

  // resize 同步渲染：补一次 overlay/labels 更新，避免标签与线条在首帧错位
  toolsRef.value?.updateOverlayPositions();
  ptsetVisRef.value?.updateLabelPositions();
  mbdPipeVisRef.value?.updateLabelPositions();
  if (annotationSystemRef.value) {
    annotationSystemRef.value.update(dtxViewer.camera);
    annotationSystemRef.value.renderLabels(dtxViewer.scene, dtxViewer.camera);
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
    if (cameraChanged) {
      viewCullControllerRef.value?.update(dtxViewer.camera);
      tileLodControllerRef.value?.requestUpdate(dtxViewer.camera);
    }

    syncGlobalEdgeOverlay();

    const selection = selectionControllerRef.value;
    if (selection?.hasOutline()) {
      selection.renderOutline();
    } else {
      dtxViewer.renderer.render(dtxViewer.scene, dtxViewer.camera);
    }

    // ViewportGizmo 需要在主场景渲染后再渲染（会改 viewport/scissor）
    try {
      dtxViewer.gizmo?.render();
    } catch {
      // ignore
    }

    toolsRef.value?.updateOverlayPositions();
    ptsetVisRef.value?.updateLabelPositions();
    mbdPipeVisRef.value?.updateLabelPositions();

    // 三维标注系统更新
    if (annotationSystemRef.value) {
      annotationSystemRef.value.update(dtxViewer.camera);
      annotationSystemRef.value.renderLabels(dtxViewer.scene, dtxViewer.camera);
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
  rightToolbarOpenSettings.value = false;

  if (mode === 'range' && options?.useSelection) {
    spatialQueryStore.applyCurrentSelection();
  }

  if (options?.autoSubmit) {
    void spatialQueryStore.submitQuery();
  }
}

function onRightSpatialQueryClick(): void {
  openSpatialQueryDrawer(spatialQueryStore.draft.mode);
}

function onRightRoomShowAllClick(): void {
  // 以“房间树当前选中房间”为准：由 ModelTreePanel 消费请求并执行 isolate/flyTo。
  quickViewReq.requestShowSelectedRoomModels();
  ensurePanelAndActivate('modelTree');
}

function onRightPipeNetworkClick(): void {
  emitToast({ message: '管网（BRAN）功能建设中（占位）' });
}

function toggleRightSettings(): void {
  rightToolbarOpenSettings.value = !rightToolbarOpenSettings.value;
  if (rightToolbarOpenSettings.value) {
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

// ── 标注右键菜单动作 ──
function closeDimContextMenu(): void {
  dimContextMenu.value.visible = false;
}

function dimCtxToggleReference(): void {
  const { dimId, isReference } = dimContextMenu.value;
  if (!dimId) return;
  if (dimId.startsWith('mbd:')) {
    const mbdId = dimId.slice(4);
    mbdPipeVisRef.value?.updateDimOverride(mbdId, { isReference: !isReference });
  } else {
    try { store.updateDimension(dimId, { isReference: !isReference } as any); } catch { /* ignore */ }
  }
  closeDimContextMenu();
  requestRender();
}

function dimCtxToggleSupplementary(): void {
  const { dimId, supplementary } = dimContextMenu.value;
  if (!dimId) return;
  try {
    store.updateDimension(dimId, { supplementary: !supplementary } as any);
  } catch { /* ignore */ }
  closeDimContextMenu();
  requestRender();
}

function dimCtxSnapToGrid(): void {
  const { dimId } = dimContextMenu.value;
  if (!dimId) return;
  if (dimId.startsWith('mbd:')) {
    // MBD dim: snap 当前 annotation 的 labelOffsetWorld
    const mbdId = dimId.slice(4);
    const dim = mbdPipeVisRef.value?.getDimAnnotations().get(mbdId);
    if (dim) {
      const p = dim.getParams();
      const low = p.labelOffsetWorld;
      if (low) {
        const gridStep = 0.05;
        const snapped = new Vector3(
          Math.round(low.x / gridStep) * gridStep,
          Math.round(low.y / gridStep) * gridStep,
          Math.round(low.z / gridStep) * gridStep,
        );
        dim.setParams({ labelOffsetWorld: snapped });
        mbdPipeVisRef.value?.updateDimOverride(mbdId, {
          labelOffsetWorld: [snapped.x, snapped.y, snapped.z],
        });
      }
    }
  } else {
    const rec = (store.dimensions.value || []).find((d: any) => d?.id === dimId) as any;
    if (!rec) { closeDimContextMenu(); return; }
    const low = rec.labelOffsetWorld as [number, number, number] | null | undefined;
    if (low) {
      const gridStep = 0.05;
      const snapped: [number, number, number] = [
        Math.round(low[0] / gridStep) * gridStep,
        Math.round(low[1] / gridStep) * gridStep,
        Math.round(low[2] / gridStep) * gridStep,
      ];
      try { store.updateDimension(dimId, { labelOffsetWorld: snapped } as any); } catch { /* ignore */ }
    }
  }
  closeDimContextMenu();
  requestRender();
}

function dimCtxResetLayout(): void {
  const { dimId } = dimContextMenu.value;
  if (!dimId) return;
  if (dimId.startsWith('mbd:')) {
    const mbdId = dimId.slice(4);
    const dim = mbdPipeVisRef.value?.getDimAnnotations().get(mbdId);
    if (dim) {
      dim.setParams({ labelOffsetWorld: null, labelT: 0.5 });
      mbdPipeVisRef.value?.resetDimOverride(mbdId);
    }
  } else {
    try { store.updateDimension(dimId, { labelOffsetWorld: null, labelT: 0.5 } as any); } catch { /* ignore */ }
  }
  closeDimContextMenu();
  requestRender();
}

onMounted(async () => {
  const canvas = mainCanvas.value;
  const container = containerRef.value;
  if (!canvas || !container) return;

  initError.value = null;
  needsRender = true;
  attachedToScene = false;
  shaderPrecompiled = false;
  continuousRender = false;
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
    } else if (demo === 'mbd_pipe') {
      demoMode = 'mbd_pipe';
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

  const dtxLayer = new DTXLayer({
    renderer: dtxViewer.renderer,
    debug: isDev,
  });
  dtxLayer.setRenderer(dtxViewer.renderer);
  dtxLayerRef.value = dtxLayer;

  // 全局工程边线：深灰细线（无填充），用于接近 CAD 轮廓观感
  const globalEdgeOverlay = new DTXOverlayHighlighter(dtxViewer.scene, {
    showFill: false,
    edgeColor: 0x4b5563,
    edgeThresholdAngle: 20,
    edgeAlwaysOnTop: false,
  });
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
  (compat as any).__dtxAfterInstancesLoaded = (
    _dbno: number,
    loadedRefnos: string[],
  ) => {
    activeDbno = _dbno;
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
    requestRender();
  };
  compatViewerRef.value = compat;
  modelGenerationRef.value = useModelGeneration({ viewer: compat });

  const tools = useDtxTools({
    dtxViewerRef,
    dtxLayerRef,
    selectionRef: selectionControllerRef,
    overlayContainerRef: overlayContainer,
    annotationSystemRef,
    store,
    compatViewerRef,
    requestRender,
  });
  toolsRef.value = tools;
  tools.refreshReadyState();

  const xeokitMeasurementTools = useXeokitMeasurementTools({
    dtxViewerRef,
    dtxLayerRef,
    selectionRef: selectionControllerRef,
    overlayContainerRef: overlayContainer,
    annotationSystemRef,
    store,
    compatViewerRef,
    requestRender,
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

  const mbdPipeVis = useMbdPipeAnnotationThree(dtxViewerRef, overlayContainer, {
    requestRender,
    getGlobalModelMatrix: () =>
      dtxLayerRef.value?.getGlobalModelMatrix() ?? null,
  });
  const mbdDimModeFromUrl = readMbdDimModeFromUrl();
  if (mbdDimModeFromUrl) {
    mbdPipeVis.dimMode.value = mbdDimModeFromUrl;
  }
  const mbdDimTextModeFromUrl = readMbdDimTextModeFromUrl();
  if (mbdDimTextModeFromUrl) {
    mbdPipeVis.dimTextMode.value = mbdDimTextModeFromUrl;
  }
  const mbdArrowStyleFromUrl = readMbdArrowStyleFromUrl();
  if (mbdArrowStyleFromUrl) {
    mbdPipeVis.rebarvizArrowStyle.value = mbdArrowStyleFromUrl;
  }
  const mbdArrowSizeFromUrl = readMbdArrowSizeFromUrl();
  if (mbdArrowSizeFromUrl !== null) {
    mbdPipeVis.rebarvizArrowSizePx.value = mbdArrowSizeFromUrl;
  }
  const mbdArrowAngleFromUrl = readMbdArrowAngleFromUrl();
  if (mbdArrowAngleFromUrl !== null) {
    mbdPipeVis.rebarvizArrowAngleDeg.value = mbdArrowAngleFromUrl;
  }
  const mbdLineWidthFromUrl = readMbdLineWidthFromUrl();
  if (mbdLineWidthFromUrl !== null) {
    mbdPipeVis.rebarvizLineWidthPx.value = mbdLineWidthFromUrl;
  }
  mbdPipeVisRef.value = mbdPipeVis;

  // mbd_pipe demo：不依赖后端，直接注入模拟管道几何体 + 标注
  if (demoMode === 'mbd_pipe') {
    try {
      const demoCase = resolveMbdPipeDemoCaseFromUrl();
      const demoConfig = getMbdPipeDemoConfig(demoCase);
      demoConfig.geometry(dtxViewer);
      mbdPipeVis.renderBranch(demoConfig.data);
      demoConfig.flyTo(dtxViewer);
      emitToast({
        message: `[mbd_pipe demo:${demoConfig.key}] ${demoConfig.title} 已加载：段${demoConfig.data.stats.segments_count} 尺寸${demoConfig.data.stats.dims_count} 焊缝${demoConfig.data.stats.welds_count} 坡度${demoConfig.data.stats.slopes_count} 弯头${demoConfig.data.stats.bends_count}`,
      });
      if (demoConfig.key === 'rebarviz_beam') {
        emitToast({
          message:
                        '[mbd_pipe demo] 对标 RebarViz 梁案例：可用 ?mbd_pipe_case=rebarviz_beam 直接访问',
        });
      }
      // Expose BRAN camera presets for manual verification (dev mode)
      if (isDev && demoConfig.key === 'bran_fixture') {
        (window as any).__branCameraPresets = branCameraPresets;
        console.info('[BRAN Verification] Camera presets available: window.__branCameraPresets');
        console.info('Usage: __branCameraPresets.normalSegments(__dtxViewer)');
      }
      requestRender();
    } catch (e) {
      console.warn('[ViewerPanel] mbd_pipe demo 初始化失败', e);
    }
  }

  // 三维标注系统初始化
  const annotationSystem = useAnnotationThree(dtxViewerRef, overlayContainer, {
    requestRender,
    getGlobalModelMatrix: () =>
      dtxLayerRef.value?.getGlobalModelMatrix() ?? null,
    interaction: {
      // 尺寸标注需支持 SolveSpace 风格拖拽调整
      enableDrag: true,
    },
  });
  annotationSystemRef.value = annotationSystem;
  // 初始化 CSS2DRenderer
  if (overlayContainer.value && mainCanvas.value) {
    annotationSystem.initCSS2DRenderer(overlayContainer.value, mainCanvas.value);
    // 启用标注交互（点击选中、悬停高亮）
    annotationSystem.enableInteraction(mainCanvas.value);

    // 尺寸标注拖拽：写回 store.dimensions（offset/arcRadius）
    let prevControlsEnabled: boolean | null = null;
    let lastDimLabelClickId: string | null = null;
    let lastDimLabelClickTime = 0;
    const linearDragState = new Map<
            string,
            { flip: 1 | -1; lastAlt: boolean }
        >();
    offAnnotationInteraction?.();
    offAnnotationInteraction = annotationSystem.onInteraction((ev) => {
      const id = typeof ev?.id === 'string' ? ev.id : null;
      if (!id) return;
      if (id === 'dim_preview') return;

      // MBD dims 处理（session-only 交互）
      if (id.startsWith('mbd_dim_')) {
        const mbdDimId = id.slice('mbd_dim_'.length);
        const dtxViewer2 = dtxViewerRef.value;
        if (!dtxViewer2) return;

        if (ev.type === 'drag-start') {
          dtxViewer2.controls.enabled = false;
          return;
        }
        if (ev.type === 'drag-end') {
          dtxViewer2.controls.enabled = true;
          requestRender();
          return;
        }
        if (ev.type === 'drag' && ev.annotation instanceof LinearDimension3D) {
          const me = ev.originalEvent;
          if (!me) return;
          const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
          const p = ev.annotation.getParams();
          const start = p.start.clone();
          const end = p.end.clone();

          if (role === 'label') {
            // SolveSpace 风格：自由拖拽 label
            const seg = end.clone().sub(start);
            if (seg.lengthSq() < 1e-9) return;
            seg.normalize();
            const offsetDirVec = p.direction?.clone() ?? new Vector3(-seg.y, seg.x, 0);
            if (offsetDirVec.lengthSq() < 1e-9) offsetDirVec.set(1, 0, 0);
            offsetDirVec.normalize();
            const mid = start.clone().add(end).multiplyScalar(0.5);
            const planeNormal = seg.clone().cross(offsetDirVec);
            if (planeNormal.lengthSq() < 1e-9) return;
            planeNormal.normalize();
            const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, mid);
            const hit = intersectPlaneFromMouseEvent(me, plane);
            if (!hit) return;
            const defaultLabelPos = ev.annotation.getDefaultLabelWorldPos();
            let labelOffset = hit.clone().sub(defaultLabelPos);
            if (me.shiftKey) {
              const gridStep = 0.05;
              labelOffset.x = Math.round(labelOffset.x / gridStep) * gridStep;
              labelOffset.y = Math.round(labelOffset.y / gridStep) * gridStep;
              labelOffset.z = Math.round(labelOffset.z / gridStep) * gridStep;
            }
            try {
              ev.annotation.setParams({ labelOffsetWorld: labelOffset });
              mbdPipeVisRef.value?.updateDimOverride(mbdDimId, {
                labelOffsetWorld: [labelOffset.x, labelOffset.y, labelOffset.z],
              });
            } catch { /* ignore */ }
            requestRender();
            return;
          }

          if (role === 'offset') {
            // 拖拽尺寸线调整 offset
            const seg = end.clone().sub(start);
            if (seg.lengthSq() < 1e-9) return;
            seg.normalize();
            const offsetDirVec = p.direction?.clone() ?? new Vector3(-seg.y, seg.x, 0);
            if (offsetDirVec.lengthSq() < 1e-9) offsetDirVec.set(1, 0, 0);
            offsetDirVec.normalize();
            const mid = start.clone().add(end).multiplyScalar(0.5);
            const planeNormal = seg.clone().cross(offsetDirVec);
            if (planeNormal.lengthSq() < 1e-9) return;
            planeNormal.normalize();
            const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, mid);
            const hit = intersectPlaneFromMouseEvent(me, plane);
            if (!hit) return;
            const nextOffset = hit.clone().sub(mid).dot(offsetDirVec);
            try {
              ev.annotation.setParams({ offset: nextOffset });
              mbdPipeVisRef.value?.updateDimOverride(mbdDimId, {
                offset: nextOffset,
                direction: [offsetDirVec.x, offsetDirVec.y, offsetDirVec.z],
              });
            } catch { /* ignore */ }
            requestRender();
            return;
          }
        }
        // contextmenu: 右键菜单也适用于 MBD dims
        if (ev.type === 'contextmenu') {
          const sp = (ev as any).screenPos as { x: number; y: number } | undefined;
          const isReference =
                        ev.annotation instanceof LinearDimension3D
                          ? !!ev.annotation.getParams().isReference
                          : false;
          dimContextMenu.value = {
            visible: true,
            x: sp?.x ?? 0,
            y: sp?.y ?? 0,
            dimId: `mbd:${mbdDimId}`,
            kind: 'linear_distance',
            isReference,
            supplementary: false,
          };
        }
        return;
      }

      // MBD weld 处理（session-only 交互：label 拖拽）
      if (id.startsWith('mbd_weld_')) {
        const dtxViewer2 = dtxViewerRef.value;
        if (!dtxViewer2) return;

        if (ev.type === 'drag-start') {
          dtxViewer2.controls.enabled = false;
          return;
        }
        if (ev.type === 'drag-end') {
          dtxViewer2.controls.enabled = true;
          requestRender();
          return;
        }
        if (ev.type === 'drag' && ev.annotation instanceof WeldAnnotation3D) {
          const me = ev.originalEvent;
          if (!me) return;
          const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
          if (role === 'label') {
            const defaultPos = ev.annotation.getDefaultLabelWorldPos();
            const camDir = dtxViewer2.camera.getWorldDirection(new Vector3());
            const planeNormal = camDir.clone();
            const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, defaultPos);
            const hit = intersectPlaneFromMouseEvent(me, plane);
            if (!hit) return;
            const labelOffset = hit.clone().sub(defaultPos);
            try {
              ev.annotation.setParams({ labelOffsetWorld: labelOffset });
            } catch { /* ignore */ }
            requestRender();
          }
        }
        return;
      }

      // MBD slope 处理（session-only 交互：label 拖拽）
      if (id.startsWith('mbd_slope_')) {
        const dtxViewer2 = dtxViewerRef.value;
        if (!dtxViewer2) return;

        if (ev.type === 'drag-start') {
          dtxViewer2.controls.enabled = false;
          return;
        }
        if (ev.type === 'drag-end') {
          dtxViewer2.controls.enabled = true;
          requestRender();
          return;
        }
        if (ev.type === 'drag' && ev.annotation instanceof SlopeAnnotation3D) {
          const me = ev.originalEvent;
          if (!me) return;
          const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
          if (role === 'label') {
            const defaultPos = ev.annotation.getDefaultLabelWorldPos();
            const camDir = dtxViewer2.camera.getWorldDirection(new Vector3());
            const planeNormal = camDir.clone();
            const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, defaultPos);
            const hit = intersectPlaneFromMouseEvent(me, plane);
            if (!hit) return;
            const labelOffset = hit.clone().sub(defaultPos);
            try {
              ev.annotation.setParams({ labelOffsetWorld: labelOffset });
            } catch { /* ignore */ }
            requestRender();
          }
        }
        return;
      }

      // MBD bend 处理（session-only 交互：label 拖拽）
      if (id.startsWith('mbd_bend_')) {
        const dtxViewer2 = dtxViewerRef.value;
        if (!dtxViewer2) return;

        if (ev.type === 'drag-start') {
          dtxViewer2.controls.enabled = false;
          return;
        }
        if (ev.type === 'drag-end') {
          dtxViewer2.controls.enabled = true;
          requestRender();
          return;
        }
        if (ev.type === 'drag' && ev.annotation instanceof AngleDimension3D) {
          const me = ev.originalEvent;
          if (!me) return;
          const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
          if (role === 'label') {
            const defaultPos = ev.annotation.getDefaultLabelWorldPos();
            const camDir = dtxViewer2.camera.getWorldDirection(new Vector3());
            const plane = new Plane().setFromNormalAndCoplanarPoint(camDir, defaultPos);
            const hit = intersectPlaneFromMouseEvent(me, plane);
            if (!hit) return;
            const labelOffset = hit.clone().sub(defaultPos);
            try {
              ev.annotation.setParams({ labelOffsetWorld: labelOffset });
            } catch { /* ignore */ }
            requestRender();
          }
        }
        return;
      }

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

      if (!id.startsWith('dim_')) return;

      const dtxViewer2 = dtxViewerRef.value;
      if (!dtxViewer2) return;

      const dimId = id.slice('dim_'.length);
      const rec = (store.dimensions.value || []).find((d: any) => d?.id === dimId) as any;
      if (!rec) return;

      // 同步选中状态 -> store.activeDimensionId（便于 Delete 快捷键等）
      if (ev.type === 'select') {
        store.activeDimensionId.value = dimId;
      } else if (ev.type === 'deselect') {
        if (store.activeDimensionId.value === dimId) {
          store.activeDimensionId.value = null;
        }
      }

      // 右键菜单：显示尺寸标注的操作菜单
      if (ev.type === 'contextmenu') {
        const sp = (ev as any).screenPos as { x: number; y: number } | undefined;
        dimContextMenu.value = {
          visible: true,
          x: sp?.x ?? 0,
          y: sp?.y ?? 0,
          dimId,
          kind: rec.kind as DimensionKind,
          isReference: !!rec.isReference,
          supplementary: !!(rec as any).supplementary,
        };
        return;
      }

      // 双击文字：打开尺寸面板编辑 textOverride
      if (ev.type === 'click') {
        const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
        if (role === 'label') {
          const now = Date.now();
          const isDouble =
                        lastDimLabelClickId === dimId && now - lastDimLabelClickTime < 350;
          lastDimLabelClickId = dimId;
          lastDimLabelClickTime = now;
          if (isDouble) {
            try {
              store.pendingDimensionEditId.value = dimId;
              store.activeDimensionId.value = dimId;
              ensurePanelAndActivate('dimension');
            } catch {
              // ignore
            }
          }
        }
      }

      if (ev.type === 'drag-start') {
        prevControlsEnabled = dtxViewer2.controls.enabled;
        dtxViewer2.controls.enabled = false;

        // Alt：按一次切换“翻面锁定”（不会因松开 Alt 自动复原）
        try {
          const role = (ev.hitObject as any)?.userData?.dragRole as
                        | string
                        | undefined;
          if (role === 'offset' && rec.kind === 'linear_distance') {
            const me = ev.originalEvent;
            const alt = !!me?.altKey;
            linearDragState.set(dimId, {
              flip: alt ? -1 : 1,
              lastAlt: alt,
            });
          } else {
            linearDragState.delete(dimId);
          }
        } catch {
          // ignore
        }
        return;
      }

      if (ev.type === 'drag-end') {
        if (prevControlsEnabled !== null) {
          dtxViewer2.controls.enabled = prevControlsEnabled;
        } else {
          dtxViewer2.controls.enabled = true;
        }
        prevControlsEnabled = null;
        linearDragState.delete(dimId);
        try {
          if (ev.annotation instanceof LinearDimension3D) {
            ev.annotation.setLabelSnapActive(false);
            ev.annotation.setLabelSnapMarkersState(false, null, null);
            ev.annotation.setLabelSnapGuideTarget(null);
            ev.annotation.setLabelSnapGuideVisible(false);
          } else if (ev.annotation instanceof AngleDimension3D) {
            ev.annotation.setLabelSnapActive(false);
            ev.annotation.setLabelSnapMarkersState(false, null, null);
            ev.annotation.setLabelSnapGuideTarget(null);
            ev.annotation.setLabelSnapGuideVisible(false);
          }
        } catch {
          // ignore
        }
        requestRender();
        return;
      }

      if (ev.type !== 'drag') return;
      const me = ev.originalEvent;
      if (!me) return;
      const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;

      const maybeSnapLabelT = (
        t0: number,
      ): { t: number; snapped: boolean; index: number | null; nearIndex: number | null } => {
        const t = clamp(t0, 0, 1);
        if (!(me.shiftKey || me.altKey)) return { t, snapped: false, index: null, nearIndex: null };
        const pts = [0, 0.25, 0.5, 0.75, 1];
        const eps = 0.05;
        let best = t;
        let bestDist = Infinity;
        let bestIndex = 2;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i]!;
          const d = Math.abs(t - p);
          if (d < bestDist) {
            bestDist = d;
            best = p;
            bestIndex = i;
          }
        }
        return bestDist <= eps
          ? { t: best, snapped: true, index: bestIndex, nearIndex: bestIndex }
          : { t, snapped: false, index: null, nearIndex: bestIndex };
      };

      // Linear distance: offset 沿 offsetDir 调整（可为负，允许翻面）
      if (rec.kind === 'linear_distance' && ev.annotation instanceof LinearDimension3D) {
        const p = ev.annotation.getParams();
        const start = p.start.clone();
        const end = p.end.clone();
        const seg = end.clone().sub(start);
        if (seg.lengthSq() < 1e-9) return;
        seg.normalize();

        const lockDir = me.ctrlKey || me.metaKey;
        const st = linearDragState.get(dimId);
        if (st) {
          const alt = !!me.altKey;
          if (alt && !st.lastAlt) {
            st.flip = st.flip === 1 ? -1 : 1;
          }
          st.lastAlt = alt;
        }

        // Shift：按相机重算 offsetDir（更接近“屏幕方向”拖拽）
        const cameraDir =
                    me.shiftKey && !lockDir && role !== 'label'
                      ? computeDimensionOffsetDirectionByCamera(
                        start,
                        end,
                              dtxViewer2.camera as any,
                      )
                      : null;
        const offsetDir =
                    (cameraDir
                      ? cameraDir.clone()
                      : // Ctrl/Cmd：锁定（优先使用记录里的方向）
                      (lockDir && rec.direction
                        ? new Vector3(rec.direction[0], rec.direction[1], rec.direction[2])
                        : (p.direction ? p.direction.clone() : null))) ||
                    new Vector3(-seg.y, seg.x, 0);
        if (offsetDir.lengthSq() < 1e-9) offsetDir.set(1, 0, 0);
        offsetDir.normalize();

        const mid = start.clone().add(end).multiplyScalar(0.5);
        const planeNormal = seg.clone().cross(offsetDir);
        if (planeNormal.lengthSq() < 1e-9) return;
        planeNormal.normalize();
        const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, mid);
        const hit = intersectPlaneFromMouseEvent(me, plane);
        if (!hit) return;

        if (role === 'label') {
          // SolveSpace 风格：label 自由拖拽（ray-plane intersection）
          // 按住 Shift 时 snap to grid（默认步长 0.05 世界单位）
          const defaultLabelPos = ev.annotation.getDefaultLabelWorldPos();
          let labelOffset = hit.clone().sub(defaultLabelPos);

          // Snap to Grid（Shift 键激活）
          if (me.shiftKey) {
            const gridStep = 0.05; // 世界坐标网格步长
            labelOffset.x = Math.round(labelOffset.x / gridStep) * gridStep;
            labelOffset.y = Math.round(labelOffset.y / gridStep) * gridStep;
            labelOffset.z = Math.round(labelOffset.z / gridStep) * gridStep;
          }

          try {
            ev.annotation.setParams({
              labelOffsetWorld: labelOffset,
            });
          } catch {
            // ignore
          }
          try {
            store.updateDimension(dimId, {
              labelOffsetWorld: [labelOffset.x, labelOffset.y, labelOffset.z],
              direction: rec.direction,
            });
          } catch {
            // ignore
          }
          requestRender();
          return;
        }

        let nextOffset = hit.clone().sub(mid).dot(offsetDir);
        if (st) nextOffset *= st.flip;
        try {
          store.updateDimension(dimId, {
            offset: nextOffset,
            direction:
                            me.shiftKey && !lockDir
                              ? [offsetDir.x, offsetDir.y, offsetDir.z]
                              : (rec.direction ?? [offsetDir.x, offsetDir.y, offsetDir.z]),
          });
        } catch {
          // ignore
        }
        requestRender();
        return;
      }

      // Angle: offset 用作 arcRadius（正值）
      if (rec.kind === 'angle' && ev.annotation instanceof AngleDimension3D) {
        const p = ev.annotation.getParams();
        const vertex = p.vertex.clone();
        const u = p.point1.clone().sub(vertex);
        const v = p.point2.clone().sub(vertex);
        let normal = u.clone().cross(v);
        if (normal.lengthSq() < 1e-9) {
          normal = new Vector3();
          dtxViewer2.camera.getWorldDirection(normal).normalize();
        } else {
          normal.normalize();
        }
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal, vertex);
        const hit = intersectPlaneFromMouseEvent(me, plane);
        if (!hit) return;

        const rVec = hit.clone().sub(vertex);
        if (role === 'label') {
          // SolveSpace 风格：label 自由拖拽
          const defaultLabelPos = ev.annotation.getDefaultLabelWorldPos();
          let labelOffset = hit.clone().sub(defaultLabelPos);

          // Snap to Grid（Shift 键激活）
          if (me.shiftKey) {
            const gridStep = 0.05;
            labelOffset.x = Math.round(labelOffset.x / gridStep) * gridStep;
            labelOffset.y = Math.round(labelOffset.y / gridStep) * gridStep;
            labelOffset.z = Math.round(labelOffset.z / gridStep) * gridStep;
          }

          try {
            ev.annotation.setParams({
              labelOffsetWorld: labelOffset,
            });
          } catch {
            // ignore
          }
          try {
            store.updateDimension(dimId, {
              labelOffsetWorld: [labelOffset.x, labelOffset.y, labelOffset.z],
            });
          } catch {
            // ignore
          }
          requestRender();
          return;
        }

        const r = rVec.length();
        const nextRadius = Math.max(0.2, Math.min(10, r));
        try {
          store.updateDimension(dimId, { offset: nextRadius });
        } catch {
          // ignore
        }
        requestRender();
      }
    });
  }

  // 测量标注：同步到三维标注系统（SolveSpace 风格 3D 标注）
  try {
    const mgr = new MeasurementAnnotationManager(annotationSystem);
    const syncSelectedMeasurementAnnotation = () => {
      const activeId = store.activeMeasurementId.value;
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

  // 尺寸标注（与测量分离）：同步到三维标注系统（3D 文字 + 3D 线）
  try {
    const mgr = new DimensionAnnotationManager(annotationSystem);
    mgr.setUnit(unitSettings.displayUnit.value as any);
    mgr.setPrecision(unitSettings.precision.value);
    const bgPreset = backgroundStore.getPreset(backgroundStore.mode.value);
    mgr.setBackgroundColor(bgPreset.bottomColor);
    mgr.sync(store.dimensions.value as any);
    dimensionAnnoMgrRef.value = mgr;

    watch(
      () => store.dimensions.value,
      (dims) => {
        mgr.sync(dims as any);
        requestRender();
      },
      { deep: true },
    );

    watch(
      () => [unitSettings.displayUnit.value, unitSettings.precision.value] as const,
      ([unit, precision]) => {
        mgr.setUnit(unit as any);
        mgr.setPrecision(precision);
        mgr.sync(store.dimensions.value as any);
        requestRender();
      },
    );
  } catch (e) {
    console.warn('[ViewerPanel] 尺寸标注管理器初始化失败', e);
  }

  // 将 MBD 标注注册到标注交互系统（使其可 pick/drag/contextmenu）
  function syncMbdAnnotationsToInteraction(): void {
    if (!mbdPipeVisRef.value || !annotationSystemRef.value) return;
    const dimMap = mbdPipeVisRef.value.getDimAnnotations();
    for (const [dimId, dim] of dimMap) {
      const interactionId = `mbd_dim_${dimId}`;
      annotationSystemRef.value.registerExternalAnnotation(interactionId, dim as any);
    }
    const weldMap = mbdPipeVisRef.value.getWeldAnnotations();
    for (const [weldId, weld] of weldMap) {
      const interactionId = `mbd_weld_${weldId}`;
      annotationSystemRef.value.registerExternalAnnotation(interactionId, weld as any);
    }
    const slopeMap = mbdPipeVisRef.value.getSlopeAnnotations();
    for (const [slopeId, slope] of slopeMap) {
      const interactionId = `mbd_slope_${slopeId}`;
      annotationSystemRef.value.registerExternalAnnotation(interactionId, slope as any);
    }
  }

  // 对 mbd_pipe demo：此时标注已在 renderBranch 中创建，注册到交互系统
  if (demoMode === 'mbd_pipe') {
    try {
      syncMbdAnnotationsToInteraction();
    } catch (e) {
      console.warn('[ViewerPanel] MBD 标注交互注册失败', e);
    }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const showDbnum = urlParams.get('show_dbnum');
  const showRefno = normalizeRefnoKeyLike(urlParams.get('show_refno') || '');

  // 启动预拉：db_meta_info（关键，提供 refno->dbnum 映射）
  // demo 模式（primitives / mbd_pipe）不依赖后端数据，跳过预拉避免无后端时初始化失败。
  if (demoMode !== 'primitives' && demoMode !== 'mbd_pipe' && !showDbnum) {
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
  viewerContext.mbdPipeVis.value = mbdPipeVis as any;

  // 开发模式：暴露全局函数用于测试模拟数据
  if (isDev && typeof window !== 'undefined') {
    (window as any).loadMockMbdPipeData = () => {
      try {
        ensurePanelAndActivate('mbdPipe');
        if (mbdPipeVisRef.value) {
          mbdPipeVisRef.value.renderBranch(demoMbdPipeData);
          mbdPipeVisRef.value.flyTo();
          emitToast({
            message: `已加载模拟数据：段${demoMbdPipeData.stats.segments_count} 尺寸${demoMbdPipeData.stats.dims_count} 焊缝${demoMbdPipeData.stats.welds_count} 坡度${demoMbdPipeData.stats.slopes_count} 弯头${demoMbdPipeData.stats.bends_count}`,
          });
          requestRender();
        }
      } catch (e) {
        console.error('[mbd-pipe-mock] Failed to load:', e);
        emitToast({ message: '加载模拟数据失败' });
      }
    };
    console.log('[dev] 已暴露全局函数: window.loadMockMbdPipeData()');
  }
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

  if (showRefno && demoMode !== 'primitives') {
    (async () => {
      try {
        emitToast({ message: `[信息] 正在加载 ${showRefno} …`, level: 'info' });
        console.log(`[show_refno] refno=${showRefno}`);

        await ensureDbMetaInfoLoaded();

        let dbno: number;
        try {
          dbno = getDbnumByRefno(showRefno);
        } catch {
          console.error(`[show_refno] 无法解析 ${showRefno} 的 dbnum`);
          emitToast({
            message: `[错误] 无法解析 dbnum（refno=${showRefno}）`,
            level: 'error',
          });
          return;
        }

        const urlDataSource = new URLSearchParams(window.location.search).get('data_source') as 'json' | 'parquet' | 'auto' | null;
        const ds = urlDataSource || 'auto';
        console.log(`[show_refno] refno=${showRefno} -> dbnum=${dbno}, dataSource=${ds}`);

        // 先查询可见子实例（容器节点本身在 Parquet 中没有几何数据）
        let loadRefnos = [showRefno];
        let visibleInstsUserHint: string | null = null;
        try {
          const visResp = await e3dGetVisibleInsts(showRefno);
          const visRefnos = visResp?.refnos ?? [];
          if (visRefnos.length > 0) {
            loadRefnos = mergeRootRefnoWithVisibleRefnos(showRefno, visRefnos);
            console.log(`[show_refno] visible-insts 返回 ${visRefnos.length} 个子实例，合并根节点后共 ${loadRefnos.length} 个 refno`);
          } else if (visResp?.success) {
            visibleInstsUserHint =
              `可见子实例为 0（refno=${showRefno}），仅加载根节点；若为容器可能没有几何，请检查可见性或数据`;
          }
        } catch (e) {
          console.warn('[show_refno] visible-insts 查询失败，回退直接加载', e);
          visibleInstsUserHint = '查询可见子实例失败，已回退为仅加载根 refno';
        }
        if (visibleInstsUserHint) {
          emitToast({ message: `[警告] ${visibleInstsUserHint}`, level: 'warning' });
        }

        const result = await loadDbnoInstancesForVisibleRefnosDtx(
          dtxLayer,
          dbno,
          loadRefnos,
          { lodAssetKey: 'L1', debug: true, dataSource: ds }
        );
        (compat as any).__dtxAfterInstancesLoaded?.(dbno, loadRefnos);

        requestRender();
        const box = dtxLayer.getBoundingBox();
        if (!box.isEmpty()) {
          const center = new Vector3();
          const size = new Vector3();
          box.getCenter(center);
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          const distance = Math.max(maxDim * 2.5, 5);
          const position = new Vector3(
            center.x + distance * 0.8,
            center.y + distance * 0.6,
            center.z + distance * 0.8
          );
          dtxViewer.flyTo(position, center, { duration: 0 });
          requestRender();
        }

        const detail =
          `对象 ${result.loadedObjects}（已加载 ${result.loadedRefnos}，跳过 ${result.skippedRefnos}，` +
          `mesh 缺失 ${result.missingBreakdown.mesh404Refnos.length}，无几何 ${result.missingBreakdown.noGeoRowsRefnos.length}）`;
        if (result.loadedObjects === 0) {
          emitToast({
            message: `[警告] 加载结束但未绘制实例。${detail} 请检查左侧可见性或 Parquet 数据`,
            level: 'warning',
          });
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

  // show_dbnum URL 参数：按 dbno 直接走 Parquet 全量加载。
  if (showDbnum && !showRefno && demoMode !== 'primitives') {
    const dbno = Number(showDbnum);
    if (Number.isFinite(dbno) && dbno > 0) {
      (async () => {
        try {
          emitToast({ message: `[信息] 正在加载 dbnum=${dbno} 的 Parquet 模型…`, level: 'info' });
          const autoFitKey = `dtx_autofit_dbno_${dbno}`;
          let shouldAutoFit = true;
          try {
            shouldAutoFit = sessionStorage.getItem(autoFitKey) !== '1';
          } catch {}

          const parquetLoader = useDbnoInstancesParquetLoader();
          const available = await parquetLoader.isParquetAvailable(dbno);
          if (!available) {
            emitToast({
              message: `[错误] dbnum=${dbno} 未找到 Parquet 数据`,
              level: 'error',
            });
            return;
          }

          const allRefnos = await parquetLoader.queryAllRefnosByDbno(dbno, {
            debug: isDev,
          });
          if (allRefnos.length === 0) {
            emitToast({
              message: `[警告] dbnum=${dbno} 没有可加载的 refno`,
              level: 'warning',
            });
            return;
          }

          emitToast({
            message: `[信息] 发现 ${allRefnos.length} 个 refno，开始分批加载…`,
            level: 'info',
          });

          const LOAD_BATCH_SIZE = 1000;
          let loadedRefnos = 0;
          let skippedRefnos = 0;
          let loadedObjects = 0;
          let missingRefnos = 0;
          const missingNoGeoRows = new Set<string>();
          const missingMesh404Refnos = new Set<string>();
          const missingMesh404GeoHashes = new Set<string>();

          for (let start = 0; start < allRefnos.length; start += LOAD_BATCH_SIZE) {
            const end = Math.min(allRefnos.length, start + LOAD_BATCH_SIZE);
            const batch = allRefnos.slice(start, end);
            const batchResult = await loadDbnoInstancesForVisibleRefnosDtx(
              dtxLayer,
              dbno,
              batch,
              { lodAssetKey: 'L1', debug: isDev, dataSource: 'parquet' }
            );
            (compat as any).__dtxAfterInstancesLoaded?.(dbno, batch);

            loadedRefnos += batchResult.loadedRefnos;
            skippedRefnos += batchResult.skippedRefnos;
            loadedObjects += batchResult.loadedObjects;
            missingRefnos += batchResult.missingRefnos.length;
            for (const r of batchResult.missingBreakdown.noGeoRowsRefnos) {
              missingNoGeoRows.add(r);
            }
            for (const r of batchResult.missingBreakdown.mesh404Refnos) {
              missingMesh404Refnos.add(r);
            }
            for (const gh of batchResult.missingBreakdown.mesh404GeoHashes) {
              missingMesh404GeoHashes.add(gh);
            }

            if (end < allRefnos.length) {
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve())
              );
            }
          }

          // show_dbnum 路径下也需要初始化 Tile LOD（不走常规 dbno 切换流）
          try {
            tileLodInitializedDbno = dbno;
            tileLodControllerRef.value?.setManifest(dbno, {
              dbno,
              source: 'parquet',
            });
            tileLodControllerRef.value?.requestUpdate(dtxViewer.camera);
          } catch {
            // ignore
          }

          requestRender();
          if (shouldAutoFit) {
            const box = dtxLayer.getBoundingBox();
            const center = new Vector3();
            const size = new Vector3();
            box.getCenter(center);
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            const distance = Math.max(maxDim * 2.5, 5);
            const position = new Vector3(
              center.x + distance * 0.8,
              center.y + distance * 0.6,
              center.z + distance * 0.8
            );
            dtxViewer.flyTo(position, center, { duration: 0 });
            requestRender();
            try {
              sessionStorage.setItem(autoFitKey, '1');
            } catch {}
          }
          const summary =
            `对象 ${loadedObjects}（已加载 ${loadedRefnos}，跳过 ${skippedRefnos}，缺失 ${missingRefnos}；` +
            `mesh 缺失 ${missingMesh404Refnos.size}/hash ${missingMesh404GeoHashes.size}，无几何 ${missingNoGeoRows.size}）`;
          if (loadedObjects === 0) {
            emitToast({
              message: `[警告] 加载结束但未绘制实例。${summary}`,
              level: 'warning',
            });
          } else {
            emitToast({ message: `[成功] ${summary}`, level: 'success' });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[ViewerPanel] show_dbnum Parquet 加载失败:', e);
          emitToast({ message: `[错误] 加载失败：${msg}`, level: 'error' });
        }
      })();
    }
  }

  // debug_refno URL 参数：加载指定 refno 下的可见实例（如 debug_refno=24381_145018）
  const debugRefno = urlParams.get('debug_refno');
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

        // 2. 查询该 refno 下的可见实例
        const visResp = await e3dGetVisibleInsts(refnoStr);
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

        // 3. 加载实例到 DTX（优先 parquet，失败回退 json）
        const urlDataSource = new URLSearchParams(window.location.search).get('data_source') as 'json' | 'parquet' | 'auto' | null;
        const ds = urlDataSource || 'auto';
        console.log(`[debug_refno] dataSource=${ds}`);
        const result = await loadDbnoInstancesForVisibleRefnosDtx(
          dtxLayer,
          dbno,
          refnos,
          { lodAssetKey: 'L1', debug: true, dataSource: ds }
        );
        (compat as any).__dtxAfterInstancesLoaded?.(dbno, refnos);

        // 4. 自适应视角
        requestRender();
        const box = dtxLayer.getBoundingBox();
        const center = new Vector3();
        const size = new Vector3();
        box.getCenter(center);
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const distance = Math.max(maxDim * 2.5, 5);
        const position = new Vector3(
          center.x + distance * 0.8,
          center.y + distance * 0.6,
          center.z + distance * 0.8
        );
        dtxViewer.flyTo(position, center, { duration: 0 });
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
    const rect = canvas.getBoundingClientRect();
    const canvasPos = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    pivotControllerRef.value?.handleMouseDown(canvasPos);
  };

  const onCanvasMouseMove = (e: PointerEvent) => {
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
    xeokitMeasurementToolsRef.value?.onCanvasPointerDown(canvas, e);
  };
  const onXeokitToolsPointerMove = (e: PointerEvent) => {
    xeokitMeasurementToolsRef.value?.onCanvasPointerMove(canvas, e);
  };
  const onXeokitToolsPointerUp = (e: PointerEvent) => {
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
            ev as CustomEvent<{ refnos?: unknown; regenModel?: boolean }>
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
      requestId: hasRequestId ? requestId : undefined,
    });
    consoleStore.addLog(
      'info',
      `[vis][event] showModelByRefnos raw_refno_count=${refnos.length} unique_refno_count=${unique.length} regenModel=${(detail as any)?.regenModel ? 1 : 0} flyTo=${flyTo ? 1 : 0}`,
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
        for (const r of unique) {
          const dtxStatsBefore =
                        (dtxLayer as any)?.getStats?.() ?? null;
          const ok = await mg.showModelByRefno(r, { flyTo: flyTo && unique.length === 1 });
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

  offPtsetWatch = watch(
    () => store.ptsetVisualizationRequest.value,
    async (request) => {
      if (!request) return;

      try {
        emitToast({ message: `正在加载点集数据: ${request.refno}` });
        // ptset 按需获取：尽量带上 dbno + batch_id（来自 meta_{dbno}.json）以确保与当前模型快照一致。
        const normalized = String(request.refno ?? '').trim().replace('/', '_');
        let dbno: number | null = null;
        try {
          dbno = getDbnumByRefno(normalized);
        } catch {
          dbno = null;
        }
        let batchId: string | null = null;

        const response = await pdmsGetPtsetWithContext(request.refno, {
          dbno: dbno ?? undefined,
          batchId,
        });
        if (response.success && response.ptset.length > 0) {
          ptsetVis.renderPtset(request.refno, response);
          ptsetVis.flyToPtset();
          emitToast({
            message: `已显示 ${response.ptset.length} 个连接点`,
          });
          requestRender();
        } else {
          const errorMsg = response.error_message || '未找到点集数据';
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

  offMbdPipeWatch = watch(
    () => store.mbdPipeAnnotationRequest.value,
    async (request) => {
      if (!request) return;
      try {
        try {
          ensurePanelAndActivate('mbdPipe');
        } catch {
          // ignore
        }

        const refnoKey = normalizeRefnoKeyLike(request.refno) || request.refno;
        emitToast({ message: `正在生成管道标注: ${refnoKey}` });

        // 尽量先加载对应模型（避免“只见标注面板、不见模型”）
        try {
          const mg = modelGenerationRef.value;
          if (mg) {
            await mg.showModelByRefno(refnoKey, { flyTo: true });
          }
        } catch (e) {
          console.warn('[mbd-pipe] 预加载模型失败（将继续生成标注）', e);
        }

        // 标注按需获取：尽量带上 dbno + batch_id（来自 meta_{dbno}.json）以确保与当前模型快照一致。
        let dbno: number | null = null;
        try {
          dbno = getDbnumByRefno(refnoKey);
        } catch {
          dbno = null;
        }
        let batchId: string | null = null;

        const resp = await getMbdPipeAnnotations(refnoKey, {
          mode: resolveMbdApiMode(mbdPipeVis.mbdViewMode.value),
          // 显式指定走 SurrealDB，避免环境默认值差异影响测试结果
          source: 'db',
          debug: isDev || isMbdApiDebugFromUrl(),
          dbno: dbno ?? undefined,
          batch_id: batchId,
          // 首期默认值：对齐 MBD 默认
          min_slope: 0.001,
          max_slope: 0.1,
          dim_min_length: 1.0,
          weld_merge_threshold: 1.0,
          include_dims: true,
          // 一期默认切到施工视图：链式/总长/焊口/坡度优先
          include_chain_dims: true,
          include_overall_dim: true,
          include_port_dims: false,
          include_cut_tubis: true,
          include_fittings: true,
          include_tags: true,
          include_layout_hints: true,
          include_layout_result: mbdPipeVis.mbdViewMode.value === 'layout_first',
          include_welds: true,
          include_slopes: true,
          include_bends: true,
          bend_mode: 'facecenter',
        });
        if (resp.success && resp.data) {
          if (mbdPipeVis.mbdViewMode.value === 'layout_first' && !resp.data.layout_result) {
            console.warn('[mbd-pipe] layout_first 未拿到 layout_result，自动回退到 construction', {
              branch_refno: resp.data.branch_refno,
            });
            mbdPipeVis.applyModeDefaults('construction');
            emitToast({
              message: '后端未返回版面排布结果，已按施工模式显示',
            });
          }
          if (resp.data.debug_info && (isDev || isMbdApiDebugFromUrl())) {
            console.info('[mbd-pipe] debug_info', resp.data.debug_info);
          }
          mbdPipeVis.renderBranch(resp.data);
          mbdPipeVis.flyTo();
          // 将 MBD 标注注册到交互系统
          try { syncMbdAnnotationsToInteraction(); } catch { /* ignore */ }
          emitToast({
            message: `已生成标注：段${resp.data.stats.segments_count} 尺寸${resp.data.stats.dims_count} 焊缝${resp.data.stats.welds_count} 坡度${resp.data.stats.slopes_count} 弯头${resp.data.stats.bends_count} 切管${resp.data.stats.cut_tubis_count ?? resp.data.cut_tubis?.length ?? 0} 管件${resp.data.stats.fittings_count ?? resp.data.fittings?.length ?? 0} 标签${resp.data.stats.tags_count ?? resp.data.tags?.length ?? 0}`,
          });
          requestRender();
        } else {
          const msg = resp.error_message || '生成管道标注失败';
          emitToast({ message: msg });
          console.warn('[mbd-pipe]', msg);
        }
      } catch (e) {
        console.error('[mbd-pipe] Failed to load:', e);
        const msg = e instanceof Error ? e.message : String(e);
        emitToast({ message: `生成管道标注失败：${msg}` });
      } finally {
        store.clearMbdPipeAnnotationRequest();
      }
    },
    { immediate: true },
  );

  offRibbonCommand = onCommand(handleRibbonCommand);
  window.addEventListener('openSpatialQuery', handleOpenSpatialQueryEvent as EventListener);
  offOpenSpatialQuery = () => window.removeEventListener('openSpatialQuery', handleOpenSpatialQueryEvent as EventListener);

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

    // 开发模式：Ctrl+Shift+M 加载模拟 MBD 管道标注数据
    if (isDev && ev.ctrlKey && ev.shiftKey && ev.key === 'M') {
      ev.preventDefault();
      try {
        ensurePanelAndActivate('mbdPipe');
        if (mbdPipeVisRef.value) {
          mbdPipeVisRef.value.renderBranch(demoMbdPipeData);
          mbdPipeVisRef.value.flyTo();
          emitToast({
            message: `已加载模拟数据：段${demoMbdPipeData.stats.segments_count} 尺寸${demoMbdPipeData.stats.dims_count} 焊缝${demoMbdPipeData.stats.welds_count} 坡度${demoMbdPipeData.stats.slopes_count} 弯头${demoMbdPipeData.stats.bends_count}`,
          });
          requestRender();
        }
      } catch (e) {
        console.error('[mbd-pipe-mock] Failed to load:', e);
        emitToast({ message: '加载模拟数据失败' });
      }
      return;
    }

    if (ev.key === 'Escape') {
      // 在 pick_refno 模式中，Escape 取消拾取
      if (store.toolMode.value === 'pick_refno') {
        store.cancelPickRefno();
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
        store.toolMode.value === 'xeokit_measure_angle'
      ) {
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

    if (ev.key === 'Enter') {
      // 在 pick_refno 模式中，Enter 确认拾取结果
      if (store.toolMode.value === 'pick_refno') {
        store.confirmPickRefno();
        return;
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

      const did = store.activeDimensionId.value;
      if (did) {
        try {
          toolsRef.value?.removeDimension(did);
        } catch {
          // ignore
        }
        requestRender();
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
  requestRender();
});

onUnmounted(() => {
  viewerContext.viewerError.value = null;
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

  offShowModelByRefnos?.();
  offShowModelByRefnos = null;

  offOpenSpatialQuery?.();
  offOpenSpatialQuery = null;

  offPtsetWatch?.();
  offPtsetWatch = null;

  offMbdPipeWatch?.();
  offMbdPipeWatch = null;

  try {
    ptsetVisRef.value?.clearAll();
  } catch {
    // ignore
  }
  ptsetVisRef.value = null;

  try {
    // 释放材质/CSS2DRenderer DOM 等资源
    mbdPipeVisRef.value?.dispose?.();
  } catch {
    // ignore
  }
  mbdPipeVisRef.value = null;

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
    delete (window as any).__viewerContext;
    delete (window as any).__viewerToolStore;
    delete (window as any).__xeokitMeasurementTools;
    delete (window as any).__viewerTools;
    delete (window as any).__viewer;
  } catch {
    // ignore
  }
  viewerContext.viewerRef.value = null;
  viewerContext.overlayContainerRef.value = null;
  viewerContext.tools.value = null;
  viewerContext.xeokitMeasurementTools.value = null;
  viewerContext.ptsetVis.value = null;
  viewerContext.mbdPipeVis.value = null;
  viewerContext.annotationSystem.value = null;
});
</script>

<template>
  <div ref="containerRef" class="viewer-panel-container">
    <canvas ref="mainCanvas" class="viewer" />
    <div ref="overlayContainer" class="xeokitOverlay" />

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

    <div v-if="store.toolMode.value !== 'none' && activeMeasureTools"
      class="pointer-events-none absolute bottom-2 right-2 rounded-md border border-border bg-background/85 px-2 py-1 text-xs text-foreground shadow-sm backdrop-blur"
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

    <!-- 左侧竖直工具栏（快捷操作） -->
    <div ref="leftToolbarRef"
      class="pointer-events-auto absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-lg backdrop-blur"
      style="z-index: 940"
      @pointerdown.stop
      @wheel.stop>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        title="隐藏（选中对象）"
        @click.stop="hideSelected">
        <EyeOff class="h-5 w-5" />
      </button>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        title="显示（选中对象）"
        @click.stop="showSelected">
        <Eye class="h-5 w-5" />
      </button>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        title="X-ray（选中对象 / 已开启时点击取消）"
        @click.stop="toggleXraySelected">
        <ScanEye class="h-5 w-5" />
      </button>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        title="全部隐藏"
        @click.stop="hideAll">
        <Eraser class="h-5 w-5" />
      </button>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        title="定位显示（选中对象）"
        @click.stop="locateShowSelected">
        <Focus class="h-5 w-5" />
      </button>

      <!-- 测量（下拉：长度/角度） -->
      <div class="relative">
        <button type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
          :class="isMeasureModeActive ? 'bg-muted' : ''"
          title="测量"
          @click.stop="toggleLeftMeasureMenu">
          <Ruler class="h-5 w-5" />
        </button>

        <div v-if="leftToolbarOpenMeasureMenu"
          class="absolute left-full top-0 ml-2 flex w-40 flex-col gap-1 rounded-xl border border-border bg-background/95 p-1 shadow-lg backdrop-blur"
          style="z-index: 941">
          <button type="button"
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            :class="store.toolMode.value === 'xeokit_measure_distance' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasureDistanceClick">
            <Ruler class="h-4 w-4" />
            <span>长度测量</span>
          </button>
          <button type="button"
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            :class="store.toolMode.value === 'xeokit_measure_angle' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasureAngleClick">
            <Ruler class="h-4 w-4" />
            <span>角度测量</span>
          </button>
          <button type="button"
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            :class="store.toolMode.value === 'measure_object_to_object' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasureObjectToObjectClick">
            <Ruler class="h-4 w-4" />
            <span>构件最近点</span>
          </button>
          <button type="button"
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            :class="store.toolMode.value === 'measure_pipe_to_structure' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasurePipeToStructureClick">
            <Ruler class="h-4 w-4" />
            <span>管-墙/柱</span>
          </button>
          <button type="button"
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            :class="store.toolMode.value === 'measure_pipe_to_pipe' ? 'bg-muted' : ''"
            @click.stop="onLeftMeasurePipeToPipeClick">
            <Ruler class="h-4 w-4" />
            <span>管-管</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧竖直工具栏（查看/快捷） -->
    <div class="pointer-events-auto absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-lg backdrop-blur"
      style="z-index: 940"
      @pointerdown.stop
      @wheel.stop>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        :class="focusTransparencyEnabled ? 'bg-muted' : ''"
        :title="focusTransparencyEnabled ? '关闭选中聚焦半透明' : '开启选中聚焦半透明'"
        @click.stop="onFocusTransparencyEnabledChange(!focusTransparencyEnabled)">
        <Aperture class="h-5 w-5" />
      </button>

      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        :class="spatialQueryOpen ? 'bg-muted' : ''"
        title="空间查询"
        @click.stop="onRightSpatialQueryClick">
        <Search class="h-5 w-5" />
      </button>

      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        title="显示所在房间全部模型（以房间树选中房间为准）"
        @click.stop="onRightRoomShowAllClick">
        <Focus class="h-5 w-5" />
      </button>

      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        title="管网（占位）"
        @click.stop="onRightPipeNetworkClick">
        <GitCompare class="h-5 w-5" />
      </button>

      <!-- 设置（弹出配置） -->
      <div class="relative">
        <button type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
          :class="rightToolbarOpenSettings ? 'bg-muted' : ''"
          title="查看工具设置"
          @click.stop="toggleRightSettings">
          <Settings class="h-5 w-5" />
        </button>

        <div v-if="rightToolbarOpenSettings"
          class="absolute right-full top-0 mr-2 w-72 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur"
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

    <!-- 标注右键菜单（SolveSpace 风格） -->
    <div v-if="dimContextMenu.visible"
      class="pointer-events-auto fixed z-[960] min-w-[180px] rounded-lg border border-border bg-background py-1 text-sm shadow-lg"
      :style="{ left: dimContextMenu.x + 'px', top: dimContextMenu.y + 'px' }"
      @pointerdown.stop
      @contextmenu.prevent.stop>
      <button class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="dimCtxToggleReference">
        {{ dimContextMenu.isReference ? '取消参考尺寸' : '设为参考尺寸' }}
      </button>
      <button v-if="dimContextMenu.kind === 'angle'"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="dimCtxToggleSupplementary">
        {{ dimContextMenu.supplementary ? '显示原始角度' : '显示补角' }}
      </button>
      <button class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="dimCtxSnapToGrid">
        Snap to Grid
      </button>
      <div class="my-1 border-t border-border" />
      <button class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="dimCtxResetLayout">
        重置文字位置
      </button>
      <button class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground hover:bg-muted"
        @click="closeDimContextMenu">
        取消
      </button>
    </div>
    <!-- 点击空白处关闭右键菜单 -->
    <div v-if="dimContextMenu.visible"
      class="pointer-events-auto fixed inset-0 z-[959]"
      @click="closeDimContextMenu"
      @contextmenu.prevent="closeDimContextMenu" />

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

    <MeasurementWizard v-else-if="
                         (store.toolMode.value === 'measure_point_to_object' ||
                           store.toolMode.value === 'measure_pipe_to_structure' ||
                           store.toolMode.value === 'measure_pipe_to_pipe') &&
                           toolsRef
                       "
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

    <AnnotationOverlayBar v-if="toolsRef" :tools="toolsRef" />

    <MeasurementOverlayBar v-if="isXeokitMeasureMode && xeokitMeasurementToolsRef" :tools="xeokitMeasurementToolsRef" />

    <ReviewConfirmation />
  </div>
</template>
