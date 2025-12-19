<script setup lang="ts">
import ModelExportPanel from '@/components/task/ModelExportPanel.vue';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

function handleClose() {
  // 可以通过 api 关闭面板
}

function handleCreated(taskId: string) {
  console.log('Export task created:', taskId);
  // 可以发送事件通知任务监控面板刷新
}
</script>

<template>
  <div class="h-full w-full overflow-hidden">
    <ModelExportPanel @close="handleClose" @created="handleCreated" />
  </div>
</template>
