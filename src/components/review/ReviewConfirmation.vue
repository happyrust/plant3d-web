<script setup lang="ts">
import { computed, ref } from 'vue';

import { CheckCircle, MessageSquare, Ruler, X } from 'lucide-vue-next';

import {
  buildReviewConfirmSnapshotPayload,
  buildUnsavedReviewConfirmPayload,
  buildReviewConfirmSnapshotKey,
  buildReviewConfirmSnapshotPayloadFromRecords,
  confirmCurrentDataSafely,
  hasReviewConfirmPayloadData,
} from './reviewPanelActions';

import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';
import { emitToast } from '@/ribbon/toastBus';

const reviewStore = useReviewStore();
const toolStore = useToolStore();

const confirmNote = ref('');
const showNoteInput = ref(false);
const confirmSaving = ref(false);
const confirmError = ref<string | null>(null);

const pendingAnnotationCount = computed(() => {
  return (
    toolStore.annotationCount.value +
    toolStore.cloudAnnotationCount.value +
    toolStore.rectAnnotationCount.value +
    toolStore.obbAnnotationCount.value
  );
});

const hasPendingData = computed(() => {
  return pendingAnnotationCount.value > 0 || pendingMeasurementCount.value > 0;
});

const currentDraftConfirmPayload = computed(() => buildReviewConfirmSnapshotPayload({
  annotations: [...toolStore.annotations.value],
  cloudAnnotations: [...toolStore.cloudAnnotations.value],
  rectAnnotations: [...toolStore.rectAnnotations.value],
  obbAnnotations: [...toolStore.obbAnnotations.value],
  measurements: [...toolStore.measurements.value],
  xeokitDistanceMeasurements: [...toolStore.xeokitDistanceMeasurements.value],
  xeokitAngleMeasurements: [...toolStore.xeokitAngleMeasurements.value],
}));
const pendingMeasurementCount = computed(() => currentDraftConfirmPayload.value.measurements.length);

const currentTaskConfirmedRecords = computed(() => {
  const taskId = reviewStore.currentTask.value?.id;
  if (!taskId) return [];
  return reviewStore.sortedConfirmedRecords.value.filter((record) => record.taskId === taskId);
});

const confirmedSnapshotPayload = computed(() => (
  buildReviewConfirmSnapshotPayloadFromRecords(currentTaskConfirmedRecords.value)
));

const unsavedConfirmPayload = computed(() => (
  buildUnsavedReviewConfirmPayload(
    currentDraftConfirmPayload.value,
    confirmedSnapshotPayload.value,
  )
));

const hasUnsavedChanges = computed(() => {
  return buildReviewConfirmSnapshotKey(currentDraftConfirmPayload.value)
    !== buildReviewConfirmSnapshotKey(confirmedSnapshotPayload.value);
});

const hasUnsavedPendingData = computed(() => (
  hasReviewConfirmPayloadData(unsavedConfirmPayload.value)
));

const isVisible = computed(() => {
  return reviewStore.reviewMode.value && (hasPendingData.value || hasUnsavedPendingData.value);
});

async function confirmCurrentData() {
  if (confirmSaving.value || !hasUnsavedPendingData.value) return;

  confirmSaving.value = true;
  confirmError.value = null;
  try {
    const saved = await confirmCurrentDataSafely({
      hasPendingData: hasUnsavedPendingData.value,
      payload: {
        type: 'batch' as const,
        annotations: [...unsavedConfirmPayload.value.annotations],
        cloudAnnotations: [...unsavedConfirmPayload.value.cloudAnnotations],
        rectAnnotations: [...unsavedConfirmPayload.value.rectAnnotations],
        obbAnnotations: [...unsavedConfirmPayload.value.obbAnnotations],
        measurements: [...unsavedConfirmPayload.value.measurements],
        note: confirmNote.value.trim(),
      },
      addConfirmedRecord: reviewStore.addConfirmedRecord,
      clearDraftData: () => {},
      resetNote: () => {
        confirmNote.value = '';
        showNoteInput.value = false;
      },
    });
    if (saved) {
      emitToast({ message: '确认数据已保存', level: 'success' });
    }
  } catch (e) {
    confirmError.value = e instanceof Error ? e.message : '确认当前数据失败';
  } finally {
    confirmSaving.value = false;
  }
}

function cancel() {
  showNoteInput.value = false;
  confirmNote.value = '';
}
</script>

<template>
  <Transition name="slide-up">
    <div v-if="isVisible"
      class="pointer-events-auto absolute bottom-4 right-4 w-[320px] rounded-[24px] border border-slate-800 bg-slate-950 p-4 text-white shadow-2xl"
      style="z-index: 950;"
      @pointerdown.stop
      @wheel.stop>
      <!-- 头部 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span class="text-sm font-medium text-white">待确认数据</span>
        </div>
        <button type="button" class="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white" title="关闭校审模式"
          @click="reviewStore.setReviewMode(false)">
          <X class="h-4 w-4" />
        </button>
      </div>

      <!-- 统计 -->
      <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div class="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
          <div class="flex items-center gap-1 text-slate-300">
            <MessageSquare class="h-3.5 w-3.5 text-blue-300" />
            <span>批注</span>
          </div>
          <div class="mt-1 text-base font-semibold text-white">{{ pendingAnnotationCount }}</div>
        </div>
        <div class="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
          <div class="flex items-center gap-1 text-slate-300">
            <Ruler class="h-3.5 w-3.5 text-emerald-300" />
            <span>测量</span>
          </div>
          <div class="mt-1 text-base font-semibold text-white">{{ pendingMeasurementCount }}</div>
        </div>
      </div>

      <!-- 备注输入 -->
      <div v-if="showNoteInput" class="mt-3">
        <input v-model="confirmNote"
          class="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder:text-slate-400"
          placeholder="输入确认备注（可选）..."
          @keyup.enter="confirmCurrentData" />
      </div>

      <!-- 操作按钮 -->
      <div class="mt-3 flex gap-2">
        <button type="button"
          class="flex h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-500 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          :disabled="!hasUnsavedPendingData || confirmSaving"
          @click="confirmCurrentData">
          <CheckCircle class="h-3.5 w-3.5" />
          {{ confirmSaving ? '保存中...' : hasUnsavedPendingData ? '确认完成' : '已保存' }}
        </button>
        <button v-if="!showNoteInput" type="button"
          class="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-slate-200 hover:bg-white/10"
          @click="showNoteInput = true">
          备注
        </button>
        <button v-else type="button"
          class="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-slate-200 hover:bg-white/10"
          @click="cancel">
          取消
        </button>
      </div>

      <!-- 提示 -->
      <div class="mt-3 text-xs text-slate-400">
        {{ !hasUnsavedPendingData && !confirmError ? '当前批注/测量已保存，修改后可再次确认' : '确认后数据将移入已确认列表' }}
      </div>
      <div v-if="confirmError" class="mt-2 text-xs text-rose-300">
        {{ confirmError }}
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
