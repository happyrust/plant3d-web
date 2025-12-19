<template>
  <div class="task-status-card" :class="[`status-${task.status}`]">
    <!-- 任务头部 -->
    <div class="card-header">
      <div class="task-info">
        <span class="task-name">{{ task.name }}</span>
        <v-chip
          :color="statusDisplay.color"
          size="x-small"
          variant="tonal"
          class="status-chip"
        >
          {{ statusDisplay.label }}
        </v-chip>
      </div>
      <div class="task-type">
        <v-icon size="14" class="mr-1">
          {{ task.type === 'DataParsing' ? 'mdi-database-search' : 'mdi-cube-outline' }}
        </v-icon>
        {{ typeDisplay }}
      </div>
    </div>

    <!-- 进度条 -->
    <div class="card-progress">
      <v-progress-linear
        :model-value="task.progress"
        :color="progressColor"
        height="4"
        rounded
        :indeterminate="task.status === 'running' && task.progress === 0"
      />
      <span class="progress-text">{{ task.progress }}%</span>
    </div>

    <!-- 任务详情 -->
    <div class="card-details">
      <div v-if="task.startTime" class="detail-item">
        <v-icon size="12">mdi-clock-start</v-icon>
        <span>{{ formatTime(task.startTime) }}</span>
      </div>
      <div v-if="task.durationMs" class="detail-item">
        <v-icon size="12">mdi-timer-outline</v-icon>
        <span>{{ formatDuration(task.durationMs) }}</span>
      </div>
      <div v-if="task.priority" class="detail-item">
        <v-icon size="12" :color="priorityDisplay.color">mdi-flag</v-icon>
        <span>{{ priorityDisplay.label }}</span>
      </div>
    </div>

    <!-- 统计信息 -->
    <div v-if="task.metadata?.stats" class="card-stats">
      <div class="stats-title">生成结果统计:</div>
      <div class="stats-chips">
        <v-chip size="x-small" color="primary" variant="flat" class="mr-1 mb-1">
          总数: {{ task.metadata.stats.total_generated }}
        </v-chip>
        <v-chip
          v-for="(count, noun) in task.metadata.stats.noun_counts"
          :key="noun"
          size="x-small"
          variant="tonal"
          class="mr-1 mb-1"
        >
          {{ noun }}: {{ count }}
        </v-chip>
      </div>
    </div>

    <!-- 错误信息 -->
    <div v-if="task.error" class="card-error">
      <v-icon size="14" color="error">mdi-alert-circle</v-icon>
      <span>{{ task.error }}</span>
    </div>

    <!-- 操作按钮 -->
    <div class="card-actions">
      <!-- 等待中：启动、删除 -->
      <template v-if="task.status === 'pending'">
        <v-btn
          size="x-small"
          color="primary"
          variant="tonal"
          @click="$emit('start', task.id)"
        >
          <v-icon start size="14">mdi-play</v-icon>
          启动
        </v-btn>
        <v-btn
          size="x-small"
          color="error"
          variant="text"
          @click="$emit('delete', task.id)"
        >
          <v-icon start size="14">mdi-delete</v-icon>
          删除
        </v-btn>
      </template>

      <!-- 运行中：停止 -->
      <v-btn
        v-if="task.status === 'running'"
        size="x-small"
        color="error"
        variant="tonal"
        @click="$emit('stop', task.id)"
      >
        <v-icon start size="14">mdi-stop</v-icon>
        停止
      </v-btn>

      <!-- 失败：重启、删除 -->
      <template v-if="task.status === 'failed'">
        <v-btn
          size="x-small"
          color="warning"
          variant="tonal"
          @click="$emit('restart', task.id)"
        >
          <v-icon start size="14">mdi-refresh</v-icon>
          重启
        </v-btn>
        <v-btn
          size="x-small"
          color="error"
          variant="text"
          @click="$emit('delete', task.id)"
        >
          <v-icon start size="14">mdi-delete</v-icon>
          删除
        </v-btn>
      </template>

      <!-- 已完成/已取消：删除 -->
      <v-btn
        v-if="task.status === 'completed' || task.status === 'cancelled'"
        size="x-small"
        color="error"
        variant="text"
        @click="$emit('delete', task.id)"
      >
        <v-icon start size="14">mdi-delete</v-icon>
        删除
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Task } from '@/types/task';
import {
  getTaskTypeDisplayName,
  getTaskStatusDisplay,
  getPriorityDisplay,
  formatDuration,
} from '@/types/task';

// ============ Props ============
const props = defineProps<{
  task: Task;
}>();

// ============ Emits ============
// 后端支持的操作：start, stop, restart, delete
// 注意：后端不支持 pause/resume
defineEmits<{
  start: [taskId: string];
  stop: [taskId: string];
  restart: [taskId: string];
  delete: [taskId: string];
}>();

// ============ 计算属性 ============
const typeDisplay = computed(() => getTaskTypeDisplayName(props.task.type));
const statusDisplay = computed(() => getTaskStatusDisplay(props.task.status));
const priorityDisplay = computed(() => getPriorityDisplay(props.task.priority));

const progressColor = computed(() => {
  switch (props.task.status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'running':
      return 'primary';
    default:
      return 'grey';
  }
});

// ============ 辅助函数 ============
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped lang="scss">
.task-status-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  transition: box-shadow 0.2s;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  &.status-running {
    border-left: 3px solid rgb(var(--v-theme-info));
  }

  &.status-completed {
    border-left: 3px solid rgb(var(--v-theme-success));
  }

  &.status-failed {
    border-left: 3px solid rgb(var(--v-theme-error));
  }

  &.status-cancelled {
    border-left: 3px solid rgb(var(--v-theme-warning));
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;

  .task-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .task-name {
    font-size: 13px;
    font-weight: 500;
    color: rgb(var(--v-theme-on-surface));
  }

  .status-chip {
    font-size: 10px;
  }

  .task-type {
    display: flex;
    align-items: center;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.6);
  }
}

.card-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;

  .v-progress-linear {
    flex: 1;
  }

  .progress-text {
    font-size: 11px;
    font-weight: 500;
    min-width: 36px;
    text-align: right;
  }
}

.card-details {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;

  .detail-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.6);
  }
}

.card-stats {
  margin-bottom: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity));

  .stats-title {
    font-size: 11px;
    font-weight: 500;
    color: rgba(var(--v-theme-on-surface), 0.8);
    margin-bottom: 4px;
  }

  .stats-chips {
    display: flex;
    flex-wrap: wrap;
  }
}

.card-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px;
  margin-bottom: 8px;
  background: rgba(var(--v-theme-error), 0.08);
  border-radius: 4px;
  font-size: 11px;
  color: rgb(var(--v-theme-error));
}

.card-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
