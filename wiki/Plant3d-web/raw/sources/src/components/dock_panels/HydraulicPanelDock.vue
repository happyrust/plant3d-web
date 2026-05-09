<script setup lang="ts">
import HydraulicPanel from '@/components/tools/HydraulicPanel.vue';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();
</script>

<template>
  <div class="h-full w-full overflow-hidden bg-background">
    <HydraulicPanel />
  </div>
</template>
