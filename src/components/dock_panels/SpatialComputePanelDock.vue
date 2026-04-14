<script setup lang="ts">
import SpatialComputePanel from '@/components/spatial-query/SpatialComputePanel.vue';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();
</script>

<template>
  <div class="h-full overflow-hidden">
    <SpatialComputePanel />
  </div>
</template>
