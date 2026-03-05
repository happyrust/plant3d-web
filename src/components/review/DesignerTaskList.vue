<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  Calendar,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  Filter,
  Package,
  RefreshCw,
  Search,
  User,
  XCircle,
} from 'lucide-vue-next';

import type { ReviewTask } from '@/types/auth';

import { useUserStore } from '@/composables/useUserStore';
import { getPriorityDisplayName, getTaskStatusDisplayName } from '@/types/auth';
import TaskReviewDetail from './TaskReviewDetail.vue';

const userStore = useUserStore();

const searchTerm = ref('');
const statusFilter = ref<string>('all');
const priorityFilter = ref<string>('all');
const isLoading = ref(false);
const selectedTask = ref<ReviewTask | null>(null);
const submittingTaskId = ref<string | null>(null);

// 当前用户发起的任务
const tasks = computed(() => userStore.myInitiatedTasks.value);

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

  // 按更新时间倒序排列
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
});

const currentUser = computed(() => userStore.currentUser.value);

// 统计数据
const taskStats = computed(() => {
  const all = tasks.value;
  return {
    total: all.length,
    approved: all.filter((t) => t.status === 'approved').length,
    rejected: all.filter((t) => t.status === 'rejected').length,
    pending: all.filter((t) => t.status === 'submitted' || t.status === 'in_review').length,
  };
});

function refreshTasks() {
  isLoading.value = true;
  userStore.loadReviewTasks().finally(() => {
    isLoading.value = false;
  });
}

function clearFilters() {
  searchTerm.value = '';
  statusFilter.value = 'all';
  priorityFilter.value = 'all';
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function handleViewTask(task: ReviewTask) {
  selectedTask.value = task;
}

async function handleSubmitToNext(task: ReviewTask) {
  if (submittingTaskId.value) return;
  submittingTaskId.value = task.id;
  try {
    await userStore.submitTaskToNextNode(task.id, '提交到下一节点');
    await userStore.loadReviewTasks();
  } finally {
    submittingTaskId.value = null;
  }
}

function closeTaskDetail() {
  selectedTask.value = null;
}

function getStatusIcon(status: ReviewTask['status']) {
  switch (status) {
    case 'approved':
      return CheckCircle;
    case 'rejected':
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
      return 'text-red-500';
    default:
      return 'text-blue-500';
  }
}
</script>

<template>
  <div class="p-4 space-y-4 overflow-auto h-full">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">我的提资单</h3>
        <p class="text-sm text-gray-500">设计人员：{{ currentUser?.name }} | 共 {{ filteredTasks.length }} 个任务</p>
      </div>
      <button class="inline-flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
        :disabled="isLoading"
        @click="refreshTasks">
        <RefreshCw :class="['h-4 w-4', isLoading && 'animate-spin']" />
        刷新
      </button>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-4 gap-3">
      <div class="p-3 rounded-lg bg-gray-50 border cursor-pointer hover:bg-gray-100"
        :class="{ 'ring-2 ring-blue-500': statusFilter === 'all' }"
        @click="statusFilter = 'all'">
        <div class="text-2xl font-bold">{{ taskStats.total }}</div>
        <div class="text-xs text-gray-500">全部</div>
      </div>
      <div class="p-3 rounded-lg bg-yellow-50 border cursor-pointer hover:bg-yellow-100"
        :class="{ 'ring-2 ring-yellow-500': statusFilter === 'submitted' }"
        @click="statusFilter = statusFilter === 'submitted' ? 'all' : 'submitted'">
        <div class="text-2xl font-bold text-yellow-600">{{ taskStats.pending }}</div>
        <div class="text-xs text-yellow-600">待审核</div>
      </div>
      <div class="p-3 rounded-lg bg-green-50 border cursor-pointer hover:bg-green-100"
        :class="{ 'ring-2 ring-green-500': statusFilter === 'approved' }"
        @click="statusFilter = statusFilter === 'approved' ? 'all' : 'approved'">
        <div class="text-2xl font-bold text-green-600">{{ taskStats.approved }}</div>
        <div class="text-xs text-green-600">已通过</div>
      </div>
      <div class="p-3 rounded-lg bg-red-50 border cursor-pointer hover:bg-red-100"
        :class="{ 'ring-2 ring-red-500': statusFilter === 'rejected' }"
        @click="statusFilter = statusFilter === 'rejected' ? 'all' : 'rejected'">
        <div class="text-2xl font-bold text-red-600">{{ taskStats.rejected }}</div>
        <div class="text-xs text-red-600">已驳回</div>
      </div>
    </div>

    <!-- 筛选条件 -->
    <div class="flex flex-wrap gap-3 p-3 bg-gray-50 rounded-lg">
      <div class="flex-1 min-w-[200px] relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input v-model="searchTerm"
          type="text"
          placeholder="搜索任务名称、描述或模型..."
          class="w-full pl-10 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <select v-model="priorityFilter" class="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
        <option value="all">全部优先级</option>
        <option value="urgent">紧急</option>
        <option value="high">高</option>
        <option value="medium">中</option>
        <option value="low">低</option>
      </select>
      <button v-if="searchTerm || statusFilter !== 'all' || priorityFilter !== 'all'"
        class="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
        @click="clearFilters">
        <Filter class="h-4 w-4 inline mr-1" />
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
          class="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
          @click="handleViewTask(task)">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <component :is="getStatusIcon(task.status)" 
                  :class="['h-5 w-5', getStatusIconClass(task.status)]" />
                <h4 class="font-medium text-base">{{ task.title }}</h4>
                <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', getTaskStatusDisplayName(task.status).color]">
                  {{ getTaskStatusDisplayName(task.status).label }}
                </span>
                <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', getPriorityDisplayName(task.priority).color]">
                  {{ getPriorityDisplayName(task.priority).label }}
                </span>
              </div>
              <p class="text-sm text-gray-600 mb-3 line-clamp-2">{{ task.description }}</p>
              <div class="flex items-center gap-4 text-xs text-gray-500">
                <div class="flex items-center gap-1">
                  <Package class="h-3 w-3" />
                  <span>{{ task.modelName }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <User class="h-3 w-3" />
                  <span>校核: {{ task.checkerName || task.reviewerName || '-' }} / 审核: {{ task.approverName || '-' }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <Calendar class="h-3 w-3" />
                  <span>创建: {{ formatDate(task.createdAt) }}</span>
                </div>
                <div v-if="task.dueDate" class="flex items-center gap-1">
                  <Clock class="h-3 w-3" />
                  <span>截止: {{ formatDate(task.dueDate) }}</span>
                </div>
              </div>
              <!-- 审核意见预览 -->
              <div v-if="task.reviewComment" class="mt-2 p-2 bg-gray-50 rounded text-sm">
                <span class="text-gray-500">审核意见: </span>
                <span class="text-gray-700">{{ task.reviewComment }}</span>
              </div>
            </div>
            <div class="flex flex-col gap-2 ml-4">
              <button
                v-if="task.status === 'draft'"
                class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                :disabled="!!submittingTaskId"
                @click.stop="handleSubmitToNext(task)"
              >
                提交
              </button>
              <button class="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 flex items-center gap-1" 
                @click.stop="handleViewTask(task)">
                <Eye class="h-4 w-4" />
                查看详情
              </button>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="bg-white border rounded-lg p-8 text-center">
        <FileText class="h-12 w-12 mx-auto mb-4 text-gray-300" />
        <h4 class="font-medium mb-2">暂无提资单</h4>
        <p class="text-sm text-gray-500 mb-4">
          {{ searchTerm || statusFilter !== 'all' || priorityFilter !== 'all' ? '没有符合筛选条件的任务' : '您还没有发起过提资单' }}
        </p>
        <button v-if="searchTerm || statusFilter !== 'all' || priorityFilter !== 'all'"
          class="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          @click="clearFilters">
          清除筛选条件
        </button>
      </div>
    </div>

    <!-- 任务详情弹窗 -->
    <Teleport to="body">
      <TaskReviewDetail
        v-if="selectedTask"
        :task="selectedTask"
        @close="closeTaskDetail"
      />
    </Teleport>
  </div>
</template>
