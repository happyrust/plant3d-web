<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue';

import { DockviewVue, type DockviewReadyEvent, themeLight } from 'dockview-vue';

import { authVerifyToken, clearAuthToken, setAuthToken } from '@/api/reviewApi';
import {
  applyEmbedLandingState,
  resolveEmbedLandingTarget,
} from '@/components/review/embedRoleLanding';
import { setDockApi, notifyDockLayoutChange } from '@/composables/useDockApi';
import { useModelProjects } from '@/composables/useModelProjects';
import {
  initPanelZones,
  disposePanelZones,
  toggleZone as togglePanelZone,
  onPanelOpened,
  resetZoneState,
  type ZoneName,
} from '@/composables/usePanelZones';
import { useReviewStore } from '@/composables/useReviewStore';
import { useTaskCreationStore } from '@/composables/useTaskCreationStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { onCommand } from '@/ribbon/commandBus';

// 检测 URL 参数（用于 iframe 嵌入模式）
const embedModeParams = computed(() => {
  const urlParams = new URLSearchParams(window.location.search);
  return {
    formId: urlParams.get('form_id'),
    userToken: urlParams.get('user_token'),
    userId: urlParams.get('user_id'),
    projectId: urlParams.get('project_id'),
    isEmbedMode: !!urlParams.get('form_id'),
  };
});

const LAYOUT_STORAGE_KEY = 'plant3d-web-dock-layout-v3';
const LAYOUT_MIGRATION_PROPERTIES_KEY = 'plant3d-web-dock-layout-v3-migrated-properties';
const popoutUrl = `${import.meta.env.BASE_URL}popout.html`;

type DockviewGroupLike = {
  api: {
    setSize: (size: { width?: number; height?: number }) => void;
  };
};

type DockviewPanelLike = {
  api: {
    close: () => void;
    setActive: () => void;
  };
  group?: DockviewGroupLike;
};

type DockApi = {
  addPanel: (options: unknown) => DockviewPanelLike;
  getPanel: (id: string) => DockviewPanelLike | undefined;
  toJSON: () => unknown;
  fromJSON: (data: unknown) => void;
  onDidLayoutChange: (cb: () => void) => unknown;
  addPopoutGroup: (group: unknown) => void;
  activeGroup?: unknown;
};

const api = ref<DockApi | null>(null);

const reviewStore = useReviewStore();
const toolStore = useToolStore();
const userStore = useUserStore();
const taskCreationStore = useTaskCreationStore();

let offCommand: (() => void) | null = null;
let userStoreInitializationPromise: Promise<void> | null = null;

function ensureUserStoreInitialized(): Promise<void> {
  if (!userStoreInitializationPromise) {
    userStoreInitializationPromise = userStore.initialize();
  }
  return userStoreInitializationPromise;
}

function closePanelIfExists(dockApi: DockApi, id: string) {
  const panel = dockApi.getPanel(id);
  if (panel) {
    panel.api.close();
  }
}

function saveLayout() {
  if (!api.value) return;
  try {
    const layout = api.value.toJSON();
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    console.log('[DockLayout] Layout saved');
  } catch (e) {
    console.error('[DockLayout] Failed to save layout:', e);
  }
}

function createDefaultLayout(dockApi: DockApi) {
  closePanelIfExists(dockApi, 'properties');
  closePanelIfExists(dockApi, 'manager');
  closePanelIfExists(dockApi, 'hydraulic');
  closePanelIfExists(dockApi, 'annotation');
  closePanelIfExists(dockApi, 'measurement');
  closePanelIfExists(dockApi, 'dimension');
  closePanelIfExists(dockApi, 'ptset');
  closePanelIfExists(dockApi, 'mbdPipe');
  closePanelIfExists(dockApi, 'modelTree');
  closePanelIfExists(dockApi, 'modelQuery');
  closePanelIfExists(dockApi, 'nearbyQuery');
  closePanelIfExists(dockApi, 'viewer');
  closePanelIfExists(dockApi, 'console');

  const viewerPanel = dockApi.addPanel({
    id: 'viewer',
    component: 'ViewerPanel',
    title: '三维查看器',
    renderer: 'always',
  });

  dockApi.addPanel({
    id: 'modelTree',
    component: 'ModelTreePanel',
    title: '模型树',
    renderer: 'always',
    position: { referencePanel: viewerPanel, direction: 'left' },
  });

  const measurementPanel = dockApi.addPanel({
    id: 'measurement',
    component: 'MeasurementPanel',
    title: '测量',
    position: { referencePanel: viewerPanel, direction: 'right' },
  });

  dockApi.addPanel({
    id: 'dimension',
    component: 'DimensionPanel',
    title: '尺寸标注',
    position: { referencePanel: measurementPanel, direction: 'within' },
  });

  dockApi.addPanel({
    id: 'annotation',
    component: 'AnnotationPanel',
    title: '批注',
    position: { referencePanel: measurementPanel, direction: 'within' },
  });

  dockApi.addPanel({
    id: 'manager',
    component: 'ManagerPanel',
    title: '管理',
    position: { referencePanel: measurementPanel, direction: 'within' },
  });

  const propertiesPanel = dockApi.addPanel({
    id: 'properties',
    component: 'PropertiesPanel',
    title: '属性',
    position: { referencePanel: measurementPanel, direction: 'within' },
  });

  propertiesPanel.api.setActive();
  viewerPanel.api.setActive();

  const leftGroup = dockApi.getPanel('modelTree')?.group;
  const rightGroup = dockApi.getPanel('measurement')?.group;
  if (leftGroup) leftGroup.api.setSize({ width: 350 });
  if (rightGroup) rightGroup.api.setSize({ width: 350 });
  
  dockApi.addPanel({
    id: 'console',
    component: 'ConsolePanel',
    title: '控制台',
    position: { referencePanel: viewerPanel, direction: 'below' },
  });
  const bottomGroup = dockApi.getPanel('console')?.group;
  if (bottomGroup) bottomGroup.api.setSize({ height: 200 });

  console.log('[DockLayout] Default layout created');
}

function activatePanel(panelId: string) {
  const dockApi = api.value;
  if (!dockApi) return;
  const panel = dockApi.getPanel(panelId);
  if (!panel) return;
  panel.api.setActive();
}

function ensurePanel(panelId: string) {
  const dockApi = api.value;
  if (!dockApi) return;
  const existing = dockApi.getPanel(panelId);
  if (existing) return existing;

  const viewerPanel = dockApi.getPanel('viewer');
  const measurementPanel = dockApi.getPanel('measurement');

  if (panelId === 'modelTree') {
    return dockApi.addPanel({
      id: 'modelTree',
      component: 'ModelTreePanel',
      title: '模型树',
      renderer: 'always',
      position: viewerPanel ? { referencePanel: viewerPanel, direction: 'left' } : undefined,
    });
  }
  if (panelId === 'measurement') {
    return dockApi.addPanel({
      id: 'measurement',
      component: 'MeasurementPanel',
      title: '测量',
      position: viewerPanel ? { referencePanel: viewerPanel, direction: 'right' } : undefined,
    });
  }
  if (panelId === 'dimension') {
    return dockApi.addPanel({
      id: 'dimension',
      component: 'DimensionPanel',
      title: '尺寸标注',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'annotation') {
    return dockApi.addPanel({
      id: 'annotation',
      component: 'AnnotationPanel',
      title: '批注',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'manager') {
    return dockApi.addPanel({
      id: 'manager',
      component: 'ManagerPanel',
      title: '管理',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'hydraulic') {
    return dockApi.addPanel({
      id: 'hydraulic',
      component: 'HydraulicPanel',
      title: '水力计算',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'properties') {
    return dockApi.addPanel({
      id: 'properties',
      component: 'PropertiesPanel',
      title: '属性',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'ptset') {
    return dockApi.addPanel({
      id: 'ptset',
      component: 'PtsetPanel',
      title: '点集',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'mbdPipe') {
    return dockApi.addPanel({
      id: 'mbdPipe',
      component: 'MbdPipePanel',
      title: 'MBD-管道标注',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'dimensionStyle') {
    return dockApi.addPanel({
      id: 'dimensionStyle',
      component: 'DimensionStylePanel',
      title: '尺寸样式',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'materialConfig') {
    return dockApi.addPanel({
      id: 'materialConfig',
      component: 'DtxMaterialConfigPanel',
      title: '颜色配置',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'review') {
    return dockApi.addPanel({
      id: 'review',
      component: 'ReviewPanel',
      title: '校审',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'initiateReview') {
    return dockApi.addPanel({
      id: 'initiateReview',
      component: 'InitiateReviewPanel',
      title: '发起提资',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'reviewerTasks') {
    return dockApi.addPanel({
      id: 'reviewerTasks',
      component: 'ReviewerTaskListPanel',
      title: '待审核任务',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'myTasks') {
    return dockApi.addPanel({
      id: 'myTasks',
      component: 'DesignerTaskListPanel',
      title: '我的提资',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'resubmissionTasks') {
    return dockApi.addPanel({
      id: 'resubmissionTasks',
      component: 'ResubmissionTaskListPanel',
      title: '复审任务',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'taskMonitor') {
    return dockApi.addPanel({
      id: 'taskMonitor',
      component: 'TaskMonitorPanel',
      title: '任务监控',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'taskCreation') {
    return dockApi.addPanel({
      id: 'taskCreation',
      component: 'TaskCreationPanel',
      title: '创建任务',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'modelExport') {
    return dockApi.addPanel({
      id: 'modelExport',
      component: 'ModelExportPanel',
      title: '导出模型',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'dashboard') {
    return dockApi.addPanel({
      id: 'dashboard',
      component: 'DashboardPanel',
      title: '概览',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (panelId === 'console') {
    return dockApi.addPanel({
      id: 'console',
      component: 'ConsolePanel',
      title: '控制台',
      position: viewerPanel
        ? { referencePanel: viewerPanel, direction: 'below' }
        : undefined,
    });
  }
  if (panelId === 'parquetDebug') {
    return dockApi.addPanel({
      id: 'parquetDebug',
      component: 'ParquetDebugPanel',
      title: 'Parquet SQL',
      position: viewerPanel
        ? { referencePanel: viewerPanel, direction: 'below' }
        : undefined,
    });
  }
  if (panelId === 'roomStatus') {
    return dockApi.addPanel({
      id: 'roomStatus',
      component: 'RoomStatusPanel',
      title: '房间计算状态',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
}

function togglePanel(panelId: string) {
  const dockApi = api.value;
  if (!dockApi) {
    console.warn('[DockLayout] togglePanel: dockApi is null');
    return;
  }

  console.log(`[DockLayout] togglePanel: ${panelId}`);
  const panel = dockApi.getPanel(panelId);
  if (panel) {
    console.log(`[DockLayout] Panel ${panelId} exists, closing it`);
    panel.api.close();
    return;
  }

  console.log(`[DockLayout] Creating panel ${panelId}`);
  onPanelOpened(panelId); // auto-expand zone if collapsed
  const created = ensurePanel(panelId);
  if (created) {
    console.log(`[DockLayout] Panel ${panelId} created, setting active`);
    created.api.setActive();
  } else {
    console.error(`[DockLayout] Failed to create panel ${panelId}`);
  }
}

function resetLayout() {
  if (!api.value) return;
  resetZoneState();
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
  createDefaultLayout(api.value);
}

function popoutActiveGroup() {
  const dockApi = api.value;
  if (!dockApi) return;
  const activeGroup = dockApi.activeGroup;
  if (!activeGroup) return;
  dockApi.addPopoutGroup(activeGroup);
}

function handleZoneToggle(zone: ZoneName) {
  togglePanelZone(zone);
}

function handleRibbonCommand(commandId: string) {
  console.log('[DockLayout] handleRibbonCommand:', commandId);
  switch (commandId) {
    case 'panel.tree':
      togglePanel('modelTree');
      return;
    case 'panel.measurement':
      togglePanel('measurement');
      return;
    case 'panel.dimension':
      togglePanel('dimension');
      return;
    case 'panel.annotation':
      togglePanel('annotation');
      return;
    case 'panel.manager':
      togglePanel('manager');
      return;
    case 'panel.hydraulic':
      togglePanel('hydraulic');
      return;
    case 'panel.properties':
      togglePanel('properties');
      return;
    case 'panel.query':
    case 'panel.nearbyQuery':
    case 'panel.spatialQuery':
      ensurePanelAndActivate('viewer');
      window.dispatchEvent(new CustomEvent('openSpatialQuery', {
        detail: {
          mode: commandId === 'panel.query' ? 'range' : 'distance',
        },
      }));
      return;
    case 'panel.ptset':
      togglePanel('ptset');
      return;
    case 'panel.mbdPipe':
      togglePanel('mbdPipe');
      return;
    case 'panel.materialConfig':
      togglePanel('materialConfig');
      return;
    case 'dimension.settings':
      togglePanel('dimensionStyle');
      return;
    case 'panel.review':
      togglePanel('review');
      return;
    case 'panel.myTasks':
      togglePanel('myTasks');
      return;
    case 'panel.reviewerTasks':
      togglePanel('reviewerTasks');
      return;
    case 'panel.initiateReview':
      togglePanel('initiateReview');
      return;
    case 'panel.dashboard':
      togglePanel('dashboard');
      return;
    case 'panel.resubmissionTasks':
      togglePanel('resubmissionTasks');
      return;
    case 'panel.monitor':
      togglePanel('taskMonitor');
      return;
    case 'panel.console':
      togglePanel('console');
      return;
    case 'panel.taskMonitor':
      togglePanel('taskMonitor');
      return;
    case 'panel.taskCreation':
      togglePanel('taskCreation');
      return;
    case 'panel.parquetDebug':
      togglePanel('parquetDebug');
      return;
    case 'panel.roomStatus':
      togglePanel('roomStatus');
      return;

    // zone toggle commands
    case 'zone.toggleLeft':
      handleZoneToggle('left');
      return;
    case 'zone.toggleBottom':
      handleZoneToggle('bottom');
      return;
    case 'zone.toggleRight':
      handleZoneToggle('right');
      return;

    case 'room.compute':
      // 触发房间计算，同时打开状态面板
      togglePanel('roomStatus');
      return;

    // task creation with preset type
    case 'task.createDataParsing':
      taskCreationStore.setPresetType('DataParsingWizard');
      togglePanel('taskCreation');
      return;
    case 'task.createModelGeneration':
      taskCreationStore.setPresetType('DataGeneration');
      togglePanel('taskCreation');
      return;
    case 'task.createModelExport':
      togglePanel('modelExport');
      return;

    // layout commands
    case 'layout.popout':
      popoutActiveGroup();
      return;
    case 'layout.save':
      saveLayout();
      return;
    case 'layout.reset':
      resetLayout();
      return;

    // review commands
    case 'review.start':
      console.log('[DockLayout] review.start role gate', {
        currentUserId: userStore.currentUserId.value,
        currentUserRole: userStore.currentUser.value?.role ?? null,
        isDesigner: userStore.isDesigner.value,
        isReviewer: userStore.isReviewer.value,
      });
      if (userStore.isReviewer.value && !userStore.isDesigner.value) {
        console.log('[DockLayout] review.start opening reviewer task panel');
        togglePanel('reviewerTasks');
      } else {
        console.log('[DockLayout] review.start opening initiator panel');
        togglePanel('initiateReview');
      }
      return;
    case 'review.confirm':
      if (
        toolStore.annotationCount.value > 0 ||
        toolStore.cloudAnnotationCount.value > 0 ||
        toolStore.rectAnnotationCount.value > 0 ||
        toolStore.obbAnnotationCount.value > 0 ||
        toolStore.measurementCount.value > 0
      ) {
        reviewStore.addConfirmedRecord({
          type: 'batch',
          annotations: [...toolStore.annotations.value],
          cloudAnnotations: [...toolStore.cloudAnnotations.value],
          rectAnnotations: [...toolStore.rectAnnotations.value],
          obbAnnotations: [...toolStore.obbAnnotations.value],
          measurements: [...toolStore.measurements.value],
          note: '',
        });
        toolStore.clearAll();
      }
      return;
    case 'review.export': {
      const json = reviewStore.exportReviewData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `review-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }
    case 'review.clear':
      reviewStore.clearConfirmedRecords();
      return;
  }
}

function isValidLayout(layout: unknown): boolean {
  if (!layout || typeof layout !== 'object') return false;
  const obj = layout as Record<string, unknown>;
  // Check for essential structure: grid and panels with viewer
  if (!obj.grid || !obj.panels) return false;
  const panels = obj.panels as Record<string, unknown>;
  return 'viewer' in panels;
}

function migratePropertiesPanelOnce() {
  const dockApi = api.value;
  if (!dockApi) return;
  if (localStorage.getItem(LAYOUT_MIGRATION_PROPERTIES_KEY)) return;

  if (!dockApi.getPanel('properties')) {
    const created = ensurePanel('properties');
    if (created) {
      created.api.setActive();
      dockApi.getPanel('viewer')?.api.setActive();
      saveLayout();
    }
  }

  localStorage.setItem(LAYOUT_MIGRATION_PROPERTIES_KEY, '1');
}

async function bootstrapEmbedSession(): Promise<void> {
  if (!embedModeParams.value.isEmbedMode) {
    await ensureUserStoreInitialized();
    return;
  }

  console.log('[DockLayout] 📋 嵌入模式检测到:', embedModeParams.value);

  const token = embedModeParams.value.userToken;
  if (token) {
    setAuthToken(token);

    try {
      const verifyResponse = await authVerifyToken(token, embedModeParams.value.formId || undefined);
      if (!verifyResponse.data?.valid) {
        console.warn('[DockLayout] Embedded token verification failed:', verifyResponse.data?.error);
        clearAuthToken();
      }
    } catch (error) {
      console.warn('[DockLayout] Embedded token verification request failed:', error);
      clearAuthToken();
    }
  }

  await ensureUserStoreInitialized();
}

async function applyInitialLanding() {
  await bootstrapEmbedSession();

  if (embedModeParams.value.isEmbedMode) {
    const landingTarget = resolveEmbedLandingTarget({
      isEmbedMode: embedModeParams.value.isEmbedMode,
      isDesigner: userStore.isDesigner.value,
      isReviewer: userStore.isReviewer.value,
    });

    if (landingTarget) {
      console.log('[DockLayout] 嵌入模式角色落点:', landingTarget);
      const { switchProjectById } = useModelProjects();
      applyEmbedLandingState({
        ensurePanel,
        activatePanel,
        sessionStorageLike: sessionStorage,
        embedModeParams: embedModeParams.value,
        target: landingTarget,
        switchProjectById,
      });
      return;
    }
  }

  activatePanel('modelTree');
  activatePanel('viewer');
}

function onReady(event: DockviewReadyEvent) {
  api.value = event.api as unknown as DockApi;
  setDockApi(event.api as unknown as { getPanel: (id: string) => unknown });

  // Initialize panel zone management
  initPanelZones(
    api.value as unknown as { getPanel: (id: string) => { api: { close: () => void; setActive: () => void } } | undefined },
    ensurePanel as (panelId: string) => { api: { setActive: () => void } } | undefined,
  );

  const savedLayout = localStorage.getItem(LAYOUT_STORAGE_KEY);
  let loaded = false;

  if (savedLayout) {
    try {
      const layout = JSON.parse(savedLayout);
      if (isValidLayout(layout)) {
        event.api.fromJSON(layout);
        loaded = true;
        console.log('[DockLayout] Layout restored from localStorage');
      } else {
        console.warn('[DockLayout] Invalid layout data, skipping restore');
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('[DockLayout] Failed to parse layout, using default:', e);
      localStorage.removeItem(LAYOUT_STORAGE_KEY);
    }
  }

  if (!loaded) {
    createDefaultLayout(api.value);
  }

  event.api.onDidLayoutChange(() => {
    saveLayout();
    notifyDockLayoutChange();
  });

  migratePropertiesPanelOnce();

  void applyInitialLanding();
}

onMounted(() => {
  if (!offCommand) {
    offCommand = onCommand(handleRibbonCommand);
  }
});

onUnmounted(() => {
  if (offCommand) {
    offCommand();
    offCommand = null;
  }

  disposePanelZones();
  setDockApi(null);
});

onBeforeUnmount(() => {
  saveLayout();
});

</script>

<template>
  <div class="dockview-container">
    <DockviewVue class="dockview-root" :theme="themeLight" :popout-url="popoutUrl" @ready="onReady" />
  </div>
</template>
