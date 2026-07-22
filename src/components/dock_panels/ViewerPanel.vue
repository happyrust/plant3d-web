<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import {
  Aperture,
  Eye,
  EyeOff,
  Focus,
  GitCompare,
  Ruler,
  ScanEye,
  Search,
  Settings,
  X,
} from 'lucide-vue-next';
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

import { e3dGetChildren, e3dGetVisibleInsts } from '@/api/genModelE3dApi';
import { pdmsGetUiAttr, type PtsetResponse } from '@/api/genModelPdmsAttrApi';
import { fetchMbdV2PipeData } from '@/api/mbdV2Api';
import {
  reviewRecordCreate,
  reviewRecordGetByTaskId,
  type ReviewSnapshotAnnotationPayload,
  type ReviewSnapshotMeasurementPayload,
} from '@/api/reviewApi';
import { resolveViewerToolbarSelection } from '@/components/dock_panels/viewerToolbarSelection';
import PipeDistanceDrawer from '@/components/pipe-distance/PipeDistanceDrawer.vue';
import ReviewConfirmation from '@/components/review/ReviewConfirmation.vue';
import { buildReviewConfirmSnapshotPayload } from '@/components/review/reviewPanelActions';
import SpatialQueryDrawer from '@/components/spatial-query/SpatialQueryDrawer.vue';
import AnnotationOverlayBar from '@/components/tools/AnnotationOverlayBar.vue';
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
import {
  getDbnoInstancesManifest,
  getDbnoInstancesMeta,
} from '@/composables/useDbnoInstancesJsonLoader';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';
import { useDisplayThemeStore, type DisplayTheme } from '@/composables/useDisplayThemeStore';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useDtxTools } from '@/composables/useDtxTools';
import { useMbdDiagnosticsStore } from '@/composables/useMbdDiagnosticsStore';
import { createMbdExternalSync } from '@/composables/useMbdExternalSync';
import { MeasurementAnnotationManager } from '@/composables/useMeasurementAnnotation';
import { useModelGeneration } from '@/composables/useModelGeneration';
import { useModelLoadStatus } from '@/composables/useModelLoadStatus';
import {
  queryDirectChildrenPtsetSummaryWithRuntimeFallback,
  queryPtsetWithRuntimeFallback,
} from '@/composables/usePtsetRuntimeLookup';
import { usePtsetVisualizationThree } from '@/composables/usePtsetVisualizationThree';
import { useReviewStore } from '@/composables/useReviewStore';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useSpatialCompute } from '@/composables/useSpatialCompute';
import { initializeSpatialQueryFromUrl, useSpatialQuery } from '@/composables/useSpatialQuery';
import { useToolStore } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useUserStore } from '@/composables/useUserStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { useXeokitMeasurementTools } from '@/composables/useXeokitMeasurementTools';
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
  isDimensionFlagEnabled,
  loadArchivedDimensionArchives,
  localDimensionDocumentId,
  LocalStorageDimensionCommandJournal,
  LocalStorageDimensionDocumentRepository,
  migrateLegacyDimensionArchives,
  ReviewDimensionRepository,
  type DimensionDocumentState,
  type DimensionSystem,
} from '@/dimension';
import { getOutputProjectFromUrl } from '@/lib/filesOutput';
import { onCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';
import { buildBackendUrl } from '@/utils/apiBase';
import {
  MODEL_UNIT_VERSION_COMPARE_EVENT,
  type ModelUnitVersionCompareEventDetail,
} from '@/utils/modelUnitVersionCompare';
import { parseGlbGeometry } from '@/utils/parseGlbGeometry';
import { SlopeAnnotation3D, WeldAnnotation3D } from '@/utils/three/annotation';
import { DTXLayer, DTXSelectionController, DTXViewCullController } from '@/utils/three/dtx';
import { DynamicPivotController } from '@/utils/three/dtx/DynamicPivotController';
import { loadModelDisplayConfig } from '@/utils/three/dtx/materialConfig';
import { DTXOverlayHighlighter } from '@/utils/three/dtx/selection/DTXOverlayHighlighter';
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
const dimensionOverlayCanvas = ref<HTMLCanvasElement | null>(null);
const overlayContainer = ref<HTMLElement | null>(null);
const dimensionDevEnabled = isDimensionFlagEnabled('DIMENSION_V2_DEV')
  || isDimensionFlagEnabled('DIMENSION_V2_CUTOVER');

const store = useToolStore();
const userStore = useUserStore();
const reviewStore = useReviewStore();
const consoleStore = useConsoleStore();
const modelLoadStatus = useModelLoadStatus();
const unitSettings = useUnitSettingsStore();
const selectionStore = useSelectionStore();
const spatialQueryStore = useSpatialQuery();
const spatialComputeStore = useSpatialCompute();
const viewerContext = useViewerContext();
const backgroundStore = useBackgroundStore();
const displayThemeStore = useDisplayThemeStore();
const mbdDiagnosticsStore = useMbdDiagnosticsStore();

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

function applyIncrementalCompareState(rawDetail: unknown) {
  const detail = rawDetail as {
    project?: unknown;
    dbnum?: unknown;
    fromReleaseId?: unknown;
    toReleaseId?: unknown;
    fromSesno?: unknown;
    toSesno?: unknown;
    mode?: unknown;
    compare?: unknown;
    componentKey?: unknown;
    refnos?: unknown;
    models?: unknown;
  };
  const refnos = Array.isArray(detail?.refnos)
    ? detail.refnos.map(normalizeCompareRefno).filter(Boolean)
    : [];
  const models = Array.isArray(detail?.models)
    ? detail.models
      .map((model: unknown) => {
        const item = model as IncrementalCompareModel;
        const refno = normalizeCompareRefno(item?.refno);
        if (!refno) return null;
        return {
          refno,
          componentKey: typeof item.componentKey === 'string' ? item.componentKey : undefined,
          refnoU64: Number.isFinite(Number(item.refnoU64)) ? Number(item.refnoU64) : undefined,
          category: item.category,
          status: item.status,
          beforeState: item.beforeState,
          afterState: item.afterState,
          sourceChangeCount: item.sourceChangeCount,
          sourceNouns: item.sourceNouns,
        };
      })
      .filter((item): item is IncrementalCompareModel => !!item)
    : [];
  const mergedRefnos = Array.from(new Set([
    ...refnos,
    ...models.map((item) => item.refno),
  ]));
  if (mergedRefnos.length === 0) return;

  incrementalCompareState.value = {
    project: typeof detail.project === 'string' ? detail.project : undefined,
    dbnum: Number.isFinite(Number(detail.dbnum)) ? Number(detail.dbnum) : undefined,
    fromReleaseId: typeof detail.fromReleaseId === 'string' ? detail.fromReleaseId : undefined,
    toReleaseId: typeof detail.toReleaseId === 'string' ? detail.toReleaseId : undefined,
    fromSesno: Number.isFinite(Number(detail.fromSesno)) ? Number(detail.fromSesno) : undefined,
    toSesno: Number.isFinite(Number(detail.toSesno)) ? Number(detail.toSesno) : undefined,
    mode: typeof detail.mode === 'string' ? detail.mode : undefined,
    compare: !!detail.compare,
    componentKey: typeof detail.componentKey === 'string' ? detail.componentKey : undefined,
    refnos: mergedRefnos,
    models: models.length > 0 ? models : mergedRefnos.map((refno) => ({ refno })),
  };
  incrementalCompareSelectedRefno.value = mergedRefnos[0] ?? null;
  if (incrementalCompareSelectedRefno.value) {
    selectionStore.setSelectedRefno(incrementalCompareSelectedRefno.value);
  }
  emitToast({ message: `已进入 DTX 版本对比：${mergedRefnos.length} 个模型` });
  clearIncrementalCompareProxy();
  clearIncrementalSplitCompare();
  if (incrementalCompareSelectedRefno.value) {
    loadIncrementalCompareRefno(incrementalCompareSelectedRefno.value);
  }
}

function compareStatusLabel(status?: string): string {
  if (status === 'added') return '新增';
  if (status === 'modified') return '修改';
  if (status === 'deleted') return '删除';
  if (status === 'mixed') return '混合';
  return '变化';
}

function compareStatusClass(status?: string): string {
  if (status === 'added') return 'bg-emerald-50 text-emerald-700';
  if (status === 'modified') return 'bg-amber-50 text-amber-700';
  if (status === 'deleted') return 'bg-rose-50 text-rose-700';
  if (status === 'mixed') return 'bg-blue-50 text-blue-700';
  return 'bg-slate-100 text-slate-700';
}

function versionStateLabel(state?: string): string {
  if (state === 'missing') return '不存在';
  if (state === 'changed') return '变化';
  if (state === 'present') return '存在';
  return '-';
}

function disposeObjectTree(obj: Group) {
  obj.traverse((child: any) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((mat: any) => mat?.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

function clearIncrementalCompareProxy() {
  const viewer = dtxViewerRef.value;
  if (incrementalCompareProxyGroup && viewer) {
    viewer.scene.remove(incrementalCompareProxyGroup);
  }
  if (incrementalCompareProxyGroup) {
    disposeObjectTree(incrementalCompareProxyGroup);
  }
  incrementalCompareProxyGroup = null;
}

function materialForVersionState(state?: string, status?: string) {
  if (state === 'missing') {
    return new MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
  }
  if (status === 'deleted') return new MeshBasicMaterial({ color: 0xe11d48, transparent: true, opacity: 0.72 });
  if (status === 'modified' || status === 'mixed') return new MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.78 });
  return new MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.82 });
}

function clearIncrementalCompareMiniScene(side: 'before' | 'after') {
  const sceneState = incrementalCompareSplitScenes[side];
  if (!sceneState) return;
  disposeObjectTree(sceneState.scene);
  sceneState.renderer.dispose();
  incrementalCompareSplitScenes[side] = null;
}

function clearIncrementalSplitCompare() {
  clearIncrementalCompareMiniScene('before');
  clearIncrementalCompareMiniScene('after');
  if (isDev) {
    delete (window as any).__incrementalCompareSplit;
  }
}

function scheduleIncrementalSplitCompareRender() {
  if (typeof window === 'undefined') return;
  void nextTick().then(() => {
    window.requestAnimationFrame(() => renderIncrementalSplitCompare());
  });
}

function ensureIncrementalCompareMiniScene(side: 'before' | 'after', canvas: HTMLCanvasElement) {
  let sceneState = incrementalCompareSplitScenes[side];
  if (!sceneState || sceneState.renderer.domElement !== canvas) {
    clearIncrementalCompareMiniScene(side);
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(new Color(0xf8fafc), 1);
    sceneState = {
      renderer,
      scene: new Scene(),
      camera: new PerspectiveCamera(38, 1, 0.1, 5000),
    };
    incrementalCompareSplitScenes[side] = sceneState;
  } else {
    disposeObjectTree(sceneState.scene);
    sceneState.scene = new Scene();
  }
  return sceneState;
}

function buildIncrementalCompareSideGroup(side: 'before' | 'after') {
  const rows = incrementalCompareModels.value;
  const group = new Group();
  group.name = `incremental-${side}-version-models`;
  if (rows.length === 0) return group;

  const columns = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(rows.length * 1.3))));
  const cellX = 2.4;
  const cellY = 2.1;
  const selected = incrementalCompareSelectedRefno.value;

  rows.forEach((row, index) => {
    const col = index % columns;
    const line = Math.floor(index / columns);
    const baseX = (col - (columns - 1) / 2) * cellX;
    const baseY = -line * cellY;
    const state = side === 'before' ? row.beforeState : row.afterState;
    const isSelected = row.refno === selected;
    const scale = isSelected ? 1.45 : 1;
    const height = Math.min(2.6, 0.7 + (row.sourceChangeCount ?? 1) * 0.07);
    const geometry = new BoxGeometry(0.86 * scale, 0.86 * scale, Math.max(0.24, height * scale));
    const mesh = new Mesh(geometry, materialForVersionState(state, row.status));
    mesh.name = `incremental-${side}-${row.refno}`;
    mesh.position.set(baseX, baseY, Math.max(0.24, height * scale) / 2);
    mesh.userData.refno = row.refno;
    mesh.userData.version = side;
    group.add(mesh);

    const edges = new LineSegments(
      new EdgesGeometry(geometry),
      new LineBasicMaterial({
        color: isSelected ? 0x2563eb : 0x475569,
        transparent: true,
        opacity: isSelected ? 1 : state === 'missing' ? 0.35 : 0.58,
      }),
    );
    edges.name = `incremental-${side}-edges-${row.refno}`;
    edges.position.copy(mesh.position);
    group.add(edges);
  });

  return group;
}

function renderIncrementalCompareSide(side: 'before' | 'after', canvas: HTMLCanvasElement) {
  const sceneState = ensureIncrementalCompareMiniScene(side, canvas);
  const width = Math.max(240, Math.floor(canvas.clientWidth || canvas.getBoundingClientRect().width || 320));
  const height = Math.max(180, Math.floor(canvas.clientHeight || canvas.getBoundingClientRect().height || 220));
  sceneState.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  sceneState.renderer.setSize(width, height, false);

  const scene = sceneState.scene;
  scene.background = new Color(0xf8fafc);
  scene.add(new AmbientLight(0xffffff, 0.76));
  const keyLight = new DirectionalLight(0xffffff, 1.45);
  keyLight.position.set(8, -10, 12);
  scene.add(keyLight);
  const fillLight = new DirectionalLight(0xc7d2fe, 0.58);
  fillLight.position.set(-8, 8, 8);
  scene.add(fillLight);

  const group = buildIncrementalCompareSideGroup(side);
  scene.add(group);

  const box = new Box3().setFromObject(group);
  const center = new Vector3();
  const size = new Vector3();
  if (box.isEmpty()) {
    center.set(0, 0, 0);
    size.set(8, 8, 4);
  } else {
    box.getCenter(center);
    box.getSize(size);
  }

  const maxDim = Math.max(size.x, size.y, size.z, 8);
  const camera = sceneState.camera;
  camera.aspect = width / height;
  camera.near = 0.1;
  camera.far = Math.max(500, maxDim * 40);
  camera.position.set(center.x + maxDim * 0.82, center.y - maxDim * 1.18, center.z + maxDim * 0.78);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  sceneState.renderer.render(scene, camera);
  canvas.dataset.rendered = 'true';
  canvas.dataset.modelCount = String(incrementalCompareModels.value.length);
}

function renderIncrementalSplitCompare() {
  if (!incrementalCompareState.value) return;
  const beforeCanvas = incrementalCompareBeforeCanvas.value;
  const afterCanvas = incrementalCompareAfterCanvas.value;
  if (!beforeCanvas || !afterCanvas) return;

  renderIncrementalCompareSide('before', beforeCanvas);
  renderIncrementalCompareSide('after', afterCanvas);

  if (isDev) {
    (window as any).__incrementalCompareSplit = {
      before: {
        hasCanvas: !!beforeCanvas,
        rendered: beforeCanvas.dataset.rendered === 'true',
        count: Number(beforeCanvas.dataset.modelCount || 0),
        width: beforeCanvas.clientWidth,
        height: beforeCanvas.clientHeight,
      },
      after: {
        hasCanvas: !!afterCanvas,
        rendered: afterCanvas.dataset.rendered === 'true',
        count: Number(afterCanvas.dataset.modelCount || 0),
        width: afterCanvas.clientWidth,
        height: afterCanvas.clientHeight,
      },
    };
  }
}

function renderIncrementalCompareProxy(flyTo = true) {
  const viewer = dtxViewerRef.value;
  if (!viewer || !incrementalCompareState.value) return;
  clearIncrementalCompareProxy();

  const rows = incrementalCompareModels.value;
  if (rows.length === 0) return;

  const group = new Group();
  group.name = 'incremental-version-compare-proxy';
  const columns = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(rows.length))));
  const cellX = 5.5;
  const cellY = 3.6;
  const pairGap = 1.25;
  const selected = incrementalCompareSelectedRefno.value;

  rows.forEach((row, index) => {
    const col = index % columns;
    const line = Math.floor(index / columns);
    const baseX = (col - (columns - 1) / 2) * cellX;
    const baseY = -line * cellY;
    const height = Math.min(2.4, 0.8 + (row.sourceChangeCount ?? 1) * 0.08);
    const isSelected = row.refno === selected;
    const scale = isSelected ? 1.35 : 1;
    const geometry = new BoxGeometry(0.9 * scale, 0.9 * scale, height * scale);

    const before = new Mesh(geometry.clone(), materialForVersionState(row.beforeState, row.status));
    before.name = `incremental-before-${row.refno}`;
    before.position.set(baseX - pairGap, baseY, height / 2);
    before.userData.refno = row.refno;
    before.userData.version = 'before';
    group.add(before);

    const after = new Mesh(geometry.clone(), materialForVersionState(row.afterState, row.status));
    after.name = `incremental-after-${row.refno}`;
    after.position.set(baseX + pairGap, baseY, height / 2);
    after.userData.refno = row.refno;
    after.userData.version = 'after';
    group.add(after);

    const edgeColor = isSelected ? 0x2563eb : 0x334155;
    for (const mesh of [before, after]) {
      const edges = new LineSegments(
        new EdgesGeometry(mesh.geometry),
        new LineBasicMaterial({ color: edgeColor, transparent: true, opacity: isSelected ? 0.95 : 0.42 }),
      );
      edges.position.copy(mesh.position);
      edges.scale.copy(mesh.scale);
      group.add(edges);
    }
  });

  viewer.scene.add(group);
  incrementalCompareProxyGroup = group;

  const box = new Box3().setFromObject(group);
  if (flyTo && !box.isEmpty()) {
    viewer.fitClipPlanesToBox(box);
    const center = new Vector3();
    const size = new Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 8);
    const position = new Vector3(center.x + maxDim * 1.1, center.y - maxDim * 1.45, center.z + maxDim * 0.9);
    viewer.flyTo(position, center, { duration: 650 });
  }

  if (isDev) {
    (window as any).__incrementalCompareProxy = {
      count: rows.length,
      selected,
      hasGroup: true,
    };
  }
  requestRender();
  scheduleIncrementalSplitCompareRender();
}

type RuntimeSceneGeometry = {
  geo_hash?: string;
  geo_index?: number;
  geo_matrix?: number[];
  mesh_asset?: {
    mesh_url?: string;
    sha256?: string;
  } | null;
};

type RuntimeSceneComponent = {
  aabb?: { min?: number[]; max?: number[] } | null;
  component_key?: string;
  geometries?: RuntimeSceneGeometry[];
  instance_matrix?: number[];
  noun?: string;
  refno_str?: string;
  refno_u64?: number;
};

type RuntimeScenePayload = {
  mesh_base_url?: string;
  mesh_lod_tag?: string;
  scene?: {
    components?: RuntimeSceneComponent[];
    release?: { release_id?: string; dbnum?: number };
  };
};

const modelVersionDtxGeometryCache = new Map<string, Promise<BufferGeometry | null>>();
let modelVersionDtxCompareObjectIds: string[] = [];
let modelVersionDtxCompareRunId = 0;

function hideModelVersionDtxCompareObjects() {
  const layer = dtxLayerRef.value;
  if (layer && modelVersionDtxCompareObjectIds.length > 0) {
    layer.setObjectsVisible(modelVersionDtxCompareObjectIds, false);
  }
  modelVersionDtxCompareObjectIds = [];
}

function matrixFromRuntimeArray(value: unknown): Matrix4 {
  if (Array.isArray(value) && value.length === 16 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return new Matrix4().fromArray(value as number[]);
  }
  return new Matrix4();
}

function runtimeMeshUrl(data: RuntimeScenePayload, geo: RuntimeSceneGeometry): string {
  const assetUrl = geo.mesh_asset?.mesh_url;
  if (assetUrl) return assetUrl;
  const base = String(data.mesh_base_url || '').replace(/\/+$/, '');
  const lod = String(data.mesh_lod_tag || 'L1');
  const hash = String(geo.geo_hash || '');
  return `${base}/${hash}_${lod}.glb`;
}

async function loadRuntimeGlbGeometry(url: string): Promise<BufferGeometry | null> {
  const key = url;
  const existing = modelVersionDtxGeometryCache.get(key);
  if (existing) return await existing;

  const task = (async () => {
    const response = await fetch(url);
    if (!response.ok) return null;
    const parsed = await parseGlbGeometry(await response.arrayBuffer());
    if (!parsed) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(parsed.positions), 3));
    if (parsed.normals && parsed.normals.length === parsed.positions.length) {
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(parsed.normals), 3));
    }
    geometry.setIndex(new BufferAttribute(new Uint32Array(parsed.indices), 1));
    if (!parsed.normals) geometry.computeVertexNormals();
    return geometry;
  })();

  modelVersionDtxGeometryCache.set(key, task);
  return await task;
}

async function fetchReleaseRuntimeScene(releaseId: string, componentKey: string, project?: string): Promise<RuntimeScenePayload> {
  const params = new URLSearchParams({
    component_key: componentKey,
    limit: '1',
  });
  if (project) params.set('project', project);
  const url = buildBackendUrl(`/api/model-version/releases/${encodeURIComponent(releaseId)}/runtime-scene?${params.toString()}`);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body?.success === false) {
    throw new Error(body?.message || `release runtime scene failed: ${releaseId}`);
  }
  return body.data as RuntimeScenePayload;
}

function modelVersionComponentKey(model: IncrementalCompareModel | null): string | null {
  if (model?.componentKey) return model.componentKey;
  const state = incrementalCompareState.value;
  if (state?.componentKey) return state.componentKey;
  const dbnum = state?.dbnum;
  if (dbnum && model?.refnoU64) return `${dbnum}:${model.refnoU64}`;
  return null;
}

function boxFromRuntimeComponent(component: RuntimeSceneComponent): Box3 | null {
  const min = component.aabb?.min;
  const max = component.aabb?.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length < 3 || max.length < 3) return null;
  const values = [min[0], min[1], min[2], max[0], max[1], max[2]].map(Number);
  if (!values.every((value) => Number.isFinite(value))) return null;
  return new Box3(
    new Vector3(values[0], values[1], values[2]),
    new Vector3(values[3], values[4], values[5]),
  );
}

function runtimeSceneComponentsBox(components: RuntimeSceneComponent[]): Box3 {
  const box = new Box3();
  for (const component of components) {
    const componentBox = boxFromRuntimeComponent(component);
    if (componentBox && !componentBox.isEmpty()) box.union(componentBox);
  }
  return box;
}

async function loadIncrementalCompareReleaseDtx(refno: string): Promise<boolean> {
  const state = incrementalCompareState.value;
  const model = incrementalCompareSelectedModel.value;
  const componentKey = modelVersionComponentKey(model);
  if (!state?.fromReleaseId || !state.toReleaseId || !componentKey) return false;

  const layer = dtxLayerRef.value;
  const viewer = dtxViewerRef.value;
  if (!layer || !viewer) return false;

  const runId = ++modelVersionDtxCompareRunId;
  hideModelVersionDtxCompareObjects();

  const debugState = {
    runId,
    status: 'running',
    requested: [refno],
    componentKey,
    releases: [state.fromReleaseId, state.toReleaseId],
    loadedObjects: 0,
    failedGeometries: 0,
    displayMode: 'release-local-side-by-side',
    offset: 0,
    sideCenters: [] as { side: string; center: number[]; size: number[]; components: number }[],
    error: null as string | null,
  };
  if (isDev) {
    (window as any).__dtxVersionCompareReleaseScene = debugState;
  }

  try {
    const [fromScene, toScene] = await Promise.all([
      fetchReleaseRuntimeScene(state.fromReleaseId, componentKey, state.project),
      fetchReleaseRuntimeScene(state.toReleaseId, componentKey, state.project),
    ]);
    const sideScenes = [
      { side: 'from', data: fromScene, releaseId: state.fromReleaseId, offsetSign: -1, color: new Color(0x2563eb) },
      { side: 'to', data: toScene, releaseId: state.toReleaseId, offsetSign: 1, color: new Color(0x10b981) },
    ] as const;
    const sideEntries = sideScenes.map((sideScene) => {
      const components = sideScene.data.scene?.components || [];
      const sourceBox = runtimeSceneComponentsBox(components);
      const center = new Vector3();
      const size = new Vector3(100, 100, 100);
      if (!sourceBox.isEmpty()) {
        sourceBox.getCenter(center);
        sourceBox.getSize(size);
      }
      return { ...sideScene, components, sourceBox, center, size };
    });
    const maxSideWidth = Math.max(...sideEntries.map(({ size }) => Math.abs(size.x)), 80);
    const maxSideDim = Math.max(
      ...sideEntries.flatMap(({ size }) => [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)]),
      80,
    );
    const offset = Math.max(105, maxSideWidth * 0.65 + 55, maxSideDim * 0.55);
    debugState.offset = offset;
    debugState.sideCenters = sideEntries.map(({ side, center, size, components }) => ({
      side,
      center: center.toArray(),
      size: size.toArray(),
      components: components.length,
    }));
    const addedObjectIds: string[] = [];

    for (const { side, data, releaseId, offsetSign, color, components, center } of sideEntries) {
      for (const component of components) {
        const instanceMatrix = matrixFromRuntimeArray(component.instance_matrix);
        for (const geo of component.geometries || []) {
          const meshUrl = runtimeMeshUrl(data, geo);
          const geometry = await loadRuntimeGlbGeometry(meshUrl);
          if (!geometry) {
            debugState.failedGeometries += 1;
            continue;
          }
          const geoHash = `mv:${releaseId}:${geo.geo_hash || 'geo'}:${geo.geo_index ?? 0}:${geo.mesh_asset?.sha256 || meshUrl}`;
          layer.addGeometry(geoHash, geometry);
          const geoMatrix = matrixFromRuntimeArray(geo.geo_matrix);
          const normalizeMatrix = new Matrix4().makeTranslation(
            offset * offsetSign - center.x,
            -center.y,
            -center.z,
          );
          const matrix = new Matrix4()
            .copy(normalizeMatrix)
            .multiply(instanceMatrix)
            .multiply(geoMatrix);
          const objectId = `mv:${runId}:${side}:${component.component_key || componentKey}:${geo.geo_index ?? addedObjectIds.length}`;
          layer.addObject(objectId, geoHash, matrix, color, {
            metalness: 0.08,
            roughness: 0.78,
            opacity: 0.86,
          });
          addedObjectIds.push(objectId);
          debugState.loadedObjects += 1;
        }
      }
    }

    modelVersionDtxCompareObjectIds = addedObjectIds;
    if (addedObjectIds.length > 0) {
      layer.recompile();
      const box = new Box3();
      const tmp = new Box3();
      for (const objectId of addedObjectIds) {
        const objectBox = layer.getObjectBoundingBoxInto(objectId, tmp);
        if (objectBox && !objectBox.isEmpty()) box.union(objectBox);
      }
      if (!box.isEmpty()) {
        viewer.fitClipPlanesToBox(box);
        const center = new Vector3();
        const size = new Vector3();
        box.getCenter(center);
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 1);
        viewer.flyTo(
          new Vector3(center.x + maxDim * 2.05, center.y - maxDim * 2.35, center.z + maxDim * 1.65),
          center,
          { duration: 650 },
        );
      }
      requestRender();
    }

    debugState.status = 'done';
    emitToast({ message: `已用 DTX 加载版本对比模型：${refno}` });
    return addedObjectIds.length > 0;
  } catch (error) {
    debugState.status = 'error';
    debugState.error = error instanceof Error ? error.message : String(error);
    console.warn('[ViewerPanel] release DTX compare load failed', error);
    emitToast({ message: `版本 DTX 模型加载失败：${debugState.error}`, level: 'error' });
    return false;
  }
}

function loadIncrementalCompareRefno(refno: string) {
  const normalized = normalizeCompareRefno(refno);
  if (!normalized) return;
  incrementalCompareSelectedRefno.value = normalized;
  selectionStore.setSelectedRefno(normalized);
  clearIncrementalCompareProxy();
  clearIncrementalSplitCompare();
  if (incrementalCompareState.value?.fromReleaseId && incrementalCompareState.value?.toReleaseId) {
    void loadIncrementalCompareReleaseDtx(normalized);
    return;
  }
  window.dispatchEvent(new CustomEvent('showModelByRefnos', {
    detail: {
      refnos: [normalized],
      flyTo: true,
    },
  }));
  window.dispatchEvent(new CustomEvent('autoLocateRefno', {
    detail: {
      refno: normalized.replace(/_/g, '/'),
    },
  }));
}

function closeIncrementalCompareOverlay() {
  incrementalCompareState.value = null;
  incrementalCompareSelectedRefno.value = null;
  hideModelVersionDtxCompareObjects();
  clearIncrementalCompareProxy();
  clearIncrementalSplitCompare();
  requestRender();
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
  if (isXeokitMeasureMode.value) return '';
  return toolsRef.value?.hoverText?.value ?? '';
});

// 右侧竖直工具栏（查看/快捷）
const rightToolbarOpenSettings = ref(false);
const spatialQueryOpen = ref(false);
const pipeDistDrawerOpen = ref(false);

const dtxViewerRef = shallowRef<DtxViewer | null>(null);
const dtxLayerRef = shallowRef<DTXLayer | null>(null);
const showDbnumExtraDtxLayers: DTXLayer[] = [];
const attachedShowDbnumExtraDtxLayers = new WeakSet<DTXLayer>();
type ModelUnitCompareOpenDetail = Extract<ModelUnitVersionCompareEventDetail, { action: 'open' }>;
type ModelUnitCompareRuntimeState = {
  detail: ModelUnitCompareOpenDetail;
  status: 'loading' | 'ready' | 'error';
  error?: string;
};
const modelUnitCompareState = ref<ModelUnitCompareRuntimeState | null>(null);
let modelUnitCompareLayers: DTXLayer[] = [];
let modelUnitCompareOriginalVisibleObjectIds: string[] = [];
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
let offLocalDimensionAutosave: (() => void) | null = null;
let localDimensionAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
let localDimensionAutosaveRunning = false;
let dimensionMountDisposed = false;
let dimensionInitializationVersion = 0;
const dimensionViewerAdapter = createDtxDimensionViewerAdapter({
  getCamera: () => dtxViewerRef.value?.camera,
  getMillimetresToScene: () => dtxLayerRef.value?.getGlobalModelMatrix(),
  getContainer: () => containerRef.value,
});

type IncrementalCompareModel = {
    refno: string;
    componentKey?: string;
    refnoU64?: number;
    category?: string;
    status?: string;
    beforeState?: string;
    afterState?: string;
    sourceChangeCount?: number;
    sourceNouns?: string;
};

type IncrementalCompareState = {
    project?: string;
    dbnum?: number;
    fromReleaseId?: string;
    toReleaseId?: string;
    fromSesno?: number;
    toSesno?: number;
    mode?: string;
    compare?: boolean;
    componentKey?: string;
    refnos: string[];
    models: IncrementalCompareModel[];
};

const incrementalCompareState = ref<IncrementalCompareState | null>(null);
const incrementalCompareSelectedRefno = ref<string | null>(null);
const incrementalCompareBeforeCanvas = ref<HTMLCanvasElement | null>(null);
const incrementalCompareAfterCanvas = ref<HTMLCanvasElement | null>(null);

const incrementalCompareModels = computed(() => {
  const state = incrementalCompareState.value;
  if (!state) return [];
  if (state.models.length > 0) return state.models;
  return state.refnos.map((refno) => ({ refno }));
});

const incrementalCompareSelectedModel = computed(() => {
  const selected = incrementalCompareSelectedRefno.value;
  return incrementalCompareModels.value.find((item) => item.refno === selected)
    ?? incrementalCompareModels.value[0]
    ?? null;
});

const incrementalCompareBeforePresentCount = computed(() =>
  incrementalCompareModels.value.filter((item) => item.beforeState !== 'missing').length,
);

const incrementalCompareAfterPresentCount = computed(() =>
  incrementalCompareModels.value.filter((item) => item.afterState !== 'missing').length,
);

let incrementalCompareProxyGroup: Group | null = null;
let incrementalCompareSplitScenes: Record<'before' | 'after', {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
} | null> = {
  before: null,
  after: null,
};

watch(
  () => [dtxViewerRef.value, incrementalCompareState.value, incrementalCompareSelectedRefno.value] as const,
  ([viewer, state]) => {
    if (!viewer || !state) return;
    clearIncrementalCompareProxy();
    clearIncrementalSplitCompare();
  },
);

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
let offIncrementalCompare: (() => void) | null = null;
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

function finiteNumberAttr(attrs: Record<string, unknown>, key: string): number | null {
  const raw = attrs[key];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function describeNoGeometryReason(refno: string): Promise<string | null> {
  try {
    const resp = await pdmsGetUiAttr(refno);
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
  const result = branClearanceToExternalDimensions(
    candidates,
    point => {
      const design = new Vector3(...point).applyMatrix4(
        dimensionViewerAdapter.getDesignToWorld().invert(),
      );
      return [design.x, design.y, design.z];
    },
  );
  system.replaceExternalSource('bran-clearance', result.records);
  if (result.skipped.length > 0) {
    console.warn(
      '[bran-clearance] skipped incomplete dimension candidates',
      result.skipped,
    );
  }
}

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

function clearModelUnitVersionCompare(): void {
  modelUnitCompareRunId += 1;
  for (const layer of modelUnitCompareLayers.splice(0)) {
    disposeModelUnitCompareLayer(layer);
  }
  const primaryLayer = dtxLayerRef.value;
  if (primaryLayer && modelUnitCompareOriginalVisibleObjectIds.length > 0) {
    primaryLayer.setObjectsVisible(modelUnitCompareOriginalVisibleObjectIds, true);
  }
  modelUnitCompareOriginalVisibleObjectIds = [];
  modelUnitCompareState.value = null;
  if (isDev && typeof window !== 'undefined') {
    delete (window as any).__modelUnitVersionCompare;
  }
  requestRender();
}

function requestCloseModelUnitVersionCompare(): void {
  window.dispatchEvent(new CustomEvent(MODEL_UNIT_VERSION_COMPARE_EVENT, {
    detail: { action: 'close' } satisfies ModelUnitVersionCompareEventDetail,
  }));
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

  selectionStore.setSelectedRefno(normalized);
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

async function openModelUnitVersionCompare(detail: ModelUnitCompareOpenDetail): Promise<void> {
  clearModelUnitVersionCompare();
  closeIncrementalCompareOverlay();
  const viewer = dtxViewerRef.value;
  const primaryLayer = dtxLayerRef.value;
  if (!viewer || !primaryLayer) {
    modelUnitCompareState.value = { detail, status: 'error', error: '三维查看器尚未就绪' };
    return;
  }

  const runId = ++modelUnitCompareRunId;
  modelUnitCompareState.value = { detail, status: 'loading' };
  const currentObjectIds = Array.from(new Set(
    [
      ...resolveDtxObjectIdsByUnitRefno(detail.dbnum, detail.unitRefno),
      ...detail.refnos.flatMap((refno) => resolveDtxObjectIdsByRefno(detail.dbnum, refno)),
    ],
  ));
  modelUnitCompareOriginalVisibleObjectIds = currentObjectIds.filter((objectId) => primaryLayer.isObjectVisible(objectId));
  if (modelUnitCompareOriginalVisibleObjectIds.length > 0) {
    primaryLayer.setObjectsVisible(modelUnitCompareOriginalVisibleObjectIds, false);
  }

  const beforeLayer = createShowDbnumDtxLayer(viewer, primaryLayer);
  const afterLayer = createShowDbnumDtxLayer(viewer, primaryLayer);
  modelUnitCompareLayers = [beforeLayer, afterLayer];

  try {
    const sharedInstanceEntries = detail.before.artifactSesno === detail.after.artifactSesno
      ? await useDbnoInstancesParquetLoader().queryInstanceEntriesByRefnos(detail.dbnum, detail.refnos, {
        manifestUrl: detail.after.manifestUrl,
        includeOwnedTubings: false,
      })
      : undefined;
    if (runId !== modelUnitCompareRunId) return;
    const commonOptions = {
      dataSource: 'parquet' as const,
      includeOwnedTubings: false,
      isolated: true,
      instanceEntriesByRefno: sharedInstanceEntries,
    };
    const [beforeResult, afterResult] = await Promise.all([
      loadDbnoInstancesForVisibleRefnosDtx(beforeLayer, detail.dbnum, detail.refnos, {
        ...commonOptions,
        parquetManifestUrl: detail.before.manifestUrl,
        objectIdPrefix: 'unit-compare:a',
      }),
      loadDbnoInstancesForVisibleRefnosDtx(afterLayer, detail.dbnum, detail.refnos, {
        ...commonOptions,
        parquetManifestUrl: detail.after.manifestUrl,
        objectIdPrefix: 'unit-compare:b',
      }),
    ]);
    if (runId !== modelUnitCompareRunId) {
      disposeModelUnitCompareLayer(beforeLayer);
      disposeModelUnitCompareLayer(afterLayer);
      return;
    }
    if (detail.refnos.length > 0 && beforeResult.loadedObjects + afterResult.loadedObjects === 0) {
      throw new Error('所选版本没有可显示的几何对象');
    }

    const beforeColor = new Color(0x2563eb);
    const afterColor = new Color(0x10b981);
    for (const objectId of beforeLayer.getAllObjectIds()) beforeLayer.setObjectColor(objectId, beforeColor);
    for (const objectId of afterLayer.getAllObjectIds()) afterLayer.setObjectColor(objectId, afterColor);

    const beforeBox = beforeLayer.getBoundingBox();
    const afterBox = afterLayer.getBoundingBox();
    const beforeCenter = new Vector3();
    const afterCenter = new Vector3();
    const beforeSize = new Vector3(1, 1, 1);
    const afterSize = new Vector3(1, 1, 1);
    if (!beforeBox.isEmpty()) {
      beforeBox.getCenter(beforeCenter);
      beforeBox.getSize(beforeSize);
    }
    if (!afterBox.isEmpty()) {
      afterBox.getCenter(afterCenter);
      afterBox.getSize(afterSize);
    }
    const maxDim = Math.max(
      beforeSize.x, beforeSize.y, beforeSize.z,
      afterSize.x, afterSize.y, afterSize.z,
      1,
    );
    const gap = Math.max(maxDim * 0.16, 1);
    const beforeTargetX = -(gap / 2 + beforeSize.x / 2);
    const afterTargetX = gap / 2 + afterSize.x / 2;
    const sourceMatrix = primaryLayer.getGlobalModelMatrix();
    beforeLayer.setGlobalModelMatrix(
      new Matrix4()
        .makeTranslation(beforeTargetX - beforeCenter.x, -beforeCenter.y, -beforeCenter.z)
        .multiply(sourceMatrix),
    );
    afterLayer.setGlobalModelMatrix(
      new Matrix4()
        .makeTranslation(afterTargetX - afterCenter.x, -afterCenter.y, -afterCenter.z)
        .multiply(sourceMatrix),
    );

    ensureShowDbnumExtraLayerAttached(beforeLayer, viewer);
    ensureShowDbnumExtraLayerAttached(afterLayer, viewer);
    const compareBox = computeDtxLayersBoundingBox([beforeLayer, afterLayer]);
    if (compareBox) {
      viewer.fitClipPlanesToBox(compareBox);
      const center = new Vector3();
      const size = new Vector3();
      compareBox.getCenter(center);
      compareBox.getSize(size);
      const sceneSize = Math.max(size.x, size.y, size.z, 1);
      viewer.flyTo(
        new Vector3(center.x + sceneSize * 1.2, center.y - sceneSize * 1.5, center.z + sceneSize),
        center,
        { duration: 650 },
      );
    }

    modelUnitCompareState.value = { detail, status: 'ready' };
    if (isDev) {
      (window as any).__modelUnitVersionCompare = {
        unitRefno: detail.unitRefno,
        beforeSesno: detail.before.sesno,
        afterSesno: detail.after.sesno,
        beforeObjects: beforeResult.loadedObjects,
        afterObjects: afterResult.loadedObjects,
      };
    }
    requestRender();
  } catch (error) {
    if (runId !== modelUnitCompareRunId) {
      disposeModelUnitCompareLayer(beforeLayer);
      disposeModelUnitCompareLayer(afterLayer);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    clearModelUnitVersionCompare();
    modelUnitCompareState.value = { detail, status: 'error', error: message };
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

const mbdExternalSync = createMbdExternalSync({
  fetchPipeData: fetchMbdV2PipeData,
  queryParquetDimensions: (dbno, options) =>
    useDbnoInstancesParquetLoader().queryMbdDimensionsByDbno(dbno, options),
  diagnostics: mbdDiagnosticsStore,
  getSearch: () => window.location.search,
  emitToast,
});

function syncMbdExternalDimensions(
  system: DimensionSystem,
  options: Readonly<{ forceRefresh?: boolean }> = {},
): Promise<void> {
  return mbdExternalSync.sync(system, {
    ...options,
    isCancelled: () => dimensionSystem !== system || dimensionMountDisposed,
  });
}

async function initializeDimensionViewport(): Promise<void> {
  if (!dimensionDevEnabled) return;
  const initializationVersion = ++dimensionInitializationVersion;
  const canvas = dimensionOverlayCanvas.value;
  const inputCanvas = mainCanvas.value;
  const container = containerRef.value;
  if (!canvas || !inputCanvas || !container) return;

  dimensionSystem?.dispose();
  dimensionSystem = null;
  stopLocalDimensionAutosave();
  offDimensionReviewBinding?.();
  offDimensionReviewBinding = null;
  viewerContext.dimensionSystem.value = null;

  const context = getDimensionDocumentContext();
  const sceneWorldToDesignMetres = (
    point: readonly [number, number, number],
  ): readonly [number, number, number] => {
    const design = new Vector3(...point).applyMatrix4(
      dimensionViewerAdapter.getDesignToWorld().invert(),
    );
    return [design.x, design.y, design.z];
  };
  const sceneDirectionToDesign = (
    direction: readonly [number, number, number],
  ): readonly [number, number, number] => {
    const origin = sceneWorldToDesignMetres([0, 0, 0]);
    const endpoint = sceneWorldToDesignMetres(direction);
    return [
      endpoint[0] - origin[0],
      endpoint[1] - origin[1],
      endpoint[2] - origin[2],
    ];
  };
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
    overlayCanvas: canvas,
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
  void syncMbdExternalDimensions(result.system);
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
  viewerContext.dimensionSystem.value = result.system;
  result.system.notifyViewerChanged();
  syncBranClearanceDimensions();
}

watch(
  () => [
    reviewStore.currentTask.value?.id ?? null,
    reviewStore.currentTask.value?.formId ?? null,
  ],
  () => {
    if (!dimensionDevEnabled || !dimensionOverlayCanvas.value) return;
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
  annotationSystem?.renderLabels(dtxViewer.scene, dtxViewer.camera);
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

    // 三维标注系统更新
    annotationSystem?.renderLabels(dtxViewer.scene, dtxViewer.camera);

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
    void spatialQueryStore.submitQuery(1);
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

onMounted(async () => {
  const canvas = mainCanvas.value;
  const container = containerRef.value;
  if (!canvas || !container) return;

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
      void syncMbdExternalDimensions(dimensionSystem, { forceRefresh: true });
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

  const urlParams = new URLSearchParams(window.location.search);
  const showDbnum = urlParams.get('show_dbnum');
  const showRefno = normalizeRefnoKeyLike(urlParams.get('show_refno') || '');
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
        selectionStore.setSelectedRefno(showRefno);

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

        const urlDataSource = new URLSearchParams(window.location.search).get('data_source') as 'json' | 'parquet' | 'auto' | null;
        const ds = urlDataSource || 'auto';
        console.log(`[show_refno] refno=${showRefno} -> dbnum=${dbno}, dataSource=${ds}`);

        // 先查询可见子实例（容器节点本身在 Parquet 中没有几何数据）
        let loadRefnos = [showRefno];
        let visibleInstsUserHint: string | null = null;
        let noGeometryReason: string | null = null;
        try {
          const visResp = await e3dGetVisibleInsts(showRefno);
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
          { lodAssetKey: 'L1', debug: true, dataSource: ds }
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

  // show_dbnum URL 参数：按 dbno 直接走 Parquet 全量加载。
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
          emitToast({ message: `[信息] 正在加载 dbnum=${dbno} 的 Parquet 模型…`, level: 'info' });
          const autoFitKey = `dtx_autofit_dbno_${dbno}`;
          let shouldAutoFit = true;
          try {
            shouldAutoFit = sessionStorage.getItem(autoFitKey) !== '1';
          } catch {}

          const parquetLoader = useDbnoInstancesParquetLoader();
          const available = await parquetLoader.isParquetAvailable(dbno);
          if (!available) {
            publishShowDbnumLoadResult({
              status: 'error',
              error: `dbnum=${dbno} 未找到 Parquet 数据`,
            });
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
            publishShowDbnumLoadResult({
              status: 'empty',
              refnoCount: 0,
              loadedRefnos: 0,
              skippedRefnos: 0,
              loadedObjects: 0,
              missingRefnos: 0,
              mesh404Refnos: 0,
              mesh404GeoHashes: 0,
              noGeoRowsRefnos: 0,
            });
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
          publishShowDbnumLoadResult({
            status: 'loading',
            refnoCount: allRefnos.length,
            loadedRefnos: 0,
            skippedRefnos: 0,
            loadedObjects: 0,
            missingRefnos: 0,
            mesh404Refnos: 0,
            mesh404GeoHashes: 0,
            noGeoRowsRefnos: 0,
          });

          const LOAD_BATCH_SIZE = SHOW_DBNUM_LOAD_BATCH_SIZE;
          const fullLoad = new URLSearchParams(window.location.search)
            .get('show_dbnum_full') === '1';
          let loadedRefnos = 0;
          let skippedRefnos = 0;
          let loadedObjects = 0;
          let loadedTriangles = 0;
          let missingRefnos = 0;
          let budgetLimited = false;
          const missingNoGeoRows = new Set<string>();
          const missingMesh404Refnos = new Set<string>();
          const missingMesh404GeoHashes = new Set<string>();
          let activeShowDbnumLayer = dtxLayer;
          if (typeof window !== 'undefined') {
            (window as any).__dtxShowDbnumLayers = () => getShowDbnumAllLayers(dtxLayer);
          }

          for (let start = 0; start < allRefnos.length; start += LOAD_BATCH_SIZE) {
            const end = Math.min(allRefnos.length, start + LOAD_BATCH_SIZE);
            const batch = allRefnos.slice(start, end);
            const batchResult = await loadDbnoInstancesForVisibleRefnosDtx(
              activeShowDbnumLayer,
              dbno,
              batch,
              { lodAssetKey: 'L1', debug: isDev, dataSource: 'parquet', includeOwnedTubings: false }
            );
            (compat as any).__dtxAfterInstancesLoaded?.(dbno, batch);
            if (activeShowDbnumLayer !== dtxLayer) {
              activeShowDbnumLayer.setGlobalModelMatrix(dtxLayer.getGlobalModelMatrix());
              ensureShowDbnumExtraLayerAttached(activeShowDbnumLayer, dtxViewer);
            }

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
            const activeLayerStats = activeShowDbnumLayer.getStats();
            loadedTriangles = getShowDbnumAllLayers(dtxLayer).reduce(
              (sum, layer) => sum + layer.getStats().drawTriangleCount,
              0,
            );
            publishShowDbnumLoadResult({
              status: 'loading',
              refnoCount: allRefnos.length,
              loadedRefnos,
              skippedRefnos,
              loadedObjects,
              missingRefnos,
              mesh404Refnos: missingMesh404Refnos.size,
              mesh404GeoHashes: missingMesh404GeoHashes.size,
              noGeoRowsRefnos: missingNoGeoRows.size,
              layerCount: getShowDbnumAllLayers(dtxLayer).length,
              activeLayerObjects: activeLayerStats.totalObjects,
              activeLayerTriangles: activeLayerStats.drawTriangleCount,
            });

            if (end < allRefnos.length) {
              if (shouldStopShowDbnumLoad({
                objects: loadedObjects,
                triangles: loadedTriangles,
              }, fullLoad)) {
                budgetLimited = true;
                break;
              }
              if (shouldRollShowDbnumLayer(activeShowDbnumLayer)) {
                activeShowDbnumLayer = createShowDbnumDtxLayer(dtxViewer, dtxLayer);
                publishShowDbnumLoadResult({
                  status: 'loading',
                  refnoCount: allRefnos.length,
                  loadedRefnos,
                  skippedRefnos,
                  loadedObjects,
                  missingRefnos,
                  mesh404Refnos: missingMesh404Refnos.size,
                  mesh404GeoHashes: missingMesh404GeoHashes.size,
                  noGeoRowsRefnos: missingNoGeoRows.size,
                  layerCount: getShowDbnumAllLayers(dtxLayer).length,
                  activeLayerObjects: 0,
                  activeLayerTriangles: 0,
                });
              }
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
          if (dimensionSystem) {
            void syncMbdExternalDimensions(dimensionSystem, {
              forceRefresh: true,
            });
            void dimensionSystem.refreshAnchors();
          }
          if (shouldAutoFit) {
            const combinedBox = computeDtxLayersBoundingBox(getShowDbnumAllLayers(dtxLayer));
            if (combinedBox) {
              fitDtxViewerToBox(dtxViewer, combinedBox, 0);
              try {
                cadGridRef.value?.fitToBoundingBox(combinedBox);
              } catch {
                // ignore
              }
            } else {
              fitDtxViewerToFocusBox(dtxViewer, dtxLayer, 0);
            }
            requestRender();
            try {
              sessionStorage.setItem(autoFitKey, '1');
            } catch {}
          }
          const summary =
            `${budgetLimited ? `安全概览 ${loadedRefnos}/${allRefnos.length} 个 refno，` : ''}` +
            `对象 ${loadedObjects}（已加载 ${loadedRefnos}，跳过 ${skippedRefnos}，缺失 ${missingRefnos}；` +
            `mesh 缺失 ${missingMesh404Refnos.size}/hash ${missingMesh404GeoHashes.size}，无几何 ${missingNoGeoRows.size}）`;
          publishShowDbnumLoadResult({
            status: loadedObjects === 0 ? 'empty' : budgetLimited ? 'partial' : 'loaded',
            refnoCount: allRefnos.length,
            loadedRefnos,
            skippedRefnos,
            loadedObjects,
            missingRefnos,
            mesh404Refnos: missingMesh404Refnos.size,
            mesh404GeoHashes: missingMesh404GeoHashes.size,
            noGeoRowsRefnos: missingNoGeoRows.size,
            layerCount: getShowDbnumAllLayers(dtxLayer).length,
            loadedTriangles,
            budgetLimited,
            summary,
          });
          if (loadedObjects === 0) {
            emitToast({
              message: `[警告] 加载结束但未绘制实例。${summary}`,
              level: 'warning',
            });
          } else if (budgetLimited) {
            emitToast({
              message: `[提示] ${summary}。请从模型树按需加载；诊断全量加载可加 show_dbnum_full=1。`,
              level: 'warning',
            });
          } else {
            emitToast({ message: `[成功] ${summary}`, level: 'success' });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          publishShowDbnumLoadResult({ status: 'error', error: msg });
          console.error('[ViewerPanel] show_dbnum Parquet 加载失败:', e);
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

        // 3. 加载实例到 DTX（data_source=json|parquet|backend；未指定则 parquet 可用时优先，否则 json）
        const urlDataSource = new URLSearchParams(window.location.search).get('data_source');
        const normalizedSource = String(urlDataSource || '').trim().toLowerCase();
        let ds: 'json' | 'parquet' | 'backend' = 'json';
        if (normalizedSource === 'json' || normalizedSource === 'parquet' || normalizedSource === 'backend') {
          ds = normalizedSource;
        } else {
          try {
            const { useDbnoInstancesParquetLoader } = await import('@/composables/useDbnoInstancesParquetLoader');
            ds = (await useDbnoInstancesParquetLoader().isParquetAvailable(dbno)) ? 'parquet' : 'json';
          } catch {
            ds = 'json';
          }
        }
        console.log(`[debug_refno] dataSource=${ds}`);
        const result = await loadDbnoInstancesForVisibleRefnosDtx(
          dtxLayer,
          dbno,
          refnos,
          {
            lodAssetKey: 'L1',
            debug: true,
            dataSource: ds,
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
    const versionDbnum = Number((detail as any)?.dbnum);
    const versionSesno = Number((detail as any)?.sesno);
    const loadUnitVersion = Number.isInteger(versionDbnum)
      && versionDbnum > 0
      && Number.isInteger(versionSesno)
      && versionSesno > 0;
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
          const ok = loadUnitVersion
            ? await mg.showModelUnitVersion(r, versionDbnum, versionSesno, {
              flyTo: flyTo && unique.length === 1,
            })
            : await mg.showModelByRefno(r, {
              flyTo: flyTo && unique.length === 1,
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

  const handleIncrementalCompare = (ev: Event) => {
    applyIncrementalCompareState((ev as CustomEvent).detail);
  };
  window.addEventListener('plant3d:incremental-version-compare', handleIncrementalCompare);
  offIncrementalCompare = () =>
    window.removeEventListener(
      'plant3d:incremental-version-compare',
      handleIncrementalCompare,
    );

  window.addEventListener(MODEL_UNIT_VERSION_COMPARE_EVENT, handleModelUnitVersionCompare);
  offModelUnitVersionCompare = () =>
    window.removeEventListener(MODEL_UNIT_VERSION_COMPARE_EVENT, handleModelUnitVersionCompare);

  async function loadChildPtsetEntries(parquetLoader: ReturnType<typeof useDbnoInstancesParquetLoader>, dbno: number, ownerRefno: string) {
    const summaries = await queryDirectChildrenPtsetSummaryWithRuntimeFallback(parquetLoader, dbno, ownerRefno);
    const candidates = summaries.filter((item) => item.success && item.ptCount > 0);
    const loaded: { refno: string; response: PtsetResponse }[] = [];

    for (const item of candidates) {
      const resp = await queryPtsetWithRuntimeFallback(parquetLoader, dbno, item.refno);
      if (resp.success && resp.ptset.length > 0) {
        loaded.push({ refno: item.refno, response: resp });
      }
    }

    return { summaries, loaded };
  }

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

        const parquetLoader = useDbnoInstancesParquetLoader();
        const response = await queryPtsetWithRuntimeFallback(parquetLoader, dbno, refnoKey);
        if (response.success && response.ptset.length > 0) {
          renderPtsetEntries(refnoKey, [{ refno: refnoKey, response }]);
          emitToast({
            message: `已显示 ${response.ptset.length} 个连接点`,
          });
        } else {
          const fallback = await loadChildPtsetEntries(parquetLoader, dbno, refnoKey);
          if (fallback.loaded.length > 0) {
            renderPtsetEntries(refnoKey, fallback.loaded);
            const pointCount = fallback.loaded.reduce((sum, item) => sum + item.response.ptset.length, 0);
            emitToast({
              message: `当前构件自身无 ptset，已显示 ${fallback.loaded.length} 个子元件 ${pointCount} 个连接点`,
            });
          } else {
            const childErrors = fallback.summaries
              .map((item) => item.errorMessage)
              .filter(Boolean);
            const errorMsg = response.error_message || childErrors[0] || '未找到点集数据';
            emitToast({ message: errorMsg });
            console.warn('[ptset]', errorMsg);
          }
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
  mbdExternalSync.invalidate();
  dimensionInitializationVersion += 1;
  dimensionSystem?.dispose();
  dimensionSystem = null;
  stopLocalDimensionAutosave();
  offDimensionReviewBinding?.();
  offDimensionReviewBinding = null;
  viewerContext.dimensionSystem.value = null;
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

  offIncrementalCompare?.();
  offIncrementalCompare = null;
  clearIncrementalCompareProxy();

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
    <canvas v-if="dimensionDevEnabled"
      ref="dimensionOverlayCanvas"
      class="dimension-viewport-overlay"
      aria-hidden="true" />
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
        <span class="relative inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
          <EyeOff class="h-5 w-5" />
          <span class="absolute -bottom-1 -right-1 rounded-[3px] border border-background bg-foreground px-[2px] text-[6px] font-bold leading-[8px] tracking-[0.02em] text-background">
            ALL
          </span>
        </span>
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

    <div v-if="modelUnitCompareState"
      class="pointer-events-auto absolute right-3 top-3 w-[320px] max-w-[calc(100%-1.5rem)] rounded-lg border border-indigo-200 bg-background/95 p-3 text-sm text-foreground shadow-lg backdrop-blur"
      style="z-index: 957"
      data-testid="viewer-model-unit-version-compare-overlay"
      @pointerdown.stop
      @wheel.stop>
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <GitCompare class="h-4 w-4 shrink-0 text-indigo-600" />
            <div class="truncate font-semibold">最小交付单元版本对比</div>
          </div>
          <div class="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {{ modelUnitCompareState.detail.unitRefno }} · DB {{ modelUnitCompareState.detail.dbnum }}
          </div>
        </div>
        <button type="button"
          class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input bg-background hover:bg-muted"
          title="退出版本对比"
          @click="requestCloseModelUnitVersionCompare">
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div class="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-blue-700">
          <div class="font-semibold">A · sesno {{ modelUnitCompareState.detail.before.sesno }}</div>
          <div class="mt-0.5 text-[10px] opacity-75">artifact {{ modelUnitCompareState.detail.before.artifactSesno }}</div>
        </div>
        <div class="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-700">
          <div class="font-semibold">B · sesno {{ modelUnitCompareState.detail.after.sesno }}</div>
          <div class="mt-0.5 text-[10px] opacity-75">artifact {{ modelUnitCompareState.detail.after.artifactSesno }}</div>
        </div>
      </div>

      <div v-if="modelUnitCompareState.status === 'loading'" class="mt-2 text-xs text-muted-foreground">
        正在加载两个精确版本…
      </div>
      <div v-else-if="modelUnitCompareState.status === 'error'" class="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
        {{ modelUnitCompareState.error }}
      </div>
      <div v-else class="mt-2 text-[11px] text-muted-foreground">
        左侧蓝色为较早版本，右侧绿色为较新版本；在差异列表点击构件可联动聚焦。
      </div>
    </div>

    <div v-if="incrementalCompareState"
      class="pointer-events-auto absolute right-3 top-3 w-[300px] max-w-[calc(100%-1.5rem)] rounded-lg border border-blue-200 bg-background/95 p-2.5 text-sm text-foreground shadow-lg backdrop-blur"
      style="z-index: 956"
      data-testid="viewer-dtx-version-compare-overlay"
      @pointerdown.stop
      @wheel.stop>
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <GitCompare class="h-4 w-4 shrink-0 text-blue-700" />
            <div class="truncate font-semibold">增量版本对照</div>
          </div>
          <div class="mt-0.5 truncate text-xs text-muted-foreground">
            DB {{ incrementalCompareState.dbnum ?? '-' }} · {{ incrementalCompareState.fromSesno ?? '-' }} -> {{ incrementalCompareState.toSesno ?? '-' }}
          </div>
        </div>
        <button type="button"
          class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input bg-background hover:bg-muted"
          title="关闭"
          @click="closeIncrementalCompareOverlay">
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-2 flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
        <span class="min-w-0 truncate">当前 ViewerPanel DTX</span>
        <span class="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">真实 diff</span>
      </div>

      <div v-if="incrementalCompareSelectedModel" class="mt-2 rounded-md border border-blue-100 bg-blue-50/60 p-2 text-xs">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0 truncate font-mono">{{ incrementalCompareSelectedModel.refno }}</div>
          <div class="shrink-0 rounded px-2 py-0.5" :class="compareStatusClass(incrementalCompareSelectedModel.status)">
            {{ compareStatusLabel(incrementalCompareSelectedModel.status) }}
          </div>
        </div>
        <div class="mt-1 truncate text-[11px] text-muted-foreground">
          {{ versionStateLabel(incrementalCompareSelectedModel.beforeState) }} -> {{ versionStateLabel(incrementalCompareSelectedModel.afterState) }}
          · {{ incrementalCompareSelectedModel.category || '-' }}
        </div>
      </div>

      <div class="mt-2 flex gap-2">
        <select v-model="incrementalCompareSelectedRefno"
          class="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs">
          <option v-for="item in incrementalCompareModels" :key="item.refno" :value="item.refno">
            {{ item.refno }} · {{ compareStatusLabel(item.status) }}
          </option>
        </select>
        <button type="button"
          class="shrink-0 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          :disabled="!incrementalCompareSelectedRefno"
          @click="loadIncrementalCompareRefno(incrementalCompareSelectedRefno || '')">
          加载
        </button>
      </div>
    </div>

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

    <AnnotationOverlayBar v-if="toolsRef" :tools="toolsRef" />

    <MeasurementOverlayBar v-if="isXeokitMeasureMode && xeokitMeasurementToolsRef" :tools="xeokitMeasurementToolsRef" />

    <ReviewConfirmation />
  </div>
</template>
