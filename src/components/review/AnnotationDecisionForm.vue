<script setup lang="ts">
import { watch } from 'vue';

import { BadgeCheck, Check, CircleSlash } from 'lucide-vue-next';

import {
  useAnnotationReviewAction,
  type AnnotationReviewActionCompletedPayload,
} from './useAnnotationReviewAction';

import type { AnnotationType } from '@/composables/useToolStore';

const props = withDefaults(defineProps<{
  annotationType: AnnotationType | null;
  annotationId: string | null;
  contextFormId?: string | null;
  contextTaskId?: string | null;
  allowReviewActions?: boolean;
}>(), {
  contextFormId: undefined,
  contextTaskId: undefined,
  allowReviewActions: true,
});

const emit = defineEmits<{
  'review-action-completed': [payload: AnnotationReviewActionCompletedPayload];
}>();

const {
  actionNote,
  selectedReviewAction,
  actionSubmitting,
  reviewDisplay,
  showReviewActions,
  canSubmitReviewAction,
  reviewContextWarning,
  reviewActionNoteRequired,
  reviewActionNoteMissing,
  reviewActionPlaceholder,
  reviewActionNoteRequiredHint,
  selectReviewAction,
  submitSelectedReviewAction,
  reset,
} = useAnnotationReviewAction({
  annotationType: () => props.annotationType,
  annotationId: () => props.annotationId,
  contextFormId: () => props.contextFormId,
  contextTaskId: () => props.contextTaskId,
  allowReviewActions: () => props.allowReviewActions,
  designerOnly: () => true,
  onCompleted: (payload) => emit('review-action-completed', payload),
});

watch(() => [props.annotationType, props.annotationId, props.contextFormId, props.contextTaskId], reset);

function optionClass(action: 'fixed' | 'wont_fix'): string {
  if (selectedReviewAction.value !== action) return 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50';
  return action === 'fixed'
    ? 'border-success bg-success-subtle text-success'
    : 'border-warning bg-warning-subtle text-warning';
}
</script>

<template>
  <section v-if="showReviewActions"
    class="rounded-lg border border-solid border-brand/30 bg-white p-3"
    data-testid="annotation-decision-form">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs font-semibold text-slate-700">处理结论</span>
      <div class="flex items-center gap-2" role="radiogroup" aria-label="处理结论">
        <button type="button"
          role="radio"
          class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-solid px-3 py-1.5 text-xs font-semibold"
          :class="optionClass('fixed')"
          :aria-checked="selectedReviewAction === 'fixed'"
          data-testid="annotation-decision-fixed"
          @click="selectReviewAction('fixed')">
          <BadgeCheck class="h-3.5 w-3.5" />
          已修改
        </button>
        <button type="button"
          role="radio"
          class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-solid px-3 py-1.5 text-xs font-semibold"
          :class="optionClass('wont_fix')"
          :aria-checked="selectedReviewAction === 'wont_fix'"
          data-testid="annotation-decision-wont-fix"
          @click="selectReviewAction('wont_fix')">
          <CircleSlash class="h-3.5 w-3.5" />
          不需解决
        </button>
      </div>
      <span v-if="reviewDisplay"
        class="ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
        :class="reviewDisplay.color">
        当前：{{ reviewDisplay.label }}
      </span>
    </div>

    <textarea v-model="actionNote"
      rows="2"
      class="mt-2 box-border w-full resize-y rounded-lg border border-solid px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1"
      :class="reviewActionNoteMissing ? 'border-amber-400 focus:ring-amber-400' : 'border-slate-200 focus:border-brand focus:ring-brand'"
      :placeholder="reviewActionPlaceholder"
      :aria-required="reviewActionNoteRequired ? 'true' : undefined"
      aria-label="处理说明"
      data-testid="annotation-decision-note"
      @keydown.ctrl.enter.prevent="submitSelectedReviewAction"
      @keydown.meta.enter.prevent="submitSelectedReviewAction" />
    <div v-if="reviewActionNoteRequiredHint"
      class="mt-1 text-[11px] text-amber-700"
      data-testid="annotation-decision-note-hint">
      {{ reviewActionNoteRequiredHint }}
    </div>
    <div v-if="reviewContextWarning"
      class="mt-2 rounded-md border border-solid border-warning bg-warning-subtle px-3 py-2 text-[11px] text-warning"
      data-testid="annotation-decision-context-warning">
      {{ reviewContextWarning }}
    </div>

    <div class="mt-2 flex items-center gap-2">
      <span class="text-[11px] text-slate-400">Ctrl + Enter 保存</span>
      <button type="button"
        class="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border-0 bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-300"
        :disabled="!selectedReviewAction || !canSubmitReviewAction || actionSubmitting || reviewActionNoteMissing"
        data-testid="annotation-decision-submit"
        @click="submitSelectedReviewAction">
        <Check class="h-3.5 w-3.5" />
        {{ actionSubmitting ? '保存中…' : '保存并处理下一条' }}
      </button>
    </div>
  </section>
</template>
