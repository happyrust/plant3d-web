<script setup lang="ts">
import MbdAnnotationStylePanel from '@/components/tools/MbdAnnotationStylePanel.vue';

defineProps<{
  params: {
    params: unknown
    api: unknown
    containerApi: unknown
  }
}>();
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <MbdAnnotationStylePanel />
  </div>
</template>
