<script setup lang="ts">
import ModelVersionComparePanel from '@/components/model-version/ModelVersionComparePanel.vue';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();
</script>

<template>
  <div class="h-full w-full overflow-hidden">
    <ModelVersionComparePanel />
  </div>
</template>
