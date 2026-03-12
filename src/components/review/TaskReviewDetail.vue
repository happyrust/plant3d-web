<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  Calendar,
  CheckCircle,
  Clock,
  FileText,
  History,
  MessageSquare,
  Package,
  Paperclip,
  User,
  X,
  XCircle,
} from 'lucide-vue-next';

import { mapWorkflowHistoryToTaskDetailItems, type TaskDetailHistoryItem } from './reviewPanelActions';

import type { ReviewTask, AnnotationComment } from '@/types/auth';

import {
  reviewTaskGetWorkflow,
  reviewCommentGetByAnnotation,
} from '@/api/reviewApi';
import { getRoleDisplayName, getPriorityDisplayName, getTaskStatusDisplayName, UserRole } from '@/types/auth';

const props = defineProps<{
  task: ReviewTask;
}>();

const emit = defineEmits<(e: 'close') => void>();

const activeTab = ref<'info' | 'history' | 'comments'>('info');
const isLoading = ref(false);
const history = ref<TaskDetailHistoryItem[]>([]);
const comments = ref<AnnotationComment[]>([]);

// 加载审核历史
async function loadHistory() {
  isLoading.value = true;
  try {
    const response = await reviewTaskGetWorkflow(props.task.id);
    if (response.success) {
      history.value = mapWorkflowHistoryToTaskDetailItems(response.history);
    }
  } catch (e) {
    console.error('[TaskReviewDetail] Failed to load history:', e);
  } finally {
    isLoading.value = false;
  }
}

// 按角色分组的评论
const commentsByRole = computed(() => {
  const grouped = {
    designer: [] as AnnotationComment[],
    proofreader: [] as AnnotationComment[],
    reviewer: [] as AnnotationComment[],
  };

  for (const comment of comments.value) {
    if (comment.authorRole === UserRole.DESIGNER) {
      grouped.designer.push(comment);
    } else if (comment.authorRole === UserRole.PROOFREADER) {
      grouped.proofreader.push(comment);
    } else {
      // REVIEWER, MANAGER, ADMIN 都归入 reviewer 分栏
      grouped.reviewer.push(comment);
    }
  }

  return grouped;
});

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function getHistoryActionLabel(action: string): string {
  const labels: Record<string, string> = {
    submit: '提交流转',
    return: '驳回到设计',
    approve: '最终批准',
    created: '创建任务',
    submitted: '提交审核',
    in_review: '开始审核',
    approved: '审核通过',
    rejected: '审核驳回',
    cancelled: '取消任务',
  };
  return labels[action] || action;
}

function getHistoryActionColor(action: string): string {
  const colors: Record<string, string> = {
    submit: 'bg-blue-100 text-blue-700',
    return: 'bg-red-100 text-red-700',
    approve: 'bg-green-100 text-green-700',
    created: 'bg-gray-100 text-gray-700',
    submitted: 'bg-yellow-100 text-yellow-700',
    in_review: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-500',
  };
  return colors[action] || 'bg-gray-100 text-gray-700';
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

// 监听 tab 切换加载数据
watch(activeTab, (newTab) => {
  if (newTab === 'history' && history.value.length === 0) {
    loadHistory();
  }
});

onMounted(() => {
  // 默认加载历史
  loadHistory();
});
</script>

<template>
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="emit('close')">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
      <!-- 头部 -->
      <div class="p-4 border-b flex items-center justify-between bg-gray-50">
        <div class="flex items-center gap-3">
          <component :is="getStatusIcon(task.status)" 
            :class="['h-6 w-6', getStatusIconClass(task.status)]" />
          <div>
            <h3 class="text-lg font-semibold">{{ task.title }}</h3>
            <div class="flex items-center gap-2 mt-1">
              <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', getTaskStatusDisplayName(task.status).color]">
                {{ getTaskStatusDisplayName(task.status).label }}
              </span>
              <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', getPriorityDisplayName(task.priority).color]">
                {{ getPriorityDisplayName(task.priority).label }}
              </span>
            </div>
          </div>
        </div>
        <button class="p-2 hover:bg-gray-200 rounded-lg" @click="emit('close')">
          <X class="h-5 w-5 text-gray-500" />
        </button>
      </div>

      <!-- Tab 切换 -->
      <div class="flex border-b">
        <button class="flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors"
          :class="activeTab === 'info' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
          @click="activeTab = 'info'">
          <FileText class="h-4 w-4 inline mr-1" />
          基本信息
        </button>
        <button class="flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors"
          :class="activeTab === 'history' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
          @click="activeTab = 'history'">
          <History class="h-4 w-4 inline mr-1" />
          审核历史
        </button>
        <button class="flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors"
          :class="activeTab === 'comments' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
          @click="activeTab = 'comments'">
          <MessageSquare class="h-4 w-4 inline mr-1" />
          批注意见
        </button>
      </div>

      <!-- 内容区域 -->
      <div class="flex-1 overflow-auto p-4">
        <!-- 基本信息 Tab -->
        <div v-if="activeTab === 'info'" class="space-y-4">
          <!-- 任务信息 -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-sm text-gray-500">模型名称</label>
              <div class="flex items-center gap-2 mt-1">
                <Package class="h-4 w-4 text-gray-400" />
                <p class="font-medium">{{ task.modelName }}</p>
              </div>
            </div>
            <div>
              <label class="text-sm text-gray-500">校审人员</label>
              <div class="flex items-center gap-2 mt-1">
                <User class="h-4 w-4 text-gray-400" />
                <p class="font-medium">
                  校核：{{ task.checkerName || task.reviewerName || '-' }} / 审核：{{ task.approverName || '-' }}
                </p>
              </div>
            </div>
            <div>
              <label class="text-sm text-gray-500">创建时间</label>
              <div class="flex items-center gap-2 mt-1">
                <Calendar class="h-4 w-4 text-gray-400" />
                <p class="font-medium">{{ formatDateTime(task.createdAt) }}</p>
              </div>
            </div>
            <div>
              <label class="text-sm text-gray-500">更新时间</label>
              <div class="flex items-center gap-2 mt-1">
                <Clock class="h-4 w-4 text-gray-400" />
                <p class="font-medium">{{ formatDateTime(task.updatedAt) }}</p>
              </div>
            </div>
            <div v-if="task.dueDate">
              <label class="text-sm text-gray-500">截止时间</label>
              <div class="flex items-center gap-2 mt-1">
                <Calendar class="h-4 w-4 text-orange-400" />
                <p class="font-medium">{{ formatDate(task.dueDate) }}</p>
              </div>
            </div>
          </div>

          <!-- 描述 -->
          <div>
            <label class="text-sm text-gray-500">描述</label>
            <p class="mt-1 text-gray-700">{{ task.description || '无描述' }}</p>
          </div>

          <!-- 审核意见 -->
          <div v-if="task.reviewComment" class="p-4 rounded-lg" 
            :class="task.status === 'approved' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'">
            <label class="text-sm font-medium" :class="task.status === 'approved' ? 'text-green-700' : 'text-red-700'">
              {{ task.status === 'approved' ? '通过意见' : '驳回理由' }}
            </label>
            <p class="mt-1" :class="task.status === 'approved' ? 'text-green-800' : 'text-red-800'">
              {{ task.reviewComment }}
            </p>
          </div>

          <!-- 包含构件 -->
          <div>
            <label class="text-sm text-gray-500">包含构件 ({{ task.components.length }})</label>
            <div class="mt-2 space-y-1 max-h-40 overflow-auto">
              <div v-for="comp in task.components"
                :key="comp.id"
                class="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                <FileText class="h-4 w-4 text-blue-600" />
                <span>{{ comp.name }}</span>
                <span class="text-gray-500">({{ comp.refNo }})</span>
                <span v-if="comp.type" class="text-xs text-gray-400 ml-auto">{{ comp.type }}</span>
              </div>
            </div>
          </div>

          <!-- 附件 -->
          <div v-if="task.attachments && task.attachments.length > 0">
            <label class="text-sm text-gray-500 flex items-center gap-1">
              <Paperclip class="h-4 w-4" />
              附件文件 ({{ task.attachments.length }})
            </label>
            <div class="mt-2 space-y-1">
              <div v-for="attachment in task.attachments"
                :key="attachment.id"
                class="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm hover:bg-gray-100 cursor-pointer">
                <Paperclip class="h-4 w-4 text-gray-500" />
                <span class="flex-1">{{ attachment.name }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 审核历史 Tab -->
        <div v-else-if="activeTab === 'history'" class="space-y-4">
          <div v-if="isLoading" class="text-center py-8">
            <div class="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
            <p class="text-sm text-gray-500">加载中...</p>
          </div>

          <div v-else-if="history.length === 0" class="text-center py-8">
            <History class="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p class="text-sm text-gray-500">暂无审核历史</p>
          </div>

          <div v-else class="relative">
            <!-- 时间线 -->
            <div class="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

            <div v-for="(item, index) in history" :key="`${item.action}-${item.timestamp}-${index}`" class="relative pl-10 pb-6">
              <!-- 时间线节点 -->
              <div class="absolute left-2.5 w-3 h-3 rounded-full bg-white border-2"
                :class="{
                  'border-green-500': item.action === 'approved' || item.action === 'approve',
                  'border-red-500': item.action === 'rejected' || item.action === 'return',
                  'border-blue-500': item.action === 'in_review' || item.action === 'submitted' || item.action === 'submit',
                  'border-gray-400': item.action === 'created' || item.action === 'cancelled',
                }" />

              <div class="bg-white border rounded-lg p-3">
                <div class="flex items-center justify-between mb-2">
                  <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', getHistoryActionColor(item.action)]">
                    {{ getHistoryActionLabel(item.action) }}
                  </span>
                  <span class="text-xs text-gray-500">{{ formatDateTime(item.timestamp) }}</span>
                </div>
                <div class="flex items-center gap-2 text-sm text-gray-600">
                  <User class="h-4 w-4" />
                  <span>{{ item.userName }}</span>
                </div>
                <p v-if="item.comment" class="mt-2 text-sm text-gray-700 bg-gray-50 p-2 rounded">
                  {{ item.comment }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- 批注意见 Tab -->
        <div v-else-if="activeTab === 'comments'" class="space-y-4">
          <div v-if="comments.length === 0" class="text-center py-8">
            <MessageSquare class="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p class="text-sm text-gray-500">暂无批注意见</p>
            <p class="text-xs text-gray-400 mt-1">批注意见将在审核过程中产生</p>
          </div>

          <div v-else class="grid grid-cols-3 gap-4">
            <!-- 设计意见 -->
            <div class="border rounded-lg">
              <div class="px-3 py-2 bg-blue-50 border-b rounded-t-lg">
                <h4 class="text-sm font-medium text-blue-700">设计</h4>
                <p class="text-xs text-blue-600">{{ commentsByRole.designer.length }} 条意见</p>
              </div>
              <div class="p-2 space-y-2 max-h-80 overflow-auto">
                <div v-for="comment in commentsByRole.designer" :key="comment.id"
                  class="p-2 bg-gray-50 rounded text-sm">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-xs">{{ comment.authorName }}</span>
                    <span class="text-xs text-gray-400">{{ formatDateTime(comment.createdAt) }}</span>
                  </div>
                  <p class="text-gray-700">{{ comment.content }}</p>
                </div>
                <div v-if="commentsByRole.designer.length === 0" class="text-center py-4 text-xs text-gray-400">
                  暂无意见
                </div>
              </div>
            </div>

            <!-- 校对意见 -->
            <div class="border rounded-lg">
              <div class="px-3 py-2 bg-yellow-50 border-b rounded-t-lg">
                <h4 class="text-sm font-medium text-yellow-700">校对</h4>
                <p class="text-xs text-yellow-600">{{ commentsByRole.proofreader.length }} 条意见</p>
              </div>
              <div class="p-2 space-y-2 max-h-80 overflow-auto">
                <div v-for="comment in commentsByRole.proofreader" :key="comment.id"
                  class="p-2 bg-gray-50 rounded text-sm">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-xs">{{ comment.authorName }}</span>
                    <span class="text-xs text-gray-400">{{ formatDateTime(comment.createdAt) }}</span>
                  </div>
                  <p class="text-gray-700">{{ comment.content }}</p>
                </div>
                <div v-if="commentsByRole.proofreader.length === 0" class="text-center py-4 text-xs text-gray-400">
                  暂无意见
                </div>
              </div>
            </div>

            <!-- 审核意见 -->
            <div class="border rounded-lg">
              <div class="px-3 py-2 bg-green-50 border-b rounded-t-lg">
                <h4 class="text-sm font-medium text-green-700">审核</h4>
                <p class="text-xs text-green-600">{{ commentsByRole.reviewer.length }} 条意见</p>
              </div>
              <div class="p-2 space-y-2 max-h-80 overflow-auto">
                <div v-for="comment in commentsByRole.reviewer" :key="comment.id"
                  class="p-2 bg-gray-50 rounded text-sm">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-xs">{{ comment.authorName }}</span>
                    <span class="text-xs text-gray-400">{{ formatDateTime(comment.createdAt) }}</span>
                  </div>
                  <p class="text-gray-700">{{ comment.content }}</p>
                </div>
                <div v-if="commentsByRole.reviewer.length === 0" class="text-center py-4 text-xs text-gray-400">
                  暂无意见
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部 -->
      <div class="p-4 border-t flex justify-end">
        <button class="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50" @click="emit('close')">
          关闭
        </button>
      </div>
    </div>
  </div>
</template>
