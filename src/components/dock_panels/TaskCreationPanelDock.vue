<script setup lang="ts">
import TaskCreationWizard from '@/components/task/TaskCreationWizard.vue';

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
  console.log('Task created:', taskId);
  // 可以发送事件通知任务监控面板刷新
}
</script>

<template>
  <div style="height: 100%; width: 100%; overflow: hidden;">
    <TaskCreationWizard @close="handleClose" @created="handleCreated" />
  </div>
</template>
