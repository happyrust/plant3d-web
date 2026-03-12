<script setup lang="ts">
import { ref, onMounted } from 'vue';

import { getRoomWorkerStatus, submitRoomCompute, getRoomSystemStatus } from '@/api/genModelRoomComputeApi';

// 状态
const isLoading = ref(false);
const isSubmitting = ref(false);
const workerStatus = ref<{ active_tasks: number; queue_len: number; is_busy: boolean } | null>(null);
const systemStatus = ref<{ system_health: string; active_tasks: number } | null>(null);
const message = ref('');
const messageType = ref<'success' | 'error' | 'info'>('info');

// 加载状态
async function loadStatus() {
  isLoading.value = true;
  try {
    const [worker, system] = await Promise.all([
      getRoomWorkerStatus(),
      getRoomSystemStatus(),
    ]);
    workerStatus.value = worker;
    systemStatus.value = system;
    message.value = '';
  } catch (e) {
    message.value = `加载状态失败: ${e instanceof Error ? e.message : String(e)}`;
    messageType.value = 'error';
  } finally {
    isLoading.value = false;
  }
}

// 提交房间计算任务
async function handleSubmitCompute() {
  isSubmitting.value = true;
  message.value = '';
  try {
    const resp = await submitRoomCompute({ force_rebuild: true });
    if (resp.success) {
      message.value = `任务已提交: ${resp.task_id}`;
      messageType.value = 'success';
      // 刷新状态
      await loadStatus();
    } else {
      message.value = resp.message || '提交失败';
      messageType.value = 'error';
    }
  } catch (e) {
    message.value = `提交失败: ${e instanceof Error ? e.message : String(e)}`;
    messageType.value = 'error';
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(() => {
  loadStatus();
});
</script>

<template>
  <div class="p-4 space-y-4">
    <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200">房间计算状态</h3>

    <!-- Worker 状态 -->
    <div v-if="workerStatus" class="bg-gray-100 dark:bg-gray-700 rounded-lg p-3">
      <div class="flex items-center gap-2 mb-2">
        <span class="font-medium">Worker 状态:</span>
        <span :class="workerStatus.is_busy ? 'text-orange-500' : 'text-green-500'">
          {{ workerStatus.is_busy ? '忙碌' : '空闲' }}
        </span>
      </div>
      <div class="text-sm text-gray-600 dark:text-gray-400">
        <span>活跃任务: {{ workerStatus.active_tasks }}</span>
        <span class="ml-4">队列长度: {{ workerStatus.queue_len }}</span>
      </div>
    </div>

    <!-- 系统状态 -->
    <div v-if="systemStatus" class="bg-gray-100 dark:bg-gray-700 rounded-lg p-3">
      <div class="flex items-center gap-2">
        <span class="font-medium">系统健康:</span>
        <span :class="{
          'text-green-500': systemStatus.system_health === '正常',
          'text-yellow-500': systemStatus.system_health === '警告',
          'text-red-500': systemStatus.system_health === '异常',
        }">
          {{ systemStatus.system_health }}
        </span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="flex gap-2">
      <button :disabled="isSubmitting || (workerStatus?.is_busy ?? false)"
        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        @click="handleSubmitCompute">
        {{ isSubmitting ? '提交中...' : '构建房间关系' }}
      </button>
      <button :disabled="isLoading"
        class="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
        @click="loadStatus">
        刷新状态
      </button>
    </div>

    <!-- 消息提示 -->
    <div v-if="message" :class="{
      'text-green-600': messageType === 'success',
      'text-red-600': messageType === 'error',
      'text-blue-600': messageType === 'info',
    }" class="text-sm">
      {{ message }}
    </div>
  </div>
</template>
