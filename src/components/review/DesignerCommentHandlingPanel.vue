<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
  AlertCircle,
  Calendar,
  ClipboardCheck,
  FileText,
  Package,
  Paperclip,
  RefreshCw,
  Send,
  X,
  XCircle,
} from 'lucide-vue-next';

import {
  clearAnnotationProcessingEntryTarget,
  useAnnotationProcessingEntryTarget,
  type AnnotationProcessingEntryTarget,
} from './annotationProcessingEntry';
import AnnotationTableView from './AnnotationTableView.vue';
import AnnotationWorkspace from './AnnotationWorkspace.vue';
import {
  buildAnnotationWorkspaceItems,
  buildAnnotationWorkspaceSummary,
  buildLinkedMeasurementItems,
  filterAnnotationWorkspaceItems,
  scopeAnnotationWorkspaceItemsByFormId,
  type AnnotationWorkspaceFilter,
  type AnnotationWorkspaceItem,
} from './annotationWorkspaceModel';
import { createConfirmedRecordsRestorer } from './confirmedRecordsRestore';
import {
  clearDesignerCommentViewModeRequest,
  useDesignerCommentViewModeRequest,
} from './designerCommentViewModeBus';
import {
  EMBED_LANDING_STATE_STORAGE_KEY,
  EMBED_LANDING_STATE_UPDATED_EVENT,
} from './embedRoleLanding';
import ResubmissionTaskList from './ResubmissionTaskList.vue';
import {
  buildReviewConfirmSnapshotKey,
  buildReviewConfirmSnapshotPayload,
  buildReviewConfirmSnapshotPayloadFromRecords,
  buildUnsavedReviewConfirmPayload,
  confirmCurrentDataSafely,
  hasReviewConfirmPayloadData,
} from './reviewPanelActions';
import {
  getCanonicalReturnedMetadata,
  getResubmissionLatestReturnTime,
  isCanonicalReturnedTask,
} from './reviewTaskFilters';
import TaskReviewDetail from './TaskReviewDetail.vue';

import { reviewAnnotationCheck, getReviewAnnotationCheckFromError } from '@/api/reviewApi';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useNavigationStatePersistence } from '@/composables/useNavigationStatePersistence';
import { useReviewStore } from '@/composables/useReviewStore';
import {
  getAnnotationRefnos,
  useToolStore,
  type AnnotationType,
} from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';
import { emitCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';
import {
  canEditAnnotationSeverity,
  getPriorityDisplayName,
  getTaskStatusDisplayName,
  WORKFLOW_NODE_NAMES,
  type AnnotationSeverity,
  type ReviewTask,
} from '@/types/auth';

type DesignerCommentWorkspaceView = 'task_entry' | 'annotation_list' | 'annotation_detail';
type AnnotationListViewMode = 'split' | 'table';
type StoredEmbedLandingState = {
  target?: string | null;
  formId?: string | null;
  primaryPanelId?: string | null;
};

function normalizeFormId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function buildAnnotationSelectionKey(taskId: string | null, type: AnnotationType, id: string): string {
  return `${taskId || '__no_task__'}::${type}:${id}`;
}

function formatDateTime(timestamp?: number | null): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateOnly(timestamp?: number | null): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatWorkflowNode(node?: ReviewTask['currentNode'] | null): string {
  if (!node) return '—';
  return WORKFLOW_NODE_NAMES[node] || node;
}

function toViewerRefno(refno: string): string {
  const normalized = String(refno || '').trim();
  const match = normalized.match(/^(\d+)_(\d+)$/);
  return match ? `${match[1]}/${match[2]}` : normalized;
}

function readStoredEmbedLandingState(): StoredEmbedLandingState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(EMBED_LANDING_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredEmbedLandingState | null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const userStore = useUserStore();
const reviewStore = useReviewStore();
const toolStore = useToolStore();
const viewerContext = useViewerContext();
const navigationState = useNavigationStatePersistence('plant3d-web-nav-state-designer-comment-handling-v2');
const annotationProcessingEntryTarget = useAnnotationProcessingEntryTarget();
const designerCommentViewModeRequest = useDesignerCommentViewModeRequest();

const selectedTaskId = ref<string | null>(null);
const selectedAnnotationId = ref<string | null>(null);
const selectedAnnotationType = ref<AnnotationType | null>(null);
const persistedAnnotationKey = ref<string | null>(null);
const showInitiateDrawer = ref(false);
const detailTask = ref<ReviewTask | null>(null);
const confirmNote = ref('');
const confirmSaving = ref(false);
const confirmError = ref<string | null>(null);
const refreshingTask = ref(false);
const resubmitLoading = ref(false);
const externalEntryTarget = ref<AnnotationProcessingEntryTarget | null>(null);
const externalEntryLock = ref(false);
const applyingExternalEntry = ref(false);
const annotationFilter = ref<AnnotationWorkspaceFilter>('all');
const workspaceView = ref<DesignerCommentWorkspaceView>('task_entry');
const annotationListViewMode = ref<AnnotationListViewMode>('split');
const enteredWorkspaceFromTaskEntry = ref(false);
const annotationListScrollTop = ref(0);
const storedEmbedLandingState = ref<StoredEmbedLandingState | null>(readStoredEmbedLandingState());

navigationState.bindRef('selectedTaskId', selectedTaskId, null);
navigationState.bindRef('selectedAnnotationKey', persistedAnnotationKey, null);
navigationState.bindRef('showInitiateDrawer', showInitiateDrawer, false);
navigationState.bindRef<AnnotationListViewMode>('annotationListViewMode', annotationListViewMode, 'split');

const confirmedRecordsRestorer = createConfirmedRecordsRestorer({
  currentTaskId: () => reviewStore.currentTask.value?.id ?? null,
  confirmedRecords: () => reviewStore.sortedConfirmedRecords.value,
  toolStore,
  waitForViewerReady,
  getViewerTools: () => viewerContext.tools.value ?? null,
});

const returnedTasks = computed(() => userStore.returnedInitiatedTasks.value.filter((task) => isCanonicalReturnedTask(task)));
const passiveRestoredTaskFormId = computed(() => {
  const landingState = storedEmbedLandingState.value;
  if (!landingState || landingState.target !== 'designer' || landingState.primaryPanelId !== 'designerCommentHandling') {
    return null;
  }
  return normalizeFormId(landingState.formId);
});
function isPassiveRestoredTask(task: ReviewTask | null): boolean {
  const formId = normalizeFormId(task?.formId);
  return !!formId && formId === passiveRestoredTaskFormId.value;
}
const currentTask = computed(() => {
  const task = reviewStore.currentTask.value;
  if (task && isCanonicalReturnedTask(task)) return task;
  if (task && isPassiveRestoredTask(task)) return task;
  return null;
});
const isCurrentTaskReturned = computed(() => !!currentTask.value && isCanonicalReturnedTask(currentTask.value));
const currentTaskStatus = computed(() => currentTask.value ? getTaskStatusDisplayName(currentTask.value.status) : null);
const currentTaskPriority = computed(() => currentTask.value ? getPriorityDisplayName(currentTask.value.priority) : null);
const returnedMetadata = computed(() => (
  isCurrentTaskReturned.value && currentTask.value
    ? getCanonicalReturnedMetadata(currentTask.value)
    : null
));
const latestReturnTimestamp = computed(() => (
  isCurrentTaskReturned.value && currentTask.value
    ? getResubmissionLatestReturnTime(currentTask.value.workflowHistory || [])
    : null
));
const currentTaskConfirmedRecords = confirmedRecordsRestorer.currentTaskRecords;
const currentTaskDueDate = computed(() => formatDateOnly(currentTask.value?.dueDate));
const matchedExternalTask = computed(() => {
  const formId = normalizeFormId(externalEntryTarget.value?.formId);
  if (!formId) return null;
  return returnedTasks.value.find((task) => normalizeFormId(task.formId) === formId) ?? null;
});
const hasExternalEntryWithoutMatchedTask = computed(() => (
  externalEntryLock.value && !!externalEntryTarget.value && !matchedExternalTask.value && !currentTask.value
));
const showTaskEntry = computed(() => workspaceView.value === 'task_entry');
const showAnnotationList = computed(() => workspaceView.value === 'annotation_list');
const showAnnotationDetail = computed(() => workspaceView.value === 'annotation_detail');
const canReturnToTaskEntry = computed(() => (
  showAnnotationList.value
  && enteredWorkspaceFromTaskEntry.value
  && returnedTasks.value.length > 0
  && !externalEntryLock.value
));
const canReturnToAnnotationList = computed(() => (
  showAnnotationDetail.value
  && !!currentTask.value
  && !hasExternalEntryWithoutMatchedTask.value
));

const allAnnotationItems = computed<AnnotationWorkspaceItem[]>(() => buildAnnotationWorkspaceItems({
  annotations: toolStore.annotations.value,
  cloudAnnotations: toolStore.cloudAnnotations.value,
  rectAnnotations: toolStore.rectAnnotations.value,
  obbAnnotations: toolStore.obbAnnotations.value,
  getCommentCount: (type, id) => toolStore.getAnnotationComments(type, id).length,
}));

const scopedAnnotationItems = computed<AnnotationWorkspaceItem[]>(() => {
  const currentFormId = currentTask.value?.formId ?? null;
  const externalFormId = externalEntryTarget.value?.formId ?? null;
  let items = scopeAnnotationWorkspaceItemsByFormId(
    allAnnotationItems.value,
    currentFormId || externalFormId,
  );

  const target = externalEntryTarget.value;
  if (target) {
    const matched = allAnnotationItems.value.find((item) => item.id === target.annotationId && item.type === target.annotationType);
    if (matched && !items.some((item) => item.id === matched.id && item.type === matched.type)) {
      items = [matched];
    }
  }

  return items;
});

const annotationWorkspaceSummary = computed(() => buildAnnotationWorkspaceSummary(scopedAnnotationItems.value));
const filteredAnnotationItems = computed(() => filterAnnotationWorkspaceItems(scopedAnnotationItems.value, annotationFilter.value));
const selectedAnnotation = computed<AnnotationWorkspaceItem | null>(() => (
  filteredAnnotationItems.value.find((item) => item.id === selectedAnnotationId.value && item.type === selectedAnnotationType.value) ?? null
));
const linkedMeasurements = computed(() => buildLinkedMeasurementItems(
  selectedAnnotation.value,
  toolStore.measurements.value,
  [
    ...toolStore.xeokitDistanceMeasurements.value,
    ...toolStore.xeokitAngleMeasurements.value,
  ],
));
const canEditSelectedSeverity = computed(() => (
  canEditAnnotationSeverity(userStore.currentUser.value, selectedAnnotation.value?.authorId)
));

const currentDraftConfirmPayload = computed(() => buildReviewConfirmSnapshotPayload({
  annotations: [...toolStore.annotations.value],
  cloudAnnotations: [...toolStore.cloudAnnotations.value],
  rectAnnotations: [...toolStore.rectAnnotations.value],
  obbAnnotations: [...toolStore.obbAnnotations.value],
  measurements: [...toolStore.measurements.value],
  xeokitDistanceMeasurements: [...toolStore.xeokitDistanceMeasurements.value],
  xeokitAngleMeasurements: [...toolStore.xeokitAngleMeasurements.value],
}));
const confirmedSnapshotPayload = computed(() => (
  buildReviewConfirmSnapshotPayloadFromRecords(currentTaskConfirmedRecords.value)
));
const unsavedConfirmPayload = computed(() => (
  buildUnsavedReviewConfirmPayload(currentDraftConfirmPayload.value, confirmedSnapshotPayload.value)
));
const hasUnsavedPendingData = computed(() => (
  buildReviewConfirmSnapshotKey(currentDraftConfirmPayload.value)
    !== buildReviewConfirmSnapshotKey(confirmedSnapshotPayload.value)
));
const unsavedAnnotationCount = computed(() => (
  unsavedConfirmPayload.value.annotations.length
  + unsavedConfirmPayload.value.cloudAnnotations.length
  + unsavedConfirmPayload.value.rectAnnotations.length
  + unsavedConfirmPayload.value.obbAnnotations.length
));
const unsavedMeasurementCount = computed(() => unsavedConfirmPayload.value.measurements.length);
const canConfirmCurrentData = computed(() => (
  !!currentTask.value && hasUnsavedPendingData.value && hasReviewConfirmPayloadData(unsavedConfirmPayload.value)
));
const canResubmitCurrentTask = computed(() => (
  isCurrentTaskReturned.value && !!currentTask.value && currentTask.value.currentNode === 'sj' && currentTask.value.status === 'draft'
));

function syncStoredEmbedLandingState() {
  storedEmbedLandingState.value = readStoredEmbedLandingState();
}

function setActiveWorkspaceAnnotation(type: AnnotationType | null, id: string | null) {
  toolStore.activeAnnotationId.value = type === 'text' ? id : null;
  toolStore.activeCloudAnnotationId.value = type === 'cloud' ? id : null;
  toolStore.activeRectAnnotationId.value = type === 'rect' ? id : null;
  toolStore.activeObbAnnotationId.value = type === 'obb' ? id : null;
}

function enterTaskEntry() {
  workspaceView.value = 'task_entry';
  enteredWorkspaceFromTaskEntry.value = false;
  annotationListScrollTop.value = 0;
}

function enterAnnotationList(options?: { fromTaskEntry?: boolean }) {
  workspaceView.value = 'annotation_list';
  if (options?.fromTaskEntry != null) {
    enteredWorkspaceFromTaskEntry.value = options.fromTaskEntry;
  }
}

function enterAnnotationDetail(item: AnnotationWorkspaceItem | null, source: 'manual' | 'external' = 'manual') {
  if (!item) return;
  selectWorkspaceAnnotation(item, source);
  workspaceView.value = 'annotation_detail';
  annotationListViewMode.value = 'split';
}

function backToAnnotationList() {
  if (!currentTask.value) {
    enterTaskEntry();
    return;
  }
  workspaceView.value = 'annotation_list';
}

function clearExternalEntryLock() {
  externalEntryLock.value = false;
  externalEntryTarget.value = null;
}

function selectWorkspaceAnnotation(item: AnnotationWorkspaceItem | null, source: 'manual' | 'external' = 'manual') {
  if (source === 'manual') {
    clearExternalEntryLock();
  }

  if (!item) {
    selectedAnnotationId.value = null;
    selectedAnnotationType.value = null;
    persistedAnnotationKey.value = null;
    setActiveWorkspaceAnnotation(null, null);
    return;
  }

  selectedAnnotationId.value = item.id;
  selectedAnnotationType.value = item.type;
  persistedAnnotationKey.value = buildAnnotationSelectionKey(currentTask.value?.id ?? null, item.type, item.id);
  setActiveWorkspaceAnnotation(item.type, item.id);
}

function resolvePreferredWorkspaceAnnotation(): AnnotationWorkspaceItem | null {
  const target = externalEntryTarget.value;
  if (target) {
    const matched = filteredAnnotationItems.value.find((item) => item.id === target.annotationId && item.type === target.annotationType);
    if (matched) return matched;
  }

  const persisted = persistedAnnotationKey.value;
  if (persisted) {
    const matched = filteredAnnotationItems.value.find((item) => (
      buildAnnotationSelectionKey(currentTask.value?.id ?? null, item.type, item.id) === persisted
    ));
    if (matched) return matched;
  }

  const pending = filteredAnnotationItems.value.find((item) => item.statusKey === 'pending');
  if (pending) return pending;
  return filteredAnnotationItems.value[0] ?? null;
}

async function loadTasks() {
  await userStore.loadReviewTasks();
}

async function selectTask(task: ReviewTask, source: 'manual' | 'external' = 'manual') {
  if (source === 'manual') {
    enteredWorkspaceFromTaskEntry.value = workspaceView.value === 'task_entry';
    clearExternalEntryLock();
  } else {
    enteredWorkspaceFromTaskEntry.value = false;
  }
  selectedTaskId.value = task.id;
  confirmError.value = null;
  await reviewStore.setCurrentTask(task);
}

async function clearTaskContext(source: 'manual' | 'external' = 'manual') {
  if (source === 'manual') {
    clearExternalEntryLock();
  }
  selectedTaskId.value = null;
  confirmError.value = null;
  enterTaskEntry();
  await reviewStore.setCurrentTask(null);
}

async function applyExternalAnnotationEntry() {
  const target = externalEntryTarget.value;
  if (!externalEntryLock.value || !target || applyingExternalEntry.value) return;

  applyingExternalEntry.value = true;
  try {
    const matchedTask = matchedExternalTask.value;
    if (matchedTask) {
      await selectTask(matchedTask, 'external');
      const matchedAnnotation = allAnnotationItems.value.find((item) => item.id === target.annotationId && item.type === target.annotationType) ?? null;
      if (matchedAnnotation) {
        enterAnnotationDetail(matchedAnnotation, 'external');
      } else {
        enterAnnotationList({ fromTaskEntry: false });
      }
      return;
    }

    if (reviewStore.currentTask.value) {
      await clearTaskContext('external');
    } else {
      selectedTaskId.value = null;
    }
    const orphan = allAnnotationItems.value.find((item) => item.id === target.annotationId && item.type === target.annotationType) ?? null;
    if (orphan) {
      enterAnnotationDetail(orphan, 'external');
    } else {
      workspaceView.value = 'annotation_detail';
    }
  } finally {
    applyingExternalEntry.value = false;
  }
}

function openTaskHistory(task: ReviewTask) {
  detailTask.value = task;
}

async function refreshCurrentTask() {
  refreshingTask.value = true;
  try {
    await userStore.loadReviewTasks();
    if (externalEntryLock.value) {
      await applyExternalAnnotationEntry();
      return;
    }

    const taskId = reviewStore.currentTask.value?.id;
    if (!taskId) return;
    const matched = returnedTasks.value.find((task) => task.id === taskId) ?? null;
    if (matched) {
      await reviewStore.setCurrentTask(matched);
      return;
    }
    if (currentTask.value && isPassiveRestoredTask(currentTask.value)) {
      return;
    }
    await clearTaskContext();
  } finally {
    refreshingTask.value = false;
  }
}

async function locateAnnotation(item: AnnotationWorkspaceItem | null) {
  if (!item) return;
  selectWorkspaceAnnotation(item);
  ensurePanelAndActivate('viewer');
  if (!item.refnos.length) return;
  const result = await showModelByRefnosWithAck({
    refnos: item.refnos.map((refno) => toViewerRefno(refno)),
    viewerRef: viewerContext.viewerRef,
    flyTo: true,
  });
  if (result.error && result.ok.length === 0) {
    emitToast({ message: result.error, level: 'warning' });
  }
}

async function startMeasurement(kind: 'distance' | 'angle') {
  const annotation = selectedAnnotation.value;
  if (!annotation) {
    emitToast({ message: '请先选择一条批注，再补充测量证据', level: 'warning' });
    return;
  }
  selectWorkspaceAnnotation(annotation);
  ensurePanelAndActivate('viewer');
  emitCommand(kind === 'distance' ? 'measurement.distance' : 'measurement.angle');
  emitToast({
    message: kind === 'distance' ? '请在模型中选择两个点完成距离测量' : '请在模型中选择三个点完成角度测量',
    level: 'info',
  });
}

function locateMeasurement(item: (typeof linkedMeasurements.value)[number]) {
  ensurePanelAndActivate('viewer');
  if (item.engine === 'xeokit') {
    toolStore.activeXeokitMeasurementId.value = item.id;
    viewerContext.xeokitMeasurementTools.value?.flyToMeasurement(item.id);
    return;
  }
  toolStore.activeMeasurementId.value = item.id;
  viewerContext.tools.value?.flyToMeasurement(item.id);
}

function handleCopyFeedback(payload: {
  kind: 'refno' | 'row';
  result: 'copied' | 'fallback' | 'failed';
  item: AnnotationWorkspaceItem;
}): void {
  const kindLabel = payload.kind === 'refno' ? 'RefNo' : '批注行';
  if (payload.result === 'failed') {
    emitToast({ message: `复制${kindLabel}失败，请重试`, level: 'warning' });
    return;
  }
  emitToast({
    message: payload.result === 'fallback' ? `已复制${kindLabel}（降级）` : `已复制${kindLabel}`,
    level: 'success',
  });
}

async function handleTableOpenAnnotation(item: AnnotationWorkspaceItem) {
  await locateAnnotation(item);
  enterAnnotationDetail(item);
}

async function updateSelectedAnnotationSeverity(severity: AnnotationSeverity | undefined) {
  if (!selectedAnnotation.value || !canEditSelectedSeverity.value) return;
  const { saveAnnotationSeverity } = await import('@/composables/useAnnotationSeveritySync');
  await saveAnnotationSeverity(selectedAnnotation.value.type, selectedAnnotation.value.id, severity);
}

const annotationCheckBlockers = ref<{ annotationId: string; annotationType: string; stateLabel: string }[]>([]);

async function confirmCurrentData() {
  if (!currentTask.value) {
    confirmError.value = '当前未匹配到对应单据，无法确认当前数据';
    return;
  }
  if (confirmSaving.value || !canConfirmCurrentData.value) return;

  confirmSaving.value = true;
  confirmError.value = null;
  annotationCheckBlockers.value = [];

  if (currentTask.value.formId) {
    try {
      const checkResp = await reviewAnnotationCheck({
        formId: currentTask.value.formId,
        taskId: currentTask.value.id,
        currentNode: currentTask.value.currentNode || 'sj',
        intent: 'submit_next',
      });
      if (!checkResp.success) {
        confirmError.value = checkResp.error_message || '批注门禁校验请求失败';
        confirmSaving.value = false;
        return;
      }
      if (checkResp.data && !checkResp.data.passed) {
        confirmError.value = checkResp.data.message || '存在未处理批注，请先处理后再确认';
        annotationCheckBlockers.value = checkResp.data.blockers.map((b) => ({
          annotationId: b.annotationId,
          annotationType: b.annotationType,
          stateLabel: b.stateLabel,
        }));
        confirmSaving.value = false;
        return;
      }
    } catch (err) {
      const checkResult = getReviewAnnotationCheckFromError(err);
      if (checkResult && !checkResult.passed) {
        confirmError.value = checkResult.message || '批注门禁校验未通过';
        annotationCheckBlockers.value = checkResult.blockers.map((b) => ({
          annotationId: b.annotationId,
          annotationType: b.annotationType,
          stateLabel: b.stateLabel,
        }));
        confirmSaving.value = false;
        return;
      }
      confirmError.value = err instanceof Error ? err.message : '批注门禁校验异常';
      confirmSaving.value = false;
      return;
    }
  }

  try {
    const saved = await confirmCurrentDataSafely({
      hasPendingData: canConfirmCurrentData.value,
      payload: {
        type: 'batch' as const,
        formId: currentTask.value.formId,
        annotations: [...currentDraftConfirmPayload.value.annotations],
        cloudAnnotations: [...currentDraftConfirmPayload.value.cloudAnnotations],
        rectAnnotations: [...currentDraftConfirmPayload.value.rectAnnotations],
        obbAnnotations: [...currentDraftConfirmPayload.value.obbAnnotations],
        measurements: [...currentDraftConfirmPayload.value.measurements],
        note: confirmNote.value.trim(),
      },
      addConfirmedRecord: reviewStore.addConfirmedRecord,
      clearDraftData: () => {
        toolStore.clearDraftDataByPayload(unsavedConfirmPayload.value);
      },
      resetNote: () => {
        confirmNote.value = '';
      },
    });
    if (saved) {
      emitToast({ message: '确认数据已保存，可回外部平台继续流转', level: 'success' });
      await nextTick();
      await confirmedRecordsRestorer.restoreConfirmedRecordsIntoScene(true);
    }
  } catch (error) {
    confirmError.value = error instanceof Error ? error.message : '确认当前数据失败';
  } finally {
    confirmSaving.value = false;
  }
}

async function handleResubmitTask() {
  if (!currentTask.value || !canResubmitCurrentTask.value || resubmitLoading.value) return;

  resubmitLoading.value = true;
  confirmError.value = null;
  try {
    await userStore.submitTaskToNextNode(currentTask.value.id);
    await refreshCurrentTask();
    emitToast({ message: '已确认再次提交流转', level: 'success' });
  } catch (error) {
    confirmError.value = error instanceof Error ? error.message : '再次提交流转失败';
  } finally {
    resubmitLoading.value = false;
  }
}

watch(
  () => annotationProcessingEntryTarget.value?.requestedAt ?? null,
  () => {
    const target = annotationProcessingEntryTarget.value;
    if (!target) return;
    externalEntryTarget.value = { ...target };
    externalEntryLock.value = true;
    annotationFilter.value = 'all';
    clearAnnotationProcessingEntryTarget();
    void applyExternalAnnotationEntry();
  },
  { immediate: true },
);

watch(
  () => designerCommentViewModeRequest.value?.requestedAt ?? null,
  () => {
    const request = designerCommentViewModeRequest.value;
    if (!request) return;
    annotationListViewMode.value = request.mode;
    if (request.mode === 'table' && workspaceView.value === 'annotation_detail') {
      workspaceView.value = 'annotation_list';
    }
    clearDesignerCommentViewModeRequest();
  },
  { immediate: true },
);

watch(
  () => currentTask.value?.id ?? null,
  (taskId, previousTaskId) => {
    if (taskId) {
      selectedTaskId.value = taskId;
    }
    confirmError.value = null;
    if (externalEntryLock.value) return;

    if (!taskId) {
      if (!hasExternalEntryWithoutMatchedTask.value) {
        enterTaskEntry();
      }
      return;
    }

    if (taskId !== previousTaskId || workspaceView.value === 'task_entry') {
      enterAnnotationList();
    }
  },
  { immediate: true },
);

watch(
  () => filteredAnnotationItems.value.map((item) => `${item.type}:${item.id}:${item.activityAt}`).join('|'),
  () => {
    const current = selectedAnnotation.value;
    if (current) {
      setActiveWorkspaceAnnotation(current.type, current.id);
      return;
    }

    const preferred = resolvePreferredWorkspaceAnnotation();
    if (preferred) {
      selectWorkspaceAnnotation(preferred, externalEntryLock.value ? 'external' : 'manual');
      return;
    }

    selectWorkspaceAnnotation(null, externalEntryLock.value ? 'external' : 'manual');
  },
  { immediate: true },
);

watch(annotationFilter, () => {
  if (selectedAnnotation.value) return;
  const preferred = resolvePreferredWorkspaceAnnotation();
  if (preferred) {
    selectWorkspaceAnnotation(preferred, externalEntryLock.value ? 'external' : 'manual');
  }
});

watch(
  () => ({
    taskId: currentTask.value?.id ?? null,
    recordKeys: currentTaskConfirmedRecords.value.map((record) => `${record.id}:${record.confirmedAt}`).join('|'),
    viewerReady: !!viewerContext.viewerRef.value,
    toolsReady: !!viewerContext.tools.value,
  }),
  async () => {
    await confirmedRecordsRestorer.restoreConfirmedRecordsIntoScene();
  },
  { immediate: true },
);

onMounted(async () => {
  window.addEventListener(EMBED_LANDING_STATE_UPDATED_EVENT, syncStoredEmbedLandingState as EventListener);
  await loadTasks();

  if (externalEntryLock.value) {
    await applyExternalAnnotationEntry();
    return;
  }

  const persistedTaskId = selectedTaskId.value;
  if (!currentTask.value && persistedTaskId) {
    const matchedTask = returnedTasks.value.find((task) => task.id === persistedTaskId) ?? null;
    if (matchedTask) {
      await selectTask(matchedTask);
      return;
    }
  }

  if (currentTask.value) {
    selectedTaskId.value = currentTask.value.id;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener(EMBED_LANDING_STATE_UPDATED_EVENT, syncStoredEmbedLandingState as EventListener);
});
</script>

<template>
  <div class="relative h-full min-h-0 overflow-hidden bg-[#F8FAFC]" data-panel="designerCommentHandling">
    <div class="flex h-full min-h-0 flex-col overflow-hidden p-4">
      <section v-if="showTaskEntry"
        class="flex h-full min-h-0 flex-col gap-4"
        data-testid="designer-comment-task-entry">
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-xl font-semibold text-slate-950">批注处理</h2>
                <span v-if="returnedTasks.length"
                  class="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                  {{ returnedTasks.length }} 个待处理
                </span>
              </div>
              <p class="mt-2 text-sm leading-6 text-slate-600">先选择退回单据，再进入新的批注处理工作区。</p>
            </div>
            <button type="button"
              class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              @click="loadTasks">
              <RefreshCw class="h-4 w-4" />
              刷新任务
            </button>
          </div>
        </div>

        <div v-if="returnedTasks.length"
          class="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <ResubmissionTaskList :auto-load="false"
            detail-mode="external"
            :selected-task-id="selectedTaskId"
            cta-label="进入批注处理"
            @select-task="(task) => void selectTask(task)"
            @view-task="openTaskHistory" />
        </div>
        <div v-else class="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white">
          <div class="text-center text-sm text-slate-500">
            <XCircle class="mx-auto mb-3 h-9 w-9 text-slate-300" />
            当前没有需要处理的退回单据
          </div>
        </div>
      </section>

      <section v-else class="flex h-full min-h-0 flex-col overflow-hidden" data-testid="designer-comment-workspace">
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 space-y-3">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-xl font-semibold text-slate-950">{{ currentTask?.title || selectedAnnotation?.title || '批注处理' }}</h2>
                <span v-if="isCurrentTaskReturned" class="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">已退回</span>
                <span v-if="currentTaskStatus" class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="currentTaskStatus.color">
                  {{ currentTaskStatus.label }}
                </span>
                <span v-if="currentTaskPriority" class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="currentTaskPriority.color">
                  {{ currentTaskPriority.label }}
                </span>
                <span v-if="hasExternalEntryWithoutMatchedTask"
                  class="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  未匹配到单据
                </span>
              </div>
              <p class="text-sm leading-6 text-slate-600">
                {{ currentTask?.description || '当前批注来自外部入口，但未匹配到退回单据；可继续查看回复与测量证据。' }}
              </p>
              <div v-if="currentTask" class="grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                <div class="rounded-xl bg-slate-50 px-3 py-2.5">
                  <div class="text-xs text-slate-400">退回节点</div>
                  <div class="mt-1 font-medium text-slate-900">{{ formatWorkflowNode(returnedMetadata?.returnNode || null) }}</div>
                </div>
                <div class="rounded-xl bg-slate-50 px-3 py-2.5">
                  <div class="text-xs text-slate-400">退回时间</div>
                  <div class="mt-1 font-medium text-slate-900">{{ formatDateTime(latestReturnTimestamp) }}</div>
                </div>
                <div class="rounded-xl bg-slate-50 px-3 py-2.5">
                  <div class="text-xs text-slate-400">当前节点</div>
                  <div class="mt-1 font-medium text-slate-900">{{ formatWorkflowNode(currentTask.currentNode) }}</div>
                </div>
                <div class="rounded-xl bg-slate-50 px-3 py-2.5">
                  <div class="text-xs text-slate-400">构件数</div>
                  <div class="mt-1 font-medium text-slate-900">{{ currentTask.components.length }} 个</div>
                </div>
              </div>
            </div>
            <div class="flex shrink-0 flex-col gap-2">
              <button v-if="canReturnToTaskEntry"
                type="button"
                class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                data-testid="back-to-task-entry"
                @click="void clearTaskContext()">
                返回任务页
              </button>
              <button type="button"
                class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                :disabled="refreshingTask"
                @click="void refreshCurrentTask()">
                <RefreshCw class="h-4 w-4" :class="refreshingTask ? 'animate-spin' : ''" />
                刷新任务
              </button>
              <button v-if="currentTask"
                type="button"
                class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                @click="showInitiateDrawer = true">
                <FileText class="h-4 w-4" />
                查看发起单
              </button>
              <button v-if="currentTask"
                type="button"
                class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                @click="openTaskHistory(currentTask)">
                <Calendar class="h-4 w-4" />
                流转历史
              </button>
            </div>
          </div>

          <div v-if="isCurrentTaskReturned || currentTask?.returnReason"
            class="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <div class="flex items-start gap-2">
              <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div class="font-semibold">退回意见</div>
                <div class="mt-1 leading-6">{{ returnedMetadata?.returnReason || '未填写退回意见' }}</div>
              </div>
            </div>
          </div>

          <div v-else-if="hasExternalEntryWithoutMatchedTask"
            class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            data-testid="external-entry-unmatched-task">
            <div class="flex items-start gap-2">
              <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div class="font-semibold">未匹配到对应单据</div>
                <div class="mt-1 leading-6">
                  当前批注的 form_id 为 {{ externalEntryTarget?.formId || '—' }}，返回任务列表中没有同 form_id 的单据。
                  页面保留这条批注的处理详情，不自动切到其他单据。
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-4 min-h-0 flex-1 overflow-y-auto pb-2">
          <div v-if="showAnnotationList" data-testid="designer-comment-annotation-list">
            <div class="mb-3 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
              role="tablist"
              aria-label="批注视图切换"
              data-testid="annotation-list-view-mode-tabs">
              <button type="button"
                role="tab"
                :aria-selected="annotationListViewMode === 'split'"
                class="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold transition"
                :class="annotationListViewMode === 'split'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'"
                data-testid="annotation-list-view-mode-split"
                @click="annotationListViewMode = 'split'">
                卡片列表
              </button>
              <button type="button"
                role="tab"
                :aria-selected="annotationListViewMode === 'table'"
                class="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold transition"
                :class="annotationListViewMode === 'table'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'"
                data-testid="annotation-list-view-mode-table"
                @click="annotationListViewMode = 'table'">
                批注表格
              </button>
            </div>

            <AnnotationWorkspace v-if="annotationListViewMode === 'split'"
              role="designer"
              layout="list"
              :items="filteredAnnotationItems"
              :summary="annotationWorkspaceSummary"
              :active-filter="annotationFilter"
              :selected-annotation="selectedAnnotation"
              :linked-measurements="linkedMeasurements"
              :confirm-note="confirmNote"
              :unsaved-annotation-count="unsavedAnnotationCount"
              :unsaved-measurement-count="unsavedMeasurementCount"
              :can-confirm="canConfirmCurrentData"
              :confirm-saving="confirmSaving"
              :confirm-error="confirmError"
              :can-edit-severity="canEditSelectedSeverity"
              :show-tool-launcher="false"
              :timeline-designer-only="true"
              :list-scroll-top="annotationListScrollTop"
              timeline-placeholder="输入处理说明，或补充给校核人的说明..."
              timeline-submit-label="发送回复"
              confirm-action-label="确认当前数据"
              :confirm-hint="currentTask
                ? '处理动作与测量证据需要先确认保存，后续外部流转才能继续。'
                : '当前未匹配到对应单据，回复和历史可继续查看，但本页不能确认保存处理结果。'"
              empty-title="当前范围内还没有可处理的批注"
              empty-description="请选择退回任务，或等待对应 form_id 的批注同步后再处理。"
              @update:active-filter="annotationFilter = $event"
              @update:confirm-note="confirmNote = $event"
              @update:list-scroll-top="annotationListScrollTop = $event"
              @select-annotation="selectWorkspaceAnnotation"
              @open-annotation="enterAnnotationDetail"
              @locate-annotation="(item) => void locateAnnotation(item)"
              @locate-measurement="locateMeasurement"
              @start-measurement="(kind) => void startMeasurement(kind)"
              @update-severity="updateSelectedAnnotationSeverity"
              @confirm="void confirmCurrentData()" />

            <div v-else class="h-[680px] min-h-[560px]"
              data-testid="designer-comment-annotation-table">
              <AnnotationTableView :items="scopedAnnotationItems"
                :current-annotation-id="selectedAnnotationId"
                :current-annotation-type="selectedAnnotationType"
                :task-key="currentTask?.formId || currentTask?.id || null"
                :subtitle="currentTask?.title || null"
                empty-title="当前范围内还没有可处理的批注"
                empty-description="请选择退回任务，或等待对应 form_id 的批注同步后再处理。"
                @select-annotation="selectWorkspaceAnnotation"
                @open-annotation="(item) => void handleTableOpenAnnotation(item)"
                @locate-annotation="(item) => void locateAnnotation(item)"
                @copy-feedback="handleCopyFeedback" />
            </div>
          </div>

          <div v-else-if="showAnnotationDetail" data-testid="designer-comment-annotation-detail">
            <AnnotationWorkspace role="designer"
              layout="detail"
              :items="filteredAnnotationItems"
              :summary="annotationWorkspaceSummary"
              :active-filter="annotationFilter"
              :selected-annotation="selectedAnnotation"
              :linked-measurements="linkedMeasurements"
              :confirm-note="confirmNote"
              :unsaved-annotation-count="unsavedAnnotationCount"
              :unsaved-measurement-count="unsavedMeasurementCount"
              :can-confirm="canConfirmCurrentData"
              :confirm-saving="confirmSaving"
              :confirm-error="confirmError"
              :can-edit-severity="canEditSelectedSeverity"
              :show-tool-launcher="false"
              :timeline-designer-only="true"
              :show-detail-back="canReturnToAnnotationList"
              detail-back-label="返回批注列表"
              timeline-placeholder="输入处理说明，或补充给校核人的说明..."
              timeline-submit-label="发送回复"
              confirm-action-label="确认当前数据"
              :confirm-hint="currentTask
                ? '处理动作与测量证据需要先确认保存，后续外部流转才能继续。'
                : '当前未匹配到对应单据，回复和历史可继续查看，但本页不能确认保存处理结果。'"
              empty-title="当前范围内还没有可处理的批注"
              empty-description="请选择退回任务，或等待对应 form_id 的批注同步后再处理。"
              @back="backToAnnotationList"
              @update:active-filter="annotationFilter = $event"
              @update:confirm-note="confirmNote = $event"
              @select-annotation="selectWorkspaceAnnotation"
              @locate-annotation="(item) => void locateAnnotation(item)"
              @locate-measurement="locateMeasurement"
              @start-measurement="(kind) => void startMeasurement(kind)"
              @update-severity="updateSelectedAnnotationSeverity"
              @confirm="void confirmCurrentData()">
              <template #workflow>
                <div class="space-y-4" data-testid="designer-comment-workflow-zone">
                  <div>
                    <div class="text-sm font-semibold text-slate-950">任务级动作</div>
                    <div class="mt-1 text-xs leading-5 text-slate-500">
                      这里是设计侧的任务级动作入口。先确认当前数据，再回外部平台或再次提交。
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <button type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"
                      :disabled="refreshingTask"
                      @click="void refreshCurrentTask()">
                      <RefreshCw class="h-4 w-4" :class="refreshingTask ? 'animate-spin' : ''" />
                      刷新任务
                    </button>
                    <button v-if="currentTask"
                      type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"
                      @click="showInitiateDrawer = true">
                      <FileText class="h-4 w-4" />
                      查看发起单
                    </button>
                    <button v-if="currentTask"
                      type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"
                      @click="openTaskHistory(currentTask)">
                      <Calendar class="h-4 w-4" />
                      流转历史
                    </button>
                    <button type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                      :disabled="!canResubmitCurrentTask || hasUnsavedPendingData || resubmitLoading"
                      @click="void handleResubmitTask()">
                      <Send class="h-4 w-4" />
                      {{ resubmitLoading ? '提交中...' : '处理完成后再次提交' }}
                    </button>
                  </div>
                  <div v-if="currentTask" class="text-xs text-slate-500">
                    再次提交前，需要先确认当前批注与测量证据。当前单据：{{ currentTask.title }}。
                  </div>
                  <div v-else class="text-xs text-amber-700">
                    当前没有匹配到退回单据，因此本页只保留批注查看与回复，不提供确认和再次提交。
                  </div>
                </div>
              </template>
            </AnnotationWorkspace>
          </div>
        </div>
      </section>
    </div>

    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="translate-x-full opacity-0"
      enter-to-class="translate-x-0 opacity-100" leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-x-0 opacity-100" leave-to-class="translate-x-full opacity-0">
      <aside v-if="showInitiateDrawer && currentTask"
        class="absolute inset-y-0 right-0 z-20 w-[460px] border-l border-slate-200 bg-white shadow-2xl">
        <div class="flex h-full min-h-0 flex-col overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">查看发起单</div>
              <div class="mt-1 text-lg font-semibold text-slate-950">我发起的校审单</div>
            </div>
            <button type="button"
              class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              @click="showInitiateDrawer = false">
              <X class="h-4 w-4" />
            </button>
          </div>

          <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div class="text-xs text-slate-400">发起单填写内容</div>
              <div class="mt-2 text-base font-semibold text-slate-950">{{ currentTask.title || '—' }}</div>
              <div class="mt-2 text-sm leading-6 text-slate-600">{{ currentTask.description || '—' }}</div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div class="text-xs text-slate-400">数据包名称</div>
                <div class="mt-2 text-sm font-medium text-slate-950">{{ currentTask.title || '—' }}</div>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div class="text-xs text-slate-400">发起说明</div>
                <div class="mt-2 text-sm font-medium text-slate-950">{{ currentTask.description || '—' }}</div>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div class="text-xs text-slate-400">校核人</div>
                <div class="mt-2 text-sm font-medium text-slate-950">{{ currentTask.checkerName || currentTask.reviewerName || '—' }}</div>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div class="text-xs text-slate-400">审核人</div>
                <div class="mt-2 text-sm font-medium text-slate-950">{{ currentTask.approverName || '—' }}</div>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div class="text-xs text-slate-400">优先级</div>
                <div class="mt-2 text-sm font-medium text-slate-950">{{ currentTaskPriority?.label || '—' }}</div>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div class="text-xs text-slate-400">截止时间</div>
                <div class="mt-2 text-sm font-medium text-slate-950">{{ currentTaskDueDate }}</div>
              </div>
            </div>

            <section class="rounded-2xl border border-slate-200 bg-white p-4">
              <div class="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Package class="h-4 w-4 text-slate-400" />
                选中构件
              </div>
              <div v-if="currentTask.components.length === 0" class="mt-3 text-sm text-slate-500">—</div>
              <div v-else class="mt-3 space-y-2">
                <div v-for="component in currentTask.components" :key="component.id"
                  class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div class="text-sm font-medium text-slate-900">{{ component.name || component.refNo }}</div>
                  <div class="mt-1 text-xs text-slate-500">{{ component.refNo }}<span v-if="component.type"> · {{ component.type }}</span></div>
                </div>
              </div>
            </section>

            <section class="rounded-2xl border border-slate-200 bg-white p-4">
              <div class="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Paperclip class="h-4 w-4 text-slate-400" />
                附件
              </div>
              <div v-if="!(currentTask.attachments?.length)" class="mt-3 text-sm text-slate-500">—</div>
              <div v-else class="mt-3 space-y-2">
                <a v-for="attachment in currentTask.attachments" :key="attachment.id"
                  class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 hover:border-slate-300 hover:bg-white"
                  :href="attachment.url"
                  target="_blank"
                  rel="noreferrer">
                  <div class="min-w-0">
                    <div class="truncate font-medium">{{ attachment.name }}</div>
                    <div class="mt-1 text-xs text-slate-500">{{ formatDateTime(attachment.uploadedAt) }}</div>
                  </div>
                  <span class="shrink-0 text-xs text-slate-400">查看</span>
                </a>
              </div>
            </section>
          </div>
        </div>
      </aside>
    </Transition>

    <Teleport to="body">
      <TaskReviewDetail v-if="detailTask" :task="detailTask" @close="detailTask = null" />
    </Teleport>
  </div>
</template>
