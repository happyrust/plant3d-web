<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import {
  Camera,
  ChevronUp,
  Eye,
  LocateFixed,
  MessageSquareText,
  Plus,
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
import { attachAnnotationScreenshotByRoute } from '@/composables/annotationReceiptRoute';
import { useAnnotationBindingResolve } from '@/composables/useAnnotationBindingResolve';
import { useAnnotationDraftSession } from '@/composables/useAnnotationDraftSession';
import { useScreenshot } from '@/composables/useScreenshot';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { getBindingResolveDisplay, type BindingResolveEntry } from '@/review/domain/bindingResolve';
import { emitToast } from '@/ribbon/toastBus';
import {
  canEditAnnotationSeverity,
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
  (e: 'pick-elements', item: AnnotationWorkspaceItem): void;
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

const toolStore = useToolStore();
const userStore = useUserStore();
const draftSession = useAnnotationDraftSession();

const isDockDensity = computed(() => props.density === 'dock');
const typeDisplay = computed(() => getAnnotationWorkspaceTypeDisplay(props.item.type));

type MeasurementLaunchAction = {
  kind: MeasurementRecord['kind'];
  testId: string;
  label: string;
  shortLabel: string;
};
/** 「新增测量」入口：dock 档用 shortLabel（前面带 + 号），完整 label 进 title；点标高 / 高差受 showElevationMeasurementActions 门控 */
const measurementLaunchActions = computed<MeasurementLaunchAction[]>(() => [
  { kind: 'distance', testId: 'distance', label: '新增距离', shortLabel: '距离' },
  { kind: 'angle', testId: 'angle', label: '新增角度', shortLabel: '角度' },
  ...(props.showElevationMeasurementActions
    ? [
      { kind: 'elevation_point' as const, testId: 'elevation-point', label: '新增点标高', shortLabel: '点标高' },
      { kind: 'elevation_delta' as const, testId: 'elevation-delta', label: '新增高差', shortLabel: '高差' },
    ]
    : []),
]);
const isDesignerOnly = computed(() => (
  props.designerOnly ?? props.currentUserRole === UserRole.DESIGNER
));
// 四类批注统一为带角色绑定（ADR-0049）：`bindings` 恒有；`cloudBindings` 是云线条目的旧名，过渡期兜底。
const itemBindings = computed(() => props.item.bindings ?? props.item.cloudBindings ?? []);
const memberBindings = computed(() => itemBindings.value.filter((binding) => binding.role === 'member'));
const anchorBinding = computed(() => itemBindings.value.find((binding) => binding.role === 'anchor'));
/** 锚点区块标题：云线沿用「云线锚点」，文字批注的锚点是图钉命中的构件。 */
const anchorLabel = computed(() => (props.item.type === 'cloud' ? '云线锚点' : '锚点构件'));

/**
 * 关联元素可编辑：与严重度共用一套判定（作者本人或审核侧角色），四类批注一致。
 * 只覆盖 member——锚点构件不可更换（ADR-0051）。
 */
const canEditBindings = computed(() => (
  canEditAnnotationSeverity(userStore.currentUser.value, props.item.authorId)
));

function removeMember(refno: string) {
  if (!canEditBindings.value) return;
  if (!toolStore.removeAnnotationMember(props.item.type, props.item.id, refno)) return;
  emitToast({ message: `已移除关联元素 ${refno}`, level: 'success' });
}

// ==================== 关联失效解析（ADR-0050）====================
// 打开这张卡 / 换记录 / 绑定增删时按记录重算；模型加载或版本切换由 composable 内部 watch 全量重算。
const bindingResolve = useAnnotationBindingResolve();
watch(
  () => [props.item.type, props.item.id, itemBindings.value.length] as const,
  () => bindingResolve.resolveRecord(props.item.type, props.item.id),
  { immediate: true },
);

function resolveOf(role: 'anchor' | 'member', refno: string): BindingResolveEntry | undefined {
  // 读 entries.value 让这里跟着整表替换响应
  void bindingResolve.entries.value;
  return bindingResolve.getBindingResolve(props.item.type, props.item.id, role, refno);
}
function resolveDisplayOf(role: 'anchor' | 'member', refno: string) {
  const entry = resolveOf(role, refno);
  return entry ? getBindingResolveDisplay(entry.state) : null;
}
const bindingResolveSummary = computed(() => {
  void bindingResolve.entries.value;
  return bindingResolve.getRecordSummary(props.item.type, props.item.id);
});
/** 只有 missing / stale 时才在标题旁提示「可用 x/N」，正常态不加噪音 */
const showResolveSummary = computed(() => (
  bindingResolveSummary.value.missing > 0 || bindingResolveSummary.value.stale > 0
));
/** 「定位高亮全部」只带还能定位的 member（找不到的构件没有可去的地方） */
const locatableMemberRefnos = computed(() => (
  memberBindings.value
    .filter((binding) => resolveDisplayOf('member', binding.refno)?.canLocate !== false)
    .map((binding) => binding.refno)
));
const anchorResolveDisplay = computed(() => (
  anchorBinding.value ? resolveDisplayOf('anchor', anchorBinding.value.refno) : null
));
const anchorResolveReason = computed(() => (
  anchorBinding.value ? resolveOf('anchor', anchorBinding.value.refno)?.reason : undefined
));

// ==================== 批注截图（拍摄当前视角） ====================

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
  // U0 出发前盖戳：截图上传期间用户可能切到别的任务，回执只能归属出发时那个任务（方案 §3.6）
  const scopeStamp = draftSession.currentStamp();
  // 卡片上的 type / id 也在出发时定下来——props 在等待期间可能已换成别的记录
  const { type: annotationType, id: annotationId } = props.item;
  try {
    const severityLabel = getAnnotationSeverityDisplay(props.item.severity).label;
    const description = [
      severityLabel !== '未设置' ? severityLabel : null,
      props.item.title?.trim() || null,
    ].filter((part): part is string => !!part).join(' - ');
    const attachment = await captureAndUpload(taskId, {
      kind: 'annotation_shot',
      sourceAnnotationId: annotationId,
      description: description || undefined,
    });
    const route = draftSession.routeDataReceipt(scopeStamp);
    // 提示是瞬态的：人已经在别的任务里就不打扰
    const notify = route.kind !== 'other-scope';
    if (!attachment) {
      if (notify) emitToast({ message: '截图失败，请重试', level: 'error' });
      return;
    }
    const attached = attachAnnotationScreenshotByRoute(toolStore, route, annotationType, annotationId, {
      url: attachment.url,
      attachmentId: attachment.id,
      name: attachment.name,
      capturedAt: attachment.capturedAt,
    });
    if (!attached) {
      // 目标批注已不在（内存里 / 出发时那个容器里都找不到）：删掉刚上传的附件，别留孤儿
      void reviewAttachmentDelete(attachment.id).catch(() => {
        emitToast({ message: '截图附件清理失败', level: 'warning' });
      });
      if (notify) emitToast({ message: '批注已不存在，截图未保存', level: 'warning' });
      return;
    }
    if (existing?.attachmentId && existing.attachmentId !== attachment.id) {
      void reviewAttachmentDelete(existing.attachmentId).catch(() => {
        emitToast({ message: '旧截图附件清理失败', level: 'warning' });
      });
    }
    if (notify) emitToast({ message: '截图已添加', level: 'success' });
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
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              :class="isDockDensity ? 'h-7 w-7 justify-center' : 'px-2 py-1.5'"
              title="收起详情"
              aria-label="收起详情"
              @click="emit('close')">
              <ChevronUp class="h-3.5 w-3.5" />
              <span v-if="!isDockDensity">收起</span>
            </button>
          </div>

          <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
            {{ item.description || '暂无批注描述' }}
          </p>
          <!-- dock 档：元信息与「定位到模型」并成一行，省掉一整行按钮 -->
          <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400"
            :class="isDockDensity ? 'items-center justify-between' : ''">
            <div class="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
              <span v-if="item.type !== 'cloud' && item.refnos.length">RefNo {{ item.refnos.join(', ') }}</span>
              <span>{{ item.commentCount }} 条讨论</span>
              <span>{{ formatDateTime(item.activityAt) }}</span>
            </div>
            <button v-if="isDockDensity"
              data-testid="annotation-detail-locate"
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-brand/40 hover:bg-brand-subtle/40"
              @click="emit('locate', item)">
              <LocateFixed class="h-3 w-3" />
              定位到模型
            </button>
          </div>
          <button v-if="!isDockDensity"
            data-testid="annotation-detail-locate"
            type="button"
            class="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-brand/40 hover:bg-brand-subtle/40"
            @click="emit('locate', item)">
            <LocateFixed class="h-3.5 w-3.5" />
            定位到模型
          </button>
        </div>

        <!-- 关联元素：四类批注统一（ADR-0049）。data-testid 沿用 annotation-cloud-* 旧名，避免既有用例与 e2e 改名。 -->
        <div data-testid="annotation-cloud-bindings"
          class="rounded-lg border border-slate-200 bg-white p-3">
          <div class="flex items-center justify-between gap-2">
            <h4 class="min-w-0 text-sm font-semibold text-slate-900">
              关联元素 {{ memberBindings.length }}
              <span v-if="showResolveSummary"
                data-testid="annotation-binding-resolve-summary"
                class="ml-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                title="有关联已失效：找不到的构件只能移除，锚点不可更换">
                可用 {{ bindingResolveSummary.usable }}/{{ bindingResolveSummary.total }}
              </span>
              <!-- dock 档：锚点不单开一块，折进标题行；失效徽标照出，原因进 title -->
              <span v-if="isDockDensity && anchorBinding"
                class="ml-1 inline-flex max-w-full items-center gap-1 text-[11px] font-normal text-slate-500"
                :data-resolve-state="resolveOf('anchor', anchorBinding.refno)?.state ?? ''"
                :title="`${anchorLabel}（不可更换）${anchorResolveReason ? ` · ${anchorResolveReason}` : ''}`">
                · {{ anchorLabel }}
                <span v-if="anchorBinding.noun" class="font-semibold text-slate-700">{{ anchorBinding.noun }}</span>
                <span class="truncate font-mono">{{ anchorBinding.refno }}</span>
                <span v-if="anchorResolveDisplay?.showBadge"
                  data-testid="annotation-anchor-state"
                  class="rounded border px-1 py-px text-[10px] font-medium"
                  :class="anchorResolveDisplay.tone">
                  {{ anchorResolveDisplay.label }}
                </span>
              </span>
            </h4>
            <div class="flex shrink-0 items-center gap-1">
              <button v-if="canEditBindings"
                data-testid="annotation-cloud-add-members"
                type="button"
                class="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-brand/40 hover:text-brand"
                title="添加元素：在三维视口中点选构件，Enter 确认后加入关联"
                aria-label="添加元素"
                @click="emit('pick-elements', item)">
                <Plus class="h-3 w-3" />
                {{ isDockDensity ? '添加' : '添加元素' }}
              </button>
              <button v-if="locatableMemberRefnos.length > 0"
                data-testid="annotation-cloud-locate-all"
                type="button"
                class="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-brand/40 hover:text-brand"
                title="定位高亮全部关联元素"
                aria-label="定位高亮全部"
                @click="emit('locate-elements', { item, refnos: locatableMemberRefnos })">
                <LocateFixed class="h-3 w-3" />
                {{ isDockDensity ? '高亮全部' : '定位高亮全部' }}
              </button>
            </div>
          </div>

          <!-- dock 档：关联元素排成芯片，点芯片本体即定位高亮；失效的不可点、只能移除 -->
          <div v-if="isDockDensity && memberBindings.length > 0"
            class="mt-2 flex flex-wrap gap-1.5"
            data-testid="annotation-cloud-member-chips">
            <div v-for="binding in memberBindings"
              :key="binding.refno"
              class="inline-flex max-w-full items-center gap-1 rounded-md border bg-white py-1 pl-2 pr-1 text-[11px]"
              :class="[
                resolveDisplayOf('member', binding.refno)?.showBadge ? 'border-amber-200' : 'border-slate-200',
                resolveDisplayOf('member', binding.refno)?.canLocate === false ? 'opacity-70' : '',
              ]"
              :data-resolve-state="resolveOf('member', binding.refno)?.state ?? ''">
              <button v-if="resolveDisplayOf('member', binding.refno)?.canLocate !== false"
                type="button"
                :data-testid="`annotation-cloud-locate-${binding.refno}`"
                class="inline-flex min-w-0 items-center gap-1 text-left hover:text-brand"
                :title="`定位高亮 ${binding.refno}`"
                @click="emit('locate-elements', { item, refnos: [binding.refno] })">
                <span v-if="binding.noun" class="font-semibold text-slate-700">{{ binding.noun }}</span>
                <span class="truncate font-mono text-slate-500">{{ binding.refno }}</span>
              </button>
              <span v-else class="inline-flex min-w-0 items-center gap-1" :title="binding.refno">
                <span v-if="binding.noun" class="font-semibold text-slate-700">{{ binding.noun }}</span>
                <span class="truncate font-mono text-slate-500">{{ binding.refno }}</span>
              </span>
              <span v-if="resolveDisplayOf('member', binding.refno)?.showBadge"
                :data-testid="`annotation-binding-state-${binding.refno}`"
                class="rounded border px-1 py-px text-[10px] font-medium"
                :class="resolveDisplayOf('member', binding.refno)?.tone"
                :title="resolveOf('member', binding.refno)?.reason">
                {{ resolveDisplayOf('member', binding.refno)?.label }}
              </span>
              <button v-if="canEditBindings"
                type="button"
                :data-testid="`annotation-cloud-remove-${binding.refno}`"
                class="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                :title="`移除关联元素 ${binding.refno}`"
                :aria-label="`移除关联元素 ${binding.refno}`"
                @click="removeMember(binding.refno)">
                <X class="h-3 w-3" />
              </button>
            </div>
          </div>

          <div v-else-if="memberBindings.length > 0" class="mt-2 space-y-1.5">
            <div v-for="binding in memberBindings"
              :key="binding.refno"
              class="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-2"
              :class="resolveDisplayOf('member', binding.refno)?.canLocate === false ? 'opacity-70' : ''"
              :data-resolve-state="resolveOf('member', binding.refno)?.state ?? ''">
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span v-if="binding.noun" class="text-[11px] font-semibold text-slate-700">{{ binding.noun }}</span>
                  <!-- 失效态徽标（ADR-0050）：resolved 不出徽标，unloaded / missing / stale 各一枚 -->
                  <span v-if="resolveDisplayOf('member', binding.refno)?.showBadge"
                    :data-testid="`annotation-binding-state-${binding.refno}`"
                    class="rounded border px-1 py-px text-[10px] font-medium"
                    :class="resolveDisplayOf('member', binding.refno)?.tone"
                    :title="resolveOf('member', binding.refno)?.reason">
                    {{ resolveDisplayOf('member', binding.refno)?.label }}
                  </span>
                </div>
                <div class="truncate font-mono text-[11px] text-slate-500" :title="binding.refno">{{ binding.refno }}</div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button v-if="resolveDisplayOf('member', binding.refno)?.canLocate !== false"
                  type="button"
                  :data-testid="`annotation-cloud-locate-${binding.refno}`"
                  class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-brand/40"
                  @click="emit('locate-elements', { item, refnos: [binding.refno] })">
                  定位高亮
                </button>
                <button v-if="canEditBindings"
                  type="button"
                  :data-testid="`annotation-cloud-remove-${binding.refno}`"
                  class="rounded-md border border-slate-200 bg-white p-1 text-slate-400 hover:border-rose-300 hover:text-rose-500"
                  :title="`移除关联元素 ${binding.refno}`"
                  :aria-label="`移除关联元素 ${binding.refno}`"
                  @click="removeMember(binding.refno)">
                  <X class="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
          <p v-else class="mt-2 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
            {{ canEditBindings ? '尚未关联元素，点「添加元素」在三维视口中点选' : '历史批注未关联元素' }}
          </p>

          <div v-if="anchorBinding && !isDockDensity"
            class="mt-3 border-t border-slate-100 pt-2"
            :data-resolve-state="resolveOf('anchor', anchorBinding.refno)?.state ?? ''">
            <div class="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <span>{{ anchorLabel }}<span v-if="canEditBindings" class="ml-1 font-normal text-slate-400">（不可更换）</span></span>
              <span v-if="anchorResolveDisplay?.showBadge"
                data-testid="annotation-anchor-state"
                class="rounded border px-1 py-px text-[10px] font-medium"
                :class="anchorResolveDisplay.tone"
                :title="anchorResolveReason">
                {{ anchorResolveDisplay.label }}
              </span>
            </div>
            <div class="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
              <span v-if="anchorBinding.noun" class="font-semibold text-slate-700">{{ anchorBinding.noun }}</span>
              <span class="truncate font-mono" :title="anchorBinding.refno">{{ anchorBinding.refno }}</span>
            </div>
            <p v-if="anchorResolveDisplay?.showBadge && anchorResolveReason"
              class="mt-1 text-[10px] text-slate-500">
              {{ anchorResolveReason }}
            </p>
          </div>
        </div>

        <!-- 证据行：normal 档上下堆叠（space-y-3 与外层同节奏）；dock 档问题截图与测量证据左右各占一半 -->
        <div data-testid="annotation-detail-evidence-row"
          :class="isDockDensity ? 'flex items-stretch gap-2' : 'space-y-3'">
          <figure v-if="screenshotUrl"
            class="overflow-hidden rounded-lg border border-slate-200 bg-white"
            :class="isDockDensity ? 'flex min-w-0 flex-1 flex-col' : ''">
            <button data-testid="annotation-detail-screenshot-preview-trigger"
              type="button"
              class="block w-full cursor-zoom-in bg-slate-50"
              :class="isDockDensity ? 'min-h-0 flex-1' : ''"
              title="预览问题截图"
              @click="openScreenshotPreview">
              <img data-testid="annotation-detail-screenshot"
                :src="screenshotUrl"
                :alt="`${item.title} 批注截图`"
                class="w-full"
                :class="isDockDensity ? 'h-24 object-cover' : 'max-h-64 object-contain'" />
            </button>
            <figcaption class="flex items-center justify-between gap-2 border-t border-slate-100 text-xs text-slate-500"
              :class="isDockDensity ? 'px-2 py-1.5' : 'px-3 py-2'">
              问题截图
              <span class="flex items-center gap-1.5">
                <!-- dock 档两颗按钮只留图标，文字进 title -->
                <button data-testid="annotation-detail-screenshot-preview-button"
                  type="button"
                  class="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white py-1 text-[11px] font-medium text-slate-600 hover:border-brand/40 hover:text-brand"
                  :class="isDockDensity ? 'px-1.5' : 'px-2'"
                  title="预览问题截图"
                  aria-label="预览"
                  @click="openScreenshotPreview">
                  <Eye class="h-3 w-3" />
                  <span v-if="!isDockDensity">预览</span>
                </button>
                <button v-if="canCaptureScreenshot"
                  data-testid="annotation-detail-screenshot-retake"
                  type="button"
                  class="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white py-1 text-[11px] font-medium text-slate-600 hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                  :class="isDockDensity ? 'px-1.5' : 'px-2'"
                  :disabled="capturingScreenshot"
                  title="重新拍摄当前视角并替换截图"
                  aria-label="重拍"
                  @click="void captureItemScreenshot()">
                  <Camera class="h-3 w-3" :class="capturingScreenshot ? 'animate-pulse' : ''" />
                  <span v-if="!isDockDensity">{{ capturingScreenshot ? '截图中…' : '重拍' }}</span>
                </button>
              </span>
            </figcaption>
          </figure>
          <button v-else-if="canCaptureScreenshot"
            data-testid="annotation-detail-screenshot-capture"
            type="button"
            class="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-500 hover:border-brand/40 hover:bg-brand-subtle/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
            :class="isDockDensity ? 'min-w-0 flex-1 flex-col px-2 py-3 text-center' : 'w-full px-3 py-3'"
            :disabled="capturingScreenshot"
            title="拍摄当前视角 · 作为批注截图"
            @click="void captureItemScreenshot()">
            <Camera class="h-3.5 w-3.5" />
            {{ capturingScreenshot ? '正在截图…' : (isDockDensity ? '拍摄截图' : '拍摄当前视角 · 作为批注截图') }}
          </button>

          <div class="rounded-lg border border-slate-200 bg-white"
            :class="isDockDensity ? 'min-w-0 flex-1 p-2.5' : 'p-3'">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 class="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Ruler class="h-4 w-4 text-brand" />
                  测量证据<span v-if="isDockDensity && linkedMeasurements.length > 0" class="text-slate-400">{{ linkedMeasurements.length }}</span>
                </h4>
                <p v-if="!isDockDensity" class="mt-1 text-xs text-slate-500">
                  仅作为当前批注的辅助证据。
                </p>
              </div>
              <!-- dock 档：四颗「新增 ×」缩成「+ 距离」这样的短标签，完整名进 title / aria-label -->
              <div v-if="showMeasurementActions" class="flex flex-wrap gap-1.5">
                <button v-for="action in measurementLaunchActions"
                  :key="action.kind"
                  :data-testid="`annotation-detail-add-${action.testId}`"
                  type="button"
                  class="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 font-medium text-slate-600 hover:bg-slate-50"
                  :class="isDockDensity ? 'px-1.5 py-1 text-[11px]' : 'px-2 py-1.5 text-xs'"
                  :title="action.label"
                  :aria-label="action.label"
                  @click="emit('start-measurement', action.kind, item)">
                  <Plus v-if="isDockDensity" class="h-3 w-3" />
                  {{ isDockDensity ? action.shortLabel : action.label }}
                </button>
              </div>
            </div>

            <div v-if="linkedMeasurements.length === 0"
              class="rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500"
              :class="isDockDensity ? 'mt-2 px-2 py-3' : 'mt-3 px-3 py-4'">
              当前批注还没有关联的测量证据。
            </div>
            <div v-else :class="isDockDensity ? 'mt-2 space-y-1.5' : 'mt-3 space-y-2'">
              <div v-for="measurement in linkedMeasurements"
                :key="`${measurement.engine}:${measurement.id}`"
                class="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50"
                :class="isDockDensity ? 'gap-2 px-2 py-1.5' : 'gap-3 px-3 py-2'">
                <div class="min-w-0">
                  <div class="truncate text-xs font-medium text-slate-900" :title="measurement.summary">
                    {{ measurement.summary }}
                  </div>
                  <div class="mt-0.5 truncate text-[11px] text-slate-400">
                    {{ formatDateTime(measurement.createdAt) }}
                  </div>
                </div>
                <button :data-testid="`annotation-detail-locate-measurement-${measurement.id}`"
                  type="button"
                  class="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white py-1 text-[11px] font-medium text-slate-600 hover:border-brand/40"
                  :class="isDockDensity ? 'px-1.5' : 'px-2'"
                  title="定位到该测量"
                  aria-label="定位"
                  @click="emit('locate-measurement', measurement)">
                  <LocateFixed class="h-3 w-3" />
                  <span v-if="!isDockDensity">定位</span>
                </button>
              </div>
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
