<script setup lang="ts">
import { computed } from 'vue';

import { type ReviewTask, getTaskStatusDisplayName } from '@/types/auth';

interface Props {
  task: ReviewTask;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'navigate-to-review': [];
}>();

const statusInfo = computed(() => getTaskStatusDisplayName(props.task.status));
const nodeLabel = computed(() => props.task.currentNode || '-');
</script>

<template>
  <div class="non-returned-guidance-card">
    <div class="info-block">
      <h3 class="title">当前任务暂未触发驳回流程</h3>
      <p class="description">
        该单据当前节点 <strong>{{ nodeLabel }}</strong>，状态
        <strong>{{ statusInfo.label }}</strong>。
      </p>
      <p class="description">若需要查看或处理审查记录，请前往「我的审查工作台」。</p>
    </div>
    <button class="action-button" type="button" @click="emit('navigate-to-review')">
      前往审查工作台
    </button>
  </div>
</template>

<style scoped>
.non-returned-guidance-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-radius: 8px;
  background: rgb(248 250 252 / 0.7);
  border: 1px solid rgb(226 232 240);
}

.info-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px;
  color: rgb(15 23 42);
}

.description {
  font-size: 13px;
  margin: 4px 0;
  color: rgb(71 85 105);
}

.action-button {
  align-self: flex-start;
  padding: 6px 14px;
  border-radius: 6px;
  background: rgb(59 130 246);
  color: white;
  font-size: 13px;
  border: none;
  cursor: pointer;
  transition: background 0.2s;
}

.action-button:hover {
  background: rgb(37 99 235);
}
</style>
