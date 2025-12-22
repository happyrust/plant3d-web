<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { NavCubePlugin, Viewer, stats as xeokitStats } from '@xeokit/xeokit-sdk';
import { ArrowUpRight, Cloud, RectangleHorizontal, Trash2, X } from 'lucide-vue-next';

import type { ModelProject } from '@/composables/useModelProjects';

import { loadAiosPrepackBundle } from '@/aios-prepack-bundle-loader';
import { pdmsGetPtset } from '@/api/genModelPdmsAttrApi';
import ReviewConfirmation from '@/components/review/ReviewConfirmation.vue';
import PtsetPanel from '@/components/tools/PtsetPanel.vue';
import { usePtsetVisualization } from '@/composables/usePtsetVisualization';
import { useToolStore } from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { useXeokitTools } from '@/composables/useXeokitTools';
import MeasurementWizard from '@/components/tools/MeasurementWizard.vue';
import { onCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';
import { dockActivatePanelIfExists } from '@/composables/useDockApi';

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

const isDev = import.meta.env.DEV;

type XeokitStatsSnapshot = {
  components: {
    scenes: number;
    models: number;
    meshes: number;
    objects: number;
  };
  frame: {
    frameCount: number;
    fps: number;
    drawElements: number;
    drawArrays: number;
    tasksRun: number;
    tasksScheduled: number;
  };
};

const showStats = ref(false);
const statsSnapshot = ref<XeokitStatsSnapshot | null>(null);
const runtimeSnapshot = ref<{
  sceneObjectsCount: number;
  sceneVisibleObjectsCount: number;
  cameraNear?: number;
  cameraFar?: number;
  lazy?: {
    lazyRefnoCount: number;
    createdEntityCount: number;
    meshCfgCount: number;
    geometryCount: number;
  };
} | null>(null);
let statsTimer: number | null = null;
let offRibbonCommand: (() => void) | null = null;

function handleRibbonCommand(commandId: string) {
  switch (commandId) {
    case 'measurement.distance':
      store.setToolMode('measure_distance');
      return;
    case 'measurement.angle':
      store.setToolMode('measure_angle');
      return;
    case 'measurement.point_to_mesh':
      // Ensure panel is active if needed, but tool mode is key
      store.setToolMode('measure_point_to_object');
      return;
    case 'measurement.clear':
      store.clearMeasurements();
      return;
    case 'annotation.create':
       store.setToolMode('annotation');
       return;
  }
}

type LazyEntityManagerLike = {
  hasRefno?: (refno: string) => boolean;
  debugEntity?: (refno: string) => unknown;
  showEntity?: (refno: string) => boolean;
  showEntities?: (refnos: string[]) => number;
  isEntityCreated?: (refno: string) => boolean;
  isEntityVisible?: (refno: string) => boolean;
  getAllRefnos?: () => string[];
  getDebugStats?: () => {
    lazyRefnoCount: number;
    createdEntityCount: number;
    meshCfgCount: number;
    geometryCount: number;
  };
};

function getAutoDebugConfig(): { enabled: boolean; refno: string; prefix: string | null; limit: number } {
  if (!isDev) return { enabled: false, refno: '17496_266204', prefix: null, limit: 30 };
  try {
    const params = new URLSearchParams(window.location.search);
    const enabled = params.get('debugAuto') === '1';
    const refno = params.get('debugRefno') || '17496_266204';
    const prefix = params.get('debugPrefix');
    const limitRaw = params.get('debugLimit');
    const limit = Math.max(1, Math.min(200, limitRaw ? Number(limitRaw) : 30));
    return { enabled, refno, prefix, limit: Number.isFinite(limit) ? limit : 30 };
  } catch {
    return { enabled: false, refno: '17496_266204', prefix: null, limit: 30 };
  }
}

function autoDebugBatch(v: Viewer, mgr: LazyEntityManagerLike, prefix: string, limit: number, reason: string) {
  const tag = '[aios-auto-debug]';
  try {
    const all = mgr.getAllRefnos?.() || [];
    const targets = all.filter((id) => id.startsWith(prefix)).slice(0, limit);
    const { drawElements: de0, drawArrays: da0, frameCount: fc0 } = xeokitStats.frame;

    console.log(tag, 'batch start', {
      reason,
      prefix,
      limit,
      selected: targets.length,
      before: { drawElements: de0, drawArrays: da0, frameCount: fc0 },
    });

    const created = mgr.showEntities ? mgr.showEntities(targets) : targets.reduce((acc, r) => acc + (mgr.showEntity?.(r) ? 1 : 0), 0);
    console.log(tag, 'batch showEntities', { created, requested: targets.length });

    try {
      const aabb = v.scene.getAABB(targets);
      if (aabb && aabb.length === 6 && Array.from(aabb).every((n) => Number.isFinite(n))) {
        const [xmin, ymin, zmin, xmax, ymax, zmax] = aabb as [number, number, number, number, number, number];
        if (xmin <= xmax && ymin <= ymax && zmin <= zmax) {
          const dx = xmax - xmin;
          const dy = ymax - ymin;
          const dz = zmax - zmin;
          const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (diag > 0 && Number.isFinite(diag)) {
            try {
              const near = Math.max(0.1, diag / 1000);
              const far = Math.max(10000, diag * 10);
              v.scene.camera.perspective.near = near;
              v.scene.camera.perspective.far = far;
            } catch {
              // ignore
            }
          }
        }
      }
      v.cameraFlight.flyTo({ aabb, fit: true, duration: 1.0 });
    } catch {
      // ignore
    }

    window.setTimeout(() => {
      const { drawElements: de1, drawArrays: da1, frameCount: fc1 } = xeokitStats.frame;
      console.log(tag, 'batch after 800ms', {
        prefix,
        selected: targets.length,
        after: { drawElements: de1, drawArrays: da1, frameCount: fc1 },
        delta: { drawElements: de1 - de0, drawArrays: da1 - da0, frameCount: fc1 - fc0 },
      });
    }, 800);
  } catch (e) {
    console.log('[aios-auto-debug] batch error', { err: e instanceof Error ? e.message : String(e) });
  }
}

function autoDebugRefno(v: Viewer, refno: string, reason: string) {
  const tag = '[aios-auto-debug]';
  try {
    const sceneAny = v.scene as unknown as {
      __aiosLazyEntityManagers?: Record<string, LazyEntityManagerLike>;
      __aiosActiveLazyModelId?: string;
      objects?: Record<string, { visible?: boolean }>;
      glRedraw?: () => void;
    };

    const { drawElements: de0, drawArrays: da0, frameCount: fc0 } = xeokitStats.frame;
    console.log(tag, 'start', { reason, refno, before: { drawElements: de0, drawArrays: da0, frameCount: fc0 } });

    const managers = sceneAny.__aiosLazyEntityManagers;
    if (!managers) {
      console.log(tag, 'no __aiosLazyEntityManagers found on viewer.scene');
      return;
    }

    const activeId = sceneAny.__aiosActiveLazyModelId;
    let mgr: LazyEntityManagerLike | undefined = activeId ? managers[activeId] : undefined;
    if (mgr?.hasRefno && !mgr.hasRefno(refno)) {
      mgr = undefined;
    }
    if (!mgr) {
      for (const k of Object.keys(managers)) {
        const m = managers[k];
        if (m?.hasRefno?.(refno)) {
          mgr = m;
          break;
        }
      }
    }

    if (!mgr) {
      const parts = refno.split(/[^0-9A-Za-z]+/).filter(Boolean);
      const candidates = Object.keys(sceneAny.objects || {}).filter((id) => parts.some((p) => id.includes(p))).slice(0, 20);
      console.log(tag, 'no manager for refno', { refno, parts, candidates });
      return;
    }

    const before = mgr.debugEntity?.(refno);
    console.log(tag, 'debugEntity(before)', before);

    const ok = mgr.showEntity?.(refno) === true;
    console.log(tag, 'showEntity', {
      refno,
      ok,
      created: mgr.isEntityCreated?.(refno),
      visible: mgr.isEntityVisible?.(refno),
      sceneVisible: sceneAny.objects?.[refno]?.visible,
    });

    const after = mgr.debugEntity?.(refno);
    console.log(tag, 'debugEntity(after)', after);

    try {
      const aabb = v.scene.getAABB([refno]);
      const diag = (() => {
        if (!aabb || aabb.length !== 6) return null;
        const [xmin, ymin, zmin, xmax, ymax, zmax] = aabb as [number, number, number, number, number, number];
        const dx = xmax - xmin;
        const dy = ymax - ymin;
        const dz = zmax - zmin;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      })();
      console.log(tag, 'aabb', { refno, aabb: aabb ? Array.from(aabb) : aabb, diag });

      if (ok && aabb && aabb.length === 6 && diag && Number.isFinite(diag) && diag > 0) {
        try {
          const near = Math.max(0.1, diag / 1000);
          const far = Math.max(10000, diag * 10);
          v.scene.camera.perspective.near = near;
          v.scene.camera.perspective.far = far;
        } catch {
          // ignore
        }
        v.cameraFlight.flyTo({ aabb, fit: true, duration: 1.0 });
      }
    } catch (e) {
      console.log(tag, 'getAABB failed', { refno, err: e instanceof Error ? e.message : String(e) });
    }

    try {
      const camAny = v.scene.camera as unknown as {
        eye?: number[];
        look?: number[];
        up?: number[];
        perspective?: { near?: number; far?: number };
      };
      console.log(tag, 'camera', {
        eye: camAny.eye,
        look: camAny.look,
        up: camAny.up,
        near: camAny.perspective?.near,
        far: camAny.perspective?.far,
      });
    } catch {
      // ignore
    }

    try {
      sceneAny.glRedraw?.();
    } catch {
      // ignore
    }

    window.setTimeout(() => {
      const { drawElements: de1, drawArrays: da1, frameCount: fc1 } = xeokitStats.frame;
      console.log(tag, 'after 500ms', {
        refno,
        after: { drawElements: de1, drawArrays: da1, frameCount: fc1 },
        delta: { drawElements: de1 - de0, drawArrays: da1 - da0, frameCount: fc1 - fc0 },
      });
    }, 500);
  } catch (e) {
    console.log('[aios-auto-debug] error', { refno, err: e instanceof Error ? e.message : String(e) });
  }
}

function maybeAutoDebug(v: Viewer, reason: string) {
  const cfg = getAutoDebugConfig();
  if (!cfg.enabled) return;
  window.setTimeout(() => {
    const sceneAny = v.scene as unknown as {
      __aiosLazyEntityManagers?: Record<string, LazyEntityManagerLike>;
      __aiosActiveLazyModelId?: string;
    };
    const managers = sceneAny.__aiosLazyEntityManagers;
    const activeId = sceneAny.__aiosActiveLazyModelId;
    const mgr = (activeId && managers) ? managers[activeId] : undefined;

    if (cfg.prefix && mgr) {
      autoDebugBatch(v, mgr, cfg.prefix, cfg.limit, reason);
      return;
    }

    autoDebugRefno(v, cfg.refno, reason);
  }, 300); // Increased from 50ms to 300ms to allow lazy entities to be created
}


const store = useToolStore();
const tools = useXeokitTools(viewer, overlayContainer, store);
const ptsetVis = usePtsetVisualization(viewer, overlayContainer);


// 解析 URL 调试参数
function getDebugParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    refno: params.get('debug_refno'),
    ptset: params.get('debug_ptset'),
    bundleUrl: params.get('debug_bundle_url'),
    autoLocateRefno: params.get('auto_locate_refno'), // 新增：自动定位并显示的 refno
  };
}

// 处理 debug_ptset 参数
async function handleDebugPtset() {
  const debugParams = getDebugParams();
  if (!debugParams.ptset || !viewer.value) return;

  const ptsetRefno = debugParams.ptset;

  try {
    const response = await pdmsGetPtset(ptsetRefno);

    if (response.success && response.ptset.length > 0) {
      ptsetVis.renderPtset(ptsetRefno, response);
      ptsetVis.flyToPtset();
      showPtsetPanel.value = true;
    } else {
      const errorMsg = response.error_message || '未找到点集数据';
      console.warn('[ViewerPanel] debug_ptset:', errorMsg);
    }
  } catch (error) {
    console.error('[ViewerPanel] Failed to load ptset:', error);
  }
}

// 处理 auto_locate_refno 参数
function handleAutoLocateRefno() {
  const debugParams = getDebugParams();
  if (!debugParams.autoLocateRefno) return;

  console.log('[ViewerPanel] auto_locate_refno detected:', debugParams.autoLocateRefno);

  // 延迟执行，确保模型树已加载
  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('autoLocateRefno', {
        detail: { refno: debugParams.autoLocateRefno }
      })
    );
  }, 1000); // 给模型树足够时间初始化
}


// Ptset 面板状态
const showPtsetPanel = ref(false);

function handlePtsetPanelClose() {
  ptsetVis.clearAll();
  showPtsetPanel.value = false;
}

// 监听来自模型树右键菜单的 ptset 请求
watch(
  () => store.ptsetVisualizationRequest.value,
  async (request) => {
    if (!request || !viewer.value) return;

    const ptsetRefno = request.refno;

    try {
      const response = await pdmsGetPtset(ptsetRefno);

      if (response.success && response.ptset.length > 0) {
        ptsetVis.renderPtset(ptsetRefno, response);
        ptsetVis.flyToPtset();
        showPtsetPanel.value = true;
      } else {
        const errorMsg = response.error_message || '未找到点集数据';
        console.warn('[ViewerPanel] ptset request:', errorMsg);
      }
    } catch (error) {
      console.error('[ViewerPanel] Failed to load ptset:', error);
    } finally {
      store.clearPtsetVisualizationRequest();
    }
  }
);

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
  gl?.clearColor?.(0.96, 0.97, 0.98, 1);
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

// 监听项目切换事件
const handleProjectChange = (event: CustomEvent) => {
  const { project } = event.detail;
  if (viewer.value) {
    loadAiosPrepackBundle(viewer.value, {
      baseUrl: `${import.meta.env.BASE_URL}bundles/${project.path}/`,
      modelId: 'model',
      lodAssetKey: 'L1',
      edges: true,
      debug: true,
      lazyEntities: true,
    })
      .then(() => {
        applyWhiteBackground();
        if (viewer.value) {
          maybeAutoDebug(viewer.value, 'modelProjectChanged');
        }
      })
      .catch((err) => {
        console.error(err);
      });
  }
};

onMounted(() => {
  if (!offRibbonCommand) {
    offRibbonCommand = onCommand(handleRibbonCommand);
  }

  if (!mainCanvas.value) return;

  viewer.value = new Viewer({
    canvasElement: mainCanvas.value,
    transparent: false,
  });

  try {
    const edgeMat = viewer.value.scene.edgeMaterial;
    edgeMat.edges = true;
    edgeMat.edgeColor = [0.15, 0.18, 0.22];
    edgeMat.edgeAlpha = 0.35;
    edgeMat.edgeWidth = 1;
  } catch {
    // ignore
  }

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

  if (isDev) {
    const updateStats = () => {
      const s = xeokitStats;
      statsSnapshot.value = {
        components: {
          scenes: s.components.scenes,
          models: s.components.models,
          meshes: s.components.meshes,
          objects: s.components.objects,
        },
        frame: {
          frameCount: s.frame.frameCount,
          fps: s.frame.fps,
          drawElements: s.frame.drawElements,
          drawArrays: s.frame.drawArrays,
          tasksRun: s.frame.tasksRun,
          tasksScheduled: s.frame.tasksScheduled,
        },
      };

      const v = viewer.value;
      if (v) {
        const sceneAny = v.scene as unknown as {
          objects?: Record<string, unknown>;
          visibleObjects?: Record<string, unknown>;
          __aiosLazyEntityManagers?: Record<string, LazyEntityManagerLike>;
          __aiosActiveLazyModelId?: string;
        };
        const camAny = v.scene.camera as unknown as { perspective?: { near?: number; far?: number } };

        const activeId = sceneAny.__aiosActiveLazyModelId;
        const lazyMgr = (activeId && sceneAny.__aiosLazyEntityManagers)
          ? sceneAny.__aiosLazyEntityManagers[activeId]
          : undefined;

        runtimeSnapshot.value = {
          sceneObjectsCount: sceneAny.objects ? Object.keys(sceneAny.objects).length : 0,
          sceneVisibleObjectsCount: sceneAny.visibleObjects ? Object.keys(sceneAny.visibleObjects).length : 0,
          cameraNear: camAny.perspective?.near,
          cameraFar: camAny.perspective?.far,
          lazy: lazyMgr?.getDebugStats ? lazyMgr.getDebugStats() : undefined,
        };
      }
    };

    updateStats();
    statsTimer = window.setInterval(updateStats, 200);
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
  
  window.addEventListener('modelProjectChanged', handleProjectChange as EventListener);
  
  // 尝试加载默认项目
  const debugParams = getDebugParams();
  if (debugParams.bundleUrl) {
    if (viewer.value) {
      // 使用用户指定的 bundleUrl,不要覆盖它
      const effectiveBundleUrl = debugParams.bundleUrl;

      console.log('Using debug params:', { debugParams, effectiveBundleUrl });

      loadAiosPrepackBundle(viewer.value, {
        baseUrl: effectiveBundleUrl,
        modelId: 'model',
        lodAssetKey: 'L1',
        edges: true,
        debug: true,
        lazyEntities: true,
        refnos: debugParams.refno || undefined,
      })
      .then(() => {
        applyWhiteBackground();
        if (viewer.value) {
          maybeAutoDebug(viewer.value, 'debugParams');
        }
        // 处理 debug_ptset 参数
        setTimeout(() => handleDebugPtset(), 500);
        // 处理 auto_locate_refno 参数
        handleAutoLocateRefno();
      })
      .catch((err) => {
        console.error('Failed to load model from debug params:', err);
      });
    }
  } else {
  fetch(`${import.meta.env.BASE_URL}bundles/projects.json`)
    .then(response => {
      if (!response.ok) throw new Error('Failed to load projects');
      return response.json();
    })
    .then((projects: ModelProject[]) => {
      const defaultProject = projects.find(p => p.default) || projects[0];
      if (defaultProject && viewer.value) {
        loadAiosPrepackBundle(viewer.value, {
          baseUrl: `${import.meta.env.BASE_URL}bundles/${defaultProject.path}/`,
          modelId: 'model',
          lodAssetKey: 'L1',
          edges: true,
          debug: true,
          lazyEntities: true,
        })
          .then(() => {
            applyWhiteBackground();
            if (viewer.value) {
              maybeAutoDebug(viewer.value, 'defaultProject');
            }
            // 处理 debug_ptset 参数
            setTimeout(() => handleDebugPtset(), 500);
            // 处理 auto_locate_refno 参数
            handleAutoLocateRefno();
          })
          .catch((err) => {
            console.error(err);
          });
      }
    })

    .catch(() => {
      // Fallback to ams-model
      if (viewer.value) {
        loadAiosPrepackBundle(viewer.value, {
          baseUrl: `${import.meta.env.BASE_URL}bundles/ams-model/`,
          modelId: 'model',
          lodAssetKey: 'L1',
          edges: true,
          debug: true,
          lazyEntities: true,
        })
          .then(() => {
            applyWhiteBackground();
            if (viewer.value) {
              maybeAutoDebug(viewer.value, 'fallbackAmsModel');
            }
            // 处理 debug_ptset 参数
            setTimeout(() => handleDebugPtset(), 500);
            // 处理 auto_locate_refno 参数
            handleAutoLocateRefno();
          })
          .catch((err) => {
            console.error(err);
          });
      }
    });
  }

  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(containerRef.value);
  }

  handleResize();
});

onUnmounted(() => {
  if (statsTimer !== null) {
    window.clearInterval(statsTimer);
    statsTimer = null;
  }
  if (offRibbonCommand) {
    offRibbonCommand();
    offRibbonCommand = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  window.removeEventListener('modelProjectChanged', handleProjectChange as EventListener);
  if (viewer.value !== null) {
    viewer.value.destroy();
  }
  viewer.value = null;

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
    
    <MeasurementWizard
      v-if="store.toolMode.value === 'measure_point_to_object'"
      :status-text="tools.statusText.value"
    />

    <div v-if="isDev" style="position: absolute; top: 8px; right: 8px; z-index: 2000; pointer-events: auto;">
      <button type="button" class="pointer-events-auto rounded-md border border-white/20 bg-black/70 px-2 py-1 text-xs text-white" @click.stop="showStats = !showStats">{{ showStats ? 'Hide Stats' : 'Show Stats' }}</button>
    </div>


    <div v-if="isDev && showStats" class="pointer-events-auto" style="position: absolute; top: 40px; right: 8px; z-index: 2000; width: 260px; background: rgba(0,0,0,0.70); color: #fff; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 10px; font-size: 12px; line-height: 1.4;">
      <div style="font-weight: 600; margin-bottom: 6px;">xeokit stats</div>
      <div v-if="statsSnapshot">
        <div><strong>fps</strong>: {{ statsSnapshot.frame.fps }}</div>
        <div><strong>frame</strong>: {{ statsSnapshot.frame.frameCount }}</div>
        <div><strong>drawElements</strong>: {{ statsSnapshot.frame.drawElements }}</div>
        <div><strong>drawArrays</strong>: {{ statsSnapshot.frame.drawArrays }}</div>
        <div><strong>tasks</strong>: {{ statsSnapshot.frame.tasksRun }} / {{ statsSnapshot.frame.tasksScheduled }}</div>
        <div style="margin-top: 6px;"><strong>models</strong>: {{ statsSnapshot.components.models }}</div>
        <div><strong>objects</strong>: {{ statsSnapshot.components.objects }}</div>
        <div><strong>meshes</strong>: {{ statsSnapshot.components.meshes }}</div>
      </div>
      <div v-else>stats unavailable</div>

      <div v-if="runtimeSnapshot" style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 8px;">
        <div style="font-weight: 600; margin-bottom: 6px;">runtime</div>
        <div><strong>scene.objects</strong>: {{ runtimeSnapshot.sceneObjectsCount }}</div>
        <div><strong>visibleObjects</strong>: {{ runtimeSnapshot.sceneVisibleObjectsCount }}</div>
        <div><strong>near</strong>: {{ runtimeSnapshot.cameraNear }}</div>
        <div><strong>far</strong>: {{ runtimeSnapshot.cameraFar }}</div>
        <div v-if="runtimeSnapshot.lazy" style="margin-top: 6px;">
          <div><strong>lazyRefnos</strong>: {{ runtimeSnapshot.lazy.lazyRefnoCount }}</div>
          <div><strong>createdEntities</strong>: {{ runtimeSnapshot.lazy.createdEntityCount }}</div>
          <div><strong>meshCfg</strong>: {{ runtimeSnapshot.lazy.meshCfgCount }}</div>
          <div><strong>geometries</strong>: {{ runtimeSnapshot.lazy.geometryCount }}</div>
        </div>
      </div>
    </div>

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

    <!-- Ptset 面板 -->
    <div
      v-if="showPtsetPanel || ptsetVis.currentRefno.value"
      class="pointer-events-auto absolute bottom-16 right-3 z-[950] max-h-[60vh] w-72 overflow-hidden rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur"
      @pointerdown.stop
      @wheel.stop
    >
      <PtsetPanel
        :refno="ptsetVis.currentRefno.value"
        :response="ptsetVis.currentResponse.value"
        :is-visible="ptsetVis.isVisible.value"
        :show-crosses="ptsetVis.showCrosses.value"
        :show-labels="ptsetVis.showLabels.value"
        :show-arrows="ptsetVis.showArrows.value"
        @close="handlePtsetPanelClose"
        @toggle-visible="ptsetVis.setVisible"
        @toggle-crosses="ptsetVis.setCrossesVisible"
        @toggle-labels="ptsetVis.setLabelsVisible"
        @toggle-arrows="ptsetVis.setArrowsVisible"
        @fly-to="ptsetVis.flyToPtset"
      />
    </div>
  </div>
</template>
