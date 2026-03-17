<script setup lang="ts">
import { computed, ref } from 'vue';

import { Download, FileText } from 'lucide-vue-next';

import type { ReviewTask } from '@/types/auth';

import { reviewSyncExport, reviewSyncImport } from '@/api/reviewApi';
import { useReviewStore } from '@/composables/useReviewStore';
import { useUserStore } from '@/composables/useUserStore';
import { emitToast } from '@/ribbon/toastBus';

const reviewStore = useReviewStore();
const userStore = useUserStore();

const syncOverwrite = ref(false);
const syncExporting = ref(false);
const syncImporting = ref(false);
const syncError = ref<string | null>(null);

const currentTask = computed(() => reviewStore.currentTask.value);
const currentTaskFormId = computed(() => currentTask.value?.formId?.trim() || null);
const currentTaskTitle = computed(() => currentTask.value?.title?.trim() || '当前任务');

function getImportedTasks(payload: unknown): ReviewTask[] {
  if (!payload || typeof payload !== 'object') return [];
  const tasks = (payload as { tasks?: unknown }).tasks;
  return Array.isArray(tasks) ? (tasks as ReviewTask[]) : [];
}

async function refreshWorkbenchContextAfterImport(importedTasks: ReviewTask[]) {
  const previousTaskId = currentTask.value?.id;
  const previousTaskFormId = currentTask.value?.formId?.trim() || null;
  await userStore.loadReviewTasks();

  if (!previousTaskId) {
    return;
  }

  const refreshedTasks = userStore.reviewTasks.value;
  const matchingById = refreshedTasks.find((task) => task.id === previousTaskId);
  const matchingByFormId = !matchingById && previousTaskFormId
    ? refreshedTasks.find((task) => task.formId?.trim() === previousTaskFormId)
    : undefined;
  const matchingImportedTask = !matchingById && !matchingByFormId
    ? importedTasks.find((task) => task.id === previousTaskId)
    : undefined;
  const nextTask = matchingById || matchingByFormId || matchingImportedTask || null;

  if (nextTask) {
    await reviewStore.setCurrentTask(nextTask);
    return;
  }

  await reviewStore.setCurrentTask(null);
}

async function exportFromServer() {
  syncError.value = null;
  syncExporting.value = true;
  try {
    const data = await reviewSyncExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review-sync-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    emitToast({ message: '已导出当前校审同步包' });
  } catch (e) {
    syncError.value = e instanceof Error ? e.message : '导出失败';
    console.error('[ReviewDataSync] Export failed:', e);
  } finally {
    syncExporting.value = false;
  }
}

async function importFromFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  syncError.value = null;
  syncImporting.value = true;
  try {
    const text = await file.text();
    const data = JSON.parse(text) as unknown;
    const tasks = getImportedTasks(data);
    if (tasks.length === 0) {
      throw new Error('导入文件格式不正确：缺少 tasks 数组');
    }

    const response = await reviewSyncImport({
      tasks,
      overwrite: syncOverwrite.value,
    });
    if (!response.success) {
      throw new Error(response.error_message || '导入失败');
    }

    await refreshWorkbenchContextAfterImport(tasks);
    emitToast({
      message: `导入完成：${response.importedCount} 条已导入，${response.skippedCount} 条已跳过`,
    });
  } catch (e) {
    syncError.value = e instanceof Error ? e.message : '导入失败';
    console.error('[ReviewDataSync] Import failed:', e);
  } finally {
    syncImporting.value = false;
    target.value = '';
  }
}
</script>

<template>
  <div class="rounded-md border border-border bg-background p-3">
    <div class="flex items-center justify-between">
      <div class="text-sm font-semibold">数据同步（后端）</div>
      <label class="flex items-center gap-2 text-xs text-muted-foreground">
        <input v-model="syncOverwrite" type="checkbox" />
        导入覆盖
      </label>
    </div>
    <div class="mt-2 flex gap-2">
      <button type="button"
        class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs hover:bg-muted disabled:opacity-50"
        :disabled="syncExporting"
        @click="exportFromServer">
        <Download class="h-3.5 w-3.5" />
        导出(后端)
      </button>
      <label class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs hover:bg-muted disabled:opacity-50 cursor-pointer"
        :class="{ 'opacity-50 pointer-events-none': syncImporting }">
        <FileText class="h-3.5 w-3.5" />
        导入(后端)
        <input type="file" accept="application/json" class="hidden" @change="importFromFile" />
      </label>
    </div>
    <div class="mt-2 text-xs text-muted-foreground">
      说明：导出/导入走 `/api/review/sync/export|import`；勾选“导入覆盖”会用文件中的任务与记录覆盖同标识现有数据，未勾选时保留现有数据并跳过重复项。
    </div>
    <div class="mt-1 text-xs text-muted-foreground">
      导入成功后会刷新当前工作台任务、确认记录与相关上下文，优先保留当前选中的任务焦点。
    </div>
    <div v-if="currentTask" class="mt-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
      当前同步上下文：<span class="font-medium text-foreground">{{ currentTaskTitle }}</span>
      <span v-if="currentTaskFormId"> · Form ID {{ currentTaskFormId }}</span>
      <span v-else> · 未绑定正式 formId，将仅按任务 ID 尝试重新挂载上下文</span>
    </div>
    <div v-if="syncError" class="mt-2 text-xs text-red-600">{{ syncError }}</div>
  </div>
</template>
