<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue';

import { DockviewVue, type DockviewReadyEvent, themeLight } from 'dockview-vue';

import type { ReviewTask } from '@/types/auth';

import { authVerifyToken, clearAuthToken, setAuthToken } from '@/api/reviewApi';
import { restoreEmbedWorkbenchContext } from '@/components/review/embedContextRestore';
import {
  applyEmbedLandingState,
  EMBED_LANDING_STATE_STORAGE_KEY,
  EMBED_LANDING_STATE_UPDATED_EVENT,
  EMBED_MODE_PARAMS_STORAGE_KEY,
  resolveEmbedLandingTargetFromRole,
  resolveEmbedLandingTarget,
  type EmbedLandingState,
  type EmbedModeParams,
} from '@/components/review/embedRoleLanding';
import { resolvePassiveWorkflowMode } from '@/components/review/workflowMode';
import { ensurePanelAndActivate, setDockApi, notifyDockLayoutChange } from '@/composables/useDockApi';
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
import { setGlobalSelectedRefno } from '@/composables/useSelectionStore';
import { useTaskCreationStore } from '@/composables/useTaskCreationStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { showModelByRefnosWithAck, waitForViewerReady } from '@/composables/useViewerContext';
import { onCommand } from '@/ribbon/commandBus';

function readEmbedModeParamsFromUrl(): EmbedModeParams {
  const urlParams = new URLSearchParams(window.location.search);
  return {
    formId: urlParams.get('form_id'),
    userToken: urlParams.get('user_token'),
    userId: urlParams.get('user_id'),
    userRole: urlParams.get('user_role'),
    projectId: urlParams.get('project_id'),
    workflowMode: urlParams.get('workflow_mode'),
    isEmbedMode: !!urlParams.get('form_id'),
    verifiedClaims: null,
  };
}

const embedModeParams = ref<EmbedModeParams>(readEmbedModeParamsFromUrl());

const LAYOUT_STORAGE_KEY = 'plant3d-web-dock-layout-v3';
const LAYOUT_MIGRATION_PROPERTIES_KEY = 'plant3d-web-dock-layout-v3-migrated-properties';
const popoutUrl = `${import.meta.env.BASE_URL}popout.html`;

type DockviewGroupLike = {
  api: {
    setSize: (size: { width?: number; height?: number }) => void;
  };
  id: string;
  panels: DockviewPanelLike[];
};

type DockviewPanelLike = {
  id: string;
  api: {
    close: () => void;
    setActive: () => void;
  };
  group?: DockviewGroupLike;
};

type DockApi = {
  addPanel: (options: unknown) => DockviewPanelLike;
  getPanel: (id: string) => DockviewPanelLike | undefined;
  getGroup: (id: string) => DockviewGroupLike | undefined;
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
const embedTokenVerified = ref(false);

function isPassiveWorkflowMode(): boolean {
  return resolvePassiveWorkflowMode({
    embedParams: embedModeParams.value,
  });
}

function closeBlockedReviewPanels() {
  const dockApi = api.value;
  if (!dockApi || !isPassiveWorkflowMode()) return;
  closePanelIfExists(dockApi, 'myTasks');
}

// 右键菜单状态
const tabContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  panelId: '',
  groupId: '',
});

type SelectRefnoRequest = {
  type: 'plant3d.select_refno';
  requestId?: string;
  refno: string;
  options?: { flyTo?: boolean };
};

type PingRequest = {
  type: 'plant3d.ping';
  requestId?: string;
};

type Plant3dResponse = {
  type: 'plant3d.response';
  requestId?: string;
  ok: boolean;
  error?: string;
};

function normalizeRefnoUnderscore(raw: string): string {
  return String(raw || '').trim().replace(/\//g, '_');
}

function normalizeRefnoSlash(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.includes('_') ? s.replace(/_/g, '/') : s;
}

function collectTaskComponentRefnos(task: ReviewTask | null): string[] {
  if (!task?.components?.length) return [];
  const refnos = new Set<string>();
  for (const component of task.components) {
    const normalized = normalizeRefnoUnderscore(component.refNo || '');
    if (normalized) {
      refnos.add(normalized);
    }
  }
  return Array.from(refnos);
}

async function ensureRestoredTaskModelsVisible(task: ReviewTask | null): Promise<void> {
  if (!task) return;

  const componentRefnos = collectTaskComponentRefnos(task);
  if (componentRefnos.length === 0) return;

  const viewerReady = await waitForViewerReady({ timeoutMs: 6000 });
  if (!viewerReady) {
    console.warn('[DockLayout] Viewer 未就绪，跳过 form_id 默认模型加载', {
      taskId: task.id,
      formId: task.formId,
    });
    return;
  }

  const result = await showModelByRefnosWithAck({
    refnos: componentRefnos.map((refno) => normalizeRefnoSlash(refno)),
    flyTo: true,
    ensureViewerReady: false,
    timeoutMs: 15_000,
  });

  if (result.error && result.ok.length === 0) {
    console.warn('[DockLayout] form_id 默认模型加载失败', {
      taskId: task.id,
      formId: task.formId,
      error: result.error,
      fail: result.fail,
    });
    return;
  }

  const firstRefno = componentRefnos[0];
  if (firstRefno) {
    setGlobalSelectedRefno(firstRefno);
    window.dispatchEvent(new CustomEvent('autoLocateRefno', {
      detail: { refno: normalizeRefnoSlash(firstRefno) },
    }));
  }
}

let offEmbedPostMessage: (() => void) | null = null;

function tryRegisterEmbedPostMessageBridge() {
  const shouldEnable = embedModeParams.value.isEmbedMode && embedTokenVerified.value;
  if (!shouldEnable) {
    if (offEmbedPostMessage) {
      offEmbedPostMessage();
      offEmbedPostMessage = null;
    }
    return;
  }

  if (offEmbedPostMessage) return;

  const handler = (event: MessageEvent) => {
    const source = event.source;
    if (!source || typeof (source as WindowProxy).postMessage !== 'function') return;

    const data = event.data as unknown;
    if (!data || typeof data !== 'object') return;

    const ping = data as Partial<PingRequest>;
    if (ping.type === 'plant3d.ping') {
      const requestId = typeof ping.requestId === 'string' ? ping.requestId : undefined;
      const resp: Plant3dResponse = {
        type: 'plant3d.response',
        requestId,
        ok: true,
      };
      (source as WindowProxy).postMessage(resp, '*');
      return;
    }

    const req = data as Partial<SelectRefnoRequest>;
    if (req.type !== 'plant3d.select_refno') return;

    const requestId = typeof req.requestId === 'string' ? req.requestId : undefined;
    const rawRefno = typeof req.refno === 'string' ? req.refno : '';
    const underscoreRefno = normalizeRefnoUnderscore(rawRefno);
    const slashRefno = normalizeRefnoSlash(rawRefno);

    const respond = (payload: Omit<Plant3dResponse, 'type' | 'requestId'>) => {
      const resp: Plant3dResponse = {
        type: 'plant3d.response',
        requestId,
        ...payload,
      };
      (source as WindowProxy).postMessage(resp, '*');
    };

    if (!underscoreRefno || !slashRefno) {
      respond({ ok: false, error: 'invalid refno' });
      return;
    }

    try {
      // Ensure selectionStore updates immediately (underscore form matches console behavior).
      setGlobalSelectedRefno(underscoreRefno);
      // Reuse ModelTreePanel mechanism: focuses tree + optionally loads/flyTo.
      window.dispatchEvent(new CustomEvent('autoLocateRefno', { detail: { refno: slashRefno } }));
      respond({ ok: true });
    } catch (e) {
      respond({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  window.addEventListener('message', handler);
  offEmbedPostMessage = () => window.removeEventListener('message', handler);
}

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
  closePanelIfExists(dockApi, 'dashboard');

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

  dockApi.addPanel({
    id: 'properties',
    component: 'PropertiesPanel',
    title: '属性',
    position: { referencePanel: measurementPanel, direction: 'within' },
  });

  // 概览（Dashboard）不加入默认布局，由 Ribbon「概览」或 ensurePanel 按需打开

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

  if (panelId === 'myTasks' && isPassiveWorkflowMode()) {
    console.info('[DockLayout] 被动流程模式下跳过创建 myTasks 面板');
    return;
  }

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
  if (panelId === 'annotationStyle') {
    return dockApi.addPanel({
      id: 'annotationStyle',
      component: 'AnnotationStylePanel',
      title: '批注样式',
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
  if (panelId === 'myTasks' && isPassiveWorkflowMode()) {
    console.info('[DockLayout] 被动流程模式下忽略 myTasks 切换');
    return;
  }
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

function openPanel(panelId: string) {
  const dockApi = api.value;
  if (!dockApi) {
    console.warn('[DockLayout] openPanel: dockApi is null');
    return;
  }

  console.log(`[DockLayout] openPanel: ${panelId}`);
  if (panelId === 'myTasks' && isPassiveWorkflowMode()) {
    console.info('[DockLayout] 被动流程模式下忽略 myTasks 打开');
    return;
  }
  onPanelOpened(panelId);

  const panel = dockApi.getPanel(panelId);
  if (panel) {
    panel.api.setActive();
    return;
  }

  const created = ensurePanel(panelId);
  if (created) {
    created.api.setActive();
  } else {
    console.error(`[DockLayout] Failed to open panel ${panelId}`);
  }
}

function resetLayout() {
  if (!api.value) return;
  resetZoneState();
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
  createDefaultLayout(api.value);
}

// 右键菜单相关函数
function showTabContextMenu(event: MouseEvent, panelId: string, groupId: string) {
  event.preventDefault();
  tabContextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    panelId,
    groupId,
  };
}

function hideTabContextMenu() {
  tabContextMenu.value.visible = false;
}

function closeCurrentTab() {
  const { panelId } = tabContextMenu.value;
  if (!panelId || !api.value) return;
  
  const panel = api.value.getPanel(panelId);
  if (panel) {
    panel.api.close();
  }
  hideTabContextMenu();
}

function closeOtherTabs() {
  const { panelId, groupId } = tabContextMenu.value;
  if (!panelId || !groupId || !api.value) return;
  
  const group = api.value.getGroup(groupId);
  if (!group || !group.panels) return;
  
  // 关闭组内除当前面板外的所有面板
  const panelsToClose = group.panels.filter((panel: DockviewPanelLike) => panel.id !== panelId);
  panelsToClose.forEach((panel: DockviewPanelLike) => {
    panel.api.close();
  });
  
  hideTabContextMenu();
}

function setupTabContextMenu() {
  if (!api.value) return;
  
  // 监听 DOM 事件来捕获标签页右键点击
  const dockviewElement = document.querySelector('.dockview-root');
  if (!dockviewElement) return;
  
  const handleContextMenu = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    const target = mouseEvent.target as HTMLElement;
    
    // 查找最近的标签页元素
    const tabElement = target.closest('.dockview-tab');
    if (!tabElement) return;
    
    // 获取面板 ID 和组 ID
    const panelId = tabElement.getAttribute('data-panel-id');
    if (!panelId) return;
    
    // 通过 dockview API 获取组信息
    const panel = api.value!.getPanel(panelId);
    if (!panel || !panel.group) return;
    
    const groupId = panel.group.id;
    
    showTabContextMenu(mouseEvent, panelId, groupId);
  };
  
  dockviewElement.addEventListener('contextmenu', handleContextMenu as EventListener);
  
  // 点击其他地方关闭右键菜单
  const handleClickOutside = (event: Event) => {
    if (!tabContextMenu.value.visible) return;
    
    const contextMenuElement = document.querySelector('.tab-context-menu');
    if (contextMenuElement && !contextMenuElement.contains(event.target as Node)) {
      hideTabContextMenu();
    }
  };
  
  document.addEventListener('click', handleClickOutside as EventListener);
  
  // 清理函数
  return () => {
    dockviewElement.removeEventListener('contextmenu', handleContextMenu as EventListener);
    document.removeEventListener('click', handleClickOutside as EventListener);
  };
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
    case 'annotation.settings':
      togglePanel('annotationStyle');
      return;
    case 'panel.review':
      togglePanel('review');
      return;
    case 'panel.myTasks':
      if (isPassiveWorkflowMode()) {
        console.info('[DockLayout] 当前为被动流程模式，不提供“我的提资”入口');
        return;
      }
      togglePanel('myTasks');
      return;
    case 'panel.reviewerTasks':
      togglePanel('reviewerTasks');
      return;
    case 'panel.initiateReview':
      openPanel('initiateReview');
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
      console.log('[DockLayout] review.start opening reviewer task panel', {
        currentUserId: userStore.currentUserId.value,
        currentUserRole: userStore.currentUser.value?.role ?? null,
      });
      openPanel('reviewerTasks');
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
  embedTokenVerified.value = false;
  if (token) {
    setAuthToken(token);

    try {
      const verifyResponse = await authVerifyToken(token, embedModeParams.value.formId || undefined);
      if (!verifyResponse.data?.valid) {
        console.warn('[DockLayout] Embedded token verification failed:', verifyResponse.data?.error);
        clearAuthToken();
        embedTokenVerified.value = false;
      } else {
        embedTokenVerified.value = true;
        const claims = verifyResponse.data.claims;
        if (claims) {
          embedModeParams.value = {
            ...embedModeParams.value,
            formId: claims.formId || embedModeParams.value.formId,
            userId: claims.userId || embedModeParams.value.userId,
            userRole: claims.role || embedModeParams.value.userRole,
            projectId: claims.projectId || embedModeParams.value.projectId,
            verifiedClaims: claims,
          };
        }
      }
    } catch (error) {
      console.warn('[DockLayout] Embedded token verification request failed:', error);
      clearAuthToken();
      embedTokenVerified.value = false;
    }
  }

  tryRegisterEmbedPostMessageBridge();

  await ensureUserStoreInitialized();

  const externalUserId = embedModeParams.value.verifiedClaims?.userId || embedModeParams.value.userId;
  if (externalUserId) {
    userStore.setEmbedUser(
      externalUserId,
      embedModeParams.value.verifiedClaims?.role || embedModeParams.value.userRole || undefined,
    );
  }

  await userStore.loadReviewTasks();
}

function persistEmbedLandingState(state: EmbedLandingState | null) {
  if (!state) return;

  sessionStorage.setItem(EMBED_MODE_PARAMS_STORAGE_KEY, JSON.stringify(embedModeParams.value));
  sessionStorage.setItem(EMBED_LANDING_STATE_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(EMBED_LANDING_STATE_UPDATED_EVENT, { detail: state }));
}

async function applyInitialLanding() {
  await bootstrapEmbedSession();
  closeBlockedReviewPanels();

  if (embedModeParams.value.isEmbedMode) {
    const roleLandingTarget = resolveEmbedLandingTargetFromRole(
      embedModeParams.value.verifiedClaims?.role || embedModeParams.value.userRole,
    );
    const landingTarget = roleLandingTarget ?? resolveEmbedLandingTarget({
      isEmbedMode: embedModeParams.value.isEmbedMode,
      isDesigner: userStore.isDesigner.value,
      isReviewer: userStore.isReviewer.value,
    });

    if (landingTarget) {
      console.log('[DockLayout] 嵌入模式角色落点:', landingTarget);
      const { switchProjectById } = useModelProjects();
      const landingState = applyEmbedLandingState({
        ensurePanel,
        activatePanel,
        sessionStorageLike: sessionStorage,
        embedModeParams: embedModeParams.value,
        target: landingTarget,
        switchProjectById,
        passiveWorkflowMode: isPassiveWorkflowMode(),
      });

      const restoreResult = await restoreEmbedWorkbenchContext({
        target: landingTarget,
        formId: embedModeParams.value.formId,
        loadReviewTasks: userStore.loadReviewTasks,
        reviewerTasks: () => userStore.pendingReviewTasks.value,
        designerTasks: () => userStore.myInitiatedTasks.value,
        allTasks: () => userStore.reviewTasks.value,
        setCurrentTask: reviewStore.setCurrentTask,
        openPanel,
        activatePanel,
        passiveWorkflowMode: isPassiveWorkflowMode(),
      });

      await ensureRestoredTaskModelsVisible(restoreResult.restoredTask);

      if (landingState) {
        persistEmbedLandingState({
          ...landingState,
          formId: embedModeParams.value.formId,
          restoreStatus: restoreResult.restoreStatus,
          restoredTaskId: restoreResult.restoredTaskId,
          restoredTaskSummary: restoreResult.restoredTaskSummary,
          restoredTaskDraft: restoreResult.restoredTaskDraft,
        });
      }
      return;
    }
  }

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

  closeBlockedReviewPanels();

  event.api.onDidLayoutChange(() => {
    saveLayout();
    notifyDockLayoutChange();
  });

  migratePropertiesPanelOnce();

  // 设置标签页右键菜单
  setupTabContextMenu();

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

  if (offEmbedPostMessage) {
    offEmbedPostMessage();
    offEmbedPostMessage = null;
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
    
    <!-- 标签页右键菜单 -->
    <div v-if="tabContextMenu.visible"
      class="tab-context-menu fixed z-[1000] min-w-[120px] rounded-md border border-border bg-background py-1 text-sm shadow-lg"
      :style="{ left: tabContextMenu.x + 'px', top: tabContextMenu.y + 'px' }"
      @pointerdown.stop
      @contextmenu.prevent.stop>
      <button class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="closeCurrentTab">
        关闭
      </button>
      <button class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="closeOtherTabs">
        关闭其他
      </button>
    </div>
  </div>
</template>
