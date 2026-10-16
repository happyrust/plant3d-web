<script setup lang="ts">
import IncrementRecordsPanel from '@/components/increment/IncrementRecordsPanel.vue';

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
    <IncrementRecordsPanel />
  </div>
</template>
