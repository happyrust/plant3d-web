<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

import {
  Check,
  ChevronDown,
  Cloud,
  Eye,
  EyeOff,
  Focus,
  GripVertical,
  MoreHorizontal,
  PanelRightOpen,
  RectangleHorizontal,
  Trash,
  Trash2,
  Type,
  Undo,
  X,
} from 'lucide-vue-next';

import { setAnnotationProcessingEntryTarget } from '@/components/review/annotationProcessingEntry';
import { isCanonicalReturnedTask } from '@/components/review/reviewTaskFilters';
import AnnotationColorPicker from '@/components/tools/AnnotationColorPicker.vue';
import { saveAnnotationSeverity } from '@/composables/useAnnotationSeveritySync';
import { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useReviewStore } from '@/composables/useReviewStore';
import {
  type ActiveAnnotationContext,
  type AnnotationType,
  useToolStore,
} from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import {
  ANNOTATION_SEVERITY_VALUES,
  canEditAnnotationSeverity,
  getAnnotationSeverityDisplay,
  type AnnotationSeverity,
  UserRole,
} from '@/types/auth';

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  flyToAnnotation: (id: string) => void;
  removeAnnotation: (id: string) => void;
  flyToCloudAnnotation?: (id: string) => void;
  flyToRectAnnotation?: (id: string) => void;
  removeCloudAnnotation?: (id: string) => void;
  removeRectAnnotation?: (id: string) => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();
const styleStore = useAnnotationStyleStore();
const reviewStore = useReviewStore();

const drawerOpen = ref(false);
const drawerRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const severityMenuOpen = ref(false);
const severityMenuRef = ref<HTMLElement | null>(null);
const severityTriggerRef = ref<HTMLElement | null>(null);
const overlayRootRef = ref<HTMLElement | null>(null);
const overlayOffset = ref<{ x: number; y: number } | null>(null);
const dragState = ref<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

const OVERLAY_POS_STORAGE_KEY = 'plant3d.annotationOverlayPos';

const overlayPositionStyle = computed(() => {
  if (!overlayOffset.value) return {};
  return {
    left: `${overlayOffset.value.x}px`,
    top: `${overlayOffset.value.y}px`,
    right: 'auto',
  };
});

const hasCustomOverlayPosition = computed(() => overlayOffset.value !== null);

function hexFromNumber(n: number): string {
  return '#' + n.toString(16).padStart(6, '0').toUpperCase();
}

function numberFromHex(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

const selectedAnnotationColor = computed({
  get() {
    const type = currentType.value;
    const kind = type === 'text' ? 'text' : type === 'cloud' ? 'cloud' : type === 'rect' ? 'rect' : 'cloud';
    return hexFromNumber(styleStore.style[kind].color);
  },
  set(hex: string) {
    const color = numberFromHex(hex);
    const type = currentType.value;
    const kind = type === 'text' ? 'text' : type === 'cloud' ? 'cloud' : type === 'rect' ? 'rect' : 'cloud';
    styleStore.updateStyle(kind, { color });
  },
});

const annotationModes = new Set([
  'annotation',
  'annotation_cloud',
  'annotation_rect',
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
    default:
      return '批注';
  }
});

const hasAnyAnnotations = computed(() => {
  return (
    store.annotations.value.length +
    store.cloudAnnotations.value.length +
    store.rectAnnotations.value.length
  ) > 0;
});

const hasHiddenAnnotations = computed(() => {
  return [
    ...store.annotations.value,
    ...store.cloudAnnotations.value,
    ...store.rectAnnotations.value,
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

function setMode(mode: 'annotation' | 'annotation_cloud' | 'annotation_rect') {
  store.setToolMode(store.toolMode.value === mode ? 'none' : mode);
}

function openAnnotationPanel(): void {
  const currentTask = reviewStore.currentTask.value;
  const currentUser = userStore.currentUser.value;
  const shouldUseDesignerPanel = (
    currentUser?.role === UserRole.DESIGNER ||
    (currentTask ? isCanonicalReturnedTask(currentTask) : false)
  );

  if (currentAnnotation.value) {
    const record = currentAnnotation.value.record as { formId?: string } | null;
    setAnnotationProcessingEntryTarget({
      annotationId: currentAnnotation.value.id,
      annotationType: currentAnnotation.value.type,
      formId: record?.formId ?? currentTask?.formId ?? null,
    });
  }

  ensurePanelAndActivate(shouldUseDesignerPanel ? 'designerCommentHandling' : 'review');
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

// ==================== 严重度 ====================

const userStore = useUserStore();

const SEVERITY_QUICK_BUCKETS: { key: AnnotationSeverity; label: string; dotClass: string }[] = [
  { key: 'principle', label: '原则错误 ×', dotClass: 'bg-red-500' },
  { key: 'general', label: '一般错误 △', dotClass: 'bg-orange-500' },
  { key: 'drawing', label: '图面错误 ○', dotClass: 'bg-blue-500' },
];

/** 当前选中批注的严重度（undefined 表示未设置） */
const currentSeverity = computed<AnnotationSeverity | undefined>(() => {
  return (currentAnnotation.value?.record as { severity?: AnnotationSeverity } | null)?.severity;
});

/** 当前选中批注是否允许当前用户改严重度 */
const canEditCurrentSeverity = computed<boolean>(() => {
  const rec = currentAnnotation.value?.record as { authorId?: string } | null;
  return !!currentAnnotation.value && canEditAnnotationSeverity(userStore.currentUser.value, rec?.authorId);
});

/** 当前类型中允许当前用户批量改严重度的记录数（用于按钮状态/提示） */
const currentTypeEditableCount = computed<number>(() => {
  const user = userStore.currentUser.value;
  if (!user) return 0;
  return currentTypeRecords.value.filter((r) => canEditAnnotationSeverity(user, (r as { authorId?: string }).authorId)).length;
});

const batchActionDisabled = computed<boolean>(() => {
  if (currentTypeActionDisabled.value) return true;
  return currentTypeEditableCount.value === 0;
});

async function setCurrentSeverity(next: AnnotationSeverity | undefined): Promise<void> {
  const ctx = currentAnnotation.value;
  if (!ctx) return;
  if (!canEditCurrentSeverity.value) return;
  const task = reviewStore.currentTask.value;
  await saveAnnotationSeverity(ctx.type, ctx.id, next, {
    formId: task?.formId ?? null,
    taskId: task?.id ?? null,
  });
}

async function batchSetCurrentTypeSeverity(next: AnnotationSeverity | undefined): Promise<void> {
  const type = currentType.value;
  if (!type) return;
  const user = userStore.currentUser.value;
  if (!user) return;
  const task = reviewStore.currentTask.value;
  const ctx = {
    formId: task?.formId ?? null,
    taskId: task?.id ?? null,
  };
  const records = store.getAnnotationRecordsByType(type);
  const editableIds = records
    .filter((r) => canEditAnnotationSeverity(user, (r as { authorId?: string }).authorId))
    .map((r) => (r as { id: string }).id);
  // 串行 await 避免触发并发提示风暴；批量入口本就低频。
  for (const id of editableIds) {
    await saveAnnotationSeverity(type, id, next, ctx);
  }
}

function exitAnnotation(): void {
  store.setToolMode('none');
}

function toggleDrawer(): void {
  drawerOpen.value = !drawerOpen.value;
  if (drawerOpen.value) severityMenuOpen.value = false;
}

function closeDrawer(): void {
  drawerOpen.value = false;
}

function toggleSeverityMenu(): void {
  if (!canEditCurrentSeverity.value) return;
  severityMenuOpen.value = !severityMenuOpen.value;
  if (severityMenuOpen.value) drawerOpen.value = false;
}

function closeSeverityMenu(): void {
  severityMenuOpen.value = false;
}

async function pickSeverityFromMenu(next: AnnotationSeverity | undefined): Promise<void> {
  closeSeverityMenu();
  await setCurrentSeverity(next);
}

function ensureOverlayOffsetFromDom(): { x: number; y: number } {
  const el = overlayRootRef.value;
  if (!el) return { x: 16, y: 16 };
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}

function persistOverlayOffset(): void {
  if (!overlayOffset.value) return;
  try {
    sessionStorage.setItem(OVERLAY_POS_STORAGE_KEY, JSON.stringify(overlayOffset.value));
  } catch {
    // ignore quota / private mode
  }
}

function onDragHandlePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const pos = overlayOffset.value ?? ensureOverlayOffsetFromDom();
  overlayOffset.value = pos;
  dragState.value = {
    startX: event.clientX,
    startY: event.clientY,
    originX: pos.x,
    originY: pos.y,
  };
  (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onDragPointerMove(event: PointerEvent): void {
  if (!dragState.value) return;
  const dx = event.clientX - dragState.value.startX;
  const dy = event.clientY - dragState.value.startY;
  const maxX = Math.max(8, window.innerWidth - 120);
  const maxY = Math.max(8, window.innerHeight - 48);
  overlayOffset.value = {
    x: Math.min(maxX, Math.max(8, dragState.value.originX + dx)),
    y: Math.min(maxY, Math.max(8, dragState.value.originY + dy)),
  };
}

function endDrag(): void {
  if (!dragState.value) return;
  dragState.value = null;
  persistOverlayOffset();
}

function handleClickOutside(event: PointerEvent): void {
  const target = event.target as Node;
  if (severityMenuOpen.value) {
    if (!severityMenuRef.value?.contains(target) && !severityTriggerRef.value?.contains(target)) {
      closeSeverityMenu();
    }
  }
  if (!drawerOpen.value) return;
  if (drawerRef.value?.contains(target)) return;
  if (triggerRef.value?.contains(target)) return;
  closeDrawer();
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && severityMenuOpen.value) {
    closeSeverityMenu();
    return;
  }
  if (event.key === 'Escape' && drawerOpen.value) {
    closeDrawer();
    return;
  }
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
  ],
  () => {
    if (currentAnnotation.value) return;
    if (!hasAnyAnnotations.value) {
      store.activeAnnotationId.value = null;
      store.activeCloudAnnotationId.value = null;
      store.activeRectAnnotationId.value = null;
    }
  },
);

onMounted(() => {
  try {
    const raw = sessionStorage.getItem(OVERLAY_POS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        overlayOffset.value = { x: parsed.x, y: parsed.y };
      }
    }
  } catch {
    // ignore corrupt storage
  }
  window.addEventListener('keydown', handleWindowKeydown);
  document.addEventListener('pointerdown', handleClickOutside);
  window.addEventListener('pointermove', onDragPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
  document.removeEventListener('pointerdown', handleClickOutside);
  window.removeEventListener('pointermove', onDragPointerMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
});
</script>

<template>
  <div v-if="isVisible"
    ref="overlayRootRef"
    data-testid="annotation-overlay-root"
    class="pointer-events-none fixed z-[940] flex justify-end"
    :class="hasCustomOverlayPosition ? '' : 'right-4 top-4'"
    :style="overlayPositionStyle">
    <div class="pointer-events-auto flex flex-col items-end gap-2"
      @pointerdown.stop
      @wheel.stop>
      <!-- 状态信息 -->
      <div class="hidden items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground md:flex">
        <span class="font-medium text-foreground">{{ currentTypeLabel }}</span>
        <span class="opacity-40">·</span>
        <span>{{ currentTypeRecords.length }} 条</span>
        <span class="opacity-40">·</span>
        <span>共 {{ store.annotationCount.value + store.cloudAnnotationCount.value + store.rectAnnotationCount.value }}</span>
      </div>

      <!-- 主工具栏（跟随主题色，可拖拽） -->
      <div class="relative flex items-center gap-1 rounded-xl border border-border bg-background/90 px-2 py-1.5 shadow-lg backdrop-blur"
        data-testid="annotation-overlay-bar">
        <button type="button"
          data-testid="annotation-overlay-drag-handle"
          class="inline-flex h-8 w-6 cursor-grab items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
          title="拖动工具栏"
          aria-label="拖动工具栏"
          @pointerdown.stop="onDragHandlePointerDown">
          <GripVertical class="h-3.5 w-3.5" />
        </button>

        <div class="mx-0.5 h-4 w-px bg-border" />

        <!-- 打开批注面板 -->
        <button type="button"
          data-testid="annotation-overlay-details-toggle"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="打开批注面板"
          aria-label="打开批注面板"
          @click="openAnnotationPanel">
          <PanelRightOpen class="h-3.5 w-3.5" />
        </button>

        <div class="mx-0.5 h-4 w-px bg-border" />

        <!-- 批注模式切换组 -->
        <button type="button"
          data-testid="annotation-overlay-mode-text"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors"
          :class="store.toolMode.value === 'annotation'
            ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          title="文字批注"
          aria-label="文字批注"
          @click="setMode('annotation')">
          <Type class="h-3.5 w-3.5" />
        </button>

        <button type="button"
          data-testid="annotation-overlay-mode-cloud"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors"
          :class="store.toolMode.value === 'annotation_cloud'
            ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          title="云线批注"
          aria-label="云线批注"
          @click="setMode('annotation_cloud')">
          <Cloud class="h-3.5 w-3.5" />
        </button>

        <button type="button"
          data-testid="annotation-overlay-mode-rect"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors"
          :class="store.toolMode.value === 'annotation_rect'
            ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          title="矩形批注"
          aria-label="矩形批注"
          @click="setMode('annotation_rect')">
          <RectangleHorizontal class="h-3.5 w-3.5" />
        </button>

        <!-- 颜色选择器 -->
        <AnnotationColorPicker v-model="selectedAnnotationColor" />

        <!-- 当前批注错误类型：向下弹出，避免被画布/面板遮挡 -->
        <template v-if="currentAnnotation">
          <div class="mx-0.5 h-4 w-px bg-border" />
          <div data-testid="annotation-overlay-toolbar-severity"
            class="relative"
            :class="!canEditCurrentSeverity ? 'opacity-40' : ''">
            <button ref="severityTriggerRef"
              type="button"
              data-testid="annotation-overlay-toolbar-severity-trigger"
              class="inline-flex h-8 max-w-[7.5rem] items-center gap-1 rounded-lg border border-input bg-background px-2 text-[11px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none"
              :disabled="!canEditCurrentSeverity"
              :title="canEditCurrentSeverity ? '选择错误类型' : '当前角色不可修改错误类型'"
              @click.stop="toggleSeverityMenu">
              <span v-if="currentSeverity"
                class="truncate"
                :class="getAnnotationSeverityDisplay(currentSeverity).color + ' rounded px-1'">
                {{ getAnnotationSeverityDisplay(currentSeverity).symbol }}
                {{ getAnnotationSeverityDisplay(currentSeverity).label }}
              </span>
              <span v-else class="truncate text-muted-foreground">错误类型</span>
              <ChevronDown class="h-3 w-3 shrink-0 opacity-60"
                :class="severityMenuOpen ? 'rotate-180' : ''" />
            </button>
            <Transition enter-active-class="transition duration-150 ease-out"
              enter-from-class="-translate-y-1 scale-95 opacity-0"
              enter-to-class="translate-y-0 scale-100 opacity-100"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="translate-y-0 scale-100 opacity-100"
              leave-to-class="-translate-y-1 scale-95 opacity-0">
              <div v-if="severityMenuOpen"
                ref="severityMenuRef"
                data-testid="annotation-overlay-toolbar-severity-menu"
                class="absolute left-0 top-full z-[960] mt-1 min-w-[9.5rem] overflow-hidden rounded-lg border border-border bg-background/98 py-1 shadow-xl backdrop-blur"
                @pointerdown.stop>
                <button v-for="bucket in SEVERITY_QUICK_BUCKETS"
                  :key="bucket.key"
                  type="button"
                  :data-testid="'annotation-overlay-toolbar-severity-' + bucket.key"
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                  :class="currentSeverity === bucket.key ? 'bg-primary/10 text-primary' : 'text-foreground'"
                  @click="pickSeverityFromMenu(bucket.key)">
                  <span class="inline-block h-2 w-2 rounded-full" :class="bucket.dotClass" />
                  <span>{{ bucket.label }}</span>
                </button>
                <button type="button"
                  data-testid="annotation-overlay-toolbar-severity-clear"
                  class="flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                  :disabled="!currentSeverity"
                  @click="pickSeverityFromMenu(undefined)">
                  清除错误类型
                </button>
              </div>
            </Transition>
          </div>
        </template>

        <div class="mx-0.5 h-4 w-px bg-border" />

        <!-- 撤销 -->
        <button type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="撤销"
          aria-label="撤销">
          <Undo class="h-3.5 w-3.5" />
        </button>

        <!-- 更多操作触发器 -->
        <button ref="triggerRef"
          type="button"
          data-testid="annotation-overlay-more"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors"
          :class="drawerOpen
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          title="更多操作"
          aria-label="更多操作"
          @click="toggleDrawer">
          <MoreHorizontal class="h-3.5 w-3.5" />
        </button>

        <div class="mx-0.5 h-4 w-px bg-border" />

        <!-- 保存批注 -->
        <button type="button"
          data-testid="annotation-overlay-save"
          class="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!hasAnyAnnotations"
          title="保存批注"
          aria-label="保存批注"
          @click="openAnnotationPanel">
          <Check class="h-3.5 w-3.5" />
          <span>保存批注</span>
        </button>

        <!-- 抽屉弹出菜单 (向上) -->
        <Transition enter-active-class="transition duration-150 ease-out"
          enter-from-class="translate-y-2 scale-95 opacity-0"
          enter-to-class="translate-y-0 scale-100 opacity-100"
          leave-active-class="transition duration-100 ease-in"
          leave-from-class="translate-y-0 scale-100 opacity-100"
          leave-to-class="translate-y-2 scale-95 opacity-0">
          <div v-if="drawerOpen"
            ref="drawerRef"
            data-testid="annotation-overlay-drawer"
            class="absolute bottom-full right-0 mb-2 min-w-[180px] overflow-hidden rounded-xl border border-border bg-background/95 shadow-xl backdrop-blur">
            <!-- 当前批注操作 -->
            <div class="border-b border-border px-3 pb-1 pt-2">
              <div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">当前批注</div>
              <button type="button"
                data-testid="annotation-overlay-fly-current"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentActionDisabled"
                title="定位当前"
                aria-label="定位当前"
                @click="flyCurrent">
                <Focus class="h-3.5 w-3.5 shrink-0" />
                <span>定位当前</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-current-visibility"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentActionDisabled"
                :title="currentVisibilityLabel"
                :aria-label="currentVisibilityLabel"
                @click="toggleCurrentVisible">
                <component :is="currentAnnotation?.record.visible ? EyeOff : Eye" class="h-3.5 w-3.5 shrink-0" />
                <span>{{ currentVisibilityLabel }}</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-delete-current"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentActionDisabled"
                title="删除当前"
                aria-label="删除当前"
                @click="deleteCurrent">
                <Trash2 class="h-3.5 w-3.5 shrink-0" />
                <span>删除当前</span>
              </button>

              <!-- 当前批注严重度快捷 -->
              <div data-testid="annotation-overlay-current-severity"
                class="mt-1 rounded-lg border border-dashed border-border/60 px-2 py-1.5"
                :class="currentActionDisabled ? 'opacity-40' : ''">
                <div class="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>错误类型</span>
                  <span v-if="currentSeverity" class="font-medium"
                    :class="getAnnotationSeverityDisplay(currentSeverity).color + ' border rounded px-1'">
                    {{ getAnnotationSeverityDisplay(currentSeverity).symbol }} {{ getAnnotationSeverityDisplay(currentSeverity).label }}
                  </span>
                  <span v-else>未设置</span>
                </div>
                <div class="flex gap-1">
                  <button v-for="bucket in SEVERITY_QUICK_BUCKETS"
                    :key="bucket.key"
                    type="button"
                    :data-testid="'annotation-overlay-severity-' + bucket.key"
                    class="inline-flex flex-1 items-center justify-center gap-1 rounded border px-1 py-0.5 text-[10px] transition-colors disabled:pointer-events-none disabled:opacity-40"
                    :class="currentSeverity === bucket.key ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-muted'"
                    :disabled="!canEditCurrentSeverity"
                    :title="bucket.label"
                    @click="setCurrentSeverity(bucket.key)">
                    <span class="inline-block h-1.5 w-1.5 rounded-full" :class="bucket.dotClass" />
                    {{ bucket.label }}
                  </button>
                  <button type="button"
                    data-testid="annotation-overlay-severity-clear"
                    class="inline-flex items-center justify-center rounded border border-input px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                    :disabled="!canEditCurrentSeverity || !currentSeverity"
                    title="清除错误类型"
                    @click="setCurrentSeverity(undefined)">
                    ✕
                  </button>
                </div>
              </div>
            </div>

            <!-- 批量操作 -->
            <div class="px-3 pb-2 pt-1">
              <div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">批量操作</div>
              <button type="button"
                data-testid="annotation-overlay-type-visibility"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentTypeActionDisabled"
                :title="currentTypeVisibilityLabel"
                :aria-label="currentTypeVisibilityLabel"
                @click="toggleCurrentTypeVisible">
                <component :is="currentTypeHasHidden ? Eye : EyeOff" class="h-3.5 w-3.5 shrink-0" />
                <span>{{ currentTypeVisibilityLabel }}</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-type-clear"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentTypeActionDisabled"
                title="清空当前类型"
                aria-label="清空当前类型"
                @click="clearCurrentType">
                <Trash2 class="h-3.5 w-3.5 shrink-0" />
                <span>清空当前类型</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-all-visibility"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                :disabled="!hasAnyAnnotations"
                :title="allVisibilityLabel"
                :aria-label="allVisibilityLabel"
                @click="toggleAllVisible">
                <component :is="hasHiddenAnnotations ? Eye : EyeOff" class="h-3.5 w-3.5 shrink-0" />
                <span>{{ allVisibilityLabel }}</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-clear-all"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
                :disabled="!hasAnyAnnotations"
                title="清空全部批注"
                aria-label="清空全部批注"
                @click="clearAll">
                <Trash class="h-3.5 w-3.5 shrink-0" />
                <span>清空全部批注</span>
              </button>

              <!-- 当前类型批量严重度 -->
              <div data-testid="annotation-overlay-batch-severity"
                class="mt-1 rounded-lg border border-dashed border-border/60 px-2 py-1.5"
                :class="batchActionDisabled ? 'opacity-40' : ''">
                <div class="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>当前类型批量错误类型</span>
                  <span class="font-medium">可改 {{ currentTypeEditableCount }}/{{ currentTypeRecords.length }}</span>
                </div>
                <div class="flex gap-1">
                  <button v-for="bucket in SEVERITY_QUICK_BUCKETS"
                    :key="bucket.key"
                    type="button"
                    :data-testid="'annotation-overlay-batch-severity-' + bucket.key"
                    class="inline-flex flex-1 items-center justify-center gap-1 rounded border border-input px-1 py-0.5 text-[10px] transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                    :disabled="batchActionDisabled"
                    :title="'批量设为' + bucket.label"
                    @click="batchSetCurrentTypeSeverity(bucket.key)">
                    <span class="inline-block h-1.5 w-1.5 rounded-full" :class="bucket.dotClass" />
                    {{ bucket.label }}
                  </button>
                  <button type="button"
                    data-testid="annotation-overlay-batch-severity-clear"
                    class="inline-flex items-center justify-center rounded border border-input px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                    :disabled="batchActionDisabled"
                    title="批量清除错误类型"
                    @click="batchSetCurrentTypeSeverity(undefined)">
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>
