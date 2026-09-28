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
        <v-chip :color="isWsConnected ? 'success' : 'warning'"
          size="small"
          variant="tonal"
          class="mr-2">
          <v-icon start size="12">
            {{ isWsConnected ? 'mdi-wifi' : 'mdi-wifi-off' }}
          </v-icon>
          {{ isWsConnected ? '实时' : '轮询' }}
        </v-chip>
        <!-- 刷新按钮 -->
        <v-btn icon
          size="small"
          variant="text"
          :loading="loading"
          @click="refresh">
          <v-icon size="18">mdi-refresh</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- 错误提示 -->
    <v-alert v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      closable
      class="mx-2 mt-2"
      @click:close="error = null">
      {{ error }}
    </v-alert>

    <!-- 系统指标 -->
    <div v-if="systemMetrics" class="system-metrics">
      <div class="metric-item">
        <span class="metric-label">CPU</span>
        <v-progress-linear :model-value="systemMetrics.cpuUsage"
          :color="getMetricColor(systemMetrics.cpuUsage)"
          height="6"
          rounded />
        <span class="metric-value">{{ systemMetrics.cpuUsage.toFixed(0) }}%</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">内存</span>
        <v-progress-linear :model-value="systemMetrics.memoryUsage"
          :color="getMetricColor(systemMetrics.memoryUsage)"
          height="6"
          rounded />
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
      <div class="stat-item"
        :class="{ active: filterStatus === 'running' }"
        @click="filterStatus = 'running'">
        <span class="stat-count running">{{ runningTaskCount }}</span>
        <span class="stat-label">运行中</span>
      </div>
      <div class="stat-item"
        :class="{ active: filterStatus === 'pending' }"
        @click="filterStatus = 'pending'">
        <span class="stat-count pending">{{ pendingTaskCount }}</span>
        <span class="stat-label">等待中</span>
      </div>
      <div class="stat-item"
        :class="{ active: filterStatus === 'failed' }"
        @click="filterStatus = 'failed'">
        <span class="stat-count failed">{{ tasksByStatus.failed.length }}</span>
        <span class="stat-label">失败</span>
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="task-list">
      <div v-if="loading && filteredTasks.length === 0 && batchGroups.length === 0" class="loading-state">
        <v-progress-circular indeterminate size="24" />
        <span>加载中...</span>
      </div>

      <div v-else-if="filteredTasks.length === 0 && batchGroups.length === 0" class="empty-state">
        <v-icon size="48" color="grey-lighten-1">mdi-clipboard-text-off-outline</v-icon>
        <span>暂无任务</span>
      </div>

      <template v-else>
        <!-- 批量任务组（按 batch_id 聚合） -->
        <div v-for="batch in batchGroups"
          :key="batch.batchId"
          class="batch-group">
          <div class="batch-header" @click="toggleBatch(batch.batchId)">
            <div class="batch-info">
              <v-icon size="16" class="mr-1">
                {{ expandedBatches.has(batch.batchId) ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
              </v-icon>
              <v-icon size="16" class="mr-1">mdi-layers-outline</v-icon>
              <span class="batch-title">批量任务</span>
              <v-chip size="x-small" variant="tonal" class="ml-2">
                {{ batch.completedCount }}/{{ batch.totalCount }}
              </v-chip>
              <v-chip size="x-small"
                :color="getBatchStatusColor(batch)"
                variant="tonal"
                class="ml-1">
                {{ getBatchStatusLabel(batch) }}
              </v-chip>
            </div>
            <div class="batch-actions">
              <v-btn v-if="batch.pendingCount > 0"
                size="x-small"
                color="primary"
                variant="tonal"
                @click.stop="handleStartAllBatch(batch)">
                <v-icon start size="14">mdi-play-circle-outline</v-icon>
                启动全部
              </v-btn>
            </div>
          </div>
          <!-- 批量聚合进度条 -->
          <div class="batch-progress">
            <v-progress-linear :model-value="batch.aggregateProgress"
              :color="getBatchStatusColor(batch)"
              height="6"
              rounded />
            <span class="batch-progress-text">
              {{ Math.round(batch.aggregateProgress) }}%
              · 完成 {{ batch.completedCount }}/{{ batch.totalCount }}
            </span>
          </div>
          <!-- 展开的子任务列表 -->
          <div v-if="expandedBatches.has(batch.batchId)" class="batch-children">
            <TaskStatusCard v-for="task in batch.tasks"
              :key="task.id"
              :task="task"
              @start="handleStartTask"
              @stop="handleStopTask"
              @restart="handleRestartTask"
              @delete="handleDeleteTask"
              @preview="handlePreviewTask"
              @detail="handleDetailTask" />
          </div>
        </div>

        <!-- 独立任务（无 batch_id 的） -->
        <TaskStatusCard v-for="task in standaloneTasks"
          :key="task.id"
          :task="task"
          @start="handleStartTask"
          @stop="handleStopTask"
          @restart="handleRestartTask"
          @delete="handleDeleteTask"
          @preview="handlePreviewTask"
          @detail="handleDetailTask" />
      </template>
    </div>

    <!-- 最后更新时间 -->
    <div v-if="lastUpdateTime" class="last-update">
      最后更新: {{ formatUpdateTime(lastUpdateTime) }}
    </div>

    <!-- 任务详情弹窗 -->
    <TaskDetailModal v-model="detailDialogOpen"
      :task="detailTask"
      @start="handleStartTask"
      @stop="handleStopTask"
      @restart="handleRestartTask" />
  </div>
</template>

<!-- @ts-nocheck -->
<script setup lang="ts">
import { ref, computed } from 'vue';

import TaskDetailModal from './TaskDetailModal.vue';
import TaskStatusCard from './TaskStatusCard.vue';

import type { Task } from '@/types/task';

import { useConsoleStore } from '@/composables/useConsoleStore';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useModelGeneration } from '@/composables/useModelGeneration';
import { useTaskMonitor } from '@/composables/useTaskMonitor';
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';

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
const consoleStore = useConsoleStore();
const viewerContext = useViewerContext();
const modelGenerationState = computed(() => {
  const viewer = viewerContext.viewerRef.value;
  return viewer ? useModelGeneration({ viewer }) : null;
});

// ============ 任务详情弹窗 ============
const detailDialogOpen = ref(false);
const detailTask = ref<Task | null>(null);

function handleDetailTask(taskId: string) {
  const task = tasks.value.find(t => t.id === taskId);
  if (task) {
    detailTask.value = task;
    detailDialogOpen.value = true;
  }
}

// ============ 过滤状态 ============
const filterStatus = ref<Task['status'] | null>(null);

const filteredTasks = computed(() => {
  if (filterStatus.value === null) {
    return tasks.value;
  }
  return tasksByStatus.value[filterStatus.value] || [];
});

// ============ 批量任务分组 ============

type BatchGroup = {
  batchId: string;
  tasks: Task[];
  totalCount: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
  pendingCount: number;
  aggregateProgress: number;
};

const expandedBatches = ref<Set<string>>(new Set());

/** 按 batch_id 分组的批量任务 */
const batchGroups = computed<BatchGroup[]>(() => {
  const source = filteredTasks.value;
  const groupMap = new Map<string, Task[]>();
  for (const task of source) {
    const batchId = task.metadata?.batch_id;
    if (batchId) {
      if (!groupMap.has(batchId)) groupMap.set(batchId, []);
      groupMap.get(batchId)!.push(task);
    }
  }
  const groups: BatchGroup[] = [];
  for (const [batchId, batchTasks] of groupMap) {
    // 按 batch_index 排序
    batchTasks.sort((a, b) => (a.metadata?.batch_index ?? 0) - (b.metadata?.batch_index ?? 0));
    const totalCount = batchTasks.length;
    const completedCount = batchTasks.filter(t => t.status === 'completed').length;
    const failedCount = batchTasks.filter(t => t.status === 'failed').length;
    const runningCount = batchTasks.filter(t => t.status === 'running').length;
    const pendingCount = batchTasks.filter(t => t.status === 'pending').length;
    // 聚合进度: (已完成数 + 当前运行中的进度/100) / 总数 * 100
    const runningProgress = batchTasks
      .filter(t => t.status === 'running')
      .reduce((sum, t) => sum + (t.progress || 0), 0) / 100;
    const aggregateProgress = totalCount > 0
      ? ((completedCount + runningProgress) / totalCount) * 100
      : 0;
    groups.push({ batchId, tasks: batchTasks, totalCount, completedCount, failedCount, runningCount, pendingCount, aggregateProgress });
  }
  return groups;
});

/** 不属于任何批量的独立任务 */
const standaloneTasks = computed(() => {
  return filteredTasks.value.filter(t => !t.metadata?.batch_id);
});

function toggleBatch(batchId: string) {
  if (expandedBatches.value.has(batchId)) {
    expandedBatches.value.delete(batchId);
  } else {
    expandedBatches.value.add(batchId);
  }
}

function getBatchStatusColor(batch: BatchGroup): string {
  if (batch.failedCount > 0) return 'error';
  if (batch.runningCount > 0) return 'primary';
  if (batch.completedCount === batch.totalCount) return 'success';
  if (batch.pendingCount > 0) return 'warning';
  return 'grey';
}

function getBatchStatusLabel(batch: BatchGroup): string {
  if (batch.failedCount > 0 && batch.completedCount + batch.failedCount === batch.totalCount) return '部分失败';
  if (batch.failedCount > 0) return '有失败';
  if (batch.completedCount === batch.totalCount) return '全部完成';
  if (batch.runningCount > 0) return '执行中';
  if (batch.pendingCount === batch.totalCount) return '等待中';
  return '进行中';
}

async function handleStartAllBatch(batch: BatchGroup) {
  for (const task of batch.tasks) {
    if (task.status === 'pending') {
      await startTask(task.id);
    }
  }
}

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

async function handlePreviewTask(payload: { dbnum?: number; refno?: string; task: Task }) {
  const refno = payload.refno?.trim();
  const dbnum = payload.dbnum;

  ensurePanelAndActivate('viewer');

  if (typeof window === 'undefined') {
    return;
  }

  // Give the dock layout a tick to mount/focus ViewerPanel before using the shared viewer context.
  const viewerReady = await waitForViewerReady({ timeoutMs: 4000 });
  if (!viewerReady) {
    consoleStore.addLog('error', '[task-preview] Viewer panel did not become ready in time');
    return;
  }

  if (!refno && !dbnum) {
    consoleStore.addLog('error', `[task-preview] Missing preview target for task=${payload.task.id}`);
    return;
  }

  if (refno) {
    const ok = await showPreviewByRefnos([refno], payload.task.id);
    if (ok) {
      consoleStore.addLog('info', `[task-preview] Model loaded refno=${refno} task=${payload.task.id}`);
    }
    return;
  }

  if (typeof dbnum === 'number') {
    const ok = await showPreviewByDbnum(dbnum, payload.task.id);
    if (ok) {
      consoleStore.addLog('info', `[task-preview] Model loaded dbnum=${dbnum} task=${payload.task.id}`);
    }
  }
}

async function showPreviewByDbnum(dbnum: number, taskId: string): Promise<boolean> {
  const modelGeneration = modelGenerationState.value;
  if (!modelGeneration) {
    consoleStore.addLog('error', `[task-preview] Viewer model generation state unavailable for dbnum=${dbnum} task=${taskId}`);
    return false;
  }

  try {
    const allRefnos = await modelGeneration.showModelByDbnum(dbnum, { flyTo: true });
    if (allRefnos.loaded) {
      return true;
    }

    const errorMessage = modelGeneration.error.value || `Model files not found for dbnum=${dbnum}`;
    consoleStore.addLog('error', `[task-preview] ${errorMessage} task=${taskId}`);
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    consoleStore.addLog('error', `[task-preview] Failed to preview dbnum=${dbnum} task=${taskId}: ${message}`);
    return false;
  }
}

async function showPreviewByRefnos(refnos: string[], taskId: string): Promise<boolean> {
  const requestId = `task-preview-${taskId}-${Date.now()}`;
  const completion = await showModelByRefnosWithAck({
    refnos,
    flyTo: true,
    requestId,
    timeoutMs: 15000,
    ensureViewerReady: false,
  });

  if (completion.ok.length > 0 && completion.fail.length === 0 && !completion.error) {
    return true;
  }

  const missing404 = completion.fail.some(item => /404|not found/i.test(item.error ?? ''));
  const message = missing404
    ? 'Model files not found'
    : completion.error || completion.fail.map(item => item.error || `Failed to load ${item.refno}`).join('; ') || 'Model preview failed';
  consoleStore.addLog('error', `[task-preview] ${message} task=${taskId}`);
  return false;
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

.batch-group {
  margin-bottom: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  overflow: hidden;
}

.batch-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  cursor: pointer;
  user-select: none;

  &:hover {
    background: rgba(var(--v-theme-surface-variant), 0.5);
  }

  .batch-info {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .batch-title {
    font-size: 13px;
    font-weight: 500;
  }
}

.batch-progress {
  padding: 6px 12px 8px;
  background: rgba(var(--v-theme-surface-variant), 0.15);
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  .batch-progress-text {
    display: block;
    margin-top: 4px;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.6);
  }
}

.batch-children {
  padding: 8px;
}

.last-update {
  padding: 6px 12px;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-align: center;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
