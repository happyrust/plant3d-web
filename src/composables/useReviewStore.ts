import { computed, onMounted, ref, watch } from 'vue';

import { useToolStore } from './useToolStore';

import type {
  AnnotationRecord,
  CloudAnnotationRecord,
  MeasurementRecord,
  ObbAnnotationRecord,
  RectAnnotationRecord,
} from './useToolStore';
import type { DimensionDocumentSession } from '@/dimension';
import type { ReviewTask, WorkflowNode } from '@/types/auth';

import {
  reviewRecordCreate,
  reviewRecordDelete,
  reviewRecordGetByTaskId,
  reviewRecordClearByTaskId,
  reviewTaskGetById,
  reviewTaskGetHistory,
  reviewWorkflowSyncMutation,
  reviewVerifyWorkflow,
  getReviewUserWebSocketUrl,
  type ConfirmedRecordData,
  type ReviewAnnotationCheckResult,
  type ReviewHistoryItem,
  type WorkflowVerifyData,
  type WorkflowVerifyNextStep,
} from '@/api/reviewApi';
import {
  readPersistedEmbedModeParams,
  resolveTrustedEmbedIdentity,
} from '@/components/review/embedRoleLanding';
import {
  buildReviewConfirmSnapshotPayload,
  buildReviewConfirmSnapshotPayloadFromRecords,
  buildUnsavedReviewConfirmPayload,
  hasReviewConfirmPayloadData,
} from '@/components/review/reviewPanelActions';
import { useUserStore } from '@/composables/useUserStore';
import {
  dimensionConflictStateFromError,
  dimensionDocumentFromSnapshot,
  dimensionDocumentToSnapshot,
  type DimensionDocumentState,
  type ReplayPendingCommandsResult,
  type SnapshotDimensionDocument,
} from '@/dimension';

export type ConfirmedRecord = {
  id: string;
  taskId?: string;
  formId?: string;
  type: 'batch';
  annotations: AnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
  obbAnnotations?: ObbAnnotationRecord[];
  measurements: MeasurementRecord[];
  dimensionDocument?: SnapshotDimensionDocument;
  dimensionDocumentVersion?: number;
  confirmedAt: number;
  note: string;
};

type ReviewPersistedState = {
  version: 2;
  reviewMode: boolean;
  confirmedRecords: ConfirmedRecord[];
  useBackend: boolean;
};

const STORAGE_KEY = 'plant3d-web-review-v2';
const STORAGE_KEY_V1 = 'plant3d-web-review-v1';

// 配置：是否使用后端 API
const USE_BACKEND = ref(true);

function loadPersisted(): ReviewPersistedState {
  if (typeof localStorage === 'undefined') {
    return { version: 2, reviewMode: false, confirmedRecords: [], useBackend: true };
  }

  try {
    // 尝试加载 V2
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ReviewPersistedState;
      if (parsed && parsed.version === 2) {
        return {
          version: 2,
          reviewMode: parsed.reviewMode ?? false,
          confirmedRecords: Array.isArray(parsed.confirmedRecords) ? parsed.confirmedRecords : [],
          useBackend: parsed.useBackend ?? true,
        };
      }
    }

    // 兼容 V1
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const parsed = JSON.parse(rawV1);
      if (parsed && parsed.version === 1) {
        return {
          version: 2,
          reviewMode: parsed.reviewMode ?? false,
          confirmedRecords: Array.isArray(parsed.confirmedRecords) ? parsed.confirmedRecords : [],
          useBackend: true,
        };
      }
    }
  } catch {
    // ignore
  }

  return { version: 2, reviewMode: false, confirmedRecords: [], useBackend: true };
}

const persisted = loadPersisted();
USE_BACKEND.value = persisted.useBackend;

const reviewMode = ref<boolean>(persisted.reviewMode);
const confirmedRecords = ref<ConfirmedRecord[]>([]);
const currentTask = ref<ReviewTask | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const reviewHistory = ref<ReviewHistoryItem[]>([]);
let activeDimensionDocumentSession: DimensionDocumentSession | null = null;
let activeDimensionDocumentUnsubscribe: (() => void) | null = null;
const dimensionDocumentDirty = ref(false);
const dimensionDocumentRecordCount = ref(0);
export type DimensionReviewConflict = Readonly<{
  latest: DimensionDocumentState;
  preview: ReplayPendingCommandsResult;
}>;
const dimensionDocumentConflict = ref<DimensionReviewConflict | null>(null);

function bindDimensionDocumentSession(
  session: DimensionDocumentSession | null,
): () => void {
  activeDimensionDocumentUnsubscribe?.();
  activeDimensionDocumentUnsubscribe = null;
  activeDimensionDocumentSession = session;
  dimensionDocumentConflict.value = null;
  dimensionDocumentDirty.value = session?.dirty ?? false;
  dimensionDocumentRecordCount.value = session?.state.records.length ?? 0;
  if (session) {
    activeDimensionDocumentUnsubscribe = session.subscribe((state) => {
      if (activeDimensionDocumentSession !== session) return;
      dimensionDocumentDirty.value = session.dirty;
      dimensionDocumentRecordCount.value = state.records.length;
    });
  }
  return () => {
    if (activeDimensionDocumentSession === session) {
      activeDimensionDocumentUnsubscribe?.();
      activeDimensionDocumentUnsubscribe = null;
      activeDimensionDocumentSession = null;
      dimensionDocumentDirty.value = false;
      dimensionDocumentRecordCount.value = 0;
      dimensionDocumentConflict.value = null;
    }
  };
}

function clearBoundDimensionDocumentSession(): void {
  activeDimensionDocumentUnsubscribe?.();
  activeDimensionDocumentUnsubscribe = null;
  activeDimensionDocumentSession = null;
  dimensionDocumentDirty.value = false;
  dimensionDocumentRecordCount.value = 0;
  dimensionDocumentConflict.value = null;
}

function getBoundDimensionConfirmPayload(): Readonly<{
  dimensionDocument?: SnapshotDimensionDocument;
  dimensionDocumentVersion?: number;
}> {
  const state = activeDimensionDocumentSession?.state;
  return state
    ? {
      dimensionDocument: dimensionDocumentToSnapshot(state),
      dimensionDocumentVersion: state.baseVersion,
    }
    : {};
}

function resolveDimensionDocumentConflict(
  action: 'replay' | 'discard',
): boolean {
  const session = activeDimensionDocumentSession;
  const conflict = dimensionDocumentConflict.value;
  if (!session || !conflict) return false;
  if (action === 'replay') {
    session.acceptReplayedState(conflict.preview);
  } else {
    session.discardPendingCommands(conflict.latest);
  }
  dimensionDocumentConflict.value = null;
  return true;
}

// WebSocket 连接状态
const wsConnected = ref(false);
const wsError = ref<string | null>(null);
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectCount = 0;
const MAX_RECONNECT = 5;
const RECONNECT_DELAY = 3000;

// 本地持久化
watch(
  () => ({
    reviewMode: reviewMode.value,
    confirmedRecords: confirmedRecords.value,
  }),
  (state) => {
    if (typeof localStorage === 'undefined') return;
    if (USE_BACKEND.value) return; // 使用后端时不本地保存

    const payload: ReviewPersistedState = {
      version: 2,
      reviewMode: state.reviewMode,
      confirmedRecords: state.confirmedRecords,
      useBackend: USE_BACKEND.value,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  },
  { deep: true }
);

function setReviewMode(mode: boolean) {
  reviewMode.value = mode;
}

function toggleReviewMode() {
  reviewMode.value = !reviewMode.value;
}

// ============ 确认记录操作 ============

async function addConfirmedRecord(
  record: Omit<ConfirmedRecord, 'id' | 'confirmedAt'>
): Promise<string> {
  const taskId = currentTask.value?.id;
  const formId = currentTask.value?.formId?.trim() || record.formId;

  if (!USE_BACKEND.value) {
    const message = '校审确认记录必须保存到数据库，当前不允许切换到本地模式';
    error.value = message;
    throw new Error(message);
  }

  if (!taskId) {
    const message = '当前未关联校审任务，无法将批注/测量保存到数据库';
    error.value = message;
    throw new Error(message);
  }

  loading.value = true;
  error.value = null;
  try {
    const boundDimensionState = activeDimensionDocumentSession?.state;
    const dimensionDocument = record.dimensionDocument
      ?? (boundDimensionState
        ? dimensionDocumentToSnapshot(boundDimensionState)
        : undefined);
    const dimensionDocumentVersion = record.dimensionDocumentVersion
      ?? boundDimensionState?.baseVersion;
    const response = await reviewRecordCreate({
      taskId,
      formId,
      type: record.type,
      annotations: record.annotations,
      cloudAnnotations: record.cloudAnnotations,
      rectAnnotations: record.rectAnnotations,
      obbAnnotations: record.obbAnnotations ?? [],
      measurements: record.measurements,
      dimensionDocument,
      dimensionDocumentBaseVersion: dimensionDocumentVersion,
      note: record.note,
    });

    if (response.success && response.record) {
      const newRecord: ConfirmedRecord = {
        id: response.record.id,
        taskId,
        formId: response.record.formId || formId,
        type: 'batch',
        annotations: record.annotations,
        cloudAnnotations: record.cloudAnnotations,
        rectAnnotations: record.rectAnnotations,
        obbAnnotations: record.obbAnnotations ?? [],
        measurements: record.measurements,
        dimensionDocument: response.record.dimensionDocument,
        dimensionDocumentVersion: response.record.dimensionDocumentVersion,
        confirmedAt: response.record.confirmedAt,
        note: record.note,
      };
      if (dimensionDocument) {
        if (
          !response.record.dimensionDocument
          || response.record.dimensionDocumentVersion === undefined
        ) {
          throw new Error('保存确认记录成功，但后端未返回尺寸文档版本');
        }
        if (
          activeDimensionDocumentSession?.state.documentId
          === response.record.dimensionDocument.documentId
        ) {
          activeDimensionDocumentSession.acceptSavedState(
            dimensionDocumentFromSnapshot(
              response.record.dimensionDocument,
              {
                taskId,
                formId: response.record.formId || formId,
                baseVersion: response.record.dimensionDocumentVersion,
              },
            ),
          );
        }
      }
      const nextRecords = [...confirmedRecords.value];
      const existingIndex = nextRecords.findIndex((item) => item.id === newRecord.id);
      if (existingIndex >= 0) {
        nextRecords.splice(existingIndex, 1, newRecord);
      } else {
        nextRecords.push(newRecord);
      }
      confirmedRecords.value = nextRecords;
      dimensionDocumentConflict.value = null;
      return newRecord.id;
    }

    throw new Error(response.error_message || '保存确认记录失败');
  } catch (e) {
    const session = activeDimensionDocumentSession;
    if (session) {
      const latest = dimensionConflictStateFromError(e, { taskId, formId });
      if (latest) {
        const preview = session.previewPendingCommands(latest);
        dimensionDocumentConflict.value = { latest, preview };
        const rejected = preview.rejected.length;
        const suffix = rejected > 0
          ? `，其中 ${rejected} 条命令无法重放`
          : '';
        const conflictError = new Error(
          `尺寸文档已被其他用户更新，请选择重放本地修改或放弃本地修改${suffix}`,
        );
        error.value = conflictError.message;
        throw conflictError;
      }
    }
    error.value = e instanceof Error ? e.message : '保存确认记录失败';
    throw e;
  } finally {
    loading.value = false;
  }
}

async function removeConfirmedRecord(id: string): Promise<void> {
  let canRemoveLocal = true;

  if (USE_BACKEND.value) {
    loading.value = true;
    error.value = null;
    try {
      const response = await reviewRecordDelete(id);
      if (!response.success) {
        throw new Error(response.error_message || '删除确认记录失败');
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除确认记录失败';
      canRemoveLocal = false;
    } finally {
      loading.value = false;
    }
  }

  if (canRemoveLocal) {
    confirmedRecords.value = confirmedRecords.value.filter((r) => r.id !== id);
  }
}

async function clearConfirmedRecords(): Promise<boolean> {
  const taskId = currentTask.value?.id;

  if (USE_BACKEND.value && taskId) {
    loading.value = true;
    error.value = null;
    try {
      const response = await reviewRecordClearByTaskId(taskId);
      if (!response.success) {
        throw new Error(response.error_message || '清空确认记录失败');
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '清空确认记录失败';
      return false;
    } finally {
      loading.value = false;
    }
  }

  confirmedRecords.value = [];
  return true;
}

async function loadConfirmedRecords(
  taskId: string,
  options?: { formId?: string | null },
): Promise<void> {
  if (!USE_BACKEND.value) return;

  loading.value = true;
  error.value = null;
  try {
    let response = await reviewRecordGetByTaskId(taskId, {
      formId: options?.formId,
    });
    const scopedFormId = options?.formId?.trim();
    let usedTaskScopeFallback = false;
    if (response.success && scopedFormId && (response.records?.length ?? 0) === 0) {
      response = await reviewRecordGetByTaskId(taskId, {
        formId: undefined,
      });
      usedTaskScopeFallback = true;
    }
    if (response.success && response.records) {
      const records = usedTaskScopeFallback && scopedFormId
        ? response.records.filter((r) => {
          const recordFormId = r.formId?.trim();
          return !recordFormId || recordFormId === scopedFormId;
        })
        : response.records;
      confirmedRecords.value = records.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        formId: r.formId,
        type: 'batch' as const,
        annotations: r.annotations as AnnotationRecord[],
        cloudAnnotations: r.cloudAnnotations as CloudAnnotationRecord[],
        rectAnnotations: r.rectAnnotations as RectAnnotationRecord[],
        obbAnnotations: ((r as unknown as { obbAnnotations?: unknown[] }).obbAnnotations ?? []) as ObbAnnotationRecord[],
        measurements: r.measurements as MeasurementRecord[],
        dimensionDocument: r.dimensionDocument,
        dimensionDocumentVersion: r.dimensionDocumentVersion,
        confirmedAt: r.confirmedAt,
        note: r.note,
      }));
    } else if (response.error_message) {
      throw new Error(response.error_message);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载确认记录失败';
  } finally {
    loading.value = false;
  }
}

// ============ 审核历史 ============

async function loadReviewHistory(taskId: string): Promise<void> {
  if (!USE_BACKEND.value) {
    reviewHistory.value = [];
    return;
  }

  try {
    const response = await reviewTaskGetHistory(taskId);
    if (response.success) {
      reviewHistory.value = response.history;
    }
  } catch (e) {
    console.warn('[ReviewStore] Failed to load review history:', e);
  }
}

// ============ 当前任务管理 ============

async function setCurrentTask(task: ReviewTask | null) {
  if (task?.id !== currentTask.value?.id) {
    clearBoundDimensionDocumentSession();
  }
  if (task && USE_BACKEND.value && task.id?.trim()) {
    try {
      const response = await reviewTaskGetById(task.id);
      if (response.success && response.task) {
        task = {
          ...task,
          ...response.task,
          formId: response.task.formId || task.formId,
          description: response.task.description || task.description,
          modelName: response.task.modelName || task.modelName,
          components: response.task.components.length > 0 ? response.task.components : task.components,
          attachments: response.task.attachments ?? task.attachments,
          workflowHistory: response.task.workflowHistory ?? task.workflowHistory,
        };
      }
    } catch (error) {
      console.warn('[ReviewStore] Failed to hydrate task detail:', {
        taskId: task.id,
        error,
      });
    }
  }

  currentTask.value = task;
  if (task) {
    reviewMode.value = true;
    // 任务详情与确认记录先恢复，历史流转失败或超时不阻断详情页批注/评论。
    await loadConfirmedRecords(task.id, { formId: task.formId });
    void loadReviewHistory(task.id);
    // 连接 WebSocket 获取实时更新
    connectWebSocket(resolveRealtimeUserId());
  } else {
    disconnectWebSocket();
    confirmedRecords.value = [];
    reviewHistory.value = [];
  }
}

function clearCurrentTask() {
  clearBoundDimensionDocumentSession();
  currentTask.value = null;
  disconnectWebSocket();
}

// ============ WebSocket 连接 ============

const WS_HEARTBEAT_INTERVAL = 30_000; // 30秒心跳间隔
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// comment_added 事件回调（由外部组件注册）
type CommentAddedCallback = (data: unknown) => void;
const commentAddedCallbacks: CommentAddedCallback[] = [];

function onCommentAdded(callback: CommentAddedCallback) {
  commentAddedCallbacks.push(callback);
  return () => {
    const idx = commentAddedCallbacks.indexOf(callback);
    if (idx >= 0) commentAddedCallbacks.splice(idx, 1);
  };
}

function resolveRealtimeUserId(): string | null {
  const userStore = useUserStore();
  const userId = userStore.currentUser.value?.id?.trim();
  return userId || null;
}

function connectWebSocket(userId: string | null | undefined) {
  if (!USE_BACKEND.value) return;
  if (ws) return;
  if (!userId) {
    wsConnected.value = false;
    wsError.value = null;
    return;
  }

  const url = getReviewUserWebSocketUrl(userId);
  if (!url) {
    wsConnected.value = false;
    wsError.value = null;
    return;
  }

  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      wsConnected.value = true;
      wsError.value = null;
      reconnectCount = 0;
      console.log('[ReviewStore] WebSocket connected');

      // 启动心跳
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, WS_HEARTBEAT_INTERVAL);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (e) {
        console.error('[ReviewStore] Failed to parse WebSocket message:', e);
      }
    };

    ws.onerror = () => {
      wsError.value = 'WebSocket 连接错误';
    };

    ws.onclose = () => {
      wsConnected.value = false;
      ws = null;

      // 自动重连
      if (currentTask.value && reconnectCount < MAX_RECONNECT) {
        reconnectCount++;
        wsError.value = `连接断开，${RECONNECT_DELAY / 1000}秒后重试 (${reconnectCount}/${MAX_RECONNECT})`;
        reconnectTimer = setTimeout(() => {
          if (currentTask.value) {
            connectWebSocket(resolveRealtimeUserId());
          }
        }, RECONNECT_DELAY);
      }
    };
  } catch (e) {
    console.error('[ReviewStore] Failed to connect WebSocket:', e);
  }
}

function disconnectWebSocket() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  wsConnected.value = false;
  reconnectCount = 0;
}

function handleWebSocketMessage(message: {
  type: string;
  data: unknown;
  timestamp: string;
}) {
  const taskId = currentTask.value?.id;
  if (!taskId) return;

  switch (message.type) {
    case 'record_saved': {
      // 其他用户保存了确认记录，刷新列表
      loadConfirmedRecords(taskId, { formId: currentTask.value?.formId });
      break;
    }
    case 'task_updated':
    case 'task_approved':
    case 'task_rejected': {
      // 任务状态更新，刷新历史
      loadReviewHistory(taskId);
      break;
    }
    case 'comment_added': {
      // 新评论，通知已注册的回调
      console.log('[ReviewStore] New comment:', message.data);
      for (const cb of commentAddedCallbacks) {
        try { cb(message.data); } catch { /* ignore */ }
      }
      break;
    }
    case 'pong': {
      // 心跳响应，忽略
      break;
    }
  }
}

// ============ PMS 跨平台 workflow 同步入口 ============

type FlushPendingConfirmResult = { ok: boolean; error?: string };
type ExternalWorkflowPreAction = 'active' | 'agree' | 'return' | 'redirect' | 'terminate';

type PrepareExternalWorkflowActionPayload = {
  formId: string;
  action: ExternalWorkflowPreAction;
};

type PrepareExternalWorkflowActionResult = {
  ok: boolean;
  action: ExternalWorkflowPreAction;
  saveOk: boolean;
  verifyPassed?: boolean;
  recommendedAction?: WorkflowVerifyData['recommendedAction'];
  blockCode?: string;
  message?: string;
  annotationCheck?: ReviewAnnotationCheckResult;
  error?: string;
};

type ApplyExternalWorkflowChangePayload = {
  formId: string;
  action: ExternalWorkflowPreAction;
  targetNode?: string;
  comments?: string;
  nextStep?: WorkflowVerifyNextStep | null;
};

type ApplyExternalWorkflowChangeResult = {
  ok: boolean;
  taskId?: string;
  status?: string;
  currentNode?: string;
  error?: string;
};

async function flushPendingConfirmForExternalAction(
  formId: string,
): Promise<FlushPendingConfirmResult> {
  const task = currentTask.value;
  if (!task) return { ok: false, error: 'no_current_task' };
  const taskFormId = task.formId?.trim();
  const targetFormId = formId.trim();
  if (!taskFormId || taskFormId !== targetFormId) {
    return { ok: false, error: 'form_id_mismatch' };
  }

  const toolStore = useToolStore();
  const activeDimensionState = activeDimensionDocumentSession?.state;
  const draftPayload = buildReviewConfirmSnapshotPayload({
    annotations: [...toolStore.annotations.value],
    cloudAnnotations: [...toolStore.cloudAnnotations.value],
    rectAnnotations: [...toolStore.rectAnnotations.value],
    obbAnnotations: [...toolStore.obbAnnotations.value],
    measurements: [...toolStore.measurements.value],
    xeokitDistanceMeasurements: [...toolStore.xeokitDistanceMeasurements.value],
    xeokitAngleMeasurements: [...toolStore.xeokitAngleMeasurements.value],
    xeokitElevationPointMeasurements: [...(toolStore.xeokitElevationPointMeasurements?.value ?? [])],
    xeokitElevationDeltaMeasurements: [...(toolStore.xeokitElevationDeltaMeasurements?.value ?? [])],
    dimensionDocument: activeDimensionState
      ? dimensionDocumentToSnapshot(activeDimensionState)
      : undefined,
    dimensionDocumentVersion: activeDimensionState?.baseVersion,
  });
  const confirmedSnapshot = buildReviewConfirmSnapshotPayloadFromRecords(
    sortedConfirmedRecords.value,
  );
  const unsavedPayload = buildUnsavedReviewConfirmPayload(draftPayload, confirmedSnapshot);
  if (!hasReviewConfirmPayloadData(unsavedPayload)) {
    return { ok: true };
  }

  try {
    await addConfirmedRecord({
      type: 'batch',
      annotations: unsavedPayload.annotations as AnnotationRecord[],
      cloudAnnotations: unsavedPayload.cloudAnnotations as CloudAnnotationRecord[],
      rectAnnotations: unsavedPayload.rectAnnotations as RectAnnotationRecord[],
      obbAnnotations: unsavedPayload.obbAnnotations as ObbAnnotationRecord[],
      measurements: unsavedPayload.measurements as unknown as MeasurementRecord[],
      dimensionDocument: unsavedPayload.dimensionDocument,
      dimensionDocumentVersion: unsavedPayload.dimensionDocumentVersion,
      note: 'PMS workflow_pre_action 自动保存',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function mapExternalActionToVerifyAction(
  action: ExternalWorkflowPreAction,
): 'active' | 'agree' | 'return' | 'stop' | null {
  if (action === 'active') return 'active';
  if (action === 'agree' || action === 'return') return action;
  if (action === 'terminate') return 'stop';
  return null;
}

function normalizeWorkflowNodeValue(value?: string | null): WorkflowNode | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'sj' || normalized === 'jd' || normalized === 'sh' || normalized === 'pz'
    ? normalized
    : null;
}

function getTaskAssigneeForNode(
  task: ReviewTask,
  node: WorkflowNode,
): { id: string; name: string } {
  if (node === 'sj') {
    return {
      id: task.requesterId?.trim() || '',
      name: task.requesterName?.trim() || task.requesterId?.trim() || '',
    };
  }

  if (node === 'jd') {
    const id = task.checkerId?.trim() || task.reviewerId?.trim() || '';
    return {
      id,
      name: task.checkerName?.trim() || task.reviewerName?.trim() || id,
    };
  }

  const id = task.approverId?.trim() || '';
  return {
    id,
    name: task.approverName?.trim() || id,
  };
}

function getDefaultAgreeTargetNode(currentNode?: WorkflowNode): WorkflowNode | null {
  if (currentNode === 'jd') return 'sh';
  if (currentNode === 'sh') return 'pz';
  return null;
}

function resolveExternalWorkflowNextStep(
  task: ReviewTask,
  payload: ApplyExternalWorkflowChangePayload,
): WorkflowVerifyNextStep | null {
  if (payload.nextStep?.assigneeId?.trim() && payload.nextStep.roles?.trim()) {
    return {
      assigneeId: payload.nextStep.assigneeId.trim(),
      name: payload.nextStep.name?.trim() || payload.nextStep.assigneeId.trim(),
      roles: payload.nextStep.roles.trim(),
    };
  }

  const currentNode = normalizeWorkflowNodeValue(task.currentNode);
  let targetNode: WorkflowNode | null = normalizeWorkflowNodeValue(payload.targetNode);

  if (!targetNode && payload.action === 'active') {
    targetNode = 'jd';
  }
  if (!targetNode && payload.action === 'return') {
    targetNode = 'sj';
  }
  if (!targetNode && payload.action === 'agree') {
    targetNode = getDefaultAgreeTargetNode(currentNode ?? undefined);
  }

  if (!targetNode) return null;
  const assignee = getTaskAssigneeForNode(task, targetNode);
  if (!assignee.id) return null;

  return {
    assigneeId: assignee.id,
    name: assignee.name || assignee.id,
    roles: targetNode,
  };
}

function resolveExternalWorkflowVerifyContext(formId: string) {
  const embedParams = readPersistedEmbedModeParams();
  const trustedIdentity = embedParams ? resolveTrustedEmbedIdentity(embedParams) : null;
  const task = currentTask.value;
  const actorId =
    trustedIdentity?.userId
    || embedParams?.userId
    || task?.checkerId
    || task?.reviewerId
    || task?.approverId
    || task?.requesterId
    || '';
  const actorRole =
    trustedIdentity?.workflowRole
    || embedParams?.workflowRole
    || task?.currentNode
    || '';

  return {
    token: embedParams?.userToken?.trim() || '',
    formId: trustedIdentity?.formId || embedParams?.formId || task?.formId || formId,
    actor: {
      id: actorId,
      name: actorId || 'PMS',
      roles: actorRole || 'jd',
    },
  };
}

async function prepareExternalWorkflowAction(
  payload: PrepareExternalWorkflowActionPayload,
): Promise<PrepareExternalWorkflowActionResult> {
  const saveResult = await flushPendingConfirmForExternalAction(payload.formId);
  if (!saveResult.ok) {
    const message = saveResult.error || 'PMS workflow_pre_action 自动保存失败';
    return {
      ok: false,
      action: payload.action,
      saveOk: false,
      verifyPassed: false,
      message,
      error: message,
    };
  }

  const verifyAction = mapExternalActionToVerifyAction(payload.action);
  if (!verifyAction) {
    return {
      ok: true,
      action: payload.action,
      saveOk: true,
      message: `action_${payload.action}_skipped_pre_action_verify`,
    };
  }

  const verifyContext = resolveExternalWorkflowVerifyContext(payload.formId);
  if (!verifyContext.token) {
    const message = 'missing_embed_token_for_workflow_verify';
    return {
      ok: false,
      action: payload.action,
      saveOk: true,
      verifyPassed: false,
      message,
      error: message,
    };
  }

  try {
    const response = await reviewVerifyWorkflow({
      formId: verifyContext.formId,
      token: verifyContext.token,
      action: verifyAction,
      actor: verifyContext.actor,
      metadata: {
        source: 'pms.workflow_pre_action',
        externalAction: payload.action,
      },
    });
    const verifyPassed = response.data?.passed === true;
    const message = response.data?.reason || response.message || (verifyPassed ? '验证通过' : 'workflow/verify 未通过');
    return {
      ok: verifyPassed,
      action: payload.action,
      saveOk: true,
      verifyPassed,
      recommendedAction: response.data?.recommendedAction,
      blockCode: response.data?.blockCode || response.errorCode,
      message,
      annotationCheck: response.annotationCheck,
      error: verifyPassed ? undefined : message,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      action: payload.action,
      saveOk: true,
      verifyPassed: false,
      message,
      error: message,
    };
  }
}

async function applyExternalWorkflowChange(
  payload: ApplyExternalWorkflowChangePayload,
): Promise<ApplyExternalWorkflowChangeResult> {
  const task = currentTask.value;
  if (!task) return { ok: false, error: 'no_current_task' };
  const taskFormId = task.formId?.trim();
  const targetFormId = payload.formId.trim();
  if (!taskFormId || taskFormId !== targetFormId) {
    return { ok: false, error: 'form_id_mismatch' };
  }

  const syncAction = mapExternalActionToVerifyAction(payload.action);
  if (!syncAction) {
    return { ok: false, error: `action_${payload.action}_not_implemented` };
  }

  const syncContext = resolveExternalWorkflowVerifyContext(payload.formId);
  if (!syncContext.token) {
    return { ok: false, error: 'missing_embed_token_for_workflow_sync' };
  }

  const nextStep = resolveExternalWorkflowNextStep(task, payload);
  const requiresNextStep = syncAction === 'active'
    || syncAction === 'return'
    || (syncAction === 'agree' && task.currentNode !== 'pz');
  if (requiresNextStep && !nextStep) {
    return { ok: false, error: `missing_next_step_for_${syncAction}` };
  }

  let responseStatus: string | undefined;
  let responseCurrentNode: string | undefined;
  try {
    const response = await reviewWorkflowSyncMutation({
      formId: syncContext.formId,
      token: syncContext.token,
      action: syncAction,
      actor: syncContext.actor,
      nextStep,
      comments: payload.comments,
      metadata: {
        source: 'pms.workflow_changed',
        externalAction: payload.action,
        targetNode: payload.targetNode,
      },
    });
    responseStatus = response.data?.taskStatus;
    responseCurrentNode = response.data?.currentNode;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const userStore = useUserStore();
  await userStore.loadReviewTasks();
  const refreshed = userStore.reviewTasks.value.find((t: ReviewTask) => t.id === task.id);
  return {
    ok: true,
    taskId: task.id,
    status: refreshed?.status ?? responseStatus ?? task.status,
    currentNode: refreshed?.currentNode ?? responseCurrentNode ?? task.currentNode,
  };
}

// ============ 导出功能 ============

function exportReviewData(): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    taskId: currentTask.value?.id,
    taskTitle: currentTask.value?.title,
    records: confirmedRecords.value,
  };
  return JSON.stringify(payload, null, 2);
}

// ============ 计算属性 ============

const confirmedRecordCount = computed(() => confirmedRecords.value.length);

const totalConfirmedAnnotations = computed(() => {
  return confirmedRecords.value.reduce((sum, r) => {
    return (
      sum +
      r.annotations.length +
      r.cloudAnnotations.length +
      r.rectAnnotations.length
    );
  }, 0);
});

const totalConfirmedMeasurements = computed(() => {
  return confirmedRecords.value.reduce((sum, r) => sum + r.measurements.length, 0);
});

const sortedConfirmedRecords = computed(() => {
  return [...confirmedRecords.value].sort((a, b) => b.confirmedAt - a.confirmedAt);
});

// ============ 配置 ============

function setUseBackend(use: boolean) {
  if (!use) {
    error.value = '校审确认记录必须保存到数据库，不支持切换为本地模式';
    return;
  }
  USE_BACKEND.value = true;
  if (typeof localStorage !== 'undefined') {
    const payload: ReviewPersistedState = {
      version: 2,
      reviewMode: reviewMode.value,
      confirmedRecords: [],
      useBackend: true,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}

export function useReviewStore() {
  return {
    // 状态
    reviewMode,
    confirmedRecords,
    currentTask,
    loading,
    error,
    reviewHistory,
    dimensionDocumentDirty,
    dimensionDocumentRecordCount,
    dimensionDocumentConflict,

    // WebSocket 状态
    wsConnected,
    wsError,

    // 配置
    useBackend: USE_BACKEND,
    setUseBackend,

    // 计算属性
    confirmedRecordCount,
    totalConfirmedAnnotations,
    totalConfirmedMeasurements,
    sortedConfirmedRecords,

    // 方法
    setReviewMode,
    toggleReviewMode,
    addConfirmedRecord,
    removeConfirmedRecord,
    clearConfirmedRecords,
    loadConfirmedRecords,
    loadReviewHistory,
    exportReviewData,
    setCurrentTask,
    clearCurrentTask,
    bindDimensionDocumentSession,
    getBoundDimensionConfirmPayload,
    resolveDimensionDocumentConflict,

    // PMS 跨平台 workflow 同步
    flushPendingConfirmForExternalAction,
    prepareExternalWorkflowAction,
    applyExternalWorkflowChange,

    // WebSocket
    connectWebSocket,
    disconnectWebSocket,
    onCommentAdded,
  };
}
