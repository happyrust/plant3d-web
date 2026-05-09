<script setup lang="ts">
import TaskMonitorPanel from '@/components/task/TaskMonitorPanel.vue';

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
    <TaskMonitorPanel />
  </div>
</template>
