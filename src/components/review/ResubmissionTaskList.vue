<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import {
  Calendar,
  Eye,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle,
} from 'lucide-vue-next';

import {
  getResubmissionLatestReturnTime,
  getResubmissionSubmissionCount,
  isRejectedDesignerTask,
} from './reviewTaskFilters';
import TaskReviewDetail from './TaskReviewDetail.vue';

import type { ReviewTask } from '@/types/auth';

import { useUserStore } from '@/composables/useUserStore';
import { getPriorityDisplayName } from '@/types/auth';

const userStore = useUserStore();

const searchTerm = ref('');
const priorityFilter = ref<string>('all');
const isLoading = ref(false);
const selectedTask = ref<ReviewTask | null>(null);

// 当前用户发起且被退回的任务
const tasks = computed(() => userStore.myInitiatedTasks.value);

// 筛选出已驳回任务
const resubmissionTasks = computed(() => {
  return tasks.value.filter((task) => isRejectedDesignerTask(task));
});

const filteredTasks = computed(() => {
  let result = [...resubmissionTasks.value];

  if (searchTerm.value.trim()) {
    const term = searchTerm.value.toLowerCase();
    result = result.filter(
      (t) =>
        t.title.toLowerCase().includes(term) ||
        t.description.toLowerCase().includes(term) ||
        t.modelName.toLowerCase().includes(term)
    );
  }

  if (priorityFilter.value !== 'all') {
    result = result.filter((t) => t.priority === priorityFilter.value);
  }

  // 按最近驳回时间倒序排列
  return result.sort((a, b) => {
    const aTime = getResubmissionLatestReturnTime(a.workflowHistory || []) || 0;
    const bTime = getResubmissionLatestReturnTime(b.workflowHistory || []) || 0;
    return bTime - aTime;
  });
});

const currentUser = computed(() => userStore.currentUser.value);

// 统计数据
const taskStats = computed(() => {
  const all = resubmissionTasks.value;
  return {
    total: all.length,
    urgent: all.filter((t) => t.priority === 'urgent').length,
    high: all.filter((t) => t.priority === 'high').length,
  };
});

async function refreshTasks() {
  isLoading.value = true;
  try {
    await userStore.loadReviewTasks();
  } finally {
    isLoading.value = false;
  }
}

function clearFilters() {
  searchTerm.value = '';
  priorityFilter.value = 'all';
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function handleViewTask(task: ReviewTask) {
  selectedTask.value = task;
}

function closeTaskDetail() {
  selectedTask.value = null;
}

function handleResumeEditing(task: ReviewTask) {
  handleViewTask(task);
}

function getRejectedTaskCardClass(task: ReviewTask): string {
  if (task.priority === 'urgent') return 'border-red-300 bg-red-50/70';
  return 'border-rose-200 bg-rose-50/60';
}

onMounted(() => {
  refreshTasks();
});
</script>

<template>
  <div class="p-4 space-y-4 overflow-auto h-full">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold flex items-center gap-2">
          <XCircle class="h-5 w-5 text-rose-500" />
          退回任务
        </h3>
        <p class="text-sm text-gray-500">设计人员：{{ currentUser?.name }} | 共 {{ filteredTasks.length }} 个已驳回任务</p>
      </div>
      <button class="inline-flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
        :disabled="isLoading"
        @click="refreshTasks">
        <RefreshCw :class="['h-4 w-4', isLoading && 'animate-spin']" />
        刷新
      </button>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-3 gap-3">
      <div class="p-3 rounded-lg bg-orange-50 border border-orange-200">
        <div class="text-2xl font-bold text-orange-600">{{ taskStats.total }}</div>
        <div class="text-xs text-orange-600">已驳回任务</div>
      </div>
      <div class="p-3 rounded-lg bg-red-50 border border-red-200">
        <div class="text-2xl font-bold text-red-600">{{ taskStats.urgent }}</div>
        <div class="text-xs text-red-600">紧急</div>
      </div>
      <div class="p-3 rounded-lg bg-orange-50 border border-orange-200">
        <div class="text-2xl font-bold text-orange-600">{{ taskStats.high }}</div>
        <div class="text-xs text-orange-600">高优先级</div>
      </div>
    </div>

    <!-- 筛选条件 -->
    <div class="flex flex-wrap gap-3 p-3 bg-gray-50 rounded-lg">
      <div class="flex-1 min-w-[200px] relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input v-model="searchTerm"
          type="text"
          placeholder="搜索退回任务名称、描述或模型..."
          class="w-full pl-10 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
      </div>
      <select v-model="priorityFilter" class="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
        <option value="all">全部优先级</option>
        <option value="urgent">紧急</option>
        <option value="high">高</option>
        <option value="medium">中</option>
        <option value="low">低</option>
      </select>
      <button v-if="searchTerm || priorityFilter !== 'all'"
        class="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
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
          class="border-2 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
          :class="getRejectedTaskCardClass(task)"
          @click="handleViewTask(task)">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <XCircle class="h-5 w-5 text-rose-500" />
                <h4 class="font-medium text-base">{{ task.title }}</h4>
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">
                  已驳回
                </span>
                <span v-if="getResubmissionSubmissionCount(task.workflowHistory || []) > 0" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                  第{{ getResubmissionSubmissionCount(task.workflowHistory || []) }}次提交
                </span>
                <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', getPriorityDisplayName(task.priority).color]">
                  {{ getPriorityDisplayName(task.priority).label }}
                </span>
              </div>
              <p class="text-sm text-gray-600 mb-3 line-clamp-2">{{ task.description || '暂无描述' }}</p>
              <div class="flex items-center gap-4 text-xs text-gray-500">
                <div class="flex items-center gap-1">
                  <Package class="h-3 w-3" />
                  <span>{{ task.modelName }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <span>退回原因: {{ task.returnReason || '未填写' }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <Calendar class="h-3 w-3" />
                  <span>创建于: {{ formatDate(task.createdAt) }}</span>
                </div>
                <div v-if="getResubmissionLatestReturnTime(task.workflowHistory || [])" class="flex items-center gap-1">
                  <span class="text-red-600">退回于: {{ formatDateTime(getResubmissionLatestReturnTime(task.workflowHistory || [])!) }}</span>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-2 ml-4">
              <button class="px-3 py-1.5 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                @click.stop="handleResumeEditing(task)">
                继续修改
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
        <RotateCcw class="h-12 w-12 mx-auto mb-4 text-gray-300" />
        <h4 class="font-medium mb-2">暂无退回任务</h4>
        <p class="text-sm text-gray-500 mb-4">
          {{ searchTerm || priorityFilter !== 'all' ? '没有符合筛选条件的退回任务' : '当前没有状态为已驳回的任务' }}
        </p>
        <button v-if="searchTerm || priorityFilter !== 'all'"
          class="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          @click="clearFilters">
          清除筛选条件
        </button>
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
