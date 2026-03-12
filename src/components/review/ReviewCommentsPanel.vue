<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { Edit3, MessageSquare, Plus, Reply, Trash2 } from 'lucide-vue-next';

import type { AnnotationType } from '@/composables/useToolStore';

import {
  reviewCommentCreate,
  reviewCommentDelete,
  reviewCommentGetByAnnotation,
  reviewCommentUpdate,
} from '@/api/reviewApi';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { type AnnotationComment, getRoleDisplayName, UserRole } from '@/types/auth';

const props = defineProps<{
  annotationType: AnnotationType | null;
  annotationId: string | null;
}>();

const store = useToolStore();
const userStore = useUserStore();
const commentLoading = ref(false);
const commentError = ref<string | null>(null);

// 从后端加载评论
async function loadCommentsFromBackend() {
  if (!props.annotationType || !props.annotationId) return;
  commentLoading.value = true;
  commentError.value = null;
  try {
    const resp = await reviewCommentGetByAnnotation(props.annotationId, props.annotationType);
    if (resp.success && resp.comments) {
      // 将后端评论同步到本地 store（避免重复添加）
      for (const comment of resp.comments) {
        const existing = store.getAnnotationComments(props.annotationType!, props.annotationId!);
        if (!existing.find((c) => c.id === comment.id)) {
          store.addCommentToAnnotation(props.annotationType!, props.annotationId!, {
            ...comment,
          });
        }
      }
    }
  } catch (e) {
    commentError.value = e instanceof Error ? e.message : '加载评论失败';
    console.error('[ReviewCommentsPanel] Failed to load comments:', e);
  } finally {
    commentLoading.value = false;
  }
}

onMounted(() => {
  loadCommentsFromBackend();
});

watch(() => [props.annotationId, props.annotationType], () => {
  loadCommentsFromBackend();
});

// 获取当前批注的所有评论
const allComments = computed<AnnotationComment[]>(() => {
  if (!props.annotationType || !props.annotationId) return [];
  return store.getAnnotationComments(props.annotationType, props.annotationId);
});

// 角色分栏定义
const columnRoles = [
  {
    key: 'designer',
    label: '设计',
    roles: [UserRole.DESIGNER],
    colorClass: 'border-blue-300 bg-blue-50 dark:bg-blue-950',
    headerClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    badgeClass: 'bg-blue-500 text-white',
  },
  {
    key: 'proofreader',
    label: '校核',
    roles: [UserRole.PROOFREADER],
    colorClass: 'border-green-300 bg-green-50 dark:bg-green-950',
    headerClass: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    badgeClass: 'bg-green-500 text-white',
  },
  {
    key: 'reviewer',
    label: '审核',
    roles: [UserRole.REVIEWER, UserRole.MANAGER, UserRole.ADMIN],
    colorClass: 'border-orange-300 bg-orange-50 dark:bg-orange-950',
    headerClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    badgeClass: 'bg-orange-500 text-white',
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
    });
    if (resp.success && resp.comment) {
      // 用后端返回的带 ID 的评论更新本地 store
      store.addCommentToAnnotation(props.annotationType, props.annotationId, resp.comment);
    } else {
      // 后端失败时仍然保存到本地
      store.addCommentToAnnotation(props.annotationType, props.annotationId, {
        authorId: user.id,
        authorName: user.name,
        authorRole: user.role,
        content,
        replyToId,
      });
    }
  } catch {
    // 网络异常降级到本地保存
    store.addCommentToAnnotation(props.annotationType, props.annotationId, {
      authorId: user.id,
      authorName: user.name,
      authorRole: user.role,
      content,
      replyToId,
    });
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

// 保存编辑的评论
async function saveEditComment() {
  if (!editingCommentId.value || !editingCommentContent.value.trim()) return;
  if (!props.annotationType || !props.annotationId) return;

  try {
    await reviewCommentUpdate(editingCommentId.value, editingCommentContent.value.trim());
  } catch {
    // 后端失败时仍然更新本地
  }

  store.updateAnnotationComment(
    props.annotationType,
    props.annotationId,
    editingCommentId.value,
    { content: editingCommentContent.value.trim() }
  );

  editingCommentId.value = null;
  editingCommentContent.value = '';
}

// 取消编辑
function cancelEditComment() {
  editingCommentId.value = null;
  editingCommentContent.value = '';
}

// 删除评论
async function deleteComment(commentId: string) {
  if (!props.annotationType || !props.annotationId) return;

  try {
    await reviewCommentDelete(commentId);
  } catch {
    // 后端失败时仍然删除本地
  }

  store.removeAnnotationComment(props.annotationType, props.annotationId, commentId);
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
        :class="column.colorClass">
        <!-- 栏目头部 -->
        <div class="flex items-center justify-between px-3 py-2 rounded-t-lg"
          :class="column.headerClass">
          <div class="flex items-center gap-2">
            <MessageSquare class="h-4 w-4" />
            <span class="text-sm font-semibold">{{ column.label }}</span>
          </div>
          <span class="px-1.5 py-0.5 rounded text-xs font-medium"
            :class="column.badgeClass">
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
                        class="h-5 w-5 rounded p-0.5 text-destructive hover:bg-red-100 dark:hover:bg-red-900"
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
