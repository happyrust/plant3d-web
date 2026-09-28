<script setup lang="ts">
import DimensionStylePanel from '@/components/tools/DimensionStylePanel.vue';

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
    <DimensionStylePanel />
  </div>
</template>
