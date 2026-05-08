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
    title="确认提交流转"
    panel-class="max-w-[30rem]"
    body-class="space-y-5 px-6 py-5"
    @update:open="(open) => emit('update:visible', open)">
    <div class="rounded-lg border border-green-200 bg-green-50 p-4" data-testid="workflow-submit-flow">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-xs text-slate-500">当前环节</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">{{ currentNodeLabel }}</div>
        </div>
        <ArrowRight class="h-5 w-5 shrink-0 text-green-600" />
        <div class="min-w-0 flex-1 text-right">
          <div class="text-xs text-slate-500">下一环节</div>
          <div class="mt-1 text-sm font-semibold text-green-700">{{ targetNodeLabel }}</div>
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <label for="workflow-submit-comment" class="block text-sm font-semibold text-slate-900">
        流转备注 (选填)
      </label>
      <textarea id="workflow-submit-comment"
        v-model="comment"
        data-testid="workflow-submit-comment"
        class="min-h-[112px] w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        rows="4"
        placeholder="请输入需要提醒后续审核人员注意事项..." />
      <p class="text-xs text-slate-400">提示：确认提交后，任务将流转至下一环节，当前无法撤回。</p>
    </div>

    <template #footer>
      <Button variant="secondary" :disabled="loading" @click="handleClose">取消</Button>
      <Button :loading="loading" data-testid="workflow-submit-confirm" @click="handleConfirm">
        <Send class="mr-1 h-3.5 w-3.5" />
        确认提交流转
      </Button>
    </template>
  </Dialog>
</template>
