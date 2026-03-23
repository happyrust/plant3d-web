<!-- 简化版 ReviewPanel.vue 示例 -->
<!-- 将原来的 1155 行简化为约 200 行 -->

<script setup lang="ts">
import { computed, ref } from 'vue';

import AuxiliaryDataSection from './sections/AuxiliaryDataSection.vue';
import ConfirmedRecordsSection from './sections/ConfirmedRecordsSection.vue';
import DataSyncSection from './sections/DataSyncSection.vue';
import TaskContextSection from './sections/TaskContextSection.vue';
import WorkflowActionSection from './sections/WorkflowActionSection.vue';

import type { WorkflowNode } from '@/types/auth';

import { reviewSyncExport, reviewSyncImport } from '@/api/reviewApi';
import { useReviewStore } from '@/composables/useReviewStore';
import { useUserStore } from '@/composables/useUserStore';
import { emitToast } from '@/ribbon/toastBus';

const reviewStore = useReviewStore();
const userStore = useUserStore();

// 当前任务
const currentTask = computed(() => reviewStore.currentTask.value);
const confirmedRecords = computed(() => reviewStore.sortedConfirmedRecords.value);

// 加载状态
const workflowLoading = ref(false);
const syncLoading = ref(false);

// ============ 流转动作处理 ============
async function handleSubmit(comment?: string) {
  if (!currentTask.value) return;
  
  workflowLoading.value = true;
  try {
    await userStore.submitTaskToNextNode(currentTask.value.id, comment);
    emitToast({ message: '提交成功', type: 'success' });
    await refreshTask();
  } catch (error) {
    emitToast({ 
      message: error instanceof Error ? error.message : '提交失败', 
      type: 'error' 
    });
  } finally {
    workflowLoading.value = false;
  }
}

async function handleReturn(targetNode: WorkflowNode, reason: string) {
  if (!currentTask.value) return;
  
  workflowLoading.value = true;
  try {
    await userStore.returnTaskToNode(currentTask.value.id, targetNode, reason);
    emitToast({ message: '退回成功', type: 'success' });
    await refreshTask();
  } catch (error) {
    emitToast({ 
      message: error instanceof Error ? error.message : '退回失败', 
      type: 'error' 
    });
  } finally {
    workflowLoading.value = false;
  }
}

async function refreshTask() {
  await userStore.loadReviewTasks();
  if (currentTask.value) {
    await reviewStore.loadWorkflowHistory(currentTask.value.id);
  }
}

// ============ 确认记录处理 ============
async function handleDeleteRecord(recordId: string) {
  try {
    await reviewStore.deleteConfirmedRecord(recordId);
    emitToast({ message: '删除成功', type: 'success' });
  } catch (error) {
    emitToast({ message: '删除失败', type: 'error' });
  }
}

async function handleClearAllRecords() {
  if (!confirm('确定要清空所有确认记录吗？')) return;
  
  try {
    await reviewStore.clearAllConfirmedRecords();
    emitToast({ message: '清空成功', type: 'success' });
  } catch (error) {
    emitToast({ message: '清空失败', type: 'error' });
  }
}

// ============ 辅助数据处理 ============
type XeokitViewerStub = {
  cameraFlight?: { flyTo: (opts: { aabb?: unknown }) => void };
  scene?: {
    getAABB?: (ids: string[]) => unknown;
    setObjectsHighlighted?: (ids: string[], highlighted: boolean) => void;
  };
};

type AuxiliaryLocateItem = {
  ObjectOne?: string;
  ObjectTow?: string;
};

function handleLocate(item: AuxiliaryLocateItem) {
  const viewer = (window as Window & { __xeokit_viewer?: XeokitViewerStub }).__xeokit_viewer;
  if (!viewer) return;

  const objectIds = [item.ObjectOne, item.ObjectTow].filter(Boolean) as string[];
  if (objectIds.length > 0) {
    viewer.cameraFlight?.flyTo({ aabb: viewer.scene?.getAABB?.(objectIds) });
  }
}

function handleHighlight(item: AuxiliaryLocateItem) {
  const viewer = (window as Window & { __xeokit_viewer?: XeokitViewerStub }).__xeokit_viewer;
  if (!viewer) return;

  const objectIds = [item.ObjectOne, item.ObjectTow].filter(Boolean) as string[];
  viewer.scene?.setObjectsHighlighted?.(objectIds, true);
}

// ============ 数据同步处理 ============
async function handleExport() {
  syncLoading.value = true;
  try {
    const resp = await reviewSyncExport({
      includeAttachments: true,
      includeComments: true,
      includeRecords: true,
    });
    
    if (!resp.success) throw new Error(resp.error_message || '导出失败');
    
    const json = JSON.stringify(resp, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `review-export-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    emitToast({ message: '导出成功', type: 'success' });
  } catch (error) {
    emitToast({ message: '导出失败', type: 'error' });
  } finally {
    syncLoading.value = false;
  }
}

async function handleImport(file: File, overwrite: boolean) {
  syncLoading.value = true;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    const resp = await reviewSyncImport({
      tasks: data.tasks || [],
      overwrite,
    });
    
    if (!resp.success) throw new Error(resp.error_message || '导入失败');
    
    await userStore.loadReviewTasks();
    emitToast({ message: '导入成功', type: 'success' });
  } catch (error) {
    emitToast({ message: '导入失败', type: 'error' });
  } finally {
    syncLoading.value = false;
  }
}
</script>

<template>
  <div class="review-panel h-full overflow-y-auto bg-gray-50">
    <!-- 任务上下文 -->
    <TaskContextSection :task="currentTask"
      :loading="workflowLoading" />
    
    <!-- 流转动作 -->
    <WorkflowActionSection :task="currentTask"
      :loading="workflowLoading"
      @submit="handleSubmit"
      @return="handleReturn"
      @refresh="refreshTask" />
    
    <!-- 确认记录 -->
    <ConfirmedRecordsSection :task-id="currentTask?.id"
      :records="confirmedRecords"
      @delete="handleDeleteRecord"
      @clear-all="handleClearAllRecords"
      @refresh="refreshTask" />
    
    <!-- 辅助数据 -->
    <AuxiliaryDataSection :task="currentTask"
      :form-id="currentTask?.formId"
      @locate="handleLocate"
      @highlight="handleHighlight" />
    
    <!-- 数据同步 -->
    <DataSyncSection :loading="syncLoading"
      @export="handleExport"
      @import="handleImport" />
  </div>
</template>
