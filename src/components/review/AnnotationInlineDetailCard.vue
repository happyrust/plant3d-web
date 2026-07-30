<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  Camera,
  ChevronUp,
  Eye,
  LocateFixed,
  MessageSquareText,
  Ruler,
  X,
} from 'lucide-vue-next';

import { getAnnotationWorkspaceTypeDisplay } from './annotationWorkspaceModel';
import ReviewCommentsTimeline from './ReviewCommentsTimeline.vue';

import type {
  AnnotationWorkspaceItem,
  LinkedMeasurementItem,
} from './annotationWorkspaceModel';
import type { AnnotationType, MeasurementRecord } from '@/composables/useToolStore';

import { reviewAttachmentDelete } from '@/api/reviewApi';
import { useScreenshot } from '@/composables/useScreenshot';
import { useToolStore } from '@/composables/useToolStore';
import { emitToast } from '@/ribbon/toastBus';
import {
  getAnnotationSeverityDisplay,
  type AnnotationReviewAction,
  type AnnotationReviewState,
  UserRole,
} from '@/types/auth';

const props = withDefaults(defineProps<{
  item: AnnotationWorkspaceItem;
  linkedMeasurements?: LinkedMeasurementItem[];
  currentUserRole?: UserRole | null;
  formId?: string | null;
  taskId?: string | null;
  density?: 'normal' | 'dock';
  allowReviewActions?: boolean;
  designerOnly?: boolean;
  showMeasurementActions?: boolean;
  showElevationMeasurementActions?: boolean;
}>(), {
  linkedMeasurements: () => [],
  currentUserRole: null,
  formId: null,
  taskId: null,
  density: 'normal',
  allowReviewActions: true,
  designerOnly: undefined,
  showMeasurementActions: true,
  showElevationMeasurementActions: true,
});

const emit = defineEmits<{
  (e: 'locate', item: AnnotationWorkspaceItem): void;
  (e: 'locate-elements', payload: { item: AnnotationWorkspaceItem; refnos: string[] }): void;
  (e: 'start-measurement', kind: MeasurementRecord['kind'], item: AnnotationWorkspaceItem): void;
  (e: 'locate-measurement', item: LinkedMeasurementItem): void;
  (e: 'close'): void;
  (e: 'review-action-completed', payload: {
    action: AnnotationReviewAction;
    annotationType: AnnotationType;
    annotationId: string;
    state: AnnotationReviewState;
  }): void;
}>();

const isDockDensity = computed(() => props.density === 'dock');
const typeDisplay = computed(() => getAnnotationWorkspaceTypeDisplay(props.item.type));
const isDesignerOnly = computed(() => (
  props.designerOnly ?? props.currentUserRole === UserRole.DESIGNER
));
const cloudMemberBindings = computed(() => (
  props.item.cloudBindings?.filter((binding) => binding.role === 'member') ?? []
));
const cloudAnchorBinding = computed(() => (
  props.item.cloudBindings?.find((binding) => binding.role === 'anchor')
));

// ==================== 批注截图（拍摄当前视角） ====================

const toolStore = useToolStore();
const { captureAndUpload, isCapturing } = useScreenshot();
/** 本卡片是否正在截图（isCapturing 是全局的，用本地 ref 区分是哪张卡在拍） */
const capturingScreenshot = ref(false);
const screenshotPreviewUrl = ref<string | null>(null);
const screenshotUrl = computed(() => props.item.screenshot?.url || props.item.thumbnailUrl || null);

/** 需要任务上下文才能上传附件；无任务时隐藏拍摄入口 */
const canCaptureScreenshot = computed(() => !!props.taskId);

function openScreenshotPreview() {
  screenshotPreviewUrl.value = screenshotUrl.value;
}

/**
 * 校审时为当前批注拍摄 3D 视角作为代表截图。
 * 语义与批注面板一致：覆盖旧图；重拍成功后异步清理旧附件。
 */
async function captureItemScreenshot() {
  const taskId = props.taskId;
  if (!taskId) {
    emitToast({ message: '请先进入校审任务后再截图', level: 'warning' });
    return;
  }
  if (isCapturing.value) return;
  const existing = toolStore.getAnnotationScreenshot(props.item.type, props.item.id);
  if (
    existing
    && typeof window !== 'undefined'
    && !window.confirm('该批注已有截图，是否重新拍摄并替换？')
  ) {
    return;
  }

  capturingScreenshot.value = true;
  try {
    const severityLabel = getAnnotationSeverityDisplay(props.item.severity).label;
    const description = [
      severityLabel !== '未设置' ? severityLabel : null,
      props.item.title?.trim() || null,
    ].filter((part): part is string => !!part).join(' - ');
    const attachment = await captureAndUpload(taskId, {
      kind: 'annotation_shot',
      sourceAnnotationId: props.item.id,
      description: description || undefined,
    });
    if (!attachment) {
      emitToast({ message: '截图失败，请重试', level: 'error' });
      return;
    }
    toolStore.setAnnotationScreenshot(props.item.type, props.item.id, {
      url: attachment.url,
      attachmentId: attachment.id,
      name: attachment.name,
      capturedAt: attachment.capturedAt,
    });
    if (existing?.attachmentId && existing.attachmentId !== attachment.id) {
      void reviewAttachmentDelete(existing.attachmentId).catch(() => {
        emitToast({ message: '旧截图附件清理失败', level: 'warning' });
      });
    }
    emitToast({ message: '截图已添加', level: 'success' });
  } finally {
    capturingScreenshot.value = false;
  }
}

function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '时间未知';
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <section data-testid="annotation-inline-detail-card"
    :data-density="density"
    class="overflow-hidden border border-brand/25 bg-slate-50/80 shadow-inner"
    :class="isDockDensity ? 'rounded-lg' : 'rounded-xl'">
    <div class="grid min-w-0 gap-3"
      :class="isDockDensity ? 'p-3' : 'p-4 xl:grid-cols-[minmax(220px,0.75fr)_minmax(340px,1.25fr)]'">
      <div class="min-w-0 space-y-3">
        <div class="rounded-lg border border-slate-200 bg-white p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                  :class="typeDisplay.tone">
                  {{ typeDisplay.label }}
                </span>
                <span class="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                  :class="item.statusTone">
                  {{ item.statusLabel }}
                </span>
                <span class="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                  :class="item.priorityTone">
                  {{ item.priorityLabel }}
                </span>
              </div>
              <h3 class="mt-2 break-words text-sm font-semibold text-slate-950">
                {{ item.title }}
              </h3>
            </div>
            <button data-testid="annotation-detail-close"
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              title="收起详情"
              @click="emit('close')">
              <ChevronUp class="h-3.5 w-3.5" />
              收起
            </button>
          </div>

          <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
            {{ item.description || '暂无批注描述' }}
          </p>
          <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
            <span v-if="item.type !== 'cloud' && item.refnos.length">RefNo {{ item.refnos.join(', ') }}</span>
            <span>{{ item.commentCount }} 条讨论</span>
            <span>{{ formatDateTime(item.activityAt) }}</span>
          </div>
          <button data-testid="annotation-detail-locate"
            type="button"
            class="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-brand/40 hover:bg-brand-subtle/40"
            @click="emit('locate', item)">
            <LocateFixed class="h-3.5 w-3.5" />
            定位到模型
          </button>
        </div>

        <div v-if="item.type === 'cloud'"
          data-testid="annotation-cloud-bindings"
          class="rounded-lg border border-slate-200 bg-white p-3">
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-sm font-semibold text-slate-900">
              关联元素 {{ cloudMemberBindings.length }}
            </h4>
            <button v-if="cloudMemberBindings.length > 0"
              data-testid="annotation-cloud-locate-all"
              type="button"
              class="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-brand/40 hover:text-brand"
              @click="emit('locate-elements', { item, refnos: item.refnos })">
              <LocateFixed class="h-3 w-3" />
              定位高亮全部
            </button>
          </div>

          <div v-if="cloudMemberBindings.length > 0" class="mt-2 space-y-1.5">
            <div v-for="binding in cloudMemberBindings"
              :key="binding.refno"
              class="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-2">
              <div class="min-w-0">
                <div v-if="binding.noun" class="text-[11px] font-semibold text-slate-700">{{ binding.noun }}</div>
                <div class="truncate font-mono text-[11px] text-slate-500" :title="binding.refno">{{ binding.refno }}</div>
              </div>
              <button type="button"
                :data-testid="`annotation-cloud-locate-${binding.refno}`"
                class="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-brand/40"
                @click="emit('locate-elements', { item, refnos: [binding.refno] })">
                定位高亮
              </button>
            </div>
          </div>
          <p v-else class="mt-2 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
            历史批注未关联元素
          </p>

          <div v-if="cloudAnchorBinding" class="mt-3 border-t border-slate-100 pt-2">
            <div class="text-[11px] font-semibold text-slate-500">云线锚点</div>
            <div class="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
              <span v-if="cloudAnchorBinding.noun" class="font-semibold text-slate-700">{{ cloudAnchorBinding.noun }}</span>
              <span class="truncate font-mono" :title="cloudAnchorBinding.refno">{{ cloudAnchorBinding.refno }}</span>
            </div>
          </div>
        </div>

        <figure v-if="screenshotUrl"
          class="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <button data-testid="annotation-detail-screenshot-preview-trigger"
            type="button"
            class="block w-full cursor-zoom-in bg-slate-50"
            title="预览问题截图"
            @click="openScreenshotPreview">
            <img data-testid="annotation-detail-screenshot"
              :src="screenshotUrl"
              :alt="`${item.title} 批注截图`"
              class="max-h-64 w-full object-contain" />
          </button>
          <figcaption class="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            问题截图
            <span class="flex items-center gap-1.5">
              <button data-testid="annotation-detail-screenshot-preview-button"
                type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-brand/40 hover:text-brand"
                @click="openScreenshotPreview">
                <Eye class="h-3 w-3" />
                预览
              </button>
              <button v-if="canCaptureScreenshot"
                data-testid="annotation-detail-screenshot-retake"
                type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="capturingScreenshot"
                title="重新拍摄当前视角并替换截图"
                @click="void captureItemScreenshot()">
                <Camera class="h-3 w-3" />
                {{ capturingScreenshot ? '截图中…' : '重拍' }}
              </button>
            </span>
          </figcaption>
        </figure>
        <button v-else-if="canCaptureScreenshot"
          data-testid="annotation-detail-screenshot-capture"
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-xs text-slate-500 hover:border-brand/40 hover:bg-brand-subtle/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="capturingScreenshot"
          @click="void captureItemScreenshot()">
          <Camera class="h-3.5 w-3.5" />
          {{ capturingScreenshot ? '正在截图…' : '拍摄当前视角 · 作为批注截图' }}
        </button>

        <div class="rounded-lg border border-slate-200 bg-white p-3">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 class="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Ruler class="h-4 w-4 text-brand" />
                测量证据
              </h4>
              <p class="mt-1 text-xs text-slate-500">
                仅作为当前批注的辅助证据。
              </p>
            </div>
            <div v-if="showMeasurementActions" class="flex flex-wrap gap-1.5">
              <button data-testid="annotation-detail-add-distance"
                type="button"
                class="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                @click="emit('start-measurement', 'distance', item)">
                新增距离
              </button>
              <button data-testid="annotation-detail-add-angle"
                type="button"
                class="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                @click="emit('start-measurement', 'angle', item)">
                新增角度
              </button>
              <template v-if="showElevationMeasurementActions">
                <button data-testid="annotation-detail-add-elevation-point"
                  type="button"
                  class="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  @click="emit('start-measurement', 'elevation_point', item)">
                  新增点标高
                </button>
                <button data-testid="annotation-detail-add-elevation-delta"
                  type="button"
                  class="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  @click="emit('start-measurement', 'elevation_delta', item)">
                  新增高差
                </button>
              </template>
            </div>
          </div>

          <div v-if="linkedMeasurements.length === 0"
            class="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
            当前批注还没有关联的测量证据。
          </div>
          <div v-else class="mt-3 space-y-2">
            <div v-for="measurement in linkedMeasurements"
              :key="`${measurement.engine}:${measurement.id}`"
              class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div class="min-w-0">
                <div class="truncate text-xs font-medium text-slate-900">
                  {{ measurement.summary }}
                </div>
                <div class="mt-0.5 text-[11px] text-slate-400">
                  {{ formatDateTime(measurement.createdAt) }}
                </div>
              </div>
              <button :data-testid="`annotation-detail-locate-measurement-${measurement.id}`"
                type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-brand/40"
                @click="emit('locate-measurement', measurement)">
                <LocateFixed class="h-3 w-3" />
                定位
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="min-h-0 min-w-0 overflow-hidden rounded-lg bg-white">
        <div class="flex items-center gap-1.5 border-x border-t border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
          <MessageSquareText class="h-3.5 w-3.5 text-brand" />
          讨论与处理
        </div>
        <ReviewCommentsTimeline :annotation-type="item.type"
          :annotation-id="item.id"
          :annotation-label="`${typeDisplay.label}批注 / ${item.title}`"
          :designer-only="isDesignerOnly"
          :context-form-id="formId"
          :context-task-id="taskId"
          :allow-review-actions="allowReviewActions"
          :density="density"
          @close="emit('close')"
          @review-action-completed="emit('review-action-completed', $event)" />
      </div>
    </div>
  </section>

  <Teleport v-if="screenshotPreviewUrl" to="body">
    <div data-testid="annotation-detail-screenshot-preview"
      role="dialog"
      aria-modal="true"
      aria-label="问题截图预览"
      class="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/80 p-6"
      @click="screenshotPreviewUrl = null">
      <button data-testid="annotation-detail-screenshot-preview-close"
        type="button"
        class="absolute right-5 top-5 inline-flex items-center gap-1 rounded-lg bg-white/95 px-3 py-2 text-xs font-semibold text-slate-700 shadow"
        @click.stop="screenshotPreviewUrl = null">
        <X class="h-4 w-4" />
        关闭
      </button>
      <img data-testid="annotation-detail-screenshot-preview-image"
        :src="screenshotPreviewUrl"
        alt="问题截图预览"
        class="max-h-full max-w-full rounded-lg bg-white object-contain shadow-2xl"
        @click.stop />
    </div>
  </Teleport>
</template>
