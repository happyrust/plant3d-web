<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  AlertCircle,
  Calendar,
  RefreshCw,
  Save,
  Send,
  XCircle,
} from 'lucide-vue-next';

import {
  useAnnotationProcessingEntryTarget,
} from './annotationProcessingEntry';
import AnnotationSheetWorkspace from './AnnotationSheetWorkspace.vue';
import {
  buildAnnotationWorkspaceItems,
  buildAnnotationWorkspaceSummary,
  scopeAnnotationWorkspaceItemsByFormId,
  type AnnotationWorkspaceItem,
  type LinkedMeasurementItem,
} from './annotationWorkspaceModel';
import { startAnnotationMemberPick } from './cloudMemberPick';
import { createConfirmedRecordsRestorer } from './confirmedRecordsRestore';
import DesignerTaskSwitcher from './DesignerTaskSwitcher.vue';
import NonReturnedGuidanceCard from './NonReturnedGuidanceCard.vue';
import { createReviewClearanceConflictActions } from './reviewClearanceConflictActions';
import ReviewClearanceConflictNotice from './ReviewClearanceConflictNotice.vue';
import ReviewModelVersionSelector from './ReviewModelVersionSelector.vue';
import {
  buildReviewConfirmSnapshotKey,
  buildReviewConfirmSnapshotPayload,
  buildReviewConfirmSnapshotPayloadFromRecords,
  buildUnsavedReviewConfirmPayload,
  confirmCurrentDataSafely,
  hasReviewConfirmPayloadData,
  resolveReviewEvidenceSaveErrorMessage,
} from './reviewPanelActions';
import {
  getCanonicalReturnedMetadata,
  getResubmissionLatestReturnTime,
  isCanonicalReturnedTask,
} from './reviewTaskFilters';
import TaskReviewDetail from './TaskReviewDetail.vue';
import UnattributedDraftNotice from './UnattributedDraftNotice.vue';
import { notifyParentWorkflowAction } from './workflowBridge';

import { reviewAnnotationCheck } from '@/api/reviewApi';
import { useAnnotationBindingResolve } from '@/composables/useAnnotationBindingResolve';
import { useAnnotationDraftScopeSync } from '@/composables/useAnnotationDraftScopeSync';
import { useAnnotationDraftSession } from '@/composables/useAnnotationDraftSession';
import { syncAnnotationReviewStates } from '@/composables/useAnnotationReviewStateSync';
import { saveAnnotationBasicFields, saveAnnotationSeverity } from '@/composables/useAnnotationSeveritySync';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useReviewStore } from '@/composables/useReviewStore';
import {
  useToolStore,
  type AnnotationType,
  type MeasurementRecord,
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

const userStore = useUserStore();
const reviewStore = useReviewStore();
const toolStore = useToolStore();
const viewerContext = useViewerContext();
const bindingResolve = useAnnotationBindingResolve();
const annotationProcessingEntryTarget = useAnnotationProcessingEntryTarget();

const selectedAnnotationId = ref<string | null>(null);
const selectedAnnotationType = ref<AnnotationType | null>(null);
const savingSeverityKeys = ref<string[]>([]);
const savingTitleKeys = ref<string[]>([]);
const detailTask = ref<ReviewTask | null>(null);
const confirmNote = ref('');
const confirmSaving = ref(false);
const confirmError = ref<string | null>(null);
const refreshingTask = ref(false);
const resubmitting = ref(false);
const embeddedLandingFormId = ref(readEmbeddedLandingFormId());

const confirmedRecordsRestorer = createConfirmedRecordsRestorer({
  currentTaskId: () => reviewStore.currentTask.value?.id ?? null,
  currentFormId: () => reviewStore.currentTask.value?.formId ?? null,
  confirmedRecords: () => reviewStore.sortedConfirmedRecords.value,
  selectedModelGroupKey: () => reviewStore.getSelectedReviewModelGroup?.() ?? null,
  onSelectModelGroup: key => reviewStore.selectReviewModelGroup?.(key),
  toolStore,
  waitForViewerReady,
  getViewerTools: () => viewerContext.tools.value ?? null,
  prepareClearanceRestore: (snapshot, context) => reviewStore.prepareBoundClearanceRestore(snapshot, context),
  ensureModelContext: async (context, shouldApply) => {
    const ensure = viewerContext.ensureReviewModelContext?.value;
    if (!ensure) throw new Error('模型版本恢复入口尚未就绪，已停止标注回放');
    await ensure(context, shouldApply);
  },
  skipClearOnEmpty: true,
});
const restoreError = confirmedRecordsRestorer.restoreError;
const clearanceConflictActions = createReviewClearanceConflictActions({
  resolve: action => reviewStore.resolveClearanceSnapshotConflict?.(action) ?? false,
  undo: () => reviewStore.restoreClearanceSnapshotBackup?.() ?? false,
  recompare: () => reviewStore.reopenClearanceSnapshotConflict?.() ?? false,
}, confirmedRecordsRestorer);
onUnmounted(confirmedRecordsRestorer.cancelPendingRestore);

// U0 草稿 scope（sj 侧）：与 ReviewPanel 共用同一份同步，任务 / 用户一变就切本机草稿容器；
// 两个面板在 dock 里同时开着时各登记一次，最后一个卸载才回到旧作用域。
useAnnotationDraftScopeSync({ userId: () => userStore.currentUser.value?.id ?? null });
const draftSession = useAnnotationDraftSession();

const returnedTasks = computed(() => userStore.returnedInitiatedTasks.value.filter((task) => isCanonicalReturnedTask(task)));
const currentTask = computed(() => reviewStore.currentTask.value);
const currentTaskIsReturned = computed(
  () => !!(currentTask.value && isCanonicalReturnedTask(currentTask.value)),
);

function goToReviewPanel() {
  ensurePanelAndActivate('review');
}
const currentTaskStatus = computed(() => currentTask.value ? getTaskStatusDisplayName(currentTask.value.status) : null);
const currentTaskPriority = computed(() => currentTask.value ? getPriorityDisplayName(currentTask.value.priority) : null);
const returnedMetadata = computed(() => (currentTask.value ? getCanonicalReturnedMetadata(currentTask.value) : null));
const latestReturnTimestamp = computed(() => (
  currentTask.value ? getResubmissionLatestReturnTime(currentTask.value.workflowHistory || []) : null
));
const currentTaskConfirmedRecords = confirmedRecordsRestorer.sceneRecords;
const activeReviewFormId = computed(() => (
  annotationProcessingEntryTarget.value?.formId?.trim()
  || currentTask.value?.formId?.trim()
  || embeddedLandingFormId.value
  || null
));

function readEmbeddedLandingFormId(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('embed_landing_state');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { formId?: string | null };
    return parsed.formId?.trim() || null;
  } catch {
    return null;
  }
}

const allAnnotationItems = computed<AnnotationWorkspaceItem[]>(() => (
  buildAnnotationWorkspaceItems({
    annotations: toolStore.annotations.value,
    cloudAnnotations: toolStore.cloudAnnotations.value,
    rectAnnotations: toolStore.rectAnnotations.value,
    obbAnnotations: toolStore.obbAnnotations.value,
    getCommentCount: (type, id) => toolStore.getAnnotationComments(
      type,
      id,
      activeReviewFormId.value ?? undefined,
      currentTask.value?.id,
    ).length,
  })
));

const scopedAnnotationItems = computed<AnnotationWorkspaceItem[]>(() => (
  scopeAnnotationWorkspaceItemsByFormId(
    allAnnotationItems.value,
    activeReviewFormId.value,
  )
));
const annotationSummary = computed(() => (
  buildAnnotationWorkspaceSummary(scopedAnnotationItems.value)
));
const annotationSummaryCards = computed(() => [
  { id: 'total', label: '全部批注', count: annotationSummary.value.total },
  { id: 'pending', label: '待处理', count: annotationSummary.value.pending },
  { id: 'rejected', label: '已驳回', count: annotationSummary.value.rejected },
  { id: 'fixed', label: '已修改', count: annotationSummary.value.fixed },
  {
    id: 'approved',
    label: '已同意 / 不需解决',
    count: annotationSummary.value.approved + annotationSummary.value.wontFix,
  },
]);
const selectedAnnotation = computed(() => (
  scopedAnnotationItems.value.find(
    (item) => item.id === selectedAnnotationId.value && item.type === selectedAnnotationType.value,
  ) ?? null
));
const canShowAnnotationSheet = computed(() => (
  currentTaskIsReturned.value
  || (!!activeReviewFormId.value && scopedAnnotationItems.value.length > 0)
));
const hasUnmatchedExternalEntry = computed(() => {
  const targetFormId = annotationProcessingEntryTarget.value?.formId?.trim();
  if (!targetFormId) return false;
  return !currentTask.value || currentTask.value.formId?.trim() !== targetFormId;
});

const currentDraftConfirmPayload = computed(() => buildReviewConfirmSnapshotPayload({
  annotations: [...toolStore.annotations.value],
  cloudAnnotations: [...toolStore.cloudAnnotations.value],
  rectAnnotations: [...toolStore.rectAnnotations.value],
  obbAnnotations: [...toolStore.obbAnnotations.value],
  measurements: [...toolStore.measurements.value],
  unifiedMeasurements: [...(toolStore.unifiedMeasurements?.value ?? [])],
  legacyMeasurements: [...(toolStore.legacyMeasurements?.value ?? [])],
  xeokitDistanceMeasurements: [...toolStore.xeokitDistanceMeasurements.value],
  xeokitAngleMeasurements: [...toolStore.xeokitAngleMeasurements.value],
  xeokitElevationPointMeasurements: [...(toolStore.xeokitElevationPointMeasurements?.value ?? [])],
  xeokitElevationDeltaMeasurements: [...(toolStore.xeokitElevationDeltaMeasurements?.value ?? [])],
  ...(reviewStore.getBoundDimensionConfirmPayload?.() ?? {}),
}));
const confirmedSnapshotPayload = computed(() => (
  buildReviewConfirmSnapshotPayloadFromRecords(currentTaskConfirmedRecords.value)
));
const unsavedConfirmPayload = computed(() => (
  buildUnsavedReviewConfirmPayload(
    currentDraftConfirmPayload.value,
    confirmedSnapshotPayload.value,
  )
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
const canConfirmCurrentData = computed(() => hasUnsavedPendingData.value && hasReviewConfirmPayloadData(unsavedConfirmPayload.value));
const canResubmitTask = computed(() => (
  !!currentTask.value
  && currentTaskConfirmedRecords.value.length > 0
  && !hasUnsavedPendingData.value
));
const confirmDisabledReason = computed(() => (
  canConfirmCurrentData.value || confirmSaving.value ? null : '没有未确认的改动'
));
const resubmitDisabledReason = computed(() => {
  if (!currentTask.value || resubmitting.value) return null;
  if (hasUnsavedPendingData.value) {
    return canConfirmCurrentData.value ? '还有未确认的改动，请先确认当前数据' : '当前数据与已确认版本不一致';
  }
  if (currentTaskConfirmedRecords.value.length === 0) return '先确认当前数据后才能流转';
  return null;
});

// 测试替身的 userStore 可能没有 loading / error
const tasksLoading = computed(() => !!userStore.loading?.value);
const tasksError = computed(() => userStore.error?.value ?? null);
const emptyEntryText = computed(() => {
  if (tasksLoading.value) return '正在加载退回单据…';
  if (tasksError.value) return '退回单据加载失败';
  return '当前没有需要处理的退回单据';
});

function setActiveAnnotation(type: AnnotationType | null, id: string | null) {
  toolStore.activeAnnotationId.value = type === 'text' ? id : null;
  toolStore.activeCloudAnnotationId.value = type === 'cloud' ? id : null;
  toolStore.activeRectAnnotationId.value = type === 'rect' ? id : null;
  toolStore.activeObbAnnotationId.value = type === 'obb' ? id : null;
}

function selectAnnotation(item: AnnotationWorkspaceItem | null) {
  selectedAnnotationId.value = item?.id ?? null;
  selectedAnnotationType.value = item?.type ?? null;
  setActiveAnnotation(item?.type ?? null, item?.id ?? null);
}

function workspaceItemKey(item: AnnotationWorkspaceItem): string {
  return `${item.type}:${item.id}`;
}

function canEditWorkspaceItem(item: AnnotationWorkspaceItem): boolean {
  return canEditAnnotationSeverity(userStore.currentUser.value, item.authorId);
}

async function updateWorkspaceSeverity(payload: {
  item: AnnotationWorkspaceItem;
  severity: AnnotationSeverity | undefined;
}) {
  const key = workspaceItemKey(payload.item);
  if (savingSeverityKeys.value.includes(key)) return;
  savingSeverityKeys.value = [...savingSeverityKeys.value, key];
  try {
    await saveAnnotationSeverity(payload.item.type, payload.item.id, payload.severity, {
      formId: activeReviewFormId.value ?? undefined,
      taskId: currentTask.value?.id,
    });
  } finally {
    savingSeverityKeys.value = savingSeverityKeys.value.filter((entry) => entry !== key);
  }
}

async function updateWorkspaceTitle(payload: {
  item: AnnotationWorkspaceItem;
  title: string;
}) {
  const key = workspaceItemKey(payload.item);
  if (savingTitleKeys.value.includes(key)) return;
  savingTitleKeys.value = [...savingTitleKeys.value, key];
  try {
    await saveAnnotationBasicFields(payload.item.type, payload.item.id, {
      title: payload.title,
    }, {
      formId: activeReviewFormId.value ?? undefined,
      taskId: currentTask.value?.id,
    });
  } finally {
    savingTitleKeys.value = savingTitleKeys.value.filter((entry) => entry !== key);
  }
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

function getCurrentTaskNodeLabel(task?: ReviewTask | null): string {
  if (!task?.currentNode) return '未开始';
  return WORKFLOW_NODE_NAMES[task.currentNode] || task.currentNode;
}

function formatWorkflowNode(node?: ReviewTask['currentNode'] | null): string {
  if (!node) return '—';
  return WORKFLOW_NODE_NAMES[node] || node;
}

async function loadTasks() {
  await userStore.loadReviewTasks();
}

async function selectTask(task: ReviewTask) {
  if (reviewStore.currentTask.value?.id === task.id) return;
  selectedAnnotationId.value = null;
  selectedAnnotationType.value = null;
  confirmError.value = null;
  await reviewStore.setCurrentTask(task);
}

function openTaskHistory(task: ReviewTask) {
  detailTask.value = task;
}

async function refreshCurrentTask() {
  refreshingTask.value = true;
  try {
    await userStore.loadReviewTasks();
    const taskId = reviewStore.currentTask.value?.id;
    if (!taskId) return;
    const matched = returnedTasks.value.find((task) => task.id === taskId);
    if (matched) {
      await reviewStore.setCurrentTask(matched);
    }
  } finally {
    refreshingTask.value = false;
  }
}

async function locateAnnotation(item: AnnotationWorkspaceItem | null, refnos = item?.refnos ?? []) {
  if (!item) return;
  setActiveAnnotation(item.type, item.id);
  ensurePanelAndActivate('viewer');
  if (!refnos.length) return;
  // U0 回执守卫：加载期间切了任务就不动相机 / 高亮，也不弹它的提示
  const scopeStamp = draftSession.currentStamp();
  const receiptCurrent = () => draftSession.isTransientReceiptCurrent(scopeStamp);
  const result = await showModelByRefnosWithAck({
    refnos,
    highlight: true,
    viewerRef: viewerContext.viewerRef,
    shouldApply: receiptCurrent,
  });
  // 定位回执是关联失效解析的权威证据（ADR-0050）：fail → missing，ok → 撤销 missing。
  // 有元素失败时 error 也会带话（「N 个关联元素加载失败」），所以不能按 error 跳过；纯传输错误（超时 / viewer 未就绪）ok / fail 都空，喂进去是空操作。
  bindingResolve.markLoadResult(result);
  if (result.error && receiptCurrent()) {
    emitToast({ message: result.error, level: 'warning' });
  }
}

function locateElements(payload: { item: AnnotationWorkspaceItem; refnos: string[] }) {
  return locateAnnotation(payload.item, payload.refnos);
}

function pickElements(item: AnnotationWorkspaceItem) {
  ensurePanelAndActivate('viewer');
  startAnnotationMemberPick(item);
}

async function startMeasurement(
  kind: MeasurementRecord['kind'],
  annotation: AnnotationWorkspaceItem,
) {
  selectAnnotation(annotation);
  ensurePanelAndActivate('viewer');
  emitCommand(
    kind === 'distance'
      ? 'measurement.distance'
      : kind === 'angle'
        ? 'measurement.angle'
        : kind === 'elevation_point'
          ? 'measurement.elevation_point'
          : 'measurement.elevation_delta',
  );
  emitToast({
    message:
      kind === 'distance'
        ? '请在模型中选择两个点完成距离测量'
        : kind === 'angle'
          ? '请在模型中选择三个点完成角度测量'
          : kind === 'elevation_point'
            ? '单击一点完成标高测量'
            : '选择两点完成高差测量',
    level: 'info',
  });
}

function locateMeasurement(item: LinkedMeasurementItem) {
  ensurePanelAndActivate('viewer');
  if (item.engine === 'xeokit') {
    toolStore.activeXeokitMeasurementId.value = item.id;
    viewerContext.xeokitMeasurementTools.value?.flyToMeasurement(item.id);
    return;
  }
  toolStore.activeMeasurementId.value = item.id;
  viewerContext.tools.value?.flyToMeasurement(item.id);
}

function handleCopyFeedback(payload: { kind: 'refno' | 'row'; result: 'copied' | 'fallback' | 'failed' }) {
  const label = payload.kind === 'refno' ? 'RefNo' : '批注行';
  emitToast({
    message: payload.result === 'failed' ? `复制${label}失败` : `已复制${label}`,
    level: payload.result === 'failed' ? 'warning' : 'success',
  });
}

function handleQueueCompleted() {
  emitToast({
    message: '当前筛选范围内已没有下一条待处理批注',
    level: 'success',
  });
}

async function confirmCurrentData() {
  if (confirmSaving.value || !canConfirmCurrentData.value) return;

  confirmSaving.value = true;
  confirmError.value = null;
  try {
    const saved = await confirmCurrentDataSafely({
      hasPendingData: canConfirmCurrentData.value,
      payload: {
        type: 'batch' as const,
        annotations: [...currentDraftConfirmPayload.value.annotations],
        cloudAnnotations: [...currentDraftConfirmPayload.value.cloudAnnotations],
        rectAnnotations: [...currentDraftConfirmPayload.value.rectAnnotations],
        obbAnnotations: [...currentDraftConfirmPayload.value.obbAnnotations],
        measurements: [...currentDraftConfirmPayload.value.measurements],
        dimensionDocument: currentDraftConfirmPayload.value.dimensionDocument,
        dimensionDocumentVersion: currentDraftConfirmPayload.value.dimensionDocumentVersion,
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
    if (saved) {
      emitToast({ message: '确认数据已保存，可回外部平台继续流转', level: 'success' });
      await nextTick();
      await confirmedRecordsRestorer.restoreConfirmedRecordsIntoScene(true);
    }
  } catch (error) {
    confirmError.value = resolveReviewEvidenceSaveErrorMessage(error, '确认当前数据失败');
  } finally {
    confirmSaving.value = false;
  }
}

async function resubmitToProofreader() {
  const task = currentTask.value;
  if (!task || !canResubmitTask.value || resubmitting.value) return;
  resubmitting.value = true;
  try {
    const check = await reviewAnnotationCheck({
      taskId: task.id,
      formId: task.formId,
      currentNode: 'sj',
      intent: 'submit_next',
      includedTypes: ['text', 'cloud', 'rect'],
    });
    if (!check.success || !check.data?.passed) {
      emitToast({
        message: check.data?.message || check.errorMessage || '批注检查未通过，暂不能流转',
        level: 'warning',
      });
      return;
    }

    const notified = notifyParentWorkflowAction({
      action: 'active',
      taskId: task.id,
      formId: task.formId,
      source: 'designer-comment-handling-panel',
    });
    if (!notified) {
      await userStore.submitTaskToNextNode(task.id);
    }
    emitToast({
      message: notified ? '已通知外部平台继续流转' : '已流转回校对',
      level: 'success',
    });
  } catch (error) {
    emitToast({
      message: error instanceof Error ? error.message : '再次提交失败',
      level: 'error',
    });
  } finally {
    resubmitting.value = false;
  }
}

watch(
  () => ({
    taskId: reviewStore.currentTask.value?.id ?? null,
    recordKeys: currentTaskConfirmedRecords.value.map((record) => `${record.id}:${record.confirmedAt}`).join('|'),
  }),
  async ({ taskId }) => {
    if (!taskId) {
      confirmedRecordsRestorer.lastRestoredSceneKey.value = null;
      selectAnnotation(null);
      return;
    }
    await confirmedRecordsRestorer.restoreConfirmedRecordsIntoScene();
  },
  { immediate: true },
);

watch(
  () => `${returnedTasks.value.map((task) => task.id).join('|')}|${annotationProcessingEntryTarget.value?.requestedAt ?? ''}`,
  async () => {
    const targetFormId = annotationProcessingEntryTarget.value?.formId?.trim();
    if (targetFormId) {
      const matchedTargetTask = returnedTasks.value.find(
        (task) => task.formId?.trim() === targetFormId,
      );
      if (matchedTargetTask && currentTask.value?.id !== matchedTargetTask.id) {
        await selectTask(matchedTargetTask);
      }
      return;
    }
    const firstReturnedTask = returnedTasks.value[0];
    if (!firstReturnedTask) return;
    const activeTask = reviewStore.currentTask.value;
    if (activeTask && returnedTasks.value.some((task) => task.id === activeTask.id)) return;
    await selectTask(firstReturnedTask);
  },
  { immediate: true },
);

watch(
  () => reviewStore.currentTask.value?.id ?? null,
  () => {
    selectedAnnotationId.value = null;
    selectedAnnotationType.value = null;
  },
);

// 设计 / 校核 / 审核可能在不同浏览器分别操作；本面板打开、聚焦单据或任务一变就主动从后端拉一次批注处理状态，
// 让表格行状态与统计条立刻对上对方最新的 fixed / wont_fix / agree / reject。之前只有 ReviewPanel 这么做，
// 本面板只在点开某条详情时由 ReviewCommentsTimeline 单条拉——设计侧整页不请求 annotation-states，
// 已同意的批注全显示「待处理」、按钮还能点（2026-09-22 真机，docs/verification/pms-3d-review-integration-e2e.md §5.1 第 4 条）。
async function refreshAnnotationReviewStatesForCurrentScope(): Promise<void> {
  const formId = activeReviewFormId.value;
  if (!formId) return;
  const task = currentTask.value;
  const taskIdSnapshot = task?.id ?? null;
  // U0 回执守卫：请求期间切了任务 / 用户就一条都不写（回来时本 watch 会重拉）
  const scopeStamp = draftSession.currentStamp();
  // 外部 PMS 嵌入按 form_id 聚焦同一张单据，SJ / JD / JH 可能恢复到不同内部 taskId，按 form 维度拉才看得到对方的处理；
  // 内部流程且当前任务就是这张单据时才带 taskId
  const taskId = task && !embeddedLandingFormId.value && task.formId?.trim() === formId ? task.id : undefined;
  const result = await syncAnnotationReviewStates({
    formId,
    taskId,
    shouldApply: () => draftSession.isTransientReceiptCurrent(scopeStamp),
  });
  if ((currentTask.value?.id ?? null) !== taskIdSnapshot) return;
  if (!result.ok && result.errorMessage) {
    console.warn('[DesignerCommentHandlingPanel] 拉取批注处理状态失败:', result.errorMessage);
  }
}

watch(
  () => `${activeReviewFormId.value ?? ''}|${currentTask.value?.id ?? ''}`,
  () => {
    void refreshAnnotationReviewStatesForCurrentScope();
  },
  { immediate: true },
);

watch(
  () => `${scopedAnnotationItems.value.map((item) => `${item.type}:${item.id}`).join('|')}|${annotationProcessingEntryTarget.value?.requestedAt ?? ''}`,
  () => {
    const current = selectedAnnotation.value;
    if (current) {
      setActiveAnnotation(current.type, current.id);
      return;
    }

    const target = annotationProcessingEntryTarget.value;
    const requested = target
      ? scopedAnnotationItems.value.find(
        (item) => item.id === target.annotationId && item.type === target.annotationType,
      )
      : null;
    selectAnnotation(requested ?? null);
  },
  { immediate: true },
);

onMounted(() => {
  void loadTasks();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-[#F8FAFC]" data-panel="designer-comment-handling">
    <header class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5"
      data-testid="designer-task-bar">
      <DesignerTaskSwitcher :tasks="returnedTasks"
        :current-task="currentTask"
        :loading="tasksLoading"
        :error="tasksError"
        @select="selectTask"
        @retry="loadTasks" />
      <div v-if="currentTask" class="ml-auto flex shrink-0 items-center gap-2">
        <button type="button"
          class="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-solid border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          :disabled="refreshingTask"
          @click="refreshCurrentTask">
          <RefreshCw class="h-4 w-4" :class="refreshingTask ? 'animate-spin' : ''" />
          刷新任务
        </button>
        <button type="button"
          class="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-solid border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          @click="openTaskHistory(currentTask)">
          <Calendar class="h-4 w-4" />
          流转历史
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto bg-[#FCFDFE]" data-testid="designer-comment-scroll">
      <div class="flex min-h-full flex-col p-4">
        <template v-if="canShowAnnotationSheet">
          <div v-if="currentTask" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="designer-state-1">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-xl font-semibold text-slate-950">{{ currentTask.title }}</h2>
                  <span class="rounded-full bg-danger-subtle px-2.5 py-1 text-xs font-semibold text-danger">已退回</span>
                  <span v-if="currentTaskStatus" class="rounded-full px-2.5 py-1 text-xs font-semibold"
                    :class="currentTaskStatus.color">
                    {{ currentTaskStatus.label }}
                  </span>
                  <span v-if="currentTaskPriority" class="rounded-full px-2.5 py-1 text-xs font-semibold"
                    :class="currentTaskPriority.color">
                    {{ currentTaskPriority.label }}
                  </span>
                </div>
                <p class="text-sm leading-6 text-slate-600">{{ currentTask.description || '请逐条处理被退回批注，并在确认当前数据后回外部平台继续流转。' }}</p>
                <div class="grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                  <div class="rounded-xl bg-slate-50 px-3 py-2.5">
                    <div class="text-xs text-slate-400">退回节点</div>
                    <div class="mt-1 font-medium text-slate-900">{{ returnedMetadata?.returnNode ? getCurrentTaskNodeLabel({ currentNode: returnedMetadata.returnNode } as ReviewTask) : '—' }}</div>
                  </div>
                  <div class="rounded-xl bg-slate-50 px-3 py-2.5">
                    <div class="text-xs text-slate-400">退回时间</div>
                    <div class="mt-1 font-medium text-slate-900">{{ formatDateTime(latestReturnTimestamp) }}</div>
                  </div>
                  <div class="rounded-xl bg-slate-50 px-3 py-2.5">
                    <div class="text-xs text-slate-400">当前节点</div>
                    <div class="mt-1 font-medium text-slate-900">{{ getCurrentTaskNodeLabel(currentTask) }}</div>
                  </div>
                  <div class="rounded-xl bg-slate-50 px-3 py-2.5">
                    <div class="text-xs text-slate-400">构件数</div>
                    <div class="mt-1 font-medium text-slate-900">{{ currentTask.components.length }} 个</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="mt-4 rounded-2xl border border-danger/30 bg-danger-subtle px-4 py-3 text-sm text-danger">
              <div class="flex items-start gap-2">
                <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div class="font-semibold">退回意见</div>
                  <div class="mt-1 leading-6">{{ returnedMetadata?.returnReason || '未填写退回意见' }}</div>
                </div>
              </div>
            </div>
          </div>

          <div v-else
            class="rounded-2xl border border-brand/30 bg-brand-subtle p-5"
            data-testid="designer-state-1">
            <h2 class="text-xl font-semibold text-slate-950">外部批注单</h2>
            <p class="mt-2 text-sm text-slate-600">
              当前按正式单据 {{ activeReviewFormId || '—' }} 展示批注；未匹配内部任务前只能查看和讨论。
            </p>
          </div>

          <div v-if="hasUnmatchedExternalEntry"
            data-testid="external-entry-unmatched-task"
            class="mt-3 rounded-xl border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning">
            当前批注未匹配到内部任务，处理动作与任务级确认暂不可用。
          </div>

          <div class="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
            <div v-for="card in annotationSummaryCards"
              :key="card.id"
              class="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div class="text-xs text-slate-400">{{ card.label }}</div>
              <div class="mt-2 text-2xl font-semibold text-slate-950">{{ card.count }}</div>
            </div>
          </div>

          <div v-if="currentTask"
            class="mt-4 space-y-2 empty:hidden"
            data-testid="designer-task-restore-notices">
            <ReviewModelVersionSelector :groups="confirmedRecordsRestorer.modelVersionGroups.value"
              :selected-key="confirmedRecordsRestorer.activeModelGroup.value?.key ?? null"
              @select="confirmedRecordsRestorer.selectModelVersionGroup" />
            <ReviewClearanceConflictNotice :conflict="reviewStore.clearanceSnapshotConflict?.value"
              :kept-local="reviewStore.clearanceSnapshotKeptLocal?.value"
              :backup="reviewStore.clearanceSnapshotBackup?.value" :busy="confirmedRecordsRestorer.restoring.value"
              @resolve="clearanceConflictActions.resolve" @undo="clearanceConflictActions.undo" @recompare="clearanceConflictActions.recompare" />
          </div>

          <div class="mt-4 flex flex-col"
            data-testid="designer-comment-annotation-list">
            <UnattributedDraftNotice />
            <AnnotationSheetWorkspace class="min-h-0 flex-1"
              :items="scopedAnnotationItems"
              :current-annotation-id="selectedAnnotationId"
              :current-annotation-type="selectedAnnotationType"
              :current-user-role="userStore.currentUser.value?.role ?? null"
              :form-id="activeReviewFormId"
              :task-id="currentTask?.id ?? null"
              :task-key="currentTask?.id ?? activeReviewFormId"
              :subtitle="currentTask?.title ?? `单据 ${activeReviewFormId || '—'}`"
              :measurements="toolStore.measurements.value"
              :xeokit-measurements="[
                ...toolStore.xeokitDistanceMeasurements.value,
                ...toolStore.xeokitAngleMeasurements.value,
              ]"
              :can-edit-item="canEditWorkspaceItem"
              :allow-review-actions="!!currentTask"
              :saving-severity-keys="savingSeverityKeys"
              :saving-title-keys="savingTitleKeys"
              designer-only
              empty-title="当前单据还没有可处理的批注"
              empty-description="批注同步后会自动出现在这里。"
              @select-annotation="selectAnnotation"
              @locate-annotation="(item) => void locateAnnotation(item)"
              @locate-elements="(payload) => void locateElements(payload)"
              @pick-elements="pickElements"
              @start-measurement="(kind, item) => void startMeasurement(kind, item)"
              @locate-measurement="locateMeasurement"
              @copy-feedback="handleCopyFeedback"
              @update-severity="(payload) => void updateWorkspaceSeverity(payload)"
              @update-title="(payload) => void updateWorkspaceTitle(payload)"
              @queue-completed="handleQueueCompleted" />
          </div>
        </template>

        <NonReturnedGuidanceCard v-else-if="currentTask"
          :task="currentTask"
          @navigate-to-review="goToReviewPanel" />

        <div v-else
          data-testid="designer-comment-task-entry"
          class="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white">
          <div class="text-center text-sm text-slate-500">
            <XCircle class="mx-auto mb-3 h-9 w-9 text-slate-300" />
            {{ emptyEntryText }}
            <button v-if="tasksError && !tasksLoading"
              type="button"
              class="mt-3 block w-full border-0 bg-transparent text-xs font-medium text-brand hover:underline"
              @click="loadTasks">
              重试
            </button>
          </div>
        </div>
      </div>
    </div>

    <footer v-if="currentTask && canShowAnnotationSheet"
      class="shrink-0 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)]"
      data-testid="designer-task-confirmation">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div class="shrink-0">
          <div class="text-sm font-semibold text-slate-950">确认当前数据</div>
          <div class="mt-0.5 text-xs"
            :class="unsavedAnnotationCount + unsavedMeasurementCount > 0 ? 'text-warning' : 'text-slate-500'"
            data-testid="designer-unconfirmed-summary">
            未确认 {{ unsavedAnnotationCount }} 条批注 / {{ unsavedMeasurementCount }} 条测量
          </div>
        </div>
        <input v-model="confirmNote"
          type="text"
          class="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          placeholder="本轮处理说明（可选）"
          aria-label="本轮处理说明" />
        <div class="flex shrink-0 items-start gap-2">
          <div class="flex flex-col items-end gap-1">
            <button type="button"
              class="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-solid border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canConfirmCurrentData || confirmSaving"
              @click="confirmCurrentData">
              <Save class="h-4 w-4" />
              {{ confirmSaving ? '保存中...' : '确认当前数据' }}
            </button>
            <span v-if="confirmDisabledReason"
              class="text-[11px] text-slate-400"
              data-testid="designer-confirm-disabled-reason">
              {{ confirmDisabledReason }}
            </span>
          </div>
          <div class="flex flex-col items-end gap-1">
            <button type="button"
              class="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border-0 bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-300"
              :disabled="!canResubmitTask || resubmitting"
              @click="resubmitToProofreader">
              <Send class="h-4 w-4" />
              {{ resubmitting ? '流转中...' : '流转回校对' }}
            </button>
            <span v-if="resubmitDisabledReason"
              class="text-[11px] text-slate-400"
              data-testid="designer-resubmit-disabled-reason">
              {{ resubmitDisabledReason }}
            </span>
          </div>
        </div>
      </div>
      <div v-if="restoreError || confirmError" class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-danger">
        <span v-if="restoreError" role="alert">
          {{ restoreError }}
          <button type="button" class="ml-2 underline" :disabled="confirmedRecordsRestorer.restoring.value" @click="confirmedRecordsRestorer.restoreConfirmedRecordsIntoScene(true)">重试回放</button>
        </span>
        <span v-if="confirmError">{{ confirmError }}</span>
      </div>
    </footer>

    <Teleport to="body">
      <TaskReviewDetail v-if="detailTask" :task="detailTask" @close="detailTask = null" />
    </Teleport>
  </div>
</template>
