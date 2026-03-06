<script setup lang="ts">
import { computed, ref } from 'vue';

import { Calendar, CheckCircle, Clock, Eye, FileText, Package, RefreshCw, Search, User, XCircle } from 'lucide-vue-next';

import type { ReviewTask } from '@/types/auth';

import { useReviewStore } from '@/composables/useReviewStore';
import { useUserStore } from '@/composables/useUserStore';
import { emitCommand } from '@/ribbon/commandBus';
import { getPriorityDisplayName, getTaskStatusDisplayName } from '@/types/auth';
import { refreshReviewerTasksSafely } from './reviewerTaskListActions';

const userStore = useUserStore();
const reviewStore = useReviewStore();

const searchTerm = ref('');
const statusFilter = ref<string>('all');
const priorityFilter = ref<string>('all');
const isLoading = ref(false);
const selectedTask = ref<ReviewTask | null>(null);

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

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function handleStartReview(task: ReviewTask) {
  // 设置当前审核任务
  reviewStore.setCurrentTask(task);
  // 更新任务状态
  userStore.updateTaskStatus(task.id, 'in_review');
  selectedTask.value = task;
  
  // 先关闭任务列表面板
  emitCommand('panel.reviewerTasks');
  
  // 延迟打开审核面板，确保任务已设置
  setTimeout(() => {
    emitCommand('panel.review');
  }, 100);
}

function handleApprove(task: ReviewTask) {
  const node = task.currentNode || 'sj';
  if (node === 'jd') {
    // 校核通过 -> 进入审核节点
    userStore.submitTaskToNextNode(task.id, '校核通过');
  } else {
    // 审核通过 -> 任务结束
    userStore.updateTaskStatus(task.id, 'approved', '审核通过');
  }
  selectedTask.value = null;
}

function handleReject(task: ReviewTask) {
  const reason = (window.prompt('请输入驳回原因（必填）', '') || '').trim();
  if (!reason) return;
  // 统一规则：驳回一律回发起设计人（sj）
  userStore.returnTaskToNode(task.id, 'sj', reason);
  selectedTask.value = null;
}

function handleViewTask(task: ReviewTask) {
  selectedTask.value = task;
}

function closeTaskDetail() {
  selectedTask.value = null;
}

function getStartActionLabel(task: ReviewTask): string {
  const node = task.currentNode || 'sj';
  if (node === 'jd') {
    return task.status === 'submitted' ? '开始校核' : '继续校核';
  }
  if (node === 'sh') {
    return task.status === 'submitted' ? '开始审核' : '继续审核';
  }
  return '处理任务';
}
</script>

<template>
  <div class="p-4 space-y-4 overflow-auto h-full">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">我的{{ reviewStageLabel }}任务</h3>
        <p class="text-sm text-gray-500">{{ reviewStageLabel }}人员：{{ currentUser?.name }} | 共 {{ filteredTasks.length }} 个任务</p>
      </div>
      <button class="inline-flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
        :disabled="isLoading"
        @click="refreshTasks">
        <RefreshCw :class="['h-4 w-4', isLoading && 'animate-spin']" />
        刷新
      </button>
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
      <select v-model="statusFilter" class="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
        <option value="all">全部状态</option>
        <option value="submitted">待审核</option>
        <option value="in_review">审核中</option>
        <option value="approved">已通过</option>
        <option value="rejected">未通过</option>
      </select>
      <select v-model="priorityFilter" class="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
        <option value="all">全部优先级</option>
        <option value="urgent">紧急</option>
        <option value="high">高</option>
        <option value="medium">中</option>
        <option value="low">低</option>
      </select>
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
          class="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
          @click="handleViewTask(task)">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
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
                  <span>发起人: {{ task.requesterName }}</span>
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
            </div>
            <div class="flex flex-col gap-2 ml-4">
              <button v-if="task.status === 'submitted' || task.status === 'in_review'"
                class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                @click.stop="handleStartReview(task)">
                {{ getStartActionLabel(task) }}
              </button>
              <button class="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50" @click.stop="handleViewTask(task)">
                查看详情
              </button>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="bg-white border rounded-lg p-8 text-center">
        <FileText class="h-12 w-12 mx-auto mb-4 text-gray-300" />
        <h4 class="font-medium mb-2">暂无审核任务</h4>
        <p class="text-sm text-gray-500 mb-4">
          {{ searchTerm || statusFilter !== 'all' || priorityFilter !== 'all' ? '没有符合筛选条件的任务' : '还没有分配给您的审核任务' }}
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
              <button class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
                @click="handleReject(selectedTask)">
                驳回
              </button>
              <button class="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                @click="handleApprove(selectedTask)">
                通过
              </button>
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
