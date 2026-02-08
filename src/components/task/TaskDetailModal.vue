<template>
  <v-dialog v-model="dialogOpen" max-width="700" scrollable>
    <v-card v-if="task">
      <!-- 头部 -->
      <v-card-title class="d-flex align-center justify-space-between pa-4">
        <div class="d-flex align-center">
          <v-icon size="20" class="mr-2">
            {{ task.type === 'DataParsingWizard' ? 'mdi-database-search' : 'mdi-cube-outline' }}
          </v-icon>
          <span>{{ task.name }}</span>
          <v-chip
            :color="statusDisplay.color"
            size="small"
            variant="tonal"
            class="ml-2"
          >
            {{ statusDisplay.label }}
          </v-chip>
        </div>
        <v-btn icon size="small" variant="text" @click="dialogOpen = false">
          <v-icon size="18">mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-0" style="max-height: 500px;">
        <!-- 进度区域 -->
        <div v-if="task.status === 'running'" class="pa-4 pb-2">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-body-2 font-weight-medium">{{ task.currentStep || '执行中' }}</span>
            <span class="text-body-2">
              {{ Math.round(task.progress) }}%
              <template v-if="task.totalItems && task.totalItems > 0">
                · {{ task.processedItems ?? 0 }}/{{ task.totalItems }}
              </template>
            </span>
          </div>
          <v-progress-linear
            :model-value="task.progress"
            color="primary"
            height="6"
            rounded
          />
        </div>

        <!-- 基本信息 -->
        <div class="detail-section">
          <div class="section-title">基本信息</div>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">任务ID</span>
              <span class="info-value mono">{{ task.id }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">任务类型</span>
              <span class="info-value">{{ getTaskTypeDisplayName(task.type) }}</span>
            </div>
            <div v-if="task.startTime" class="info-item">
              <span class="info-label">开始时间</span>
              <span class="info-value">{{ formatDateTime(task.startTime) }}</span>
            </div>
            <div v-if="task.endTime" class="info-item">
              <span class="info-label">结束时间</span>
              <span class="info-value">{{ formatDateTime(task.endTime) }}</span>
            </div>
            <div v-if="task.durationMs" class="info-item">
              <span class="info-label">耗时</span>
              <span class="info-value">{{ formatDuration(task.durationMs) }}</span>
            </div>
            <div v-if="task.metadata?.db_num" class="info-item">
              <span class="info-label">数据库编号</span>
              <span class="info-value">DB {{ task.metadata.db_num }}</span>
            </div>
            <div v-if="task.metadata?.batch_id" class="info-item">
              <span class="info-label">批量进度</span>
              <span class="info-value">{{ task.metadata.batch_index }}/{{ task.metadata.batch_total }}</span>
            </div>
          </div>
        </div>

        <!-- 模型产物链接 -->
        <div v-if="task.metadata?.bundle_url" class="detail-section">
          <div class="section-title">模型产物</div>
          <div class="pa-3">
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              :href="bundleFullUrl"
              target="_blank"
            >
              <v-icon start size="16">mdi-open-in-new</v-icon>
              查看模型包
            </v-btn>
            <span class="text-caption ml-2 text-medium-emphasis">{{ task.metadata.bundle_url }}</span>
          </div>
        </div>

        <!-- 统计信息 -->
        <div v-if="task.metadata?.stats" class="detail-section">
          <div class="section-title">生成结果统计</div>
          <div class="pa-3">
            <v-chip size="small" color="primary" variant="flat" class="mr-1 mb-1">
              总数: {{ task.metadata.stats.total_generated }}
            </v-chip>
            <v-chip
              v-for="(count, noun) in task.metadata.stats.noun_counts"
              :key="String(noun)"
              size="small"
              variant="tonal"
              class="mr-1 mb-1"
            >
              {{ noun }}: {{ count }}
            </v-chip>
          </div>
        </div>

        <!-- 错误详情 -->
        <div v-if="task.status === 'failed' && errorDetails" class="detail-section">
          <div class="section-title error-title">
            <v-icon size="16" color="error" class="mr-1">mdi-alert-circle</v-icon>
            错误详情
          </div>
          <div class="pa-3">
            <div v-if="errorDetails.error_code" class="mb-2">
              <v-chip size="small" color="error" variant="tonal">
                {{ errorDetails.error_code }}
              </v-chip>
              <span class="text-body-2 ml-2">{{ errorDetails.error_type }}</span>
            </div>
            <div class="error-message-box mb-2">{{ errorDetails.detailed_message }}</div>
            <div v-if="errorDetails.failed_step" class="text-body-2 mb-2">
              <strong>失败步骤：</strong>{{ errorDetails.failed_step }}
            </div>
            <div v-if="errorDetails.suggested_solutions?.length" class="mb-2">
              <div class="text-body-2 font-weight-medium mb-1">建议解决方案：</div>
              <ul class="solutions-list">
                <li v-for="(s, i) in errorDetails.suggested_solutions" :key="i">{{ s }}</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- 日志 -->
        <div class="detail-section">
          <div class="section-title d-flex align-center justify-space-between">
            <span>执行日志</span>
            <div class="d-flex align-center">
              <v-select
                v-model="logLevelFilter"
                :items="logLevelOptions"
                item-title="label"
                item-value="value"
                variant="outlined"
                density="compact"
                hide-details
                style="max-width: 120px;"
                class="mr-2"
              />
              <v-btn size="x-small" variant="text" @click="loadLogs" :loading="logsLoading">
                <v-icon size="14">mdi-refresh</v-icon>
              </v-btn>
            </div>
          </div>
          <div class="logs-container">
            <div v-if="logsLoading && logs.length === 0" class="text-center pa-4">
              <v-progress-circular indeterminate size="20" />
            </div>
            <div v-else-if="logs.length === 0" class="text-center pa-4 text-medium-emphasis">
              暂无日志
            </div>
            <div v-else class="log-list">
              <div
                v-for="(log, i) in logs"
                :key="i"
                class="log-entry"
                :class="`log-${(log.level || 'info').toLowerCase()}`"
              >
                <span class="log-time">{{ formatLogTime(log.timestamp) }}</span>
                <v-chip
                  size="x-small"
                  :color="getLogLevelColor(log.level)"
                  variant="flat"
                  class="log-level-chip"
                >
                  {{ log.level }}
                </v-chip>
                <span class="log-message">{{ log.message }}</span>
              </div>
            </div>
          </div>
        </div>
      </v-card-text>

      <v-divider />

      <!-- 底部操作 -->
      <v-card-actions class="pa-3">
        <v-btn
          v-if="task.status === 'pending'"
          size="small"
          color="primary"
          variant="tonal"
          @click="$emit('start', task.id)"
        >
          <v-icon start size="16">mdi-play</v-icon>
          启动
        </v-btn>
        <v-btn
          v-if="task.status === 'running'"
          size="small"
          color="error"
          variant="tonal"
          @click="$emit('stop', task.id)"
        >
          <v-icon start size="16">mdi-stop</v-icon>
          停止
        </v-btn>
        <v-btn
          v-if="task.status === 'failed'"
          size="small"
          color="warning"
          variant="tonal"
          @click="$emit('restart', task.id)"
        >
          <v-icon start size="16">mdi-refresh</v-icon>
          重启
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="dialogOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<!-- @ts-nocheck -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Task } from '@/types/task';
import { getTaskTypeDisplayName, getTaskStatusDisplay, formatDuration } from '@/types/task';
import { taskGetError, taskGetLogs, getBaseUrl } from '@/api/genModelTaskApi';

// ============ Props & Emits ============
const props = defineProps<{
  modelValue: boolean;
  task: Task | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  start: [taskId: string];
  stop: [taskId: string];
  restart: [taskId: string];
}>();

// ============ 状态 ============
const logs = ref<Array<{ level: string; message: string; timestamp: string | number }>>([]);
const logsLoading = ref(false);
const errorDetails = ref<any>(null);
const logLevelFilter = ref('all');

const logLevelOptions = [
  { label: '全部', value: 'all' },
  { label: 'Info', value: 'Info' },
  { label: 'Warning', value: 'Warning' },
  { label: 'Error', value: 'Error' },
  { label: 'Critical', value: 'Critical' },
];

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const statusDisplay = computed(() => {
  if (!props.task) return { label: '', color: 'grey' };
  return getTaskStatusDisplay(props.task.status);
});

const bundleFullUrl = computed(() => {
  if (!props.task?.metadata?.bundle_url) return '';
  const base = getBaseUrl().replace(/\/$/, '');
  return `${base}${props.task.metadata.bundle_url}`;
});

// ============ 加载数据 ============
watch(() => [props.modelValue, props.task?.id], ([open, taskId]) => {
  if (open && taskId) {
    loadLogs();
    if (props.task?.status === 'failed') {
      loadErrorDetails();
    }
  }
}, { immediate: true });

async function loadLogs() {
  if (!props.task) return;
  logsLoading.value = true;
  try {
    const resp = await taskGetLogs(props.task.id, {
      level: logLevelFilter.value === 'all' ? undefined : logLevelFilter.value,
    });
    if (resp.logs) {
      logs.value = resp.logs;
    }
  } catch (e) {
    console.warn('加载日志失败:', e);
  } finally {
    logsLoading.value = false;
  }
}

async function loadErrorDetails() {
  if (!props.task) return;
  try {
    const resp = await taskGetError(props.task.id);
    if (resp.error_details) {
      errorDetails.value = resp.error_details;
    }
  } catch (e) {
    console.warn('加载错误详情失败:', e);
  }
}

// 日志级别过滤变化时重新加载
watch(logLevelFilter, () => {
  if (dialogOpen.value && props.task) {
    loadLogs();
  }
});

// ============ 辅助函数 ============
function formatDateTime(value: string): string {
  try {
    const date = new Date(typeof value === 'string' && !isNaN(Number(value)) ? Number(value) : value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function formatLogTime(timestamp: string | number): string {
  try {
    const ms = typeof timestamp === 'number'
      ? (timestamp < 1e12 ? timestamp * 1000 : timestamp)
      : Number(timestamp);
    if (!isNaN(ms)) {
      const d = new Date(ms);
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  } catch { /* ignore */ }
  return String(timestamp);
}

function getLogLevelColor(level: string): string {
  switch ((level || '').toLowerCase()) {
    case 'error':
    case 'critical':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    case 'debug':
      return 'grey';
    default:
      return 'grey';
  }
}
</script>

<style scoped lang="scss">
.detail-section {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  &:last-child {
    border-bottom: none;
  }
}

.section-title {
  padding: 10px 16px 6px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.error-title {
  color: rgb(var(--v-theme-error));
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 16px;
  padding: 4px 16px 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}

.info-label {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.info-value {
  font-size: 13px;

  &.mono {
    font-family: monospace;
    font-size: 12px;
    word-break: break-all;
  }
}

.error-message-box {
  background: rgba(var(--v-theme-error), 0.08);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
  color: rgb(var(--v-theme-error));
  word-break: break-word;
}

.solutions-list {
  padding-left: 20px;
  font-size: 13px;

  li {
    margin-bottom: 4px;
  }
}

.logs-container {
  max-height: 300px;
  overflow-y: auto;
}

.log-list {
  padding: 4px 0;
}

.log-entry {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 16px;
  font-size: 12px;
  line-height: 1.5;

  &:hover {
    background: rgba(var(--v-theme-on-surface), 0.04);
  }

  &.log-error,
  &.log-critical {
    background: rgba(var(--v-theme-error), 0.04);
  }

  &.log-warning {
    background: rgba(var(--v-theme-warning), 0.04);
  }
}

.log-time {
  flex-shrink: 0;
  font-family: monospace;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  min-width: 60px;
}

.log-level-chip {
  flex-shrink: 0;
  font-size: 9px !important;
  min-width: 50px;
  text-align: center;
}

.log-message {
  flex: 1;
  word-break: break-word;
}
</style>
