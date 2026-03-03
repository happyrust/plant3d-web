<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { Matrix4, Plane, Vector2, Vector3 } from "three";
import {
    ArrowUpRight,
    Cloud,
    Crosshair,
    Eye,
    EyeOff,
    Focus,
    GitCompare,
    Layers,
    LocateFixed,
    RectangleHorizontal,
    Ruler,
    Settings,
    Trash2,
    X,
} from "lucide-vue-next";

import RangeQueryDrawer from "@/components/range-query/RangeQueryDrawer.vue";
import ReviewConfirmation from "@/components/review/ReviewConfirmation.vue";
import MeasurementWizard from "@/components/tools/MeasurementWizard.vue";
import { pdmsGetPtsetWithContext } from "@/api/genModelPdmsAttrApi";
import { getMbdPipeAnnotations } from "@/api/mbdPipeApi";
import { demoMbdPipeData, injectMbdPipeDemoGeometry, flyToPipeDemo } from "@/debug/injectMbdPipeDemo";
import { useModelGeneration } from "@/composables/useModelGeneration";
import { useSelectionStore } from "@/composables/useSelectionStore";
import {
    getDbnoInstancesManifest,
    getDbnoInstancesMeta,
    preloadInstancesSharedTables,
} from "@/composables/useDbnoInstancesJsonLoader";
import { loadDbnoInstancesForVisibleRefnosDtx } from "@/composables/useDbnoInstancesDtxLoader";
import { useDbnoInstancesParquetLoader } from "@/composables/useDbnoInstancesParquetLoader";
import { buildInstanceIndexByRefno } from "@/utils/instances/instanceManifest";
import { useDtxTools } from "@/composables/useDtxTools";
import { usePtsetVisualizationThree } from "@/composables/usePtsetVisualizationThree";
import { useMbdPipeAnnotationThree } from "@/composables/useMbdPipeAnnotationThree";
import { useAnnotationThree } from "@/composables/useAnnotationThree";
import {
    createLatestOnlyGate,
    ExternalAnnotationRegistry,
    shouldClearMbdRequest,
    type MbdPipeAnnotationRequestLike,
} from "@/composables/mbd/mbdRequestSync";
import { DimensionAnnotationManager } from "@/composables/useDimensionAnnotation";
import { useToolStore, type DimensionKind } from "@/composables/useToolStore";
import { useUnitSettingsStore } from "@/composables/useUnitSettingsStore";
import { useViewerContext } from "@/composables/useViewerContext";
import { e3dGetVisibleInsts } from "@/api/genModelE3dApi";
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from "@/composables/useDbMetaInfo";
import { useConsoleStore } from "@/composables/useConsoleStore";
import { ensurePanelAndActivate } from "@/composables/useDockApi";
import { useQuickViewRequestStore } from "@/composables/useQuickViewRequestStore";
import { useRangeQuerySettingsStore } from "@/composables/useRangeQuerySettingsStore";
import { SiteSpecValue, getSpecValueName } from "@/types/spec";
import { onCommand } from "@/ribbon/commandBus";
import { emitToast } from "@/ribbon/toastBus";

import { useBackgroundStore } from "@/composables/useBackgroundStore";
import { DTXLayer, DTXSelectionController, DTXViewCullController } from "@/utils/three/dtx";
import { AngleDimension3D, LinearDimension3D, SlopeAnnotation3D, WeldAnnotation3D } from "@/utils/three/annotation";
import { computeDimensionOffsetDir } from "@/utils/three/annotation/utils/computeDimensionOffsetDir";
import { DTXOverlayHighlighter } from "@/utils/three/dtx/selection/DTXOverlayHighlighter";
import { DtxViewer, type BackgroundMode } from "@/viewer/dtx/DtxViewer";
import { DtxCompatViewer } from "@/viewer/dtx/DtxCompatViewer";
import { CadGrid } from "@/viewer/dtx/dtxCadGrid";
import { loadDtxPrimitiveDemo } from "@/viewer/dtx/dtxPrimitiveDemo";
import { DynamicPivotController } from "@/utils/three/dtx/DynamicPivotController";
import { DTXTileLodController } from "@/viewer/dtx/DTXTileLodController";

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
const unitSettings = useUnitSettingsStore();
const selectionStore = useSelectionStore();
const viewerContext = useViewerContext();
const backgroundStore = useBackgroundStore();

const initError = ref<string | null>(null);

const isDev = import.meta.env.DEV;

const dimensionAnnoMgrRef = shallowRef<DimensionAnnotationManager | null>(null);

function normalizeRefnoKeyLike(raw: string): string | null {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const m = s.match(/^(\d+)\s*[\\/_-]\s*(\d+)$/);
    if (!m) return s;
    return `${m[1]}_${m[2]}`;
}

type CameraViewMode = "cad_weak" | "cad_flat" | "normal";

function getCameraFovByMode(mode: CameraViewMode): number {
    switch (mode) {
        case "cad_flat":
            return 18;
        case "normal":
            return 45;
        case "cad_weak":
        default:
            return 30;
    }
}

function clampGlobalEdgeThresholdAngle(value: number): number {
    if (!Number.isFinite(value)) return 20;
    return Math.max(1, Math.min(60, Math.round(value)));
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
        localStorage.setItem("dtx_camera_mode", mode);
    } catch {
        // ignore
    }
}

function onGlobalEdgeEnabledChange(enabled: boolean): void {
    globalEdgeEnabled.value = enabled;
    applyGlobalEdgeStyle();
    try {
        localStorage.setItem("dtx_global_edges", enabled ? "1" : "0");
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
        localStorage.setItem("dtx_edge_angle", String(next));
    } catch {
        // ignore
    }
}

// URL 预加载：在现有 Viewer 页面中通过 ?mbd_pipe=... 自动触发 MBD 管道标注。
// 示例：/?output_project=AvevaMarineSample&mbd_pipe=24381/145018
(() => {
    try {
        const q = new URLSearchParams(window.location.search);
        const demo = String(q.get("dtx_demo") || "").toLowerCase();
        if (demo === "primitives") return;

        const raw = q.get("mbd_pipe");
        const refno = raw ? String(raw).trim() : "";
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
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search);
    const raw = q.get("dtx_lod_debug") ?? safeLsGet("dtx_lod_debug") ?? "0";
    return String(raw).trim() === "1";
}

function setDtxLodDebugEnabled(enabled: boolean): void {
    safeLsSet("dtx_lod_debug", enabled ? "1" : "0");
}

const lodDebugVisible = ref(isDev && isDtxLodDebugEnabled());
function closeLodDebugPanel(): void {
    lodDebugVisible.value = false;
    setDtxLodDebugEnabled(false);
}

function readDtxLodPrewarmConfigFromUrl(): DtxLodPrewarmUiConfig {
    if (typeof window === "undefined") {
        return { enabled: false, topK: 80, minCount: 5, concurrency: 8 };
    }
    const q = new URLSearchParams(window.location.search);
    const enabledRaw =
        q.get("dtx_lod_prewarm") ?? safeLsGet("dtx_lod_prewarm") ?? "0";
    const topRaw =
        q.get("dtx_lod_prewarm_top") ??
        safeLsGet("dtx_lod_prewarm_top") ??
        "80";
    const minRaw =
        q.get("dtx_lod_prewarm_min") ??
        safeLsGet("dtx_lod_prewarm_min") ??
        "5";
    const concRaw =
        q.get("dtx_lod_prewarm_conc") ??
        safeLsGet("dtx_lod_prewarm_conc") ??
        "8";

    const topK0 = Number(topRaw);
    const minCount0 = Number(minRaw);
    const conc0 = Number(concRaw);

    return {
        enabled: String(enabledRaw).trim() !== "0",
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
            safeLsSet("dtx_lod_l1px", String(cfg.l1Px));
            safeLsSet("dtx_lod_l2px", String(cfg.l2Px));
            safeLsSet("dtx_lod_hys", String(cfg.hysteresis));
            safeLsSet("dtx_lod_settle", String(cfg.settleMs));
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
            safeLsSet("dtx_lod_prewarm", cfg.enabled ? "1" : "0");
            safeLsSet("dtx_lod_prewarm_top", String(cfg.topK));
            safeLsSet("dtx_lod_prewarm_min", String(cfg.minCount));
            safeLsSet("dtx_lod_prewarm_conc", String(cfg.concurrency));
            // 约定：本项目当前策略为只预热 L2
            safeLsSet("dtx_lod_prewarm_lods", "L2");
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
    return mode === "measure_distance" || mode === "measure_angle";
});

// 右侧竖直工具栏（查看/快捷）
const rightToolbarOpenSettings = ref(false);
const rangeDrawerOpen = ref(false);
const rangeSettings = useRangeQuerySettingsStore();
const quickViewReq = useQuickViewRequestStore();
// 避免模板对“对象属性 ref”做 v-model 赋值时覆盖 ref 本身：解构为顶层绑定
const rangeRadiusM = rangeSettings.radiusM;
const rangeSpecValues = rangeSettings.specValues;
const rangeNounsText = rangeSettings.nounsText;
const rangeNameQuery = rangeSettings.nameQuery;

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

const cameraViewMode = ref<CameraViewMode>("cad_weak");
const globalEdgeEnabled = ref(true);
const globalEdgeThresholdAngle = ref(20);

let attachedToScene = false;
let shaderPrecompiled = false;
let lastGlobalEdgeRevision = -1;
let continuousRender = false;
let demoMode: "none" | "primitives" | "mbd_pipe" = "none";
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
    dimId: "",
    kind: null,
    isReference: false,
    supplementary: false,
});
let rafId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let offRibbonCommand: (() => void) | null = null;
let offToolsInput: (() => void) | null = null;
let offPtsetWatch: (() => void) | null = null;
let offMbdPipeWatch: (() => void) | null = null;
let offMbdPipeDataWatch: (() => void) | null = null;
let offShowModelByRefnos: (() => void) | null = null;
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
const mbdRequestGate = createLatestOnlyGate();
const mbdInteractionRegistry = new ExternalAnnotationRegistry();

function readDtxScaleConfigFromUrl(): {
    scale: number;
    recenter: boolean;
    clip: boolean;
    autoFitOnLoad: boolean;
} {
    const urlParams = new URLSearchParams(window.location.search);
    const units = String(urlParams.get("dtx_units") || "").trim().toLowerCase();
    const scaleStr = String(urlParams.get("dtx_scale") || "").trim();

    // 约定：
    // - dtx_scale=0.001 明确指定缩放
    // - dtx_units=mm => scale=0.001
    // - dtx_units=m/raw => scale=1
    // - 默认：按 mm 处理（scale=0.001），以缓解 z-fighting/大坐标精度问题
    // 一期新增：若 URL 未显式指定，则从设置读取 modelUnit 作为默认来源。
    let scale = unitSettings.modelUnit.value === "mm" ? 0.001 : 1;
    if (units === "m" || units === "raw") scale = 1;
    if (units === "mm") scale = 0.001;
    if (scaleStr) {
        const v = Number(scaleStr);
        if (Number.isFinite(v) && v > 0) scale = v;
    }

    const recenterParam = urlParams.get("dtx_recenter");
    const recenter =
        recenterParam === null ? unitSettings.recenter.value : recenterParam !== "0";
    const clipParam = urlParams.get("dtx_clip");
    const clip = clipParam === null ? unitSettings.clip.value : clipParam !== "0";

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

    const l1Raw = urlParams.get("dtx_lod_l1px") ?? ls("dtx_lod_l1px") ?? "200";
    const l2Raw = urlParams.get("dtx_lod_l2px") ?? ls("dtx_lod_l2px") ?? "80";
    const hRaw = urlParams.get("dtx_lod_hys") ?? ls("dtx_lod_hys") ?? "0.15";
    const sRaw = urlParams.get("dtx_lod_settle") ?? ls("dtx_lod_settle") ?? "250";

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
        case "mm":
            return 100;
        case "m":
            return 100;
        case "raw":
            return 100000;
        default:
            return 100;
    }
}

function computeClipPlanesByDiag(diag: number): { near: number; far: number } {
    const d = Math.max(0, Number(diag) || 0);

    // 以 bbox 对角线长度为“分档”依据（单位：米）。
    // 目标：压缩 far/near 比值，提升深度精度，降低 z-fighting。
    if (d <= 1) return { near: 0.01, far: 50 };
    if (d <= 10) return { near: 0.05, far: 200 };
    if (d <= 100) return { near: 0.2, far: 2000 };
    if (d <= 1000) return { near: 2, far: 20000 };
    return { near: 10, far: Math.min(200000, Math.max(50000, d * 50)) };
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
            console.warn("[ViewerPanel] DTX 全局变换应用失败", e);
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
            console.warn("[ViewerPanel] 相机裁剪面自适应失败", e);
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
                    "模型单位/重心设置已变更：为避免错位，已清空测量/批注/点集/MBD管道标注（可重新创建）",
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
    if (mode === "skybox") {
        viewer.loadCrossSkybox("/texture/skybox.png");
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

function toastNeedSelection(): void {
    emitToast({ message: "请先选择对象" });
}

function getSelectedRefno(): string | null {
    const raw = selectionStore.selectedRefno.value;
    const s = typeof raw === "string" ? raw.trim() : "";
    return s ? s : null;
}

function hideSelected(): void {
    const refno = getSelectedRefno();
    if (!refno) {
        toastNeedSelection();
        return;
    }
    const compat = compatViewerRef.value;
    if (!compat) return;
    compat.scene.setObjectsVisible([refno], false);
    requestRender();
}

function showSelected(): void {
    const refno = getSelectedRefno();
    if (!refno) {
        toastNeedSelection();
        return;
    }
    const compat = compatViewerRef.value;
    if (!compat) return;
    compat.scene.setObjectsVisible([refno], true);
    requestRender();
}

function hideAll(): void {
    const dtxLayer = dtxLayerRef.value;
    if (!dtxLayer) return;
    dtxLayer.setAllVisible(false);
    requestRender();
}

function locateShowSelected(): void {
    const refno = getSelectedRefno();
    if (!refno) {
        toastNeedSelection();
        return;
    }
    const compat = compatViewerRef.value;
    if (!compat) return;

    // 先确保可见，再定位
    compat.scene.setObjectsVisible([refno], true);
    const aabb = compat.scene.getAABB([refno]);
    if (!aabb) {
        emitToast({ message: "定位失败：未获取到对象包围盒" });
        requestRender();
        return;
    }
    compat.cameraFlight.flyTo({ aabb, duration: 0.8, fit: true });
    requestRender();
}

function setMeasureMode(next: "measure_distance" | "measure_angle"): void {
    if (store.toolMode.value === next) {
        store.setToolMode("none");
    } else {
        store.setToolMode(next);
    }
    requestRender();
}

function setDimensionMode(next: "dimension_linear" | "dimension_angle"): void {
    if (store.toolMode.value === next) {
        store.setToolMode("none");
    } else {
        store.setToolMode(next);
        try {
            ensurePanelAndActivate("dimension");
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
    setMeasureMode("measure_distance");
    leftToolbarOpenMeasureMenu.value = false;
}

function onLeftMeasureAngleClick(): void {
    setMeasureMode("measure_angle");
    leftToolbarOpenMeasureMenu.value = false;
}

function setAutoNearestMode(
    next: "measure_pipe_to_structure" | "measure_pipe_to_pipe",
): void {
    if (store.toolMode.value === next) {
        store.setToolMode("none");
    } else {
        store.setToolMode(next);
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
        case "viewer.hide_selected":
            hideSelected();
            return;
        case "viewer.show_selected":
            showSelected();
            return;
        case "viewer.hide_all":
            hideAll();
            return;
        case "viewer.locate_show_selected":
            locateShowSelected();
            return;
        case "measurement.distance":
            setMeasureMode("measure_distance");
            return;
        case "measurement.angle":
            setMeasureMode("measure_angle");
            return;
        case "measurement.point_to_mesh":
            store.setToolMode("measure_point_to_object");
            requestRender();
            return;
        case "measurement.pipe_to_structure":
            setAutoNearestMode("measure_pipe_to_structure");
            return;
        case "measurement.pipe_to_pipe":
            setAutoNearestMode("measure_pipe_to_pipe");
            return;
        case "measurement.clear":
            store.clearMeasurements();
            requestRender();
            return;
        case "dimension.linear":
            setDimensionMode("dimension_linear");
            return;
        case "dimension.angle":
            setDimensionMode("dimension_angle");
            return;
        case "dimension.clear":
            store.clearDimensions();
            requestRender();
            return;
        case "annotation.create":
            store.setToolMode("annotation");
            requestRender();
            return;
        case "panel.dimension":
            try {
                ensurePanelAndActivate("dimension");
            } catch {
                // ignore
            }
            return;
        case "panel.mbdPipe":
            try {
                ensurePanelAndActivate("mbdPipe");
            } catch {
                // ignore
            }
            return;
        case "mbd.generate": {
            // 一条龙：用当前选中 refno 触发 MBD 管道标注生成（复用 store watcher 链路）。
            try {
                ensurePanelAndActivate("mbdPipe");
            } catch {
                // ignore
            }
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.uiTab.value = "dims";
            }

            const refno = selectionStore.selectedRefno.value;
            if (!refno) {
                emitToast({
                    message:
                        "请先选中一个构件（模型树/场景），再生成 MBD 管道标注",
                });
                return;
            }

            store.requestMbdPipeAnnotation(refno);
            return;
        }
        case "mbd.dim.segment":
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.showDimSegment.value =
                    !mbdPipeVisRef.value.showDimSegment.value;
            }
            requestRender();
            return;
        case "mbd.dim.chain":
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.showDimChain.value =
                    !mbdPipeVisRef.value.showDimChain.value;
            }
            requestRender();
            return;
        case "mbd.dim.overall":
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.showDimOverall.value =
                    !mbdPipeVisRef.value.showDimOverall.value;
            }
            requestRender();
            return;
        case "mbd.dim.port":
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.showDimPort.value =
                    !mbdPipeVisRef.value.showDimPort.value;
            }
            requestRender();
            return;
        case "mbd.weld":
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.showWelds.value =
                    !mbdPipeVisRef.value.showWelds.value;
            }
            requestRender();
            return;
        case "mbd.slope":
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.showSlopes.value =
                    !mbdPipeVisRef.value.showSlopes.value;
            }
            requestRender();
            return;
        case "mbd.segments":
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.showSegments.value =
                    !mbdPipeVisRef.value.showSegments.value;
            }
            requestRender();
            return;
        case "mbd.labels":
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.showLabels.value =
                    !mbdPipeVisRef.value.showLabels.value;
            }
            requestRender();
            return;
        case "mbd.toggle_all":
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.isVisible.value =
                    !mbdPipeVisRef.value.isVisible.value;
            }
            requestRender();
            return;
        case "mbd.flyTo":
            mbdPipeVisRef.value?.flyTo();
            requestRender();
            return;
        case "mbd.clear":
            mbdPipeVisRef.value?.clearAll();
            clearMbdAnnotationsFromInteraction();
            requestRender();
            return;
        case "mbd.settings":
            try {
                ensurePanelAndActivate("mbdPipe");
            } catch {
                // ignore
            }
            if (mbdPipeVisRef.value) {
                mbdPipeVisRef.value.uiTab.value = "settings";
            }
            requestRender();
            return;
        case "tools.clear_all":
            store.clearAll();
            ptsetVisRef.value?.clearAll();
            mbdPipeVisRef.value?.clearAll();
            clearMbdAnnotationsFromInteraction();
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
                "[ViewerPanel] shader 预编译失败，将在首帧渲染时自动编译",
                e,
            );
        }
    }

    requestRender();
}

function parseRefnoFromObjectId(objectId: string): string | null {
    if (!objectId) return null;
    if (!objectId.startsWith("o:")) return null;
    const parts = objectId.split(":");
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
        if (store.toolMode.value && store.toolMode.value !== "none") return;
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
        if (store.toolMode.value && store.toolMode.value !== "none") return;

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
        if (demoMode === "primitives") {
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

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    (attachPicking as any)._cleanup = () => {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onCancel);
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

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);

    offToolsInput = () => {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onCancel);
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

const showAnnotationToolbar = computed(() => {
    const mode = store.toolMode.value;
    return (
        mode === "annotation" ||
        mode === "annotation_cloud" ||
        mode === "annotation_rect" ||
        mode === "annotation_obb"
    );
});

const canDeleteActiveAnnotation = computed(() => {
    return (
        !!store.activeAnnotationId.value ||
        !!store.activeCloudAnnotationId.value ||
        !!store.activeRectAnnotationId.value ||
        !!store.activeObbAnnotationId.value
    );
});

function deleteActiveAnnotation() {
    const textId = store.activeAnnotationId.value;
    if (textId) {
        store.removeAnnotation(textId);
        store.activeAnnotationId.value = null;
        return;
    }
    const cloudId = store.activeCloudAnnotationId.value;
    if (cloudId) {
        store.removeCloudAnnotation(cloudId);
        store.activeCloudAnnotationId.value = null;
        return;
    }
    const rectId = store.activeRectAnnotationId.value;
    if (rectId) {
        store.removeRectAnnotation(rectId);
        store.activeRectAnnotationId.value = null;
        return;
    }
    const obbId = store.activeObbAnnotationId.value;
    if (obbId) {
        store.removeObbAnnotation(obbId);
        store.activeObbAnnotationId.value = null;
    }
}

function onRightRangeQuickViewClick(): void {
    const refno = getSelectedRefno();
    if (!refno) {
        toastNeedSelection();
        return;
    }

    // 打开右侧抽屉面板，并通过请求触发自动查询
    rangeDrawerOpen.value = true;
    quickViewReq.requestRangeQueryFromSelection();
}

function onRightRoomShowAllClick(): void {
    // 以“房间树当前选中房间”为准：由 ModelTreePanel 消费请求并执行 isolate/flyTo。
    quickViewReq.requestShowSelectedRoomModels();
    ensurePanelAndActivate("modelTree");
}

function onRightPipeNetworkClick(): void {
    emitToast({ message: "管网（BRAN）功能建设中（占位）" });
}

function toggleRightSettings(): void {
    rightToolbarOpenSettings.value = !rightToolbarOpenSettings.value;
    if (rightToolbarOpenSettings.value) rangeDrawerOpen.value = false;
}

function toggleRangeDrawer(): void {
    rangeDrawerOpen.value = !rangeDrawerOpen.value;
    if (rangeDrawerOpen.value) rightToolbarOpenSettings.value = false;
}

// ── 标注右键菜单动作 ──
function closeDimContextMenu(): void {
    dimContextMenu.value.visible = false;
}

function dimCtxToggleReference(): void {
    const { dimId, isReference } = dimContextMenu.value;
    if (!dimId) return;
    if (dimId.startsWith("mbd:")) {
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
    if (dimId.startsWith("mbd:")) {
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
    if (dimId.startsWith("mbd:")) {
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
    demoMode = "none";
    demoPrimitiveCount = 1000;
    cadGridEnabled = true;
    cameraViewMode.value = "cad_weak";
    globalEdgeEnabled.value = true;
    globalEdgeThresholdAngle.value = 20;
    try {
        // DEV: localStorage.setItem('dtx_continuous_render','1') 可打开持续渲染（用于 profile）
        continuousRender =
            isDev && localStorage.getItem("dtx_continuous_render") === "1";

        const q = new URLSearchParams(window.location.search);
        const demo = String(
            q.get("dtx_demo") || localStorage.getItem("dtx_demo") || "",
        ).toLowerCase();
        if (demo === "primitives") {
            demoMode = "primitives";
            const cntRaw =
                q.get("dtx_demo_count") ||
                localStorage.getItem("dtx_demo_count") ||
                "1000";
            const cnt = Number(cntRaw);
            if (Number.isFinite(cnt) && cnt > 0) {
                demoPrimitiveCount = Math.floor(cnt);
            }
        } else if (demo === "mbd_pipe") {
            demoMode = "mbd_pipe";
        }

        const gridRaw = q.get("dtx_grid") || localStorage.getItem("dtx_grid");
        if (gridRaw !== null && gridRaw !== undefined) {
            cadGridEnabled = String(gridRaw).trim() !== "0";
        }

        const cameraModeRaw =
            q.get("dtx_camera_mode") || localStorage.getItem("dtx_camera_mode");
        if (
            cameraModeRaw === "cad_weak" ||
            cameraModeRaw === "cad_flat" ||
            cameraModeRaw === "normal"
        ) {
            cameraViewMode.value = cameraModeRaw;
        }

        const globalEdgesRaw =
            q.get("dtx_global_edges") || localStorage.getItem("dtx_global_edges");
        if (globalEdgesRaw !== null && globalEdgesRaw !== undefined) {
            globalEdgeEnabled.value = String(globalEdgesRaw).trim() !== "0";
        }

        const edgeAngleRaw =
            q.get("dtx_edge_angle") || localStorage.getItem("dtx_edge_angle");
        if (edgeAngleRaw !== null && edgeAngleRaw !== undefined) {
            globalEdgeThresholdAngle.value = clampGlobalEdgeThresholdAngle(
                Number(edgeAngleRaw),
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
            gizmo: { enabled: true, placement: "top-right", size: 100 },
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        initError.value = msg;
        emitToast({ message: msg });
        return;
    }
    dtxViewerRef.value = dtxViewer;
    applyCameraViewMode(cameraViewMode.value);

    // 应用持久化的背景设置（默认 SolidWorks 渐变）
    applyBackground(backgroundStore.mode.value);

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
        console.warn("[ViewerPanel] CAD grid 初始化失败", e);
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
        // 工程风格：低透明覆层 + 深灰细边
        enableOutline: false,
        highlightMode: "overlay",
        overlayStyle: {
            fillColor: 0x94a3b8,
            fillOpacity: 0.22,
            edgeColor: 0x4b5563,
            edgeThresholdAngle: 20,
            edgeAlwaysOnTop: false,
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

    if (demoMode === "primitives") {
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
            console.warn("[ViewerPanel] primitives demo 初始化失败", e);
        }
    }

    const compat = new DtxCompatViewer({
        dtxViewer,
        dtxLayer,
        selection: selectionController,
        requestRender,
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
            console.warn("[ViewerPanel] DTX 全局变换应用失败", e);
        }

        // 相机裁剪面按 bbox 尺寸分档收紧，提升深度精度
        try {
            applyDtxCameraClipByLayerBBox(dtxViewer, dtxLayer);
        } catch (e) {
            console.warn("[ViewerPanel] 相机裁剪面自适应失败", e);
        }

        // 按需在首次加载后 auto-fit（需在单位归一化后执行）
        try {
            fitToDtxLayerBBoxOnce(_dbno, dtxViewer, dtxLayer);
        } catch (e) {
            console.warn("[ViewerPanel] auto-fit 失败", e);
        }

        try {
            cadGridRef.value?.fitToBoundingBox(dtxLayer.getBoundingBox());
        } catch {
            // ignore
        }
        ensureLayerAttached();
        selectionController.refreshSpatialIndex();
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

        // Tile LOD：仅在首次切换到该 dbno 时初始化（避免重复拉 manifest）
        if (tileLodInitializedDbno !== _dbno) {
            tileLodInitializedDbno = _dbno;
            (async () => {
                try {
                    const manifest = await getDbnoInstancesManifest(_dbno);
                    tileLodControllerRef.value?.setManifest(_dbno, manifest);
                    tileLodControllerRef.value?.requestUpdate(dtxViewer.camera);
                    requestRender();
                } catch {
                    // ignore
                }
            })();
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
    mbdPipeVisRef.value = mbdPipeVis;
    offMbdPipeDataWatch?.();
    offMbdPipeDataWatch = watch(
        () => mbdPipeVis.currentData.value,
        (data) => {
            if (data) return;
            clearMbdAnnotationsFromInteraction();
        },
        { immediate: true },
    );

    // mbd_pipe demo：不依赖后端，直接注入模拟管道几何体 + 标注
    if (demoMode === "mbd_pipe") {
        try {
            injectMbdPipeDemoGeometry(dtxViewer);
            mbdPipeVis.renderBranch(demoMbdPipeData);
            flyToPipeDemo(dtxViewer);
            emitToast({
                message: `[mbd_pipe demo] 已加载：段${demoMbdPipeData.stats.segments_count} 尺寸${demoMbdPipeData.stats.dims_count} 焊缝${demoMbdPipeData.stats.welds_count} 坡度${demoMbdPipeData.stats.slopes_count} 弯头${demoMbdPipeData.stats.bends_count}`,
            });
            requestRender();
        } catch (e) {
            console.warn("[ViewerPanel] mbd_pipe demo 初始化失败", e);
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
            const id = typeof ev?.id === "string" ? ev.id : null;
            if (!id) return;
            if (id === "dim_preview") return;

            // MBD dims 处理（session-only 交互）
            if (id.startsWith("mbd_dim_")) {
                const mbdDimId = id.slice("mbd_dim_".length);
                const dtxViewer2 = dtxViewerRef.value;
                if (!dtxViewer2) return;

                if (ev.type === "drag-start") {
                    dtxViewer2.controls.enabled = false;
                    return;
                }
                if (ev.type === "drag-end") {
                    dtxViewer2.controls.enabled = true;
                    requestRender();
                    return;
                }
                if (ev.type === "drag" && ev.annotation instanceof LinearDimension3D) {
                    const me = ev.originalEvent;
                    if (!me) return;
                    const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
                    const p = ev.annotation.getParams();
                    const start = p.start.clone();
                    const end = p.end.clone();

                    if (role === "label") {
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

                    if (role === "offset") {
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
                if (ev.type === "contextmenu") {
                    const sp = (ev as any).screenPos as { x: number; y: number } | undefined;
                    dimContextMenu.value = {
                        visible: true,
                        x: sp?.x ?? 0,
                        y: sp?.y ?? 0,
                        dimId: `mbd:${mbdDimId}`,
                        kind: 'linear_distance',
                        isReference: false,
                        supplementary: false,
                    };
                }
                return;
            }

            // MBD weld 处理（session-only 交互：label 拖拽）
            if (id.startsWith("mbd_weld_")) {
                const dtxViewer2 = dtxViewerRef.value;
                if (!dtxViewer2) return;

                if (ev.type === "drag-start") {
                    dtxViewer2.controls.enabled = false;
                    return;
                }
                if (ev.type === "drag-end") {
                    dtxViewer2.controls.enabled = true;
                    requestRender();
                    return;
                }
                if (ev.type === "drag" && ev.annotation instanceof WeldAnnotation3D) {
                    const me = ev.originalEvent;
                    if (!me) return;
                    const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
                    if (role === "label") {
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
            if (id.startsWith("mbd_slope_")) {
                const dtxViewer2 = dtxViewerRef.value;
                if (!dtxViewer2) return;

                if (ev.type === "drag-start") {
                    dtxViewer2.controls.enabled = false;
                    return;
                }
                if (ev.type === "drag-end") {
                    dtxViewer2.controls.enabled = true;
                    requestRender();
                    return;
                }
                if (ev.type === "drag" && ev.annotation instanceof SlopeAnnotation3D) {
                    const me = ev.originalEvent;
                    if (!me) return;
                    const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
                    if (role === "label") {
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
            if (id.startsWith("mbd_bend_")) {
                const dtxViewer2 = dtxViewerRef.value;
                if (!dtxViewer2) return;

                if (ev.type === "drag-start") {
                    dtxViewer2.controls.enabled = false;
                    return;
                }
                if (ev.type === "drag-end") {
                    dtxViewer2.controls.enabled = true;
                    requestRender();
                    return;
                }
                if (ev.type === "drag" && ev.annotation instanceof AngleDimension3D) {
                    const me = ev.originalEvent;
                    if (!me) return;
                    const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
                    if (role === "label") {
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

            if (!id.startsWith("dim_")) return;

            const dtxViewer2 = dtxViewerRef.value;
            if (!dtxViewer2) return;

            const dimId = id.slice("dim_".length);
            const rec = (store.dimensions.value || []).find((d: any) => d?.id === dimId) as any;
            if (!rec) return;

            // 同步选中状态 -> store.activeDimensionId（便于 Delete 快捷键等）
            if (ev.type === "select") {
                store.activeDimensionId.value = dimId;
            } else if (ev.type === "deselect") {
                if (store.activeDimensionId.value === dimId) {
                    store.activeDimensionId.value = null;
                }
            }

            // 右键菜单：显示尺寸标注的操作菜单
            if (ev.type === "contextmenu") {
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
            if (ev.type === "click") {
                const role = (ev.hitObject as any)?.userData?.dragRole as string | undefined;
                if (role === "label") {
                    const now = Date.now();
                    const isDouble =
                        lastDimLabelClickId === dimId && now - lastDimLabelClickTime < 350;
                    lastDimLabelClickId = dimId;
                    lastDimLabelClickTime = now;
                    if (isDouble) {
                        try {
                            store.pendingDimensionEditId.value = dimId;
                            store.activeDimensionId.value = dimId;
                            ensurePanelAndActivate("dimension");
                        } catch {
                            // ignore
                        }
                    }
                }
            }

            if (ev.type === "drag-start") {
                prevControlsEnabled = dtxViewer2.controls.enabled;
                dtxViewer2.controls.enabled = false;

                // Alt：按一次切换“翻面锁定”（不会因松开 Alt 自动复原）
                try {
                    const role = (ev.hitObject as any)?.userData?.dragRole as
                        | string
                        | undefined;
                    if (role === "offset" && rec.kind === "linear_distance") {
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

            if (ev.type === "drag-end") {
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

            if (ev.type !== "drag") return;
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
            if (rec.kind === "linear_distance" && ev.annotation instanceof LinearDimension3D) {
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
                    me.shiftKey && !lockDir && role !== "label"
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

                if (role === "label") {
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
            if (rec.kind === "angle" && ev.annotation instanceof AngleDimension3D) {
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
                if (role === "label") {
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

    // 尺寸标注（与测量分离）：同步到三维标注系统（3D 文字 + 3D 线）
    try {
        const mgr = new DimensionAnnotationManager(annotationSystem);
        mgr.setUnit(unitSettings.displayUnit.value as any);
        mgr.setPrecision(unitSettings.precision.value);
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
        console.warn("[ViewerPanel] 尺寸标注管理器初始化失败", e);
    }

    // 对 mbd_pipe demo：此时标注已在 renderBranch 中创建，注册到交互系统
    if (demoMode === "mbd_pipe") {
        try {
            syncMbdAnnotationsToInteraction();
        } catch (e) {
            console.warn("[ViewerPanel] MBD 标注交互注册失败", e);
        }
    }

    // 启动预拉：db_meta_info + shared trans/aabb（失败直接报错）
    // 注意：onMounted(async () => ...) 中，任何依赖注入上下文的 hooks（如 vue-query）必须在首个 await 之前调用。
    // 因此这里先初始化 tools/ptsetVis（它们会调用 useSelectionStore/useQuery），再 await 预拉。
    // demo 模式（primitives / mbd_pipe）不依赖后端数据，跳过预拉避免无后端时初始化失败。
    if (demoMode !== "primitives" && demoMode !== "mbd_pipe") {
        try {
            await ensureDbMetaInfoLoaded();
            await preloadInstancesSharedTables();
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
    if (isDev && typeof window !== "undefined") {
        (window as any).loadMockMbdPipeData = () => {
            try {
                ensurePanelAndActivate("mbdPipe");
                if (mbdPipeVisRef.value) {
                    mbdPipeVisRef.value.renderBranch(demoMbdPipeData);
                    mbdPipeVisRef.value.flyTo();
                    emitToast({
                        message: `已加载模拟数据：段${demoMbdPipeData.stats.segments_count} 尺寸${demoMbdPipeData.stats.dims_count} 焊缝${demoMbdPipeData.stats.welds_count} 坡度${demoMbdPipeData.stats.slopes_count} 弯头${demoMbdPipeData.stats.bends_count}`,
                    });
                    requestRender();
                }
            } catch (e) {
                console.error("[mbd-pipe-mock] Failed to load:", e);
                emitToast({ message: "加载模拟数据失败" });
            }
        };
        console.log("[dev] 已暴露全局函数: window.loadMockMbdPipeData()");
    }
    viewerContext.annotationSystem.value = annotationSystem;
    viewerContext.viewerRef.value = compat as any;
    viewerContext.overlayContainerRef.value = overlayContainer.value;
    viewerContext.store.value = store;
    viewerContext.tools.value = tools as any;

    if (isDev) {
        (window as any).__xeokitViewer = compat;
        (window as any).__dtxViewer = dtxViewer;
    }

    // show_dbnum URL 参数：自动加载指定 dbnum 的所有 instances 数据
    const urlParams = new URLSearchParams(window.location.search);
    const showDbnum = urlParams.get("show_dbnum");
    if (showDbnum && demoMode !== "primitives") {
        const dbno = Number(showDbnum);
        if (Number.isFinite(dbno) && dbno > 0) {
            (async () => {
                try {
                    emitToast({ message: `正在加载 dbnum=${dbno} 的模型数据...` });
                    const autoFitKey = `dtx_autofit_dbno_${dbno}`;
                    let shouldAutoFit = true;
                    try {
                        shouldAutoFit = sessionStorage.getItem(autoFitKey) !== "1";
                    } catch {}
                    // 优先从 Parquet 获取 refno 列表（不依赖 JSON manifest）
                    const parquetLoader = useDbnoInstancesParquetLoader();
                    const allRefnos = await parquetLoader.queryAllRefnoKeys(dbno, { debug: isDev });
                    if (allRefnos.length === 0) {
                        emitToast({ message: `dbnum=${dbno} 没有可加载的 refno` });
                        return;
                    }
                    emitToast({ message: `发现 ${allRefnos.length} 个 refno，开始加载...` });
                    const result = await loadDbnoInstancesForVisibleRefnosDtx(
                        dtxLayer,
                        dbno,
                        allRefnos,
                        { lodAssetKey: "L1", debug: isDev, dataSource: "parquet" }
                    );
                    (compat as any).__dtxAfterInstancesLoaded?.(dbno, allRefnos);
                    // show_dbnum 路径下也需要初始化 Tile LOD（若 JSON manifest 可用）
                    try {
                        tileLodInitializedDbno = dbno;
                        const manifest = await getDbnoInstancesManifest(dbno);
                        tileLodControllerRef.value?.setManifest(dbno, manifest);
                        tileLodControllerRef.value?.requestUpdate(dtxViewer.camera);
                    } catch {
                        // JSON manifest 不存在时跳过 Tile LOD
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
                            sessionStorage.setItem(autoFitKey, "1");
                        } catch {}
                    }
                    emitToast({
                        message: `加载完成: ${result.loadedObjects} 个对象`,
                    });
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error("[ViewerPanel] show_dbnum 加载失败:", e);
                    emitToast({ message: `加载失败: ${msg}` });
                }
            })();
        }
    }

    // debug_refno URL 参数：加载指定 refno 下的可见实例（如 debug_refno=24381_145018）
    const debugRefno = urlParams.get("debug_refno");
    if (debugRefno && !showDbnum && demoMode !== "primitives") {
        // 支持 24381_145018 或 24381/145018 格式
        const refnoStr = debugRefno.replace("/", "_");
        (async () => {
            try {
                emitToast({ message: `[debug_refno] 正在查询 ${refnoStr} 的可见实例...` });
                console.log(`[debug_refno] refno=${refnoStr}`);

                // 1. 确保 db_meta_info 已加载，解析 refno → dbnum
                await ensureDbMetaInfoLoaded();
                let dbno: number;
                try {
                    dbno = getDbnumByRefno(refnoStr);
                } catch {
                    console.error(`[debug_refno] 无法解析 ${refnoStr} 的 dbnum`);
                    emitToast({ message: `[debug_refno] 无法解析 dbnum (refno=${refnoStr})` });
                    return;
                }
                console.log(`[debug_refno] refno=${refnoStr} → dbnum=${dbno}`);

                // 2. 查询该 refno 下的可见实例
                const visResp = await e3dGetVisibleInsts(refnoStr);
                const refnos = visResp?.refnos ?? [];
                console.log(`[debug_refno] visible-insts 返回 ${refnos.length} 个 refno`, refnos.slice(0, 10));
                if (refnos.length === 0) {
                    emitToast({ message: `[debug_refno] ${refnoStr} 下无可见实例` });
                    return;
                }
                emitToast({ message: `[debug_refno] 发现 ${refnos.length} 个实例，开始加载 (dbnum=${dbno})...` });

                // 3. 加载实例到 DTX（优先 parquet，失败回退 json）
                const urlDataSource = new URLSearchParams(window.location.search).get("data_source") as "json" | "parquet" | "auto" | null;
                const ds = urlDataSource || "auto";
                console.log(`[debug_refno] dataSource=${ds}`);
                const result = await loadDbnoInstancesForVisibleRefnosDtx(
                    dtxLayer,
                    dbno,
                    refnos,
                    { lodAssetKey: "L1", debug: true, dataSource: ds }
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

                emitToast({
                    message: `[debug_refno] 加载完成: ${result.loadedObjects} 个对象 (${refnos.length} refnos)`,
                });
                console.log(`[debug_refno] ✅ 加载完成`, result);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error("[debug_refno] 加载失败:", e);
                emitToast({ message: `[debug_refno] 加载失败: ${msg}` });
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
    dtxViewer.controls.addEventListener("change", onControlsChange);
    offControlsChange = () =>
        dtxViewer.controls.removeEventListener("change", onControlsChange);

    // gizmo 交互/动画期间需要持续触发渲染（否则按需渲染会"停帧"）
    if (dtxViewer.gizmo) {
        const onGizmoChange = () => requestRender();
        const onGizmoStart = () => requestRender();
        const onGizmoEnd = () => requestRender();
        dtxViewer.gizmo.addEventListener("change", onGizmoChange);
        dtxViewer.gizmo.addEventListener("start", onGizmoStart);
        dtxViewer.gizmo.addEventListener("end", onGizmoEnd);
        offGizmoEvents = () => {
            try {
                dtxViewer.gizmo?.removeEventListener("change", onGizmoChange);
                dtxViewer.gizmo?.removeEventListener("start", onGizmoStart);
                dtxViewer.gizmo?.removeEventListener("end", onGizmoEnd);
            } catch {
                // ignore
            }
        };
    }

    selectionController.on("selectionChanged", () => requestRender());
    selectionController.on("flyTo", (ev: any) => {
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

    canvas.addEventListener("pointerdown", onCanvasMouseDown);
    canvas.addEventListener("pointermove", onCanvasMouseMove);
    canvas.addEventListener("pointerup", onCanvasMouseUp);
    canvas.addEventListener("pointercancel", onCanvasMouseUp);

    offPivotEvents = () => {
        canvas.removeEventListener("pointerdown", onCanvasMouseDown);
        canvas.removeEventListener("pointermove", onCanvasMouseMove);
        canvas.removeEventListener("pointerup", onCanvasMouseUp);
        canvas.removeEventListener("pointercancel", onCanvasMouseUp);
    };

    // 兼容：批注/脚本会 dispatch showModelByRefnos，Viewer 侧统一接住并按需加载
    let showModelQueue: Promise<void> = Promise.resolve();
    const handleShowModelByRefnos = (ev: Event) => {
        if (demoMode === "primitives") {
            console.warn(
                "[ViewerPanel] dtx_demo=primitives 模式下忽略 showModelByRefnos",
            );
            return;
        }
        const detail = (
            ev as CustomEvent<{ refnos?: unknown; regenModel?: boolean }>
        ).detail;
        const raw = (detail as any)?.refnos;
        const refnos = Array.isArray(raw)
            ? raw
                  .map((r: unknown) => String(r || "").replace(/\//g, "_"))
                  .filter(Boolean)
            : [];
        if (refnos.length === 0) return;

        const unique = Array.from(new Set(refnos));
        const flyTo = !!(detail as any)?.flyTo;
        const requestIdRaw = (detail as any)?.requestId;
        const requestId =
            typeof requestIdRaw === "string"
                ? requestIdRaw.trim()
                : String(requestIdRaw || "").trim();
        const hasRequestId = requestId.length > 0;
        console.info("[vis][event] showModelByRefnos", {
            raw_refno_count: refnos.length,
            unique_refno_count: unique.length,
            regenModel: !!(detail as any)?.regenModel,
            flyTo,
            requestId: hasRequestId ? requestId : undefined,
        });
        consoleStore.addLog(
            "info",
            `[vis][event] showModelByRefnos raw_refno_count=${refnos.length} unique_refno_count=${unique.length} regenModel=${(detail as any)?.regenModel ? 1 : 0} flyTo=${flyTo ? 1 : 0}`,
        );
        const mg = modelGenerationRef.value;
        if (!mg) return;
        const dtxLayer = dtxLayerRef.value;

        const debugState: {
            runId: string;
            status: "running" | "done";
            requested: string[];
            ok: string[];
            fail: Array<{ refno: string; error: string | null; status: string }>;
            items: Array<{
                refno: string;
                ok: boolean;
                error: string | null;
                status: string;
                loadDebug: any | null;
                dtxStatsBefore: any | null;
                dtxStatsAfter: any | null;
            }>;
            startedAt: number;
            finishedAt: number | null;
            error: string | null;
        } = {
            runId: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            status: "running",
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
                            status: mg.statusMessage.value || "",
                        });
                    }
                    debugState.items.push({
                        refno: r,
                        ok,
                        error: mg.error.value || null,
                        status: mg.statusMessage.value || "",
                        loadDebug,
                        dtxStatsBefore,
                        dtxStatsAfter,
                    });
                }
            })
            .catch((e) => {
                console.warn("[ViewerPanel] showModelByRefnos failed", e);
                debugState.error = e instanceof Error ? e.message : String(e);
            })
            .finally(() => {
                debugState.status = "done";
                debugState.finishedAt = Date.now();
                // 供外部 await：只在明确传入 requestId 时派发，避免影响既有调用方（批注/脚本）。
                if (hasRequestId) {
                    window.dispatchEvent(
                        new CustomEvent("showModelByRefnosDone", {
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
    window.addEventListener("showModelByRefnos", handleShowModelByRefnos);
    offShowModelByRefnos = () =>
        window.removeEventListener(
            "showModelByRefnos",
            handleShowModelByRefnos,
        );

    offPtsetWatch = watch(
        () => store.ptsetVisualizationRequest.value,
        async (request) => {
            if (!request) return;

            try {
                emitToast({ message: `正在加载点集数据: ${request.refno}` });
                // ptset 按需获取：尽量带上 dbno + batch_id（来自 meta_{dbno}.json）以确保与当前模型快照一致。
                const normalized = String(request.refno ?? "").trim().replace("/", "_");
                let dbno: number | null = null;
                try {
                    dbno = getDbnumByRefno(normalized);
                } catch {
                    dbno = null;
                }
                let batchId: string | null = null;
                if (dbno) {
                    try {
                        const meta = await getDbnoInstancesMeta(dbno);
                        batchId = meta?.batch_id ?? null;
                    } catch {
                        batchId = null;
                    }
                }

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
                    const errorMsg = response.error_message || "未找到点集数据";
                    emitToast({ message: errorMsg });
                    console.warn("[ptset]", errorMsg);
                }
            } catch (error) {
                console.error("[ptset] Failed to load ptset:", error);
                emitToast({ message: "加载点集数据失败" });
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
            const handledRequest: MbdPipeAnnotationRequestLike = {
                refno: request.refno,
                timestamp: request.timestamp,
            };
            const requestSeq = mbdRequestGate.issue();
            try {
                try {
                    ensurePanelAndActivate("mbdPipe");
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
                    console.warn("[mbd-pipe] 预加载模型失败（将继续生成标注）", e);
                }
                if (!mbdRequestGate.isLatest(requestSeq)) return;

                // 标注按需获取：尽量带上 dbno + batch_id（来自 meta_{dbno}.json）以确保与当前模型快照一致。
                let dbno: number | null = null;
                try {
                    dbno = getDbnumByRefno(refnoKey);
                } catch {
                    dbno = null;
                }
                let batchId: string | null = null;
                if (dbno) {
                    try {
                        const meta = await getDbnoInstancesMeta(dbno);
                        batchId = meta?.batch_id ?? null;
                    } catch {
                        batchId = null;
                    }
                }

                const resp = await getMbdPipeAnnotations(refnoKey, {
                    // 显式指定走 SurrealDB，避免环境默认值差异影响测试结果
                    source: "db",
                    debug: isDev,
                    dbno: dbno ?? undefined,
                    batch_id: batchId,
                    // 首期默认值：对齐 MBD 默认
                    min_slope: 0.001,
                    max_slope: 0.1,
                    dim_min_length: 1.0,
                    weld_merge_threshold: 1.0,
                    include_dims: true,
                    // 额外尺寸类型（仍输出到同一个 dims 数组中，通过 d.kind 区分）
                    include_chain_dims: true,
                    include_overall_dim: true,
                    include_port_dims: true,
                    include_welds: true,
                    include_slopes: true,
                    include_bends: true,
                    bend_mode: "facecenter",
                });
                if (!mbdRequestGate.isLatest(requestSeq)) return;
                if (resp.success && resp.data) {
                    mbdPipeVis.renderBranch(resp.data);
                    mbdPipeVis.flyTo();
                    // 将 MBD 标注注册到交互系统
                    try { syncMbdAnnotationsToInteraction(); } catch { /* ignore */ }
                    emitToast({
                        message: `已生成标注：段${resp.data.stats.segments_count} 尺寸${resp.data.stats.dims_count} 焊缝${resp.data.stats.welds_count} 坡度${resp.data.stats.slopes_count} 弯头${resp.data.stats.bends_count}`,
                    });
                    requestRender();
                } else {
                    const msg = resp.error_message || "生成管道标注失败";
                    clearMbdAnnotationsFromInteraction();
                    emitToast({ message: msg });
                    console.warn("[mbd-pipe]", msg);
                }
            } catch (e) {
                console.error("[mbd-pipe] Failed to load:", e);
                clearMbdAnnotationsFromInteraction();
                emitToast({ message: "生成管道标注失败" });
            } finally {
                if (shouldClearMbdRequest(store.mbdPipeAnnotationRequest.value, handledRequest)) {
                    store.clearMbdPipeAnnotationRequest();
                }
            }
        },
        { immediate: true },
    );

    offRibbonCommand = onCommand(handleRibbonCommand);

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
    document.addEventListener("pointerdown", onDocPointerDown, true);
    offDocPointerDown = () => {
        document.removeEventListener("pointerdown", onDocPointerDown, true);
    };

        const onKeydown = (ev: KeyboardEvent) => {
        const target = ev.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase() ?? "";
        const isEditable =
            tag === "input" ||
            tag === "textarea" ||
            (target as any)?.isContentEditable === true;
        if (isEditable) return;

        // 开发模式：Ctrl+Shift+M 加载模拟 MBD 管道标注数据
        if (isDev && ev.ctrlKey && ev.shiftKey && ev.key === "M") {
            ev.preventDefault();
            try {
                ensurePanelAndActivate("mbdPipe");
                if (mbdPipeVisRef.value) {
                    mbdPipeVisRef.value.renderBranch(demoMbdPipeData);
                    mbdPipeVisRef.value.flyTo();
                    emitToast({
                        message: `已加载模拟数据：段${demoMbdPipeData.stats.segments_count} 尺寸${demoMbdPipeData.stats.dims_count} 焊缝${demoMbdPipeData.stats.welds_count} 坡度${demoMbdPipeData.stats.slopes_count} 弯头${demoMbdPipeData.stats.bends_count}`,
                    });
                    requestRender();
                }
            } catch (e) {
                console.error("[mbd-pipe-mock] Failed to load:", e);
                emitToast({ message: "加载模拟数据失败" });
            }
            return;
        }

        if (ev.key === "Escape") {
            try {
                toolsRef.value?.cancelMeasurementInteraction?.();
            } catch {
                // ignore
            }
            requestRender();
            return;
        }

            if (ev.key === "Delete" || ev.key === "Backspace") {
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
    window.addEventListener("keydown", onKeydown);
    offKeydown = () => window.removeEventListener("keydown", onKeydown);

    resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);
    handleResize();

    attachPicking();
    attachToolsInput();
    requestRender();
});

onUnmounted(() => {
    if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
    }
    detachPicking();
    detachToolsInput();

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

    offPtsetWatch?.();
    offPtsetWatch = null;

    offMbdPipeWatch?.();
    offMbdPipeWatch = null;

    offMbdPipeDataWatch?.();
    offMbdPipeDataWatch = null;

    clearMbdAnnotationsFromInteraction();

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

    compatViewerRef.value = null;
    if (isDev) {
        try {
            delete (window as any).__xeokitViewer;
            delete (window as any).__dtxViewer;
        } catch {
            // ignore
        }
    }
    viewerContext.viewerRef.value = null;
    viewerContext.overlayContainerRef.value = null;
    viewerContext.tools.value = null;
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
        <div
            v-if="lodDebugVisible"
            class="pointer-events-auto absolute left-3 top-3 w-[260px] rounded-md border border-border bg-background/90 p-2 text-foreground shadow-lg backdrop-blur"
            style="z-index: 950"
            @pointerdown.stop
            @wheel.stop
        >
            <div class="flex items-center justify-between gap-2">
                <div class="text-xs font-medium">DTX LOD Debug</div>
                <button
                    type="button"
                    class="inline-flex h-7 w-7 items-center justify-center rounded border border-input bg-background hover:bg-muted"
                    title="关闭"
                    @click.stop="closeLodDebugPanel"
                >
                    <X class="h-4 w-4" />
                </button>
            </div>

            <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
                <label class="flex flex-col gap-1">
                    <span class="text-muted-foreground">L1 px</span>
                    <input
                        v-model.number="lodUiConfig.l1Px"
                        type="number"
                        min="1"
                        step="1"
                        class="h-8 rounded border border-input bg-background px-2"
                    />
                </label>
                <label class="flex flex-col gap-1">
                    <span class="text-muted-foreground">L2 px</span>
                    <input
                        v-model.number="lodUiConfig.l2Px"
                        type="number"
                        min="1"
                        step="1"
                        class="h-8 rounded border border-input bg-background px-2"
                    />
                </label>
                <label class="flex flex-col gap-1">
                    <span class="text-muted-foreground">滞回</span>
                    <input
                        v-model.number="lodUiConfig.hysteresis"
                        type="number"
                        min="0"
                        max="0.89"
                        step="0.01"
                        class="h-8 rounded border border-input bg-background px-2"
                    />
                </label>
                <label class="flex flex-col gap-1">
                    <span class="text-muted-foreground">settle ms</span>
                    <input
                        v-model.number="lodUiConfig.settleMs"
                        type="number"
                        min="0"
                        step="10"
                        class="h-8 rounded border border-input bg-background px-2"
                    />
                </label>
            </div>

            <div class="mt-2 border-t border-border pt-2">
                <div class="text-xs font-medium">预热（L2，仅影响后续加载）</div>
                <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <label class="flex items-center gap-2">
                        <input
                            v-model="lodPrewarmUiConfig.enabled"
                            type="checkbox"
                            class="h-4 w-4"
                        />
                        <span>启用</span>
                    </label>
                    <div class="text-[10px] text-muted-foreground">
                        keys: dtx_lod_prewarm*
                    </div>
                    <label class="flex flex-col gap-1">
                        <span class="text-muted-foreground">topK</span>
                        <input
                            v-model.number="lodPrewarmUiConfig.topK"
                            type="number"
                            min="1"
                            step="1"
                            class="h-8 rounded border border-input bg-background px-2"
                        />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-muted-foreground">minCount</span>
                        <input
                            v-model.number="lodPrewarmUiConfig.minCount"
                            type="number"
                            min="1"
                            step="1"
                            class="h-8 rounded border border-input bg-background px-2"
                        />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-muted-foreground">并发</span>
                        <input
                            v-model.number="lodPrewarmUiConfig.concurrency"
                            type="number"
                            min="1"
                            step="1"
                            class="h-8 rounded border border-input bg-background px-2"
                        />
                    </label>
                </div>
            </div>
        </div>

        <div
            v-if="store.toolMode.value !== 'none' && toolsRef"
            class="pointer-events-none absolute bottom-2 right-2 rounded-md border border-border bg-background/85 px-2 py-1 text-xs text-foreground shadow-sm backdrop-blur"
            style="z-index: 940"
        >
            <div>{{ toolsRef.statusText.value }}</div>
            <div v-if="toolsRef.hoverText.value" class="mt-1 text-muted-foreground">
                {{ toolsRef.hoverText.value }}
            </div>
        </div>

        <!-- 左侧竖直工具栏（快捷操作） -->
        <div
            ref="leftToolbarRef"
            class="pointer-events-auto absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-lg backdrop-blur"
            style="z-index: 940"
            @pointerdown.stop
            @wheel.stop
        >
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                title="隐藏（选中对象）"
                :disabled="!hasSelectedRefno"
                @click.stop="hideSelected"
            >
                <EyeOff class="h-5 w-5" />
            </button>
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                title="显示（选中对象）"
                :disabled="!hasSelectedRefno"
                @click.stop="showSelected"
            >
                <Eye class="h-5 w-5" />
            </button>
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                title="全部隐藏"
                @click.stop="hideAll"
            >
                <EyeOff class="h-5 w-5" />
            </button>
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                title="定位显示（选中对象）"
                :disabled="!hasSelectedRefno"
                @click.stop="locateShowSelected"
            >
                <LocateFixed class="h-5 w-5" />
            </button>

            <!-- 测量（下拉：长度/角度） -->
            <div class="relative">
                <button
                    type="button"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                    :class="isMeasureModeActive ? 'bg-muted' : ''"
                    title="测量"
                    @click.stop="toggleLeftMeasureMenu"
                >
                    <Ruler class="h-5 w-5" />
                </button>

                <div
                    v-if="leftToolbarOpenMeasureMenu"
                    class="absolute left-full top-0 ml-2 flex w-40 flex-col gap-1 rounded-xl border border-border bg-background/95 p-1 shadow-lg backdrop-blur"
                    style="z-index: 941"
                >
                    <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                        :class="store.toolMode.value === 'measure_distance' ? 'bg-muted' : ''"
                        @click.stop="onLeftMeasureDistanceClick"
                    >
                        <Ruler class="h-4 w-4" />
                        <span>长度测量</span>
                    </button>
                    <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                        :class="store.toolMode.value === 'measure_angle' ? 'bg-muted' : ''"
                        @click.stop="onLeftMeasureAngleClick"
                    >
                        <Ruler class="h-4 w-4" />
                        <span>角度测量</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- 右侧竖直工具栏（查看/快捷） -->
        <div
            class="pointer-events-auto absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-lg backdrop-blur"
            style="z-index: 940"
            @pointerdown.stop
            @wheel.stop
        >
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                title="范围周边（以选中构件为中心）"
                :disabled="!hasSelectedRefno"
                @click.stop="onRightRangeQuickViewClick"
            >
                <Crosshair class="h-5 w-5" />
            </button>

            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                :class="rangeDrawerOpen ? 'bg-muted' : ''"
                title="按范围显示"
                @click.stop="toggleRangeDrawer"
            >
                <Layers class="h-5 w-5" />
            </button>

            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                title="显示所在房间全部模型（以房间树选中房间为准）"
                @click.stop="onRightRoomShowAllClick"
            >
                <Focus class="h-5 w-5" />
            </button>

            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                title="管网（占位）"
                @click.stop="onRightPipeNetworkClick"
            >
                <GitCompare class="h-5 w-5" />
            </button>

            <!-- 设置（弹出配置） -->
            <div class="relative">
                <button
                    type="button"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                    :class="rightToolbarOpenSettings ? 'bg-muted' : ''"
                    title="查看工具设置"
                    @click.stop="toggleRightSettings"
                >
                    <Settings class="h-5 w-5" />
                </button>

                <div
                    v-if="rightToolbarOpenSettings"
                    class="absolute right-full top-0 mr-2 w-72 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur"
                    style="z-index: 941"
                    @pointerdown.stop
                    @wheel.stop
                >
                    <div class="text-sm font-medium">查看工具设置</div>

                    <div class="mt-3 space-y-3">
                        <!-- 背景切换 -->
                        <div class="space-y-1">
                            <label class="text-xs text-muted-foreground">场景背景</label>
                            <div class="flex flex-wrap gap-1.5">
                                <button
                                    v-for="preset in backgroundStore.presets"
                                    :key="preset.mode"
                                    type="button"
                                    class="flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:bg-muted"
                                    :class="backgroundStore.mode.value === preset.mode ? 'border-ring bg-muted font-medium' : 'border-border'"
                                    :title="preset.label"
                                    @click.stop="onBackgroundChange(preset.mode)"
                                >
                                    <span
                                        class="inline-block h-4 w-4 shrink-0 rounded-sm border border-border"
                                        :style="{ background: `linear-gradient(to bottom, ${preset.topColor}, ${preset.bottomColor})` }"
                                    />
                                    <span>{{ preset.label }}</span>
                                </button>
                            </div>
                        </div>

                        <!-- 相机模式 -->
                        <div class="space-y-1">
                            <label class="text-xs text-muted-foreground">相机视角</label>
                            <div class="grid grid-cols-3 gap-1.5">
                                <button
                                    type="button"
                                    class="h-8 rounded-md border px-2 text-xs transition-colors hover:bg-muted"
                                    :class="cameraViewMode === 'cad_weak' ? 'border-ring bg-muted font-medium' : 'border-border'"
                                    @click.stop="onCameraViewModeChange('cad_weak')"
                                >
                                    弱透视
                                </button>
                                <button
                                    type="button"
                                    class="h-8 rounded-md border px-2 text-xs transition-colors hover:bg-muted"
                                    :class="cameraViewMode === 'cad_flat' ? 'border-ring bg-muted font-medium' : 'border-border'"
                                    @click.stop="onCameraViewModeChange('cad_flat')"
                                >
                                    近平行
                                </button>
                                <button
                                    type="button"
                                    class="h-8 rounded-md border px-2 text-xs transition-colors hover:bg-muted"
                                    :class="cameraViewMode === 'normal' ? 'border-ring bg-muted font-medium' : 'border-border'"
                                    @click.stop="onCameraViewModeChange('normal')"
                                >
                                    标准
                                </button>
                            </div>
                        </div>

                        <!-- 全局工程边线 -->
                        <div class="space-y-1">
                            <div class="flex items-center justify-between">
                                <label class="text-xs text-muted-foreground">全局工程边线</label>
                                <button
                                    type="button"
                                    class="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted"
                                    :class="globalEdgeEnabled ? 'border-ring bg-muted font-medium' : 'border-border text-muted-foreground'"
                                    @click.stop="onGlobalEdgeEnabledChange(!globalEdgeEnabled)"
                                >
                                    {{ globalEdgeEnabled ? '已开启' : '已关闭' }}
                                </button>
                            </div>
                            <div class="flex items-center justify-between">
                                <label class="text-xs text-muted-foreground">边线角阈值</label>
                                <span class="text-xs tabular-nums text-foreground">{{ globalEdgeThresholdAngle }}°</span>
                            </div>
                            <input
                                v-model.number="globalEdgeThresholdAngle"
                                type="range"
                                min="1"
                                max="60"
                                class="w-full"
                                :disabled="!globalEdgeEnabled"
                                @input="onGlobalEdgeThresholdInput(globalEdgeThresholdAngle)"
                            />
                            <div class="text-[11px] text-muted-foreground">
                                角度越小，边线越密；建议 15~25。
                            </div>
                        </div>

                        <div class="space-y-1">
                            <div class="flex items-center justify-between">
                                <label class="text-xs text-muted-foreground">范围半径 (m)</label>
                                <span class="text-xs tabular-nums text-foreground">{{ rangeRadiusM }}</span>
                            </div>
                            <input v-model="rangeRadiusM" type="range" min="1" max="500" class="w-full" />
                        </div>

                        <div class="space-y-1">
                            <div class="flex items-center justify-between">
                                <label class="text-xs text-muted-foreground">按专业过滤</label>
                                <button
                                    type="button"
                                    class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                                    @click.stop="rangeSettings.clearSpecFilter"
                                >
                                    清空
                                </button>
                            </div>
                            <div class="grid grid-cols-2 gap-2">
                                <label class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                                    <input type="checkbox"
                                        :checked="rangeSpecValues.includes(SiteSpecValue.Pipe)"
                                        @change="() => rangeSettings.toggleSpecValue(SiteSpecValue.Pipe)" />
                                    <span>{{ getSpecValueName(SiteSpecValue.Pipe) }}</span>
                                </label>
                                <label class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                                    <input type="checkbox"
                                        :checked="rangeSpecValues.includes(SiteSpecValue.Elec)"
                                        @change="() => rangeSettings.toggleSpecValue(SiteSpecValue.Elec)" />
                                    <span>{{ getSpecValueName(SiteSpecValue.Elec) }}</span>
                                </label>
                                <label class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                                    <input type="checkbox"
                                        :checked="rangeSpecValues.includes(SiteSpecValue.Inst)"
                                        @change="() => rangeSettings.toggleSpecValue(SiteSpecValue.Inst)" />
                                    <span>{{ getSpecValueName(SiteSpecValue.Inst) }}</span>
                                </label>
                                <label class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                                    <input type="checkbox"
                                        :checked="rangeSpecValues.includes(SiteSpecValue.Hvac)"
                                        @change="() => rangeSettings.toggleSpecValue(SiteSpecValue.Hvac)" />
                                    <span>{{ getSpecValueName(SiteSpecValue.Hvac) }}</span>
                                </label>
                            </div>
                            <div class="text-[11px] text-muted-foreground">
                                注：若模型未提供专业元数据，可能无法命中过滤。
                            </div>
                        </div>

                        <div class="space-y-1">
                            <label class="text-xs text-muted-foreground">按类型过滤（nouns，逗号分隔）</label>
                            <input
                                v-model="rangeNounsText"
                                class="h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                placeholder="例如：PIPE,BRAN,TUBI"
                            />
                        </div>

                        <div class="space-y-1">
                            <label class="text-xs text-muted-foreground">按名称过滤</label>
                            <input
                                v-model="rangeNameQuery"
                                class="h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                placeholder="refno 或名称关键字"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 按范围显示抽屉面板 -->
        <RangeQueryDrawer v-model:open="rangeDrawerOpen" />

        <div
            v-if="initError"
            class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur"
            style="z-index: 950"
        >
            <div
                class="max-w-[520px] rounded-lg border border-border bg-background p-4 text-sm shadow"
            >
                <div class="font-medium text-destructive">
                    3D Viewer 初始化失败
                </div>
                <div class="mt-2 text-muted-foreground">{{ initError }}</div>
            </div>
        </div>

        <!-- 标注右键菜单（SolveSpace 风格） -->
        <div
            v-if="dimContextMenu.visible"
            class="pointer-events-auto fixed z-[960] min-w-[180px] rounded-lg border border-border bg-background py-1 text-sm shadow-lg"
            :style="{ left: dimContextMenu.x + 'px', top: dimContextMenu.y + 'px' }"
            @pointerdown.stop
            @contextmenu.prevent.stop
        >
            <button
                class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                @click="dimCtxToggleReference"
            >
                {{ dimContextMenu.isReference ? '取消参考尺寸' : '设为参考尺寸' }}
            </button>
            <button
                v-if="dimContextMenu.kind === 'angle'"
                class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                @click="dimCtxToggleSupplementary"
            >
                {{ dimContextMenu.supplementary ? '显示原始角度' : '显示补角' }}
            </button>
            <button
                class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                @click="dimCtxSnapToGrid"
            >
                Snap to Grid
            </button>
            <div class="my-1 border-t border-border"></div>
            <button
                class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                @click="dimCtxResetLayout"
            >
                重置文字位置
            </button>
            <button
                class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground hover:bg-muted"
                @click="closeDimContextMenu"
            >
                取消
            </button>
        </div>
        <!-- 点击空白处关闭右键菜单 -->
        <div
            v-if="dimContextMenu.visible"
            class="pointer-events-auto fixed inset-0 z-[959]"
            @click="closeDimContextMenu"
            @contextmenu.prevent="closeDimContextMenu"
        />

        <MeasurementWizard
            v-if="
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
            @wheel.stop
        />

        <div
            v-if="showAnnotationToolbar"
            class="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-lg backdrop-blur"
            style="z-index: 940"
            @pointerdown.stop
            @wheel.stop
        >
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                :class="store.toolMode.value === 'annotation' ? 'bg-muted' : ''"
                title="箭头批注"
                @click.stop="store.setToolMode('annotation')"
            >
                <ArrowUpRight class="h-5 w-5" />
            </button>
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                :class="
                    store.toolMode.value === 'annotation_cloud'
                        ? 'bg-muted'
                        : ''
                "
                title="云线批注"
                @click.stop="store.setToolMode('annotation_cloud')"
            >
                <Cloud class="h-5 w-5" />
            </button>
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                :class="
                    store.toolMode.value === 'annotation_rect' ? 'bg-muted' : ''
                "
                title="矩形批注"
                @click.stop="store.setToolMode('annotation_rect')"
            >
                <RectangleHorizontal class="h-5 w-5" />
            </button>
            <div class="mx-1 h-6 w-px bg-border" />
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background text-destructive hover:bg-muted disabled:opacity-50"
                title="删除选中批注"
                :disabled="!canDeleteActiveAnnotation"
                @click.stop="deleteActiveAnnotation"
            >
                <Trash2 class="h-5 w-5" />
            </button>
            <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
                title="退出批注模式"
                @click.stop="store.setToolMode('none')"
            >
                <X class="h-5 w-5" />
            </button>
        </div>

        <ReviewConfirmation />
    </div>
</template>
