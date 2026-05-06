<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue';

import { DockviewVue, type DockviewReadyEvent, themeLight } from 'dockview-vue';

import type { ReviewTask } from '@/types/auth';

import { authVerifyToken, clearAuthToken, setAuthToken } from '@/api/reviewApi';
import { requestDesignerCommentViewMode } from '@/components/review/designerCommentViewModeBus';
import { restoreEmbedWorkbenchContext } from '@/components/review/embedContextRestore';
import { restoreEmbedFormSnapshotContext } from '@/components/review/embedFormSnapshotRestore';
import {
  applyEmbedLandingState,
  buildPersistedEmbedModeParams,
  EMBED_LANDING_STATE_STORAGE_KEY,
  EMBED_LANDING_STATE_UPDATED_EVENT,
  EMBED_MODE_PARAMS_STORAGE_KEY,
  getEmbedLandingPanelIdsWithOptions,
  getVerifiedEmbedFormId,
  getVerifiedEmbedWorkflowMode,
  readEmbedModeParamsFromSearch,
  resolvePassiveEmbedViewTarget,
  resolveTrustedEmbedIdentity,
  resolveEmbedLandingTargetFromRole,
  type EmbedLandingState,
  type EmbedModeParams,
} from '@/components/review/embedRoleLanding';
import { requestReviewerWorkbenchViewMode } from '@/components/review/reviewerWorkbenchViewModeBus';
import { isCanonicalReturnedTask } from '@/components/review/reviewTaskFilters';
import { resolvePassiveWorkflowMode } from '@/components/review/workflowMode';
import { dockPanelExists, ensurePanelAndActivate, setDockApi, notifyDockLayoutChange } from '@/composables/useDockApi';
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
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';
import { onCommand } from '@/ribbon/commandBus';

const embedModeParams = ref<EmbedModeParams>(readEmbedModeParamsFromSearch(window.location.search));

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
const viewerContext = useViewerContext();

let offCommand: (() => void) | null = null;
let userStoreInitializationPromise: Promise<void> | null = null;
const embedTokenVerified = ref(false);
const embedSessionError = ref<string | null>(null);

function normalizeDockPanelId(panelId: string): string {
  if (panelId === 'resubmissionTasks') return 'designerCommentHandling';
  return panelId;
}

function isPassiveWorkflowMode(): boolean {
  return resolvePassiveWorkflowMode({
    verifiedWorkflowMode: getVerifiedEmbedWorkflowMode(embedModeParams.value),
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
  await ensureModelRefnosVisible(componentRefnos, {
    taskId: task.id,
    formId: task.formId,
  });
}

async function ensureModelRefnosVisible(
  componentRefnos: string[],
  context: { taskId?: string; formId?: string | null },
): Promise<void> {
  if (componentRefnos.length === 0) return;

  const normalizedRefnos = componentRefnos
    .map((refno) => normalizeRefnoSlash(refno))
    .filter(Boolean);

  if (typeof console !== 'undefined') {
    console.info('[embed][viewer-restore] preparing showModelByRefnos', {
      taskId: context.taskId,
      formId: context.formId,
      sourceRefnos: componentRefnos,
      normalizedRefnos,
    });
  }

  const viewerReady = await waitForViewerReady({ timeoutMs: 6000 });
  if (!viewerReady) {
    console.warn('[DockLayout] Viewer 未就绪，跳过 form_id 默认模型加载', {
      taskId: context.taskId,
      formId: context.formId,
    });
    return;
  }

  const result = await showModelByRefnosWithAck({
    refnos: normalizedRefnos,
    flyTo: true,
    ensureViewerReady: false,
    timeoutMs: 15_000,
  });

  if (typeof console !== 'undefined') {
    console.info('[embed][viewer-restore] showModelByRefnos result', {
      taskId: context.taskId,
      formId: context.formId,
      requestedRefnos: normalizedRefnos,
      ok: result.ok,
      fail: result.fail,
      error: result.error,
    });
  }

  if (result.error && result.ok.length === 0) {
    console.warn('[DockLayout] form_id 默认模型加载失败', {
      taskId: context.taskId,
      formId: context.formId,
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
  const panel = dockApi.getPanel(normalizeDockPanelId(id));
  if (panel) {
    panel.api.close();
  }
}

function clearEmbedLandingPersistence() {
  sessionStorage.removeItem(EMBED_MODE_PARAMS_STORAGE_KEY);
  sessionStorage.removeItem(EMBED_LANDING_STATE_STORAGE_KEY);
}

function isEmbedLayoutMode(): boolean {
  return !!embedModeParams.value.isEmbedMode;
}

function closeEmbedLandingPanels() {
  const dockApi = api.value;
  if (!dockApi) return;

  ['initiateReview', 'review', 'reviewerTasks', 'myTasks', 'manager', 'designerCommentHandling'].forEach((panelId) => {
    closePanelIfExists(dockApi, panelId);
  });
}

function saveLayout() {
  if (!api.value) return;
  if (isEmbedLayoutMode()) {
    console.info('[DockLayout] 嵌入模式跳过普通布局持久化');
    return;
  }
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
  closePanelIfExists(dockApi, 'spatialCompute');

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

function createEmbedFocusedLayout(
  dockApi: DockApi,
  options: { primaryPanelId?: 'review' | 'initiateReview' | 'designerCommentHandling' } = {},
) {
  [
    'properties',
    'manager',
    'hydraulic',
    'annotation',
    'measurement',
    'dimension',
    'ptset',
    'mbdPipe',
    'modelTree',
    'modelQuery',
    'nearbyQuery',
    'viewer',
    'console',
    'dashboard',
    'review',
    'initiateReview',
    'reviewerTasks',
    'myTasks',
    'designerCommentHandling',
    'resubmissionTasks',
    'taskMonitor',
    'taskCreation',
    'modelExport',
    'materialConfig',
    'roomStatus',
    'spatialCompute',
    'parquetDebug',
  ].forEach((panelId) => {
    closePanelIfExists(dockApi, panelId);
  });

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

  if (options.primaryPanelId) {
    ensurePanel(options.primaryPanelId);
  }

  viewerPanel.api.setActive();

  const leftGroup = dockApi.getPanel('modelTree')?.group;
  const rightGroup = options.primaryPanelId ? dockApi.getPanel(options.primaryPanelId)?.group : undefined;
  if (leftGroup) leftGroup.api.setSize({ width: 350 });
  if (rightGroup) rightGroup.api.setSize({ width: 420 });

  console.log('[DockLayout] Embed-focused layout created', {
    primaryPanelId: options.primaryPanelId ?? null,
  });
}

function activatePanel(panelId: string) {
  const dockApi = api.value;
  if (!dockApi) return;
  const panel = dockApi.getPanel(normalizeDockPanelId(panelId));
  if (!panel) return;
  panel.api.setActive();
}

function ensurePanel(panelId: string) {
  const dockApi = api.value;
  if (!dockApi) return;
  const normalizedPanelId = normalizeDockPanelId(panelId);
  const existing = dockApi.getPanel(normalizedPanelId);
  if (existing) return existing;

  if (normalizedPanelId === 'myTasks' && isPassiveWorkflowMode()) {
    console.info('[DockLayout] 被动流程模式下跳过创建 myTasks 面板');
    return;
  }

  const viewerPanel = dockApi.getPanel('viewer');
  const measurementPanel = dockApi.getPanel('measurement');

  if (normalizedPanelId === 'modelTree') {
    return dockApi.addPanel({
      id: 'modelTree',
      component: 'ModelTreePanel',
      title: '模型树',
      renderer: 'always',
      position: viewerPanel ? { referencePanel: viewerPanel, direction: 'left' } : undefined,
    });
  }
  if (normalizedPanelId === 'measurement') {
    return dockApi.addPanel({
      id: 'measurement',
      component: 'MeasurementPanel',
      title: '测量',
      position: viewerPanel ? { referencePanel: viewerPanel, direction: 'right' } : undefined,
    });
  }
  if (normalizedPanelId === 'dimension') {
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
  if (normalizedPanelId === 'annotation') {
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
  if (normalizedPanelId === 'manager') {
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
  if (normalizedPanelId === 'hydraulic') {
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
  if (normalizedPanelId === 'properties') {
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
  if (normalizedPanelId === 'ptset') {
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
  if (normalizedPanelId === 'mbdPipe') {
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
  if (normalizedPanelId === 'review') {
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
  if (normalizedPanelId === 'initiateReview') {
    return dockApi.addPanel({
      id: 'initiateReview',
      component: 'InitiateReviewPanel',
      title: '发起编校审',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (normalizedPanelId === 'reviewerTasks') {
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
  if (normalizedPanelId === 'myTasks') {
    return dockApi.addPanel({
      id: 'myTasks',
      component: 'DesignerTaskListPanel',
      title: '我的编校审',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (normalizedPanelId === 'designerCommentHandling') {
    return dockApi.addPanel({
      id: 'designerCommentHandling',
      component: 'DesignerCommentHandlingPanel',
      title: '批注处理',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
  if (normalizedPanelId === 'taskMonitor') {
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
  if (normalizedPanelId === 'taskCreation') {
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
  if (normalizedPanelId === 'modelExport') {
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
  if (normalizedPanelId === 'dashboard') {
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
  if (normalizedPanelId === 'console') {
    return dockApi.addPanel({
      id: 'console',
      component: 'ConsolePanel',
      title: '控制台',
      position: viewerPanel
        ? { referencePanel: viewerPanel, direction: 'below' }
        : undefined,
    });
  }
  if (normalizedPanelId === 'parquetDebug') {
    return dockApi.addPanel({
      id: 'parquetDebug',
      component: 'ParquetDebugPanel',
      title: 'Parquet SQL',
      position: viewerPanel
        ? { referencePanel: viewerPanel, direction: 'below' }
        : undefined,
    });
  }
  if (normalizedPanelId === 'roomStatus') {
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
  if (normalizedPanelId === 'spatialCompute') {
    return dockApi.addPanel({
      id: 'spatialCompute',
      component: 'SpatialComputePanel',
      title: '支架空间计算',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
}

function togglePanel(panelId: string) {
  const normalizedPanelId = normalizeDockPanelId(panelId);
  const dockApi = api.value;
  if (!dockApi) {
    console.warn('[DockLayout] togglePanel: dockApi is null');
    return;
  }

  console.log(`[DockLayout] togglePanel: ${normalizedPanelId}`);
  if (normalizedPanelId === 'myTasks' && isPassiveWorkflowMode()) {
    console.info('[DockLayout] 被动流程模式下忽略 myTasks 切换');
    return;
  }
  const panel = dockApi.getPanel(normalizedPanelId);
  if (panel) {
    console.log(`[DockLayout] Panel ${normalizedPanelId} exists, closing it`);
    panel.api.close();
    return;
  }

  console.log(`[DockLayout] Creating panel ${normalizedPanelId}`);
  onPanelOpened(normalizedPanelId); // auto-expand zone if collapsed
  const created = ensurePanel(normalizedPanelId);
  if (created) {
    console.log(`[DockLayout] Panel ${normalizedPanelId} created, setting active`);
    created.api.setActive();
  } else {
    console.error(`[DockLayout] Failed to create panel ${normalizedPanelId}`);
  }
}

function openPanel(panelId: string) {
  const normalizedPanelId = normalizeDockPanelId(panelId);
  const dockApi = api.value;
  if (!dockApi) {
    console.warn('[DockLayout] openPanel: dockApi is null');
    return;
  }

  console.log(`[DockLayout] openPanel: ${normalizedPanelId}`);
  if (normalizedPanelId === 'myTasks' && isPassiveWorkflowMode()) {
    console.info('[DockLayout] 被动流程模式下忽略 myTasks 打开');
    return;
  }
  onPanelOpened(normalizedPanelId);

  const panel = dockApi.getPanel(normalizedPanelId);
  if (panel) {
    panel.api.setActive();
    return;
  }

  const created = ensurePanel(normalizedPanelId);
  if (created) {
    created.api.setActive();
  } else {
    console.error(`[DockLayout] Failed to open panel ${normalizedPanelId}`);
  }
}

function resetLayout() {
  if (!api.value) return;
  resetZoneState();
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
  if (isEmbedLayoutMode()) {
    const landingTarget = resolveEmbedLandingTargetFromRole(embedModeParams.value.workflowRole);
    createEmbedFocusedLayout(api.value, {
      primaryPanelId: landingTarget === 'designer' ? 'initiateReview' : landingTarget === 'reviewer' ? 'review' : undefined,
    });
    return;
  }
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
    case 'panel.spatialCompute':
      openPanel('spatialCompute');
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
        console.info('[DockLayout] 当前为被动流程模式，不提供“我的编校审”入口');
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
      togglePanel('designerCommentHandling');
      return;
    case 'panel.designerCommentHandling':
      togglePanel('designerCommentHandling');
      return;
    case 'panel.annotationTable': {
      if (dockPanelExists('review')) {
        ensurePanelAndActivate('review');
        requestReviewerWorkbenchViewMode('table');
        return;
      }
      if (dockPanelExists('designerCommentHandling')) {
        ensurePanelAndActivate('designerCommentHandling');
        requestDesignerCommentViewMode('table');
        return;
      }
      const preferReviewer = userStore.isReviewer.value && !userStore.isDesigner.value;
      if (preferReviewer) {
        ensurePanelAndActivate('review');
        requestReviewerWorkbenchViewMode('table');
      } else {
        ensurePanelAndActivate('designerCommentHandling');
        requestDesignerCommentViewMode('table');
      }
      return;
    }
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
  embedSessionError.value = null;
  if (token) {
    setAuthToken(token);

    try {
      const verifyResponse = await authVerifyToken(token);
      if (!verifyResponse.data?.valid) {
        console.warn('[DockLayout] Embedded token verification failed:', verifyResponse.data?.error);
        clearAuthToken();
        embedTokenVerified.value = false;
        embedSessionError.value = `嵌入链接校验失败：${verifyResponse.data?.error || 'token 无效'}`;
      } else {
        embedTokenVerified.value = true;
        const claims = verifyResponse.data.claims;
        if (claims) {
          if (embedModeParams.value.launchInput?.userId && embedModeParams.value.launchInput.userId !== claims.userId) {
            console.warn('[DockLayout] 忽略 URL user_id，改用 token claims.userId', {
              urlUserId: embedModeParams.value.launchInput.userId,
              claimsUserId: claims.userId,
            });
          }
          if (embedModeParams.value.launchInput?.projectId && embedModeParams.value.launchInput.projectId !== claims.projectId) {
            console.warn('[DockLayout] 忽略 URL project_id，改用 token claims.projectId', {
              urlProjectId: embedModeParams.value.launchInput.projectId,
              claimsProjectId: claims.projectId,
            });
          }
          if (embedModeParams.value.launchInput?.workflowRole) {
            if (claims.role && embedModeParams.value.launchInput.workflowRole !== claims.role) {
              console.warn('[DockLayout] 忽略 URL workflow role，改用 token claims.role', {
                urlWorkflowRole: embedModeParams.value.launchInput.workflowRole,
                claimsWorkflowRole: claims.role,
              });
            } else if (!claims.role) {
              console.warn('[DockLayout] token claims 缺少 role，URL workflow role 不再作为可信身份源', {
                urlWorkflowRole: embedModeParams.value.launchInput.workflowRole,
              });
            }
          }
          embedModeParams.value = {
            ...embedModeParams.value,
            formId: claims.formId || embedModeParams.value.formId || null,
            userId: claims.userId,
            workflowRole: claims.role || null,
            projectId: claims.projectId,
            workflowMode: claims.workflowMode || embedModeParams.value.workflowMode || null,
            verifiedClaims: claims,
          };
        }
      }
    } catch (error) {
      console.warn('[DockLayout] Embedded token verification request failed:', error);
      clearAuthToken();
      embedTokenVerified.value = false;
      embedSessionError.value = '嵌入链接校验失败：认证请求异常';
    }
  }

  tryRegisterEmbedPostMessageBridge();

  const trustedEmbedIdentity = resolveTrustedEmbedIdentity(embedModeParams.value);
  if (token && (!embedTokenVerified.value || !trustedEmbedIdentity)) {
    if (embedTokenVerified.value && !trustedEmbedIdentity) {
      embedSessionError.value = '嵌入链接校验失败：缺少可信身份声明';
    }
    userStore.clearCurrentUserSelection();
    return;
  }

  await ensureUserStoreInitialized();

  if (trustedEmbedIdentity) {
    userStore.setEmbedUser(
      trustedEmbedIdentity.userId,
      trustedEmbedIdentity.workflowRole || undefined,
      { verified: true },
    );
  }

  await userStore.loadReviewTasks();
}

function persistEmbedLandingState(state: EmbedLandingState | null) {
  if (!state) return;

  sessionStorage.setItem(
    EMBED_MODE_PARAMS_STORAGE_KEY,
    JSON.stringify(buildPersistedEmbedModeParams(embedModeParams.value))
  );
  sessionStorage.setItem(EMBED_LANDING_STATE_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(EMBED_LANDING_STATE_UPDATED_EVENT, { detail: state }));
}

async function applyInitialLanding() {
  await bootstrapEmbedSession();
  closeBlockedReviewPanels();

  const trustedEmbedIdentity = resolveTrustedEmbedIdentity(embedModeParams.value);

  if (
    embedModeParams.value.isEmbedMode
    && embedModeParams.value.userToken
    && (!embedTokenVerified.value || !trustedEmbedIdentity)
  ) {
    clearEmbedLandingPersistence();
    closeEmbedLandingPanels();
    activatePanel('viewer');
    return;
  }

  if (embedModeParams.value.isEmbedMode) {
    const roleLandingTarget = resolveEmbedLandingTargetFromRole(trustedEmbedIdentity?.workflowRole);
    const landingTarget = roleLandingTarget;
    const passiveWorkflowMode = isPassiveWorkflowMode();

    if (landingTarget) {
      console.log('[DockLayout] 嵌入模式角色落点:', landingTarget);
      const { switchProjectById } = useModelProjects();
      let landingState = applyEmbedLandingState({
        ensurePanel,
        activatePanel,
        sessionStorageLike: sessionStorage,
        embedModeParams: embedModeParams.value,
        target: landingTarget,
        switchProjectById,
        passiveWorkflowMode,
      });

      const restoreResult = await restoreEmbedWorkbenchContext({
        target: landingTarget,
        formId: getVerifiedEmbedFormId(embedModeParams.value),
        loadReviewTasks: userStore.loadReviewTasks,
        reviewerTasks: () => userStore.pendingReviewTasks.value,
        designerTasks: () => userStore.returnedInitiatedTasks.value,
        allTasks: () => userStore.reviewTasks.value,
        setCurrentTask: reviewStore.setCurrentTask,
        openPanel,
        activatePanel,
        passiveWorkflowMode,
      });

      const fallbackLandingTarget = resolvePassiveEmbedViewTarget({
        workflowRole: trustedEmbedIdentity?.workflowRole,
        passiveWorkflowMode,
        formId: getVerifiedEmbedFormId(embedModeParams.value),
        restoredTaskSummary: restoreResult.restoredTaskSummary,
      });

      if (fallbackLandingTarget && fallbackLandingTarget !== landingTarget) {
        closeEmbedLandingPanels();
        landingState = applyEmbedLandingState({
          ensurePanel,
          activatePanel,
          sessionStorageLike: sessionStorage,
          embedModeParams: embedModeParams.value,
          target: fallbackLandingTarget,
          switchProjectById,
          passiveWorkflowMode,
        });
      }

      let restoredModelRefnos: string[] = [];
      const verifiedToken = embedModeParams.value.userToken;
      if (
        embedTokenVerified.value
        && trustedEmbedIdentity
        && verifiedToken
      ) {
        const snapshotRestore = await restoreEmbedFormSnapshotContext({
          formId: trustedEmbedIdentity.formId,
          token: verifiedToken,
          actor: {
            id: trustedEmbedIdentity.userId,
            name: trustedEmbedIdentity.userId,
            roles: trustedEmbedIdentity.workflowRole || 'sj',
          },
          importTools: (payload) => toolStore.importJSON(payload),
          syncTools: () => viewerContext.tools.value?.syncFromStore(),
          task: restoreResult.restoredTask,
          updateTask: async (mergedTask) => {
            restoreResult.restoredTask = mergedTask;
            if (restoreResult.restoredTaskDraft) {
              restoreResult.restoredTaskDraft = {
                ...restoreResult.restoredTaskDraft,
                components: [],
                attachments: mergedTask.attachments || [],
              };
            }
            await reviewStore.setCurrentTask(mergedTask);
          },
        });
        restoredModelRefnos = snapshotRestore.modelRefnos;
        restoreResult.restoredTask = snapshotRestore.task;
      }

      if (restoredModelRefnos.length > 0) {
        await ensureModelRefnosVisible(restoredModelRefnos, {
          taskId: restoreResult.restoredTaskId,
          formId: getVerifiedEmbedFormId(embedModeParams.value),
        });
      } else {
        await ensureRestoredTaskModelsVisible(restoreResult.restoredTask);
      }

      if (landingState) {
        const verifiedFormId = getVerifiedEmbedFormId(embedModeParams.value);
        const shouldShowDesignerCommentHandling = landingTarget === 'designer'
          && (
            !!restoreResult.restoredTask
            && (passiveWorkflowMode || isCanonicalReturnedTask(restoreResult.restoredTask))
          );
        persistEmbedLandingState({
          ...landingState,
          primaryPanelId: shouldShowDesignerCommentHandling ? 'designerCommentHandling' : landingState.primaryPanelId,
          visiblePanelIds: shouldShowDesignerCommentHandling ? ['designerCommentHandling'] : landingState.visiblePanelIds,
          formId: verifiedFormId,
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

  if (isEmbedLayoutMode()) {
    const landingTarget = resolveEmbedLandingTargetFromRole(embedModeParams.value.workflowRole);
    const primaryPanelId = landingTarget
      ? getEmbedLandingPanelIdsWithOptions(landingTarget, {
        passiveWorkflowMode: isPassiveWorkflowMode(),
      })[0] as 'review' | 'initiateReview' | 'designerCommentHandling' | undefined
      : undefined;
    createEmbedFocusedLayout(api.value, {
      primaryPanelId,
    });
  } else {
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
  }

  closeBlockedReviewPanels();

  event.api.onDidLayoutChange(() => {
    if (!isEmbedLayoutMode()) {
      saveLayout();
    }
    notifyDockLayoutChange();
  });

  if (!isEmbedLayoutMode()) {
    migratePropertiesPanelOnce();
  }

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
  if (!isEmbedLayoutMode()) {
    saveLayout();
  }
});

</script>

<template>
  <div class="dockview-container">
    <div v-if="embedSessionError"
      data-testid="embed-session-error"
      class="absolute left-1/2 top-3 z-[1100] -translate-x-1/2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shadow">
      {{ embedSessionError }}
    </div>
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
