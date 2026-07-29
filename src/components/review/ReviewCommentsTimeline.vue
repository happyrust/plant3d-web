<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import {
  BadgeCheck,
  CircleSlash,
  Reply,
  Send,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-vue-next';

import type { AnnotationType } from '@/composables/useToolStore';

import {
  annotationReviewStateApply,
  annotationReviewStatesQuery,
  normalizeAnnotationReviewStateView,
  reviewCommentCreate,
  reviewCommentDelete,
  reviewCommentUpdate,
} from '@/api/reviewApi';
import { useCommentThread } from '@/composables/useCommentThread';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { emitToast } from '@/ribbon/toastBus';
import {
  type AnnotationComment,
  type AnnotationReviewAction,
  type AnnotationReviewEvent,
  type AnnotationReviewState,
  type AnnotationScreenshot,
  getAnnotationReviewActionLabel,
  getAnnotationReviewDisplay,
  getRoleDisplayName,
  getRoleTheme,
  UserRole,
} from '@/types/auth';

const props = withDefaults(defineProps<{
  annotationType: AnnotationType | null;
  annotationId: string | null;
  annotationLabel?: string;
  composerPlaceholder?: string;
  composerSubmitLabel?: string;
  designerOnly?: boolean;
  screenshot?: AnnotationScreenshot;
  /**
   * 当前批注归属的正式单据 formId。
   * 为空表示当前是无单据上下文（草稿或外部入口未匹配单据）。
   */
  contextFormId?: string | null;
  /**
   * 当前批注对应的内部任务 taskId。
   * 没有匹配到正式任务时应传 null，组件会据此关闭处理动作提交。
   */
  contextTaskId?: string | null;
  /**
   * 是否允许在该面板提交批注处理动作（已修改 / 不需解决 / 同意 / 驳回）。
   * 默认为 true；调用方可在仅查看场景显式传 false。
   */
  allowReviewActions?: boolean;
  density?: 'normal' | 'dock';
}>(), {
  annotationLabel: undefined,
  composerPlaceholder: '输入意见...',
  composerSubmitLabel: '发表',
  designerOnly: false,
  screenshot: undefined,
  contextFormId: undefined,
  contextTaskId: undefined,
  allowReviewActions: true,
  density: 'normal',
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'review-action-completed', payload: {
    action: AnnotationReviewAction;
    annotationType: AnnotationType;
    annotationId: string;
    state: AnnotationReviewState;
  }): void;
}>();

const store = useToolStore();
const reviewStore = useReviewStore();
const userStore = useUserStore();
const newCommentContent = ref('');
const replyToCommentId = ref<string | null>(null);
const editingCommentId = ref<string | null>(null);
const editingCommentContent = ref('');
const actionNote = ref('');
const selectedReviewAction = ref<AnnotationReviewAction | null>(null);
const screenshotPreviewUrl = ref<string | null>(null);
const isDockDensity = computed(() => props.density === 'dock');

function normalizeContextString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * 集中计算评论 / 处理动作的上下文：
 * - 调用方显式传入的 `contextFormId / contextTaskId` 优先；
 * - 都未提供时（调用方未明确）退回 `reviewStore.currentTask` 兜底，保持向后兼容；
 * - 正式 `formId` 存在但 `taskId` 缺失时仍要求显式表态，避免假成功。
 *
 * 该 computed 是读取后端、加载 store、写入与本地降级的唯一上下文来源。
 */
const commentContext = computed(() => {
  const explicitFormId = normalizeContextString(props.contextFormId);
  const explicitTaskId = normalizeContextString(props.contextTaskId);
  if (props.contextFormId !== undefined || props.contextTaskId !== undefined) {
    return {
      formId: explicitFormId,
      taskId: explicitTaskId,
    };
  }
  const task = reviewStore.currentTask.value;
  return {
    formId: normalizeContextString(task?.formId ?? null),
    taskId: normalizeContextString(task?.id ?? null),
  };
});

type TimelineItem =
  | {
    kind: 'comment';
    id: string;
    createdAt: number;
    comment: AnnotationComment;
  }
  | {
    kind: 'action';
    id: string;
    createdAt: number;
    event: AnnotationReviewEvent;
  };

const {
  comments: allComments,
  loading: commentLoading,
  error: commentError,
  refresh: refreshComments,
} = useCommentThread(() => ({
  annotationType: props.annotationType,
  annotationId: props.annotationId,
  formId: commentContext.value.formId,
  taskId: commentContext.value.taskId,
}));

watch(
  () => [props.annotationId, props.annotationType, commentContext.value.formId, commentContext.value.taskId],
  () => {
    actionNote.value = '';
    selectedReviewAction.value = null;
    replyToCommentId.value = null;
    editingCommentId.value = null;
    editingCommentContent.value = '';
    void refreshComments();
  },
  { immediate: true },
);

const displayLabel = computed(() => {
  return props.annotationLabel || `批注 #${props.annotationId?.slice(-6) || '---'} 讨论`;
});

const replyToComment = computed<AnnotationComment | null>(() => {
  if (!replyToCommentId.value) return null;
  return allComments.value.find((c) => c.id === replyToCommentId.value) || null;
});

const currentUser = computed(() => userStore.currentUser.value);

const reviewState = computed(() => {
  if (!props.annotationType || !props.annotationId) return null;
  return store.getAnnotationReviewState(props.annotationType, props.annotationId);
});

const reviewDisplay = computed(() => (
  reviewState.value ? getAnnotationReviewDisplay(reviewState.value) : null
));

const showReviewActions = computed(() => {
  if (props.allowReviewActions === false) return false;
  const role = currentUser.value?.role;
  if (!role) return false;
  if (props.designerOnly) {
    return canDesignHandle.value;
  }
  return [
    UserRole.DESIGNER,
    UserRole.PROOFREADER,
    UserRole.REVIEWER,
    UserRole.MANAGER,
    UserRole.ADMIN,
  ].includes(role);
});

/**
 * 处理动作提交门禁。
 *
 * 设计原则：
 * - 任何正式流程动作都必须同时具备 `formId + taskId`，否则直接屏蔽提交，
 *   避免无任务上下文写本地状态再被当作流转依据；
 * - 没有 `formId` 的纯草稿（例如外部入口未匹配到单据）允许本地处理，
 *   但本组件本身仍由调用方通过 `allowReviewActions` 决定是否暴露按钮。
 */
const hasFormalReviewContext = computed(() => (
  !!commentContext.value.formId && !!commentContext.value.taskId
));
const isLocalDraftReviewContext = computed(() => !commentContext.value.formId);
const canSubmitReviewAction = computed(() => (
  props.allowReviewActions !== false
  && (hasFormalReviewContext.value || isLocalDraftReviewContext.value)
));
const reviewContextWarning = computed(() => {
  if (props.allowReviewActions === false) return null;
  if (!commentContext.value.formId) return null;
  if (commentContext.value.taskId) return null;
  return '未匹配到内部任务，不能保存处理状态';
});

const canDesignHandle = computed(() => {
  const role = currentUser.value?.role;
  return role === UserRole.DESIGNER || role === UserRole.ADMIN;
});

const canReviewDecide = computed(() => {
  if (props.designerOnly) return false;
  const role = currentUser.value?.role;
  return role === UserRole.PROOFREADER
    || role === UserRole.REVIEWER
    || role === UserRole.MANAGER
    || role === UserRole.ADMIN;
});

const canDecisionAct = computed(() => {
  return canReviewDecide.value && reviewState.value?.resolutionStatus !== 'open';
});

const reviewActionPlaceholder = computed(() => {
  if (canDesignHandle.value) return '处理备注（可选，例如修改说明）';
  if (canReviewDecide.value) return '决定备注（可选，例如同意理由或驳回意见）';
  return '输入意见...';
});

const reviewActionHint = computed(() => {
  if (!currentUser.value) return '登录后可参与该批注的处理和讨论。';
  if (canDesignHandle.value) return '设计人员可将批注标记为已修改或不需解决，动作会记录在时间线中。';
  if (canReviewDecide.value && !canDecisionAct.value) {
    return '请等待设计人员先标记为已修改或不需解决，然后再做同意或驳回。';
  }
  if (canReviewDecide.value) return '校对/审核人员可对设计处理结果执行同意或驳回，并继续补充意见。';
  return `当前角色为${getRoleDisplayName(currentUser.value.role)}，仅可查看处理状态与讨论。`;
});

const reviewActionSubmitLabel = computed(() => (
  canDesignHandle.value ? '提交处理结果' : '提交确认结果'
));

function canSelectReviewAction(action: AnnotationReviewAction): boolean {
  if (action === 'fixed' || action === 'wont_fix') return canDesignHandle.value;
  if (action === 'agree' || action === 'reject') return canDecisionAct.value;
  return false;
}

function selectReviewAction(action: AnnotationReviewAction) {
  if (!canSelectReviewAction(action)) return;
  selectedReviewAction.value = action;
}

function actionButtonClass(action: AnnotationReviewAction): string {
  const isSelected = selectedReviewAction.value === action;
  const disabled = !canSelectReviewAction(action);
  const selectedClass = isSelected ? 'ring-2 ring-offset-1 ring-slate-400' : '';
  const disabledClass = disabled ? 'cursor-not-allowed opacity-50' : '';
  return [selectedClass, disabledClass].filter(Boolean).join(' ');
}

const timelineItems = computed<TimelineItem[]>(() => {
  const commentItems = allComments.value.map<TimelineItem>((comment) => ({
    kind: 'comment',
    id: comment.id,
    createdAt: comment.createdAt,
    comment,
  }));
  const actionItems = (reviewState.value?.history ?? []).map<TimelineItem>((event) => ({
    kind: 'action',
    id: event.id,
    createdAt: event.createdAt,
    event,
  }));

  return [...commentItems, ...actionItems].sort((a, b) => a.createdAt - b.createdAt);
});

function getReplyToComment(replyToId: string | undefined): AnnotationComment | null {
  if (!replyToId) return null;
  return allComments.value.find((c) => c.id === replyToId) || null;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getActionTone(action: AnnotationReviewAction): string {
  switch (action) {
    case 'fixed':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'wont_fix':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'agree':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'reject':
      return 'border-rose-200 bg-rose-50 text-rose-700';
  }
}

function setReplyTo(comment: AnnotationComment) {
  replyToCommentId.value = comment.id;
  editingCommentId.value = null;
  editingCommentContent.value = '';
}

function cancelReply() {
  replyToCommentId.value = null;
}

function startEdit(comment: AnnotationComment) {
  editingCommentId.value = comment.id;
  editingCommentContent.value = comment.content;
  replyToCommentId.value = null;
}

async function saveEdit() {
  if (!editingCommentId.value || !editingCommentContent.value.trim()) return;
  if (!props.annotationType || !props.annotationId) return;

  const ctx = commentContext.value;
  const trimmed = editingCommentContent.value.trim();
  try {
    const resp = await reviewCommentUpdate(editingCommentId.value, trimmed, {
      formId: ctx.formId ?? undefined,
      taskId: ctx.taskId ?? undefined,
    });
    if (resp && resp.success === false) {
      emitToast({ message: resp.error_message || '评论更新失败', level: 'error' });
      return;
    }
  } catch (err) {
    if (ctx.formId) {
      emitToast({
        message: err instanceof Error ? err.message : '评论更新失败',
        level: 'error',
      });
      return;
    }
  }

  store.updateAnnotationComment(
    props.annotationType,
    props.annotationId,
    editingCommentId.value,
    { content: trimmed },
    ctx.formId,
    ctx.taskId,
  );
  editingCommentId.value = null;
  editingCommentContent.value = '';
}

function cancelEdit() {
  editingCommentId.value = null;
  editingCommentContent.value = '';
}

async function deleteComment(commentId: string) {
  if (!props.annotationType || !props.annotationId) return;
  const ctx = commentContext.value;
  try {
    const resp = await reviewCommentDelete(commentId, {
      formId: ctx.formId ?? undefined,
      taskId: ctx.taskId ?? undefined,
    });
    if (!resp.success) {
      emitToast({ message: resp.error_message || '删除评论失败', level: 'error' });
      return;
    }
    store.removeAnnotationComment(props.annotationType, props.annotationId, commentId, ctx.formId, ctx.taskId);
  } catch (err) {
    if (ctx.formId) {
      emitToast({
        message: err instanceof Error ? err.message : '删除评论失败',
        level: 'error',
      });
      return;
    }
    store.removeAnnotationComment(props.annotationType, props.annotationId, commentId, ctx.formId, ctx.taskId);
  }
}

async function submitComment() {
  const content = newCommentContent.value.trim();
  if (!content || !props.annotationType || !props.annotationId) return;

  const user = userStore.currentUser.value;
  if (!user) return;

  const replyToId = replyToCommentId.value || undefined;
  const ctx = commentContext.value;

  try {
    const resp = await reviewCommentCreate({
      annotationId: props.annotationId,
      annotationType: props.annotationType,
      authorId: user.id,
      authorName: user.name,
      authorRole: user.role,
      content,
      replyToId,
      formId: ctx.formId ?? undefined,
      taskId: ctx.taskId ?? undefined,
    });
    if (resp.success && ctx.formId) {
      await refreshComments();
    } else if (resp.success && resp.comment) {
      store.addCommentToAnnotation(props.annotationType, props.annotationId, resp.comment, ctx.formId, ctx.taskId);
    } else if (resp.success && !ctx.formId) {
      store.addCommentToAnnotation(
        props.annotationType,
        props.annotationId,
        {
          authorId: user.id,
          authorName: user.name,
          authorRole: user.role,
          content,
          replyToId,
        },
        ctx.formId,
        ctx.taskId,
      );
    } else {
      emitToast({ message: resp.error_message || '评论创建失败', level: 'error' });
      return;
    }
  } catch (err) {
    if (ctx.formId) {
      emitToast({
        message: err instanceof Error ? err.message : '评论创建失败',
        level: 'error',
      });
      return;
    }
    store.addCommentToAnnotation(
      props.annotationType,
      props.annotationId,
      {
        authorId: user.id,
        authorName: user.name,
        authorRole: user.role,
        content,
        replyToId,
      },
      ctx.formId,
      ctx.taskId,
    );
  }

  newCommentContent.value = '';
  replyToCommentId.value = null;
}

const actionSubmitting = ref(false);

async function submitSelectedReviewAction() {
  if (!selectedReviewAction.value || actionSubmitting.value) return;
  await applyReviewAction(selectedReviewAction.value);
}

async function resolvePersistedReviewState(options: {
  formId: string;
  taskId: string;
  annotationId: string;
  annotationType: AnnotationType;
  actionResponseState?: import('@/api/reviewApi').AnnotationReviewStateView;
}) {
  if (options.actionResponseState) {
    return normalizeAnnotationReviewStateView(options.actionResponseState);
  }

  const queryResp = await annotationReviewStatesQuery({
    formId: options.formId,
    taskId: options.taskId,
  });
  const matched = queryResp.states?.find((state) => (
    state.annotationId === options.annotationId && state.annotationType === options.annotationType
  ));
  return matched ? normalizeAnnotationReviewStateView(matched) : null;
}

async function applyReviewAction(action: AnnotationReviewAction) {
  if (!props.annotationType || !props.annotationId) return;
  const user = currentUser.value;
  if (!user) return;

  if (props.allowReviewActions === false) return;

  if ((action === 'fixed' || action === 'wont_fix') && !canDesignHandle.value) return;
  if ((action === 'agree' || action === 'reject') && !canDecisionAct.value) return;

  const note = actionNote.value.trim();
  if (action === 'wont_fix' && !note) {
    emitToast({ message: '请填写不需解决原因', level: 'warning' });
    return;
  }
  if (action === 'reject' && !note) {
    emitToast({ message: '请填写驳回原因', level: 'warning' });
    return;
  }

  const ctx = commentContext.value;
  const formId = ctx.formId;
  const taskId = ctx.taskId;

  // 正式上下文必须同时具备 formId + taskId 才允许后端落库；
  // 仅 formId 没有 taskId（例如外部入口未匹配到内部任务）属于"无内部任务"状态，
  // 不再走本地 applyAnnotationReviewAction 假成功，避免本地状态被当作流转依据。
  if (formId && !taskId) {
    emitToast({ message: '未匹配到内部任务，不能保存处理状态', level: 'warning' });
    return;
  }

  let persistedState: ReturnType<typeof normalizeAnnotationReviewStateView> | null = null;

  if (formId && taskId) {
    actionSubmitting.value = true;
    try {
      const resp = await annotationReviewStateApply({
        formId,
        taskId,
        annotationId: props.annotationId,
        annotationType: props.annotationType as 'text' | 'cloud' | 'rect' | 'obb',
        action,
        note: note || undefined,
      });
      if (!resp.success) {
        emitToast({ message: resp.errorMessage || '更新批注处理状态失败', level: 'error' });
        return;
      }
      persistedState = await resolvePersistedReviewState({
        formId,
        taskId,
        annotationId: props.annotationId,
        annotationType: props.annotationType,
        actionResponseState: resp.state,
      });
      if (!persistedState) {
        emitToast({ message: '处理状态已提交，请刷新后查看最新状态', level: 'warning' });
        return;
      }
    } catch (err) {
      emitToast({
        message: err instanceof Error ? err.message : '更新批注处理状态失败',
        level: 'error',
      });
      return;
    } finally {
      actionSubmitting.value = false;
    }
  }

  const nextState = persistedState
    ? (store.setAnnotationReviewState(props.annotationType, props.annotationId, persistedState) ? persistedState : null)
    : store.applyAnnotationReviewAction(props.annotationType, props.annotationId, {
      action,
      actor: user,
      note,
    });

  if (!nextState) {
    emitToast({ message: '更新批注处理状态失败', level: 'error' });
    return;
  }

  actionNote.value = '';
  selectedReviewAction.value = null;
  const successMessageMap: Record<AnnotationReviewAction, string> = {
    fixed: '批注已标记为已修改',
    wont_fix: '批注已标记为不需解决',
    agree: '已同意该批注处理结果',
    reject: '已驳回该批注处理结果',
  };
  emitToast({
    message: successMessageMap[action],
    level: 'success',
  });
  emit('review-action-completed', {
    action,
    annotationType: props.annotationType,
    annotationId: props.annotationId,
    state: nextState,
  });
}

function canEditComment(comment: AnnotationComment): boolean {
  const user = userStore.currentUser.value;
  if (!user) return false;
  return comment.authorId === user.id || user.role === UserRole.ADMIN;
}
</script>

<template>
  <div class="flex flex-col overflow-hidden border border-[#E5E7EB] bg-white"
    :class="isDockDensity ? 'rounded-lg shadow-sm' : 'rounded-xl shadow-md'"
    data-testid="review-comments-timeline"
    :data-density="props.density">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-[#E5E7EB]"
      :class="isDockDensity ? 'px-2.5 py-1.5' : 'px-4 py-3'">
      <div class="flex min-w-0 items-center gap-2">
        <svg class="h-4 w-4 text-brand" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12zM7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z" />
        </svg>
        <span class="truncate text-sm font-semibold text-[#111827]">{{ displayLabel }}</span>
      </div>
      <div class="flex items-center gap-1">
        <button type="button"
          class="rounded p-1 text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#6B7280]"
          @click="emit('close')">
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!annotationType || !annotationId"
      class="text-center text-sm text-[#9CA3AF]"
      :class="isDockDensity ? 'px-3 py-4' : 'px-4 py-8'">
      请先选择一个批注以查看讨论
    </div>

    <!-- Messages body -->
    <div v-else class="flex-1 overflow-y-auto">
      <div class="border-b border-[#E5E7EB] bg-[#FCFCFD]"
        :class="isDockDensity ? 'px-2.5 py-1.5' : 'px-4 py-3'">
        <div class="flex flex-wrap items-center gap-2">
          <span v-if="reviewDisplay"
            class="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold"
            :class="reviewDisplay.color">
            {{ reviewDisplay.label }}
          </span>
          <span class="text-[12px] text-[#6B7280]">
            {{ reviewDisplay?.detail || '当前批注正在等待处理。' }}
          </span>
        </div>
        <div v-if="reviewState?.updatedByName"
          class="mt-1 text-[11px] text-[#9CA3AF]"
          :class="isDockDensity ? 'truncate' : ''">
          最近处理：{{ reviewState.updatedByName }}
          <span v-if="reviewState.updatedByRole">（{{ getRoleDisplayName(reviewState.updatedByRole) }}）</span>
          · {{ formatDateTime(reviewState.updatedAt) }}
        </div>
        <div v-if="reviewState?.note"
          class="rounded-md border border-[#E5E7EB] bg-white text-[12px] text-[#4B5563]"
          :class="isDockDensity ? 'mt-1 truncate px-2 py-1' : 'mt-2 px-3 py-2 leading-relaxed'">
          {{ reviewState.note }}
        </div>

        <button v-if="screenshot?.url"
          type="button"
          class="flex max-w-sm items-center gap-3 rounded-xl border border-slate-200 bg-white p-2 text-left hover:bg-slate-50"
          :class="isDockDensity ? 'mt-1' : 'mt-3'"
          @click="screenshotPreviewUrl = screenshot.url">
          <img :src="screenshot.url" alt="批注截图" class="h-14 w-20 rounded-lg object-cover" />
          <span class="min-w-0">
            <span class="block text-[12px] font-semibold text-slate-700">批注截图</span>
            <span class="block truncate text-[11px] text-slate-400">{{ screenshot.name || '点击查看大图' }}</span>
          </span>
        </button>

        <div v-if="showReviewActions" :class="isDockDensity ? 'mt-1.5' : 'mt-3'">
          <div class="rounded-lg border border-[#E5E7EB] bg-white"
            :class="isDockDensity ? 'p-1.5' : 'p-3'">
            <div class="flex flex-wrap items-center gap-1.5">
              <div class="mr-1 text-[12px] font-semibold text-[#111827]">处理结果</div>
              <template v-if="canDesignHandle">
                <button type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 text-[12px] font-semibold text-blue-700 hover:bg-blue-100"
                  :class="[isDockDensity ? 'px-2 py-0.5' : 'px-3 py-1.5', actionButtonClass('fixed')]"
                  :aria-pressed="selectedReviewAction === 'fixed'"
                  @click="selectReviewAction('fixed')">
                  <BadgeCheck class="h-3.5 w-3.5" />
                  已修改
                </button>
                <button type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 text-[12px] font-semibold text-amber-700 hover:bg-amber-100"
                  :class="[isDockDensity ? 'px-2 py-0.5' : 'px-3 py-1.5', actionButtonClass('wont_fix')]"
                  :aria-pressed="selectedReviewAction === 'wont_fix'"
                  @click="selectReviewAction('wont_fix')">
                  <CircleSlash class="h-3.5 w-3.5" />
                  不需解决
                </button>
              </template>
              <template v-if="canReviewDecide">
                <button type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  :class="[isDockDensity ? 'px-2 py-0.5' : 'px-3 py-1.5', actionButtonClass('agree')]"
                  :disabled="!canDecisionAct"
                  :aria-pressed="selectedReviewAction === 'agree'"
                  @click="selectReviewAction('agree')">
                  <ThumbsUp class="h-3.5 w-3.5" />
                  同意
                </button>
                <button type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 text-[12px] font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  :class="[isDockDensity ? 'px-2 py-0.5' : 'px-3 py-1.5', actionButtonClass('reject')]"
                  :disabled="!canDecisionAct"
                  :aria-pressed="selectedReviewAction === 'reject'"
                  @click="selectReviewAction('reject')">
                  <ThumbsDown class="h-3.5 w-3.5" />
                  驳回
                </button>
              </template>
              <button type="button"
                class="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md text-[12px] font-semibold text-primary-foreground"
                :class="[isDockDensity ? 'px-2 py-1' : 'px-3 py-1.5', selectedReviewAction && canSubmitReviewAction && !actionSubmitting
                  ? 'bg-primary hover:bg-primary/90'
                  : 'cursor-not-allowed bg-[#D1D5DB]']"
                :disabled="!selectedReviewAction || !canSubmitReviewAction || actionSubmitting"
                @click="submitSelectedReviewAction">
                {{ actionSubmitting ? '提交中...' : reviewActionSubmitLabel }}
              </button>
            </div>
            <div v-if="isDockDensity && annotationType && annotationId"
              class="mt-1.5 rounded-md border border-[#E5E7EB] bg-[#FAFAFA] p-1.5">
              <div v-if="replyToComment"
                class="mb-1.5 flex items-center gap-2 rounded bg-[#F3F4F6] px-2 py-1 text-[11px]">
                <Reply class="h-3 w-3 shrink-0 text-[#9CA3AF]" />
                <span class="truncate text-[#6B7280]">
                  回复 {{ replyToComment.authorName }}:
                  "{{ replyToComment.content.slice(0, 30) }}{{ replyToComment.content.length > 30 ? '...' : '' }}"
                </span>
                <button type="button" class="ml-auto shrink-0 text-[#9CA3AF] hover:text-[#6B7280]" @click="cancelReply">
                  <X class="h-3 w-3" />
                </button>
              </div>
              <div class="flex items-end gap-1.5">
                <textarea v-model="newCommentContent"
                  class="min-h-[2rem] flex-1 resize-none rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[12px] text-[#374151] placeholder:text-[#9CA3AF] focus:outline-none"
                  :placeholder="props.composerPlaceholder"
                  @keyup.enter.ctrl="submitComment" />
                <button type="button"
                  class="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-primary-foreground"
                  :class="newCommentContent.trim()
                    ? 'bg-primary hover:bg-primary/90'
                    : 'cursor-not-allowed bg-[#D1D5DB]'"
                  :disabled="!newCommentContent.trim()"
                  @click="submitComment">
                  {{ props.composerSubmitLabel }}
                  <Send class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div class="rounded-md border border-[#D1D5DB] bg-white"
              :class="isDockDensity ? 'mt-1.5 px-2 py-1' : 'mt-2 px-3 py-2'">
              <textarea v-model="actionNote"
                class="w-full resize-none text-[12px] text-[#374151] placeholder:text-[#9CA3AF] focus:outline-none"
                :class="isDockDensity ? 'min-h-[1.75rem]' : 'min-h-[2.75rem]'"
                :placeholder="reviewActionPlaceholder" />
            </div>
            <div v-if="reviewContextWarning"
              class="mt-2 rounded-md border border-warning bg-warning-subtle px-3 py-2 text-[11px] text-warning"
              data-testid="review-actions-context-warning">
              {{ reviewContextWarning }}
            </div>
            <div v-if="!isDockDensity" class="mt-2 flex items-center justify-between gap-3">
              <div class="text-[11px] text-[#9CA3AF]">
                {{ reviewActionHint }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="commentError" class="py-2 text-xs text-danger"
        :class="isDockDensity ? 'px-3' : 'px-4'">
        {{ commentError }}
      </div>

      <div v-if="commentLoading && timelineItems.length === 0" class="text-center text-sm text-[#9CA3AF]"
        :class="isDockDensity ? 'px-3 py-4' : 'px-4 py-8'">
        正在加载讨论...
      </div>

      <div v-else-if="timelineItems.length === 0" class="text-center text-sm text-[#9CA3AF]"
        :class="isDockDensity ? 'px-3 py-3' : 'px-4 py-8'">
        {{ isDockDensity ? '暂无评论，输入后发送' : '暂无处理记录或评论，发表第一条意见' }}
      </div>

      <div v-else class="flex flex-col gap-0.5" :class="isDockDensity ? 'py-1' : 'py-2'">
        <div v-for="(item, idx) in timelineItems"
          :key="item.id"
          class="flex gap-2.5"
          :class="[isDockDensity ? 'px-3 py-1.5' : 'px-4 py-2', idx % 2 === 1 ? 'bg-[#F9FAFB]' : '']">
          <template v-if="item.kind === 'comment'">
            <!-- Role color bar (3px) -->
            <div class="w-[3px] shrink-0 self-stretch rounded-sm"
              :style="{ backgroundColor: getRoleTheme(item.comment.authorRole).barColor }" />

            <!-- Message content -->
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <!-- Author line -->
              <div class="flex items-center gap-1.5">
                <span class="inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold"
                  :style="{
                    backgroundColor: getRoleTheme(item.comment.authorRole).bgColor,
                    color: getRoleTheme(item.comment.authorRole).textColor,
                  }">
                  {{ getRoleTheme(item.comment.authorRole).label }}
                </span>
                <span class="text-xs font-semibold text-[#111827]">{{ item.comment.authorName }}</span>
                <span class="text-[11px] text-[#9CA3AF]">{{ formatTime(item.comment.createdAt) }}</span>
                <span v-if="item.comment.updatedAt" class="text-[11px] text-[#9CA3AF]">(已编辑)</span>
              </div>

              <!-- Reply reference -->
              <div v-if="item.comment.replyToId && getReplyToComment(item.comment.replyToId)"
                class="flex items-center gap-1 rounded border-l-2 border-[#E5E7EB] bg-[#F3F4F6] px-2 py-1 text-[11px]">
                <Reply class="h-3 w-3 shrink-0 text-[#9CA3AF]" />
                <span class="text-[#9CA3AF]">回复 {{ getReplyToComment(item.comment.replyToId)?.authorName }}:</span>
                <span class="truncate text-[#6B7280]">
                  "{{ getReplyToComment(item.comment.replyToId)?.content.slice(0, 30) }}{{ (getReplyToComment(item.comment.replyToId)?.content.length || 0) > 30 ? '...' : '' }}"
                </span>
              </div>

              <!-- Content (editing) -->
              <div v-if="editingCommentId === item.comment.id" class="flex flex-col gap-1.5">
                <textarea v-model="editingCommentContent"
                  class="min-h-[3rem] w-full rounded border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px] text-[#374151] focus:border-brand focus:outline-none"
                  @keyup.enter.ctrl="saveEdit" />
                <div class="flex gap-1">
                  <button type="button"
                    class="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    @click="saveEdit">
                    保存
                  </button>
                  <button type="button"
                    class="rounded border border-[#D1D5DB] px-2.5 py-1 text-xs hover:bg-[#F9FAFB]"
                    @click="cancelEdit">
                    取消
                  </button>
                </div>
              </div>

              <!-- Content (display) -->
              <p v-else class="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#4B5563]">
                {{ item.comment.content }}
              </p>

              <!-- Actions -->
              <div class="flex items-center gap-3">
                <button type="button"
                  class="text-[11px] text-[#9CA3AF] hover:text-brand"
                  @click="setReplyTo(item.comment)">
                  回复
                </button>
                <template v-if="canEditComment(item.comment)">
                  <button type="button"
                    class="text-[11px] text-[#9CA3AF] hover:text-brand"
                    @click="startEdit(item.comment)">
                    编辑
                  </button>
                  <button type="button"
                    class="text-[11px] text-[#9CA3AF] hover:text-danger"
                    @click="deleteComment(item.comment.id)">
                    删除
                  </button>
                </template>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="w-[3px] shrink-0 self-stretch rounded-sm"
              :style="{ backgroundColor: getRoleTheme(item.event.operatorRole).barColor }" />
            <div class="min-w-0 flex-1 rounded-lg border px-3 py-2"
              :class="getActionTone(item.event.action)">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold"
                  :style="{
                    backgroundColor: getRoleTheme(item.event.operatorRole).bgColor,
                    color: getRoleTheme(item.event.operatorRole).textColor,
                  }">
                  {{ getRoleTheme(item.event.operatorRole).label }}
                </span>
                <span class="text-xs font-semibold text-[#111827]">{{ item.event.operatorName }}</span>
                <span class="text-[11px] text-[#6B7280]">{{ formatTime(item.event.createdAt) }}</span>
              </div>
              <div class="mt-1 text-[12px] font-semibold">
                {{ getAnnotationReviewActionLabel(item.event.action) }}
              </div>
              <p v-if="item.event.note"
                class="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[#4B5563]">
                {{ item.event.note }}
              </p>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Input area -->
    <div v-if="annotationType && annotationId && !isDockDensity"
      class="border-t border-[#E5E7EB] bg-[#FAFAFA]"
      :class="isDockDensity ? 'px-3 py-2' : 'px-4 py-3'">
      <!-- Reply indicator -->
      <div v-if="replyToComment"
        class="mb-2 flex items-center gap-2 rounded bg-[#F3F4F6] px-2.5 py-1.5 text-xs">
        <Reply class="h-3 w-3 shrink-0 text-[#9CA3AF]" />
        <span class="truncate text-[#6B7280]">
          回复 {{ replyToComment.authorName }}:
          "{{ replyToComment.content.slice(0, 30) }}{{ replyToComment.content.length > 30 ? '...' : '' }}"
        </span>
        <button type="button" class="ml-auto shrink-0 text-[#9CA3AF] hover:text-[#6B7280]" @click="cancelReply">
          <X class="h-3 w-3" />
        </button>
      </div>

      <div class="rounded-md border border-[#D1D5DB] bg-white"
        :class="isDockDensity ? 'px-2.5 py-1.5' : 'px-3 py-2'">
        <textarea v-model="newCommentContent"
          class="w-full resize-none text-[13px] text-[#374151] placeholder:text-[#9CA3AF] focus:outline-none"
          :class="isDockDensity ? 'min-h-[2.5rem]' : 'min-h-[3rem]'"
          :placeholder="props.composerPlaceholder"
          @keyup.enter.ctrl="submitComment" />
      </div>

      <div class="mt-2 flex items-center justify-end">
        <button type="button"
          class="inline-flex items-center gap-1.5 rounded-md font-semibold text-primary-foreground"
          :class="[isDockDensity ? 'px-3 py-1.5 text-xs' : 'px-4 py-1.5 text-[13px]', newCommentContent.trim()
            ? 'bg-primary hover:bg-primary/90'
            : 'cursor-not-allowed bg-[#D1D5DB]']"
          :disabled="!newCommentContent.trim()"
          @click="submitComment">
          {{ props.composerSubmitLabel }}
          <Send class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <Teleport v-if="screenshotPreviewUrl" to="body">
      <div class="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/70 p-6"
        data-testid="review-comments-screenshot-preview"
        @click="screenshotPreviewUrl = null">
        <img :src="screenshotPreviewUrl"
          alt="批注截图预览"
          class="max-h-full max-w-full rounded-2xl bg-white object-contain shadow-2xl"
          @click.stop />
      </div>
    </Teleport>
  </div>
</template>
