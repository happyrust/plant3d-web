<script setup lang="ts">
import { ref } from 'vue';

import { ArrowRight, Send, X } from 'lucide-vue-next';

import type { WorkflowNode } from '@/types/auth';
import { WORKFLOW_NODE_NAMES } from '@/types/auth';

const props = defineProps<{
  visible: boolean;
  currentNode: WorkflowNode;
  targetNode: WorkflowNode;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'confirm', comment?: string): void;
}>();

const comment = ref('');

function handleConfirm() {
  emit('confirm', comment.value.trim() || undefined);
  comment.value = '';
}

function handleClose() {
  emit('update:visible', false);
  comment.value = '';
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="handleClose"
    >
      <div class="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-900">
        <!-- 头部 -->
        <div class="flex items-center justify-between border-b px-5 py-4">
          <div class="flex items-center gap-2">
            <Send class="h-5 w-5 text-blue-500" />
            <span class="text-base font-semibold">提交到下一节点</span>
          </div>
          <button class="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800" @click="handleClose">
            <X class="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <!-- 内容 -->
        <div class="space-y-4 px-5 py-4">
          <!-- 流程指示 -->
          <div class="flex items-center justify-center gap-3 rounded-md bg-blue-50 p-3 dark:bg-blue-950">
            <div class="rounded-md bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              {{ WORKFLOW_NODE_NAMES[currentNode] }}
            </div>
            <ArrowRight class="h-5 w-5 text-blue-400" />
            <div class="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white">
              {{ WORKFLOW_NODE_NAMES[targetNode] }}
            </div>
          </div>

          <!-- 备注 -->
          <div>
            <label class="mb-1.5 block text-sm text-gray-600 dark:text-gray-400">提交备注（可选）</label>
            <textarea
              v-model="comment"
              class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
              rows="3"
              placeholder="输入提交备注..."
            />
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            class="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            @click="handleClose"
          >
            取消
          </button>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
            :disabled="loading"
            @click="handleConfirm"
          >
            <Send class="h-4 w-4" />
            确认提交
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
