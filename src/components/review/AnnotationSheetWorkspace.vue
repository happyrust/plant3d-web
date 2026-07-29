<script setup lang="ts">
import { watch } from 'vue';

import AnnotationInlineDetailCard from './AnnotationInlineDetailCard.vue';
import { isAnnotationActionableForRole } from './annotationSheetNavigation';
import AnnotationTableView from './AnnotationTableView.vue';
import {
  buildLinkedMeasurementItems,
  type AnnotationWorkspaceItem,
  type LinkedMeasurementItem,
} from './annotationWorkspaceModel';

import type { ClipboardResult } from './annotationTableClipboard';
import type {
  AnnotationType,
  MeasurementRecord,
  XeokitMeasurementRecord,
} from '@/composables/useToolStore';
import type { AnnotationSeverity } from '@/types/auth';

import { UserRole } from '@/types/auth';

const props = withDefaults(defineProps<{
  items: AnnotationWorkspaceItem[];
  currentAnnotationId?: string | null;
  currentAnnotationType?: AnnotationType | null;
  currentUserRole?: UserRole | null;
  formId?: string | null;
  taskId?: string | null;
  taskKey?: string | null;
  subtitle?: string | null;
  measurements?: MeasurementRecord[];
  xeokitMeasurements?: XeokitMeasurementRecord[];
  density?: 'normal' | 'dock';
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  canEditItem?: (item: AnnotationWorkspaceItem) => boolean;
  allowReviewActions?: boolean | ((item: AnnotationWorkspaceItem) => boolean);
  resolveActionTaskId?: (item: AnnotationWorkspaceItem) => string | null | undefined;
  resolveActionFormId?: (item: AnnotationWorkspaceItem) => string | null | undefined;
  savingSeverityKeys?: string[];
  savingTitleKeys?: string[];
  designerOnly?: boolean;
  showMeasurementActions?: boolean;
  showElevationMeasurementActions?: boolean;
}>(), {
  currentAnnotationId: null,
  currentAnnotationType: null,
  currentUserRole: null,
  formId: null,
  taskId: null,
  taskKey: null,
  subtitle: null,
  measurements: () => [],
  xeokitMeasurements: () => [],
  density: 'normal',
  pageSize: 10,
  emptyTitle: '当前范围内还没有可处理的批注',
  emptyDescription: '请选择任务，或等待对应单据的批注同步后再处理。',
  canEditItem: () => false,
  allowReviewActions: true,
  resolveActionTaskId: undefined,
  resolveActionFormId: undefined,
  savingSeverityKeys: () => [],
  savingTitleKeys: () => [],
  designerOnly: undefined,
  showMeasurementActions: true,
  showElevationMeasurementActions: true,
});

const emit = defineEmits<{
  (e: 'select-annotation', item: AnnotationWorkspaceItem | null): void;
  (e: 'locate-annotation', item: AnnotationWorkspaceItem): void;
  (e: 'locate-elements', payload: { item: AnnotationWorkspaceItem; refnos: string[] }): void;
  (e: 'start-measurement', kind: MeasurementRecord['kind'], item: AnnotationWorkspaceItem): void;
  (e: 'locate-measurement', item: LinkedMeasurementItem): void;
  (e: 'copy-feedback', payload: {
    kind: 'refno' | 'row';
    result: ClipboardResult;
    item: AnnotationWorkspaceItem;
  }): void;
  (e: 'update-severity', payload: {
    item: AnnotationWorkspaceItem;
    severity: AnnotationSeverity | undefined;
  }): void;
  (e: 'update-title', payload: {
    item: AnnotationWorkspaceItem;
    title: string;
  }): void;
  (e: 'review-action-completed', payload: {
    item: AnnotationWorkspaceItem;
    result: unknown;
  }): void;
  (e: 'queue-completed'): void;
}>();

function isItemActionable(item: AnnotationWorkspaceItem): boolean {
  return isAnnotationActionableForRole(item, props.currentUserRole);
}

function linkedMeasurements(item: AnnotationWorkspaceItem): LinkedMeasurementItem[] {
  return buildLinkedMeasurementItems(item, props.measurements, props.xeokitMeasurements);
}

function allowReviewActionsFor(item: AnnotationWorkspaceItem): boolean {
  return typeof props.allowReviewActions === 'function'
    ? props.allowReviewActions(item)
    : props.allowReviewActions;
}

function actionTaskIdFor(item: AnnotationWorkspaceItem): string | null {
  return props.resolveActionTaskId?.(item) ?? props.taskId ?? null;
}

function actionFormIdFor(item: AnnotationWorkspaceItem): string | null {
  return props.resolveActionFormId?.(item) ?? props.formId ?? item.formId ?? null;
}

function designerOnlyForCurrentRole(): boolean {
  return props.designerOnly ?? props.currentUserRole === UserRole.DESIGNER;
}

watch(
  () => `${props.taskKey ?? ''}|${props.formId ?? ''}|${props.taskId ?? ''}`,
  (_next, previous) => {
    if (previous !== undefined) emit('select-annotation', null);
  },
);
</script>

<template>
  <section data-testid="annotation-sheet-workspace"
    class="h-full min-h-0">
    <AnnotationTableView :items="items"
      :current-annotation-id="currentAnnotationId"
      :current-annotation-type="currentAnnotationType"
      :task-key="taskKey"
      :subtitle="subtitle"
      :page-size="pageSize"
      :empty-title="emptyTitle"
      :empty-description="emptyDescription"
      :can-edit-item="canEditItem"
      :is-item-actionable="isItemActionable"
      :saving-severity-keys="savingSeverityKeys"
      :saving-title-keys="savingTitleKeys"
      @select-annotation="emit('select-annotation', $event)"
      @locate-annotation="emit('locate-annotation', $event)"
      @copy-feedback="emit('copy-feedback', $event)"
      @update-severity="emit('update-severity', $event)"
      @update-title="emit('update-title', $event)"
      @review-action-completed="emit('review-action-completed', $event)"
      @queue-completed="emit('queue-completed')">
      <template #expanded-row="{ item, onReviewActionCompleted }">
        <AnnotationInlineDetailCard :item="item"
          :linked-measurements="linkedMeasurements(item)"
          :current-user-role="currentUserRole"
          :form-id="actionFormIdFor(item)"
          :task-id="actionTaskIdFor(item)"
          :density="density"
          :allow-review-actions="allowReviewActionsFor(item)"
          :designer-only="designerOnlyForCurrentRole()"
          :show-measurement-actions="showMeasurementActions"
          :show-elevation-measurement-actions="showElevationMeasurementActions"
          @locate="emit('locate-annotation', $event)"
          @locate-elements="emit('locate-elements', $event)"
          @start-measurement="(kind, target) => emit('start-measurement', kind, target)"
          @locate-measurement="emit('locate-measurement', $event)"
          @close="emit('select-annotation', null)"
          @review-action-completed="onReviewActionCompleted" />
      </template>
    </AnnotationTableView>
  </section>
</template>
