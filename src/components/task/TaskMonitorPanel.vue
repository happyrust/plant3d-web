<template>
  <div class="task-monitor-panel">
    <!-- 头部工具栏 -->
    <div class="panel-header">
      <div class="header-left">
        <v-icon size="20" class="mr-2">mdi-monitor-dashboard</v-icon>
        <span class="panel-title">任务监控</span>
      </div>
      <div class="header-right">
        <!-- 连接状态 -->
        <v-chip
          :color="isWsConnected ? 'success' : 'warning'"
          size="small"
          variant="tonal"
          class="mr-2"
        >
          <v-icon start size="12">
            {{ isWsConnected ? 'mdi-wifi' : 'mdi-wifi-off' }}
          </v-icon>
          {{ isWsConnected ? '实时' : '轮询' }}
        </v-chip>
        <!-- 刷新按钮 -->
        <v-btn
          icon
          size="small"
          variant="text"
          :loading="loading"
          @click="refresh"
        >
          <v-icon size="18">mdi-refresh</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- 错误提示 -->
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      closable
      class="mx-2 mt-2"
      @click:close="error = null"
    >
      {{ error }}
    </v-alert>

    <!-- 系统指标 -->
    <div v-if="systemMetrics" class="system-metrics">
      <div class="metric-item">
        <span class="metric-label">CPU</span>
        <v-progress-linear
          :model-value="systemMetrics.cpuUsage"
          :color="getMetricColor(systemMetrics.cpuUsage)"
          height="6"
          rounded
        />
        <span class="metric-value">{{ systemMetrics.cpuUsage.toFixed(0) }}%</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">内存</span>
        <v-progress-linear
          :model-value="systemMetrics.memoryUsage"
          :color="getMetricColor(systemMetrics.memoryUsage)"
          height="6"
          rounded
        />
        <span class="metric-value">{{ systemMetrics.memoryUsage.toFixed(0) }}%</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">活跃任务</span>
        <span class="metric-value active-tasks">{{ systemMetrics.activeTaskCount }}</span>
      </div>
    </div>

    <!-- 任务统计 -->
    <div class="task-stats">
      <div class="stat-item" :class="{ active: filterStatus === null }" @click="filterStatus = null">
        <span class="stat-count">{{ tasks.length }}</span>
        <span class="stat-label">全部</span>
      </div>
      <div
        class="stat-item"
        :class="{ active: filterStatus === 'running' }"
        @click="filterStatus = 'running'"
      >
        <span class="stat-count running">{{ runningTaskCount }}</span>
        <span class="stat-label">运行中</span>
      </div>
      <div
        class="stat-item"
        :class="{ active: filterStatus === 'pending' }"
        @click="filterStatus = 'pending'"
      >
        <span class="stat-count pending">{{ pendingTaskCount }}</span>
        <span class="stat-label">等待中</span>
      </div>
      <div
        class="stat-item"
        :class="{ active: filterStatus === 'failed' }"
        @click="filterStatus = 'failed'"
      >
        <span class="stat-count failed">{{ tasksByStatus.failed.length }}</span>
        <span class="stat-label">失败</span>
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="task-list">
      <div v-if="loading && filteredTasks.length === 0" class="loading-state">
        <v-progress-circular indeterminate size="24" />
        <span>加载中...</span>
      </div>

      <div v-else-if="filteredTasks.length === 0" class="empty-state">
        <v-icon size="48" color="grey-lighten-1">mdi-clipboard-text-off-outline</v-icon>
        <span>暂无任务</span>
      </div>

      <template v-else>
        <TaskStatusCard
          v-for="task in filteredTasks"
          :key="task.id"
          :task="task"
          @start="handleStartTask"
          @stop="handleStopTask"
          @restart="handleRestartTask"
          @delete="handleDeleteTask"
        />
      </template>
    </div>

    <!-- 最后更新时间 -->
    <div v-if="lastUpdateTime" class="last-update">
      最后更新: {{ formatUpdateTime(lastUpdateTime) }}
    </div>
  </div>
</template>

<!-- @ts-nocheck -->
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTaskMonitor } from '@/composables/useTaskMonitor';
import type { Task } from '@/types/task';
import TaskStatusCard from './TaskStatusCard.vue';

// ============ 任务监控 ============
// 后端支持的操作：start, stop, restart, delete
// 注意：后端不支持 pause/resume
const {
  tasks,
  systemMetrics,
  loading,
  error,
  isWsConnected,
  lastUpdateTime,
  tasksByStatus,
  runningTaskCount,
  pendingTaskCount,
  refresh,
  startTask,
  stopTask,
  restartTask,
  deleteTask,
} = useTaskMonitor();

// ============ 过滤状态 ============
const filterStatus = ref<Task['status'] | null>(null);

const filteredTasks = computed(() => {
  if (filterStatus.value === null) {
    return tasks.value;
  }
  return tasksByStatus.value[filterStatus.value] || [];
});

// ============ 辅助函数 ============
function getMetricColor(value: number): string {
  if (value >= 90) return 'error';
  if (value >= 70) return 'warning';
  return 'success';
}

function formatUpdateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ============ 任务操作处理 ============
async function handleStartTask(taskId: string) {
  await startTask(taskId);
}

async function handleStopTask(taskId: string) {
  await stopTask(taskId);
}

async function handleRestartTask(taskId: string) {
  await restartTask(taskId);
}

async function handleDeleteTask(taskId: string) {
  await deleteTask(taskId);
}
</script>

<style scoped lang="scss">
.task-monitor-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgb(var(--v-theme-surface));
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  .header-left {
    display: flex;
    align-items: center;
  }

  .panel-title {
    font-size: 14px;
    font-weight: 500;
  }

  .header-right {
    display: flex;
    align-items: center;
  }
}

.system-metrics {
  display: flex;
  gap: 16px;
  padding: 12px;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  .metric-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;

    .metric-label {
      font-size: 11px;
      color: rgba(var(--v-theme-on-surface), 0.6);
    }

    .metric-value {
      font-size: 12px;
      font-weight: 500;

      &.active-tasks {
        font-size: 18px;
        color: rgb(var(--v-theme-primary));
      }
    }
  }
}

.task-stats {
  display: flex;
  padding: 8px 12px;
  gap: 4px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  .stat-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background: rgba(var(--v-theme-primary), 0.08);
    }

    &.active {
      background: rgba(var(--v-theme-primary), 0.12);
    }

    .stat-count {
      font-size: 16px;
      font-weight: 600;

      &.running {
        color: rgb(var(--v-theme-info));
      }

      &.pending {
        color: rgb(var(--v-theme-warning));
      }

      &.failed {
        color: rgb(var(--v-theme-error));
      }
    }

    .stat-label {
      font-size: 11px;
      color: rgba(var(--v-theme-on-surface), 0.6);
    }
  }
}

.task-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;

  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 200px;
    color: rgba(var(--v-theme-on-surface), 0.5);
    font-size: 13px;
  }
}

.last-update {
  padding: 6px 12px;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-align: center;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
