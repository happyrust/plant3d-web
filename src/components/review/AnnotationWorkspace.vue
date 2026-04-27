<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Cloud,
  LocateFixed,
  MessageSquare,
  Plus,
  RectangleHorizontal,
  Ruler,
  Type,
} from 'lucide-vue-next';

import {
  ANNOTATION_WORKSPACE_FILTER_OPTIONS,
  ANNOTATION_WORKSPACE_PRIORITY_OPTIONS,
  getAnnotationWorkspaceTypeDisplay,
  type AnnotationWorkspaceFilter,
  type AnnotationWorkspaceItem,
  type AnnotationWorkspaceRole,
  type AnnotationWorkspaceSummary,
  type LinkedMeasurementItem,
} from './annotationWorkspaceModel';
import ReviewCommentsTimeline from './ReviewCommentsTimeline.vue';

import type { AnnotationSeverity, AnnotationType } from '@/types/auth';

const props = withDefaults(defineProps<{
  role: AnnotationWorkspaceRole;
  items: AnnotationWorkspaceItem[];
  summary: AnnotationWorkspaceSummary;
  activeFilter: AnnotationWorkspaceFilter;
  selectedAnnotation: AnnotationWorkspaceItem | null;
  linkedMeasurements: LinkedMeasurementItem[];
  confirmNote: string;
  unsavedAnnotationCount: number;
  unsavedMeasurementCount: number;
  canConfirm: boolean;
  confirmSaving: boolean;
  confirmError?: string | null;
  canEditSeverity?: boolean;
  showToolLauncher?: boolean;
  confirmActionLabel?: string;
  confirmHint?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  timelineDesignerOnly?: boolean;
  timelinePlaceholder?: string;
  timelineSubmitLabel?: string;
  layout?: 'split' | 'list' | 'detail';
  listScrollTop?: number;
  showDetailBack?: boolean;
  detailBackLabel?: string;
}>(), {
  confirmError: null,
  canEditSeverity: false,
  showToolLauncher: false,
  confirmActionLabel: '保存新增证据',
  confirmHint: '保存后会以当前新增批注和测量快照生成处理留痕。',
  emptyTitle: '当前还没有批注数据',
  emptyDescription: '请在模型中创建批注，或切换到有批注的任务。',
  timelineDesignerOnly: false,
  timelinePlaceholder: '输入意见...',
  timelineSubmitLabel: '发送回复',
  layout: 'split',
  listScrollTop: 0,
  showDetailBack: false,
  detailBackLabel: '返回批注列表',
});

const emit = defineEmits<{
  (e: 'update:activeFilter', value: AnnotationWorkspaceFilter): void;
  (e: 'update:confirmNote', value: string): void;
  (e: 'update:list-scroll-top', value: number): void;
  (e: 'select-annotation', item: AnnotationWorkspaceItem): void;
  (e: 'open-annotation', item: AnnotationWorkspaceItem): void;
  (e: 'locate-annotation', item: AnnotationWorkspaceItem): void;
  (e: 'locate-measurement', item: LinkedMeasurementItem): void;
  (e: 'start-tool', tool: 'annotation' | 'annotation_cloud' | 'annotation_rect'): void;
  (e: 'start-measurement', kind: 'distance' | 'angle'): void;
  (e: 'confirm'): void;
  (e: 'update-severity', value: AnnotationSeverity | undefined): void;
  (e: 'back'): void;
}>();

const showMeasurementMenu = ref(false);
const listPaneRef = ref<HTMLElement | null>(null);
const screenshotPreviewUrl = ref<string | null>(null);

const selectedTypeDisplay = computed(() => (
  props.selectedAnnotation ? getAnnotationWorkspaceTypeDisplay(props.selectedAnnotation.type) : null
));

const selectedSeverityValue = computed<AnnotationSeverity | undefined>(() => props.selectedAnnotation?.severity);

const filterCounts = computed(() => ({
  all: props.summary.total,
  pending: props.summary.pending,
  fixed: props.summary.fixed,
  rejected: props.summary.rejected,
  high_priority: props.summary.highPriority,
}));
const showListPane = computed(() => props.layout !== 'detail');
const showDetailPane = computed(() => props.layout !== 'list');
const showTopSummary = computed(() => props.layout !== 'detail');
const listContainerClass = computed(() => (
  props.layout === 'split'
    ? 'mt-4 grid min-h-[560px] gap-4 xl:grid-cols-[360px_minmax(0,1fr)]'
    : 'mt-4'
));
const listPaneClass = computed(() => (
  props.layout === 'split'
    ? 'min-h-0 rounded-[24px] border border-slate-200 bg-slate-50/80 p-3'
    : 'rounded-[24px] border border-slate-200 bg-slate-50/80 p-4'
));
const detailPaneClass = computed(() => (
  props.layout === 'split'
    ? 'min-h-0 rounded-[24px] border border-slate-200 bg-[#FCFDFE] p-4'
    : 'rounded-[24px] border border-slate-200 bg-[#FCFDFE] p-4'
));

function updateConfirmNote(event: Event) {
  const target = event.target as HTMLTextAreaElement | HTMLInputElement | null;
  emit('update:confirmNote', target?.value ?? '');
}

function updateListScrollTop(event: Event) {
  const target = event.target as HTMLElement | null;
  emit('update:list-scroll-top', target?.scrollTop ?? 0);
}

function openScreenshotPreview(item: AnnotationWorkspaceItem | null) {
  screenshotPreviewUrl.value = item?.screenshot?.url || item?.thumbnailUrl || null;
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('[data-annotation-measure-menu]')) {
    showMeasurementMenu.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

watch(
  () => [props.layout, props.listScrollTop, props.items.length, props.activeFilter] as const,
  async () => {
    if (props.layout === 'detail') return;
    await nextTick();
    if (!listPaneRef.value) return;
    if (Math.abs(listPaneRef.value.scrollTop - props.listScrollTop) <= 1) return;
    listPaneRef.value.scrollTop = props.listScrollTop;
  },
  { immediate: true, flush: 'post' },
);
</script>

<template>
  <section class="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm" data-testid="annotation-workspace-root">
    <div v-if="showTopSummary" class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div>
        <div class="text-sm font-semibold text-slate-950">
          当前批注（{{ summary.total }}） / 待处理 {{ summary.pending }} / 原则错误 {{ summary.highPriority }}
        </div>
        <p class="mt-1 text-xs leading-5 text-slate-500">
          先完成单条批注处理，再执行任务级流转。
        </p>
      </div>

      <div v-if="showToolLauncher"
        class="flex flex-wrap items-center gap-2"
        data-testid="reviewer-direct-launch-annotation-zone">
        <button type="button"
          title="文字批注"
          data-testid="reviewer-direct-launch-annotation-text"
          class="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          @click="emit('start-tool', 'annotation')">
          <Type class="h-3.5 w-3.5" />
          文字批注
        </button>
        <button type="button"
          title="云线批注"
          data-testid="reviewer-direct-launch-annotation-cloud"
          class="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          @click="emit('start-tool', 'annotation_cloud')">
          <Cloud class="h-3.5 w-3.5" />
          云线批注
        </button>
        <button type="button"
          title="矩形批注"
          data-testid="reviewer-direct-launch-annotation-rect"
          class="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          @click="emit('start-tool', 'annotation_rect')">
          <RectangleHorizontal class="h-3.5 w-3.5" />
          矩形批注
        </button>
        <div class="relative" data-testid="reviewer-direct-launch-measurement-zone" data-annotation-measure-menu>
          <button type="button"
            title="创建测量"
            class="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            @click="showMeasurementMenu = !showMeasurementMenu">
            <Plus class="h-3.5 w-3.5" />
            创建测量
          </button>
          <div v-if="showMeasurementMenu"
            class="absolute right-0 top-full z-10 mt-2 min-w-[136px] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg">
            <button type="button"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              @click="showMeasurementMenu = false; emit('start-measurement', 'distance')">
              <Ruler class="h-3.5 w-3.5" />
              距离测量
            </button>
            <button type="button"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              @click="showMeasurementMenu = false; emit('start-measurement', 'angle')">
              <Ruler class="h-3.5 w-3.5" />
              角度测量
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showTopSummary" class="mt-4 grid gap-3 sm:grid-cols-3" data-testid="annotation-workspace-summary">
      <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div class="text-xs text-slate-400">当前批注</div>
        <div class="mt-2 text-2xl font-semibold text-slate-950">{{ summary.total }}</div>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-amber-50 px-4 py-3">
        <div class="text-xs text-amber-500">待处理</div>
        <div class="mt-2 text-2xl font-semibold text-amber-700">{{ summary.pending }}</div>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-rose-50 px-4 py-3">
        <div class="text-xs text-rose-500">原则错误</div>
        <div class="mt-2 text-2xl font-semibold text-rose-700">{{ summary.highPriority }}</div>
      </div>
    </div>

    <div v-if="showTopSummary" class="mt-4 flex flex-wrap items-center gap-2">
      <button v-for="filter in ANNOTATION_WORKSPACE_FILTER_OPTIONS"
        :key="filter.value"
        type="button"
        class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
        :class="activeFilter === filter.value
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'"
        @click="emit('update:activeFilter', filter.value)">
        <span>{{ filter.label }}</span>
        <span class="rounded-full px-1.5 py-0.5 text-[10px]"
          :class="activeFilter === filter.value ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'">
          {{ filterCounts[filter.value] }}
        </span>
      </button>
    </div>

    <div :class="listContainerClass">
      <section v-if="showListPane" :class="listPaneClass" data-testid="annotation-workspace-list">
        <div class="flex items-center justify-between gap-3 px-2 pb-3">
          <div>
            <div class="text-sm font-semibold text-slate-900">批注列表</div>
            <div class="mt-1 text-xs text-slate-500">按状态与错误类型筛选当前任务的批注。</div>
          </div>
          <div class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
            {{ items.length }} 条
          </div>
        </div>

        <div v-if="items.length === 0"
          class="flex h-[calc(100%-3rem)] min-h-[320px] flex-col items-center justify-center rounded-[20px] border border-dashed border-slate-200 bg-white px-5 text-center">
          <MessageSquare class="h-8 w-8 text-slate-300" />
          <div class="mt-3 text-sm font-semibold text-slate-700">{{ emptyTitle }}</div>
          <div class="mt-2 text-xs leading-5 text-slate-500">{{ emptyDescription }}</div>
        </div>

        <div v-else
          ref="listPaneRef"
          class="space-y-2 overflow-y-auto pr-1"
          style="max-height: 620px;"
          @scroll="updateListScrollTop">
          <button v-for="item in items"
            :key="`${item.type}:${item.id}`"
            type="button"
            :data-testid="`annotation-row-${item.type}-${item.id}`"
            class="w-full rounded-[20px] border p-3 text-left transition"
            :class="selectedAnnotation?.id === item.id && selectedAnnotation?.type === item.type
              ? 'border-orange-200 bg-orange-50/80 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'"
            @click="emit('select-annotation', item)"
            @dblclick="emit('open-annotation', item)">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                    :class="getAnnotationWorkspaceTypeDisplay(item.type).tone">
                    {{ getAnnotationWorkspaceTypeDisplay(item.type).label }}
                  </span>
                  <span class="rounded-full border px-2 py-0.5 text-[11px] font-semibold" :class="item.statusTone">
                    {{ item.statusLabel }}
                  </span>
                  <span class="rounded-full border px-2 py-0.5 text-[11px] font-semibold" :class="item.priorityTone">
                    {{ item.priorityLabel }}
                  </span>
                </div>
                <div class="mt-2 truncate text-sm font-semibold text-slate-950">{{ item.title }}</div>
                <div class="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{{ item.description || '暂无批注描述' }}</div>
                <div class="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  <span v-if="item.refnos.length">RefNo {{ item.refnos.join(', ') }}</span>
                  <span>{{ new Date(item.activityAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
                  <span v-if="item.commentCount > 0">{{ item.commentCount }} 条意见</span>
                </div>
              </div>
              <button v-if="item.thumbnailUrl"
                type="button"
                class="h-16 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                title="查看批注截图"
                @click.stop="openScreenshotPreview(item)">
                <img :src="item.thumbnailUrl" alt="批注截图" class="h-full w-full object-cover" />
              </button>
              <button type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-white"
                @click.stop="emit('locate-annotation', item)">
                <LocateFixed class="h-3.5 w-3.5" />
                定位
              </button>
            </div>
          </button>
        </div>
      </section>

      <section v-if="showDetailPane" :class="detailPaneClass" data-testid="annotation-workspace-detail">
        <div v-if="layout === 'detail' && showDetailBack" class="mb-4">
          <button type="button"
            class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            data-testid="annotation-workspace-back"
            @click="emit('back')">
            <ArrowLeft class="h-4 w-4" />
            {{ detailBackLabel }}
          </button>
        </div>

        <template v-if="selectedAnnotation">
          <div class="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span v-if="selectedTypeDisplay" class="rounded-full border px-2.5 py-1 text-xs font-semibold"
                    :class="selectedTypeDisplay.tone">
                    {{ selectedTypeDisplay.label }}
                  </span>
                  <span class="rounded-full border px-2.5 py-1 text-xs font-semibold" :class="selectedAnnotation.statusTone">
                    {{ selectedAnnotation.statusLabel }}
                  </span>
                  <span class="rounded-full border px-2.5 py-1 text-xs font-semibold" :class="selectedAnnotation.priorityTone">
                    {{ selectedAnnotation.priorityLabel }}
                  </span>
                </div>
                <h3 class="mt-3 text-xl font-semibold text-slate-950">{{ selectedAnnotation.title }}</h3>
                <p class="mt-2 text-sm leading-6 text-slate-600">
                  {{ selectedAnnotation.description || '可继续补充处理说明、回复意见与测量证据。' }}
                </p>
                <button v-if="selectedAnnotation.thumbnailUrl"
                  type="button"
                  class="mt-4 block h-36 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
                  title="查看批注截图"
                  @click="openScreenshotPreview(selectedAnnotation)">
                  <img :src="selectedAnnotation.thumbnailUrl" alt="批注截图" class="h-full w-full object-cover" />
                </button>
                <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span v-if="selectedAnnotation.refnos.length">RefNo {{ selectedAnnotation.refnos.join(', ') }}</span>
                  <span>{{ new Date(selectedAnnotation.activityAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
                  <span>{{ selectedAnnotation.commentCount }} 条意见</span>
                </div>
              </div>
              <button type="button"
                class="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                @click="emit('locate-annotation', selectedAnnotation)">
                <LocateFixed class="h-4 w-4" />
                定位到模型
              </button>
            </div>

            <div class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              <AlertCircle class="mr-1 inline h-3.5 w-3.5" />
              当前批注处理与任务流转分离；请先完成单条批注处理，再执行底部任务流转。
            </div>

            <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">错误类型设置</div>
                  <div class="mt-1 text-sm text-slate-500">原则错误、一般错误、图面错误用于记录校审问题类型。</div>
                </div>
                <div class="text-xs text-slate-400">{{ canEditSeverity ? '点击即可调整' : '当前角色只读' }}</div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button v-for="option in ANNOTATION_WORKSPACE_PRIORITY_OPTIONS"
                  :key="option.label"
                  type="button"
                  class="rounded-full border px-4 py-1.5 text-xs font-semibold transition"
                  :disabled="!canEditSeverity"
                  :class="selectedSeverityValue === option.value
                    ? option.tone + ' shadow-sm'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'"
                  @click="emit('update-severity', option.value)">
                  {{ option.label }}
                </button>
              </div>
            </div>
          </div>

          <div class="mt-4 min-h-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <ReviewCommentsTimeline :annotation-type="selectedAnnotation.type"
              :annotation-id="selectedAnnotation.id"
              :annotation-label="selectedAnnotation.title"
              :screenshot="selectedAnnotation.screenshot"
              :composer-placeholder="timelinePlaceholder"
              :composer-submit-label="timelineSubmitLabel"
              :designer-only="timelineDesignerOnly" />
          </div>

          <div class="mt-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-slate-950">测量证据</div>
                <div class="mt-1 text-xs text-slate-500">测量只作为当前批注的处理证据，不单独参与状态流转。</div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button"
                  class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  @click="emit('start-measurement', 'distance')">
                  <Ruler class="h-3.5 w-3.5" />
                  新增距离
                </button>
                <button type="button"
                  class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  @click="emit('start-measurement', 'angle')">
                  <Ruler class="h-3.5 w-3.5" />
                  新增角度
                </button>
              </div>
            </div>

            <div v-if="linkedMeasurements.length === 0"
              class="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              当前批注还没有关联的测量证据。
            </div>
            <div v-else class="mt-3 space-y-2">
              <div v-for="measurement in linkedMeasurements"
                :key="`${measurement.engine}:${measurement.id}`"
                class="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-slate-900">{{ measurement.summary }}</div>
                  <div class="mt-1 text-xs text-slate-400">
                    {{ new Date(measurement.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}
                  </div>
                </div>
                <button type="button"
                  class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
                  @click="emit('locate-measurement', measurement)">
                  <LocateFixed class="h-3.5 w-3.5" />
                  定位
                </button>
              </div>
            </div>
          </div>

          <div class="mt-4 rounded-[24px] bg-slate-950 px-4 py-4 text-white shadow-xl">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-sm font-semibold">保存新增证据</div>
                <div class="mt-1 text-xs leading-5 text-slate-300">
                  {{ confirmHint }}
                </div>
              </div>
              <div class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-100">
                未确认 {{ unsavedAnnotationCount }} 批注 / {{ unsavedMeasurementCount }} 测量
              </div>
            </div>

            <div class="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <textarea class="min-h-[72px] w-full resize-none bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
                :value="confirmNote"
                placeholder="补充本轮处理说明（可选）"
                @input="updateConfirmNote" />
            </div>

            <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div v-if="confirmError" class="text-xs text-rose-300">{{ confirmError }}</div>
              <div v-else class="text-xs text-slate-400">
                {{ canConfirm ? confirmHint : '当前没有新的处理数据需要确认。' }}
              </div>
              <button type="button"
                class="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-700"
                :disabled="!canConfirm || confirmSaving"
                @click="emit('confirm')">
                <CheckCircle class="h-4 w-4" />
                {{ confirmSaving ? '保存中...' : confirmActionLabel }}
              </button>
            </div>
          </div>
        </template>

        <div v-else class="flex h-full min-h-[520px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-center">
          <MessageSquare class="h-10 w-10 text-slate-300" />
          <div class="mt-4 text-base font-semibold text-slate-700">先选择一条批注</div>
          <div class="mt-2 max-w-sm text-sm leading-6 text-slate-500">左侧列表会按状态和错误类型自动排序；选择后可继续回复、补测量和确认处理数据。</div>
        </div>

        <div v-if="$slots.workflow && layout !== 'list'" class="mt-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <slot name="workflow" />
        </div>
      </section>
    </div>

    <Teleport v-if="screenshotPreviewUrl" to="body">
      <div class="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/70 p-6"
        data-testid="annotation-workspace-screenshot-preview"
        @click="screenshotPreviewUrl = null">
        <img :src="screenshotPreviewUrl"
          alt="批注截图预览"
          class="max-h-full max-w-full rounded-2xl bg-white object-contain shadow-2xl"
          @click.stop />
      </div>
    </Teleport>
  </section>
</template>
