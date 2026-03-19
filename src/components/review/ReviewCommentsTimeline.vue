<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  Camera,
  Paperclip,
  Reply,
  Send,
  X,
} from 'lucide-vue-next';

import type { AnnotationType } from '@/composables/useToolStore';

import {
  reviewCommentCreate,
  reviewCommentDelete,
  reviewCommentUpdate,
} from '@/api/reviewApi';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { type AnnotationComment, getRoleTheme, UserRole } from '@/types/auth';

const props = defineProps<{
  annotationType: AnnotationType | null;
  annotationId: string | null;
  annotationLabel?: string;
}>();

const emit = defineEmits<(e: 'close') => void>();

const store = useToolStore();
const userStore = useUserStore();
const commentLoading = ref(false);
const commentError = ref<string | null>(null);
const newCommentContent = ref('');
const replyToCommentId = ref<string | null>(null);
const editingCommentId = ref<string | null>(null);
const editingCommentContent = ref('');

async function loadCommentsFromBackend() {
  if (!props.annotationType || !props.annotationId) return;
  commentLoading.value = true;
  commentError.value = null;
  try {
    const resp = await reviewCommentGetByAnnotation(props.annotationId, props.annotationType);
    if (resp.success && resp.comments) {
      for (const comment of resp.comments) {
        const existing = store.getAnnotationComments(props.annotationType!, props.annotationId!);
        if (!existing.find((c) => c.id === comment.id)) {
          store.addCommentToAnnotation(props.annotationType!, props.annotationId!, { ...comment });
        }
      }
    }
  } catch (e) {
    commentError.value = e instanceof Error ? e.message : '加载评论失败';
  } finally {
    commentLoading.value = false;
  }
}

let reviewCommentGetByAnnotation: typeof import('@/api/reviewApi').reviewCommentGetByAnnotation;
import('@/api/reviewApi').then((mod) => {
  reviewCommentGetByAnnotation = mod.reviewCommentGetByAnnotation;
  loadCommentsFromBackend();
});

onMounted(() => {
  if (reviewCommentGetByAnnotation) loadCommentsFromBackend();
});

watch(() => [props.annotationId, props.annotationType], () => {
  if (reviewCommentGetByAnnotation) loadCommentsFromBackend();
});

const allComments = computed<AnnotationComment[]>(() => {
  if (!props.annotationType || !props.annotationId) return [];
  return store
    .getAnnotationComments(props.annotationType, props.annotationId)
    .sort((a, b) => a.createdAt - b.createdAt);
});

const displayLabel = computed(() => {
  return props.annotationLabel || `批注 #${props.annotationId?.slice(-6) || '---'} 讨论`;
});

const replyToComment = computed<AnnotationComment | null>(() => {
  if (!replyToCommentId.value) return null;
  return allComments.value.find((c) => c.id === replyToCommentId.value) || null;
});

function getReplyToComment(replyToId: string | undefined): AnnotationComment | null {
  if (!replyToId) return null;
  return allComments.value.find((c) => c.id === replyToId) || null;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
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
      <div v-if="allComments.length === 0" class="px-4 py-8 text-center text-sm text-[#9CA3AF]">
        暂无评论，发表第一条意见
      </div>

      <div v-else class="flex flex-col gap-0.5 py-2">
        <div v-for="(comment, idx) in allComments"
          :key="comment.id"
          class="flex gap-2.5 px-4 py-2"
          :class="idx % 2 === 1 ? 'bg-[#F9FAFB]' : ''">
          <!-- Role color bar (3px) -->
          <div class="w-[3px] shrink-0 self-stretch rounded-sm"
            :style="{ backgroundColor: getRoleTheme(comment.authorRole).barColor }" />

          <!-- Message content -->
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <!-- Author line -->
            <div class="flex items-center gap-1.5">
              <span class="inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold"
                :style="{
                  backgroundColor: getRoleTheme(comment.authorRole).bgColor,
                  color: getRoleTheme(comment.authorRole).textColor,
                }">
                {{ getRoleTheme(comment.authorRole).label }}
              </span>
              <span class="text-xs font-semibold text-[#111827]">{{ comment.authorName }}</span>
              <span class="text-[11px] text-[#9CA3AF]">{{ formatTime(comment.createdAt) }}</span>
              <span v-if="comment.updatedAt" class="text-[11px] text-[#9CA3AF]">(已编辑)</span>
            </div>

            <!-- Reply reference -->
            <div v-if="comment.replyToId && getReplyToComment(comment.replyToId)"
              class="flex items-center gap-1 rounded border-l-2 border-[#E5E7EB] bg-[#F3F4F6] px-2 py-1 text-[11px]">
              <Reply class="h-3 w-3 shrink-0 text-[#9CA3AF]" />
              <span class="text-[#9CA3AF]">回复 {{ getReplyToComment(comment.replyToId)?.authorName }}:</span>
              <span class="truncate text-[#6B7280]">
                "{{ getReplyToComment(comment.replyToId)?.content.slice(0, 30) }}{{ (getReplyToComment(comment.replyToId)?.content.length || 0) > 30 ? '...' : '' }}"
              </span>
            </div>

            <!-- Content (editing) -->
            <div v-if="editingCommentId === comment.id" class="flex flex-col gap-1.5">
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
              {{ comment.content }}
            </p>

            <!-- Actions -->
            <div class="flex items-center gap-3">
              <button type="button"
                class="text-[11px] text-[#9CA3AF] hover:text-[#FF6B00]"
                @click="setReplyTo(comment)">
                回复
              </button>
              <template v-if="canEditComment(comment)">
                <button type="button"
                  class="text-[11px] text-[#9CA3AF] hover:text-[#3B82F6]"
                  @click="startEdit(comment)">
                  编辑
                </button>
                <button type="button"
                  class="text-[11px] text-[#9CA3AF] hover:text-[#EF4444]"
                  @click="deleteComment(comment.id)">
                  删除
                </button>
              </template>
            </div>
          </div>
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
          placeholder="输入意见..."
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
          发表
          <Send class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
