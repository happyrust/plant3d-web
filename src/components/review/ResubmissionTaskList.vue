<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import {
  Calendar,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  User,
  XCircle,
} from 'lucide-vue-next';

import type { ReviewTask } from '@/types/auth';

import { useUserStore } from '@/composables/useUserStore';
import { reviewTaskGetHistory, type ReviewHistoryItem } from '@/api/reviewApi';
import { getPriorityDisplayName, getTaskStatusDisplayName } from '@/types/auth';
import TaskReviewDetail from './TaskReviewDetail.vue';

const userStore = useUserStore();

const searchTerm = ref('');
const priorityFilter = ref<string>('all');
const isLoading = ref(false);
const selectedTask = ref<ReviewTask | null>(null);
const taskHistories = ref<Map<string, ReviewHistoryItem[]>>(new Map());

// 当前用户的待审核任务
const tasks = computed(() => userStore.pendingReviewTasks.value);

// 判断任务是否为复审任务
function isResubmissionTask(taskId: string): boolean {
  const history = taskHistories.value.get(taskId);
  if (!history) return false;
  
  // 检查历史中是否有 rejected 记录
  return history.some(h => h.action === 'rejected');
}

// 计算提交次数
function getSubmissionCount(taskId: string): number {
  const history = taskHistories.value.get(taskId);
  if (!history) return 1;
  
  // 统计 submitted 的次数
  return history.filter(h => h.action === 'submitted').length;
}

// 获取最近驳回时间
function getLastRejectionTime(taskId: string): number | null {
  const history = taskHistories.value.get(taskId);
  if (!history) return null;
  
  const rejections = history.filter(h => h.action === 'rejected');
  if (rejections.length === 0) return null;
  
  // 返回最新的驳回时间
  return Math.max(...rejections.map(r => r.timestamp));
}

// 筛选出复审任务
const resubmissionTasks = computed(() => {
  return tasks.value.filter(task => isResubmissionTask(task.id));
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
    const aTime = getLastRejectionTime(a.id) || 0;
    const bTime = getLastRejectionTime(b.id) || 0;
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

async function loadTaskHistories() {
  isLoading.value = true;
  try {
    const promises = tasks.value.map(async (task) => {
      try {
        const response = await reviewTaskGetHistory(task.id);
        if (response.success) {
          taskHistories.value.set(task.id, response.history);
        }
      } catch (e) {
        console.error(`Failed to load history for task ${task.id}:`, e);
      }
    });
    await Promise.all(promises);
  } finally {
    isLoading.value = false;
  }
}

async function refreshTasks() {
  await userStore.loadReviewTasks();
  await loadTaskHistories();
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

function handleStartReview(task: ReviewTask) {
  // 与 ReviewerTaskList 相同的逻辑
  userStore.updateTaskStatus(task.id, 'in_review');
  handleViewTask(task);
}

onMounted(() => {
  loadTaskHistories();
});
</script>

<template>
  <div class="p-4 space-y-4 overflow-auto h-full">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold flex items-center gap-2">
          <RotateCcw class="h-5 w-5 text-orange-500" />
          复审任务
        </h3>
        <p class="text-sm text-gray-500">审核人员：{{ currentUser?.name }} | 共 {{ filteredTasks.length }} 个待复审任务</p>
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
        <div class="text-xs text-orange-600">复审任务</div>
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
          placeholder="搜索任务名称、描述或模型..."
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
          class="bg-white border-2 border-orange-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
          @click="handleViewTask(task)">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <RotateCcw class="h-5 w-5 text-orange-500" />
                <h4 class="font-medium text-base">{{ task.title }}</h4>
                <!-- 提交次数徽章 -->
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                  第{{ getSubmissionCount(task.id) }}次提交
                </span>
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
                  <span>发起人: {{ task.requesterName }}</span>
                </div>
                <div v-if="getLastRejectionTime(task.id)" class="flex items-center gap-1">
                  <XCircle class="h-3 w-3 text-red-500" />
                  <span class="text-red-600">驳回于: {{ formatDateTime(getLastRejectionTime(task.id)!) }}</span>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-2 ml-4">
              <button v-if="task.status === 'submitted'"
                class="px-3 py-1.5 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                @click.stop="handleStartReview(task)">
                开始复审
              </button>
              <button v-else-if="task.status === 'in_review'"
                class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                @click.stop="handleStartReview(task)">
                继续复审
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
        <h4 class="font-medium mb-2">暂无复审任务</h4>
        <p class="text-sm text-gray-500 mb-4">
          {{ searchTerm || priorityFilter !== 'all' ? '没有符合筛选条件的复审任务' : '当前没有需要复审的任务' }}
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
      <TaskReviewDetail
        v-if="selectedTask"
        :task="selectedTask"
        @close="closeTaskDetail"
      />
    </Teleport>
  </div>
</template>
