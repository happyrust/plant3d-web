<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { Vector2 } from 'three';
import { ArrowUpRight, Cloud, RectangleHorizontal, Trash2, X } from 'lucide-vue-next';

import ReviewConfirmation from '@/components/review/ReviewConfirmation.vue';
import MeasurementWizard from '@/components/tools/MeasurementWizard.vue';
import { pdmsGetPtset } from '@/api/genModelPdmsAttrApi';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useDtxTools } from '@/composables/useDtxTools';
import { usePtsetVisualizationThree } from '@/composables/usePtsetVisualizationThree';
import { useToolStore } from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { onCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';

import { DtxViewer } from '@/viewer/dtx/DtxViewer';
import { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';

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
const selectionStore = useSelectionStore();
const viewerContext = useViewerContext();

const initError = ref<string | null>(null);

const isDev = import.meta.env.DEV;

const dtxViewerRef = shallowRef<DtxViewer | null>(null);
const dtxLayerRef = shallowRef<DTXLayer | null>(null);
const selectionControllerRef = shallowRef<DTXSelectionController | null>(null);
const compatViewerRef = shallowRef<DtxCompatViewer | null>(null);
const toolsRef = shallowRef<ReturnType<typeof useDtxTools> | null>(null);
const ptsetVisRef = shallowRef<ReturnType<typeof usePtsetVisualizationThree> | null>(null);

let attachedToScene = false;
let rafId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let offRibbonCommand: (() => void) | null = null;
let offToolsInput: (() => void) | null = null;
let offPtsetWatch: (() => void) | null = null;

function handleRibbonCommand(commandId: string) {
  switch (commandId) {
    case 'measurement.distance':
      store.setToolMode('measure_distance');
      return;
    case 'measurement.angle':
      store.setToolMode('measure_angle');
      return;
    case 'measurement.point_to_mesh':
      store.setToolMode('measure_point_to_object');
      return;
    case 'measurement.clear':
      store.clearMeasurements();
      return;
    case 'annotation.create':
      store.setToolMode('annotation');
      return;
    case 'tools.clear_all':
      store.clearAll();
      ptsetVisRef.value?.clearAll();
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

  const onClick = (e: PointerEvent) => {
    // 工具模式开启时，点击事件交给 tools（阶段 1 后续接入）
    if (store.toolMode.value && store.toolMode.value !== 'none') return;

    const rect = canvas.getBoundingClientRect();
    const pos = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const hit = sel.pick(pos);

    // 清空旧选中
    const prev = compat.scene.selectedObjectIds;
    if (prev.length > 0) {
      compat.scene.setObjectsSelected(prev, false);
    }

    if (!hit) {
      selectionStore.clearSelection();
      return;
    }

    const refno = parseRefnoFromObjectId(hit.objectId);
    if (!refno) return;

    selectionStore.setSelectedRefno(refno);
    compat.scene.ensureRefnos([refno]);
    compat.scene.setObjectsSelected([refno], true);
  };

  canvas.addEventListener('pointerup', onClick);
  (attachPicking as any)._cleanup = () => canvas.removeEventListener('pointerup', onClick);
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

  const onDown = (e: PointerEvent) => tools.onCanvasPointerDown(canvas, e);
  const onMove = (e: PointerEvent) => tools.onCanvasPointerMove(canvas, e);
  const onUp = (e: PointerEvent) => tools.onCanvasPointerUp(canvas, e);
  const onCancel = (e: PointerEvent) => tools.onCanvasPointerCancel(canvas, e);

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

function handleResize() {
  const el = containerRef.value;
  const dtxViewer = dtxViewerRef.value;
  if (!el || !dtxViewer) return;
  const rect = el.getBoundingClientRect();
  dtxViewer.setSize(rect.width, rect.height);
}

function startRenderLoop() {
  const tick = () => {
    rafId = window.requestAnimationFrame(tick);

    const dtxViewer = dtxViewerRef.value;
    const dtxLayer = dtxLayerRef.value;
    if (!dtxViewer || !dtxLayer) return;

    dtxViewer.controls.update();
    dtxLayer.update(dtxViewer.camera);
    dtxViewer.renderer.render(dtxViewer.scene, dtxViewer.camera);
    toolsRef.value?.updateOverlayPositions();
    ptsetVisRef.value?.updateLabelPositions();
  };

  rafId = window.requestAnimationFrame(tick);
}

function stopRenderLoop() {
  if (rafId === null) return;
  window.cancelAnimationFrame(rafId);
  rafId = null;
}

const showAnnotationToolbar = computed(() => {
  const mode = store.toolMode.value;
  return mode === 'annotation' || mode === 'annotation_cloud' || mode === 'annotation_rect' || mode === 'annotation_obb';
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

onMounted(() => {
  const canvas = mainCanvas.value;
  const container = containerRef.value;
  if (!canvas || !container) return;

  initError.value = null;

  let dtxViewer: DtxViewer;
  try {
    dtxViewer = new DtxViewer({ canvas, background: 0xe5e7eb, debug: isDev });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    initError.value = msg;
    emitToast({ message: msg });
    return;
  }
  dtxViewerRef.value = dtxViewer;

  const dtxLayer = new DTXLayer({ renderer: dtxViewer.renderer, debug: isDev });
  dtxLayer.setRenderer(dtxViewer.renderer);
  dtxLayerRef.value = dtxLayer;

  const selectionController = new DTXSelectionController({
    dtxLayer,
    scene: dtxViewer.scene,
    camera: dtxViewer.camera,
    renderer: dtxViewer.renderer,
    container: canvas,
    enableOutline: false,
  });
  selectionControllerRef.value = selectionController;

  const compat = new DtxCompatViewer({ dtxViewer, dtxLayer, selection: selectionController });
  // 让 useModelGeneration 能识别 DTX 后端
  (compat as any).__dtxLayer = dtxLayer;
  (compat as any).__dtxAfterInstancesLoaded = (_dbno: number, loadedRefnos: string[]) => {
    compat.scene.ensureRefnos(loadedRefnos);
    ensureLayerAttached();
    selectionController.refreshSpatialIndex();
  };
  compatViewerRef.value = compat;

  if (isDev) {
    (window as any).__xeokitViewer = compat;
    (window as any).__dtxViewer = dtxViewer;
  }

  const tools = useDtxTools({
    dtxViewerRef,
    dtxLayerRef,
    selectionRef: selectionControllerRef,
    overlayContainerRef: overlayContainer,
    store,
    compatViewerRef,
  });
  toolsRef.value = tools;

  const ptsetVis = usePtsetVisualizationThree(dtxViewerRef, overlayContainer);
  ptsetVisRef.value = ptsetVis;
  viewerContext.ptsetVis.value = ptsetVis as any;

  viewerContext.viewerRef.value = compat as any;
  viewerContext.overlayContainerRef.value = overlayContainer.value;
  viewerContext.store.value = store;
  viewerContext.tools.value = tools as any;

  offPtsetWatch = watch(
    () => store.ptsetVisualizationRequest.value,
    async (request) => {
      if (!request) return;

      try {
        emitToast({ message: `正在加载点集数据: ${request.refno}` });
        const response = await pdmsGetPtset(request.refno);
        if (response.success && response.ptset.length > 0) {
          ptsetVis.renderPtset(request.refno, response);
          ptsetVis.flyToPtset();
          emitToast({ message: `已显示 ${response.ptset.length} 个连接点` });
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
    { immediate: true }
  );

  offRibbonCommand = onCommand(handleRibbonCommand);

  resizeObserver = new ResizeObserver(() => handleResize());
  resizeObserver.observe(container);
  handleResize();

  attachPicking();
  attachToolsInput();
  startRenderLoop();
});

onUnmounted(() => {
  stopRenderLoop();
  detachPicking();
  detachToolsInput();

  offPtsetWatch?.();
  offPtsetWatch = null;

  try {
    ptsetVisRef.value?.clearAll();
  } catch {
    // ignore
  }
  ptsetVisRef.value = null;

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

  try {
    selectionControllerRef.value?.dispose();
  } catch {
    // ignore
  }
  selectionControllerRef.value = null;

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
});
</script>

<template>
  <div ref="containerRef" class="viewer-panel-container">
    <canvas ref="mainCanvas" class="viewer" />
    <div ref="overlayContainer" class="xeokitOverlay" />

    <div
      v-if="initError"
      class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur"
      style="z-index: 950;"
    >
      <div class="max-w-[520px] rounded-lg border border-border bg-background p-4 text-sm shadow">
        <div class="font-medium text-destructive">3D Viewer 初始化失败</div>
        <div class="mt-2 text-muted-foreground">{{ initError }}</div>
      </div>
    </div>

    <MeasurementWizard
      v-if="store.toolMode.value === 'measure_point_to_object' && toolsRef"
      :status-text="toolsRef.statusText.value"
      style="position: absolute; top: 12px; left: 12px; z-index: 940;"
      @pointerdown.stop
      @wheel.stop
    />

    <div
      v-if="showAnnotationToolbar"
      class="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-lg backdrop-blur"
      style="z-index: 940;"
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
        :class="store.toolMode.value === 'annotation_cloud' ? 'bg-muted' : ''"
        title="云线批注"
        @click.stop="store.setToolMode('annotation_cloud')"
      >
        <Cloud class="h-5 w-5" />
      </button>
      <button
        type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        :class="store.toolMode.value === 'annotation_rect' ? 'bg-muted' : ''"
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
