<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';

import { Clock, FileText, Filter, HelpCircle, Paperclip, PlayCircle, RefreshCw, User, XCircle } from 'lucide-vue-next';

import { refreshReviewerTasksSafely, startReviewerTask } from './reviewerTaskListActions';
import {
  buildReviewConfirmSnapshotPayload,
  buildReviewConfirmSnapshotPayloadFromRecords,
  buildSubmitBlockingReviewConfirmPayload,
  canReturnAtCurrentNode,
  getSubmitActionLabel,
  hasSubmitBlockingReviewConfirmPayloadData,
  runReviewSubmitPreflight,
  submitTaskToNextNodeSafely,
} from './reviewPanelActions';
import WorkflowReturnDialog from './WorkflowReturnDialog.vue';

import { reviewAnnotationCheck, reviewTaskGetById } from '@/api/reviewApi';
import { useNavigationStatePersistence } from '@/composables/useNavigationStatePersistence';
import { useOnboardingGuide } from '@/composables/useOnboardingGuide';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { emitCommand } from '@/ribbon/commandBus';
import { emitToast } from '@/ribbon/toastBus';
import { UserRole, type ReviewTask } from '@/types/auth';
import {
  getPriorityDisplayName,
  getReviewerInboxPanelTitle,
  getSubmittedInboxLabelForReviewer,
  getTaskStatusDisplayName,
} from '@/types/auth';

const userStore = useUserStore();
const reviewStore = useReviewStore();
const toolStore = useToolStore();
const onboarding = useOnboardingGuide();
const navigationState = useNavigationStatePersistence('plant3d-web-nav-state-reviewer-tasks-v1');

const searchTerm = ref('');
const statusFilter = ref<string>('all');
const priorityFilter = ref<string>('all');
const isLoading = ref(false);
const selectedTask = ref<ReviewTask | null>(null);
const selectedTaskLoading = ref(false);
const selectedTaskError = ref<string | null>(null);
const taskActionLoading = ref(false);
const submitComment = ref('');
const submitDialogVisible = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);

navigationState.bindRef('searchTerm', searchTerm, '');
navigationState.bindRef('statusFilter', statusFilter, 'all');
navigationState.bindRef('priorityFilter', priorityFilter, 'all');

const tasks = computed(() => userStore.pendingReviewTasks.value);
const inboxPanelTitle = computed(() => getReviewerInboxPanelTitle(userStore.currentUser.value?.role));
const submittedInboxLabel = computed(() => getSubmittedInboxLabelForReviewer(userStore.currentUser.value?.role));
const reviewStageLabel = computed(() => {
  const r = userStore.currentUser.value?.role;
  if (r === UserRole.PROOFREADER) return '校对';
  if (r === UserRole.REVIEWER) return '审核';
  if (r === UserRole.MANAGER) return '批准';
  return '校审';
});

const filteredTasks = computed(() => {
  let result = [...tasks.value];

  if (searchTerm.value.trim()) {
    const term = searchTerm.value.toLowerCase();
    result = result.filter(
      (t) =>
        t.title.toLowerCase().includes(term) ||
        t.description.toLowerCase().includes(term) ||
        t.modelName.toLowerCase().includes(term)
    );
  }

  if (statusFilter.value !== 'all') {
    result = result.filter((t) => t.status === statusFilter.value);
  }

  if (priorityFilter.value !== 'all') {
    result = result.filter((t) => t.priority === priorityFilter.value);
  }

  return result;
});

const currentUser = computed(() => userStore.currentUser.value);
const hasFilters = computed(() => searchTerm.value || statusFilter.value !== 'all' || priorityFilter.value !== 'all');
const activeWorkbenchTask = computed(() => reviewStore.currentTask.value);
const selectedTaskConfirmedRecords = computed(() => {
  const selectedTaskId = selectedTask.value?.id;
  if (!selectedTaskId || activeWorkbenchTask.value?.id !== selectedTaskId) return [];
  return reviewStore.sortedConfirmedRecords.value.filter((record) => record.taskId === selectedTaskId);
});
const selectedTaskDraftConfirmPayload = computed(() => buildReviewConfirmSnapshotPayload({
  annotations: [...toolStore.annotations.value],
  cloudAnnotations: [...toolStore.cloudAnnotations.value],
  rectAnnotations: [...toolStore.rectAnnotations.value],
  obbAnnotations: [...toolStore.obbAnnotations.value],
  measurements: [...toolStore.measurements.value],
  xeokitDistanceMeasurements: [...toolStore.xeokitDistanceMeasurements.value],
  xeokitAngleMeasurements: [...toolStore.xeokitAngleMeasurements.value],
}));
const selectedTaskConfirmedSnapshotPayload = computed(() => (
  buildReviewConfirmSnapshotPayloadFromRecords(selectedTaskConfirmedRecords.value)
));
const selectedTaskSubmitBlockingPayload = computed(() => (
  buildSubmitBlockingReviewConfirmPayload(
    selectedTaskDraftConfirmPayload.value,
    selectedTaskConfirmedSnapshotPayload.value
  )
));
const selectedTaskHasUnsavedBlockingData = computed(() => {
  const selectedTaskId = selectedTask.value?.id;
  if (!selectedTaskId || activeWorkbenchTask.value?.id !== selectedTaskId) return false;
  return hasSubmitBlockingReviewConfirmPayloadData(selectedTaskSubmitBlockingPayload.value);
});

async function refreshTasks() {
  await refreshReviewerTasksSafely({
    loadReviewTasks: userStore.loadReviewTasks,
    setLoading: (loading) => {
      isLoading.value = loading;
    },
  });
}

function clearFilters() {
  searchTerm.value = '';
  statusFilter.value = 'all';
  priorityFilter.value = 'all';
}

function persistScrollPosition() {
  navigationState.saveValue('scrollTop', scrollContainer.value?.scrollTop ?? 0);
}

function restoreScrollPosition() {
  nextTick(() => {
    if (!scrollContainer.value) return;
    scrollContainer.value.scrollTop = navigationState.getValue('scrollTop', 0);
  });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatRelativeSubmitTime(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const sameYear = now.getFullYear() === date.getFullYear();
  const diffDays = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000);
  const timeText = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (diffDays === 0) return `今天 ${timeText}`;
  if (diffDays === 1) return `昨天 ${timeText}`;
  return sameYear
    ? `${date.getMonth() + 1}-${date.getDate()} ${timeText}`
    : `${formatDate(timestamp)} ${timeText}`;
}

function getStatusPresentation(task: ReviewTask) {
  const status = getTaskStatusDisplayName(task.status);
  if (task.status === 'submitted') {
    return {
      label: submittedInboxLabel.value,
      textClass: 'text-amber-600',
      dotClass: 'bg-amber-500',
    };
  }
  if (task.status === 'in_review') {
    return {
      label: status.label,
      textClass: 'text-blue-600',
      dotClass: 'bg-blue-500',
    };
  }

  return {
    label: status.label,
    textClass: 'text-gray-600',
    dotClass: 'bg-gray-400',
  };
}

function getPriorityBadgeClass(task: ReviewTask): string {
  if (task.priority === 'urgent') return 'bg-red-100 text-red-700';
  if (task.priority === 'medium') return 'bg-blue-100 text-blue-700';
  if (task.priority === 'low') return 'bg-gray-100 text-gray-600';
  return 'bg-orange-100 text-orange-700';
}

function getTaskActionFeedback(task: ReviewTask) {
  if (task.status === 'approved') {
    return {
      label: '已通过',
      className: 'border border-green-200 bg-green-50 text-green-700',
    };
  }

  if (task.status === 'rejected') {
    return {
      label: '已驳回',
      className: 'border border-red-200 bg-red-50 text-red-700',
    };
  }

  return null;
}

async function handleStartReview(task: ReviewTask) {
  await startReviewerTask({
    task,
    setCurrentTask: reviewStore.setCurrentTask,
    emitCommand,
    loadReviewTasks: userStore.loadReviewTasks,
    getTasksSnapshot: () => userStore.pendingReviewTasks.value,
    onTaskSelected: (currentTask) => {
      selectedTask.value = currentTask;
    },
  });
}

async function handleApprove(task: ReviewTask) {
  selectedTaskError.value = null;
  const submitted = await submitTaskToNextNodeSafely({
    canSubmit: true,
    taskId: task.id,
    currentNode: task.currentNode,
    submitComment,
    showSubmitDialog: submitDialogVisible,
    workflowActionLoading: taskActionLoading,
    workflowError: selectedTaskError,
    beforeSubmit: () => runReviewSubmitPreflight({
      hasUnsavedBlockingData: selectedTaskHasUnsavedBlockingData.value,
      taskId: task.id,
      currentNode: task.currentNode,
      checkAnnotations: () => reviewAnnotationCheck({
        taskId: task.id,
        formId: task.formId || undefined,
        currentNode: task.currentNode,
        intent: 'submit_next',
        includedTypes: ['text', 'cloud', 'rect'],
      }),
    }),
    submitTaskToNextNode: userStore.submitTaskToNextNode,
    refreshCurrentTask: async () => {
      await userStore.loadReviewTasks();
    },
    loadWorkflow: async () => {},
    emitToast,
  });

  if (!submitted) return;

  selectedTask.value = null;
}

const showReturnDialog = ref(false);

function openReturnDialog() {
  if (!selectedTask.value || !canReturnAtCurrentNode(selectedTask.value.currentNode)) return;
  showReturnDialog.value = true;
}

async function handleReturnConfirm(targetNode: import('@/types/auth').WorkflowNode, reason: string) {
  if (!selectedTask.value) return;
  selectedTaskError.value = null;
  taskActionLoading.value = true;
  try {
    await userStore.returnTaskToNode(selectedTask.value.id, targetNode, reason);
    await userStore.loadReviewTasks();
    emitToast({ message: '已确认驳回流转' });
    selectedTask.value = null;
    showReturnDialog.value = false;
  } catch (error) {
    selectedTaskError.value = error instanceof Error ? error.message : '驳回流转失败';
  } finally {
    taskActionLoading.value = false;
  }
}

async function hydrateSelectedTask(task: ReviewTask): Promise<void> {
  const taskId = task.id?.trim();
  if (!taskId) return;

  selectedTaskLoading.value = true;
  try {
    const response = await reviewTaskGetById(taskId);
    if (!response.success || !response.task) {
      throw new Error(response.error_message || '加载任务详情失败');
    }
    if (selectedTask.value?.id === taskId) {
      selectedTask.value = response.task;
      selectedTaskError.value = null;
    }
  } catch (error) {
    if (selectedTask.value?.id === taskId) {
      selectedTaskError.value = error instanceof Error ? error.message : '加载任务详情失败';
    }
  } finally {
    if (selectedTask.value?.id === taskId) {
      selectedTaskLoading.value = false;
    }
  }
}

function handleViewTask(task: ReviewTask) {
  selectedTask.value = task;
  selectedTaskError.value = null;
  void hydrateSelectedTask(task);
}

function closeTaskDetail() {
  selectedTask.value = null;
  selectedTaskLoading.value = false;
  selectedTaskError.value = null;
  taskActionLoading.value = false;
  submitComment.value = '';
  showReturnDialog.value = false;
}

function getStartActionLabel(task: ReviewTask): string {
  return task.status === 'in_review' ? '继续审核' : '开始审核';
}

function getApproveActionLabel(task: ReviewTask): string {
  return getSubmitActionLabel(task.currentNode);
}

onMounted(() => {
  void refreshTasks();
  restoreScrollPosition();
});
</script>

<template>
  <div ref="scrollContainer"
    class="h-full overflow-auto bg-white px-5 py-5 text-gray-900"
    data-panel="reviewerTasks"
    @scroll="persistScrollPosition">
    <!-- 头部 -->
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="text-base font-semibold text-gray-900">{{ inboxPanelTitle }}</h3>
        <p class="mt-1 text-[13px] text-gray-500">共 {{ filteredTasks.length }} 条</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="hidden text-[12px] text-gray-400 sm:inline">{{ reviewStageLabel }}人：{{ currentUser?.name }}</span>
        <button class="inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 px-2 text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
          type="button"
          title="查看待办任务操作指南"
          @click="onboarding.openGuideCenter('reviewerTasks')">
          <HelpCircle class="h-4 w-4" />
          操作指南
        </button>
        <button class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-400 transition hover:bg-gray-50 hover:text-gray-600"
          type="button"
          aria-label="筛选任务">
          <Filter class="h-4 w-4" />
        </button>
      </div>
      <button class="hidden items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50"
        :disabled="isLoading"
        @click="refreshTasks">
        <RefreshCw :class="['h-4 w-4', isLoading && 'animate-spin']" />
        刷新
      </button>
    </div>

    <!-- 筛选条件 -->
    <div class="flex flex-wrap gap-3 rounded-xl bg-gray-50 p-3">
      <div class="min-w-[200px] flex-1 relative">
        <input v-model="searchTerm"
          type="text"
          placeholder="搜索任务名称或发起人..."
          class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <select v-model="statusFilter" class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        <option value="all">全部状态</option>
        <option value="submitted">{{ submittedInboxLabel }}</option>
        <option value="in_review">审核中</option>
        <option value="approved">已通过</option>
        <option value="rejected">已驳回</option>
      </select>
      <select v-model="priorityFilter" class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        <option value="all">全部优先级</option>
        <option value="urgent">紧急</option>
        <option value="high">高</option>
        <option value="medium">中</option>
        <option value="low">低</option>
      </select>
      <button v-if="hasFilters"
        class="rounded-lg px-3 py-2 text-sm text-gray-500 transition hover:bg-white hover:text-gray-700"
        @click="clearFilters">
        清除筛选
      </button>
    </div>

    <!-- 任务列表 -->
    <div class="space-y-3">
      <div v-if="isLoading" class="text-center py-8">
        <RefreshCw class="h-8 w-8 animate-spin mx-auto mb-2 text-gray-400" />
        <p class="text-sm text-gray-500">正在加载任务...</p>
      </div>

      <template v-else-if="filteredTasks.length > 0">
        <div v-for="task in filteredTasks"
          :key="task.id"
          class="cursor-pointer rounded-lg border p-4 transition-shadow hover:shadow-md"
          :class="task.status === 'in_review' ? 'border-orange-200 bg-white' : 'border-gray-200 bg-gray-50'"
          @click="handleViewTask(task)">
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-3">
              <h4 class="pr-2 text-sm font-semibold leading-5 text-gray-900">{{ task.title }}</h4>
              <span :class="['inline-flex shrink-0 items-center rounded px-2 py-1 text-xs font-medium', getPriorityBadgeClass(task)]">
                {{ getPriorityDisplayName(task.priority).label }}
              </span>
            </div>

            <div class="space-y-1.5 text-xs text-gray-500">
              <div class="flex items-center gap-1.5">
                <User class="h-3.5 w-3.5 text-gray-400" />
                <span>发起人: {{ task.requesterName }} ({{ task.requesterId || 'sj' }})</span>
              </div>
              <div class="flex items-center gap-1.5">
                <Clock class="h-3.5 w-3.5 text-gray-400" />
                <span>提交于: {{ formatRelativeSubmitTime(task.createdAt) }}</span>
              </div>
              <div v-if="task.modelName" class="text-[11px] text-gray-400">
                <span>{{ task.modelName }}</span>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-gray-200/80 pt-3">
              <div class="flex min-w-0 items-center gap-2">
                <span :class="['h-2 w-2 shrink-0 rounded-full', getStatusPresentation(task).dotClass]" />
                <span :class="['text-xs', getStatusPresentation(task).textClass]">
                  {{ getStatusPresentation(task).label }}
                </span>
              </div>

              <button v-if="task.status === 'submitted' || task.status === 'in_review'"
                type="button"
                class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition"
                :class="task.status === 'in_review'
                  ? 'border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100'
                  : 'bg-orange-500 text-white hover:bg-orange-600'"
                @click.stop="handleStartReview(task)">
                <PlayCircle v-if="task.status === 'submitted'" class="h-3.5 w-3.5" />
                <span>{{ getStartActionLabel(task) }}</span>
              </button>
              <span v-else-if="getTaskActionFeedback(task)"
                :class="['inline-flex shrink-0 items-center rounded-md px-3 py-1.5 text-[13px] font-medium', getTaskActionFeedback(task)?.className]">
                {{ getTaskActionFeedback(task)?.label }}
              </span>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
        <FileText class="h-12 w-12 mx-auto mb-4 text-gray-300" />
        <h4 class="font-medium mb-2">暂无任务</h4>
        <p class="text-sm text-gray-500 mb-4">
          {{ hasFilters ? '没有符合筛选条件的任务' : `还没有分配给您的${inboxPanelTitle.replace(/任务$/, '')}任务` }}
        </p>
        <button v-if="hasFilters"
          class="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          @click="clearFilters">
          清除筛选条件
        </button>
      </div>
    </div>

    <!-- 任务详情弹窗 -->
    <Teleport to="body">
      <div v-if="selectedTask"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click.self="closeTaskDetail">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
          <div class="p-4 border-b flex items-center justify-between">
            <h3 class="text-lg font-semibold">任务详情</h3>
            <button class="p-1 hover:bg-gray-100 rounded" @click="closeTaskDetail">
              <XCircle class="h-5 w-5 text-gray-500" />
            </button>
          </div>
          <div class="p-4 space-y-4 overflow-auto max-h-[60vh]">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-sm text-gray-500">任务名称</label>
                <p class="font-medium">{{ selectedTask.title }}</p>
              </div>
              <div>
                <label class="text-sm text-gray-500">模型名称</label>
                <p class="font-medium">{{ selectedTask.modelName }}</p>
              </div>
              <div>
                <label class="text-sm text-gray-500">发起人</label>
                <p class="font-medium">{{ selectedTask.requesterName }}</p>
              </div>
              <div>
                <label class="text-sm text-gray-500">编校审包编号</label>
                <p class="font-medium">{{ selectedTask.formId || '未绑定 formId' }}</p>
              </div>
              <div>
                <label class="text-sm text-gray-500">状态</label>
                <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', getTaskStatusDisplayName(selectedTask.status).color]">
                  {{ getTaskStatusDisplayName(selectedTask.status).label }}
                </span>
              </div>
            </div>
            <div>
              <label class="text-sm text-gray-500">描述</label>
              <p class="text-gray-700">{{ selectedTask.description }}</p>
            </div>
            <div>
              <label class="text-sm text-gray-500">包含构件 ({{ selectedTask.components.length }})</label>
              <div class="mt-2 space-y-1 max-h-32 overflow-auto">
                <div v-for="comp in selectedTask.components"
                  :key="comp.id"
                  class="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                  <FileText class="h-4 w-4 text-blue-600" />
                  <span>{{ comp.name }}</span>
                  <span class="text-gray-500">({{ comp.refNo }})</span>
                </div>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between gap-2">
                <label class="text-sm text-gray-500">附件材料 ({{ selectedTask.attachments?.length || 0 }})</label>
                <span v-if="selectedTaskLoading" class="text-xs text-gray-400">同步详情中...</span>
              </div>
              <div v-if="selectedTask.attachments?.length" class="mt-2 space-y-1 max-h-32 overflow-auto">
                <a v-for="attachment in selectedTask.attachments"
                  :key="attachment.id || attachment.url"
                  :href="attachment.url"
                  target="_blank"
                  rel="noreferrer"
                  class="flex items-center gap-2 rounded bg-gray-50 px-2 py-2 text-sm hover:bg-gray-100">
                  <Paperclip class="h-4 w-4 text-blue-600" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium text-gray-900">{{ attachment.name || '未命名附件' }}</div>
                    <div class="truncate text-xs text-gray-500">{{ attachment.mimeType || attachment.type || attachment.url }}</div>
                  </div>
                </a>
              </div>
              <p v-else class="mt-2 text-sm text-gray-500">暂无附件</p>
              <p v-if="selectedTaskError" class="mt-2 text-xs text-red-500">{{ selectedTaskError }}</p>
            </div>
          </div>
          <div class="p-4 border-t flex justify-end gap-2">
            <template v-if="selectedTask.status === 'submitted' || selectedTask.status === 'in_review'">
              <div class="flex gap-2">
                <button v-if="canReturnAtCurrentNode(selectedTask.currentNode)"
                  class="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                  :disabled="taskActionLoading"
                  @click="openReturnDialog">
                  驳回
                </button>
                <button class="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  :disabled="taskActionLoading"
                  @click="handleApprove(selectedTask)">
                  {{ taskActionLoading ? '处理中...' : getApproveActionLabel(selectedTask) }}
                </button>
              </div>
            </template>
            <button class="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50" @click="closeTaskDetail">
              关闭
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <WorkflowReturnDialog v-if="selectedTask"
      :visible="showReturnDialog"
      :current-node="selectedTask.currentNode"
      :loading="taskActionLoading"
      @update:visible="(v) => { showReturnDialog = v; }"
      @confirm="handleReturnConfirm" />
  </div>
</template>
