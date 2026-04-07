<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  ArrowRight,
  Box,
  CheckCircle,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Database,
  Download,
  FileCheck,
  FileText,
  Filter,
  HelpCircle,
  History,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Ruler,
  Trash2,
  X,
  XCircle,
} from 'lucide-vue-next';

import CollisionResultList from './CollisionResultList.vue';
import { isReviewDebugUiEnabled } from './debugUiGate';
import {
  EMBED_LANDING_STATE_STORAGE_KEY,
  EMBED_LANDING_STATE_UPDATED_EVENT,
  type EmbedLandingState,
} from './embedRoleLanding';
import ReviewAuxData from './ReviewAuxData.vue';
import ReviewCommentsTimeline from './ReviewCommentsTimeline.vue';
import ReviewDataSync from './ReviewDataSync.vue';
import {
  canReturnAtCurrentNode,
  canSubmitAtCurrentNode,
  confirmCurrentDataSafely,
  getSubmitActionLabel,
  getWorkflowSubmitBridgeAction,
  submitTaskToNextNodeSafely,
} from './reviewPanelActions';
import { buildReviewRecordReplayPayload } from './reviewRecordReplay';
import { resolvePassiveWorkflowMode } from './workflowMode';
import WorkflowReturnDialog from './WorkflowReturnDialog.vue';
import WorkflowStepBar from './WorkflowStepBar.vue';
import WorkflowSubmitDialog from './WorkflowSubmitDialog.vue';

import type { ReviewAttachment, ReviewTask, WorkflowNode } from '@/types/auth';

import {
  reviewSyncExport,
  reviewSyncImport,
} from '@/api/reviewApi';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useOnboardingGuide } from '@/composables/useOnboardingGuide';
import { useReviewStore } from '@/composables/useReviewStore';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore, type AnnotationType } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';
import { emitToast } from '@/ribbon/toastBus';
import { getTaskStatusDisplayName, WORKFLOW_NODE_NAMES } from '@/types/auth';

type WorkflowHistoryEntry = NonNullable<Awaited<ReturnType<typeof userStore.getTaskWorkflowHistory>>['history']>[number];
type ConfirmedRecordEntry = typeof reviewStore.sortedConfirmedRecords.value[number];
type WorkflowSyncBridgeAction = 'active' | 'agree' | 'return' | 'stop';
type WorkflowSyncBridgeMessage = {
  type: 'plant3d.workflow_action';
  action: WorkflowSyncBridgeAction;
  taskId?: string;
  formId?: string;
  comments?: string;
  targetNode?: WorkflowNode;
  source: 'review-panel';
};
type NormalizedTaskContext = {
  title: string;
  modelName: string;
  requesterName: string;
  checkerName: string;
  approverName: string;
  currentNodeLabel: string;
  currentNodeCode: WorkflowNode;
  formId: string | null;
  componentCount: number;
  returnReason: string | null;
};

const reviewStore = useReviewStore();
const toolStore = useToolStore();
const userStore = useUserStore();
const onboarding = useOnboardingGuide();
const selectionStore = useSelectionStore();
const viewerContext = useViewerContext();
const lastRestoredSceneKey = ref<string | null>(null);

const embedLandingState = ref<EmbedLandingState | null>(null);
const showDebugUi = isReviewDebugUiEnabled();

function syncEmbedLandingStateFromStorage() {
  if (typeof sessionStorage === 'undefined') return;
  const storedLandingState = sessionStorage.getItem(EMBED_LANDING_STATE_STORAGE_KEY);
  if (!storedLandingState) return;

  try {
    embedLandingState.value = JSON.parse(storedLandingState);
  } catch {
    console.warn('[ReviewPanel] 无法解析嵌入模式落点状态');
  }
}

function handleEmbedLandingStateUpdated() {
  syncEmbedLandingStateFromStorage();
}

syncEmbedLandingStateFromStorage();

const confirmNote = ref('');

const showMeasurementMenu = ref(false);

// 当前任务信息
const currentTask = computed(() => reviewStore.currentTask.value);
const taskContext = computed<NormalizedTaskContext | null>(() => {
  const task = currentTask.value;
  if (!task) return null;

  const currentNodeCode = (task.currentNode || 'sj') as WorkflowNode;
  return {
    title: task.title || '-',
    modelName: task.modelName || '-',
    requesterName: task.requesterName || '-',
    checkerName: task.checkerName || task.reviewerName || '-',
    approverName: task.approverName || '-',
    currentNodeCode,
    currentNodeLabel: WORKFLOW_NODE_NAMES[currentNodeCode],
    formId: task.formId?.trim() || null,
    componentCount: task.components.length,
    returnReason: task.returnReason?.trim() || null,
  };
});

const currentTaskNodeLabel = computed(() => taskContext.value?.currentNodeLabel || '-');
const currentTaskFormId = computed(() => taskContext.value?.formId || '未绑定 formId');
const currentTaskHasFormalFormId = computed(() => !!taskContext.value?.formId);
const isPassiveWorkflow = computed(() => resolvePassiveWorkflowMode());
const currentTaskStatusLabel = computed(() => {
  if (!currentTask.value) return '-';
  return getTaskStatusDisplayName(currentTask.value.status).label;
});
const reviewerEmbedEmptyStateTitle = computed(() => {
  if (embedLandingState.value?.restoreStatus === 'no_form') {
    return '当前打开的嵌入链接未提供有效 form_id';
  }
  if (embedLandingState.value?.restoreStatus === 'missing') {
    return '已识别 form_id，但尚未绑定内部任务，当前不可审核';
  }
  return '自动进入校审/待处理工作区';
});
const reviewerEmbedEmptyStateDesc = computed(() => {
  if (embedLandingState.value?.restoreStatus === 'no_form') {
    return '请从外部流程平台重新打开带 form_id 的嵌入链接，或确认当前单据是否已正确生成。';
  }
  if (embedLandingState.value?.restoreStatus === 'missing') {
    return '当前单据已经被识别，但内部 review_tasks 中尚未找到对应任务，请先完成绑定或等待内部任务创建。';
  }
  return '审批相关角色打开同一 form-id 时，首屏将落在待处理/校审工作区，无需手动切换面板。';
});

// 格式化文件大小
function formatFileSize(bytes?: number): string {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// 格式化日期
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getConfirmedAnnotationCount(record: ConfirmedRecordEntry): number {
  return record.annotations.length +
    record.cloudAnnotations.length +
    record.rectAnnotations.length +
    (record.obbAnnotations?.length ?? 0);
}

function getConfirmedMeasurementCount(record: ConfirmedRecordEntry): number {
  return record.measurements.length;
}

function getConfirmedRecordNote(record: ConfirmedRecordEntry): string {
  return record.note?.trim() || '-';
}

const currentTaskConfirmedRecords = computed<ConfirmedRecordEntry[]>(() => {
  const taskId = currentTask.value?.id;
  if (!taskId) return [];
  return reviewStore.sortedConfirmedRecords.value
    .filter((record) => (record.taskId || '') === taskId)
    .slice()
    .sort((a, b) => a.confirmedAt - b.confirmedAt);
});

function buildConfirmedRecordsSceneKey(taskId: string | null, records: ConfirmedRecordEntry[]): string {
  if (!taskId) return '__no-task__';
  if (records.length === 0) return `${taskId}:empty`;
  return `${taskId}:${records.map((record) => `${record.id}:${record.confirmedAt}`).join('|')}`;
}

function buildConfirmedRecordsReplayPayload(records: ConfirmedRecordEntry[]): string {
  return buildReviewRecordReplayPayload(records);
}

async function restoreConfirmedRecordsIntoScene(force = false): Promise<void> {
  const taskId = currentTask.value?.id ?? null;
  const records = currentTaskConfirmedRecords.value;
  const restoreKey = buildConfirmedRecordsSceneKey(taskId, records);
  if (!force && lastRestoredSceneKey.value === restoreKey) return;

  const viewerReady = await waitForViewerReady({ timeoutMs: 4000 });
  const tools = viewerContext.tools.value;
  if (!viewerReady || !tools) return;
  if ((currentTask.value?.id ?? null) !== taskId) return;

  if (!taskId || records.length === 0) {
    toolStore.clearAll();
    tools.syncFromStore();
    lastRestoredSceneKey.value = restoreKey;
    return;
  }

  toolStore.importJSON(buildConfirmedRecordsReplayPayload(records));
  tools.syncFromStore();
  lastRestoredSceneKey.value = restoreKey;
}

// 下载附件
function downloadAttachment(attachment: ReviewAttachment) {
  const link = document.createElement('a');
  link.href = attachment.url;
  link.download = attachment.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 模型过滤相关
const isFilteringByTask = ref(false);
const selectedTaskComponentRefno = ref<string | null>(null);

function normalizeComponentRefno(rawRefno?: string | null): string {
  const raw = String(rawRefno ?? '').trim();
  if (!raw) return '';
  const wrapped = raw.match(/[⟨<]([^⟩>]+)[⟩>]/)?.[1] ?? raw;
  const core = wrapped.replace(/^pe:/i, '').replace(/^=/, '').trim();
  return core.replace(/\//g, '_').replace(/,/g, '_');
}

function toSlashComponentRefno(refno: string): string {
  const normalized = normalizeComponentRefno(refno);
  const m = normalized.match(/^(\d+)_(\d+)$/);
  if (m) return `${m[1]}/${m[2]}`;
  return normalized;
}

function collectTaskComponentRefnos(task: ReviewTask | null): string[] {
  if (!task?.components?.length) return [];
  const refnos = new Set<string>();
  for (const component of task.components) {
    const normalized = normalizeComponentRefno(component.refNo);
    if (normalized) refnos.add(normalized);
  }
  return Array.from(refnos);
}

async function ensureTaskComponentsLoaded(task: ReviewTask): Promise<void> {
  const refnos = collectTaskComponentRefnos(task).map((refno) => toSlashComponentRefno(refno));
  if (refnos.length === 0) return;

  const result = await showModelByRefnosWithAck({
    refnos,
    flyTo: true,
    ensureViewerReady: false,
    timeoutMs: 15_000,
  });
  if (result.error) {
    console.warn('[ReviewPanel] 加载任务构件模型失败:', {
      taskId: task.id,
      error: result.error,
      fail: result.fail,
    });
  }
}

// 审核操作相关
const canSubmitToNextNode = computed(() => canSubmitAtCurrentNode(currentTask.value?.currentNode));
const canReturnToPrevNode = computed(() => canReturnAtCurrentNode(currentTask.value?.currentNode));
const submitActionLabel = computed(() => getSubmitActionLabel(currentTask.value?.currentNode));
const returnTargetNode = ref<WorkflowNode>('sj');

function notifyParentWorkflowAction(payload: Omit<WorkflowSyncBridgeMessage, 'type' | 'source'>): void {
  if (typeof window === 'undefined') return;
  if (window.parent === window) return;

  const message: WorkflowSyncBridgeMessage = {
    type: 'plant3d.workflow_action',
    source: 'review-panel',
    ...payload,
  };
  window.parent.postMessage(message, '*');
}
// ============ 同步（后端） ============

const syncExporting = ref(false);
const syncImporting = ref(false);
const syncOverwrite = ref(false);

async function exportFromServer() {
  if (syncExporting.value) return;
  syncExporting.value = true;
  try {
    const resp = await reviewSyncExport({
      includeAttachments: true,
      includeComments: true,
      includeRecords: true,
    });
    if (!resp.success) throw new Error(resp.error_message || '导出失败');
    const json = JSON.stringify(resp, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `review-sync-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } finally {
    syncExporting.value = false;
  }
}

async function importFromFile(event: Event) {
  if (syncImporting.value) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  syncImporting.value = true;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    const tasks = (parsed as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) throw new Error('导入文件格式不正确：缺少 tasks 数组');

    const resp = await reviewSyncImport({
      tasks: tasks as ReviewTask[],
      overwrite: syncOverwrite.value,
    });
    if (!resp.success) throw new Error(resp.error_message || '导入失败');
    await userStore.loadReviewTasks();
  } finally {
    syncImporting.value = false;
    input.value = '';
  }
}

const workflowLoading = ref(false);
const workflowError = ref<string | null>(null);
const workflow = ref<Awaited<ReturnType<typeof userStore.getTaskWorkflowHistory>> | null>(null);

const showSubmitDialog = ref(false);
const submitComment = ref('');
const showReturnDialog = ref(false);
const returnReason = ref('');
const workflowActionLoading = ref(false);

const currentNode = computed<WorkflowNode>(() => currentTask.value?.currentNode ?? 'sj');
const submitTargetNode = computed<WorkflowNode>(() => {
  switch (currentNode.value) {
    case 'sj':
      return 'jd';
    case 'jd':
      return 'sh';
    case 'sh':
    case 'pz':
      return 'pz';
    default:
      return 'jd';
  }
});

function getWorkflowActionLabel(action: string): string {
  switch (action) {
    case 'submit':
    case 'submitted':
      return '提交';
    case 'return':
    case 'returned':
      return '驳回';
    case 'approve':
    case 'approved':
      return '批准';
    case 'reject':
    case 'rejected':
      return '拒绝';
    case 'created':
      return '创建';
    case 'in_review':
      return '开始审核';
    case 'cancelled':
      return '取消';
    default:
      return action;
  }
}

function getWorkflowNodeLabel(step: WorkflowHistoryEntry): string {
  const explicitNode = step.node;
  if (explicitNode && explicitNode in WORKFLOW_NODE_NAMES) {
    return WORKFLOW_NODE_NAMES[explicitNode as WorkflowNode];
  }

  const fallbackMap: Record<string, WorkflowNode> = {
    created: 'sj',
    submitted: 'sj',
    in_review: 'jd',
    approved: 'pz',
    rejected: 'sh',
    cancelled: 'sj',
  };

  const fallbackNode = fallbackMap[step.action];
  return fallbackNode ? WORKFLOW_NODE_NAMES[fallbackNode] : '未知节点';
}

async function loadWorkflow(taskId: string) {
  workflowLoading.value = true;
  workflowError.value = null;
  try {
    const resp = await userStore.getTaskWorkflowHistory(taskId);
    if (!resp.success) {
      workflow.value = null;
      workflowError.value = resp.error_message || '获取工作流失败';
      return;
    }
    workflow.value = resp;
  } catch (e) {
    workflow.value = null;
    workflowError.value = e instanceof Error ? e.message : '获取工作流失败';
  } finally {
    workflowLoading.value = false;
  }
}

async function refreshCurrentTask(taskId: string) {
  await userStore.loadReviewTasks();
  const updated = userStore.reviewTasks.value.find((t) => t.id === taskId);
  if (updated) {
    await reviewStore.setCurrentTask(updated);
  }
}

async function handleSubmitToNextNode() {
  if (isPassiveWorkflow.value) return;
  const taskId = currentTask.value?.id;
  const formId = currentTask.value?.formId?.trim();
  const comments = submitComment.value.trim();
  const action: WorkflowSyncBridgeAction = getWorkflowSubmitBridgeAction(currentNode.value);
  const submitted = await submitTaskToNextNodeSafely({
    canSubmit: canSubmitToNextNode.value,
    taskId,
    submitComment,
    showSubmitDialog,
    workflowActionLoading,
    workflowError,
    submitTaskToNextNode: userStore.submitTaskToNextNode,
    refreshCurrentTask,
    loadWorkflow,
    emitToast,
  });

  if (!submitted || !taskId) return;

  notifyParentWorkflowAction({
    action,
    taskId,
    formId: formId || undefined,
    comments,
  });
}

async function handleReturnToNode() {
  if (isPassiveWorkflow.value) return;
  if (!currentTask.value || !canReturnToPrevNode.value) return;
  const taskId = currentTask.value.id;
  const formId = currentTask.value.formId?.trim();
  const reason = returnReason.value.trim();
  if (!reason) return;
  const targetNode = returnTargetNode.value;
  workflowActionLoading.value = true;
  workflowError.value = null;
  try {
    await userStore.returnTaskToNode(taskId, targetNode, reason);
    await refreshCurrentTask(taskId);
    await loadWorkflow(taskId);
    emitToast({ message: '任务已驳回到指定节点' });
    showReturnDialog.value = false;
    returnReason.value = '';
    returnTargetNode.value = 'sj';
    notifyParentWorkflowAction({
      action: 'return',
      taskId,
      formId: formId || undefined,
      comments: reason,
      targetNode,
    });
  } catch (e) {
    workflowError.value = e instanceof Error ? e.message : '驳回失败';
  } finally {
    workflowActionLoading.value = false;
  }
}

function toggleSubmitDialog() {
  if (isPassiveWorkflow.value) return;
  if (workflowLoading.value || workflowActionLoading.value || !canSubmitToNextNode.value) return;
  showReturnDialog.value = false;
  returnReason.value = '';
  showSubmitDialog.value = !showSubmitDialog.value;
}

function toggleReturnDialog() {
  if (isPassiveWorkflow.value) return;
  if (workflowLoading.value || workflowActionLoading.value || !canReturnToPrevNode.value) return;
  showSubmitDialog.value = false;
  submitComment.value = '';
  returnTargetNode.value = 'sj';
  showReturnDialog.value = !showReturnDialog.value;
}

function closeSubmitDialog() {
  showSubmitDialog.value = false;
  submitComment.value = '';
}

function closeReturnDialog() {
  showReturnDialog.value = false;
  returnReason.value = '';
  returnTargetNode.value = 'sj';
}

async function refreshWorkflowContext() {
  const taskId = currentTask.value?.id;
  if (!taskId) return;
  await refreshCurrentTask(taskId);
  await loadWorkflow(taskId);
}

function handleClearConfirmedRecords() {
  if (!window.confirm('确定要清空所有已确认的数据？此操作不可撤销。')) return;
  reviewStore.clearConfirmedRecords();
}

// 根据任务过滤模型显示
function filterModelByTask() {
  const viewer = viewerContext.viewerRef.value;
  if (!viewer || !currentTask.value) return;

  const allObjectIds = Array.isArray(viewer.scene.objectIds) ? viewer.scene.objectIds : [];
  if (allObjectIds.length === 0) return;

  const taskRefNos = collectTaskComponentRefnos(currentTask.value);
  if (taskRefNos.length === 0) return;

  const visibleTaskRefNos = taskRefNos.filter((refno) => allObjectIds.includes(refno));
  if (visibleTaskRefNos.length === 0) return;

  // 先隐藏所有，再显示任务构件，避免无模型时误清空场景
  viewer.scene.setObjectsVisible(allObjectIds, false);
  viewer.scene.setObjectsVisible(visibleTaskRefNos, true);
  const aabb = viewer.scene.getAABB(visibleTaskRefNos);
  if (aabb) {
    viewer.cameraFlight.flyTo({ aabb, duration: 1, fit: true });
  }

  isFilteringByTask.value = true;
}

// 清除模型过滤
function clearModelFilter() {
  const viewer = viewerContext.viewerRef.value;
  if (!viewer) return;
  
  // 显示所有模型
  const allObjectIds = viewer.scene.objectIds;
  if (allObjectIds && allObjectIds.length > 0) {
    viewer.scene.setObjectsVisible(allObjectIds, true);
  }
  
  isFilteringByTask.value = false;
}

function isTaskComponentSelected(rawRefno?: string | null): boolean {
  const normalized = normalizeComponentRefno(rawRefno);
  return !!normalized && normalized === selectedTaskComponentRefno.value;
}

async function handleTaskComponentSelect(rawRefno?: string | null): Promise<void> {
  const normalized = normalizeComponentRefno(rawRefno);
  if (!normalized) return;

  if (selectedTaskComponentRefno.value === normalized) {
    selectedTaskComponentRefno.value = null;
    return;
  }

  selectedTaskComponentRefno.value = normalized;
  ensurePanelAndActivate('modelTree');
  selectionStore.setSelectedRefno(normalized);

  const result = await showModelByRefnosWithAck({
    refnos: [toSlashComponentRefno(normalized)],
    flyTo: true,
    timeoutMs: 15_000,
  });

  window.dispatchEvent(new CustomEvent('autoLocateRefno', {
    detail: { refno: toSlashComponentRefno(normalized) },
  }));

  if (result.error && result.ok.length === 0) {
    emitToast({
      message: `构件定位失败：${result.error}`,
      type: 'warning',
    });
  }
}

// 监听当前任务变化，自动应用过滤
watch(currentTask, async (newTask) => {
  selectedTaskComponentRefno.value = null;
  lastRestoredSceneKey.value = null;

  if (newTask && newTask.components.length > 0) {
    // 有新任务时自动应用过滤
    const taskId = newTask.id;
    await nextTick();
    const viewerReady = await waitForViewerReady({ timeoutMs: 4000 });
    if (!viewerReady) {
      console.warn('[ReviewPanel] Viewer panel did not become ready in time for task filtering');
      return;
    }
    if (currentTask.value?.id !== taskId) {
      return;
    }
    await ensureTaskComponentsLoaded(newTask);
    if (currentTask.value?.id !== taskId) {
      return;
    }
    filterModelByTask();
  } else {
    // 清除任务时清除过滤
    clearModelFilter();
  }

  await restoreConfirmedRecordsIntoScene(true);

  if (newTask) {
    showSubmitDialog.value = false;
    submitComment.value = '';
    showReturnDialog.value = false;
    returnReason.value = '';
    returnTargetNode.value = 'sj';
    loadWorkflow(newTask.id);
  } else {
    workflow.value = null;
    workflowError.value = null;
    showSubmitDialog.value = false;
    submitComment.value = '';
    showReturnDialog.value = false;
    returnReason.value = '';
    returnTargetNode.value = 'sj';
  }
}, { immediate: true });

watch(
  () => ({
    taskId: currentTask.value?.id ?? null,
    recordKeys: currentTaskConfirmedRecords.value.map((record) => `${record.id}:${record.confirmedAt}`).join('|'),
    viewerReady: !!viewerContext.viewerRef.value,
    toolsReady: !!viewerContext.tools.value,
  }),
  async () => {
    await restoreConfirmedRecordsIntoScene();
  },
  { immediate: true }
);

const pendingAnnotationCount = computed(() => {
  return (
    toolStore.annotationCount.value +
    toolStore.cloudAnnotationCount.value +
    toolStore.rectAnnotationCount.value +
    toolStore.obbAnnotationCount.value
  );
});

const pendingMeasurementCount = computed(() => toolStore.measurementCount.value);

const reviewerDirectLaunchActions = computed(() => [
  {
    id: 'annotation-text',
    label: '文字批注',
    description: '在当前审核任务上下文中直接进入文字批注。',
    onClick: startAnnotation,
  },
  {
    id: 'annotation-cloud',
    label: '云线批注',
    description: '保持当前任务上下文，直接启动云线批注。',
    onClick: startCloudAnnotation,
  },
  {
    id: 'annotation-rect',
    label: '矩形批注',
    description: '保持当前任务上下文，直接启动矩形批注。',
    onClick: startRectAnnotation,
  },
]);

const reviewerMeasurementActions = computed(() => [
  {
    id: 'measurement-distance',
    label: '距离测量',
    description: '从审核工作台直接开始距离测量。',
    onClick: startDistanceMeasurement,
  },
  {
    id: 'measurement-angle',
    label: '角度测量',
    description: '从审核工作台直接开始角度测量。',
    onClick: startAngleMeasurement,
  },
]);

const hasPendingData = computed(() => {
  return pendingAnnotationCount.value > 0 || pendingMeasurementCount.value > 0;
});
const confirmSaving = ref(false);
const confirmError = ref<string | null>(null);

async function confirmCurrentData() {
  if (confirmSaving.value) return;

  confirmSaving.value = true;
  confirmError.value = null;
  try {
    await confirmCurrentDataSafely({
      hasPendingData: hasPendingData.value,
      payload: {
        type: 'batch' as const,
        annotations: [...toolStore.annotations.value],
        cloudAnnotations: [...toolStore.cloudAnnotations.value],
        rectAnnotations: [...toolStore.rectAnnotations.value],
        obbAnnotations: [...toolStore.obbAnnotations.value],
        measurements: [...toolStore.measurements.value],
        note: confirmNote.value.trim(),
      },
      addConfirmedRecord: reviewStore.addConfirmedRecord,
      clearAll: () => {
        toolStore.clearAll();
      },
      resetNote: () => {
        confirmNote.value = '';
      },
    });
  } catch (e) {
    confirmError.value = e instanceof Error ? e.message : '确认当前数据失败';
  } finally {
    confirmSaving.value = false;
  }
}

function exportData() {
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
}

function startAnnotation() {
  toolStore.setToolMode('annotation');
}

function startCloudAnnotation() {
  toolStore.setToolMode('annotation_cloud');
}

function startRectAnnotation() {
  toolStore.setToolMode('annotation_rect');
}

function startDistanceMeasurement() {
  toolStore.setToolMode('measure_distance');
  showMeasurementMenu.value = false;
}

function startAngleMeasurement() {
  toolStore.setToolMode('measure_angle');
  showMeasurementMenu.value = false;
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.relative')) {
    showMeasurementMenu.value = false;
  }
}

onMounted(() => {
  window.addEventListener(EMBED_LANDING_STATE_UPDATED_EVENT, handleEmbedLandingStateUpdated);
  document.addEventListener('click', handleClickOutside);

  const isAutomation = localStorage.getItem('plant3d_automation_review') === '1'
    || new URLSearchParams(window.location.search).get('automation_review') === '1';
  if (isAutomation) {
    (window as unknown as Record<string, unknown>).__plant3dReviewerE2E = {
      addMockAnnotation(title?: string, description?: string) {
        const id = `e2e-annot-${Date.now()}`;
        toolStore.addAnnotation({
          id,
          title: title || `E2E 批注 ${new Date().toLocaleTimeString('zh-CN')}`,
          description: description || '自动化测试创建的批注',
          position: [0, 0, 0],
          normal: [0, 1, 0],
          visible: true,
          createdAt: Date.now(),
        } as Parameters<typeof toolStore.addAnnotation>[0]);
        return id;
      },
      addMockMeasurement(kind: 'distance' | 'angle' = 'distance') {
        const id = `e2e-measure-${Date.now()}`;
        if (kind === 'angle') {
          toolStore.addMeasurement({
            id,
            kind: 'angle',
            origin: { entityId: '24381_145018:origin', worldPos: [0, 0, 0] },
            corner: { entityId: '24381_145018:corner', worldPos: [1, 0, 0] },
            target: { entityId: '24381_145018:target', worldPos: [1, 1, 0] },
            visible: true,
            createdAt: Date.now(),
          } as Parameters<typeof toolStore.addMeasurement>[0]);
          return id;
        }
        toolStore.addMeasurement({
          id,
          kind: 'distance',
          origin: { entityId: '24381_145018:origin', worldPos: [0, 0, 0] },
          target: { entityId: '24381_145018:target', worldPos: [1, 0, 0] },
          visible: true,
          createdAt: Date.now(),
        } as Parameters<typeof toolStore.addMeasurement>[0]);
        return id;
      },
      async confirmData(note?: string) {
        confirmNote.value = note || 'E2E 自动化批注确认';
        await confirmCurrentData();
      },
      getAnnotationCount() {
        return pendingAnnotationCount.value;
      },
      getMeasurementCount() {
        return pendingMeasurementCount.value;
      },
      getConfirmedRecordCount() {
        return reviewStore.confirmedRecordCount.value;
      },
      getConfirmedMeasurementCount() {
        return reviewStore.totalConfirmedMeasurements.value;
      },
    };
  }
});

onUnmounted(() => {
  window.removeEventListener(EMBED_LANDING_STATE_UPDATED_EVENT, handleEmbedLandingStateUpdated);
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('click', handleModuleMenuClickOutside, { capture: true } as EventListenerOptions);
});

// ============ Module management system ============

interface ReviewModule {
  id: string;
  label: string;
  icon: typeof Paperclip;
  isDefault: boolean;
}

const REVIEW_MODULES: ReviewModule[] = [
  { id: 'attachments', label: '\u9644\u4ef6\u6587\u4ef6', icon: Paperclip, isDefault: false },
  { id: 'confirmedStats', label: '\u5df2\u786e\u8ba4\u6570\u636e', icon: ClipboardList, isDefault: false },
  { id: 'dataSync', label: '\u6570\u636e\u540c\u6b65', icon: RefreshCw, isDefault: true },
  { id: 'auxData', label: '\u8f85\u52a9\u6821\u5ba1', icon: Database, isDefault: true },
  { id: 'workflowHistory', label: '\u5de5\u4f5c\u6d41\u5386\u53f2', icon: History, isDefault: true },
  { id: 'confirmedRecords', label: '\u786e\u8ba4\u8bb0\u5f55', icon: FileCheck, isDefault: true },
];

const STORAGE_KEY = 'review_panel_active_modules';

function loadActiveModules(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

const activeOptionalModules = ref<string[]>(loadActiveModules());
const showModuleMenu = ref(false);

const optionalModules = computed(() =>
  REVIEW_MODULES.filter((m) => !m.isDefault)
);

const inactiveModules = computed(() =>
  optionalModules.value.filter((m) => !activeOptionalModules.value.includes(m.id))
);

const activeModuleDetails = computed(() =>
  optionalModules.value.filter((m) => activeOptionalModules.value.includes(m.id))
);

const stableWorkbenchZones = computed(() => [
  {
    id: 'workflow-history',
    title: '工作流历史',
    description: '保留流转节点与操作时间线，作为 M4 工作台稳定骨架的一部分。',
  },
  {
    id: 'confirmed-records',
    title: '确认记录',
    description: '独立展示审核确认快照，与工作流历史和评论保持语义分离。',
  },
  {
    id: 'aux-data',
    title: '辅助校审数据',
    description: '基于当前任务上下文触发外部辅助数据与碰撞查询。',
  },
  {
    id: 'sync',
    title: '数据同步（后端）',
    description: '统一放置导入/导出能力，保持当前工作台上下文稳定。',
  },
]);

function isModuleActive(id: string): boolean {
  return activeOptionalModules.value.includes(id);
}

function addModule(id: string) {
  if (!activeOptionalModules.value.includes(id)) {
    activeOptionalModules.value = [...activeOptionalModules.value, id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeOptionalModules.value));
  }
  showModuleMenu.value = false;
}

function removeModule(id: string) {
  activeOptionalModules.value = activeOptionalModules.value.filter((m) => m !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(activeOptionalModules.value));
}

function handleModuleMenuClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.module-menu-container')) {
    showModuleMenu.value = false;
  }
}

watch(showModuleMenu, (val) => {
  if (val) {
    document.addEventListener('click', handleModuleMenuClickOutside, { capture: true });
  } else {
    document.removeEventListener('click', handleModuleMenuClickOutside, { capture: true });
  }
});

// ============ Tab / 折叠区域 ============
type ReviewTab = 'records' | 'history' | 'attachments';
const activeReviewTab = ref<ReviewTab>('records');
const expandedTaskDetails = ref(false);
const expandedWorkflowHistory = ref(false);
const expandedConfirmedRecords = ref(false);
const expandedExtras = ref(false);

const workflowHistoryCount = computed(() => workflow.value?.history?.length ?? 0);
const confirmedRecordListCount = computed(() => reviewStore.sortedConfirmedRecords.value.length);

// ============ 批注列表（详情 + 评论线程） ============

type AnnotationListItem = {
  id: string;
  type: AnnotationType;
  title: string;
  description: string;
  createdAt: number;
  visible: boolean;
  commentCount: number;
  refno?: string;
};

const expandedAnnotationId = ref<string | null>(null);
const expandedAnnotationType = ref<AnnotationType | null>(null);

const allAnnotationItems = computed<AnnotationListItem[]>(() => {
  const items: AnnotationListItem[] = [];

  for (const a of toolStore.annotations.value) {
    items.push({
      id: a.id,
      type: 'text',
      title: a.title?.trim() || '未命名文字批注',
      description: a.description?.trim() || '',
      createdAt: a.createdAt,
      visible: a.visible,
      commentCount: toolStore.getAnnotationComments('text', a.id).length,
      refno: a.refno,
    });
  }

  for (const a of toolStore.cloudAnnotations.value) {
    items.push({
      id: a.id,
      type: 'cloud',
      title: a.title?.trim() || '未命名云线批注',
      description: a.description?.trim() || '',
      createdAt: a.createdAt,
      visible: a.visible,
      commentCount: toolStore.getAnnotationComments('cloud', a.id).length,
    });
  }

  for (const a of toolStore.rectAnnotations.value) {
    items.push({
      id: a.id,
      type: 'rect',
      title: a.title?.trim() || '未命名矩形批注',
      description: a.description?.trim() || '',
      createdAt: a.createdAt,
      visible: a.visible,
      commentCount: toolStore.getAnnotationComments('rect', a.id).length,
    });
  }

  return items.sort((a, b) => b.createdAt - a.createdAt);
});

const totalAnnotationItemCount = computed(() => allAnnotationItems.value.length);

function getAnnotationTypeBadge(type: AnnotationType): { label: string; colorClass: string } {
  switch (type) {
    case 'text': return { label: '文字', colorClass: 'bg-blue-100 text-blue-700' };
    case 'cloud': return { label: '云线', colorClass: 'bg-violet-100 text-violet-700' };
    case 'rect': return { label: '矩形', colorClass: 'bg-amber-100 text-amber-700' };
    default: return { label: '批注', colorClass: 'bg-slate-100 text-slate-700' };
  }
}

function formatAnnotationTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
    ' ' + new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function toggleAnnotationDetail(item: AnnotationListItem) {
  if (expandedAnnotationId.value === item.id) {
    expandedAnnotationId.value = null;
    expandedAnnotationType.value = null;
  } else {
    expandedAnnotationId.value = item.id;
    expandedAnnotationType.value = item.type;
  }
}

function flyToAnnotationItem(item: AnnotationListItem) {
  if (item.type === 'text') {
    toolStore.activeAnnotationId.value = item.id;
    toolStore.activeCloudAnnotationId.value = null;
    toolStore.activeRectAnnotationId.value = null;
  } else if (item.type === 'cloud') {
    toolStore.activeCloudAnnotationId.value = item.id;
    toolStore.activeAnnotationId.value = null;
    toolStore.activeRectAnnotationId.value = null;
  } else if (item.type === 'rect') {
    toolStore.activeRectAnnotationId.value = item.id;
    toolStore.activeAnnotationId.value = null;
    toolStore.activeCloudAnnotationId.value = null;
  }
}
</script>

<template>
  <div class="flex h-full flex-col gap-3 overflow-y-auto p-3" data-panel="review">
    <!-- ═══════ A. 任务头部 (紧凑) ═══════ -->
    <div v-if="currentTask"
      class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="reviewer-landing-workspace">
      <!-- 标题行: 任务名 + 节点徽章 + 操作 -->
      <div class="flex items-center justify-between gap-2" data-guide="review-panel-header">
        <div class="flex items-center gap-2 min-w-0">
          <ClipboardCheck class="h-5 w-5 shrink-0 text-primary" />
          <h2 class="truncate text-base font-semibold text-slate-950">{{ currentTask.title }}</h2>
          <span class="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
            {{ currentTaskNodeLabel }}
            <span class="ml-0.5 text-blue-500">{{ taskContext?.currentNodeCode }}</span>
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button type="button"
            class="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
            title="查看校审面板操作指南"
            @click="onboarding.openGuideCenter('reviewPanel')">
            <HelpCircle class="h-3.5 w-3.5" />
            操作指南
          </button>
          <button v-if="isFilteringByTask" type="button" title="显示所有模型"
            class="h-7 rounded-full bg-orange-100 px-3 text-xs font-medium text-orange-700 hover:bg-orange-200"
            @click="clearModelFilter">
            <Filter class="mr-1 inline h-3 w-3" />已过滤
          </button>
          <button type="button" class="h-6 rounded px-2 text-xs hover:bg-muted" title="关闭任务"
            @click="reviewStore.clearCurrentTask()">
            <XCircle class="h-4 w-4" />
          </button>
        </div>
      </div>

      <!-- 流程步骤条 -->
      <WorkflowStepBar v-if="taskContext" :current-node="taskContext.currentNodeCode" class="mt-3" data-guide="workflow-step-bar" />

      <!-- 打回原因提示 -->
      <div v-if="taskContext?.returnReason"
        class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <span class="font-semibold">打回原因：</span>{{ taskContext.returnReason }}
      </div>

      <!-- 核心操作按钮组 -->
      <div class="mt-3 flex flex-wrap items-center gap-2" data-testid="review-workbench-workflow-zone" data-guide="workflow-actions">
        <template v-if="isPassiveWorkflow">
          <div class="min-w-[18rem] flex-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <div class="font-medium">外部流程模式</div>
            <div class="mt-1 text-xs text-blue-700">
              当前流程由外部平台驱动，此处仅展示状态，不提供提交、驳回等内部操作。
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-blue-800">
              <span>当前节点：{{ currentTaskNodeLabel }}</span>
              <span>当前状态：{{ currentTaskStatusLabel }}</span>
            </div>
          </div>
          <button type="button"
            class="h-8 rounded-md border border-input px-3 text-sm hover:bg-muted disabled:opacity-50"
            :disabled="workflowLoading || workflowActionLoading"
            @click="void refreshWorkflowContext()">
            <RefreshCw :class="['mr-1 inline h-3.5 w-3.5', (workflowLoading || workflowActionLoading) && 'animate-spin']" />
            刷新
          </button>
        </template>
        <template v-else>
          <button type="button"
            class="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            :disabled="workflowLoading || workflowActionLoading || !canSubmitToNextNode"
            @click="toggleSubmitDialog">
            {{ submitActionLabel }}
          </button>
          <button type="button"
            class="h-8 rounded-md border border-red-200 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            :disabled="workflowLoading || workflowActionLoading || !canReturnToPrevNode"
            @click="toggleReturnDialog">
            驳回到设计
          </button>
          <button type="button"
            class="h-8 rounded-md border border-input px-3 text-sm hover:bg-muted"
            @click="filterModelByTask">
            <Filter class="mr-1 inline h-3 w-3" />只显示任务构件
          </button>
          <button v-if="isFilteringByTask" type="button"
            class="h-8 rounded-md border border-input px-3 text-sm hover:bg-muted"
            @click="clearModelFilter">
            显示全部
          </button>
          <div v-if="workflowError" class="text-xs text-red-600">{{ workflowError }}</div>
        </template>
      </div>
    </div>

    <!-- 嵌入模式落点 -->
    <div v-else-if="showDebugUi && embedLandingState?.target === 'reviewer'"
      data-testid="reviewer-landing-workspace"
      class="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900">
      <div class="flex items-center justify-between gap-2">
        <div>
          <div class="text-sm font-semibold" data-testid="reviewer-landing-cta">自动进入校审/待处理工作区</div>
          <div class="mt-1 text-xs text-blue-700">
            {{ reviewerEmbedEmptyStateDesc }}
          </div>
        </div>
        <div v-if="embedLandingState.formId"
          data-testid="reviewer-lineage-form-id"
          class="rounded-full bg-white px-3 py-1 text-xs text-blue-700">
          Lineage: {{ embedLandingState.formId }}
        </div>
      </div>
      <div class="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-blue-900">
        {{ reviewerEmbedEmptyStateTitle }}
      </div>
    </div>

    <!-- ═══════ B. 任务详情 (可折叠) ═══════ -->
    <div v-if="currentTask" class="rounded-lg border border-slate-200 bg-slate-50"
      data-testid="review-workbench-context-zone">
      <button type="button"
        class="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-lg"
        @click="expandedTaskDetails = !expandedTaskDetails">
        <div class="flex items-center gap-2">
          <ClipboardCheck class="h-4 w-4 text-primary" />
          <span>任务详情</span>
          <span class="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-500">
            {{ taskContext?.modelName || '-' }} · {{ taskContext?.componentCount || 0 }} 构件
          </span>
          <span class="rounded-full px-2 py-0.5 text-[11px]"
            :class="currentTaskHasFormalFormId ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'">
            {{ currentTaskFormId }}
          </span>
        </div>
        <ChevronDown class="h-4 w-4 transition-transform" :class="{ 'rotate-180': expandedTaskDetails }" />
      </button>
      <div v-show="expandedTaskDetails" class="border-t border-slate-200 p-4 space-y-4">
        <section>
          <div class="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 mb-2">流程上下文</div>
          <div class="grid gap-2 sm:grid-cols-2">
            <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div class="text-[11px] uppercase tracking-[0.14em] text-slate-400">提资人</div>
              <div class="mt-1 text-sm font-semibold text-slate-900">{{ taskContext?.requesterName || '-' }}</div>
            </div>
            <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div class="text-[11px] uppercase tracking-[0.14em] text-slate-400">校核人</div>
              <div class="mt-1 text-sm font-semibold text-slate-900">{{ taskContext?.checkerName || '-' }}</div>
            </div>
            <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div class="text-[11px] uppercase tracking-[0.14em] text-slate-400">审核人</div>
              <div class="mt-1 text-sm font-semibold text-slate-900">{{ taskContext?.approverName || '-' }}</div>
            </div>
            <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div class="text-[11px] uppercase tracking-[0.14em] text-slate-400">当前节点</div>
              <div class="mt-1 text-sm font-semibold text-slate-900">{{ currentTaskNodeLabel }}</div>
            </div>
          </div>
        </section>

        <!-- 模型清单 -->
        <section>
          <div class="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 mb-2">模型清单</div>
          <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div class="text-sm font-semibold text-slate-900">{{ taskContext?.modelName || '-' }}</div>
            <div class="mt-1 text-xs text-slate-500">共 {{ taskContext?.componentCount || 0 }} 个构件</div>
          </div>
          <div v-if="currentTask.components && currentTask.components.length > 0"
            class="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
            <div v-for="comp in currentTask.components" :key="comp.id"
              class="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors"
              :class="isTaskComponentSelected(comp.refNo)
                ? 'border-primary/40 bg-primary/5'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'"
              @click="void handleTaskComponentSelect(comp.refNo)">
              <Box class="h-4 w-4 shrink-0 text-slate-400" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-slate-800">{{ comp.name }}</div>
                <div class="text-xs text-slate-400">{{ comp.refNo }}{{ comp.type ? ` · ${comp.type}` : '' }}</div>
              </div>
            </div>
          </div>
        </section>

        <!-- 关联文件 -->
        <section v-if="currentTask.attachments && currentTask.attachments.length > 0">
          <div class="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 mb-2">
            关联文件 ({{ currentTask.attachments.length }})
          </div>
          <div class="max-h-48 space-y-1.5 overflow-y-auto">
            <div v-for="attachment in currentTask.attachments" :key="attachment.id"
              class="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
              @click="downloadAttachment(attachment)">
              <Paperclip class="h-4 w-4 shrink-0 text-slate-400" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-slate-800">{{ attachment.name }}</div>
                <div class="text-xs text-slate-400">
                  {{ formatFileSize(attachment.size) }} · {{ formatDate(attachment.uploadedAt) }}
                </div>
              </div>
              <Download class="h-4 w-4 shrink-0 text-slate-400" />
            </div>
          </div>
        </section>
        <div v-else class="text-xs text-slate-400">暂无关联文件</div>
      </div>
    </div>

    <!-- ═══════ C. 批注与测量 (合并) ═══════ -->
    <div class="rounded-md border border-border bg-background p-3">
      <!-- 校审模式 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <ClipboardCheck class="h-4 w-4 text-primary" />
          <span class="text-sm font-semibold">批注与测量</span>
        </div>
        <button type="button"
          class="h-7 rounded-md px-2.5 text-xs"
          :class="
            reviewStore.reviewMode.value
              ? 'bg-primary text-primary-foreground'
              : 'border border-input bg-background hover:bg-muted'
          "
          @click="reviewStore.toggleReviewMode()">
          校审{{ reviewStore.reviewMode.value ? '已启用' : '已关闭' }}
        </button>
      </div>

      <!-- 待确认数据计数 -->
      <div class="mt-2 flex items-center gap-3 text-sm">
        <div class="flex items-center gap-1.5">
          <MessageSquare class="h-3.5 w-3.5 text-blue-500" />
          <span>批注 <strong>{{ pendingAnnotationCount }}</strong></span>
        </div>
        <div class="flex items-center gap-1.5">
          <Ruler class="h-3.5 w-3.5 text-green-500" />
          <span>测量 <strong>{{ pendingMeasurementCount }}</strong></span>
        </div>
      </div>

      <!-- 工具按钮 -->
      <div class="mt-2 flex flex-wrap gap-1.5" data-guide="review-panel-tools" data-testid="reviewer-direct-launch-annotation-zone">
        <button v-for="action in reviewerDirectLaunchActions"
          :key="action.id"
          type="button"
          class="h-7 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-slate-700 hover:bg-muted"
          :data-testid="`reviewer-direct-launch-${action.id}`"
          :title="action.label"
          @click="action.onClick">
          {{ action.label }}
        </button>
        <div class="relative" data-testid="reviewer-direct-launch-measurement-zone">
          <button type="button"
            class="h-7 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-slate-700 hover:bg-muted"
            title="创建测量"
            @click="showMeasurementMenu = !showMeasurementMenu">
            <Plus class="mr-0.5 inline h-3 w-3" />测量
          </button>
          <div v-if="showMeasurementMenu"
            class="absolute left-0 top-full z-10 mt-1 rounded-md border border-border bg-background p-1 shadow-md">
            <button v-for="action in reviewerMeasurementActions"
              :key="action.id"
              type="button"
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              :data-testid="`reviewer-direct-launch-${action.id}`"
              @click="action.onClick">
              {{ action.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- 确认操作 -->
      <div v-if="hasPendingData" class="mt-3 border-t border-slate-200 pt-3">
        <input v-model="confirmNote"
          class="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
          placeholder="备注（可选）" />
        <button type="button"
          data-command="review.confirm"
          class="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          :disabled="confirmSaving"
          @click="confirmCurrentData">
          <CheckCircle class="h-4 w-4" />
          {{ confirmSaving ? '保存中...' : '确认当前数据' }}
        </button>
        <div v-if="confirmError" class="mt-1 text-xs text-red-600">{{ confirmError }}</div>
      </div>
    </div>

    <!-- ═══════ C2. 批注列表（每条批注详情 + 评论线程） ═══════ -->
    <div v-if="totalAnnotationItemCount > 0" class="rounded-lg border border-slate-200 bg-white" data-guide="annotation-list-zone">
      <div class="flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-2">
          <FileText class="h-4 w-4 text-orange-500" />
          <span class="text-sm font-semibold text-slate-900">批注列表</span>
          <span class="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
            {{ totalAnnotationItemCount }}
          </span>
        </div>
      </div>

      <div class="flex flex-col gap-0.5 border-t border-slate-100 px-3 py-2">
        <div v-for="item in allAnnotationItems" :key="item.id">
          <!-- 批注卡片 -->
          <div class="cursor-pointer rounded-lg border p-3 transition-colors"
            :class="expandedAnnotationId === item.id
              ? 'border-orange-300 bg-orange-50/50 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'"
            @click="toggleAnnotationDetail(item)">
            <!-- 头部：标题 + 类型标签 + 时间 -->
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-semibold text-slate-900">{{ item.title }}</span>
                  <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                    :class="getAnnotationTypeBadge(item.type).colorClass">
                    {{ getAnnotationTypeBadge(item.type).label }}
                  </span>
                </div>
                <p v-if="item.description" class="mt-0.5 truncate text-xs text-slate-500">{{ item.description }}</p>
                <div v-if="item.refno" class="mt-1">
                  <span class="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-600">{{ item.refno }}</span>
                </div>
              </div>
              <span class="shrink-0 text-[11px] text-slate-400">{{ formatAnnotationTime(item.createdAt) }}</span>
            </div>

            <!-- 底部：评论数 + 操作 -->
            <div class="mt-2 flex items-center justify-between">
              <div class="flex items-center gap-2 text-[11px] text-slate-400">
                <div v-if="item.commentCount > 0" class="flex items-center gap-1 text-orange-500">
                  <MessageSquare class="h-3 w-3" />
                  <span class="font-medium">{{ item.commentCount }} 条意见</span>
                </div>
                <div v-else class="text-slate-400">暂无意见</div>
              </div>
              <div class="flex items-center gap-0.5">
                <button type="button"
                  class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-500"
                  title="在场景中定位此批注"
                  @click.stop="flyToAnnotationItem(item)">
                  <ArrowRight class="h-3.5 w-3.5" />
                </button>
                <ChevronDown class="h-3.5 w-3.5 text-slate-400 transition-transform"
                  :class="{ 'rotate-180': expandedAnnotationId === item.id }" />
              </div>
            </div>
          </div>

          <!-- 展开的评论线程 -->
          <div v-if="expandedAnnotationId === item.id && expandedAnnotationType"
            class="mt-1 mb-2">
            <ReviewCommentsTimeline :annotation-type="expandedAnnotationType"
              :annotation-id="item.id"
              :annotation-label="`${getAnnotationTypeBadge(item.type).label}批注 / ${item.title}`"
              @close="expandedAnnotationId = null; expandedAnnotationType = null" />
          </div>
        </div>
      </div>
    </div>

    <!-- 弹窗组件 -->
    <WorkflowSubmitDialog v-if="!isPassiveWorkflow"
      :visible="showSubmitDialog"
      :current-node="currentNode"
      :target-node="submitTargetNode"
      :loading="workflowActionLoading"
      @update:visible="(visible) => { if (!visible) closeSubmitDialog(); }"
      @confirm="(comment) => { submitComment = comment ?? ''; void handleSubmitToNextNode(); }" />

    <WorkflowReturnDialog v-if="!isPassiveWorkflow"
      :visible="showReturnDialog"
      :current-node="currentNode"
      :loading="workflowActionLoading"
      @update:visible="(visible) => { if (!visible) closeReturnDialog(); }"
      @confirm="(targetNode, reason) => { returnTargetNode = targetNode; returnReason = reason; void handleReturnToNode(); }" />

    <!-- ═══════ D. Tab 切换区域 ═══════ -->
    <div class="rounded-lg border border-slate-200 bg-white">
      <!-- Tab 头部 -->
      <div class="flex items-center gap-1 rounded-t-lg border-b border-slate-200 bg-slate-100 p-1">
        <button type="button"
          class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          :class="activeReviewTab === 'records'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'"
          @click="activeReviewTab = 'records'">
          审核记录
          <span v-if="confirmedRecordListCount > 0"
            class="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
            {{ confirmedRecordListCount }}
          </span>
        </button>
        <button type="button"
          class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          :class="activeReviewTab === 'history'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'"
          @click="activeReviewTab = 'history'">
          历史流转
          <span v-if="workflowHistoryCount > 0"
            class="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
            {{ workflowHistoryCount }}
          </span>
        </button>
        <button type="button"
          class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          :class="activeReviewTab === 'attachments'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'"
          @click="activeReviewTab = 'attachments'">
          附件材料
        </button>
      </div>

      <!-- Tab: 审核记录 -->
      <div v-show="activeReviewTab === 'records'" class="p-4"
        data-testid="review-workbench-confirmed-records-zone">
        <div v-if="confirmedRecordListCount === 0" class="py-4 text-center text-sm text-muted-foreground">暂无确认记录</div>
        <div v-else class="flex max-h-72 flex-col gap-2 overflow-y-auto">
          <div v-for="record in reviewStore.sortedConfirmedRecords.value"
            :key="record.id"
            class="rounded-xl border border-slate-200 bg-slate-50/80 p-3 shadow-sm">
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-1">
                <div class="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">确认时间</div>
                <span class="block text-sm font-semibold text-slate-900">{{ formatDateTime(record.confirmedAt) }}</span>
              </div>
              <button type="button" class="rounded p-1 text-destructive hover:bg-muted" title="删除"
                @click="reviewStore.removeConfirmedRecord(record.id)">
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>
            <div class="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div class="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <div class="text-[11px] uppercase tracking-[0.14em] text-slate-400">批注</div>
                <div class="mt-1 text-base font-semibold text-slate-900">{{ getConfirmedAnnotationCount(record) }}</div>
              </div>
              <div class="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <div class="text-[11px] uppercase tracking-[0.14em] text-slate-400">测量</div>
                <div class="mt-1 text-base font-semibold text-slate-900">{{ getConfirmedMeasurementCount(record) }}</div>
              </div>
              <div class="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <div class="text-[11px] uppercase tracking-[0.14em] text-slate-400">备注</div>
                <div class="mt-1 break-words text-sm font-medium text-slate-900">{{ getConfirmedRecordNote(record) }}</div>
              </div>
            </div>
          </div>
        </div>
        <!-- 统计 + 操作 -->
        <div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <div class="flex items-center gap-3 text-xs text-slate-500">
            <span>{{ reviewStore.confirmedRecordCount }} 批次</span>
            <span>批注 {{ reviewStore.totalConfirmedAnnotations }}</span>
            <span>测量 {{ reviewStore.totalConfirmedMeasurements }}</span>
          </div>
          <div class="flex gap-1.5">
            <button type="button"
              class="h-7 rounded-md border border-input bg-background px-2.5 text-xs hover:bg-muted disabled:opacity-50"
              :disabled="reviewStore.confirmedRecordCount.value === 0"
              @click="exportData">
              <Download class="mr-0.5 inline h-3 w-3" />导出
            </button>
            <button type="button"
              class="h-7 rounded-md border border-input bg-background px-2.5 text-xs text-destructive hover:bg-muted disabled:opacity-50"
              :disabled="reviewStore.confirmedRecordCount.value === 0"
              @click="handleClearConfirmedRecords()">
              <Trash2 class="mr-0.5 inline h-3 w-3" />清空
            </button>
          </div>
        </div>
      </div>

      <!-- Tab: 历史流转 -->
      <div v-show="activeReviewTab === 'history'" class="p-4"
        data-testid="review-workbench-workflow-history-zone">
        <div v-if="workflowLoading" class="py-4 text-center text-sm text-muted-foreground">正在加载工作流...</div>
        <div v-else-if="workflowError" class="py-4 text-center text-sm text-red-600">{{ workflowError }}</div>
        <div v-else-if="!workflow || workflow.history.length === 0" class="py-4 text-center text-sm text-muted-foreground">暂无历史记录</div>
        <div v-else class="flex max-h-72 flex-col gap-2 overflow-y-auto">
          <div v-for="(step, idx) in workflow.history"
            :key="`${step.operatorId}-${step.timestamp}-${idx}`"
            class="relative rounded-xl border border-slate-200 bg-slate-50/80 p-3 pl-8 text-xs before:absolute before:left-3 before:top-3 before:h-full before:w-px before:bg-slate-200 before:content-[''] first:before:top-6 last:before:h-6">
            <span class="absolute left-[7px] top-4 h-3 w-3 rounded-full border-2 border-white bg-primary shadow-sm" />
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-medium text-foreground">{{ getWorkflowNodeLabel(step) }}</div>
                <div class="mt-1 text-muted-foreground">动作：{{ getWorkflowActionLabel(step.action) }}</div>
              </div>
              <span class="text-right text-muted-foreground">{{ formatDateTime(step.timestamp) }}</span>
            </div>
            <div class="mt-1 text-muted-foreground">操作人: {{ step.operatorName || step.operatorId || '-' }}</div>
            <div class="mt-1 text-muted-foreground">备注: {{ step.comment?.trim() || '-' }}</div>
          </div>
        </div>
      </div>

      <!-- Tab: 附件材料 -->
      <div v-show="activeReviewTab === 'attachments'" class="space-y-4 p-4">
        <!-- 辅助校审数据 -->
        <section class="rounded-lg border border-slate-200 bg-slate-50 p-4"
          data-testid="review-workbench-aux-zone">
          <div class="mb-3 text-sm font-semibold text-slate-900">辅助校审数据</div>
          <ReviewAuxData />
        </section>

        <!-- 数据同步 -->
        <section class="rounded-lg border border-slate-200 bg-slate-50 p-4"
          data-testid="review-workbench-sync-zone">
          <div class="mb-3 text-sm font-semibold text-slate-900">数据同步（后端）</div>
          <ReviewDataSync />
        </section>

        <!-- 附件列表 -->
        <section v-if="currentTask && currentTask.attachments && currentTask.attachments.length > 0"
          class="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div class="text-sm font-semibold text-slate-900">附件文件 ({{ currentTask.attachments.length }})</div>
          <div class="mt-2 max-h-48 space-y-2 overflow-y-auto">
            <div v-for="attachment in currentTask.attachments"
              :key="attachment.id"
              class="flex cursor-pointer items-center gap-2 rounded-md bg-white p-2 hover:bg-muted"
              @click="downloadAttachment(attachment)">
              <Paperclip class="h-4 w-4 text-gray-500" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ attachment.name }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ formatFileSize(attachment.size) }} · {{ formatDate(attachment.uploadedAt) }}
                </div>
              </div>
              <Download class="h-4 w-4 text-gray-400" />
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
