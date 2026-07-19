<script setup lang="ts">
import { computed, ref } from 'vue';

import { Edit3, MessageSquare, Plus, Reply, Trash2 } from 'lucide-vue-next';

import type { AnnotationType } from '@/composables/useToolStore';

import {
  reviewCommentCreate,
  reviewCommentDelete,
  reviewCommentUpdate,
} from '@/api/reviewApi';
import { useCommentThread } from '@/composables/useCommentThread';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { emitToast } from '@/ribbon/toastBus';
import { type AnnotationComment, getRoleDisplayName, getRoleTheme, UserRole } from '@/types/auth';

const props = withDefaults(defineProps<{
  annotationType: AnnotationType | null;
  annotationId: string | null;
  contextFormId?: string | null;
  contextTaskId?: string | null;
}>(), {
  contextFormId: undefined,
  contextTaskId: undefined,
});

const store = useToolStore();
const userStore = useUserStore();
function normalizeContextString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

const commentContext = computed(() => ({
  formId: normalizeContextString(props.contextFormId),
  taskId: normalizeContextString(props.contextTaskId),
}));

const {
  comments: allComments,
  loading: commentLoading,
  error: commentError,
} = useCommentThread(() => ({
  annotationType: props.annotationType,
  annotationId: props.annotationId,
  formId: commentContext.value.formId,
  taskId: commentContext.value.taskId,
}));

const designerTheme = getRoleTheme(UserRole.DESIGNER);
const proofreaderTheme = getRoleTheme(UserRole.PROOFREADER);
const reviewerTheme = getRoleTheme(UserRole.REVIEWER);

const columnRoles = [
  {
    key: 'designer',
    label: '设计',
    roles: [UserRole.DESIGNER],
    borderColor: designerTheme.columnBorder,
    bgColor: designerTheme.columnBg,
    headerBg: designerTheme.columnHeader,
    headerText: designerTheme.textColor,
    badgeBg: designerTheme.dotColor,
  },
  {
    key: 'proofreader',
    label: '校核',
    roles: [UserRole.PROOFREADER],
    borderColor: proofreaderTheme.columnBorder,
    bgColor: proofreaderTheme.columnBg,
    headerBg: proofreaderTheme.columnHeader,
    headerText: proofreaderTheme.textColor,
    badgeBg: proofreaderTheme.dotColor,
  },
  {
    key: 'reviewer',
    label: '审核',
    roles: [UserRole.REVIEWER, UserRole.MANAGER, UserRole.ADMIN],
    borderColor: reviewerTheme.columnBorder,
    bgColor: reviewerTheme.columnBg,
    headerBg: reviewerTheme.columnHeader,
    headerText: reviewerTheme.textColor,
    badgeBg: reviewerTheme.dotColor,
  },
];

// 按栏目分组评论
function getCommentsForColumn(roles: UserRole[]): AnnotationComment[] {
  return allComments.value
    .filter((c) => roles.includes(c.authorRole))
    .sort((a, b) => a.createdAt - b.createdAt);
}

// 获取当前用户所属栏目
const currentUserColumn = computed(() => {
  const user = userStore.currentUser.value;
  if (!user) return null;
  return columnRoles.find((col) => col.roles.includes(user.role)) || null;
});

// 添加评论相关
const newCommentContents = ref<Record<string, string>>({
  designer: '',
  proofreader: '',
  reviewer: '',
});

const replyToCommentId = ref<string | null>(null);
const replyToColumnKey = ref<string | null>(null);

// 编辑评论相关
const editingCommentId = ref<string | null>(null);
const editingCommentContent = ref('');

// 添加评论
async function addComment(columnKey: string) {
  const content = newCommentContents.value[columnKey]?.trim();
  if (!content) return;
  if (!props.annotationType || !props.annotationId) return;

  const user = userStore.currentUser.value;
  if (!user) return;

  const replyToId = replyToColumnKey.value === columnKey ? replyToCommentId.value || undefined : undefined;
  const ctx = commentContext.value;

  // 先尝试后端持久化
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
    if (resp.success && resp.comment) {
      store.addCommentToAnnotation(props.annotationType, props.annotationId, resp.comment, ctx.formId, ctx.taskId);
    } else {
      emitToast({ message: resp.error_message || '评论发送失败，请重试', level: 'warning' });
      return;
    }
  } catch {
    emitToast({ message: '网络异常，评论发送失败', level: 'error' });
    return;
  }

  newCommentContents.value[columnKey] = '';
  if (replyToColumnKey.value === columnKey) {
    replyToCommentId.value = null;
    replyToColumnKey.value = null;
  }
}

// 开始编辑评论
function startEditComment(comment: AnnotationComment) {
  editingCommentId.value = comment.id;
  editingCommentContent.value = comment.content;
}

async function saveEditComment() {
  if (!editingCommentId.value || !editingCommentContent.value.trim()) return;
  if (!props.annotationType || !props.annotationId) return;

  const content = editingCommentContent.value.trim();
  const commentId = editingCommentId.value;
  const ctx = commentContext.value;
  const prevContent = allComments.value.find(c => c.id === commentId)?.content;

  store.updateAnnotationComment(props.annotationType, props.annotationId, commentId, { content }, ctx.formId, ctx.taskId);

  try {
    const resp = await reviewCommentUpdate(commentId, content, {
      formId: ctx.formId ?? undefined,
      taskId: ctx.taskId ?? undefined,
    });
    if (resp && resp.success === false) {
      store.updateAnnotationComment(
        props.annotationType,
        props.annotationId,
        commentId,
        { content: prevContent },
        ctx.formId,
        ctx.taskId,
      );
      emitToast({ message: resp.error_message || '评论更新被拒绝，已回滚', level: 'warning' });
    }
  } catch {
    // 网络异常保留本地
  }

  editingCommentId.value = null;
  editingCommentContent.value = '';
}

// 取消编辑
function cancelEditComment() {
  editingCommentId.value = null;
  editingCommentContent.value = '';
}

async function deleteComment(commentId: string) {
  if (!props.annotationType || !props.annotationId) return;

  const ctx = commentContext.value;
  try {
    await reviewCommentDelete(commentId, {
      formId: ctx.formId ?? undefined,
      taskId: ctx.taskId ?? undefined,
    });
  } catch {
    // 后端失败降级本地
  }

  store.removeAnnotationComment(props.annotationType, props.annotationId, commentId, ctx.formId, ctx.taskId);
}

// 设置回复目标
function setReplyTo(comment: AnnotationComment, columnKey: string) {
  replyToCommentId.value = comment.id;
  replyToColumnKey.value = columnKey;
}

// 取消回复
function cancelReply() {
  replyToCommentId.value = null;
  replyToColumnKey.value = null;
}

// 获取被回复的评论
function getReplyToComment(replyToId: string | undefined): AnnotationComment | null {
  if (!replyToId) return null;
  return allComments.value.find((c) => c.id === replyToId) || null;
}

// 判断当前用户是否可以编辑/删除某条评论
function canEditComment(comment: AnnotationComment): boolean {
  const user = userStore.currentUser.value;
  if (!user) return false;
  return comment.authorId === user.id || user.role === UserRole.ADMIN;
}

// 判断当前用户是否可以在某栏添加评论
function canAddToColumn(columnKey: string): boolean {
  const user = userStore.currentUser.value;
  if (!user) return false;
  const column = columnRoles.find((c) => c.key === columnKey);
  if (!column) return false;
  return column.roles.includes(user.role);
}

// 格式化时间
function formatCommentTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="!annotationType || !annotationId" class="text-sm text-muted-foreground text-center py-4">
      请先选择一个批注以查看和管理意见
    </div>

    <div v-else class="grid grid-cols-3 gap-3">
      <!-- 三栏布局 -->
      <div v-for="column in columnRoles"
        :key="column.key"
        class="flex flex-col rounded-lg border"
        :style="{ borderColor: column.borderColor, backgroundColor: column.bgColor }">
        <!-- 栏目头部 -->
        <div class="flex items-center justify-between px-3 py-2 rounded-t-lg"
          :style="{ backgroundColor: column.headerBg, color: column.headerText }">
          <div class="flex items-center gap-2">
            <MessageSquare class="h-4 w-4" />
            <span class="text-sm font-semibold">{{ column.label }}</span>
          </div>
          <span class="rounded px-1.5 py-0.5 text-xs font-medium text-white"
            :style="{ backgroundColor: column.badgeBg }">
            {{ getCommentsForColumn(column.roles).length }}
          </span>
        </div>

        <!-- 评论列表 -->
        <div class="flex-1 overflow-y-auto p-2 space-y-2 min-h-32 max-h-64">
          <template v-if="getCommentsForColumn(column.roles).length > 0">
            <div v-for="comment in getCommentsForColumn(column.roles)"
              :key="comment.id"
              class="rounded-md bg-white/80 dark:bg-black/20 p-2 text-sm shadow-sm">
              <!-- 回复引用 -->
              <div v-if="comment.replyToId"
                class="mb-1.5 border-l-2 border-gray-300 pl-2 text-xs text-muted-foreground">
                <template v-if="getReplyToComment(comment.replyToId)">
                  <Reply class="inline h-3 w-3 mr-1" />
                  回复 {{ getReplyToComment(comment.replyToId)?.authorName }}:
                  "{{ getReplyToComment(comment.replyToId)?.content.slice(0, 20) }}{{ (getReplyToComment(comment.replyToId)?.content.length || 0) > 20 ? '...' : '' }}"
                </template>
              </div>

              <!-- 评论内容（编辑模式） -->
              <div v-if="editingCommentId === comment.id" class="flex flex-col gap-2">
                <textarea v-model="editingCommentContent"
                  class="min-h-14 w-full rounded border border-input bg-background px-2 py-1 text-sm resize-none"
                  @keyup.enter.ctrl="saveEditComment" />
                <div class="flex gap-1">
                  <button type="button"
                    class="h-6 rounded bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90"
                    @click="saveEditComment">
                    保存
                  </button>
                  <button type="button"
                    class="h-6 rounded border border-input px-2 text-xs hover:bg-muted"
                    @click="cancelEditComment">
                    取消
                  </button>
                </div>
              </div>

              <!-- 评论内容（显示模式） -->
              <template v-else>
                <div class="whitespace-pre-wrap break-words text-sm">{{ comment.content }}</div>

                <div class="mt-1.5 flex items-center justify-between">
                  <div class="text-xs text-muted-foreground">
                    {{ comment.authorName }} · {{ formatCommentTime(comment.createdAt) }}
                    <span v-if="comment.updatedAt" class="ml-1">(已编辑)</span>
                  </div>

                  <div class="flex gap-0.5">
                    <button type="button"
                      class="h-5 w-5 rounded p-0.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                      title="回复"
                      @click="setReplyTo(comment, column.key)">
                      <Reply class="h-full w-full" />
                    </button>
                    <template v-if="canEditComment(comment)">
                      <button type="button"
                        class="h-5 w-5 rounded p-0.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                        title="编辑"
                        @click="startEditComment(comment)">
                        <Edit3 class="h-full w-full" />
                      </button>
                      <button type="button"
                        class="h-5 w-5 rounded p-0.5 text-destructive hover:bg-danger/10"
                        title="删除"
                        @click="deleteComment(comment.id)">
                        <Trash2 class="h-full w-full" />
                      </button>
                    </template>
                  </div>
                </div>
              </template>
            </div>
          </template>

          <div v-else class="text-xs text-muted-foreground text-center py-4">
            暂无{{ column.label }}意见
          </div>
        </div>

        <!-- 添加意见区域 -->
        <div class="border-t p-2">
          <!-- 回复提示 -->
          <div v-if="replyToColumnKey === column.key && replyToCommentId"
            class="mb-2 flex items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
            <Reply class="h-3 w-3" />
            <span class="text-muted-foreground truncate flex-1">
              回复 {{ getReplyToComment(replyToCommentId)?.authorName }}
            </span>
            <button type="button"
              class="text-muted-foreground hover:text-foreground"
              @click="cancelReply">
              ×
            </button>
          </div>

          <template v-if="canAddToColumn(column.key)">
            <textarea v-model="newCommentContents[column.key]"
              class="min-h-12 w-full rounded border border-input bg-background px-2 py-1.5 text-sm resize-none"
              :placeholder="`添加${column.label}意见...`"
              @keyup.enter.ctrl="addComment(column.key)" />
            <button type="button"
              class="mt-1.5 flex h-7 w-full items-center justify-center gap-1 rounded bg-primary text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              :disabled="!newCommentContents[column.key]?.trim()"
              @click="addComment(column.key)">
              <Plus class="h-3 w-3" />
              提交意见
            </button>
          </template>
          <div v-else class="text-xs text-muted-foreground text-center py-2">
            {{ currentUserColumn ? `您当前是${getRoleDisplayName(userStore.currentUser.value?.role || UserRole.VIEWER)}，请在对应栏目添加意见` : '请登录后添加意见' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
