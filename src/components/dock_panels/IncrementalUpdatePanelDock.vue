<script setup lang="ts">
import IncrementalUpdatePanel from '@/components/incremental/IncrementalUpdatePanel.vue';

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
    <IncrementalUpdatePanel />
  </div>
</template>
