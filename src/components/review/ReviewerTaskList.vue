<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';

import { Clock, FileText, Filter, PlayCircle, RefreshCw, User, XCircle } from 'lucide-vue-next';

import { refreshReviewerTasksSafely, startReviewerTask } from './reviewerTaskListActions';
import { getSubmitActionLabel } from './reviewPanelActions';

import type { ReviewTask } from '@/types/auth';

import { useNavigationStatePersistence } from '@/composables/useNavigationStatePersistence';
import { useReviewStore } from '@/composables/useReviewStore';
import { useUserStore } from '@/composables/useUserStore';
import { emitCommand } from '@/ribbon/commandBus';
import { getPriorityDisplayName, getTaskStatusDisplayName } from '@/types/auth';

const userStore = useUserStore();
const reviewStore = useReviewStore();
const navigationState = useNavigationStatePersistence('plant3d-web-nav-state-reviewer-tasks-v1');

const searchTerm = ref('');
const statusFilter = ref<string>('all');
const priorityFilter = ref<string>('all');
const isLoading = ref(false);
const selectedTask = ref<ReviewTask | null>(null);
const showRejectForm = ref(false);
const rejectReason = ref('');
const scrollContainer = ref<HTMLElement | null>(null);

navigationState.bindRef('searchTerm', searchTerm, '');
navigationState.bindRef('statusFilter', statusFilter, 'all');
navigationState.bindRef('priorityFilter', priorityFilter, 'all');

const tasks = computed(() => userStore.pendingReviewTasks.value);
const reviewStageLabel = computed(() => {
  if (userStore.isChecker.value) return '校核';
  if (userStore.isApprover.value) return '审核';
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
      label: status.label,
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
    onTaskSelected: (currentTask) => {
      selectedTask.value = currentTask;
    },
  });
}

async function handleApprove(task: ReviewTask) {
  await userStore.submitTaskToNextNode(task.id, getSubmitActionLabel(task.currentNode));
  await userStore.loadReviewTasks();
  selectedTask.value = null;
}

async function handleReject(task: ReviewTask) {
  if (!rejectReason.value.trim()) return;
  // 统一规则：驳回一律回发起设计人（sj）
  await userStore.returnTaskToNode(task.id, 'sj', rejectReason.value.trim());
  await userStore.loadReviewTasks();
  selectedTask.value = null;
  showRejectForm.value = false;
  rejectReason.value = '';
}

function handleViewTask(task: ReviewTask) {
  selectedTask.value = task;
}

function closeTaskDetail() {
  selectedTask.value = null;
  showRejectForm.value = false;
  rejectReason.value = '';
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
    @scroll="persistScrollPosition">
    <!-- 头部 -->
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="text-base font-semibold text-gray-900">待处理提资任务</h3>
        <p class="mt-1 text-[13px] text-gray-500">共 {{ filteredTasks.length }} 条</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="hidden text-[12px] text-gray-400 sm:inline">{{ reviewStageLabel }}人：{{ currentUser?.name }}</span>
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
        <option value="submitted">待审核</option>
        <option value="in_review">审核中</option>
        <option value="approved">已通过</option>
        <option value="rejected">未通过</option>
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
        <p class="text-sm text-gray-500">正在加载审核任务...</p>
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
        <h4 class="font-medium mb-2">暂无审核任务</h4>
        <p class="text-sm text-gray-500 mb-4">
          {{ hasFilters ? '没有符合筛选条件的任务' : '还没有分配给您的审核任务' }}
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
          </div>
          <div class="p-4 border-t flex justify-end gap-2">
            <template v-if="selectedTask.status === 'submitted' || selectedTask.status === 'in_review'">
              <div v-if="!showRejectForm" class="flex gap-2">
                <button class="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                  @click="showRejectForm = true">
                  驳回
                </button>
                <button class="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                  @click="handleApprove(selectedTask)">
                  {{ getApproveActionLabel(selectedTask) }}
                </button>
              </div>
              <div v-else class="w-full space-y-2">
                <label class="text-sm text-gray-600">驳回原因（必填）</label>
                <textarea v-model="rejectReason"
                  class="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
                  rows="2"
                  placeholder="请输入驳回原因..." />
                <div class="flex gap-2">
                  <button class="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                    :disabled="!rejectReason.trim()"
                    @click="handleReject(selectedTask)">
                    确认驳回
                  </button>
                  <button class="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
                    @click="showRejectForm = false; rejectReason = ''">
                    取消
                  </button>
                </div>
              </div>
            </template>
            <button class="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50" @click="closeTaskDetail">
              关闭
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
