<script setup lang="ts">
import { onMounted, onUnmounted, ref, type Ref } from 'vue';

import { NavCubePlugin, Viewer } from '@xeokit/xeokit-sdk';

import { loadAiosPrepackBundle } from '../aios-prepack-bundle-loader';

import ModelTreePanel from '@/components/model-tree/ModelTreePanel.vue';
import AnnotationPanel from '@/components/tools/AnnotationPanel.vue';
import MeasurementPanel from '@/components/tools/MeasurementPanel.vue';
import ToolManagerPanel from '@/components/tools/ToolManagerPanel.vue';
import { useToolStore } from '@/composables/useToolStore';
import { useXeokitTools } from '@/composables/useXeokitTools';
import { onCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';

const mainCanvas = ref<HTMLCanvasElement>();
const cubeCanvas = ref<HTMLCanvasElement>();
const viewer: Ref<Viewer | null> = ref(null);
const overlayContainer = ref<HTMLElement | null>(null);

const store = useToolStore();
const tools = useXeokitTools(viewer, overlayContainer, store);

let offRibbonCommand: (() => void) | null = null;

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
      return;
  }

  emitToast({ message: `TODO: ${commandId}` });
}

onMounted(() => {
  if (!offRibbonCommand) {
    offRibbonCommand = onCommand(handleRibbonCommand);
  }

  viewer.value = new Viewer({
    canvasElement: mainCanvas.value,
    transparent: true
  });

  // 设置为 Z-up 坐标系（CAD/BIM 标准）
  viewer.value.scene.camera.worldAxis = [
    1, 0, 0,  // Right (+X)
    0, 0, 1,  // Up (+Z)
    0,-1, 0   // Forward (-Y)
  ];

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
    debug: true
  }).catch((err) => {
    console.error(err);
  });
});

onUnmounted(() => {
  if (offRibbonCommand) {
    offRibbonCommand();
    offRibbonCommand = null;
  }
  if (viewer.value !== null) viewer.value.destroy();
});

</script>

<template>
  <v-navigation-drawer width="450" class="h-full">
    <nav class="treeViewContainer flex h-full flex-col">
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
  </v-main>
</template>
