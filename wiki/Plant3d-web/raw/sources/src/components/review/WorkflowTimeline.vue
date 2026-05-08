<script setup lang="ts">
import { CheckCircle, Clock, CornerDownLeft, Send } from 'lucide-vue-next';

import type { WorkflowNode } from '@/types/auth';

import { WORKFLOW_NODE_NAMES } from '@/types/auth';

export type TimelineStep = {
  node: string;
  action: string;
  operatorId: string;
  operatorName: string;
  comment?: string;
  timestamp: number;
};

defineProps<{
  currentNode: WorkflowNode;
  history: TimelineStep[];
}>();

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getActionLabel(action: string): string {
  switch (action) {
    case 'submit': return '提交';
    case 'return': return '驳回';
    case 'approve': return '批准';
    case 'reject': return '拒绝';
    default: return action;
  }
}

function getActionColor(action: string): { dot: string; bg: string; text: string } {
  switch (action) {
    case 'submit':
      return { dot: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300' };
    case 'approve':
      return { dot: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-300' };
    case 'return':
    case 'reject':
      return { dot: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950', text: 'text-red-700 dark:text-red-300' };
    default:
      return { dot: 'bg-gray-400', bg: 'bg-gray-50 dark:bg-gray-900', text: 'text-gray-600 dark:text-gray-400' };
  }
}

function getActionIcon(action: string) {
  switch (action) {
    case 'submit': return Send;
    case 'approve': return CheckCircle;
    case 'return':
    case 'reject': return CornerDownLeft;
    default: return Clock;
  }
}
</script>

<template>
  <div class="space-y-0">
    <!-- 当前节点指示 -->
    <div class="mb-2 flex items-center gap-2 text-xs">
      <span class="text-muted-foreground">当前节点:</span>
      <span class="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
        {{ WORKFLOW_NODE_NAMES[currentNode] }}
      </span>
    </div>

    <!-- 时间线 -->
    <div v-if="history.length > 0" class="relative ml-2.5">
      <!-- 竖线 -->
      <div class="absolute left-0 top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-700" />

      <div v-for="(step, idx) in history"
        :key="idx"
        class="relative flex gap-3 pb-3 last:pb-0">
        <!-- 圆点 -->
        <div class="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-gray-900"
          :class="getActionColor(step.action).dot" />

        <!-- 内容 -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 text-xs">
            <component :is="getActionIcon(step.action)" class="h-3 w-3" :class="getActionColor(step.action).text" />
            <span class="rounded px-1.5 py-0.5 text-xs font-medium"
              :class="[getActionColor(step.action).bg, getActionColor(step.action).text]">
              {{ WORKFLOW_NODE_NAMES[(step.node || 'sj') as WorkflowNode] }} · {{ getActionLabel(step.action) }}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{{ step.operatorName }}</span>
            <span>·</span>
            <span>{{ formatDateTime(step.timestamp) }}</span>
          </div>
          <div v-if="step.comment"
            class="mt-1 rounded border-l-2 border-gray-300 bg-muted/30 px-2 py-1 text-xs text-muted-foreground dark:border-gray-600">
            {{ step.comment }}
          </div>
        </div>
      </div>
    </div>

    <div v-else class="text-xs text-muted-foreground">暂无工作流记录</div>
  </div>
</template>
