<script setup lang="ts">
import { computed, ref } from 'vue';

import { AlertCircle, CheckCircle, MessageSquare, RotateCw, Ruler, X } from 'lucide-vue-next';

import {
  buildReviewEvidenceSnapshotKey,
  buildReviewConfirmSnapshotPayload,
  buildUnsavedReviewEvidencePayload,
  buildReviewConfirmSnapshotPayloadFromRecords,
  confirmCurrentDataSafely,
  hasReviewConfirmPayloadData,
  resolveReviewEvidenceSaveErrorMessage,
} from './reviewPanelActions';

import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';
import { emitToast } from '@/ribbon/toastBus';

const props = withDefaults(defineProps<{
  /** floating＝独立浮在视图右下角；docked＝作为批注浮层栈底的一张卡片（问题7：合并浮层） */
  variant?: 'floating' | 'docked';
}>(), {
  variant: 'floating',
});

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
  return pendingAnnotationCount.value > 0
    || pendingMeasurementCount.value > 0
    || reviewStore.dimensionDocumentDirty.value;
});

const currentDraftConfirmPayload = computed(() => {
  const dimensionPayload = reviewStore.getBoundDimensionConfirmPayload();
  return buildReviewConfirmSnapshotPayload({
    annotations: [...toolStore.annotations.value],
    cloudAnnotations: [...toolStore.cloudAnnotations.value],
    rectAnnotations: [...toolStore.rectAnnotations.value],
    obbAnnotations: [...toolStore.obbAnnotations.value],
    measurements: [...toolStore.measurements.value],
    xeokitDistanceMeasurements: [...toolStore.xeokitDistanceMeasurements.value],
    xeokitAngleMeasurements: [...toolStore.xeokitAngleMeasurements.value],
    xeokitElevationPointMeasurements: [...(toolStore.xeokitElevationPointMeasurements?.value ?? [])],
    xeokitElevationDeltaMeasurements: [...(toolStore.xeokitElevationDeltaMeasurements?.value ?? [])],
    ...dimensionPayload,
  });
});
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
  buildUnsavedReviewEvidencePayload(
    currentDraftConfirmPayload.value,
    confirmedSnapshotPayload.value,
  )
));

const hasUnsavedChanges = computed(() => {
  return buildReviewEvidenceSnapshotKey(currentDraftConfirmPayload.value)
    !== buildReviewEvidenceSnapshotKey(confirmedSnapshotPayload.value);
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
        dimensionDocument: unsavedConfirmPayload.value.dimensionDocument,
        dimensionDocumentVersion: unsavedConfirmPayload.value.dimensionDocumentVersion,
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
      emitToast({ message: '新增证据已保存', level: 'success' });
    }
  } catch (e) {
    confirmError.value = resolveReviewEvidenceSaveErrorMessage(e, '保存新增证据失败');
  } finally {
    confirmSaving.value = false;
  }
}

function cancel() {
  showNoteInput.value = false;
  confirmNote.value = '';
}

function resolveDimensionConflict(action: 'replay' | 'discard') {
  if (!reviewStore.resolveDimensionDocumentConflict(action)) return;
  confirmError.value = null;
  emitToast({
    message: action === 'replay'
      ? '已基于最新版本重放可用的本地尺寸修改，请重新保存'
      : '已放弃本地尺寸修改并加载最新版本',
    level: action === 'replay' ? 'success' : 'warning',
  });
}
</script>

<template>
  <Transition name="slide-up">
    <div v-if="isVisible"
      class="pointer-events-auto w-[320px] rounded-[24px] border border-slate-800 bg-slate-950 p-4 text-white"
      :class="props.variant === 'docked' ? 'max-w-full shadow-lg' : 'absolute bottom-4 right-4 shadow-2xl'"
      :style="props.variant === 'docked' ? undefined : 'z-index: 950;'"
      @pointerdown.stop
      @wheel.stop>
      <!-- 头部 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="h-2 w-2 animate-pulse rounded-full bg-success" />
          <span class="text-sm font-medium text-white">待保存证据</span>
        </div>
        <button type="button" class="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white" title="关闭校审模式"
          @click="reviewStore.setReviewMode(false)">
          <X class="h-4 w-4" />
        </button>
      </div>

      <!-- 统计 -->
      <div class="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div class="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
          <div class="flex items-center gap-1 text-slate-300">
            <MessageSquare class="h-3.5 w-3.5 text-brand" />
            <span>批注</span>
          </div>
          <div class="mt-1 text-base font-semibold text-white">{{ pendingAnnotationCount }}</div>
        </div>
        <div class="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
          <div class="flex items-center gap-1 text-slate-300">
            <Ruler class="h-3.5 w-3.5 text-success" />
            <span>测量</span>
          </div>
          <div class="mt-1 text-base font-semibold text-white">{{ pendingMeasurementCount }}</div>
        </div>
        <div class="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
          <div class="flex items-center gap-1 text-slate-300">
            <Ruler class="h-3.5 w-3.5 text-brand" />
            <span>尺寸</span>
          </div>
          <div class="mt-1 text-base font-semibold text-white">{{ reviewStore.dimensionDocumentRecordCount.value }}</div>
        </div>
      </div>

      <!-- 备注输入 -->
      <div v-if="showNoteInput" class="mt-3">
        <input v-model="confirmNote"
          class="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder:text-slate-400"
          placeholder="输入确认备注（可选）..."
          @keyup.enter="confirmCurrentData" />
      </div>

      <div v-if="reviewStore.dimensionDocumentConflict.value"
        class="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-100">
        <div class="font-semibold">检测到尺寸文档版本冲突</div>
        <div class="mt-1">
          可重放 {{ reviewStore.dimensionDocumentConflict.value.preview.applied.length }} 条，
          拒绝 {{ reviewStore.dimensionDocumentConflict.value.preview.rejected.length }} 条。
        </div>
        <div class="mt-2 flex gap-2">
          <button type="button"
            class="rounded-lg border border-amber-200/40 px-2 py-1 hover:bg-white/10"
            @click="resolveDimensionConflict('replay')">
            按最新版本重放
          </button>
          <button type="button"
            class="rounded-lg border border-white/20 px-2 py-1 hover:bg-white/10"
            @click="resolveDimensionConflict('discard')">
            放弃本地修改
          </button>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="mt-3 flex gap-2">
        <button type="button"
          class="flex h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-success text-xs font-semibold text-white hover:bg-success disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!hasUnsavedPendingData || confirmSaving"
          :title="confirmSaving
            ? '正在保存，请稍候…'
            : hasUnsavedPendingData
              ? '保存本次新增的批注与测量证据'
              : '当前没有需要保存的新增证据'"
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
        {{ !hasUnsavedPendingData && !confirmError ? '当前新增证据已保存，修改后可再次保存' : '保存后证据将进入确认记录' }}
      </div>
      <div v-if="confirmError"
        class="mt-2 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-2.5 text-xs text-amber-100">
        <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
        <div class="min-w-0 flex-1">
          <div class="leading-5">{{ confirmError }}</div>
          <button type="button"
            class="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 font-medium text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="confirmSaving || !hasUnsavedPendingData"
            @click="confirmCurrentData">
            <RotateCw class="h-3 w-3" :class="confirmSaving ? 'animate-spin' : ''" />
            {{ confirmSaving ? '重试中...' : '重试' }}
          </button>
        </div>
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
