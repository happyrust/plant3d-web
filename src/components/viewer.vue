<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

import { NavCubePlugin, Viewer } from '@xeokit/xeokit-sdk';

import { loadAiosPrepackBundle } from '../aios-prepack-bundle-loader';

import { pdmsGetPtset } from '@/api/genModelPdmsAttrApi';
import ModelProjectSelector from '@/components/model-project/ModelProjectSelector.vue';
import ModelTreePanel from '@/components/model-tree/ModelTreePanel.vue';
import AnnotationPanel from '@/components/tools/AnnotationPanel.vue';
import MeasurementPanel from '@/components/tools/MeasurementPanel.vue';
import MeasurementWizard from '@/components/tools/MeasurementWizard.vue';
import ToolManagerPanel from '@/components/tools/ToolManagerPanel.vue';
import { useModelProjects } from '@/composables/useModelProjects';
import { usePtsetVisualization } from '@/composables/usePtsetVisualization';
import { useToolStore } from '@/composables/useToolStore';
import { useXeokitTools } from '@/composables/useXeokitTools';
import { onCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';

// 解析 URL 调试参数
function getDebugParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    // debug_refno: 模型加载完成后自动选中并飞行到指定元件
    refno: params.get('debug_refno'),
    // debug_bundle_url: 指定加载特定位置的模型包
    bundleUrl: params.get('debug_bundle_url'),
    // debug_ptset: 模型加载完成后自动显示指定元件的点集
    ptset: params.get('debug_ptset'),
  };
}

const mainCanvas = ref<HTMLCanvasElement>();
const cubeCanvas = ref<HTMLCanvasElement>();
const viewer: Ref<Viewer | null> = ref(null);
const overlayContainer = ref<HTMLElement | null>(null);

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

const showStats = ref(import.meta.env.DEV);
const statsSnapshot = ref<XeokitStatsSnapshot | null>(null);
let statsTimer: number | null = null;

const store = useToolStore();
const tools = useXeokitTools(viewer, overlayContainer, store);
const modelProjects = useModelProjects();
const ptsetVis = usePtsetVisualization(viewer, overlayContainer);

let offRibbonCommand: (() => void) | null = null;
let offModelProjectChange: (() => void) | null = null;
let currentModel: unknown | null = null;

// 监听 ptset 可视化请求
watch(
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
  }
);

// 加载模型
async function loadModel(bundleUrl: string, refno?: string) {
  if (!viewer.value || !bundleUrl) return;

  try {
    // 清理当前模型
    if (currentModel) {
      viewer.value.scene.clear();
      currentModel = null;
    }

    // 清除 ptset 可视化
    ptsetVis.clearAll();

    // 如果有 refno，说明是 API 加载模式，强制使用 /files/meshes 作为 baseUrl
    // 并且传递 refnos 给 loader 以忽略 manifest.json
    const isApiMode = !!refno;
    const effectiveBundleUrl = isApiMode ? '/files/meshes/' : bundleUrl;

    // 加载新模型
    currentModel = await loadAiosPrepackBundle(viewer.value, {
      baseUrl: effectiveBundleUrl,
      modelId: 'model',
      lodAssetKey: 'L1',
      edges: true,
      debug: true,
      lazyEntities: true,
      refnos: refno,
    });

    emitToast({
      message: '模型加载成功'
    });

    // 处理调试参数
    const debugParams = getDebugParams();

    // 如果有 debug_refno 参数，自动选中并飞行到该元件
    if (debugParams.refno && viewer.value) {
      const refno = debugParams.refno;
      
      // 尝试通过 lazyManager 显示（如果是 lazy 模式，此时 entity 可能还没创建）
      if (currentModel.lazyEntityManager) {
        await currentModel.lazyEntityManager.showEntity(refno);
      }

      const entity = viewer.value.scene.objects[refno];
      if (entity) {
        // 选中元件
        entity.selected = true;
        // 飞行到元件
        viewer.value.cameraFlight.flyTo({ aabb: entity.aabb, duration: 0.8 });
        emitToast({ message: `已定位到元件: ${refno}` });
      } else {
        console.warn(`[debug] 未找到元件: ${refno}`);
      }
    }

    // 如果有 debug_ptset 参数，自动显示点集
    if (debugParams.ptset) {
      const ptsetRefno = debugParams.ptset;
      // 延迟执行以确保模型完全加载
      setTimeout(async () => {
        try {
          emitToast({ message: `正在加载点集数据: ${ptsetRefno}` });
          const response = await pdmsGetPtset(ptsetRefno);

          if (response.success && response.ptset.length > 0) {
            ptsetVis.renderPtset(ptsetRefno, response);
            ptsetVis.flyToPtset();
            emitToast({ message: `已显示 ${response.ptset.length} 个连接点` });
          } else {
            const errorMsg = response.error_message || '未找到点集数据';
            emitToast({ message: errorMsg });
            console.warn('[debug ptset]', errorMsg);
          }
        } catch (error) {
          console.error('[debug ptset] Failed to load ptset:', error);
          emitToast({ message: '加载点集数据失败' });
        }
      }, 500);
    }
  } catch (error) {
    console.error('Failed to load model:', error);
    emitToast({
      message: '模型加载失败'
    });
  }
}

function handleRibbonCommand(commandId: string) {
  switch (commandId) {
    case 'panel.tree':
      store.activeTab.value = 'tree';
      return;
    case 'panel.measurement':
      store.activeTab.value = 'measurement';
      return;
    case 'panel.annotation':
      store.activeTab.value = 'annotation';
      return;
    case 'panel.manager':
      store.activeTab.value = 'manager';
      return;

    case 'measurement.distance':
      store.activeTab.value = 'measurement';
      store.setToolMode('measure_distance');
      return;
    case 'measurement.angle':
      store.activeTab.value = 'measurement';
      store.setToolMode('measure_angle');
      return;
    case 'measurement.point_to_mesh':
      store.activeTab.value = 'measurement';
      store.setToolMode('measure_point_to_object');
      return;
    case 'measurement.clear':
      store.clearMeasurements();
      return;

    case 'annotation.create':
      store.activeTab.value = 'annotation';
      store.setToolMode('annotation');
      return;
    case 'annotation.clear':
      store.clearAnnotations();
      return;

    case 'tools.clear_all':
      store.clearAll();
      ptsetVis.clearAll();
      return;
      
    // Attribute display commands
    case 'view.attr.all':
      store.setAttributeDisplayMode('all');
      emitToast({ message: '切换到显示全部属性' });
      return;
    case 'view.attr.general':
      store.setAttributeDisplayMode('general');
      emitToast({ message: '切换到仅显示通用属性' });
      return;
    case 'view.attr.component':
      store.setAttributeDisplayMode('component');
      emitToast({ message: '切换到仅显示元件属性' });
      return;
    case 'view.attr.uda':
      store.setAttributeDisplayMode('uda');
      emitToast({ message: '切换到仅显示UDA属性' });
      return;
    case 'view.attr.normal':
      store.setCompareMode(false);
      emitToast({ message: '切换到完整显示模式' });
      return;
    case 'view.attr.diff':
      store.setCompareMode(true);
      emitToast({ message: '切换到差异对比模式' });
      return;
  }

  emitToast({ message: `TODO: ${commandId}` });
}

onMounted(() => {
  if (!offRibbonCommand) {
    offRibbonCommand = onCommand(handleRibbonCommand);
  }

  viewer.value = new Viewer({
    canvasElement: mainCanvas.value!,
    transparent: false,
    saoEnabled: true, // Enable SAO
  });

  try {
    const edgeMat = viewer.value.scene.edgeMaterial;
    edgeMat.edges = true;
    edgeMat.edgeColor = [0.0, 0.0, 0.0]; // Black edges
    edgeMat.edgeAlpha = 0.1; // Subtler edges
    edgeMat.edgeWidth = 1;

    // Configure SAO
    const sao = viewer.value.scene.sao;
    sao.enabled = true;
    sao.intensity = 0.25;
    sao.bias = 0.5;
    sao.scale = 1000.0;
    sao.minResolution = 0.0;
    sao.kernelRadius = 100;
    sao.maxOcclusion = 0.02;
    sao.blur = true;
    sao.numSamples = 10;
  } catch {
    // ignore
  }

  // 设置为 Z-up 坐标系（CAD/BIM 标准）
  viewer.value.scene.camera.worldAxis = [
    1, 0, 0,  // Right (+X)
    0, 0, 1,  // Up (+Z)
    0,-1, 0   // Forward (-Y)
  ];

  if (import.meta.env.DEV) {
    (window as unknown as { __xeokitViewer?: Viewer | null }).__xeokitViewer = viewer.value;
  }

  if (import.meta.env.DEV) {
    const updateStats = () => {
      const v = viewer.value;
      if (!v) return;
      const s = (v.scene as unknown as { stats?: XeokitStatsSnapshot }).stats;
      if (!s) return;
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

  // 监听项目切换事件
  const handleProjectChange = (event: CustomEvent) => {
    const { project } = event.detail;
    loadModel(`${import.meta.env.BASE_URL}bundles/${project.path}/`);
  };
  
  window.addEventListener('modelProjectChanged', handleProjectChange as EventListener);
  offModelProjectChange = () => {
    window.removeEventListener('modelProjectChanged', handleProjectChange as EventListener);
  };

  // 加载初始模型
  const debugParams = getDebugParams();
  if (debugParams.bundleUrl) {
    loadModel(debugParams.bundleUrl, debugParams.refno || undefined);
  } else if (modelProjects.currentBundleUrl.value) {
    loadModel(`${import.meta.env.BASE_URL}${modelProjects.currentBundleUrl.value.slice(1)}`);
  } else {
    // 等待项目加载完成后再加载模型
    const stopWatcher = watch(modelProjects.currentProject, () => {
      if (modelProjects.currentBundleUrl.value) {
        loadModel(`${import.meta.env.BASE_URL}${modelProjects.currentBundleUrl.value.slice(1)}`);
        stopWatcher();
      }
    });
  }

  // 注意：后备加载代码已移除，因为它会与正常的模型加载流程冲突
  // 模型加载通过 modelProjects.currentBundleUrl 或 modelProjectChanged 事件触发
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
  if (offModelProjectChange) {
    offModelProjectChange();
    offModelProjectChange = null;
  }
  if (viewer.value !== null) viewer.value.destroy();
});

</script>

<template>
  <v-navigation-drawer width="450" class="h-full">
    <nav class="treeViewContainer flex h-full flex-col">
      <!-- 模型项目选择器 -->
      <div class="p-3 border-b">
        <ModelProjectSelector />
      </div>
      
      <v-tabs v-model="store.activeTab" density="compact" grow>
        <v-tab value="tree">模型树</v-tab>
        <v-tab value="measurement">测量</v-tab>
        <v-tab value="annotation">批注</v-tab>
        <v-tab value="manager">管理</v-tab>
      </v-tabs>

      <v-window v-model="store.activeTab" class="mt-3 flex-1 min-h-0 h-full">
        <v-window-item value="tree" class="h-full">
          <ModelTreePanel :viewer="viewer" />
        </v-window-item>
        <v-window-item value="measurement" class="h-full">
          <MeasurementPanel :tools="tools" />
        </v-window-item>
        <v-window-item value="annotation" class="h-full">
          <AnnotationPanel :tools="tools" />
        </v-window-item>
        <v-window-item value="manager" class="h-full">
          <ToolManagerPanel :tools="tools" />
        </v-window-item>
      </v-window>
    </nav>
  </v-navigation-drawer>

  <v-main class="d-flex" style="position: relative;">
    <canvas ref="mainCanvas" class="viewer" />
    <div ref="overlayContainer" class="xeokitOverlay" />
    <canvas ref="cubeCanvas" class="navCube" />

    <MeasurementWizard
      v-if="store.toolMode.value === 'measure_point_to_object'"
      :status-text="tools.statusText.value"
      style="color: red" 
    />

    <div v-if="import.meta.env.DEV" style="position: absolute; top: 8px; right: 8px; z-index: 10;">
      <button type="button" style="font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.25); background: rgba(0,0,0,0.65); color: white; cursor: pointer;" @click="showStats = !showStats">{{ showStats ? 'Hide Stats' : 'Show Stats' }}</button>
    </div>

    <div v-if="import.meta.env.DEV && showStats" style="position: absolute; top: 44px; right: 8px; z-index: 10; width: 260px; background: rgba(0,0,0,0.65); color: white; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 10px; font-size: 12px; line-height: 1.4; pointer-events: auto;">
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
      <div v-else>
        stats unavailable
      </div>
    </div>
  </v-main>
</template>
