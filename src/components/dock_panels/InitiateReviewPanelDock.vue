<script setup lang="ts">
import InitiateReviewPanel from '@/components/review/InitiateReviewPanel.vue';

const props = defineProps<{
  params: {
    params: unknown;
    api?: {
      close?: () => void;
      setActive?: () => void;
    };
    containerApi?: unknown;
  };
}>();

function closePanel() {
  console.log('[InitiateReviewPanelDock] close requested');
  props.params.api?.close?.();
}

function handleCreated(taskId: string) {
  console.log('[InitiateReviewPanelDock] task created:', taskId);
}
</script>

<template>
  <div class="h-full overflow-hidden">
    <InitiateReviewPanel @close="closePanel" @created="handleCreated" />
  </div>
</template>
