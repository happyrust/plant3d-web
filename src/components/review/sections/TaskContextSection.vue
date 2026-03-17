<script setup lang="ts">
import { computed } from 'vue';

import { Calendar, User, Package, AlertCircle } from 'lucide-vue-next';

import type { ReviewTask, WorkflowNode } from '@/types/auth';

import { WORKFLOW_NODE_NAMES, getPriorityDisplayName, getTaskStatusDisplayName } from '@/types/auth';

interface Props {
  task: ReviewTask | null;
  loading?: boolean;
}

const props = defineProps<Props>();

const currentNodeLabel = computed(() => {
  if (!props.task?.currentNode) return '-';
  return WORKFLOW_NODE_NAMES[props.task.currentNode as WorkflowNode];
});

const statusLabel = computed(() => {
  if (!props.task?.status) return '-';
  return getTaskStatusDisplayName(props.task.status);
});

const priorityLabel = computed(() => {
  if (!props.task?.priority) return '-';
  return getPriorityDisplayName(props.task.priority);
});

const priorityClass = computed(() => {
  switch (props.task?.priority) {
    case 'urgent': return 'bg-red-100 text-red-700';
    case 'high': return 'bg-orange-100 text-orange-700';
    case 'normal': return 'bg-blue-100 text-blue-700';
    case 'low': return 'bg-gray-100 text-gray-700';
    default: return 'bg-gray-100 text-gray-700';
  }
});

const formatDate = (timestamp?: number) => {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};
</script>

<template>
  <div class="task-context-section border-b border-gray-200 bg-white p-4">
    <div v-if="loading" class="flex items-center justify-center py-8">
      <div class="text-gray-500">加载中...</div>
    </div>

    <div v-else-if="!task" class="flex items-center justify-center py-8">
      <AlertCircle class="mr-2 h-5 w-5 text-gray-400" />
      <span class="text-gray-500">未选择任务</span>
    </div>

    <div v-else class="space-y-3">
      <!-- 标题 -->
      <div>
        <h3 class="text-lg font-semibold text-gray-900">{{ task.title }}</h3>
        <p v-if="task.description" class="mt-1 text-sm text-gray-600">{{ task.description }}</p>
      </div>

      <!-- 基础信息 -->
      <div class="grid grid-cols-2 gap-3 text-sm">
        <!-- 模型名称 -->
        <div class="flex items-start">
          <Package class="mr-2 mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
          <div>
            <div class="text-gray-500">模型</div>
            <div class="font-medium text-gray-900">{{ task.modelName || '-' }}</div>
          </div>
        </div>

        <!-- 发起人 -->
        <div class="flex items-start">
          <User class="mr-2 mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
          <div>
            <div class="text-gray-500">发起人</div>
            <div class="font-medium text-gray-900">{{ task.requesterName || '-' }}</div>
          </div>
        </div>

        <!-- 校核人 -->
        <div class="flex items-start">
          <User class="mr-2 mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
          <div>
            <div class="text-gray-500">校核人</div>
            <div class="font-medium text-gray-900">{{ task.checkerName || task.reviewerName || '-' }}</div>
          </div>
        </div>

        <!-- 审核人 -->
        <div class="flex items-start">
          <User class="mr-2 mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
          <div>
            <div class="text-gray-500">审核人</div>
            <div class="font-medium text-gray-900">{{ task.approverName || '-' }}</div>
          </div>
        </div>
      </div>

      <!-- 状态信息 -->
      <div class="flex flex-wrap gap-2">
        <span class="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
          {{ currentNodeLabel }}
        </span>
        <span class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">
          {{ statusLabel }}
        </span>
        <span :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', priorityClass]">
          {{ priorityLabel }}
        </span>
      </div>

      <!-- 时间信息 -->
      <div class="flex items-center gap-4 text-xs text-gray-500">
        <div class="flex items-center">
          <Calendar class="mr-1 h-3 w-3" />
          创建：{{ formatDate(task.createdAt) }}
        </div>
        <div class="flex items-center">
          <Calendar class="mr-1 h-3 w-3" />
          更新：{{ formatDate(task.updatedAt) }}
        </div>
      </div>

      <!-- 构件信息 -->
      <div v-if="task.components?.length" class="text-xs text-gray-500">
        关联构件：{{ task.components.length }} 个
      </div>
    </div>
  </div>
</template>
