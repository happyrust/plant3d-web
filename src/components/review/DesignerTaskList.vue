<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import {
  Calendar,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  Funnel,
  Package,
  RefreshCw,
  User,
  XCircle,
} from 'lucide-vue-next';

import { getDesignerTaskStatusBucket, isDesignerResubmissionTask } from './reviewTaskFilters';
import TaskReviewDetail from './TaskReviewDetail.vue';

import type { ReviewTask } from '@/types/auth';

import { useUserStore } from '@/composables/useUserStore';
import { getPriorityDisplayName, getTaskStatusDisplayName } from '@/types/auth';

const userStore = useUserStore();

const statusFilter = ref<DesignerTaskStatusFilter>('all');
const isLoading = ref(false);
const selectedTask = ref<ReviewTask | null>(null);

type DesignerTaskStatusFilter = 'all' | 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected';

type StatusFilterOption = {
  value: DesignerTaskStatusFilter;
  label: string;
  badgeClass: string;
  activeClass: string;
};

const statusFilterOptions: StatusFilterOption[] = [
  {
    value: 'all',
    label: '全部',
    badgeClass: 'bg-slate-100 text-slate-700',
    activeClass: 'border-slate-300 bg-slate-900 text-white',
  },
  {
    value: 'draft',
    label: '草稿',
    badgeClass: 'bg-slate-100 text-slate-600',
    activeClass: 'border-slate-400 bg-slate-700 text-white',
  },
  {
    value: 'submitted',
    label: '待审核',
    badgeClass: 'bg-amber-100 text-amber-700',
    activeClass: 'border-amber-300 bg-amber-500 text-white',
  },
  {
    value: 'in_review',
    label: '审核中',
    badgeClass: 'bg-sky-100 text-sky-700',
    activeClass: 'border-sky-300 bg-sky-500 text-white',
  },
  {
    value: 'approved',
    label: '已通过',
    badgeClass: 'bg-emerald-100 text-emerald-700',
    activeClass: 'border-emerald-300 bg-emerald-500 text-white',
  },
  {
    value: 'rejected',
    label: '已驳回',
    badgeClass: 'bg-rose-100 text-rose-700',
    activeClass: 'border-rose-300 bg-rose-500 text-white',
  },
];

// 当前用户发起的任务
const tasks = computed(() => userStore.myInitiatedTasks.value);

const sortedTasks = computed(() => [...tasks.value].sort((a, b) => b.updatedAt - a.updatedAt));

const filteredTasks = computed(() => {
  if (statusFilter.value === 'all') return sortedTasks.value;
  return sortedTasks.value.filter((task) => task.status === statusFilter.value);
});

const taskCountByStatus = computed<Record<DesignerTaskStatusFilter, number>>(() => ({
  all: tasks.value.length,
  draft: tasks.value.filter((task) => task.status === 'draft').length,
  submitted: tasks.value.filter((task) => task.status === 'submitted').length,
  in_review: tasks.value.filter((task) => task.status === 'in_review').length,
  approved: tasks.value.filter((task) => task.status === 'approved').length,
  rejected: tasks.value.filter((task) => task.status === 'rejected').length,
}));

const currentUser = computed(() => userStore.currentUser.value);

const activeFilterLabel = computed(
  () => statusFilterOptions.find((option) => option.value === statusFilter.value)?.label ?? '全部'
);

function refreshTasks() {
  isLoading.value = true;
  userStore.loadReviewTasks().finally(() => {
    isLoading.value = false;
  });
}

function clearFilters() {
  statusFilter.value = 'all';
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function handleViewTask(task: ReviewTask) {
  selectedTask.value = task;
}

async function handleSubmitToNext(task: ReviewTask) {
  void task;
}

function closeTaskDetail() {
  selectedTask.value = null;
}

function getStatusIcon(status: ReviewTask['status']) {
  switch (status) {
    case 'approved':
      return CheckCircle;
    case 'draft':
      return XCircle;
    default:
      return Clock;
  }
}

function getStatusIconClass(status: ReviewTask['status']) {
  switch (status) {
    case 'approved':
      return 'text-green-500';
    case 'rejected':
      return 'text-rose-500';
    case 'draft':
      return 'text-slate-500';
    case 'submitted':
      return 'text-amber-500';
    default:
      return 'text-sky-500';
  }
}

function getCurrentNodeLabel(node?: ReviewTask['currentNode']): string {
  if (node === 'sj') return '编制';
  if (node === 'jd') return '校核';
  if (node === 'sh') return '审核';
  if (node === 'pz') return '批准';
  return '-';
}

function getTaskCardClass(task: ReviewTask): string {
  if (task.status === 'approved') return 'border-emerald-200 bg-emerald-50/40';
  if (task.status === 'rejected') return 'border-rose-200 bg-rose-50/60';
  if (task.status === 'in_review') return 'border-sky-200 bg-sky-50/40';
  if (task.status === 'submitted') return 'border-amber-200 bg-amber-50/50';
  return 'border-slate-200 bg-white';
}

onMounted(() => {
  refreshTasks();
});
</script>

<template>
  <div class="flex h-full flex-col overflow-auto bg-[#F6F7FB] p-4 text-slate-900">
    <div class="rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur">
      <div class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Designer Tasks</p>
          <h3 class="mt-2 text-xl font-semibold text-slate-900">我发起的任务</h3>
          <p class="mt-1 text-sm text-slate-500">
            发起人：{{ currentUser?.name || '未登录' }} · 当前筛选 {{ activeFilterLabel }} · 共 {{ filteredTasks.length }} 条
          </p>
        </div>
        <button class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
        :disabled="isLoading"
        @click="refreshTasks">
        <RefreshCw :class="['h-4 w-4', isLoading && 'animate-spin']" />
        刷新
      </button>
    </div>

      <div class="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          <Funnel class="h-4 w-4" />
          状态筛选
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button v-for="option in statusFilterOptions"
            :key="option.value"
            type="button"
            class="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition"
            :class="statusFilter === option.value
              ? option.activeClass
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'"
            @click="statusFilter = option.value">
            <span>{{ option.label }}</span>
            <span class="rounded-full px-2 py-0.5 text-xs" :class="statusFilter === option.value ? 'bg-white/20 text-current' : option.badgeClass">
              {{ taskCountByStatus[option.value] }}
            </span>
          </button>
          <button v-if="statusFilter !== 'all'"
            type="button"
            class="inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-2 text-sm text-slate-500 transition hover:border-slate-200 hover:bg-white hover:text-slate-700"
            @click="clearFilters">
            清除筛选
          </button>
        </div>
      </div>

      <div class="mt-5 space-y-3">
      <div v-if="isLoading" class="text-center py-8">
        <RefreshCw class="h-8 w-8 animate-spin mx-auto mb-2 text-gray-400" />
        <p class="text-sm text-gray-500">正在加载任务...</p>
      </div>

      <template v-else-if="filteredTasks.length > 0">
        <div v-for="task in filteredTasks"
          :key="task.id"
          class="cursor-pointer rounded-2xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg"
          :class="getTaskCardClass(task)"
          @click="handleViewTask(task)">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <component :is="getStatusIcon(task.status)" 
                  :class="['h-5 w-5', getStatusIconClass(task.status)]" />
                <h4 class="text-base font-semibold text-slate-900">{{ task.title }}</h4>
                <span :class="['inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', getTaskStatusDisplayName(task.status).color]">
                  {{ getTaskStatusDisplayName(task.status).label }}
                </span>
                <span :class="['inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', getPriorityDisplayName(task.priority).color]">
                  {{ getPriorityDisplayName(task.priority).label }}
                </span>
                <span v-if="isDesignerResubmissionTask(task)" class="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700">
                  已退回
                </span>
              </div>
              <p class="mb-3 text-sm text-slate-600 line-clamp-2">{{ task.description || '暂无描述' }}</p>
              <div class="grid gap-2 text-xs text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
                <div class="flex items-center gap-1">
                  <Package class="h-3 w-3" />
                  <span>{{ task.modelName }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <User class="h-3 w-3" />
                  <span>审核人 {{ task.checkerName || task.reviewerName || task.approverName || '-' }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <Clock class="h-3 w-3" />
                  <span>当前节点 {{ getCurrentNodeLabel(task.currentNode) }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <Calendar class="h-3 w-3" />
                  <span>创建: {{ formatDate(task.createdAt) }}</span>
                </div>
              </div>
              <div v-if="task.returnReason || task.reviewComment" class="mt-3 rounded-xl bg-white/80 p-3 text-sm shadow-sm ring-1 ring-slate-100">
                <span class="text-slate-400">{{ task.returnReason ? '退回原因' : '审核意见' }}：</span>
                <span class="text-slate-700">{{ task.returnReason || task.reviewComment }}</span>
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <button class="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50" 
                @click.stop="handleViewTask(task)">
                <Eye class="h-4 w-4" />
                查看详情
              </button>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
        <FileText class="mx-auto mb-4 h-12 w-12 text-slate-300" />
        <h4 class="mb-2 font-medium text-slate-900">暂无提资任务</h4>
        <p class="mb-4 text-sm text-slate-500">
          {{ statusFilter !== 'all' ? '当前筛选条件下没有任务' : '您还没有发起过提资单' }}
        </p>
        <button v-if="statusFilter !== 'all'"
          class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
          @click="clearFilters">
          清除筛选条件
        </button>
      </div>
    </div>
    </div>

    <!-- 任务详情弹窗 -->
    <Teleport to="body">
      <TaskReviewDetail v-if="selectedTask"
        :task="selectedTask"
        @close="closeTaskDetail" />
    </Teleport>
  </div>
</template>
