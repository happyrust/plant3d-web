<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch, type Ref } from 'vue';

import {
  Cloud,
  Eye,
  EyeOff,
  Focus,
  LayoutGrid,
  PanelRightOpen,
  RectangleHorizontal,
  Trash,
  Trash2,
  Type,
  X,
} from 'lucide-vue-next';

import { ensurePanelAndActivate } from '@/composables/useDockApi';
import {
  type ActiveAnnotationContext,
  type AnnotationType,
  useToolStore,
} from '@/composables/useToolStore';

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  flyToAnnotation: (id: string) => void;
  removeAnnotation: (id: string) => void;
  flyToCloudAnnotation?: (id: string) => void;
  flyToRectAnnotation?: (id: string) => void;
  flyToObbAnnotation?: (id: string) => void;
  removeCloudAnnotation?: (id: string) => void;
  removeRectAnnotation?: (id: string) => void;
  removeObbAnnotation?: (id: string) => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();

const annotationModes = new Set([
  'annotation',
  'annotation_cloud',
  'annotation_rect',
  'annotation_obb',
]);

const isAnnotationMode = computed(() => annotationModes.has(store.toolMode.value));

const currentAnnotation = computed<ActiveAnnotationContext | null>(() => {
  return store.activeAnnotationContext.value;
});

const isVisible = computed(() => {
  return isAnnotationMode.value || !!currentAnnotation.value;
});

const currentType = computed<AnnotationType | null>(() => {
  switch (store.toolMode.value) {
    case 'annotation':
      return 'text';
    case 'annotation_cloud':
      return 'cloud';
    case 'annotation_rect':
      return 'rect';
    case 'annotation_obb':
      return 'obb';
    default:
      return currentAnnotation.value?.type ?? null;
  }
});

const currentTypeRecords = computed(() => {
  if (!currentType.value) return [];
  return store.getAnnotationRecordsByType(currentType.value);
});

const currentTypeLabel = computed(() => {
  switch (currentType.value) {
    case 'text':
      return '文字批注';
    case 'cloud':
      return '云线批注';
    case 'rect':
      return '矩形批注';
    case 'obb':
      return 'OBB 批注';
    default:
      return '批注';
  }
});

const hasAnyAnnotations = computed(() => {
  return (
    store.annotations.value.length +
    store.cloudAnnotations.value.length +
    store.rectAnnotations.value.length +
    store.obbAnnotations.value.length
  ) > 0;
});

const hasHiddenAnnotations = computed(() => {
  return [
    ...store.annotations.value,
    ...store.cloudAnnotations.value,
    ...store.rectAnnotations.value,
    ...store.obbAnnotations.value,
  ].some((item) => !item.visible);
});

const currentTypeHasHidden = computed(() => {
  return currentTypeRecords.value.some((item) => !item.visible);
});

const currentTypeActionDisabled = computed(() => {
  return !currentType.value || currentTypeRecords.value.length === 0;
});

const currentActionDisabled = computed(() => !currentAnnotation.value);

const currentVisibilityLabel = computed(() => {
  return currentAnnotation.value?.record.visible ? '隐藏当前' : '显示当前';
});

const currentTypeVisibilityLabel = computed(() => {
  return currentTypeHasHidden.value ? '当前类型全部显示' : '当前类型全部隐藏';
});

const allVisibilityLabel = computed(() => {
  return hasHiddenAnnotations.value ? '全部显示' : '全部隐藏';
});

function setMode(mode: 'annotation' | 'annotation_cloud' | 'annotation_rect' | 'annotation_obb') {
  store.setToolMode(store.toolMode.value === mode ? 'none' : mode);
}

function openAnnotationPanel(): void {
  ensurePanelAndActivate('annotation');
}

function flyCurrent(): void {
  if (!currentAnnotation.value) return;
  switch (currentAnnotation.value.type) {
    case 'text':
      props.tools.flyToAnnotation(currentAnnotation.value.id);
      return;
    case 'cloud':
      props.tools.flyToCloudAnnotation?.(currentAnnotation.value.id);
      return;
    case 'rect':
      props.tools.flyToRectAnnotation?.(currentAnnotation.value.id);
      return;
    case 'obb':
      props.tools.flyToObbAnnotation?.(currentAnnotation.value.id);
  }
}

function toggleCurrentVisible(): void {
  if (!currentAnnotation.value) return;
  switch (currentAnnotation.value.type) {
    case 'text':
      store.updateAnnotationVisible(currentAnnotation.value.id, !currentAnnotation.value.record.visible);
      return;
    case 'cloud':
      store.updateCloudAnnotationVisible(currentAnnotation.value.id, !currentAnnotation.value.record.visible);
      return;
    case 'rect':
      store.updateRectAnnotationVisible(currentAnnotation.value.id, !currentAnnotation.value.record.visible);
      return;
    case 'obb':
      store.updateObbAnnotationVisible(currentAnnotation.value.id, !currentAnnotation.value.record.visible);
  }
}

function deleteCurrent(): void {
  if (!currentAnnotation.value) return;
  switch (currentAnnotation.value.type) {
    case 'text':
      props.tools.removeAnnotation(currentAnnotation.value.id);
      return;
    case 'cloud':
      if (props.tools.removeCloudAnnotation) {
        props.tools.removeCloudAnnotation(currentAnnotation.value.id);
      } else {
        store.removeCloudAnnotation(currentAnnotation.value.id);
      }
      return;
    case 'rect':
      if (props.tools.removeRectAnnotation) {
        props.tools.removeRectAnnotation(currentAnnotation.value.id);
      } else {
        store.removeRectAnnotation(currentAnnotation.value.id);
      }
      return;
    case 'obb':
      if (props.tools.removeObbAnnotation) {
        props.tools.removeObbAnnotation(currentAnnotation.value.id);
      } else {
        store.removeObbAnnotation(currentAnnotation.value.id);
      }
  }
}

function toggleCurrentTypeVisible(): void {
  if (!currentType.value || currentTypeRecords.value.length === 0) return;
  store.setAnnotationTypeVisible(currentType.value, currentTypeHasHidden.value);
}

function clearCurrentType(): void {
  if (!currentType.value) return;
  store.clearAnnotationType(currentType.value);
}

function toggleAllVisible(): void {
  if (!hasAnyAnnotations.value) return;
  store.setAllAnnotationsVisible(hasHiddenAnnotations.value);
}

function clearAll(): void {
  store.clearAllAnnotations();
}

function exitAnnotation(): void {
  store.setToolMode('none');
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isAnnotationMode.value) return;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase() ?? '';
  const isEditable =
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target?.isContentEditable === true;
  if (isEditable) return;
  exitAnnotation();
}

watch(
  () => [
    store.annotations.value.length,
    store.cloudAnnotations.value.length,
    store.rectAnnotations.value.length,
    store.obbAnnotations.value.length,
  ],
  () => {
    if (currentAnnotation.value) return;
    if (!hasAnyAnnotations.value) {
      store.activeAnnotationId.value = null;
      store.activeCloudAnnotationId.value = null;
      store.activeRectAnnotationId.value = null;
      store.activeObbAnnotationId.value = null;
    }
  },
);

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
});
</script>

<template>
  <div v-if="isVisible"
    data-testid="annotation-overlay-root"
    class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center"
    style="z-index: 940">
    <div class="pointer-events-auto flex flex-col items-center gap-3"
      @pointerdown.stop
      @wheel.stop>
      <div class="hidden items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground md:flex">
        <span class="font-medium text-foreground">{{ currentTypeLabel }}</span>
        <span>当前类型 {{ currentTypeRecords.length }} 条</span>
        <span>全部 {{ store.annotationCount.value + store.cloudAnnotationCount.value + store.rectAnnotationCount.value + store.obbAnnotationCount.value }} 条</span>
      </div>

      <div class="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-background/90 px-3 py-2 shadow-lg backdrop-blur"
        data-testid="annotation-overlay-bar">
        <div class="flex items-center gap-2 rounded-xl border border-border bg-muted/35 p-1">
          <button type="button"
            data-testid="annotation-overlay-details-toggle"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted"
            title="打开批注面板"
            aria-label="打开批注面板"
            @click="openAnnotationPanel">
            <PanelRightOpen class="h-4 w-4" />
          </button>
        </div>

        <div class="flex items-center gap-2 rounded-xl border border-border bg-muted/35 p-1">
          <button type="button"
            data-testid="annotation-overlay-mode-text"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted"
            :class="store.toolMode.value === 'annotation' ? 'border-ring bg-muted text-foreground shadow-sm' : ''"
            title="文字批注"
            aria-label="文字批注"
            @click="setMode('annotation')">
            <Type class="h-4 w-4" />
          </button>

          <button type="button"
            data-testid="annotation-overlay-mode-cloud"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted"
            :class="store.toolMode.value === 'annotation_cloud' ? 'border-ring bg-muted text-foreground shadow-sm' : ''"
            title="云线批注"
            aria-label="云线批注"
            @click="setMode('annotation_cloud')">
            <Cloud class="h-4 w-4" />
          </button>

          <button type="button"
            data-testid="annotation-overlay-mode-rect"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted"
            :class="store.toolMode.value === 'annotation_rect' ? 'border-ring bg-muted text-foreground shadow-sm' : ''"
            title="矩形批注"
            aria-label="矩形批注"
            @click="setMode('annotation_rect')">
            <RectangleHorizontal class="h-4 w-4" />
          </button>

          <button type="button"
            data-testid="annotation-overlay-mode-obb"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted"
            :class="store.toolMode.value === 'annotation_obb' ? 'border-ring bg-muted text-foreground shadow-sm' : ''"
            title="OBB 批注"
            aria-label="OBB 批注"
            @click="setMode('annotation_obb')">
            <LayoutGrid class="h-4 w-4" />
          </button>
        </div>

        <div class="flex items-center gap-2 rounded-xl border border-border bg-muted/35 p-1">
          <button type="button"
            data-testid="annotation-overlay-fly-current"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="currentActionDisabled"
            title="定位当前"
            aria-label="定位当前"
            @click="flyCurrent">
            <Focus class="h-4 w-4" />
          </button>

          <button type="button"
            data-testid="annotation-overlay-current-visibility"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="currentActionDisabled"
            :title="currentVisibilityLabel"
            :aria-label="currentVisibilityLabel"
            @click="toggleCurrentVisible">
            <component :is="currentAnnotation?.record.visible ? EyeOff : Eye" class="h-4 w-4" />
          </button>

          <button type="button"
            data-testid="annotation-overlay-delete-current"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm text-destructive transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="currentActionDisabled"
            title="删除当前"
            aria-label="删除当前"
            @click="deleteCurrent">
            <Trash2 class="h-4 w-4" />
          </button>
        </div>

        <div class="flex items-center gap-2 rounded-xl border border-border bg-muted/35 p-1">
          <button type="button"
            data-testid="annotation-overlay-type-visibility"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="currentTypeActionDisabled"
            :title="currentTypeVisibilityLabel"
            :aria-label="currentTypeVisibilityLabel"
            @click="toggleCurrentTypeVisible">
            <component :is="currentTypeHasHidden ? Eye : EyeOff" class="h-4 w-4" />
          </button>

          <button type="button"
            data-testid="annotation-overlay-type-clear"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm text-destructive transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="currentTypeActionDisabled"
            title="清空当前类型"
            aria-label="清空当前类型"
            @click="clearCurrentType">
            <Trash2 class="h-4 w-4" />
          </button>
        </div>

        <div class="flex items-center gap-2 rounded-xl border border-border bg-muted/35 p-1">
          <button type="button"
            data-testid="annotation-overlay-all-visibility"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!hasAnyAnnotations"
            :title="allVisibilityLabel"
            :aria-label="allVisibilityLabel"
            @click="toggleAllVisible">
            <component :is="hasHiddenAnnotations ? Eye : EyeOff" class="h-4 w-4" />
          </button>

          <button type="button"
            data-testid="annotation-overlay-clear-all"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm text-destructive transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!hasAnyAnnotations"
            title="清空全部批注"
            aria-label="清空全部批注"
            @click="clearAll">
            <Trash class="h-4 w-4" />
          </button>
        </div>

        <div class="flex items-center gap-2 rounded-xl border border-border bg-muted/35 p-1">
          <button type="button"
            data-testid="annotation-overlay-exit"
            class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm transition-colors hover:bg-muted"
            title="退出批注"
            aria-label="退出批注"
            @click="exitAnnotation">
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
