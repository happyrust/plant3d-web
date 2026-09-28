<template>
  <div class="model-export-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <div class="header-title">
        <v-icon size="20" class="mr-2">mdi-download</v-icon>
        <span>导出模型</span>
      </div>
      <v-btn icon size="small" variant="text" @click="handleClose">
        <v-icon size="18">mdi-close</v-icon>
      </v-btn>
    </div>

    <!-- 表单内容 -->
    <div class="panel-content">
      <div class="form-group">
        <label class="form-label required">参考号 (RefNo)</label>
        <v-text-field v-model="formData.refno"
          placeholder="请输入参考号，如: 17496_106028"
          variant="outlined"
          density="compact"
          :error-messages="errors.refno"
          @blur="validateRefno" />
        <div class="hint-text">格式: DBNUM_REFNUM</div>
      </div>

      <div class="form-group">
        <label class="form-label">导出选项</label>
        <div class="checkbox-group">
          <v-checkbox v-model="formData.regenModel"
            label="重新生成模型 (--regen-model)"
            density="compact"
            hide-details />
          <v-checkbox v-model="formData.exportObj"
            label="导出 OBJ 文件 (--export-obj)"
            density="compact"
            hide-details />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">优先级</label>
        <v-select v-model="formData.priority"
          :items="priorityOptions"
          item-title="label"
          item-value="value"
          variant="outlined"
          density="compact" />
      </div>

      <!-- 命令预览 -->
      <div class="command-preview">
        <label class="form-label">命令预览</label>
        <div class="command-box">
          <code>{{ commandPreview }}</code>
        </div>
      </div>

      <!-- 错误提示 -->
      <v-alert v-if="submitError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4">
        {{ submitError }}
      </v-alert>

      <!-- 成功提示 -->
      <v-alert v-if="createdTaskId"
        type="success"
        variant="tonal"
        density="compact"
        class="mt-4">
        <div class="success-content">
          <span>任务创建成功！ID: {{ createdTaskId }}</span>
          <v-btn v-if="taskCompleted"
            size="small"
            color="primary"
            variant="tonal"
            class="ml-2"
            :loading="downloading"
            @click="handleDownload">
            <v-icon size="16" class="mr-1">mdi-download</v-icon>
            下载
          </v-btn>
          <v-chip v-else
            size="small"
            :color="taskStatusColor"
            variant="tonal"
            class="ml-2">
            {{ taskStatusLabel }}
          </v-chip>
        </div>
      </v-alert>
    </div>

    <!-- 底部按钮 -->
    <div class="panel-footer">
      <v-btn variant="text" @click="handleReset">
        重置
      </v-btn>
      <v-spacer />
      <v-btn v-if="!createdTaskId"
        color="primary"
        :loading="loading"
        :disabled="!canSubmit"
        @click="handleSubmit">
        创建任务
      </v-btn>
      <v-btn v-else
        color="primary"
        @click="handleCreateAnother">
        继续创建
      </v-btn>
    </div>
  </div>
</template>

<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';

import type { TaskPriority, TaskStatus } from '@/types/task';

import { taskCreate, taskGetById, taskDownloadExport } from '@/api/genModelTaskApi';

// ============ Emits ============
const emit = defineEmits<{
  close: [];
  created: [taskId: string];
}>();

// ============ 表单数据 ============
const formData = ref({
  refno: '',
  regenModel: true,
  exportObj: true,
  priority: 'normal' as TaskPriority,
});

const errors = ref<Record<string, string>>({});
const loading = ref(false);
const submitError = ref('');
const createdTaskId = ref<string | null>(null);
const taskStatus = ref<TaskStatus | null>(null);
const downloading = ref(false);

let pollInterval: ReturnType<typeof setInterval> | null = null;

// ============ 常量 ============
const priorityOptions = [
  { label: '低', value: 'low' },
  { label: '普通', value: 'normal' },
  { label: '高', value: 'high' },
  { label: '紧急', value: 'critical' },
];

// ============ 计算属性 ============
const commandPreview = computed(() => {
  const parts = ['cargo run --bin aios-database --'];
  parts.push(`--debug-model ${formData.value.refno || '<refno>'}`);
  if (formData.value.regenModel) parts.push('--regen-model');
  if (formData.value.exportObj) parts.push('--export-obj');
  return parts.join(' ');
});

const canSubmit = computed(() => {
  return formData.value.refno.trim().length > 0 && !errors.value.refno;
});

const taskCompleted = computed(() => taskStatus.value === 'completed');

const taskStatusColor = computed(() => {
  const colors: Record<TaskStatus, string> = {
    pending: 'grey',
    running: 'blue',
    completed: 'green',
    failed: 'red',
    cancelled: 'grey',
  };
  return taskStatus.value ? colors[taskStatus.value] : 'grey';
});

const taskStatusLabel = computed(() => {
  const labels: Record<TaskStatus, string> = {
    pending: '等待中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return taskStatus.value ? labels[taskStatus.value] : '';
});

// ============ 验证 ============
function validateRefno() {
  const refno = formData.value.refno.trim();
  if (!refno) {
    errors.value.refno = '请输入参考号';
    return false;
  }
  // 验证格式: DBNUM_REFNUM
  if (!/^\d+_\d+$/.test(refno)) {
    errors.value.refno = '格式不正确，应为: 数字_数字';
    return false;
  }
  errors.value.refno = '';
  return true;
}

// ============ 任务状态轮询 ============
function startPolling(taskId: string) {
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  
  pollInterval = setInterval(async () => {
    try {
      const response = await taskGetById(taskId);
      if (response.success && response.task) {
        taskStatus.value = response.task.status;
        
        // 如果任务完成或失败，停止轮询
        if (['completed', 'failed', 'cancelled'].includes(response.task.status)) {
          stopPolling();
        }
      }
    } catch (error) {
      console.error('[ModelExportPanel] Failed to poll task status:', error);
    }
  }, 2000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ============ 事件处理 ============
function handleClose() {
  stopPolling();
  emit('close');
}

function handleReset() {
  formData.value = {
    refno: '',
    regenModel: true,
    exportObj: true,
    priority: 'normal',
  };
  errors.value = {};
  submitError.value = '';
  createdTaskId.value = null;
  taskStatus.value = null;
  stopPolling();
}

async function handleSubmit() {
  if (!validateRefno()) return;

  loading.value = true;
  submitError.value = '';

  try {
	    const response = await taskCreate({
	      name: `导出模型 - ${formData.value.refno}`,
	      task_type: 'ModelExport',
	      priority: formData.value.priority,
	      parameters: {
	        refno: formData.value.refno,
	        regenModel: formData.value.regenModel,
        exportObj: formData.value.exportObj,
      },
    });

    if (response.success && (response.taskId || response.task?.id)) {
      createdTaskId.value = response.taskId || response.task?.id || null;
      taskStatus.value = 'pending';
      emit('created', createdTaskId.value!);
      
      // 开始轮询任务状态
      if (createdTaskId.value) {
        startPolling(createdTaskId.value);
      }
    } else {
      submitError.value = response.error_message || response.message || '创建失败';
    }
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : '创建失败';
  } finally {
    loading.value = false;
  }
}

async function handleDownload() {
  if (!createdTaskId.value) return;

  downloading.value = true;
  try {
    await taskDownloadExport(createdTaskId.value);
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : '下载失败';
  } finally {
    downloading.value = false;
  }
}

function handleCreateAnother() {
  handleReset();
}

// 清理
onUnmounted(() => {
  stopPolling();
});

// 监听 refno 变化清除错误
watch(() => formData.value.refno, () => {
  if (errors.value.refno) {
    errors.value.refno = '';
  }
});
</script>

<style scoped lang="scss">
.model-export-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgb(var(--v-theme-surface));
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  .header-title {
    display: flex;
    align-items: center;
    font-size: 15px;
    font-weight: 500;
  }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.8);

  &.required::after {
    content: ' *';
    color: rgb(var(--v-theme-error));
  }
}

.hint-text {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: -4px;
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.command-preview {
  .command-box {
    background: rgba(var(--v-theme-surface-variant), 0.5);
    border-radius: 4px;
    padding: 8px 12px;
    font-family: monospace;
    font-size: 12px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    word-break: break-all;
    margin-top: 4px;
  }
}

.success-content {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.panel-footer {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
