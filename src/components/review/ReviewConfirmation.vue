<script setup lang="ts">
import { computed, ref } from 'vue';

import { CheckCircle, MessageSquare, Ruler, X } from 'lucide-vue-next';

import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';

const reviewStore = useReviewStore();
const toolStore = useToolStore();

const confirmNote = ref('');
const showNoteInput = ref(false);

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

const isVisible = computed(() => {
  return reviewStore.reviewMode.value && hasPendingData.value;
});

function confirmCurrentData() {
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
  showNoteInput.value = false;
}

function cancel() {
  showNoteInput.value = false;
  confirmNote.value = '';
}
</script>

<template>
  <Transition name="slide-up">
    <div v-if="isVisible"
      class="pointer-events-auto absolute bottom-4 right-4 w-64 rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur"
      style="z-index: 950;"
      @pointerdown.stop
      @wheel.stop>
      <!-- 头部 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          <span class="text-sm font-medium">待确认数据</span>
        </div>
        <button type="button" class="rounded p-1 hover:bg-muted" title="关闭校审模式"
          @click="reviewStore.setReviewMode(false)">
          <X class="h-4 w-4" />
        </button>
      </div>

      <!-- 统计 -->
      <div class="mt-2 flex gap-3 text-xs">
        <div class="flex items-center gap-1">
          <MessageSquare class="h-3.5 w-3.5 text-blue-500" />
          <span>批注: {{ pendingAnnotationCount }}</span>
        </div>
        <div class="flex items-center gap-1">
          <Ruler class="h-3.5 w-3.5 text-green-500" />
          <span>测量: {{ pendingMeasurementCount }}</span>
        </div>
      </div>

      <!-- 备注输入 -->
      <div v-if="showNoteInput" class="mt-2">
        <input v-model="confirmNote"
          class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          placeholder="输入确认备注（可选）..."
          @keyup.enter="confirmCurrentData" />
      </div>

      <!-- 操作按钮 -->
      <div class="mt-2 flex gap-2">
        <button type="button"
          class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md bg-green-500 text-xs text-white hover:bg-green-600"
          @click="confirmCurrentData">
          <CheckCircle class="h-3.5 w-3.5" />
          确认完成
        </button>
        <button v-if="!showNoteInput" type="button"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
          @click="showNoteInput = true">
          备注
        </button>
        <button v-else type="button"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
          @click="cancel">
          取消
        </button>
      </div>

      <!-- 提示 -->
      <div class="mt-2 text-center text-xs text-muted-foreground">
        确认后数据将移入已确认列表
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
