<script setup lang="ts">
import AnnotationStylePanel from '@/components/tools/AnnotationStylePanel.vue';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <AnnotationStylePanel />
  </div>
</template>
