<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { ArrowRight, Send } from 'lucide-vue-next';

import type { WorkflowNode } from '@/types/auth';

import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
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

const currentNodeLabel = computed(() => WORKFLOW_NODE_NAMES[props.currentNode]);
const targetNodeLabel = computed(() => WORKFLOW_NODE_NAMES[props.targetNode]);

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      comment.value = '';
    }
  }
);

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
  <Dialog :open="visible"
    title="提交到下一节点"
    panel-class="max-w-[30rem]"
    body-class="space-y-5 px-6 py-5"
    @update:open="(open) => emit('update:visible', open)">
    <div class="flex items-center gap-2 text-sm font-medium text-[#2563EB]">
      <Send class="h-4 w-4" />
      <span>确认当前任务流转路径</span>
    </div>

    <div class="rounded-2xl border border-[#DBEAFE] bg-[#F8FBFF] p-4" data-testid="workflow-submit-flow">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1 rounded-xl border border-[#BFDBFE] bg-white px-4 py-3">
          <div class="text-xs font-medium uppercase tracking-[0.16em] text-[#60A5FA]">当前节点</div>
          <div class="mt-2 text-sm font-semibold text-[#1E3A8A]">{{ currentNodeLabel }}</div>
        </div>
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#DBEAFE] text-[#2563EB]">
          <ArrowRight class="h-4 w-4" />
        </div>
        <div class="min-w-0 flex-1 rounded-xl bg-[#2563EB] px-4 py-3 text-white shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.16em] text-blue-100">目标节点</div>
          <div class="mt-2 text-sm font-semibold">{{ targetNodeLabel }}</div>
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <label for="workflow-submit-comment" class="block text-sm font-medium text-[#374151]">备注输入（可选）</label>
      <textarea id="workflow-submit-comment"
        v-model="comment"
        data-testid="workflow-submit-comment"
        class="min-h-[112px] w-full rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-4 focus:ring-[#DBEAFE]"
        rows="4"
        placeholder="输入本次提交说明，留空则直接流转到下一节点" />
    </div>

    <template #footer>
      <Button variant="secondary" :disabled="loading" @click="handleClose">取消</Button>
      <Button :loading="loading" data-testid="workflow-submit-confirm" @click="handleConfirm">
        确认提交
      </Button>
    </template>
  </Dialog>
</template>
