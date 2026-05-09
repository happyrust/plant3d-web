<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { ArrowLeft, CornerDownLeft } from 'lucide-vue-next';

import type { WorkflowNode } from '@/types/auth';

import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
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

// 只显示当前环节之前的节点
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

const targetNodeLabel = computed(() => WORKFLOW_NODE_NAMES[targetNode.value]);

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      reason.value = '';
      targetNode.value = 'sj';
    }
  }
);

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
  <Dialog :open="visible"
    title="确认驳回流转"
    panel-class="max-w-[30rem]"
    body-class="space-y-5 px-6 py-5"
    @update:open="(open) => emit('update:visible', open)">
    <div class="flex items-center gap-2 text-sm font-medium text-[#DC2626]">
      <CornerDownLeft class="h-4 w-4" />
      <span>确认驳回流转并填写流转驳回原因</span>
    </div>

    <div class="rounded-2xl border border-[#FECACA] bg-[#FFF7F7] p-4" data-testid="workflow-return-flow">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1 rounded-xl bg-[#DC2626] px-4 py-3 text-white shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.16em] text-red-100">目标环节</div>
          <div class="mt-2 text-sm font-semibold">{{ targetNodeLabel }}</div>
        </div>
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FEE2E2] text-[#DC2626]">
          <ArrowLeft class="h-4 w-4" />
        </div>
        <div class="min-w-0 flex-1 rounded-xl border border-[#FECACA] bg-white px-4 py-3">
          <div class="text-xs font-medium uppercase tracking-[0.16em] text-[#F87171]">当前环节</div>
          <div class="mt-2 text-sm font-semibold text-[#991B1B]">{{ WORKFLOW_NODE_NAMES[currentNode] }}</div>
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <label class="block text-sm font-medium text-[#374151]">目标环节</label>
      <div class="flex gap-2">
        <button v-for="node in availableTargetNodes"
          :key="node.value"
          type="button"
          class="flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors"
          :class="
            targetNode === node.value
              ? 'border-[#DC2626] bg-[#FFF1F2] text-[#B91C1C]'
              : 'border-[#D1D5DB] bg-white text-[#4B5563] hover:bg-[#F9FAFB]'
          "
          @click="targetNode = node.value">
          {{ node.label }}
        </button>
      </div>
    </div>

    <div class="space-y-2">
      <label for="workflow-return-reason" class="block text-sm font-medium text-[#374151]">
        流转驳回原因（必填）
      </label>
      <textarea id="workflow-return-reason"
        v-model="reason"
        data-testid="workflow-return-reason"
        class="min-h-[112px] w-full rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#DC2626] focus:outline-none focus:ring-4 focus:ring-[#FEE2E2]"
        rows="4"
        placeholder="请输入流转驳回原因（必填）" />
      <p v-if="reason.trim().length === 0" class="text-xs text-[#DC2626]">流转驳回原因为必填项</p>
    </div>

    <template #footer>
      <Button variant="secondary" :disabled="loading" @click="handleClose">取消</Button>
      <Button variant="danger"
        :disabled="!canConfirm"
        :loading="loading"
        data-testid="workflow-return-confirm"
        @click="handleConfirm">
        确认驳回流转
      </Button>
    </template>
  </Dialog>
</template>
