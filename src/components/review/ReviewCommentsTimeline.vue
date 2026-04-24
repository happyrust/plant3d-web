<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  BadgeCheck,
  Camera,
  CircleSlash,
  Paperclip,
  Reply,
  Send,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-vue-next';

import type { AnnotationType } from '@/composables/useToolStore';

import {
  reviewCommentCreate,
  reviewCommentDelete,
  reviewCommentGetByAnnotation,
  reviewCommentUpdate,
} from '@/api/reviewApi';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { emitToast } from '@/ribbon/toastBus';
import {
  type AnnotationComment,
  type AnnotationReviewAction,
  type AnnotationReviewEvent,
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
}>(), {
  annotationLabel: undefined,
  composerPlaceholder: '输入意见...',
  composerSubmitLabel: '发表',
  designerOnly: false,
});

const emit = defineEmits<(e: 'close') => void>();

const store = useToolStore();
const reviewStore = useReviewStore();
const userStore = useUserStore();
const commentLoading = ref(false);
const commentError = ref<string | null>(null);
const newCommentContent = ref('');
const replyToCommentId = ref<string | null>(null);
const editingCommentId = ref<string | null>(null);
const editingCommentContent = ref('');
const actionNote = ref('');

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

let stopCommentAddedListener: (() => void) | null = null;

async function loadCommentsFromBackend() {
  if (!props.annotationType || !props.annotationId) return;
  commentLoading.value = true;
  commentError.value = null;
  try {
    const resp = await reviewCommentGetByAnnotation(props.annotationId, props.annotationType);
    if (resp.success && resp.comments) {
      const normalized = [...resp.comments].sort((a, b) => a.createdAt - b.createdAt);
      store.setAnnotationComments(props.annotationType, props.annotationId, normalized);
    }
  } catch (e) {
    commentError.value = e instanceof Error ? e.message : '加载评论失败';
  } finally {
    commentLoading.value = false;
  }
}

function matchesIncomingCommentEvent(data: unknown): boolean {
  if (!props.annotationType || !props.annotationId || !data || typeof data !== 'object') return false;

  const source = 'comment' in data && data.comment && typeof data.comment === 'object'
    ? data.comment as Record<string, unknown>
    : data as Record<string, unknown>;

  return String(source.annotationId ?? '') === props.annotationId
    && String(source.annotationType ?? '') === props.annotationType;
}

onMounted(() => {
  loadCommentsFromBackend();
  stopCommentAddedListener = reviewStore.onCommentAdded((data) => {
    if (!matchesIncomingCommentEvent(data)) return;
    void loadCommentsFromBackend();
  });
});

onUnmounted(() => {
  stopCommentAddedListener?.();
  stopCommentAddedListener = null;
});

watch(() => [props.annotationId, props.annotationType], () => {
  actionNote.value = '';
  replyToCommentId.value = null;
  editingCommentId.value = null;
  editingCommentContent.value = '';
  loadCommentsFromBackend();
});

const allComments = computed<AnnotationComment[]>(() => {
  if (!props.annotationType || !props.annotationId) return [];
  return [...store.getAnnotationComments(props.annotationType, props.annotationId)]
    .sort((a, b) => a.createdAt - b.createdAt);
});

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

  try {
    await reviewCommentUpdate(editingCommentId.value, editingCommentContent.value.trim());
  } catch { /* fallback to local */ }

  store.updateAnnotationComment(
    props.annotationType,
    props.annotationId,
    editingCommentId.value,
    { content: editingCommentContent.value.trim() },
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
  try {
    await reviewCommentDelete(commentId);
  } catch { /* fallback */ }
  store.removeAnnotationComment(props.annotationType, props.annotationId, commentId);
}

async function submitComment() {
  const content = newCommentContent.value.trim();
  if (!content || !props.annotationType || !props.annotationId) return;

  const user = userStore.currentUser.value;
  if (!user) return;

  const replyToId = replyToCommentId.value || undefined;

  try {
    const resp = await reviewCommentCreate({
      annotationId: props.annotationId,
      annotationType: props.annotationType,
      authorId: user.id,
      authorName: user.name,
      authorRole: user.role,
      content,
      replyToId,
    });
    if (resp.success && resp.comment) {
      store.addCommentToAnnotation(props.annotationType, props.annotationId, resp.comment);
    } else {
      store.addCommentToAnnotation(props.annotationType, props.annotationId, {
        authorId: user.id,
        authorName: user.name,
        authorRole: user.role,
        content,
        replyToId,
      });
    }
  } catch {
    store.addCommentToAnnotation(props.annotationType, props.annotationId, {
      authorId: user.id,
      authorName: user.name,
      authorRole: user.role,
      content,
      replyToId,
    });
  }

  newCommentContent.value = '';
  replyToCommentId.value = null;
}

function applyReviewAction(action: AnnotationReviewAction) {
  if (!props.annotationType || !props.annotationId) return;
  const user = currentUser.value;
  if (!user) return;

  if ((action === 'fixed' || action === 'wont_fix') && !canDesignHandle.value) return;
  if ((action === 'agree' || action === 'reject') && !canDecisionAct.value) return;

  const nextState = store.applyAnnotationReviewAction(props.annotationType, props.annotationId, {
    action,
    actor: user,
    note: actionNote.value,
  });

  if (!nextState) {
    emitToast({ message: '更新批注处理状态失败', level: 'error' });
    return;
  }

  actionNote.value = '';
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
}

function canEditComment(comment: AnnotationComment): boolean {
  const user = userStore.currentUser.value;
  if (!user) return false;
  return comment.authorId === user.id || user.role === UserRole.ADMIN;
}
</script>

<template>
  <div class="flex flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-md">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
      <div class="flex items-center gap-2">
        <svg class="h-4 w-4 text-[#FF6B00]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12zM7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z" />
        </svg>
        <span class="text-sm font-semibold text-[#111827]">{{ displayLabel }}</span>
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
      class="px-4 py-8 text-center text-sm text-[#9CA3AF]">
      请先选择一个批注以查看讨论
    </div>

    <!-- Messages body -->
    <div v-else class="flex-1 overflow-y-auto">
      <div class="border-b border-[#E5E7EB] bg-[#FCFCFD] px-4 py-3">
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
          class="mt-1 text-[11px] text-[#9CA3AF]">
          最近处理：{{ reviewState.updatedByName }}
          <span v-if="reviewState.updatedByRole">（{{ getRoleDisplayName(reviewState.updatedByRole) }}）</span>
          · {{ formatDateTime(reviewState.updatedAt) }}
        </div>
        <div v-if="reviewState?.note"
          class="mt-2 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[12px] leading-relaxed text-[#4B5563]">
          {{ reviewState.note }}
        </div>

        <div v-if="showReviewActions" class="mt-3">
          <div class="rounded-md border border-[#D1D5DB] bg-white px-3 py-2">
            <textarea v-model="actionNote"
              class="min-h-[2.75rem] w-full resize-none text-[12px] text-[#374151] placeholder:text-[#9CA3AF] focus:outline-none"
              :placeholder="reviewActionPlaceholder" />
          </div>
          <div class="mt-2 flex flex-wrap gap-2">
            <template v-if="canDesignHandle">
              <button type="button"
                class="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-100"
                @click="applyReviewAction('fixed')">
                <BadgeCheck class="h-3.5 w-3.5" />
                已修改
              </button>
              <button type="button"
                class="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] font-semibold text-amber-700 hover:bg-amber-100"
                @click="applyReviewAction('wont_fix')">
                <CircleSlash class="h-3.5 w-3.5" />
                不需解决
              </button>
            </template>
            <template v-if="canReviewDecide">
              <button type="button"
                class="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!canDecisionAct"
                @click="applyReviewAction('agree')">
                <ThumbsUp class="h-3.5 w-3.5" />
                同意
              </button>
              <button type="button"
                class="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!canDecisionAct"
                @click="applyReviewAction('reject')">
                <ThumbsDown class="h-3.5 w-3.5" />
                驳回
              </button>
            </template>
          </div>
          <div class="mt-2 text-[11px] text-[#9CA3AF]">
            {{ reviewActionHint }}
          </div>
        </div>
      </div>

      <div v-if="commentError" class="px-4 py-2 text-xs text-[#DC2626]">
        {{ commentError }}
      </div>

      <div v-if="commentLoading && timelineItems.length === 0" class="px-4 py-8 text-center text-sm text-[#9CA3AF]">
        正在加载讨论...
      </div>

      <div v-else-if="timelineItems.length === 0" class="px-4 py-8 text-center text-sm text-[#9CA3AF]">
        暂无处理记录或评论，发表第一条意见
      </div>

      <div v-else class="flex flex-col gap-0.5 py-2">
        <div v-for="(item, idx) in timelineItems"
          :key="item.id"
          class="flex gap-2.5 px-4 py-2"
          :class="idx % 2 === 1 ? 'bg-[#F9FAFB]' : ''">
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
                  class="min-h-[3rem] w-full rounded border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px] text-[#374151] focus:border-[#FF6B00] focus:outline-none"
                  @keyup.enter.ctrl="saveEdit" />
                <div class="flex gap-1">
                  <button type="button"
                    class="rounded bg-[#FF6B00] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#EA580C]"
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
                  class="text-[11px] text-[#9CA3AF] hover:text-[#FF6B00]"
                  @click="setReplyTo(item.comment)">
                  回复
                </button>
                <template v-if="canEditComment(item.comment)">
                  <button type="button"
                    class="text-[11px] text-[#9CA3AF] hover:text-[#3B82F6]"
                    @click="startEdit(item.comment)">
                    编辑
                  </button>
                  <button type="button"
                    class="text-[11px] text-[#9CA3AF] hover:text-[#EF4444]"
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
    <div v-if="annotationType && annotationId"
      class="border-t border-[#E5E7EB] bg-[#FAFAFA] px-4 py-3">
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

      <div class="rounded-md border border-[#D1D5DB] bg-white px-3 py-2">
        <textarea v-model="newCommentContent"
          class="min-h-[3rem] w-full resize-none text-[13px] text-[#374151] placeholder:text-[#9CA3AF] focus:outline-none"
          :placeholder="props.composerPlaceholder"
          @keyup.enter.ctrl="submitComment" />
      </div>

      <div class="mt-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <button type="button" class="rounded p-1 text-[#9CA3AF] hover:bg-[#E5E7EB] hover:text-[#6B7280]">
            <Paperclip class="h-4 w-4" />
          </button>
          <button type="button" class="rounded p-1 text-[#9CA3AF] hover:bg-[#E5E7EB] hover:text-[#6B7280]">
            <Camera class="h-4 w-4" />
          </button>
        </div>
        <button type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13px] font-semibold text-white"
          :class="newCommentContent.trim()
            ? 'bg-[#FF6B00] hover:bg-[#EA580C]'
            : 'cursor-not-allowed bg-[#D1D5DB]'"
          :disabled="!newCommentContent.trim()"
          @click="submitComment">
          {{ props.composerSubmitLabel }}
          <Send class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
