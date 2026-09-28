<script setup lang="ts">
import { computed, ref } from 'vue';

import { ArrowRight, RotateCcw, RefreshCw } from 'lucide-vue-next';

import {
  canSubmitAtCurrentNode,
  canReturnAtCurrentNode,
  getSubmitActionLabel,
} from '../reviewPanelActions';
import WorkflowReturnDialog from '../WorkflowReturnDialog.vue';
import WorkflowSubmitDialog from '../WorkflowSubmitDialog.vue';

import type { ReviewTask, WorkflowNode } from '@/types/auth';

interface Props {
  task: ReviewTask | null;
  loading?: boolean;
}

interface Emits {
  (e: 'submit', comment?: string): void;
  (e: 'return', targetNode: WorkflowNode, reason: string): void;
  (e: 'refresh'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const showSubmitDialog = ref(false);
const showReturnDialog = ref(false);

const currentNode = computed<WorkflowNode>(() => props.task?.currentNode ?? 'sj');

const submitTargetNode = computed<WorkflowNode>(() => {
  switch (currentNode.value) {
    case 'sj': return 'jd';
    case 'jd': return 'sh';
    case 'sh': return 'pz';
    case 'pz': return 'pz';
    default: return 'jd';
  }
});

const canSubmit = computed(() => canSubmitAtCurrentNode(currentNode.value));
const canReturn = computed(() => canReturnAtCurrentNode(currentNode.value));
const submitLabel = computed(() => getSubmitActionLabel(currentNode.value));

function handleSubmitConfirm(comment?: string) {
  emit('submit', comment);
  showSubmitDialog.value = false;
}

function handleReturnConfirm(targetNode: WorkflowNode, reason: string) {
  emit('return', targetNode, reason);
  showReturnDialog.value = false;
}
</script>

<template>
  <div class="workflow-action-section border-b border-gray-200 bg-white p-4">
    <div class="flex items-center justify-between">
      <h4 class="text-sm font-medium text-gray-700">流转操作</h4>
      
      <div class="flex gap-2">
        <!-- 刷新按钮 -->
        <button type="button"
          :disabled="loading"
          class="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          @click="emit('refresh')">
          <RefreshCw :class="['mr-1.5 h-4 w-4', loading && 'animate-spin']" />
          刷新
        </button>

        <!-- 打回按钮 -->
        <button v-if="canReturn"
          type="button"
          :disabled="!task || loading"
          class="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          @click="showReturnDialog = true">
          <RotateCcw class="mr-1.5 h-4 w-4" />
          打回
        </button>

        <!-- 提交按钮 -->
        <button v-if="canSubmit"
          type="button"
          :disabled="!task || loading"
          class="inline-flex items-center rounded-md border border-transparent bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          @click="showSubmitDialog = true">
          <ArrowRight class="mr-1.5 h-4 w-4" />
          {{ submitLabel }}
        </button>
      </div>
    </div>

    <!-- 提交弹窗 -->
    <WorkflowSubmitDialog :visible="showSubmitDialog"
      :current-node="currentNode"
      :target-node="submitTargetNode"
      :loading="loading"
      @update:visible="showSubmitDialog = $event"
      @confirm="handleSubmitConfirm" />

    <!-- 打回弹窗 -->
    <WorkflowReturnDialog :visible="showReturnDialog"
      :current-node="currentNode"
      :loading="loading"
      @update:visible="showReturnDialog = $event"
      @confirm="handleReturnConfirm" />
  </div>
</template>
