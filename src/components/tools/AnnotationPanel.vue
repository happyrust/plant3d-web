<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue';

import { LayoutGrid, List } from 'lucide-vue-next';

import ReviewCommentsPanel from '@/components/review/ReviewCommentsPanel.vue';
import { useToolStore, type AnnotationType } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { type AnnotationComment, getRoleDisplayName, UserRole } from '@/types/auth';

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  flyToAnnotation: (id: string) => void;
  removeAnnotation: (id: string) => void;
  highlightAnnotationTarget?: (refno: string) => void;
  highlightAnnotationTargets?: (refnos: string[]) => void;
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
const userStore = useUserStore();

const sortedText = computed(() => {
  return [...store.annotations.value].sort((a, b) => b.createdAt - a.createdAt);
});

const sortedCloud = computed(() => {
  return [...store.cloudAnnotations.value].sort((a, b) => b.createdAt - a.createdAt);
});

const sortedRect = computed(() => {
  return [...store.rectAnnotations.value].sort((a, b) => b.createdAt - a.createdAt);
});

const sortedObb = computed(() => {
  return [...store.obbAnnotations.value].sort((a, b) => b.createdAt - a.createdAt);
});

const activeText = computed(() => {
  const id = store.activeAnnotationId.value;
  if (!id) return null;
  return store.annotations.value.find((a) => a.id === id) || null;
});

const activeCloud = computed(() => {
  const id = store.activeCloudAnnotationId.value;
  if (!id) return null;
  return store.cloudAnnotations.value.find((a) => a.id === id) || null;
});

const activeRect = computed(() => {
  const id = store.activeRectAnnotationId.value;
  if (!id) return null;
  return store.rectAnnotations.value.find((a) => a.id === id) || null;
});

const activeObb = computed(() => {
  const id = store.activeObbAnnotationId.value;
  if (!id) return null;
  return store.obbAnnotations.value.find((a) => a.id === id) || null;
});

const activeAny = computed(() => {
  return activeText.value || activeCloud.value || activeRect.value || activeObb.value;
});

function setMode(mode: 'none' | 'annotation' | 'annotation_cloud' | 'annotation_rect' | 'annotation_obb') {
  store.setToolMode(mode);
}

function setActiveText(id: string) {
  store.activeAnnotationId.value = id;
  store.activeCloudAnnotationId.value = null;
  store.activeRectAnnotationId.value = null;
  store.activeObbAnnotationId.value = null;
}

function setActiveCloudAnno(id: string) {
  store.activeCloudAnnotationId.value = id;
  store.activeAnnotationId.value = null;
  store.activeRectAnnotationId.value = null;
  store.activeObbAnnotationId.value = null;
}

function setActiveRectAnno(id: string) {
  store.activeRectAnnotationId.value = id;
  store.activeAnnotationId.value = null;
  store.activeCloudAnnotationId.value = null;
  store.activeObbAnnotationId.value = null;
}

function setActiveObbAnno(id: string) {
  store.activeObbAnnotationId.value = id;
  store.activeAnnotationId.value = null;
  store.activeCloudAnnotationId.value = null;
  store.activeRectAnnotationId.value = null;
}

function toggleTextVisible(id: string, current: boolean) {
  store.updateAnnotationVisible(id, !current);
}

function toggleCloudVisible(id: string, current: boolean) {
  store.updateCloudAnnotationVisible(id, !current);
}

function toggleRectVisible(id: string, current: boolean) {
  store.updateRectAnnotationVisible(id, !current);
}

function toggleObbVisible(id: string, current: boolean) {
  store.updateObbAnnotationVisible(id, !current);
}

function flyText(id: string) {
  // 找到批注记录，获取关联的 refno
  const annotation = store.annotations.value.find((a) => a.id === id);
  if (annotation?.refno) {
    // 触发模型显示事件，确保关联的模型已加载
    window.dispatchEvent(
      new CustomEvent('showModelByRefnos', {
        detail: { refnos: [annotation.refno], regenModel: false }
      })
    );
  }
  props.tools.flyToAnnotation(id);
}

function flyCloud(id: string) {
  // 找到批注记录，获取关联的 refnos
  const annotation = store.cloudAnnotations.value.find((a) => a.id === id);
  if (annotation?.refnos && annotation.refnos.length > 0) {
    // 触发模型显示事件，确保关联的模型已加载
    window.dispatchEvent(
      new CustomEvent('showModelByRefnos', {
        detail: { refnos: annotation.refnos, regenModel: false }
      })
    );
  }
  props.tools.flyToCloudAnnotation?.(id);
}

function flyRect(id: string) {
  props.tools.flyToRectAnnotation?.(id);
}

function flyObb(id: string) {
  // 找到批注记录，获取关联的 refnos 或 objectIds
  const annotation = store.obbAnnotations.value.find((a) => a.id === id);
  const refnosToShow = annotation?.refnos && annotation.refnos.length > 0
    ? annotation.refnos
    : annotation?.objectIds || [];
  if (refnosToShow.length > 0) {
    // 触发模型显示事件，确保关联的模型已加载
    window.dispatchEvent(
      new CustomEvent('showModelByRefnos', {
        detail: { refnos: refnosToShow, regenModel: false }
      })
    );
  }
  props.tools.flyToObbAnnotation?.(id);
}

function removeText(id: string) {
  props.tools.removeAnnotation(id);
}

function removeCloud(id: string) {
  if (props.tools.removeCloudAnnotation) {
    props.tools.removeCloudAnnotation(id);
  } else {
    store.removeCloudAnnotation(id);
  }
}

function removeRect(id: string) {
  if (props.tools.removeRectAnnotation) {
    props.tools.removeRectAnnotation(id);
  } else {
    store.removeRectAnnotation(id);
  }
}

function removeObb(id: string) {
  if (props.tools.removeObbAnnotation) {
    props.tools.removeObbAnnotation(id);
  } else {
    store.removeObbAnnotation(id);
  }
}

function updateTitle(v: string) {
  if (activeText.value) {
    store.updateAnnotation(activeText.value.id, { title: v });
    return;
  }
  if (activeCloud.value) {
    store.updateCloudAnnotation(activeCloud.value.id, { title: v });
    return;
  }
  if (activeRect.value) {
    store.updateRectAnnotation(activeRect.value.id, { title: v });
    return;
  }
  if (activeObb.value) {
    store.updateObbAnnotation(activeObb.value.id, { title: v });
  }
}

function updateDescription(v: string) {
  if (activeText.value) {
    store.updateAnnotation(activeText.value.id, { description: v });
    return;
  }
  if (activeCloud.value) {
    store.updateCloudAnnotation(activeCloud.value.id, { description: v });
    return;
  }
  if (activeRect.value) {
    store.updateRectAnnotation(activeRect.value.id, { description: v });
    return;
  }
  if (activeObb.value) {
    store.updateObbAnnotation(activeObb.value.id, { description: v });
  }
}

// OBB 创建后弹窗编辑
const showObbEditDialog = ref(false);
const pendingObbTitle = ref('');
const pendingObbDescription = ref('');

// 文字批注创建后弹窗编辑
const showTextEditDialog = ref(false);
const pendingTextTitle = ref('');
const pendingTextDescription = ref('');
// 获取待编辑文字批注的关联 refno
const pendingAnnotationRefno = computed(() => {
  const id = store.pendingTextAnnotationEditId.value;
  if (!id) return null;
  const rec = store.annotations.value.find((a) => a.id === id);
  return rec?.refno || null;
});

watch(() => store.pendingObbEditId.value, (id) => {
  if (id) {
    const rec = store.obbAnnotations.value.find((a) => a.id === id);
    if (rec) {
      pendingObbTitle.value = rec.title;
      pendingObbDescription.value = rec.description;
      showObbEditDialog.value = true;
    }
  }
});

watch(() => store.pendingTextAnnotationEditId.value, (id) => {
  if (id) {
    const rec = store.annotations.value.find((a) => a.id === id);
    if (rec) {
      pendingTextTitle.value = rec.title;
      pendingTextDescription.value = rec.description;
      showTextEditDialog.value = true;
    }
  }
});

function confirmObbEdit() {
  const id = store.pendingObbEditId.value;
  if (id) {
    store.updateObbAnnotation(id, {
      title: pendingObbTitle.value,
      description: pendingObbDescription.value,
    });
  }
  showObbEditDialog.value = false;
  store.pendingObbEditId.value = null;
}

function cancelObbEdit() {
  showObbEditDialog.value = false;
  store.pendingObbEditId.value = null;
}

function confirmTextEdit() {
  const id = store.pendingTextAnnotationEditId.value;
  if (id) {
    store.updateAnnotation(id, {
      title: pendingTextTitle.value,
      description: pendingTextDescription.value,
    });
  }
  showTextEditDialog.value = false;
  store.pendingTextAnnotationEditId.value = null;
}

function cancelTextEdit() {
  showTextEditDialog.value = false;
  store.pendingTextAnnotationEditId.value = null;
}

function highlightTextRefno(refno: string) {
  if (props.tools.highlightAnnotationTarget) {
    props.tools.highlightAnnotationTarget(refno);
  }
}

function highlightCloudRefnos(refnos: string[]) {
  if (props.tools.highlightAnnotationTargets && refnos.length > 0) {
    props.tools.highlightAnnotationTargets(refnos);
  }
}

function highlightObbRefnos(refnos: string[]) {
  if (props.tools.highlightAnnotationTargets && refnos.length > 0) {
    props.tools.highlightAnnotationTargets(refnos);
  }
}

// ==================== 评论/意见管理 ====================

const newCommentContent = ref('');
const replyToCommentId = ref<string | null>(null);
const editingCommentId = ref<string | null>(null);
const editingCommentContent = ref('');

// 意见视图模式：list = 列表视图, columns = 三栏视图
const commentsViewMode = ref<'list' | 'columns'>('columns');

// 获取当前选中批注的类型
const activeAnnotationType = computed<AnnotationType | null>(() => {
  if (activeText.value) return 'text';
  if (activeCloud.value) return 'cloud';
  if (activeRect.value) return 'rect';
  if (activeObb.value) return 'obb';
  return null;
});

// 获取当前选中批注的评论列表
const activeComments = computed<AnnotationComment[]>(() => {
  if (!activeAny.value || !activeAnnotationType.value) return [];
  return store.getAnnotationComments(activeAnnotationType.value, activeAny.value.id);
});

// 按角色分组的评论
const commentsByRole = computed(() => {
  const groups: Record<string, AnnotationComment[]> = {};

  for (const comment of activeComments.value) {
    const roleKey = comment.authorRole;
    if (!groups[roleKey]) {
      groups[roleKey] = [];
    }
    groups[roleKey].push(comment);
  }

  // 按时间排序每个分组
  for (const key of Object.keys(groups)) {
    const list = groups[key];
    if (list) {
      list.sort((a, b) => a.createdAt - b.createdAt);
    }
  }

  return groups;
});

// 获取角色对应的颜色类
function getRoleColorClass(role: UserRole): string {
  switch (role) {
    case UserRole.DESIGNER:
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case UserRole.REVIEWER:
      return 'bg-orange-100 text-orange-700 border-orange-200';
    case UserRole.PROOFREADER:
      return 'bg-green-100 text-green-700 border-green-200';
    case UserRole.MANAGER:
      return 'bg-purple-100 text-purple-700 border-purple-200';
    case UserRole.ADMIN:
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

// 添加评论
function addComment() {
  if (!newCommentContent.value.trim()) return;
  if (!activeAny.value || !activeAnnotationType.value) return;

  const user = userStore.currentUser.value;
  if (!user) return;

  store.addCommentToAnnotation(activeAnnotationType.value, activeAny.value.id, {
    authorId: user.id,
    authorName: user.name,
    authorRole: user.role,
    content: newCommentContent.value.trim(),
    replyToId: replyToCommentId.value || undefined,
  });

  newCommentContent.value = '';
  replyToCommentId.value = null;
}

// 开始编辑评论
function startEditComment(comment: AnnotationComment) {
  editingCommentId.value = comment.id;
  editingCommentContent.value = comment.content;
}

// 保存编辑的评论
function saveEditComment() {
  if (!editingCommentId.value || !editingCommentContent.value.trim()) return;
  if (!activeAny.value || !activeAnnotationType.value) return;

  store.updateAnnotationComment(
    activeAnnotationType.value,
    activeAny.value.id,
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
function deleteComment(commentId: string) {
  if (!activeAny.value || !activeAnnotationType.value) return;
  store.removeAnnotationComment(activeAnnotationType.value, activeAny.value.id, commentId);
}

// 设置回复目标
function setReplyTo(comment: AnnotationComment) {
  replyToCommentId.value = comment.id;
}

// 取消回复
function cancelReply() {
  replyToCommentId.value = null;
}

// 获取被回复的评论
function getReplyToComment(replyToId: string | undefined): AnnotationComment | null {
  if (!replyToId) return null;
  return activeComments.value.find(c => c.id === replyToId) || null;
}

// 判断当前用户是否可以编辑/删除某条评论
function canEditComment(comment: AnnotationComment): boolean {
  const user = userStore.currentUser.value;
  if (!user) return false;
  // 只有作者本人或管理员可以编辑
  return comment.authorId === user.id || user.role === UserRole.ADMIN;
}

// 格式化时间
function formatCommentTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 文字批注创建后编辑弹窗 -->
    <div v-if="showTextEditDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="w-80 rounded-lg border border-border bg-background p-4 shadow-xl">
        <div class="text-base font-semibold">编辑文字批注</div>
        <div class="mt-1 text-xs text-muted-foreground">图钉已创建，请输入批注信息</div>
        <!-- 显示关联构件 refno -->
        <div v-if="pendingAnnotationRefno" class="mt-2 flex items-center gap-1 text-xs">
          <span class="text-muted-foreground">关联构件：</span>
          <span class="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-blue-600 dark:bg-blue-950 dark:text-blue-400">{{ pendingAnnotationRefno }}</span>
        </div>
        <div v-else class="mt-2 text-xs text-muted-foreground/60">未关联构件</div>

        <div class="mt-4 flex flex-col gap-3">
          <div>
            <label class="text-xs text-muted-foreground">标题</label>
            <input v-model="pendingTextTitle"
              class="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="输入批注标题" @keyup.enter="confirmTextEdit" />
          </div>

          <div>
            <label class="text-xs text-muted-foreground">描述</label>
            <textarea v-model="pendingTextDescription"
              class="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="输入批注描述（可选）" />
          </div>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button"
            class="h-9 rounded-md border border-input bg-background px-4 text-sm hover:bg-muted"
            @click="cancelTextEdit">
            取消
          </button>
          <button type="button"
            class="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90"
            @click="confirmTextEdit">
            确定
          </button>
        </div>
      </div>
    </div>

    <!-- OBB 创建后编辑弹窗 -->
    <div v-if="showObbEditDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="w-80 rounded-lg border border-border bg-background p-4 shadow-xl">
        <div class="text-base font-semibold">编辑 OBB 批注</div>
        <div class="mt-1 text-xs text-muted-foreground">框选完成，请输入批注信息</div>

        <div class="mt-4 flex flex-col gap-3">
          <div>
            <label class="text-xs text-muted-foreground">标题</label>
            <input v-model="pendingObbTitle"
              class="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="输入批注标题" @keyup.enter="confirmObbEdit" />
          </div>

          <div>
            <label class="text-xs text-muted-foreground">描述</label>
            <textarea v-model="pendingObbDescription"
              class="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="输入批注描述（可选）" />
          </div>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button"
            class="h-9 rounded-md border border-input bg-background px-4 text-sm hover:bg-muted"
            @click="cancelObbEdit">
            取消
          </button>
          <button type="button"
            class="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90"
            @click="confirmObbEdit">
            确定
          </button>
        </div>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">工具状态</div>
      <div class="mt-1 text-xs text-muted-foreground">{{ tools.statusText }}</div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'none' ? 'bg-muted' : ''"
          @click="setMode('none')">
          关闭
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'annotation' ? 'bg-muted' : ''"
          @click="setMode('annotation')">
          文字
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'annotation_cloud' ? 'bg-muted' : ''"
          @click="setMode('annotation_cloud')">
          云线
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'annotation_rect' ? 'bg-muted' : ''"
          @click="setMode('annotation_rect')">
          矩形
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'annotation_obb' ? 'bg-muted' : ''"
          @click="setMode('annotation_obb')">
          OBB框选
        </button>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        文字/云线/矩形：点击模型表面创建。OBB框选：拖拽框选物体生成包围盒批注。
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">文字批注</div>
        <div class="text-xs text-muted-foreground">共 {{ store.annotationCount }} 条</div>
      </div>

      <div v-if="sortedText.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无文字批注。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <button v-for="a in sortedText"
          :key="a.id"
          type="button"
          class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
          :class="store.activeAnnotationId.value === a.id ? 'bg-muted' : ''"
          @click="setActiveText(a.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ a.glyph }}</span>
                <span class="ml-2">{{ a.title }}</span>
                <span v-if="a.refno" class="ml-1 inline-block rounded bg-blue-50 px-1 py-0.5 text-[10px] text-blue-600 dark:bg-blue-950 dark:text-blue-400" :title="'RefNo: ' + a.refno">{{ a.refno }}</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">{{ a.description || '（无描述）' }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ new Date(a.createdAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="flyText(a.id)">
              定位
            </button>

            <button v-if="a.refno" type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="highlightTextRefno(a.refno)">
              高亮
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="toggleTextVisible(a.id, a.visible)">
              {{ a.visible ? '隐藏' : '显示' }}
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
              @click.stop="removeText(a.id)">
              删除
            </button>
          </div>
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">云线批注</div>
        <div class="text-xs text-muted-foreground">共 {{ store.cloudAnnotationCount }} 条</div>
      </div>

      <div v-if="sortedCloud.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无云线批注。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <button v-for="a in sortedCloud"
          :key="a.id"
          type="button"
          class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
          :class="store.activeCloudAnnotationId.value === a.id ? 'bg-muted' : ''"
          @click="setActiveCloudAnno(a.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ a.title }}</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">{{ a.description || '（无描述）' }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ new Date(a.createdAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="flyCloud(a.id)">
              定位
            </button>

            <button v-if="a.refnos && a.refnos.length > 0" type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="highlightCloudRefnos(a.refnos)">
              高亮
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="toggleCloudVisible(a.id, a.visible)">
              {{ a.visible ? '隐藏' : '显示' }}
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
              @click.stop="removeCloud(a.id)">
              删除
            </button>
          </div>
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">矩形批注</div>
        <div class="text-xs text-muted-foreground">共 {{ store.rectAnnotationCount }} 条</div>
      </div>

      <div v-if="sortedRect.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无矩形批注。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <button v-for="a in sortedRect"
          :key="a.id"
          type="button"
          class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
          :class="store.activeRectAnnotationId.value === a.id ? 'bg-muted' : ''"
          @click="setActiveRectAnno(a.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ a.title }}</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">{{ a.description || '（无描述）' }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ new Date(a.createdAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="flyRect(a.id)">
              定位
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="toggleRectVisible(a.id, a.visible)">
              {{ a.visible ? '隐藏' : '显示' }}
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
              @click.stop="removeRect(a.id)">
              删除
            </button>
          </div>
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">OBB框选批注</div>
        <div class="text-xs text-muted-foreground">共 {{ store.obbAnnotationCount }} 条</div>
      </div>

      <div v-if="sortedObb.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无OBB批注。进入OBB框选模式后拖拽框选物体即可创建。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <button v-for="a in sortedObb"
          :key="a.id"
          type="button"
          class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
          :class="store.activeObbAnnotationId.value === a.id ? 'bg-muted' : ''"
          @click="setActiveObbAnno(a.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ a.title }}</span>
                <span class="ml-2 text-xs text-muted-foreground">({{ a.objectIds.length }}个物体)</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">{{ a.description || '（无描述）' }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ new Date(a.createdAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="flyObb(a.id)">
              定位
            </button>

            <button v-if="(a.refnos && a.refnos.length > 0) || a.objectIds.length > 0" type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="highlightObbRefnos(a.refnos && a.refnos.length > 0 ? a.refnos : a.objectIds)">
              高亮
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="toggleObbVisible(a.id, a.visible)">
              {{ a.visible ? '隐藏' : '显示' }}
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
              @click.stop="removeObb(a.id)">
              删除
            </button>
          </div>
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">编辑</div>

      <div v-if="!activeAny" class="mt-2 text-sm text-muted-foreground">
        选择一个批注后可编辑标题与描述。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <label class="text-xs text-muted-foreground">标题</label>
        <input class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          :value="activeAny.title"
          @input="updateTitle(($event.target as HTMLInputElement).value)" />

        <label class="text-xs text-muted-foreground">描述</label>
        <textarea class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          :value="activeAny.description"
          @input="updateDescription(($event.target as HTMLTextAreaElement).value)" />

        <div class="text-xs text-muted-foreground">修改会自动同步到场景与本地存储。</div>
      </div>
    </div>

    <!-- 意见/评论卡片 -->
    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">意见管理</span>
          <span v-if="activeComments.length > 0" class="text-xs text-muted-foreground">
            ({{ activeComments.length }} 条)
          </span>
        </div>
        <!-- 视图切换按钮 -->
        <div class="flex items-center gap-1 rounded-md border border-input p-0.5">
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded"
            :class="commentsViewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
            title="列表视图"
            @click="commentsViewMode = 'list'"
          >
            <List class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded"
            :class="commentsViewMode === 'columns' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
            title="三栏视图"
            @click="commentsViewMode = 'columns'"
          >
            <LayoutGrid class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div v-if="!activeAny" class="mt-2 text-sm text-muted-foreground">
        选择一个批注后可查看和添加意见。
      </div>

      <!-- 三栏视图 -->
      <div v-else-if="commentsViewMode === 'columns'" class="mt-3">
        <ReviewCommentsPanel
          :annotation-type="activeAnnotationType"
          :annotation-id="activeAny?.id || null"
        />
      </div>

      <!-- 列表视图 (原有逻辑) -->
      <div v-else class="mt-2 flex flex-col gap-3">
        <!-- 按角色分组显示评论 -->
        <template v-if="Object.keys(commentsByRole).length > 0">
          <div v-for="(comments, role) in commentsByRole" :key="role" class="rounded-md border p-2"
            :class="getRoleColorClass(role as UserRole)">
            <div class="mb-2 text-xs font-semibold">
              {{ getRoleDisplayName(role as UserRole) }}意见 ({{ comments.length }})
            </div>

            <div class="flex flex-col gap-2">
              <div v-for="comment in comments" :key="comment.id"
                class="rounded bg-white/80 p-2 text-sm dark:bg-black/20">
                <!-- 回复引用 -->
                <div v-if="comment.replyToId" class="mb-1 border-l-2 border-gray-300 pl-2 text-xs text-muted-foreground">
                  <template v-if="getReplyToComment(comment.replyToId)">
                    回复 {{ getReplyToComment(comment.replyToId)?.authorName }}:
                    "{{ getReplyToComment(comment.replyToId)?.content.slice(0, 30) }}{{ (getReplyToComment(comment.replyToId)?.content.length || 0) > 30 ? '...' : '' }}"
                  </template>
                </div>

                <!-- 评论内容（编辑模式） -->
                <div v-if="editingCommentId === comment.id" class="flex flex-col gap-2">
                  <textarea v-model="editingCommentContent"
                    class="min-h-16 w-full rounded border border-input bg-background px-2 py-1 text-sm"
                    @keyup.enter.ctrl="saveEditComment" />
                  <div class="flex gap-2">
                    <button type="button"
                      class="h-7 rounded bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90"
                      @click="saveEditComment">
                      保存
                    </button>
                    <button type="button"
                      class="h-7 rounded border border-input px-2 text-xs hover:bg-muted"
                      @click="cancelEditComment">
                      取消
                    </button>
                  </div>
                </div>

                <!-- 评论内容（显示模式） -->
                <template v-else>
                  <div class="whitespace-pre-wrap break-words">{{ comment.content }}</div>

                  <div class="mt-1 flex items-center justify-between">
                    <div class="text-xs text-muted-foreground">
                      {{ comment.authorName }} · {{ formatCommentTime(comment.createdAt) }}
                      <span v-if="comment.updatedAt" class="ml-1">(已编辑)</span>
                    </div>

                    <div class="flex gap-1">
                      <button type="button"
                        class="h-6 rounded px-1.5 text-xs text-blue-600 hover:bg-blue-50"
                        @click="setReplyTo(comment)">
                        回复
                      </button>
                      <template v-if="canEditComment(comment)">
                        <button type="button"
                          class="h-6 rounded px-1.5 text-xs hover:bg-muted"
                          @click="startEditComment(comment)">
                          编辑
                        </button>
                        <button type="button"
                          class="h-6 rounded px-1.5 text-xs text-destructive hover:bg-red-50"
                          @click="deleteComment(comment.id)">
                          删除
                        </button>
                      </template>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="text-sm text-muted-foreground">
          暂无意见，点击下方添加。
        </div>

        <!-- 添加意见 -->
        <div class="rounded-md border border-dashed border-border p-2">
          <div class="mb-2 flex items-center gap-2">
            <span class="text-xs font-medium">添加意见</span>
            <span v-if="userStore.currentUser.value"
              class="rounded px-1.5 py-0.5 text-xs"
              :class="getRoleColorClass(userStore.currentUser.value.role)">
              {{ getRoleDisplayName(userStore.currentUser.value.role) }}
            </span>
          </div>

          <!-- 回复提示 -->
          <div v-if="replyToCommentId" class="mb-2 flex items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
            <span class="text-muted-foreground">
              回复 {{ getReplyToComment(replyToCommentId)?.authorName }}
            </span>
            <button type="button" class="ml-auto text-muted-foreground hover:text-foreground" @click="cancelReply">
              ×
            </button>
          </div>

          <textarea v-model="newCommentContent"
            class="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="输入您的意见..."
            @keyup.enter.ctrl="addComment" />

          <div class="mt-2 flex items-center justify-between">
            <span class="text-xs text-muted-foreground">Ctrl+Enter 快捷提交</span>
            <button type="button"
              class="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              :disabled="!newCommentContent.trim() || !userStore.currentUser.value"
              @click="addComment">
              提交意见
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
