<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import {
  AlertCircle,
  Calendar,
  ClipboardCheck,
  LocateFixed,
  RefreshCw,
  Ruler,
  Send,
  XCircle,
} from 'lucide-vue-next';

import { createConfirmedRecordsRestorer } from './confirmedRecordsRestore';
import NonReturnedGuidanceCard from './NonReturnedGuidanceCard.vue';
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
import { useReviewStore } from '@/composables/useReviewStore';
import {
  getAnnotationRefnos,
  useToolStore,
  type AnnotationType,
  type MeasurementRecord,
  type XeokitMeasurementRecord,
} from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
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
import {
  formatMeasurementKindLabel,
  formatMeasurementSummary,
} from '@/utils/xeokitMeasurementFormat';

type AnnotationListItem = {
  id: string;
  type: AnnotationType;
  title: string;
  description: string;
  createdAt: number;
  visible: boolean;
  refnos: string[];
  reviewState?: AnnotationReviewState;
  severity?: AnnotationSeverity;
};

type AnnotationSectionKey = 'open' | 'rejected' | 'fixed' | 'wont_fix' | 'approved';

type LinkedMeasurementItem = {
  id: string;
  engine: 'xeokit' | 'classic';
  kind: MeasurementRecord['kind'];
  createdAt: number;
  visible: boolean;
  summary: string;
};

const SECTION_META: Record<AnnotationSectionKey, { title: string; tone: string }> = {
  open: { title: '待处理', tone: 'bg-slate-100 text-slate-700' },
  rejected: { title: '已驳回', tone: 'bg-rose-100 text-rose-700' },
  fixed: { title: '已修改待确认', tone: 'bg-blue-100 text-blue-700' },
  wont_fix: { title: '不需解决待确认', tone: 'bg-amber-100 text-amber-700' },
  approved: { title: '已同意', tone: 'bg-emerald-100 text-emerald-700' },
};

const userStore = useUserStore();
const reviewStore = useReviewStore();
const toolStore = useToolStore();
const viewerContext = useViewerContext();
const unitSettings = useUnitSettingsStore();

const selectedAnnotationId = ref<string | null>(null);
const selectedAnnotationType = ref<AnnotationType | null>(null);
const detailTask = ref<ReviewTask | null>(null);
const confirmNote = ref('');
const confirmSaving = ref(false);
const confirmError = ref<string | null>(null);
const refreshingTask = ref(false);

const confirmedRecordsRestorer = createConfirmedRecordsRestorer({
  currentTaskId: () => reviewStore.currentTask.value?.id ?? null,
  confirmedRecords: () => reviewStore.sortedConfirmedRecords.value,
  toolStore,
  waitForViewerReady,
  getViewerTools: () => viewerContext.tools.value ?? null,
});

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
const currentTaskConfirmedRecords = confirmedRecordsRestorer.currentTaskRecords;

const allAnnotationItems = computed<AnnotationListItem[]>(() => {
  const items: AnnotationListItem[] = [];

  for (const annotation of toolStore.annotations.value) {
    items.push({
      id: annotation.id,
      type: 'text',
      title: annotation.title?.trim() || '未命名文字批注',
      description: annotation.description?.trim() || '暂无批注描述',
      createdAt: annotation.createdAt,
      visible: annotation.visible,
      refnos: getAnnotationRefnos(annotation),
      reviewState: annotation.reviewState,
      severity: annotation.severity,
    });
  }

  for (const annotation of toolStore.cloudAnnotations.value) {
    items.push({
      id: annotation.id,
      type: 'cloud',
      title: annotation.title?.trim() || '未命名云线批注',
      description: annotation.description?.trim() || '暂无批注描述',
      createdAt: annotation.createdAt,
      visible: annotation.visible,
      refnos: getAnnotationRefnos(annotation),
      reviewState: annotation.reviewState,
      severity: annotation.severity,
    });
  }

  for (const annotation of toolStore.rectAnnotations.value) {
    items.push({
      id: annotation.id,
      type: 'rect',
      title: annotation.title?.trim() || '未命名矩形批注',
      description: annotation.description?.trim() || '暂无批注描述',
      createdAt: annotation.createdAt,
      visible: annotation.visible,
      refnos: getAnnotationRefnos(annotation),
      reviewState: annotation.reviewState,
      severity: annotation.severity,
    });
  }

  for (const annotation of toolStore.obbAnnotations.value) {
    items.push({
      id: annotation.id,
      type: 'obb',
      title: annotation.title?.trim() || '未命名包围盒批注',
      description: annotation.description?.trim() || '暂无批注描述',
      createdAt: annotation.createdAt,
      visible: annotation.visible,
      refnos: getAnnotationRefnos(annotation),
      reviewState: annotation.reviewState,
      severity: annotation.severity,
    });
  }

  return items.sort((a, b) => b.createdAt - a.createdAt);
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
  xeokitElevationPointMeasurements: [...(toolStore.xeokitElevationPointMeasurements?.value ?? [])],
  xeokitElevationDeltaMeasurements: [...(toolStore.xeokitElevationDeltaMeasurements?.value ?? [])],
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
    if (measurement.kind !== 'distance' && measurement.kind !== 'angle') return;
    const summary = `${formatMeasurementKindLabel(measurement.kind)} · ${formatMeasurementSummary(
      measurement,
      unitSettings.displayUnit.value,
      unitSettings.precision.value,
    )}`;
    combined.set(`${engine}:${measurement.id}`, {
      id: measurement.id,
      engine,
      kind: measurement.kind,
      createdAt: measurement.createdAt,
      visible: measurement.visible,
      summary,
      measurement,
      pathDisplayId: `${engine}:${measurement.id}`,
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

function setActiveAnnotation(type: AnnotationType | null, id: string | null) {
  toolStore.activeAnnotationId.value = type === 'text' ? id : null;
  toolStore.activeCloudAnnotationId.value = type === 'cloud' ? id : null;
  toolStore.activeRectAnnotationId.value = type === 'rect' ? id : null;
  toolStore.activeObbAnnotationId.value = type === 'obb' ? id : null;
}

function selectAnnotation(item: AnnotationListItem | null) {
  selectedAnnotationId.value = item?.id ?? null;
  selectedAnnotationType.value = item?.type ?? null;
  setActiveAnnotation(item?.type ?? null, item?.id ?? null);
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

function getCurrentTaskNodeLabel(task?: ReviewTask | null): string {
  if (!task?.currentNode) return '未开始';
  return WORKFLOW_NODE_NAMES[task.currentNode] || task.currentNode;
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
  currentFormId: () => reviewStore.currentTask.value?.formId ?? null,
  confirmedRecords: () => reviewStore.sortedConfirmedRecords.value,
  toolStore,
  waitForViewerReady,
  getViewerTools: () => viewerContext.tools.value ?? null,
  skipClearOnEmpty: true,
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
const passiveFormScopeWithoutTask = computed(() => (
  !currentTask.value && !!passiveRestoredTaskFormId.value
));
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
const hasFormScopeWithoutMatchedTask = computed(() => (
  hasExternalEntryWithoutMatchedTask.value || passiveFormScopeWithoutTask.value
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
  && (!!currentTask.value || passiveFormScopeWithoutTask.value)
  && !hasExternalEntryWithoutMatchedTask.value
));

/**
 * 评论时间线的正式单据上下文。
 *
 * - 如果当前任务已匹配 → 用 `currentTask.formId / id`，并允许处理动作；
 * - 仅外部入口给出 formId 但未匹配任务 → `formId / null`，禁止处理动作；
 * - 没有任何上下文 → 全部为 null，按本地草稿语义处理。
 */
const timelineContextFormId = computed<string | null>(() => (
  normalizeFormId(currentTask.value?.formId)
    ?? normalizeFormId(externalEntryTarget.value?.formId)
    ?? passiveRestoredTaskFormId.value
));
const timelineContextTaskId = computed<string | null>(() => (
  currentTask.value?.id ?? null
));
const timelineAllowReviewActions = computed(() => (
  !hasFormScopeWithoutMatchedTask.value
));

const allAnnotationItems = computed<AnnotationWorkspaceItem[]>(() => {
  const formIdContext = timelineContextFormId.value;
  const taskIdContext = timelineContextTaskId.value;
  return buildAnnotationWorkspaceItems({
    annotations: toolStore.annotations.value,
    cloudAnnotations: toolStore.cloudAnnotations.value,
    rectAnnotations: toolStore.rectAnnotations.value,
    obbAnnotations: toolStore.obbAnnotations.value,
    getCommentCount: (type, id) => toolStore.getAnnotationComments(type, id, formIdContext, taskIdContext).length,
  });
});

const scopedAnnotationItems = computed<AnnotationWorkspaceItem[]>(() => {
  const currentFormId = currentTask.value?.formId ?? null;
  const externalFormId = externalEntryTarget.value?.formId ?? null;
  let items = scopeAnnotationWorkspaceItemsByFormId(
    allAnnotationItems.value,
    currentFormId || externalFormId || passiveRestoredTaskFormId.value,
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
  scopedAnnotationItems.value.find((item) => item.id === selectedAnnotationId.value && item.type === selectedAnnotationType.value) ?? null
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
  buildUnsavedReviewEvidencePayload(currentDraftConfirmPayload.value, confirmedSnapshotPayload.value)
));
const hasUnsavedPendingData = computed(() => (
  buildReviewEvidenceSnapshotKey(currentDraftConfirmPayload.value)
    !== buildReviewEvidenceSnapshotKey(confirmedSnapshotPayload.value)
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
  !!currentTask.value && isDesignerResubmissionTask(currentTask.value)
));

function syncStoredEmbedLandingState() {
  storedEmbedLandingState.value = readStoredEmbedLandingState();
  void nextTick(() => {
    enterPassiveFormScopeIfReady();
  });
}

function enterPassiveFormScopeIfReady() {
  if (!passiveFormScopeWithoutTask.value) return;
  if (scopedAnnotationItems.value.length === 0) return;
  if (workspaceView.value === 'annotation_list' || workspaceView.value === 'annotation_detail') return;
  enterAnnotationList({ fromTaskEntry: false });
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
  if (!currentTask.value && !passiveFormScopeWithoutTask.value) {
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

function handleTextAnnotationCollapseCommand(payload: AnnotationWorkspaceTextCollapsePayload) {
  const ids = payload.ids.filter((id) => id.trim().length > 0);
  if (ids.length === 0) return;

  if (payload.mode === 'collapse-all') {
    toolStore.setTextAnnotationsCollapsed(ids, true);
    return;
  }

  if (payload.mode === 'expand-all') {
    toolStore.setTextAnnotationsCollapsed(ids, false);
    return;
  }

  toolStore.setTextAnnotationsCollapsed(ids, true);
  if (payload.selectedId && ids.includes(payload.selectedId)) {
    toolStore.setTextAnnotationsCollapsed([payload.selectedId], false);
    setActiveWorkspaceAnnotation('text', payload.selectedId);
  }
}

function resolvePreferredWorkspaceAnnotation(): AnnotationWorkspaceItem | null {
  const target = externalEntryTarget.value;
  if (target) {
    const matched = scopedAnnotationItems.value.find((item) => item.id === target.annotationId && item.type === target.annotationType);
    if (matched) return matched;
  }

  const persisted = persistedAnnotationKey.value;
  if (persisted) {
    const matched = scopedAnnotationItems.value.find((item) => (
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

async function startMeasurement(kind: MeasurementRecord['kind']) {
  const annotation = selectedAnnotation.value;
  if (!annotation) {
    emitToast({ message: '请先选择一条批注，再补充测量证据', level: 'warning' });
    return;
  }
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

async function handleResubmitTask() {
  if (!currentTask.value || !canResubmitCurrentTask.value || resubmitLoading.value) return;

  const task = currentTask.value;
  resubmitLoading.value = true;
  confirmError.value = null;
  try {
    const preflight = await runReviewSubmitPreflight({
      hasUnsavedBlockingData: hasUnsavedPendingData.value,
      taskId: task.id,
      currentNode: task.currentNode,
      checkAnnotations: () => reviewAnnotationCheck({
        taskId: task.id,
        formId: task.formId || undefined,
        currentNode: task.currentNode,
        intent: 'submit_next',
        includedTypes: ['text', 'cloud', 'rect'],
      }),
    });
    if (!preflight.allowed) {
      confirmError.value = preflight.message || '批注检查失败，请稍后重试';
      return;
    }

    const notifiedExternalWorkflow = notifyParentWorkflowAction({
      action: 'active',
      taskId: task.id,
      formId: task.formId?.trim() || undefined,
      source: 'designer-comment-handling-panel',
    });
    if (notifiedExternalWorkflow) {
      emitToast({ message: '已通知外部流程重新流转', level: 'success' });
      return;
    }

    await userStore.submitTaskToNextNode(task.id);
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
      if (passiveFormScopeWithoutTask.value && scopedAnnotationItems.value.length > 0) {
        enterAnnotationList({ fromTaskEntry: false });
      } else if (!hasExternalEntryWithoutMatchedTask.value) {
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
    enterPassiveFormScopeIfReady();

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
  enterPassiveFormScopeIfReady();

  if (selectedAnnotation.value) return;
  const preferred = resolvePreferredWorkspaceAnnotation();
  if (preferred) {
    selectWorkspaceAnnotation(preferred, externalEntryLock.value ? 'external' : 'manual');
  }
});

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

onMounted(async () => {
  window.addEventListener(EMBED_LANDING_STATE_UPDATED_EVENT, syncStoredEmbedLandingState as EventListener);
  syncStoredEmbedLandingState();
  await loadTasks();
  enterPassiveFormScopeIfReady();

watch(
  () => reviewStore.currentTask.value?.id ?? null,
  () => {
    selectedAnnotationId.value = null;
    selectedAnnotationType.value = null;
  },
);

watch(
  () => allAnnotationItems.value.map((item) => `${item.type}:${item.id}`).join('|'),
  () => {
    const current = selectedAnnotation.value;
    if (current) {
      setActiveAnnotation(current.type, current.id);
      return;
    }

    const preferred = annotationSections.value.find((section) => section.count > 0)?.items[0] ?? null;
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
  <div class="flex h-full min-h-0 overflow-hidden bg-[#F8FAFC]" data-panel="designer-comment-handling">
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
        <template v-if="currentTaskIsReturned">
          <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="designer-state-1">
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

          <div class="mt-4 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            data-testid="designer-comment-annotation-list">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-base font-semibold text-slate-950">全部批注</h3>
                <p class="mt-1 text-sm text-slate-500">按处理状态分组展示，设计人员只需处理已有批注。</p>
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
                          <span>{{ formatDateTime(item.reviewState?.updatedAt || item.createdAt) }}</span>
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

        <NonReturnedGuidanceCard v-else-if="currentTask"
          :task="currentTask"
          @navigate-to-review="goToReviewPanel" />

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
                <span v-if="currentTaskPriority" class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="currentTaskPriority.color">
                  {{ currentTaskPriority.label }}
                </span>
                <span v-if="hasFormScopeWithoutMatchedTask"
                  class="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  未匹配到单据
                </span>
                <span v-if="selectedAnnotation?.refnos.length">RefNo {{ selectedAnnotation.refnos.join(', ') }}</span>
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

          <div v-else-if="hasFormScopeWithoutMatchedTask"
            class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            data-testid="external-entry-unmatched-task">
            <div class="flex items-start gap-2">
              <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div class="font-semibold">未匹配到对应单据</div>
                <div class="mt-1 leading-6">
                  当前批注的 form_id 为 {{ externalEntryTarget?.formId || passiveRestoredTaskFormId || '—' }}，返回任务列表中没有同 form_id 的单据。
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
              :timeline-context-form-id="timelineContextFormId"
              :timeline-context-task-id="timelineContextTaskId"
              :timeline-allow-review-actions="timelineAllowReviewActions"
              :list-scroll-top="annotationListScrollTop"
              timeline-placeholder="输入处理说明，或补充给校核人的说明..."
              timeline-submit-label="发送回复"
              confirm-action-label="保存新增证据"
              :confirm-hint="currentTask
                ? '批注处理结果会自动保存；仅新增测量、几何批注或截图证据时需要保存。'
                : '当前未匹配到对应单据，回复和历史可继续查看，但本页不能保存新增证据。'"
              empty-title="当前范围内还没有可处理的批注"
              empty-description="请选择退回任务，或等待对应 form_id 的批注同步后再处理。"
              @update:active-filter="annotationFilter = $event"
              @update:confirm-note="confirmNote = $event"
              @update:list-scroll-top="annotationListScrollTop = $event"
              @select-annotation="selectWorkspaceAnnotation"
              @open-annotation="enterAnnotationDetail"
              @collapse-text-annotations="handleTextAnnotationCollapseCommand"
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
              :timeline-context-form-id="timelineContextFormId"
              :timeline-context-task-id="timelineContextTaskId"
              :timeline-allow-review-actions="timelineAllowReviewActions"
              :show-detail-back="canReturnToAnnotationList"
              detail-back-label="返回批注列表"
              timeline-placeholder="输入处理说明，或补充给校核人的说明..."
              timeline-submit-label="发送回复"
              confirm-action-label="保存新增证据"
              :confirm-hint="currentTask
                ? '批注处理结果会自动保存；仅新增测量、几何批注或截图证据时需要保存。'
                : '当前未匹配到对应单据，回复和历史可继续查看，但本页不能保存新增证据。'"
              empty-title="当前范围内还没有可处理的批注"
              empty-description="请选择退回任务，或等待对应 form_id 的批注同步后再处理。"
              @back="backToAnnotationList"
              @update:active-filter="annotationFilter = $event"
              @update:confirm-note="confirmNote = $event"
              @select-annotation="selectWorkspaceAnnotation"
              @collapse-text-annotations="handleTextAnnotationCollapseCommand"
              @locate-annotation="(item) => void locateAnnotation(item)"
              @locate-measurement="locateMeasurement"
              @start-measurement="(kind) => void startMeasurement(kind)"
              @update-severity="updateSelectedAnnotationSeverity"
              @confirm="void confirmCurrentData()">
              <template #workflow>
                <div class="space-y-4" data-testid="designer-comment-workflow-zone">
                  <div v-if="currentTask?.returnReason" class="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div class="flex items-start gap-2">
                      <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <div>
                        <div class="text-sm font-semibold text-amber-800">校核驳回原因</div>
                        <div class="mt-0.5 text-xs leading-5 text-amber-700">{{ currentTask.returnReason }}</div>
                        <div class="mt-1 text-xs text-amber-600">请处理批注后点击下方「流转回校对」重新提交。</div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div class="text-sm font-semibold text-slate-950">任务级动作</div>
                    <div class="mt-1 text-xs leading-5 text-slate-500">
                      这里是设计侧的任务级动作入口。批注处理结果会自动保存；如补充了测量或几何证据，请先保存新增证据。
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
                      class="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      :class="canResubmitCurrentTask && !hasUnsavedPendingData && !resubmitLoading
                        ? 'bg-orange-500 hover:bg-orange-600 ring-2 ring-orange-300 ring-offset-1'
                        : 'bg-orange-500 hover:bg-orange-600'"
                      :disabled="!canResubmitCurrentTask || hasUnsavedPendingData || resubmitLoading"
                      :title="!canResubmitCurrentTask
                        ? '请先处理所有批注后再提交'
                        : hasUnsavedPendingData
                          ? '请先保存未保存的证据数据'
                          : '点击将任务重新提交给校核人员'"
                      @click="void handleResubmitTask()">
                      <Send class="h-4 w-4" />
                      {{ resubmitLoading ? '提交中...' : '流转回校对' }}
                    </button>
                  </div>
                  <div v-if="currentTask && hasUnsavedPendingData" class="text-xs text-amber-700">
                    有未保存的证据数据，请先保存后再提交流转。
                  </div>
                  <div v-else-if="currentTask" class="text-xs text-slate-500">
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
              <button type="button"
                class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedAnnotation"
                @click="startMeasurement('elevation_point')">
                <Ruler class="h-3.5 w-3.5" />
                新增点标高
              </button>
              <button type="button"
                class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedAnnotation"
                @click="startMeasurement('elevation_delta')">
                <Ruler class="h-3.5 w-3.5" />
                新增高差
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

    <Teleport to="body">
      <TaskReviewDetail v-if="detailTask" :task="detailTask" @close="detailTask = null" />
    </Teleport>
  </div>
</template>
