<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import {
  AlertCircle,
  Calendar,
  ClipboardCheck,
  FileText,
  LocateFixed,
  Package,
  Paperclip,
  RefreshCw,
  Ruler,
  Send,
  X,
  XCircle,
} from 'lucide-vue-next';

import { createConfirmedRecordsRestorer } from './confirmedRecordsRestore';
import ResubmissionTaskList from './ResubmissionTaskList.vue';
import ReviewCommentsTimeline from './ReviewCommentsTimeline.vue';
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

import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useNavigationStatePersistence } from '@/composables/useNavigationStatePersistence';
import { useReviewStore } from '@/composables/useReviewStore';
import {
  getAnnotationRefnos,
  useToolStore,
  type AnnotationType,
  type MeasurementRecord,
  type XeokitMeasurementRecord,
} from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';
import { emitCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';
import {
  getAnnotationReviewDisplay,
  getAnnotationSeverityDisplay,
  getPriorityDisplayName,
  getTaskStatusDisplayName,
  normalizeAnnotationReviewState,
  WORKFLOW_NODE_NAMES,
  type AnnotationReviewState,
  type AnnotationSeverity,
  type ReviewTask,
} from '@/types/auth';

type AnnotationListItem = {
  id: string;
  type: AnnotationType;
  title: string;
  description: string;
  createdAt: number;
  activityAt: number;
  visible: boolean;
  refnos: string[];
  reviewState?: AnnotationReviewState;
  severity?: AnnotationSeverity;
};

type AnnotationSectionKey = 'open' | 'rejected' | 'fixed' | 'wont_fix' | 'approved';

type LinkedMeasurementItem = {
  id: string;
  engine: 'xeokit' | 'classic';
  kind: 'distance' | 'angle';
  createdAt: number;
  visible: boolean;
  summary: string;
};

const SECTION_META: Record<AnnotationSectionKey, { title: string; tone: string }> = {
  open: { title: '待处理', tone: 'bg-slate-100 text-slate-700' },
  rejected: { title: '已驳回', tone: 'bg-rose-100 text-rose-700' },
  fixed: { title: '已修改待确认', tone: 'bg-blue-100 text-blue-700' },
  wont_fix: { title: '不需解决待确认', tone: 'bg-amber-100 text-amber-700' },
  approved: { title: '已同意 / 已同意不处理', tone: 'bg-emerald-100 text-emerald-700' },
};

const userStore = useUserStore();
const reviewStore = useReviewStore();
const toolStore = useToolStore();
const viewerContext = useViewerContext();
const navigationState = useNavigationStatePersistence('plant3d-web-nav-state-designer-comment-handling-v1');

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

navigationState.bindRef('selectedTaskId', selectedTaskId, null);
navigationState.bindRef('selectedAnnotationKey', persistedAnnotationKey, null);
navigationState.bindRef('showInitiateDrawer', showInitiateDrawer, false);

const confirmedRecordsRestorer = createConfirmedRecordsRestorer({
  currentTaskId: () => reviewStore.currentTask.value?.id ?? null,
  confirmedRecords: () => reviewStore.sortedConfirmedRecords.value,
  toolStore,
  waitForViewerReady,
  getViewerTools: () => viewerContext.tools.value ?? null,
});

const returnedTasks = computed(() => userStore.returnedInitiatedTasks.value.filter((task) => isCanonicalReturnedTask(task)));
const currentTask = computed(() => {
  const task = reviewStore.currentTask.value;
  if (task && isCanonicalReturnedTask(task)) return task;
  return null;
});
const currentTaskStatus = computed(() => currentTask.value ? getTaskStatusDisplayName(currentTask.value.status) : null);
const currentTaskPriority = computed(() => currentTask.value ? getPriorityDisplayName(currentTask.value.priority) : null);
const returnedMetadata = computed(() => (currentTask.value ? getCanonicalReturnedMetadata(currentTask.value) : null));
const latestReturnTimestamp = computed(() => (
  currentTask.value ? getResubmissionLatestReturnTime(currentTask.value.workflowHistory || []) : null
));
const currentTaskConfirmedRecords = confirmedRecordsRestorer.currentTaskRecords;
const currentTaskDueDate = computed(() => formatDateOnly(currentTask.value?.dueDate));

const allAnnotationItems = computed<AnnotationListItem[]>(() => {
  const items: AnnotationListItem[] = [];
  const pushAnnotation = (
    type: AnnotationType,
    annotation: {
      id: string;
      title?: string;
      description?: string;
      createdAt: number;
      visible: boolean;
      reviewState?: AnnotationReviewState;
      severity?: AnnotationSeverity;
    },
    fallbackTitle: string,
    fallbackDescription: string,
    refnos: string[],
  ) => {
    items.push({
      id: annotation.id,
      type,
      title: annotation.title?.trim() || fallbackTitle,
      description: annotation.description?.trim() || fallbackDescription,
      createdAt: annotation.createdAt,
      activityAt: annotation.reviewState?.updatedAt || annotation.createdAt,
      visible: annotation.visible,
      refnos,
      reviewState: annotation.reviewState,
      severity: annotation.severity,
    });
  };

  for (const annotation of toolStore.annotations.value) {
    pushAnnotation('text', annotation, '未命名文字批注', '暂无批注描述', getAnnotationRefnos(annotation));
  }

  for (const annotation of toolStore.cloudAnnotations.value) {
    pushAnnotation('cloud', annotation, '未命名云线批注', '暂无批注描述', getAnnotationRefnos(annotation));
  }

  for (const annotation of toolStore.rectAnnotations.value) {
    pushAnnotation('rect', annotation, '未命名矩形批注', '暂无批注描述', getAnnotationRefnos(annotation));
  }

  for (const annotation of toolStore.obbAnnotations.value) {
    pushAnnotation('obb', annotation, '未命名包围盒批注', '暂无批注描述', getAnnotationRefnos(annotation));
  }

  return items.sort((a, b) => b.activityAt - a.activityAt);
});

const annotationSections = computed(() => {
  const grouped: Record<AnnotationSectionKey, AnnotationListItem[]> = {
    open: [],
    rejected: [],
    fixed: [],
    wont_fix: [],
    approved: [],
  };

  for (const item of allAnnotationItems.value) {
    const state = normalizeAnnotationReviewState(item.reviewState);
    if (state.decisionStatus === 'rejected') {
      grouped.rejected.push(item);
      continue;
    }
    if (state.decisionStatus === 'agreed') {
      grouped.approved.push(item);
      continue;
    }
    if (state.resolutionStatus === 'fixed') {
      grouped.fixed.push(item);
      continue;
    }
    if (state.resolutionStatus === 'wont_fix') {
      grouped.wont_fix.push(item);
      continue;
    }
    grouped.open.push(item);
  }

  return (Object.keys(SECTION_META) as AnnotationSectionKey[])
    .map((key) => ({
      key,
      title: SECTION_META[key].title,
      tone: SECTION_META[key].tone,
      items: grouped[key],
      count: grouped[key].length,
    }));
});

const selectedAnnotation = computed(() => (
  allAnnotationItems.value.find((item) => item.id === selectedAnnotationId.value && item.type === selectedAnnotationType.value) ?? null
));
const selectedAnnotationDisplay = computed(() => (
  selectedAnnotation.value ? getAnnotationReviewDisplay(selectedAnnotation.value.reviewState) : null
));
const selectedAnnotationSeverity = computed(() => (
  selectedAnnotation.value?.severity ? getAnnotationSeverityDisplay(selectedAnnotation.value.severity) : null
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

const linkedMeasurements = computed<LinkedMeasurementItem[]>(() => {
  const annotation = selectedAnnotation.value;
  if (!annotation) return [];

  const combined = new Map<string, LinkedMeasurementItem>();
  const appendMeasurement = (
    measurement: MeasurementRecord | XeokitMeasurementRecord,
    engine: 'xeokit' | 'classic',
  ) => {
    if (measurement.sourceAnnotationId !== annotation.id || measurement.sourceAnnotationType !== annotation.type) return;
    const summary = measurement.kind === 'angle'
      ? `角度 · ${measurement.origin.entityId} → ${measurement.corner.entityId} → ${measurement.target.entityId}`
      : `距离 · ${measurement.origin.entityId} → ${measurement.target.entityId}`;
    combined.set(`${engine}:${measurement.id}`, {
      id: measurement.id,
      engine,
      kind: measurement.kind,
      createdAt: measurement.createdAt,
      visible: measurement.visible,
      summary,
    });
  };

  for (const measurement of toolStore.allXeokitMeasurements.value) {
    appendMeasurement(measurement, 'xeokit');
  }
  for (const measurement of toolStore.measurements.value) {
    appendMeasurement(measurement, 'classic');
  }

  return [...combined.values()].sort((a, b) => b.createdAt - a.createdAt);
});

function buildAnnotationSelectionKey(taskId: string | null, type: AnnotationType, id: string): string {
  return `${taskId || '__no_task__'}::${type}:${id}`;
}

function setActiveAnnotation(type: AnnotationType | null, id: string | null) {
  toolStore.activeAnnotationId.value = type === 'text' ? id : null;
  toolStore.activeCloudAnnotationId.value = type === 'cloud' ? id : null;
  toolStore.activeRectAnnotationId.value = type === 'rect' ? id : null;
  toolStore.activeObbAnnotationId.value = type === 'obb' ? id : null;
}

function selectAnnotation(item: AnnotationListItem | null) {
  selectedAnnotationId.value = item?.id ?? null;
  selectedAnnotationType.value = item?.type ?? null;
  persistedAnnotationKey.value = item
    ? buildAnnotationSelectionKey(currentTask.value?.id ?? null, item.type, item.id)
    : null;
  setActiveAnnotation(item?.type ?? null, item?.id ?? null);
}

function resolveDefaultAnnotation(): AnnotationListItem | null {
  const taskId = currentTask.value?.id ?? null;
  const persisted = persistedAnnotationKey.value;
  if (taskId && persisted) {
    const matched = allAnnotationItems.value.find((item) => (
      buildAnnotationSelectionKey(taskId, item.type, item.id) === persisted
    ));
    if (matched) return matched;
  }

  const openItem = annotationSections.value.find((section) => section.key === 'open')?.items[0] ?? null;
  if (openItem) return openItem;
  const rejectedItem = annotationSections.value.find((section) => section.key === 'rejected')?.items[0] ?? null;
  if (rejectedItem) return rejectedItem;
  return allAnnotationItems.value[0] ?? null;
}

function getAnnotationTypeBadge(type: AnnotationType): { label: string; tone: string } {
  switch (type) {
    case 'text':
      return { label: '文字', tone: 'bg-blue-100 text-blue-700' };
    case 'cloud':
      return { label: '云线', tone: 'bg-violet-100 text-violet-700' };
    case 'rect':
      return { label: '矩形', tone: 'bg-amber-100 text-amber-700' };
    case 'obb':
      return { label: '包围盒', tone: 'bg-fuchsia-100 text-fuchsia-700' };
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

function formatDateOnly(timestamp?: number | null): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatWorkflowNode(node?: ReviewTask['currentNode'] | null): string {
  if (!node) return '—';
  return WORKFLOW_NODE_NAMES[node] || node;
}

async function loadTasks() {
  await userStore.loadReviewTasks();
}

async function selectTask(task: ReviewTask) {
  selectedTaskId.value = task.id;
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

async function locateAnnotation(item: AnnotationListItem | null) {
  if (!item) return;
  selectAnnotation(item);
  ensurePanelAndActivate('viewer');
  if (!item.refnos.length) return;
  const result = await showModelByRefnosWithAck({
    refnos: item.refnos,
    viewerRef: viewerContext.viewerRef,
  });
  if (result.error) {
    emitToast({ message: result.error, level: 'warning' });
  }
}

async function startMeasurement(kind: 'distance' | 'angle') {
  const annotation = selectedAnnotation.value;
  if (!annotation) {
    emitToast({ message: '请先选择一条批注，再补充测量证据', level: 'warning' });
    return;
  }
  selectAnnotation(annotation);
  ensurePanelAndActivate('viewer');
  emitCommand(kind === 'distance' ? 'measurement.distance' : 'measurement.angle');
  emitToast({
    message: kind === 'distance' ? '请在模型中选择两个点完成距离测量' : '请在模型中选择三个点完成角度测量',
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
    confirmError.value = error instanceof Error ? error.message : '确认当前数据失败';
  } finally {
    confirmSaving.value = false;
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
  () => returnedTasks.value.map((task) => task.id).join('|'),
  async () => {
    if (!returnedTasks.value.length) return;
    const activeTask = reviewStore.currentTask.value;
    if (activeTask && returnedTasks.value.some((task) => task.id === activeTask.id)) {
      selectedTaskId.value = activeTask.id;
      return;
    }

    const persistedTask = selectedTaskId.value
      ? returnedTasks.value.find((task) => task.id === selectedTaskId.value)
      : null;
    await selectTask(persistedTask ?? returnedTasks.value[0]);
  },
  { immediate: true },
);

watch(
  () => reviewStore.currentTask.value?.id ?? null,
  (taskId) => {
    selectedTaskId.value = taskId;
    selectedAnnotationId.value = null;
    selectedAnnotationType.value = null;
    if (!taskId) {
      showInitiateDrawer.value = false;
    }
  },
);

watch(
  () => allAnnotationItems.value.map((item) => `${item.type}:${item.id}:${item.activityAt}`).join('|'),
  () => {
    const current = selectedAnnotation.value;
    if (current) {
      setActiveAnnotation(current.type, current.id);
      return;
    }

    const preferred = resolveDefaultAnnotation();
    if (preferred) {
      selectAnnotation(preferred);
    } else {
      selectAnnotation(null);
    }
  },
  { immediate: true },
);

onMounted(() => {
  void loadTasks();
});
</script>

<template>
  <div class="relative flex h-full min-h-0 overflow-hidden bg-[#F8FAFC]" data-panel="designerCommentHandling">
    <section class="w-[360px] shrink-0 border-r border-slate-200 bg-white">
      <ResubmissionTaskList :auto-load="false"
        detail-mode="external"
        :selected-task-id="currentTask?.id ?? null"
        cta-label="进入批注处理"
        @select-task="selectTask"
        @view-task="openTaskHistory" />
    </section>

    <section class="min-w-0 flex-1 overflow-hidden border-r border-slate-200 bg-[#FCFDFE]">
      <div class="flex h-full min-h-0 flex-col overflow-hidden p-4">
        <template v-if="currentTask">
          <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-xl font-semibold text-slate-950">{{ currentTask.title }}</h2>
                  <span class="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">已退回</span>
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
                <button type="button"
                  class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  :disabled="refreshingTask"
                  @click="refreshCurrentTask">
                  <RefreshCw class="h-4 w-4" :class="refreshingTask ? 'animate-spin' : ''" />
                  刷新任务
                </button>
                <button type="button"
                  class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  @click="showInitiateDrawer = true">
                  <FileText class="h-4 w-4" />
                  查看发起单
                </button>
                <button type="button"
                  class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  @click="openTaskHistory(currentTask)">
                  <Calendar class="h-4 w-4" />
                  流转历史
                </button>
              </div>
            </div>
            <div class="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <div class="flex items-start gap-2">
                <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div class="font-semibold">退回意见</div>
                  <div class="mt-1 leading-6">{{ returnedMetadata?.returnReason || '未填写退回意见' }}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
            <div v-for="section in annotationSections"
              :key="section.key"
              class="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div class="text-xs text-slate-400">{{ section.title }}</div>
              <div class="mt-2 text-2xl font-semibold text-slate-950">{{ section.count }}</div>
            </div>
          </div>

          <div class="mt-4 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-base font-semibold text-slate-950">返回批注列表</h3>
                <p class="mt-1 text-sm text-slate-500">通过驳回单据进入后，默认先查看需要处理的返回批注。</p>
              </div>
              <div class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                共 {{ allAnnotationItems.length }} 条
              </div>
            </div>

            <div v-if="allAnnotationItems.length === 0" class="flex h-full min-h-[240px] items-center justify-center">
              <div class="text-center text-sm text-slate-500">
                <ClipboardCheck class="mx-auto mb-3 h-8 w-8 text-slate-300" />
                当前单据还没有可处理的批注
              </div>
            </div>

            <div v-else class="mt-4 space-y-4">
              <section v-for="section in annotationSections.filter((item) => item.count > 0)" :key="section.key" class="space-y-3">
                <div class="flex items-center gap-2">
                  <span class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="section.tone">{{ section.title }}</span>
                  <span class="text-xs text-slate-400">{{ section.count }} 条</span>
                </div>

                <div class="space-y-3">
                  <button v-for="item in section.items"
                    :key="`${item.type}:${item.id}`"
                    type="button"
                    class="block w-full rounded-2xl border px-4 py-4 text-left transition hover:border-orange-200 hover:bg-orange-50/40"
                    :class="selectedAnnotation?.id === item.id && selectedAnnotation?.type === item.type
                      ? 'border-orange-300 bg-orange-50/70 shadow-sm'
                      : 'border-slate-200 bg-white'"
                    @click="selectAnnotation(item)">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="getAnnotationTypeBadge(item.type).tone">
                            {{ getAnnotationTypeBadge(item.type).label }}
                          </span>
                          <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="getAnnotationReviewDisplay(item.reviewState).color">
                            {{ getAnnotationReviewDisplay(item.reviewState).label }}
                          </span>
                          <span v-if="item.severity" class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            :class="getAnnotationSeverityDisplay(item.severity).color">
                            {{ getAnnotationSeverityDisplay(item.severity).label }}
                          </span>
                        </div>
                        <div class="mt-2 truncate text-sm font-semibold text-slate-950">{{ item.title }}</div>
                        <div class="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{{ item.description }}</div>
                        <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span>{{ formatDateTime(item.activityAt) }}</span>
                          <span v-if="item.refnos.length">RefNo {{ item.refnos.join(', ') }}</span>
                          <span v-if="item.reviewState?.updatedByName">最近处理：{{ item.reviewState.updatedByName }}</span>
                        </div>
                      </div>
                      <button type="button"
                        class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        @click.stop="locateAnnotation(item)">
                        <LocateFixed class="h-3.5 w-3.5" />
                        定位
                      </button>
                    </div>
                  </button>
                </div>
              </section>
            </div>
          </div>
        </template>

        <div v-else class="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white">
          <div class="text-center text-sm text-slate-500">
            <XCircle class="mx-auto mb-3 h-9 w-9 text-slate-300" />
            当前没有需要处理的退回单据
          </div>
        </div>
      </div>
    </section>

    <section class="w-[460px] shrink-0 overflow-hidden bg-white">
      <div class="flex h-full min-h-0 flex-col overflow-hidden p-4">
        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-base font-semibold text-slate-950">{{ selectedAnnotation?.title || '请选择一条批注' }}</div>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span v-if="selectedAnnotationDisplay" class="rounded-full px-2 py-0.5 font-semibold" :class="selectedAnnotationDisplay.color">
                  {{ selectedAnnotationDisplay.label }}
                </span>
                <span v-if="selectedAnnotationSeverity" class="rounded-full px-2 py-0.5 font-semibold" :class="selectedAnnotationSeverity.color">
                  {{ selectedAnnotationSeverity.label }}
                </span>
                <span v-if="selectedAnnotation?.refnos.length">RefNo {{ selectedAnnotation.refnos.join(', ') }}</span>
              </div>
            </div>
            <button type="button"
              class="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!selectedAnnotation"
              @click="locateAnnotation(selectedAnnotation)">
              <LocateFixed class="h-4 w-4" />
              定位到模型
            </button>
          </div>
          <p class="mt-3 text-sm leading-6 text-slate-600">{{ selectedAnnotation?.description || '在左侧选择一条批注后，可继续回复说明、补充测量证据，并标记已修改或不需解决。' }}</p>
        </div>

        <div class="mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <ReviewCommentsTimeline :annotation-type="selectedAnnotationType"
            :annotation-id="selectedAnnotationId"
            :annotation-label="selectedAnnotation?.title || '批注处理详情'"
            composer-placeholder="输入处理说明，或补充给校核人的说明..."
            composer-submit-label="发送回复"
            designer-only />
        </div>

        <div class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-sm font-semibold text-slate-950">测量证据</h3>
              <p class="mt-1 text-xs leading-5 text-slate-500">测量只作为当前批注的证据，不单独参与状态流转。</p>
            </div>
            <div class="flex items-center gap-2">
              <button type="button"
                class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedAnnotation"
                @click="startMeasurement('distance')">
                <Ruler class="h-3.5 w-3.5" />
                新增距离
              </button>
              <button type="button"
                class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedAnnotation"
                @click="startMeasurement('angle')">
                <Ruler class="h-3.5 w-3.5" />
                新增角度
              </button>
            </div>
          </div>

          <div v-if="!selectedAnnotation" class="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            先选择一条批注，再补充对应的测量证据。
          </div>
          <div v-else-if="linkedMeasurements.length === 0" class="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            当前批注还没有关联的测量证据。
          </div>
          <div v-else class="mt-3 space-y-2">
            <div v-for="measurement in linkedMeasurements" :key="`${measurement.engine}:${measurement.id}`"
              class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-slate-900">{{ measurement.summary }}</div>
                <div class="mt-1 text-xs text-slate-400">{{ formatDateTime(measurement.createdAt) }}</div>
              </div>
              <button type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
                @click="locateMeasurement(measurement)">
                <LocateFixed class="h-3.5 w-3.5" />
                定位
              </button>
            </div>
          </div>
        </div>

        <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-4 text-white shadow-lg">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-sm font-semibold">确认当前数据</div>
              <div class="mt-1 text-xs leading-5 text-slate-300">处理动作与测量证据需要先确认保存，后续外部流转才能继续。</div>
            </div>
            <div class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-100">
              未确认 {{ unsavedAnnotationCount }} 批注 / {{ unsavedMeasurementCount }} 测量
            </div>
          </div>
          <div class="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <textarea v-model="confirmNote"
              class="min-h-[60px] w-full resize-none bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
              placeholder="可补充本轮处理说明（可选）" />
          </div>
          <div class="mt-3 flex items-center justify-between gap-3">
            <div v-if="confirmError" class="text-xs text-rose-300">{{ confirmError }}</div>
            <div v-else class="text-xs text-slate-400">
              {{ canConfirmCurrentData ? '确认后会以当前批注和测量快照生成处理留痕。' : '当前没有新的处理数据需要确认。' }}
            </div>
            <button type="button"
              class="inline-flex shrink-0 items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-700"
              :disabled="!canConfirmCurrentData || confirmSaving"
              @click="confirmCurrentData">
              <Send class="h-4 w-4" />
              {{ confirmSaving ? '保存中...' : '确认当前数据' }}
            </button>
          </div>
        </div>
      </div>
    </section>

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
