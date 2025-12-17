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

import type { ReviewAttachment } from '@/types/auth';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { useViewerContext } from '@/composables/useViewerContext';

const reviewStore = useReviewStore();
const toolStore = useToolStore();
const userStore = useUserStore();
const viewerContext = useViewerContext();

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
const showRejectDialog = ref(false);
const rejectComment = ref('');

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
  const taskRefNos = currentTask.value.components.map(comp => comp.refNo);
  const visibleObjectIds: string[] = [];
  
  // 遍历所有对象，找出匹配的构件
  for (const objectId of allObjectIds || []) {
    const object = viewer.scene.objects[objectId];
    if (object && 'metaObject' in object && object.metaObject) {
      const metaObject = object.metaObject as { properties?: Record<string, unknown> };
      const refNo = metaObject.properties?.RefNo || 
                    metaObject.properties?.refno;
      if (refNo && taskRefNos.includes(String(refNo))) {
        visibleObjectIds.push(objectId);
      }
    }
  }
  
  // 显示匹配的构件
  if (visibleObjectIds.length > 0) {
    viewer.scene.setObjectsVisible(visibleObjectIds, true);
    // 飞行到查看这些构件
    viewer.cameraFlight.flyTo({
      aabb: viewer.scene.getAABB(visibleObjectIds),
      duration: 1
    });
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
});

// 审核操作函数
function handleApprove() {
  if (!currentTask.value) return;
  
  // 更新任务状态为通过
  userStore.updateTaskStatus(currentTask.value.id, 'approved', '审核通过');
  
  // 清除当前任务
  reviewStore.clearCurrentTask();
  
  // 显示成功提示
  // TODO: 添加 toast 提示
  console.log('任务已通过审核');
}

function handleReject() {
  if (!currentTask.value) return;
  
  // 更新任务状态为驳回
  userStore.updateTaskStatus(currentTask.value.id, 'rejected', rejectComment.value);
  
  // 清除当前任务
  reviewStore.clearCurrentTask();
  
  // 关闭对话框
  showRejectDialog.value = false;
  rejectComment.value = '';
  
  // 显示成功提示
  // TODO: 添加 toast 提示
  console.log('任务已驳回');
}

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

function confirmCurrentData() {
  if (!hasPendingData.value) return;

  reviewStore.addConfirmedRecord({
    type: 'batch',
    annotations: [...toolStore.annotations.value],
    cloudAnnotations: [...toolStore.cloudAnnotations.value],
    rectAnnotations: [...toolStore.rectAnnotations.value],
    obbAnnotations: [...toolStore.obbAnnotations.value],
    measurements: [...toolStore.measurements.value],
    note: confirmNote.value.trim(),
  });

  toolStore.clearAll();
  confirmNote.value = '';
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
    <div v-if="currentTask" class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <ClipboardCheck class="h-5 w-5 text-primary" />
          <span class="text-sm font-semibold">当前审核任务</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="isFilteringByTask"
            type="button"
            title="显示所有模型"
            class="h-6 rounded px-2 text-xs bg-orange-100 text-orange-700 hover:bg-orange-200"
            @click="clearModelFilter"
          >
            <Filter class="h-3 w-3 inline mr-1" />
            已过滤
          </button>
          <button
            type="button"
            class="h-6 rounded px-2 text-xs hover:bg-muted"
            @click="reviewStore.clearCurrentTask()"
            title="关闭任务"
          >
            <XCircle class="h-4 w-4" />
          </button>
        </div>
      </div>
      <div class="mt-2 space-y-1">
        <div class="text-sm font-medium">{{ currentTask.title }}</div>
        <div class="text-xs text-muted-foreground">模型: {{ currentTask.modelName }}</div>
        <div class="text-xs text-muted-foreground">
          发起人: {{ currentTask.requesterName }} | 
          构件数: {{ currentTask.components.length }}
        </div>
        <div class="flex gap-2 mt-2">
          <button
            type="button"
            class="flex-1 h-7 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
            @click="filterModelByTask"
          >
            <Filter class="h-3 w-3 inline mr-1" />
            只显示任务构件
          </button>
          <button
            v-if="isFilteringByTask"
            type="button"
            class="flex-1 h-7 text-xs border rounded hover:bg-muted"
            @click="clearModelFilter"
          >
            显示全部
          </button>
        </div>
        <!-- 审核操作按钮 -->
        <div class="flex gap-2 mt-3 pt-3 border-t">
          <button
            type="button"
            class="flex-1 h-8 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-1"
            @click="handleApprove"
          >
            <CheckCircle class="h-3 w-3" />
            通过
          </button>
          <button
            type="button"
            class="flex-1 h-8 text-xs bg-red-500 text-white rounded hover:bg-red-600 flex items-center justify-center gap-1"
            @click="showRejectDialog = true"
          >
            <XCircle class="h-3 w-3" />
            驳回
          </button>
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
        :disabled="!hasPendingData"
        @click="confirmCurrentData">
        <CheckCircle class="h-4 w-4" />
        确认当前数据
      </button>
    </div>

    <!-- 附件列表 -->
    <div v-if="currentTask && currentTask.attachments && currentTask.attachments.length > 0" class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">附件文件 ({{ currentTask.attachments.length }})</div>
      <div class="mt-2 space-y-2 max-h-48 overflow-y-auto">
        <div
          v-for="attachment in currentTask.attachments"
          :key="attachment.id"
          class="flex items-center gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted cursor-pointer"
          @click="downloadAttachment(attachment)"
        >
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
          @click="reviewStore.clearConfirmedRecords()">
          <Trash2 class="h-3.5 w-3.5" />
          清空
        </button>
      </div>
    </div>

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

    <!-- 驳回对话框 -->
    <div v-if="showRejectDialog" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 w-96 max-w-full mx-4">
        <h3 class="text-lg font-semibold mb-4">驳回审核</h3>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-2">驳回理由</label>
          <textarea
            v-model="rejectComment"
            class="w-full h-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入驳回理由..."
          ></textarea>
        </div>
        <div class="flex gap-3 justify-end">
          <button
            type="button"
            class="px-4 py-2 text-sm border rounded hover:bg-muted"
            @click="showRejectDialog = false; rejectComment = ''"
          >
            取消
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600"
            :disabled="!rejectComment.trim()"
            @click="handleReject"
          >
            确认驳回
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
