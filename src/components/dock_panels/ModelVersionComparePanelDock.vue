<script setup lang="ts">
import ModelUnitVersionComparePanel from '@/components/model-version/ModelUnitVersionComparePanel.vue';

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
    <ModelUnitVersionComparePanel />
  </div>
</template>
