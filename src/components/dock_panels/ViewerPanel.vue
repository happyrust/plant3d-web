<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { NavCubePlugin, Viewer } from '@xeokit/xeokit-sdk';
import { ArrowUpRight, Cloud, RectangleHorizontal, Trash2, X } from 'lucide-vue-next';

import { loadAiosPrepackBundle } from '@/aios-prepack-bundle-loader';
import ReviewConfirmation from '@/components/review/ReviewConfirmation.vue';
import { useToolStore } from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { useXeokitTools } from '@/composables/useXeokitTools';

const props = defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const mainCanvas = ref<HTMLCanvasElement>();
const cubeCanvas = ref<HTMLCanvasElement>();
const viewer = shallowRef<Viewer | null>(null);
const overlayContainer = ref<HTMLElement | null>(null);

const store = useToolStore();
const tools = useXeokitTools(viewer, overlayContainer, store);

const showAnnotationToolbar = computed(() => {
  const mode = store.toolMode.value;
  return mode === 'annotation' || mode === 'annotation_cloud' || mode === 'annotation_rect' || mode === 'annotation_obb';
});

const canDeleteActiveAnnotation = computed(() => {
  return !!(
    store.activeAnnotationId.value ||
    store.activeCloudAnnotationId.value ||
    store.activeRectAnnotationId.value ||
    store.activeObbAnnotationId.value
  );
});

function deleteActiveAnnotation() {
  const textId = store.activeAnnotationId.value;
  if (textId) {
    store.removeAnnotation(textId);
    return;
  }

  const cloudId = store.activeCloudAnnotationId.value;
  if (cloudId) {
    store.removeCloudAnnotation(cloudId);
    return;
  }

  const rectId = store.activeRectAnnotationId.value;
  if (rectId) {
    store.removeRectAnnotation(rectId);
    return;
  }

  const obbId = store.activeObbAnnotationId.value;
  if (obbId) {
    store.removeObbAnnotation(obbId);
  }
}

const ctx = useViewerContext();
ctx.store.value = store;
ctx.tools.value = tools;

let resizeObserver: ResizeObserver | null = null;

function applyWhiteBackground() {
  if (!viewer.value) return;
  (viewer.value.scene as unknown as { clearEachPass?: boolean }).clearEachPass = true;
  const gl = (viewer.value.scene as unknown as { canvas?: { gl?: WebGLRenderingContext } }).canvas?.gl;
  gl?.clearColor?.(1, 1, 1, 1);
  gl?.clear?.(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

function handleResize() {
  if (viewer.value && containerRef.value) {
    const sceneAny = viewer.value.scene as unknown as {
      canvas?: { canvas?: HTMLCanvasElement };
      glRedraw?: () => void;
    };
    const canvas = sceneAny.canvas?.canvas;
    if (!canvas) return;
    const rect = containerRef.value.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    sceneAny.glRedraw?.();
  }
}

onMounted(() => {
  if (!mainCanvas.value) return;

  viewer.value = new Viewer({
    canvasElement: mainCanvas.value,
    transparent: true,
  });

  // 设置为 Z-up 坐标系（CAD/BIM 标准）
  viewer.value.scene.camera.worldAxis = [
    1, 0, 0,  // Right (+X)
    0, 0, 1,  // Up (+Z)
    0,-1, 0   // Forward (-Y)
  ];

  applyWhiteBackground();

  ctx.viewerRef.value = viewer.value;
  ctx.overlayContainerRef.value = overlayContainer.value;

  if (import.meta.env.DEV) {
    (window as unknown as { __xeokitViewer?: Viewer | null }).__xeokitViewer = viewer.value;
  }

  const cameraControl = viewer.value.cameraControl;
  const scene = viewer.value.scene;
  const cameraFlight = viewer.value.cameraFlight;

  cameraControl.followPointer = true;
  cameraFlight.duration = 1.0;
  cameraFlight.fitFOV = 25;

  scene.camera.eye = [-37.1356047775136, 13.019223731456176, 58.51748229729708];
  scene.camera.look = [-21.930914776596467, 1.3515918520952024, 29.454670463302506];
  scene.camera.up = [0, 0, 1];

  new NavCubePlugin(viewer.value, {
    canvasElement: cubeCanvas.value,
    color: '#fff',
    visible: true,
  });

  loadAiosPrepackBundle(viewer.value, {
    baseUrl: `${import.meta.env.BASE_URL}bundles/all/`,
    modelId: 'all',
    lodAssetKey: 'L1',
    edges: true,
    debug: true,
  })
    .then(() => {
      applyWhiteBackground();
    })
    .catch((err) => {
      console.error(err);
    });

  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(containerRef.value);
  }

  handleResize();
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (viewer.value !== null) {
    viewer.value.destroy();
    viewer.value = null;
  }

  if (ctx.viewerRef.value) {
    ctx.viewerRef.value = null;
  }
  if (ctx.overlayContainerRef.value) {
    ctx.overlayContainerRef.value = null;
  }
  if (ctx.tools.value) {
    ctx.tools.value = null;
  }
  if (ctx.store.value) {
    ctx.store.value = null;
  }
});

watch(
  () => props.params,
  () => {
    handleResize();
  },
  { deep: true }
);
</script>

<template>
  <div ref="containerRef" class="viewer-panel-container">
    <canvas ref="mainCanvas" class="viewer" />
    <div ref="overlayContainer" class="xeokitOverlay" />
    <div v-if="showAnnotationToolbar"
      class="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-lg backdrop-blur"
      style="z-index: 940;"
      @pointerdown.stop
      @wheel.stop>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        :class="store.toolMode.value === 'annotation' ? 'bg-muted' : ''"
        title="箭头批注"
        @click.stop="store.setToolMode('annotation')">
        <ArrowUpRight class="h-5 w-5" />
      </button>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        :class="store.toolMode.value === 'annotation_cloud' ? 'bg-muted' : ''"
        title="云线批注"
        @click.stop="store.setToolMode('annotation_cloud')">
        <Cloud class="h-5 w-5" />
      </button>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        :class="store.toolMode.value === 'annotation_rect' ? 'bg-muted' : ''"
        title="矩形批注"
        @click.stop="store.setToolMode('annotation_rect')">
        <RectangleHorizontal class="h-5 w-5" />
      </button>
      <div class="mx-1 h-6 w-px bg-border" />
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background text-destructive hover:bg-muted disabled:opacity-50"
        title="删除选中批注"
        :disabled="!canDeleteActiveAnnotation"
        @click.stop="deleteActiveAnnotation">
        <Trash2 class="h-5 w-5" />
      </button>
      <button type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted"
        title="退出批注模式"
        @click.stop="store.setToolMode('none')">
        <X class="h-5 w-5" />
      </button>
    </div>
    <canvas ref="cubeCanvas" class="navCube" />
    <ReviewConfirmation />
  </div>
</template>
