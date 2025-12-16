<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  CheckCircle,
  ClipboardCheck,
  ClipboardList,
  Download,
  MessageSquare,
  Ruler,
  Trash2,
} from 'lucide-vue-next';

import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';

const reviewStore = useReviewStore();
const toolStore = useToolStore();

const confirmNote = ref('');

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

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}
</script>

<template>
  <div class="flex h-full flex-col gap-3 overflow-y-auto p-3">
    <!-- 校审模式开关 -->
    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <ClipboardCheck class="h-5 w-5 text-primary" />
          <span class="text-sm font-semibold">校审模式</span>
        </div>
        <button
          type="button"
          class="h-8 rounded-md px-3 text-sm"
          :class="
            reviewStore.reviewMode.value
              ? 'bg-primary text-primary-foreground'
              : 'border border-input bg-background hover:bg-muted'
          "
          @click="reviewStore.toggleReviewMode()"
        >
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
        </div>
        <div class="flex items-center gap-2 rounded-md bg-muted/50 p-2">
          <Ruler class="h-4 w-4 text-green-500" />
          <span class="text-sm">测量</span>
          <span class="ml-auto font-semibold">{{ pendingMeasurementCount }}</span>
        </div>
      </div>

      <div v-if="hasPendingData" class="mt-3">
        <label class="text-xs text-muted-foreground">备注（可选）</label>
        <input
          v-model="confirmNote"
          class="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          placeholder="输入确认备注..."
        />
      </div>

      <button
        type="button"
        class="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        :disabled="!hasPendingData"
        @click="confirmCurrentData"
      >
        <CheckCircle class="h-4 w-4" />
        确认当前数据
      </button>
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
        <button
          type="button"
          class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs hover:bg-muted disabled:opacity-50"
          :disabled="reviewStore.confirmedRecordCount.value === 0"
          @click="exportData"
        >
          <Download class="h-3.5 w-3.5" />
          导出JSON
        </button>
        <button
          type="button"
          class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs text-destructive hover:bg-muted disabled:opacity-50"
          :disabled="reviewStore.confirmedRecordCount.value === 0"
          @click="reviewStore.clearConfirmedRecords()"
        >
          <Trash2 class="h-3.5 w-3.5" />
          清空
        </button>
      </div>
    </div>

    <!-- 确认历史 -->
    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">确认历史</div>

      <div
        v-if="reviewStore.sortedConfirmedRecords.value.length === 0"
        class="mt-2 text-sm text-muted-foreground"
      >
        暂无确认记录。
      </div>

      <div v-else class="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
        <div
          v-for="record in reviewStore.sortedConfirmedRecords.value"
          :key="record.id"
          class="rounded-md border border-border p-2"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground">
              {{ formatDate(record.confirmedAt) }}
            </span>
            <button
              type="button"
              class="rounded p-1 text-destructive hover:bg-muted"
              title="删除"
              @click="reviewStore.removeConfirmedRecord(record.id)"
            >
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
