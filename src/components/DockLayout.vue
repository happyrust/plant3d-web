<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue';

import { DockviewVue, type DockviewReadyEvent, themeLight } from 'dockview-vue';

import type { ReviewTask } from '@/types/auth';

import { authVerifyToken, clearAuthToken, setAuthToken } from '@/api/reviewApi';
import { openReviewAttachmentSplit } from '@/components/dock_panels/reviewAttachmentPreviewLayout';
import { restoreEmbedWorkbenchContext } from '@/components/review/embedContextRestore';
import { restoreEmbedFormSnapshotContext } from '@/components/review/embedFormSnapshotRestore';
import { attachEmbedPostMessageBridge, resolveEmbedBridgeTrust } from '@/components/review/embedPostMessageBridge';
import {
  applyEmbedLandingState,
  buildPersistedEmbedModeParams,
  EMBED_LANDING_STATE_STORAGE_KEY,
  EMBED_LANDING_STATE_UPDATED_EVENT,
  EMBED_MODE_PARAMS_STORAGE_KEY,
  getEmbedLandingPanelIdsWithOptions,
  getVerifiedEmbedFormId,
  getVerifiedEmbedWorkflowMode,
  isExternalFormFocusedMode,
  isExternalSjFormFocusedMode,
  readEmbedModeParamsFromSearch,
  resolveExternalFormFocusedLandingTarget,
  resolvePassiveEmbedViewTarget,
  resolveTrustedEmbedIdentity,
  resolveEmbedLandingTargetFromRole,
  type EmbedLandingState,
  type EmbedModeParams,
} from '@/components/review/embedRoleLanding';
import { isCanonicalReturnedTask, isSavedDesignerDraftTask } from '@/components/review/reviewTaskFilters';
import { resolvePassiveWorkflowMode } from '@/components/review/workflowMode';
import { DISPLAY_THEME_PRESETS, useDisplayThemeStore, type DisplayTheme } from '@/composables/useDisplayThemeStore';
import { dockPanelExists, ensurePanelAndActivate, setDockApi, notifyDockLayoutChange } from '@/composables/useDockApi';
import { useModelProjects } from '@/composables/useModelProjects';
import {
  initPanelZones,
  disposePanelZones,
  getCollapsedZones,
  toggleZone as togglePanelZone,
  onPanelOpened,
  resetZoneState,
  ZONE_PANELS,
  type ZoneName,
} from '@/composables/usePanelZones';
import { RENDER_STYLE_PRESETS, useRenderStyleStore, type RenderStyle } from '@/composables/useRenderStyleStore';
import { clearReviewAttachmentPreview } from '@/composables/useReviewAttachmentPreview';
import { useReviewStore } from '@/composables/useReviewStore';
import { setGlobalSelectedRefno } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';
import { onCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';
import { shouldOpenModelUnitVersionCompareFromUrl } from '@/utils/modelUnitVersionCompare';

const embedModeParams = ref<EmbedModeParams>(readEmbedModeParamsFromSearch(window.location.search));

const LAYOUT_STORAGE_KEY = 'plant3d-web-dock-layout-v3';
const LAYOUT_MIGRATION_PROPERTIES_KEY = 'plant3d-web-dock-layout-v3-migrated-properties';
const popoutUrl = `${import.meta.env.BASE_URL}popout.html`;

type DockviewGroupLike = {
  api: {
    readonly width: number;
    readonly height: number;
    setSize: (size: { width?: number; height?: number }) => void;
    location?: { type?: string };
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

type DockPanelAddOptions = {
  id: string;
  [key: string]: unknown;
};

type DockApi = {
  addPanel: (options: DockPanelAddOptions) => DockviewPanelLike;
  getPanel: (id: string) => DockviewPanelLike | undefined;
  getGroup: (id: string) => DockviewGroupLike | undefined;
  toJSON: () => unknown;
  fromJSON: (data: unknown) => void;
  onDidLayoutChange: (cb: () => void) => unknown;
  onDidAddGroup?: (cb: (group: DockviewGroupLike) => void) => unknown;
  onDidRemoveGroup?: (cb: (group: DockviewGroupLike) => void) => unknown;
  addPopoutGroup: (group: unknown) => void;
  activeGroup?: unknown;
};

const api = ref<DockApi | null>(null);

const reviewStore = useReviewStore();
const toolStore = useToolStore();
const userStore = useUserStore();
const viewerContext = useViewerContext();
const displayThemeStore = useDisplayThemeStore();
const renderStyleStore = useRenderStyleStore();

let offCommand: (() => void) | null = null;
let userStoreInitializationPromise: Promise<void> | null = null;
// 嵌入启动链（bootstrapEmbedSession → applyInitialLanding）是异步的，实例可能在 await 期间被卸载
// （App.vue 置 embedBootstrapPending 会重挂 DockLayout）。卸载后的实例不得再挂 postMessage 桥、
// 不得再动共享 store——否则桥泄漏成两份，每条 pms.* 被处理两遍（pre_action 并发存两笔撞版本门）。
let disposed = false;
const embedTokenVerified = ref(false);
const embedSessionError = ref<string | null>(null);
const invalidGridRetryScheduledIds = new Set<string>();
const invalidGridRetryCountById = new Map<string, number>();
const MAX_GRID_RETRY = 3;
const RETRY_DELAYS = [0, 50, 200];
const panelOpenWarningIds = new Set<string>();

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

// 任意 reviewer 角色（jd/sh/pz）经外部 PMS 流程打开带 form_id 的单据时，
// 统一在审核侧 ReviewPanel 内处理批注，不再让「批注处理」面板（DCH）/
// 「退回任务列表」/「发起编校审」/「待审核任务」这类内部入口出现。
// SJ 例外：只有当前 form_id 对应任务确认为 returned/rejected 时才进入 ReviewPanel。
// 产品规约：「不能跨 form_id 批注，看的就是对应单据的数据」。
// 详见 .plannotator/plan-sj-reject-ui.md §2 / §5 与
// 开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md §13/§14。
function inExternalFormFocusedMode(): boolean {
  return isExternalFormFocusedMode(embedModeParams.value);
}

// SJ 权限边界专用：用于「禁止 SJ 在外部模式下使用 review action / 创建新证据」
// 等场景，与上面 inExternalFormFocusedMode（form_id 收敛）正交。
function inExternalSjFormFocusedMode(): boolean {
  return isExternalSjFormFocusedMode(embedModeParams.value);
}

function isExternalSjReturnedFormFocused(): boolean {
  const task = reviewStore.currentTask.value;
  return !!(
    inExternalSjFormFocusedMode()
    && task
    && isCanonicalReturnedTask(task)
  );
}

function shouldCollapseExternalFormPanelsToReview(): boolean {
  if (!inExternalFormFocusedMode()) return false;
  if (inExternalSjFormFocusedMode()) {
    return isExternalSjReturnedFormFocused();
  }
  return true;
}

function closeBlockedReviewPanels() {
  const dockApi = api.value;
  if (!dockApi) return;
  if (!isPassiveWorkflowMode()) return;
  closePanelIfExists(dockApi, 'myTasks');
  if (shouldCollapseExternalFormPanelsToReview()) {
    // 外部 form_id 聚焦到审核侧时，所有「批注处理 / 退回任务列表 /
    // 发起编校审 / 待审核任务」入口都被收敛到 review 面板，避免出现第二个面板。
    closePanelIfExists(dockApi, 'designerCommentHandling');
    closePanelIfExists(dockApi, 'resubmissionTasks');
    closePanelIfExists(dockApi, 'initiateReview');
    closePanelIfExists(dockApi, 'reviewerTasks');
  }
}

function isInvalidGridElementError(error: unknown): boolean {
  return error instanceof Error && /Invalid grid element/i.test(error.message);
}

function warnPanelOpenSkipped(panelId: string, reason: string) {
  if (panelOpenWarningIds.has(panelId)) return;
  panelOpenWarningIds.add(panelId);
  console.warn('[DockLayout] 面板暂未打开', {
    panelId,
    reason,
  });
}

function scheduleInvalidGridRetry(panelId: string) {
  const normalizedPanelId = normalizeDockPanelId(panelId);
  if (invalidGridRetryScheduledIds.has(normalizedPanelId)) return;
  const attempt = invalidGridRetryCountById.get(normalizedPanelId) ?? 0;
  if (attempt >= MAX_GRID_RETRY) {
    warnPanelOpenSkipped(normalizedPanelId, `exceeded ${MAX_GRID_RETRY} retry attempts`);
    return;
  }
  invalidGridRetryScheduledIds.add(normalizedPanelId);
  const delay = RETRY_DELAYS[attempt] ?? 200;
  const doRetry = () => {
    invalidGridRetryScheduledIds.delete(normalizedPanelId);
    invalidGridRetryCountById.set(normalizedPanelId, attempt + 1);
    const panel = ensurePanel(normalizedPanelId);
    if (panel) {
      panel.api.setActive();
      return;
    }
    warnPanelOpenSkipped(normalizedPanelId, `retry ${attempt + 1}/${MAX_GRID_RETRY} did not create panel`);
  };
  if (delay === 0) {
    void nextTick(doRetry);
  } else {
    setTimeout(doRetry, delay);
  }
}

function isPanelOpenDeferred(panelId: string): boolean {
  const normalizedPanelId = normalizeDockPanelId(panelId);
  return invalidGridRetryScheduledIds.has(normalizedPanelId);
}

function addPanelSafely(
  dockApi: DockApi,
  options: DockPanelAddOptions,
): DockviewPanelLike | undefined {
  const existing = dockApi.getPanel(options.id);
  if (existing) return existing;
  try {
    return dockApi.addPanel(options);
  } catch (error) {
    if (!isInvalidGridElementError(error)) throw error;
    console.warn('[DockLayout] Dock 布局暂未就绪，延后创建面板', {
      panelId: options.id,
    });
    scheduleInvalidGridRetry(options.id);
    return dockApi.getPanel(options.id);
  }
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
let offWorkflowSyncBridge: (() => void) | null = null;

function tryRegisterWorkflowSyncBridge() {
  const shouldEnable = !disposed && embedModeParams.value.isEmbedMode && embedTokenVerified.value;
  if (!shouldEnable) {
    if (offWorkflowSyncBridge) {
      offWorkflowSyncBridge();
      offWorkflowSyncBridge = null;
    }
    return;
  }
  if (offWorkflowSyncBridge) return;

  // 只受理挂着本 iframe 的父页面（PMS）发来的 pre_action / workflow_changed；referrer 可得时再按 origin 过滤。
  // 此前不传 trustedOrigins，同页任意窗口都能替用户「确认当前数据」并调 workflow/sync（D9）。
  const bridgeTrust = resolveEmbedBridgeTrust();
  console.info('[DockLayout] workflow sync bridge trust', {
    trustedOrigins: bridgeTrust.trustedOrigins ?? null,
    parentOnly: !!bridgeTrust.trustedSource,
  });
  offWorkflowSyncBridge = attachEmbedPostMessageBridge({
    ...bridgeTrust,
    onPmsWorkflowPreAction: async (msg) => reviewStore.prepareExternalWorkflowAction({
      formId: msg.formId,
      action: msg.action,
    }),
    onPmsWorkflowChanged: async (msg) => reviewStore.applyExternalWorkflowChange({
      formId: msg.formId,
      action: msg.action,
      targetNode: msg.targetNode,
      comments: msg.comments,
      nextStep: msg.nextStep,
    }),
  });
}

function tryRegisterEmbedPostMessageBridge() {
  const shouldEnable = !disposed && embedModeParams.value.isEmbedMode && embedTokenVerified.value;
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

// dockview 增删分组时用 Sizing.Distribute 把空间按比例摊给剩余分组，
// 关掉右侧 dock 会连左侧 dock 一起拉大（反之亦然）。这里记住左右 dock
// 最近一次宽度，分组增删后恢复它，让中间 viewer 吸收全部空间变化。
const sideZoneSizeCache: Partial<Record<'left' | 'right', number>> = {};
const sideZonePresence: Record<'left' | 'right', boolean> = { left: false, right: false };

type SideZoneName = 'left' | 'right';

function isGridDockGroup(group: DockviewGroupLike): boolean {
  const locationType = group.api.location?.type;
  return !locationType || locationType === 'grid';
}

function findSideZoneGroup(zone: SideZoneName): DockviewGroupLike | undefined {
  const dockApi = api.value;
  if (!dockApi) return undefined;
  for (const panelId of ZONE_PANELS[zone]) {
    const group = dockApi.getPanel(panelId)?.group;
    if (group && isGridDockGroup(group)) return group;
  }
  return undefined;
}

function groupSideZone(group: DockviewGroupLike): SideZoneName | undefined {
  return (['left', 'right'] as const).find((zone) =>
    group.panels.some((panel) => ZONE_PANELS[zone].includes(panel.id)));
}

function rememberSideZoneSizes() {
  (['left', 'right'] as const).forEach((zone) => {
    const group = findSideZoneGroup(zone);
    if (group && group.api.width > 0) {
      sideZoneSizeCache[zone] = group.api.width;
    }
  });
}

function syncSideZonePresence() {
  (['left', 'right'] as const).forEach((zone) => {
    sideZonePresence[zone] = !!findSideZoneGroup(zone);
  });
}

function reapplySideZoneSizes(except?: DockviewGroupLike) {
  (['left', 'right'] as const).forEach((zone) => {
    const group = findSideZoneGroup(zone);
    if (!group || group === except) return;
    const cached = sideZoneSizeCache[zone];
    if (cached && Math.abs(group.api.width - cached) > 1) {
      group.api.setSize({ width: cached });
    }
  });
}

function handleDockGroupAdded(group: DockviewGroupLike) {
  if (isGridDockGroup(group)) {
    const zone = groupSideZone(group);
    const zoneReopened = !!zone && !sideZonePresence[zone];
    reapplySideZoneSizes(group);
    if (zone && zoneReopened) {
      const cached = sideZoneSizeCache[zone];
      if (cached && Math.abs(group.api.width - cached) > 1) {
        group.api.setSize({ width: cached });
      }
    }
  }
  syncSideZonePresence();
}

function handleDockGroupRemoved() {
  reapplySideZoneSizes();
  syncSideZonePresence();
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
    console.info('[DockLayout] 当前专用布局跳过普通布局持久化');
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
  clearReviewAttachmentPreview();
  closePanelIfExists(dockApi, 'properties');
  closePanelIfExists(dockApi, 'manager');
  closePanelIfExists(dockApi, 'hydraulic');
  closePanelIfExists(dockApi, 'annotation');
  closePanelIfExists(dockApi, 'measurement');
  closePanelIfExists(dockApi, 'dimension');
  closePanelIfExists(dockApi, 'ptset');
  closePanelIfExists(dockApi, 'modelTree');
  closePanelIfExists(dockApi, 'modelQuery');
  closePanelIfExists(dockApi, 'nearbyQuery');
  closePanelIfExists(dockApi, 'viewer');
  closePanelIfExists(dockApi, 'console');
  closePanelIfExists(dockApi, 'modelVersionCompare');
  closePanelIfExists(dockApi, 'reviewAttachmentPreview');
  closePanelIfExists(dockApi, 'spatialCompute');
  closePanelIfExists(dockApi, 'incrementRecords');

  const collapsedZones = getCollapsedZones();

  const viewerPanel = dockApi.addPanel({
    id: 'viewer',
    component: 'ViewerPanel',
    title: '三维查看器',
    renderer: 'always',
  });

  if (!collapsedZones.includes('left')) {
    dockApi.addPanel({
      id: 'modelTree',
      component: 'ModelTreePanel',
      title: '模型树',
      renderer: 'always',
      position: { referencePanel: viewerPanel, direction: 'left' },
    });
  }

  // 右侧默认只保留「属性」页，测量/尺寸标注/批注/管理等按需从 Ribbon 打开
  if (!collapsedZones.includes('right')) {
    dockApi.addPanel({
      id: 'properties',
      component: 'PropertiesPanel',
      title: '属性',
      position: { referencePanel: viewerPanel, direction: 'right' },
    });
  }

  // 概览（Dashboard）不加入默认布局，由 Ribbon「概览」或 ensurePanel 按需打开

  viewerPanel.api.setActive();

  const leftGroup = dockApi.getPanel('modelTree')?.group;
  const rightGroup = dockApi.getPanel('properties')?.group;
  if (leftGroup) leftGroup.api.setSize({ width: 350 });
  if (rightGroup) rightGroup.api.setSize({ width: 350 });

  if (!collapsedZones.includes('bottom')) {
    dockApi.addPanel({
      id: 'console',
      component: 'ConsolePanel',
      title: '控制台',
      position: { referencePanel: viewerPanel, direction: 'below' },
    });
    const bottomGroup = dockApi.getPanel('console')?.group;
    if (bottomGroup) bottomGroup.api.setSize({ height: 200 });
  }

  console.log('[DockLayout] Default layout created');
}

function createEmbedFocusedLayout(
  dockApi: DockApi,
  options: { primaryPanelId?: 'review' | 'initiateReview' | 'designerCommentHandling' } = {},
) {
  clearReviewAttachmentPreview();
  [
    'properties',
    'manager',
    'hydraulic',
    'annotation',
    'measurement',
    'dimension',
    'ptset',
    'modelTree',
    'modelQuery',
    'nearbyQuery',
    'viewer',
    'console',
    'review',
    'initiateReview',
    'reviewerTasks',
    'myTasks',
    'designerCommentHandling',
    'resubmissionTasks',
    'modelVersionCompare',
    'reviewAttachmentPreview',
    'materialConfig',
    'spatialCompute',
    'incrementRecords',
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

// 右侧 zone 里已存在的面板做锚点：新开的右侧面板并入现有右侧 dock 页签，
// 不会在 viewer 右侧再裂出一个并排的新分组。
function findRightZoneAnchorPanel(dockApi: DockApi): DockviewPanelLike | undefined {
  for (const panelId of ZONE_PANELS.right) {
    const panel = dockApi.getPanel(panelId);
    if (panel && (!panel.group || isGridDockGroup(panel.group))) return panel;
  }
  return undefined;
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
  const rightZoneAnchorPanel = findRightZoneAnchorPanel(dockApi);
  const rightZonePosition = () => (rightZoneAnchorPanel
    ? { referencePanel: rightZoneAnchorPanel, direction: 'within' }
    : viewerPanel
      ? { referencePanel: viewerPanel, direction: 'right' }
      : undefined);
  // onDidAddGroup 触发时新分组还没挂面板，识别不了 zone；右侧 zone 重新打开时
  // 直接给 initialWidth，让 dockview 建组时就用关闭前记住的宽度。
  const rightZoneExtras = () => ({
    position: rightZonePosition(),
    ...(!rightZoneAnchorPanel && sideZoneSizeCache.right
      ? { initialWidth: sideZoneSizeCache.right }
      : {}),
  });

  if (normalizedPanelId === 'modelTree') {
    return addPanelSafely(dockApi, {
      id: 'modelTree',
      component: 'ModelTreePanel',
      title: '模型树',
      renderer: 'always',
      position: viewerPanel ? { referencePanel: viewerPanel, direction: 'left' } : undefined,
      ...(sideZoneSizeCache.left ? { initialWidth: sideZoneSizeCache.left } : {}),
    });
  }
  if (normalizedPanelId === 'measurement') {
    return addPanelSafely(dockApi, {
      id: 'measurement',
      component: 'MeasurementPanel',
      title: '测量',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'dimension') {
    return addPanelSafely(dockApi, {
      id: 'dimension',
      component: 'DimensionPanel',
      title: '尺寸标注',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'annotation') {
    return addPanelSafely(dockApi, {
      id: 'annotation',
      component: 'AnnotationPanel',
      title: '批注',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'manager') {
    return addPanelSafely(dockApi, {
      id: 'manager',
      component: 'ManagerPanel',
      title: '管理',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'hydraulic') {
    return addPanelSafely(dockApi, {
      id: 'hydraulic',
      component: 'HydraulicPanel',
      title: '水力计算',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'properties') {
    return addPanelSafely(dockApi, {
      id: 'properties',
      component: 'PropertiesPanel',
      title: '属性',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'ptset') {
    return addPanelSafely(dockApi, {
      id: 'ptset',
      component: 'PtsetPanel',
      title: '点集',
      ...rightZoneExtras(),
    });
  }
  if (panelId === 'annotationStyle') {
    return addPanelSafely(dockApi, {
      id: 'annotationStyle',
      component: 'AnnotationStylePanel',
      title: '批注样式',
      ...rightZoneExtras(),
    });
  }
  if (panelId === 'materialConfig') {
    return addPanelSafely(dockApi, {
      id: 'materialConfig',
      component: 'DtxMaterialConfigPanel',
      title: '颜色配置',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'review') {
    return addPanelSafely(dockApi, {
      id: 'review',
      component: 'ReviewPanelDock',
      title: '校审',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'initiateReview') {
    return addPanelSafely(dockApi, {
      id: 'initiateReview',
      component: 'InitiateReviewPanel',
      title: '发起编校审',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'reviewerTasks') {
    return addPanelSafely(dockApi, {
      id: 'reviewerTasks',
      component: 'ReviewerTaskListPanel',
      title: '待审核任务',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'myTasks') {
    return addPanelSafely(dockApi, {
      id: 'myTasks',
      component: 'DesignerTaskListPanel',
      title: '我的编校审',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'designerCommentHandling') {
    return addPanelSafely(dockApi, {
      id: 'designerCommentHandling',
      component: 'DesignerCommentHandlingPanel',
      title: '批注处理',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'modelVersionCompare') {
    return addPanelSafely(dockApi, {
      id: 'modelVersionCompare',
      component: 'ModelVersionComparePanel',
      title: '版本对比',
      position: viewerPanel
        ? { referencePanel: viewerPanel, direction: 'right' }
        : undefined,
    });
  }
  if (normalizedPanelId === 'reviewAttachmentPreview') {
    return addPanelSafely(dockApi, {
      id: 'reviewAttachmentPreview',
      component: 'ReviewAttachmentPreviewPanel',
      title: '文档预览',
      position: viewerPanel
        ? { referencePanel: viewerPanel, direction: 'right' }
        : undefined,
    });
  }
  if (normalizedPanelId === 'console') {
    return addPanelSafely(dockApi, {
      id: 'console',
      component: 'ConsolePanel',
      title: '控制台',
      position: viewerPanel
        ? { referencePanel: viewerPanel, direction: 'below' }
        : undefined,
    });
  }
  if (normalizedPanelId === 'spatialCompute') {
    return addPanelSafely(dockApi, {
      id: 'spatialCompute',
      component: 'SpatialComputePanel',
      title: '中心线净距',
      ...rightZoneExtras(),
    });
  }
  if (normalizedPanelId === 'incrementRecords') {
    return addPanelSafely(dockApi, {
      id: 'incrementRecords',
      component: 'IncrementRecordsPanel',
      title: '增量记录',
      position: viewerPanel
        ? { referencePanel: viewerPanel, direction: 'below' }
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
  } else if (!isPanelOpenDeferred(normalizedPanelId)) {
    warnPanelOpenSkipped(normalizedPanelId, 'panel creation returned empty');
  }
}

function openReviewAttachmentPreviewPanel() {
  const dockApi = api.value;
  if (!dockApi) {
    console.warn('[DockLayout] openReviewAttachmentPreview: dockApi is null');
    return;
  }

  onPanelOpened('reviewAttachmentPreview');
  const opened = openReviewAttachmentSplit(
    dockApi,
    () => ensurePanel('reviewAttachmentPreview'),
  );
  if (!opened && !isPanelOpenDeferred('reviewAttachmentPreview')) {
    warnPanelOpenSkipped('reviewAttachmentPreview', 'panel open returned empty');
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
  } else if (!isPanelOpenDeferred(normalizedPanelId)) {
    warnPanelOpenSkipped(normalizedPanelId, 'panel open returned empty');
  }
}

function resetLayout() {
  if (!api.value) return;
  resetZoneState();
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
  if (isEmbedLayoutMode()) {
    const landingTarget = resolveEmbedLandingTargetFromRole(embedModeParams.value.workflowRole);
    const passiveWorkflowMode = isPassiveWorkflowMode();
    const effectiveLandingTarget = resolveExternalFormFocusedLandingTarget({
      target: landingTarget,
      workflowRole: embedModeParams.value.workflowRole,
      passiveWorkflowMode,
      formId: getVerifiedEmbedFormId(embedModeParams.value),
    });
    createEmbedFocusedLayout(api.value, {
      primaryPanelId: effectiveLandingTarget === 'reviewer' ? 'review' : undefined,
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
    case 'view.attr.all':
      toolStore.setAttributeDisplayMode('all');
      openPanel('properties');
      return;
    case 'view.attr.general':
      toolStore.setAttributeDisplayMode('general');
      openPanel('properties');
      return;
    case 'view.attr.component':
      toolStore.setAttributeDisplayMode('component');
      openPanel('properties');
      return;
    case 'view.attr.uda':
      toolStore.setAttributeDisplayMode('uda');
      openPanel('properties');
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
    case 'panel.modelGeneration':
      ensurePanelAndActivate('viewer');
      window.dispatchEvent(new CustomEvent('openModelGeneration'));
      return;
    case 'panel.spatialCompute':
      openPanel('spatialCompute');
      return;
    case 'panel.ptset':
      togglePanel('ptset');
      return;
    case 'panel.materialConfig':
      togglePanel('materialConfig');
      return;
    case 'annotation.settings':
      togglePanel('annotationStyle');
      return;
    case 'displayTheme.e3d':
    case 'displayTheme.default':
    case 'displayTheme.design3d': {
      // 持久化在这里做（DockLayout 常驻）：ViewerPanel 通过 watch currentTheme 落到已装载场景
      const theme = commandId.slice('displayTheme.'.length) as DisplayTheme;
      displayThemeStore.setDisplayTheme(theme);
      const label = DISPLAY_THEME_PRESETS.find((preset) => preset.mode === theme)?.label ?? theme;
      emitToast({ message: `显示主题已切换为「${label}」`, level: 'success' });
      return;
    }
    case 'renderStyle.e3d':
    case 'renderStyle.engineering':
    case 'renderStyle.pbr':
    case 'renderStyle.wireframe':
    case 'renderStyle.xray': {
      // 同 displayTheme：持久化在这里做，ViewerPanel watch currentStyle 后整套应用
      const style = commandId.slice('renderStyle.'.length) as RenderStyle;
      renderStyleStore.setRenderStyle(style);
      const label = RENDER_STYLE_PRESETS.find((preset) => preset.mode === style)?.label ?? style;
      emitToast({ message: `绘制样式已切换为「${label}」`, level: 'success' });
      return;
    }
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
    case 'panel.resubmissionTasks':
      if (shouldCollapseExternalFormPanelsToReview()) {
        // 外部 form_id 模式确认需要审核侧处理时，「退回任务」收敛到 review 面板。
        ensurePanelAndActivate('review');
        return;
      }
      togglePanel('designerCommentHandling');
      return;
    case 'panel.designerCommentHandling':
      if (shouldCollapseExternalFormPanelsToReview()) {
        ensurePanelAndActivate('review');
        return;
      }
      togglePanel('designerCommentHandling');
      return;
    case 'panel.annotationTable': {
      if (shouldCollapseExternalFormPanelsToReview()) {
        // 外部 form_id 模式确认需要审核侧处理时，强制走 review 面板的统一批注单。
        ensurePanelAndActivate('review');
        return;
      }
      if (dockPanelExists('review')) {
        ensurePanelAndActivate('review');
        return;
      }
      if (dockPanelExists('designerCommentHandling')) {
        ensurePanelAndActivate('designerCommentHandling');
        return;
      }
      const preferReviewer = userStore.isReviewer.value && !userStore.isDesigner.value;
      if (preferReviewer) {
        ensurePanelAndActivate('review');
      } else {
        ensurePanelAndActivate('designerCommentHandling');
      }
      return;
    }
    case 'panel.console':
      togglePanel('console');
      return;
    case 'panel.modelVersionCompare':
      togglePanel('modelVersionCompare');
      return;
    case 'panel.incrementRecords':
      togglePanel('incrementRecords');
      return;
    case 'panel.reviewAttachmentPreview':
      openReviewAttachmentPreviewPanel();
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
        void (async () => {
          try {
            await reviewStore.addConfirmedRecord({
              type: 'batch',
              annotations: [...toolStore.annotations.value],
              cloudAnnotations: [...toolStore.cloudAnnotations.value],
              rectAnnotations: [...toolStore.rectAnnotations.value],
              obbAnnotations: [...toolStore.obbAnnotations.value],
              measurements: [...toolStore.measurements.value],
              note: '',
            });
            toolStore.clearAll();
          } catch (error) {
            console.error('[DockLayout] review.confirm failed:', error);
          }
        })();
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

// 旧版默认布局会把「测量/尺寸标注/批注/管理/属性」整套塞进右侧 dock 并随即持久化，
// 导致之后每次启动都恢复出这一坨页签。识别「面板集合与旧默认完全一致」的存档，
// 不视为用户操作历史，直接按新默认布局重建（右侧只留「属性」）。
const LEGACY_DEFAULT_PANEL_IDS = [
  'annotation',
  'console',
  'dimension',
  'manager',
  'measurement',
  'modelTree',
  'properties',
  'viewer',
];

function isLegacyDefaultLayout(layout: unknown): boolean {
  if (!isValidLayout(layout)) return false;
  const panels = (layout as { panels: Record<string, unknown> }).panels;
  const ids = Object.keys(panels).sort();
  const legacy = [...LEGACY_DEFAULT_PANEL_IDS].sort();
  return ids.length === legacy.length && ids.every((id, index) => id === legacy[index]);
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

  if (disposed) return;

  tryRegisterEmbedPostMessageBridge();
  tryRegisterWorkflowSyncBridge();

  const trustedEmbedIdentity = resolveTrustedEmbedIdentity(embedModeParams.value);
  if (token && (!embedTokenVerified.value || !trustedEmbedIdentity)) {
    if (embedTokenVerified.value && !trustedEmbedIdentity) {
      embedSessionError.value = '嵌入链接校验失败：缺少可信身份声明';
    }
    userStore.clearCurrentUserSelection();
    return;
  }

  if (trustedEmbedIdentity) {
    userStore.setEmbedUser(
      trustedEmbedIdentity.userId,
      trustedEmbedIdentity.workflowRole || undefined,
      { verified: true },
    );
    await userStore.loadReviewTasks();
    return;
  }

  await ensureUserStoreInitialized();
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

let previewEmbedFormId = getVerifiedEmbedFormId(embedModeParams.value);

function handleEmbedFormFocusChanged(event: Event) {
  const nextFormId = (event as CustomEvent<EmbedLandingState>).detail?.formId?.trim() || null;
  if (nextFormId === previewEmbedFormId) return;
  previewEmbedFormId = nextFormId;
  clearReviewAttachmentPreview();
  if (api.value) closePanelIfExists(api.value, 'reviewAttachmentPreview');
}

async function applyInitialLanding() {
  await bootstrapEmbedSession();
  if (disposed) return;
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
    const passiveWorkflowMode = isPassiveWorkflowMode();
    const verifiedFormId = getVerifiedEmbedFormId(embedModeParams.value);
    const landingTarget = resolveExternalFormFocusedLandingTarget({
      target: roleLandingTarget,
      workflowRole: trustedEmbedIdentity?.workflowRole,
      passiveWorkflowMode,
      formId: verifiedFormId,
    });
    const isExternalSjFormFocused = !!(
      passiveWorkflowMode
      && verifiedFormId
      && trustedEmbedIdentity?.workflowRole?.trim().toLowerCase() === 'sj'
    );

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
        formId: verifiedFormId,
        loadReviewTasks: userStore.loadReviewTasks,
        reviewerTasks: () => isExternalSjFormFocused
          ? userStore.returnedInitiatedTasks.value
          : userStore.pendingReviewTasks.value,
        designerTasks: () => userStore.returnedInitiatedTasks.value,
        allTasks: () => userStore.reviewTasks.value,
        setCurrentTask: reviewStore.setCurrentTask,
        openPanel,
        activatePanel,
        passiveWorkflowMode,
        loadTaskByFormId: userStore.loadReviewTaskByFormId,
        returnedDesignerTaskPanel: isExternalSjFormFocused ? 'review' : 'designerCommentHandling',
      });
      if (disposed) return;

      const fallbackLandingTarget = resolvePassiveEmbedViewTarget({
        workflowRole: trustedEmbedIdentity?.workflowRole,
        passiveWorkflowMode,
        formId: verifiedFormId,
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
      let restoredWorkflowRecordCount = 0;
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
        restoredWorkflowRecordCount = snapshotRestore.recordCount;
        restoreResult.restoredTask = snapshotRestore.task;
      }
      if (disposed) return;

      if (restoredModelRefnos.length > 0) {
        await ensureModelRefnosVisible(restoredModelRefnos, {
          taskId: restoreResult.restoredTaskId,
          formId: verifiedFormId,
        });
      } else {
        await ensureRestoredTaskModelsVisible(restoreResult.restoredTask);
      }

      if (landingState) {
        const shouldShowReturnedSjReviewPanel = landingTarget === 'designer'
          && isExternalSjFormFocused
          && !!restoreResult.restoredTask
          && isCanonicalReturnedTask(restoreResult.restoredTask);
        const shouldShowDesignerCommentHandling = landingTarget === 'designer'
          && !shouldShowReturnedSjReviewPanel
          && (
            (
              !!restoreResult.restoredTask
              && isCanonicalReturnedTask(restoreResult.restoredTask)
            )
            || (
              !isExternalSjFormFocused
              && passiveWorkflowMode
              && restoredWorkflowRecordCount > 0
              && !!verifiedFormId
            )
          );
        if (shouldShowReturnedSjReviewPanel) {
          if (api.value) {
            closePanelIfExists(api.value, 'initiateReview');
            closePanelIfExists(api.value, 'designerCommentHandling');
          }
          openPanel('review');
          activatePanel('review');
        }
        if (shouldShowDesignerCommentHandling) {
          // 设计端进入「批注处理」流程时不再展示「发起编校审」面板，
          // 该面板仅服务于新建编校审场景，与处理已退回单据的语义冲突。
          if (api.value) {
            closePanelIfExists(api.value, 'initiateReview');
          }
          openPanel('designerCommentHandling');
          activatePanel('designerCommentHandling');
        }
        const shouldShowSavedDraftInitiate = landingTarget === 'designer'
          && isExternalSjFormFocused
          && !shouldShowReturnedSjReviewPanel
          && !shouldShowDesignerCommentHandling
          && !!restoreResult.restoredTask
          && isSavedDesignerDraftTask(restoreResult.restoredTask);
        const landingPanelOverride = shouldShowReturnedSjReviewPanel
          ? 'review'
          : shouldShowDesignerCommentHandling
            ? 'designerCommentHandling'
            : shouldShowSavedDraftInitiate
              ? 'initiateReview'
              : null;
        persistEmbedLandingState({
          ...landingState,
          primaryPanelId: landingPanelOverride ?? landingState.primaryPanelId,
          visiblePanelIds: landingPanelOverride ? [landingPanelOverride] : landingState.visiblePanelIds,
          formId: verifiedFormId,
          restoreStatus: restoreResult.restoreStatus,
          restoredTaskId: restoreResult.restoredTaskId,
          restoredTaskSummary: restoreResult.restoredTaskSummary,
          restoredTaskDraft: restoreResult.restoredTaskDraft,
          matchedSource: restoreResult.matchedSource,
          missReason: restoreResult.missReason,
        });
        if (shouldShowSavedDraftInitiate) {
          // 落点状态（含 restoredTaskDraft）先写好再开面板，面板挂载时直接按「修改已保存的编校审单」回填
          openPanel('initiateReview');
          activatePanel('initiateReview');
        }
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
    api.value,
    ensurePanel,
  );

  if (isEmbedLayoutMode()) {
    const landingTarget = resolveEmbedLandingTargetFromRole(embedModeParams.value.workflowRole);
    const passiveWorkflowMode = isPassiveWorkflowMode();
    const effectiveLandingTarget = resolveExternalFormFocusedLandingTarget({
      target: landingTarget,
      workflowRole: embedModeParams.value.workflowRole,
      passiveWorkflowMode,
      formId: getVerifiedEmbedFormId(embedModeParams.value),
    });
    const landingPanelId = landingTarget
      ? getEmbedLandingPanelIdsWithOptions(landingTarget, {
        passiveWorkflowMode,
        formId: getVerifiedEmbedFormId(embedModeParams.value),
        workflowRole: embedModeParams.value.workflowRole,
      })[0]
      : undefined;
    createEmbedFocusedLayout(api.value, {
      primaryPanelId: effectiveLandingTarget && landingPanelId !== 'viewer'
        ? landingPanelId as 'review' | 'initiateReview' | 'designerCommentHandling'
        : undefined,
    });
  } else {
    const savedLayout = localStorage.getItem(LAYOUT_STORAGE_KEY);
    let loaded = false;

    if (savedLayout) {
      try {
        const layout = JSON.parse(savedLayout);
        if (isValidLayout(layout) && !isLegacyDefaultLayout(layout)) {
          event.api.fromJSON(layout);
          loaded = true;
          console.log('[DockLayout] Layout restored from localStorage');
        } else {
          if (isValidLayout(layout)) {
            console.info('[DockLayout] 检测到旧版默认布局存档，按新默认布局重建');
          } else {
            console.warn('[DockLayout] Invalid layout data, skipping restore');
          }
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

  // 记录左右 dock 的当前宽度作为恢复基准，再监听分组增删
  rememberSideZoneSizes();
  syncSideZonePresence();
  api.value.onDidAddGroup?.(handleDockGroupAdded);
  api.value.onDidRemoveGroup?.(handleDockGroupRemoved);

  event.api.onDidLayoutChange(() => {
    if (!isEmbedLayoutMode()) {
      saveLayout();
    }
    rememberSideZoneSizes();
    syncSideZonePresence();
    notifyDockLayoutChange();
  });

  if (!isEmbedLayoutMode()) {
    migratePropertiesPanelOnce();
  }

  // 设置标签页右键菜单
  setupTabContextMenu();

  void applyInitialLanding();

  // URL `unit_refno=…&compare_autorun=1`（Q16）：把版本对比面板打开，面板自己接着查版本、选 A/B、跑对比
  if (!isEmbedLayoutMode() && shouldOpenModelUnitVersionCompareFromUrl(window.location.search)) {
    openPanel('modelVersionCompare');
  }
}

onMounted(() => {
  if (!offCommand) {
    offCommand = onCommand(handleRibbonCommand);
  }
  window.addEventListener(EMBED_LANDING_STATE_UPDATED_EVENT, handleEmbedFormFocusChanged);
});

onUnmounted(() => {
  disposed = true;

  if (offCommand) {
    offCommand();
    offCommand = null;
  }

  if (offEmbedPostMessage) {
    offEmbedPostMessage();
    offEmbedPostMessage = null;
  }

  if (offWorkflowSyncBridge) {
    offWorkflowSyncBridge();
    offWorkflowSyncBridge = null;
  }

  window.removeEventListener(EMBED_LANDING_STATE_UPDATED_EVENT, handleEmbedFormFocusChanged);
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

<style scoped>
</style>
