<script setup lang="ts">
import { computed, ref } from 'vue';

import { ArrowLeft, CornerDownLeft, X } from 'lucide-vue-next';

import type { WorkflowNode } from '@/types/auth';

import { WORKFLOW_NODE_NAMES } from '@/types/auth';

const props = defineProps<{
  visible: boolean;
  currentNode: WorkflowNode;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'confirm', targetNode: WorkflowNode, reason: string): void;
}>();

const targetNode = ref<WorkflowNode>('sj');
const reason = ref('');

// 只显示当前节点之前的节点
const availableTargetNodes = computed<{ value: WorkflowNode; label: string }[]>(() => {
  const order: WorkflowNode[] = ['sj', 'jd', 'sh', 'pz'];
  const currentIdx = order.indexOf(props.currentNode);
  return order
    .slice(0, currentIdx)
    .map((n) => ({ value: n, label: WORKFLOW_NODE_NAMES[n] }));
});

const canConfirm = computed(() => {
  return reason.value.trim().length > 0 && availableTargetNodes.value.some((n) => n.value === targetNode.value);
});

function handleConfirm() {
  if (!canConfirm.value) return;
  emit('confirm', targetNode.value, reason.value.trim());
  reason.value = '';
  targetNode.value = 'sj';
}

function handleClose() {
  emit('update:visible', false);
  reason.value = '';
  targetNode.value = 'sj';
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="handleClose">
      <div class="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-900">
        <!-- 头部 -->
        <div class="flex items-center justify-between border-b px-5 py-4">
          <div class="flex items-center gap-2">
            <CornerDownLeft class="h-5 w-5 text-red-500" />
            <span class="text-base font-semibold">驳回到指定节点</span>
          </div>
          <button class="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800" @click="handleClose">
            <X class="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <!-- 内容 -->
        <div class="space-y-4 px-5 py-4">
          <!-- 流程指示 -->
          <div class="flex items-center justify-center gap-3 rounded-md bg-red-50 p-3 dark:bg-red-950">
            <div class="rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
              {{ WORKFLOW_NODE_NAMES[currentNode] }}
            </div>
            <ArrowLeft class="h-5 w-5 text-red-400" />
            <div class="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white">
              {{ WORKFLOW_NODE_NAMES[targetNode] }}
            </div>
          </div>

          <!-- 目标节点选择 -->
          <div>
            <label class="mb-1.5 block text-sm text-gray-600 dark:text-gray-400">驳回目标节点</label>
            <div class="flex gap-2">
              <button v-for="node in availableTargetNodes"
                :key="node.value"
                type="button"
                class="flex-1 rounded-md border px-3 py-2 text-sm transition-colors"
                :class="
                  targetNode === node.value
                    ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                    : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                "
                @click="targetNode = node.value">
                {{ node.label }}
              </button>
            </div>
          </div>

          <!-- 驳回原因 -->
          <div>
            <label class="mb-1.5 block text-sm text-gray-600 dark:text-gray-400">
              驳回原因
              <span class="text-red-500">*</span>
            </label>
            <textarea v-model="reason"
              class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-gray-700 dark:bg-gray-800"
              rows="3"
              placeholder="请输入驳回原因（必填）..." />
            <p v-if="reason.length === 0" class="mt-1 text-xs text-red-500">驳回原因为必填项</p>
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="flex justify-end gap-2 border-t px-5 py-3">
          <button type="button"
            class="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            @click="handleClose">
            取消
          </button>
          <button type="button"
            class="flex items-center gap-1.5 rounded-md bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600 disabled:opacity-50"
            :disabled="!canConfirm || loading"
            @click="handleConfirm">
            <CornerDownLeft class="h-4 w-4" />
            确认驳回
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
