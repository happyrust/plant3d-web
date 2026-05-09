<script setup lang="ts">
import { computed } from 'vue';

import { ArrowRight, Check } from 'lucide-vue-next';

import type { WorkflowNode } from '@/types/auth';

import { WORKFLOW_NODE_NAMES } from '@/types/auth';

const props = defineProps<{
  currentNode: WorkflowNode;
}>();

const steps: { code: WorkflowNode; order: number }[] = [
  { code: 'sj', order: 0 },
  { code: 'jd', order: 1 },
  { code: 'sh', order: 2 },
  { code: 'pz', order: 3 },
];

const currentOrder = computed(() => {
  return steps.find((s) => s.code === props.currentNode)?.order ?? 0;
});

function getStepState(step: { code: WorkflowNode; order: number }): 'completed' | 'current' | 'upcoming' {
  if (step.order < currentOrder.value) return 'completed';
  if (step.order === currentOrder.value) return 'current';
  return 'upcoming';
}

function getStepClasses(state: 'completed' | 'current' | 'upcoming') {
  switch (state) {
    case 'completed':
      return 'text-emerald-600 font-medium';
    case 'current':
      return 'text-orange-600 font-semibold';
    case 'upcoming':
      return 'text-slate-400 font-normal';
  }
}
</script>

<template>
  <div class="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
    <template v-for="(step, idx) in steps" :key="step.code">
      <div class="flex items-center gap-1.5">
        <Check v-if="getStepState(step) === 'completed'"
          class="h-3.5 w-3.5 text-emerald-500" />
        <span class="text-xs"
          :class="getStepClasses(getStepState(step))">
          {{ WORKFLOW_NODE_NAMES[step.code] }} ({{ step.code }})
        </span>
      </div>
      <ArrowRight v-if="idx < steps.length - 1"
        class="mx-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
    </template>
  </div>
</template>
