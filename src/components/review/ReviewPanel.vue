<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  CheckCircle,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileText,
  Filter,
  MessageSquare,
  Paperclip,
  Plus,
  Ruler,
  Trash2,
  XCircle,
} from 'lucide-vue-next';

import CollisionResultList from './CollisionResultList.vue';
import ReviewAuxData from './ReviewAuxData.vue';
import ReviewDataSync from './ReviewDataSync.vue';
import {
  canReturnAtCurrentNode,
  canSubmitAtCurrentNode,
  confirmCurrentDataSafely,
  getSubmitActionLabel,
} from './reviewPanelActions';
import WorkflowReturnDialog from './WorkflowReturnDialog.vue';
import WorkflowSubmitDialog from './WorkflowSubmitDialog.vue';

import type { ReviewAttachment, ReviewTask, WorkflowNode } from '@/types/auth';

import {
  reviewGetAuxData,
  reviewGetCollisionData,
  type CollisionItem,
  reviewSyncExport,
  reviewSyncImport,
} from '@/api/reviewApi';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { WORKFLOW_NODE_NAMES } from '@/types/auth';

const reviewStore = useReviewStore();
const toolStore = useToolStore();
const userStore = useUserStore();
const viewerContext = useViewerContext();

const embedLandingState = ref<{
  target?: string;
  formId?: string | null;
  primaryPanelId?: string;
  visiblePanelIds?: string[];
} | null>(null);

if (typeof sessionStorage !== 'undefined') {
  const storedLandingState = sessionStorage.getItem('embed_landing_state');
  if (storedLandingState) {
    try {
      embedLandingState.value = JSON.parse(storedLandingState);
    } catch {
      console.warn('[ReviewPanel] 无法解析嵌入模式落点状态');
    }
  }
}

const confirmNote = ref('');

const showMeasurementMenu = ref(false);

// 当前任务信息
const currentTask = computed(() => reviewStore.currentTask.value);

// 格式化文件大小
function formatFileSize(bytes?: number): string {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// 格式化日期
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

// 下载附件
function downloadAttachment(attachment: ReviewAttachment) {
  const link = document.createElement('a');
  link.href = attachment.url;
  link.download = attachment.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 模型过滤相关
const isFilteringByTask = ref(false);

// 审核操作相关
const canSubmitToNextNode = computed(() => canSubmitAtCurrentNode(currentTask.value?.currentNode));
const canReturnToPrevNode = computed(() => canReturnAtCurrentNode(currentTask.value?.currentNode));
const submitActionLabel = computed(() => getSubmitActionLabel(currentTask.value?.currentNode));
// ============ 同步（后端） ============

const syncExporting = ref(false);
const syncImporting = ref(false);
const syncOverwrite = ref(false);

async function exportFromServer() {
  if (syncExporting.value) return;
  syncExporting.value = true;
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
    link.download = `review-sync-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } finally {
    syncExporting.value = false;
  }
}

async function importFromFile(event: Event) {
  if (syncImporting.value) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  syncImporting.value = true;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    const tasks = (parsed as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) throw new Error('导入文件格式不正确：缺少 tasks 数组');

    const resp = await reviewSyncImport({
      tasks: tasks as ReviewTask[],
      overwrite: syncOverwrite.value,
    });
    if (!resp.success) throw new Error(resp.error_message || '导入失败');
    await userStore.loadReviewTasks();
  } finally {
    syncImporting.value = false;
    input.value = '';
  }
}

// ============ 辅助数据（碰撞/外部辅助） ============

const collisionRefno = ref('');
const collisionLoading = ref(false);
const collisionError = ref<string | null>(null);
const collisionData = ref<Awaited<ReturnType<typeof reviewGetCollisionData>> | null>(null);

async function queryCollision() {
  collisionLoading.value = true;
  collisionError.value = null;
  try {
    collisionData.value = await reviewGetCollisionData({
      refno: collisionRefno.value.trim() || undefined,
      limit: 100,
      offset: 0,
    });
  } catch (e) {
    collisionError.value = e instanceof Error ? e.message : '查询失败';
  } finally {
    collisionLoading.value = false;
  }
}

function handleCollisionLocate(item: CollisionItem) {
  // 通过构件名称定位三维视图
  const viewer = (window as any).__xeokit_viewer;
  if (!viewer) return;
  const objectIds = [item.ObjectOne, item.ObjectTow].filter(Boolean);
  if (objectIds.length > 0) {
    viewer.cameraFlight?.flyTo({ aabb: viewer.scene?.getAABB(objectIds) }, () => {});
  }
}

function handleCollisionHighlight(item: CollisionItem) {
  const viewer = (window as any).__xeokit_viewer;
  if (!viewer) return;
  // 先清除旧的高亮
  viewer.scene?.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
  const objectIds = [item.ObjectOne, item.ObjectTow].filter(Boolean);
  if (objectIds.length > 0) {
    viewer.scene?.setObjectsHighlighted(objectIds, true);
  }
}

const AUX_UCODE_KEY = 'review_aux_ucode';
const AUX_UKEY_KEY = 'review_aux_ukey';
const auxUCode = ref(localStorage.getItem(AUX_UCODE_KEY) || '');
const auxUKey = ref(localStorage.getItem(AUX_UKEY_KEY) || '');
watch(auxUCode, (v) => localStorage.setItem(AUX_UCODE_KEY, v));
watch(auxUKey, (v) => localStorage.setItem(AUX_UKEY_KEY, v));

const auxProjectId = ref('');
const auxMajor = ref('general');
const auxFormId = ref('');
const auxLoading = ref(false);
const auxError = ref<string | null>(null);
const auxData = ref<Awaited<ReturnType<typeof reviewGetAuxData>> | null>(null);

async function fetchAuxDataForCurrentTask() {
  if (!currentTask.value) return;
  auxLoading.value = true;
  auxError.value = null;
  try {
    const requesterId = userStore.currentUser.value?.id || 'guest';
    const formId = auxFormId.value.trim() || currentTask.value.id;
    const projectId = auxProjectId.value.trim() || 'default';
    const refnos = currentTask.value.components.map((c) => c.refNo).filter(Boolean);
    auxData.value = await reviewGetAuxData(
      {
        project_id: projectId,
        model_refnos: refnos,
        major: auxMajor.value.trim() || 'general',
        requester_id: requesterId,
        page: 1,
        page_size: 100,
        form_id: formId,
        new_search: true,
      },
      { uCode: auxUCode.value.trim(), uKey: auxUKey.value.trim() }
    );
  } catch (e) {
    auxData.value = null;
    auxError.value = e instanceof Error ? e.message : '请求失败';
  } finally {
    auxLoading.value = false;
  }
}

const workflowLoading = ref(false);
const workflowError = ref<string | null>(null);
const workflow = ref<Awaited<ReturnType<typeof userStore.getTaskWorkflowHistory>> | null>(null);

const showSubmitDialog = ref(false);
const submitComment = ref('');
const showReturnDialog = ref(false);
const returnReason = ref('');
const workflowActionLoading = ref(false);

const currentNode = computed<WorkflowNode>(() => currentTask.value?.currentNode ?? 'sj');
const submitTargetNode = computed<WorkflowNode>(() => {
  switch (currentNode.value) {
    case 'sj':
      return 'jd';
    case 'jd':
      return 'sh';
    case 'sh':
    case 'pz':
      return 'pz';
    default:
      return 'jd';
  }
});

function getWorkflowActionLabel(action: string): string {
  switch (action) {
    case 'submit':
      return '提交';
    case 'return':
      return '驳回';
    case 'approve':
      return '批准';
    case 'reject':
      return '拒绝';
    default:
      return action;
  }
}

async function loadWorkflow(taskId: string) {
  workflowLoading.value = true;
  workflowError.value = null;
  try {
    const resp = await userStore.getTaskWorkflowHistory(taskId);
    if (!resp.success) {
      workflow.value = null;
      workflowError.value = resp.error_message || '获取工作流失败';
      return;
    }
    workflow.value = resp;
  } catch (e) {
    workflow.value = null;
    workflowError.value = e instanceof Error ? e.message : '获取工作流失败';
  } finally {
    workflowLoading.value = false;
  }
}

async function refreshCurrentTask(taskId: string) {
  await userStore.loadReviewTasks();
  const updated = userStore.reviewTasks.value.find((t) => t.id === taskId);
  if (updated) {
    await reviewStore.setCurrentTask(updated);
  }
}

async function handleSubmitToNextNode() {
  if (!currentTask.value || !canSubmitToNextNode.value) return;
  workflowActionLoading.value = true;
  workflowError.value = null;
  try {
    await userStore.submitTaskToNextNode(currentTask.value.id, submitComment.value.trim() || undefined);
    await refreshCurrentTask(currentTask.value.id);
    await loadWorkflow(currentTask.value.id);
    showSubmitDialog.value = false;
    submitComment.value = '';
  } catch (e) {
    workflowError.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    workflowActionLoading.value = false;
  }
}

async function handleReturnToNode() {
  if (!currentTask.value || !canReturnToPrevNode.value) return;
  if (!returnReason.value.trim()) return;
  workflowActionLoading.value = true;
  workflowError.value = null;
  try {
    await userStore.returnTaskToNode(currentTask.value.id, 'sj', returnReason.value.trim());
    await refreshCurrentTask(currentTask.value.id);
    await loadWorkflow(currentTask.value.id);
    showReturnDialog.value = false;
    returnReason.value = '';
  } catch (e) {
    workflowError.value = e instanceof Error ? e.message : '驳回失败';
  } finally {
    workflowActionLoading.value = false;
  }
}

function toggleSubmitDialog() {
  if (workflowLoading.value || workflowActionLoading.value || !canSubmitToNextNode.value) return;
  showReturnDialog.value = false;
  returnReason.value = '';
  showSubmitDialog.value = !showSubmitDialog.value;
}

function toggleReturnDialog() {
  if (workflowLoading.value || workflowActionLoading.value || !canReturnToPrevNode.value) return;
  showSubmitDialog.value = false;
  submitComment.value = '';
  showReturnDialog.value = !showReturnDialog.value;
}

function closeSubmitDialog() {
  showSubmitDialog.value = false;
  submitComment.value = '';
}

function closeReturnDialog() {
  showReturnDialog.value = false;
  returnReason.value = '';
}

function handleClearConfirmedRecords() {
  if (!window.confirm('确定要清空所有已确认的数据？此操作不可撤销。')) return;
  reviewStore.clearConfirmedRecords();
}

// 根据任务过滤模型显示
function filterModelByTask() {
  const viewer = viewerContext.viewerRef.value;
  if (!viewer || !currentTask.value) return;
  
  // 先隐藏所有模型
  const allObjectIds = viewer.scene.objectIds;
  if (allObjectIds && allObjectIds.length > 0) {
    viewer.scene.setObjectsVisible(allObjectIds, false);
  }
  
  // 只显示任务相关的构件
  const taskRefNos = currentTask.value.components
    .map(comp => String(comp.refNo || '').replace(/\//g, '_'))
    .filter(Boolean);

  if (taskRefNos.length > 0) {
    viewer.scene.setObjectsVisible(taskRefNos, true);
    const aabb = viewer.scene.getAABB(taskRefNos);
    if (aabb) {
      viewer.cameraFlight.flyTo({ aabb, duration: 1, fit: true });
    }
  }
  
  isFilteringByTask.value = true;
}

// 清除模型过滤
function clearModelFilter() {
  const viewer = viewerContext.viewerRef.value;
  if (!viewer) return;
  
  // 显示所有模型
  const allObjectIds = viewer.scene.objectIds;
  if (allObjectIds && allObjectIds.length > 0) {
    viewer.scene.setObjectsVisible(allObjectIds, true);
  }
  
  isFilteringByTask.value = false;
}

// 监听当前任务变化，自动应用过滤
watch(currentTask, (newTask) => {
  if (newTask && newTask.components.length > 0) {
    // 有新任务时自动应用过滤
    nextTick(() => {
      filterModelByTask();
    });
  } else {
    // 清除任务时清除过滤
    clearModelFilter();
  }

  if (newTask) {
    showSubmitDialog.value = false;
    submitComment.value = '';
    showReturnDialog.value = false;
    returnReason.value = '';
    loadWorkflow(newTask.id);
  } else {
    workflow.value = null;
    workflowError.value = null;
    showSubmitDialog.value = false;
    submitComment.value = '';
    showReturnDialog.value = false;
    returnReason.value = '';
  }
});

const pendingAnnotationCount = computed(() => {
  return (
    toolStore.annotationCount.value +
    toolStore.cloudAnnotationCount.value +
    toolStore.rectAnnotationCount.value +
    toolStore.obbAnnotationCount.value
  );
});

const pendingMeasurementCount = computed(() => toolStore.measurementCount.value);

const hasPendingData = computed(() => {
  return pendingAnnotationCount.value > 0 || pendingMeasurementCount.value > 0;
});
const confirmSaving = ref(false);
const confirmError = ref<string | null>(null);

async function confirmCurrentData() {
  if (confirmSaving.value) return;

  confirmSaving.value = true;
  confirmError.value = null;
  try {
    await confirmCurrentDataSafely({
      hasPendingData: hasPendingData.value,
      payload: {
        type: 'batch' as const,
        annotations: [...toolStore.annotations.value],
        cloudAnnotations: [...toolStore.cloudAnnotations.value],
        rectAnnotations: [...toolStore.rectAnnotations.value],
        obbAnnotations: [...toolStore.obbAnnotations.value],
        measurements: [...toolStore.measurements.value],
        note: confirmNote.value.trim(),
      },
      addConfirmedRecord: reviewStore.addConfirmedRecord,
      clearAll: () => {
        toolStore.clearAll();
      },
      resetNote: () => {
        confirmNote.value = '';
      },
    });
  } catch (e) {
    confirmError.value = e instanceof Error ? e.message : '确认当前数据失败';
  } finally {
    confirmSaving.value = false;
  }
}

function exportData() {
  const json = reviewStore.exportReviewData();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `review-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function startAnnotation() {
  ensurePanelAndActivate('annotation');
  toolStore.setToolMode('annotation');
}

function startDistanceMeasurement() {
  toolStore.setToolMode('measure_distance');
  showMeasurementMenu.value = false;
}

function startAngleMeasurement() {
  toolStore.setToolMode('measure_angle');
  showMeasurementMenu.value = false;
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.relative')) {
    showMeasurementMenu.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div class="flex h-full flex-col gap-3 overflow-y-auto p-3">
    <!-- 当前任务信息 -->
    <div v-if="currentTask"
      class="rounded-md border border-border bg-background p-3"
      data-testid="reviewer-landing-workspace">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <ClipboardCheck class="h-5 w-5 text-primary" />
          <span class="text-sm font-semibold">当前审核任务</span>
        </div>
        <div class="flex items-center gap-2">
          <button v-if="isFilteringByTask"
            type="button"
            title="显示所有模型"
            class="h-6 rounded px-2 text-xs bg-orange-100 text-orange-700 hover:bg-orange-200"
            @click="clearModelFilter">
            <Filter class="h-3 w-3 inline mr-1" />
            已过滤
          </button>
          <button type="button"
            class="h-6 rounded px-2 text-xs hover:bg-muted"
            title="关闭任务"
            @click="reviewStore.clearCurrentTask()">
            <XCircle class="h-4 w-4" />
          </button>
        </div>
      </div>
      <div class="mt-2 space-y-1">
        <div class="text-sm font-medium">{{ currentTask.title }}</div>
        <div class="text-xs text-muted-foreground">模型: {{ currentTask.modelName }}</div>
        <div class="text-xs text-muted-foreground">
          发起人: {{ currentTask.requesterName }} | 
          校核: {{ currentTask.checkerName || currentTask.reviewerName || '-' }} |
          审核: {{ currentTask.approverName || '-' }} |
          构件数: {{ currentTask.components.length }}
        </div>
        <div class="mt-2 rounded-md bg-muted/50 p-2 text-xs">
          <div class="flex items-center justify-between">
            <div class="text-muted-foreground">
              当前节点:
              <span class="font-medium text-foreground">
                {{ WORKFLOW_NODE_NAMES[(currentTask.currentNode || 'sj') as WorkflowNode] }}
              </span>
            </div>
            <div class="flex gap-2">
              <button type="button"
                class="h-7 rounded px-2 text-xs border hover:bg-muted disabled:opacity-50"
                :disabled="workflowLoading || workflowActionLoading || !canSubmitToNextNode"
                @click="toggleSubmitDialog">
                {{ submitActionLabel }}
              </button>
              <button type="button"
                class="h-7 rounded px-2 text-xs border text-red-600 hover:bg-muted disabled:opacity-50"
                :disabled="workflowLoading || workflowActionLoading || !canReturnToPrevNode"
                @click="toggleReturnDialog">
                驳回到设计
              </button>
            </div>
          </div>

          <div v-if="workflowLoading" class="mt-2 text-muted-foreground">正在加载工作流...</div>
          <div v-else-if="workflowError" class="mt-2 text-red-600">{{ workflowError }}</div>
          <div v-else-if="workflow && workflow.history.length > 0" class="mt-2 space-y-1">
            <div v-for="(step, idx) in workflow.history"
              :key="idx"
              class="flex items-center justify-between text-muted-foreground">
              <span>
                {{ WORKFLOW_NODE_NAMES[(step.node || 'sj') as WorkflowNode] }} · {{ getWorkflowActionLabel(step.action) }}
              </span>
              <span>{{ formatDate(step.timestamp) }}</span>
            </div>
          </div>
        </div>
        <div class="flex gap-2 mt-2">
          <button type="button"
            class="flex-1 h-7 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
            @click="filterModelByTask">
            <Filter class="h-3 w-3 inline mr-1" />
            只显示任务构件
          </button>
          <button v-if="isFilteringByTask"
            type="button"
            class="flex-1 h-7 text-xs border rounded hover:bg-muted"
            @click="clearModelFilter">
            显示全部
          </button>
        </div>
        <div class="mt-3 border-t pt-3 text-xs text-muted-foreground">
          当前操作统一走工作流流转：提交到下一节点或驳回到设计节点。
        </div>
      </div>
    </div>

    <div v-else-if="embedLandingState?.target === 'reviewer'"
      data-testid="reviewer-landing-workspace"
      class="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900">
      <div class="flex items-center justify-between gap-2">
        <div>
          <div class="text-sm font-semibold" data-testid="reviewer-landing-cta">自动进入校审/待处理工作区</div>
          <div class="mt-1 text-xs text-blue-700">
            审批相关角色打开同一 form-id 时，首屏将落在待处理/校审工作区，无需手动切换面板。
          </div>
        </div>
        <div v-if="embedLandingState.formId"
          data-testid="reviewer-lineage-form-id"
          class="rounded-full bg-white px-3 py-1 text-xs text-blue-700">
          Lineage: {{ embedLandingState.formId }}
        </div>
      </div>
    </div>

    <!-- 校审模式开关 -->
    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <ClipboardCheck class="h-5 w-5 text-primary" />
          <span class="text-sm font-semibold">校审模式</span>
        </div>
        <button type="button"
          class="h-8 rounded-md px-3 text-sm"
          :class="
            reviewStore.reviewMode.value
              ? 'bg-primary text-primary-foreground'
              : 'border border-input bg-background hover:bg-muted'
          "
          @click="reviewStore.toggleReviewMode()">
          {{ reviewStore.reviewMode.value ? '已启用' : '已关闭' }}
        </button>
      </div>
      <div class="mt-2 text-xs text-muted-foreground">
        启用后可在三维视图中确认批注和测量数据。
      </div>
    </div>

    <!-- 待确认数据 -->
    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">待确认数据</div>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <div class="flex items-center gap-2 rounded-md bg-muted/50 p-2">
          <MessageSquare class="h-4 w-4 text-blue-500" />
          <span class="text-sm">批注</span>
          <span class="ml-auto font-semibold">{{ pendingAnnotationCount }}</span>
          <button type="button"
            class="ml-2 rounded p-1 text-blue-600 hover:bg-blue-100"
            title="创建批注"
            @click="startAnnotation">
            <Plus class="h-3.5 w-3.5" />
          </button>
        </div>
        <div class="relative flex items-center gap-2 rounded-md bg-muted/50 p-2">
          <Ruler class="h-4 w-4 text-green-500" />
          <span class="text-sm">测量</span>
          <span class="ml-auto font-semibold">{{ pendingMeasurementCount }}</span>
          <button type="button"
            class="ml-2 rounded p-1 text-green-600 hover:bg-green-100"
            title="创建测量"
            @click="showMeasurementMenu = !showMeasurementMenu">
            <Plus class="h-3.5 w-3.5" />
          </button>
          
          <!-- 测量类型下拉菜单 -->
          <div v-if="showMeasurementMenu"
            class="absolute right-0 top-full z-10 mt-1 rounded-md border border-border bg-background p-1 shadow-md">
            <button type="button"
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              @click="startDistanceMeasurement">
              <Ruler class="h-3.5 w-3.5" />
              距离测量
            </button>
            <button type="button"
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              @click="startAngleMeasurement">
              角度测量
            </button>
          </div>
        </div>
      </div>

      <div v-if="hasPendingData" class="mt-3">
        <label class="text-xs text-muted-foreground">备注（可选）</label>
        <input v-model="confirmNote"
          class="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          placeholder="输入确认备注..." />
      </div>

      <button type="button"
        class="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        :disabled="!hasPendingData || confirmSaving"
        @click="confirmCurrentData">
        <CheckCircle class="h-4 w-4" />
        {{ confirmSaving ? '保存中...' : '确认当前数据' }}
      </button>
      <div v-if="confirmError" class="mt-2 text-xs text-red-600">{{ confirmError }}</div>
    </div>

    <!-- 附件列表 -->
    <div v-if="currentTask && currentTask.attachments && currentTask.attachments.length > 0" class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">附件文件 ({{ currentTask.attachments.length }})</div>
      <div class="mt-2 space-y-2 max-h-48 overflow-y-auto">
        <div v-for="attachment in currentTask.attachments"
          :key="attachment.id"
          class="flex items-center gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted cursor-pointer"
          @click="downloadAttachment(attachment)">
          <Paperclip class="h-4 w-4 text-gray-500" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ attachment.name }}</div>
            <div class="text-xs text-muted-foreground">
              {{ formatFileSize(attachment.size) }} · {{ formatDate(attachment.uploadedAt) }}
            </div>
          </div>
          <Download class="h-4 w-4 text-gray-400" />
        </div>
      </div>
    </div>

    <!-- 已确认统计 -->
    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <ClipboardList class="h-5 w-5 text-green-500" />
          <span class="text-sm font-semibold">已确认数据</span>
        </div>
        <span class="text-xs text-muted-foreground">
          {{ reviewStore.confirmedRecordCount }} 批次
        </span>
      </div>

      <div class="mt-2 grid grid-cols-2 gap-2">
        <div class="flex items-center gap-2 rounded-md bg-green-50 p-2 dark:bg-green-950">
          <MessageSquare class="h-4 w-4 text-green-600" />
          <span class="text-sm">批注</span>
          <span class="ml-auto font-semibold text-green-600">
            {{ reviewStore.totalConfirmedAnnotations }}
          </span>
        </div>
        <div class="flex items-center gap-2 rounded-md bg-green-50 p-2 dark:bg-green-950">
          <Ruler class="h-4 w-4 text-green-600" />
          <span class="text-sm">测量</span>
          <span class="ml-auto font-semibold text-green-600">
            {{ reviewStore.totalConfirmedMeasurements }}
          </span>
        </div>
      </div>

      <div class="mt-3 flex gap-2">
        <button type="button"
          class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs hover:bg-muted disabled:opacity-50"
          :disabled="reviewStore.confirmedRecordCount.value === 0"
          @click="exportData">
          <Download class="h-3.5 w-3.5" />
          导出JSON
        </button>
        <button type="button"
          class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs text-destructive hover:bg-muted disabled:opacity-50"
          :disabled="reviewStore.confirmedRecordCount.value === 0"
          @click="handleClearConfirmedRecords()">
          <Trash2 class="h-3.5 w-3.5" />
          清空
        </button>
      </div>
    </div>

    <!-- 后端数据同步 -->
    <ReviewDataSync />

    <!-- 辅助校审数据 -->
    <ReviewAuxData />

    <WorkflowSubmitDialog :visible="showSubmitDialog"
      :current-node="currentNode"
      :target-node="submitTargetNode"
      :loading="workflowActionLoading"
      @update:visible="(visible) => { if (!visible) closeSubmitDialog(); }"
      @confirm="(comment) => { submitComment = comment ?? ''; void handleSubmitToNextNode(); }" />

    <WorkflowReturnDialog :visible="showReturnDialog"
      :current-node="currentNode"
      :loading="workflowActionLoading"
      @update:visible="(visible) => { if (!visible) closeReturnDialog(); }"
      @confirm="(_targetNode, reason) => { returnReason = reason; void handleReturnToNode(); }" />

    <!-- 确认历史 -->
    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">确认历史</div>

      <div v-if="reviewStore.sortedConfirmedRecords.value.length === 0"
        class="mt-2 text-sm text-muted-foreground">
        暂无确认记录。
      </div>

      <div v-else class="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
        <div v-for="record in reviewStore.sortedConfirmedRecords.value"
          :key="record.id"
          class="rounded-md border border-border p-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground">
              {{ formatDate(record.confirmedAt) }}
            </span>
            <button type="button"
              class="rounded p-1 text-destructive hover:bg-muted"
              title="删除"
              @click="reviewStore.removeConfirmedRecord(record.id)">
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </div>

          <div class="mt-1 flex gap-3 text-xs">
            <span class="text-blue-600">
              批注:
              {{
                record.annotations.length +
                  record.cloudAnnotations.length +
                  record.rectAnnotations.length +
                  record.obbAnnotations.length
              }}
            </span>
            <span class="text-green-600">测量: {{ record.measurements.length }}</span>
          </div>

          <div v-if="record.note" class="mt-1 truncate text-xs text-muted-foreground">
            备注: {{ record.note }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
