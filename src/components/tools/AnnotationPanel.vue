<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue';

import { LayoutGrid, List, MessageSquareMore } from 'lucide-vue-next';

import {
  annotationSeverityUpdate,
  reviewCommentCreate,
  reviewCommentDelete,
  reviewCommentGetByAnnotation,
  reviewCommentUpdate,
} from '@/api/reviewApi';
import ReviewCommentsPanel from '@/components/review/ReviewCommentsPanel.vue';
import ReviewCommentsTimeline from '@/components/review/ReviewCommentsTimeline.vue';
import {
  getAnnotationRefnos,
  useToolStore,
  type AnnotationType,
} from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { syncInlineToStore } from '@/review/services/commentThreadDualRead';
import {
  getReviewCommentThreadStore,
  getReviewCommentEventLog,
  isReviewCommentThreadStoreActive,
} from '@/review/services/sharedStores';
import { emitToast } from '@/ribbon/toastBus';
import {
  ANNOTATION_SEVERITY_VALUES,
  canEditAnnotationSeverity,
  compareAnnotationSeverity,
  getAnnotationSeverityDisplay,
  getRoleDisplayName,
  getRoleTheme,
  UserRole,
  type AnnotationComment,
  type AnnotationSeverity,
} from '@/types/auth';

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

/**
 * 列表顶部的"严重度筛选"：
 * - null 表示不过滤
 * - 'unset' 表示仅显示未设置的批注
 * - 其它为具体严重度
 */
const severityFilter = ref<AnnotationSeverity | 'unset' | null>(null);

function bucketSeverity(s: AnnotationSeverity | undefined): AnnotationSeverity | 'unset' {
  return s ?? 'unset';
}

function matchesSeverityFilter<T extends { severity?: AnnotationSeverity }>(a: T): boolean {
  if (severityFilter.value === null) return true;
  return bucketSeverity(a.severity) === severityFilter.value;
}

/**
 * 合并批注，按严重度（含 'unset'）计数，用于顶部概览条。
 *
 * 注意：仅统计面板中实际展示的 3 类（text/cloud/rect）。
 * OBB 在 reviewer 面板里被刻意 deprecate（见 AnnotationPanel.test.ts
 * "reviewer path hides legacy OBB affordances and terminology"），
 * 若计入会造成「全部 (N)」与下方可见列表总条数不一致，产生用户困惑。
 */
const severityCounts = computed(() => {
  const counts: Record<AnnotationSeverity | 'unset', number> = {
    critical: 0,
    severe: 0,
    normal: 0,
    suggestion: 0,
    unset: 0,
  };
  const all = [
    ...store.annotations.value,
    ...store.cloudAnnotations.value,
    ...store.rectAnnotations.value,
  ];
  for (const item of all) {
    const key = bucketSeverity((item as { severity?: AnnotationSeverity }).severity);
    counts[key]++;
  }
  return counts;
});

const totalAnnotations = computed(() => {
  const c = severityCounts.value;
  return c.critical + c.severe + c.normal + c.suggestion + c.unset;
});

function toggleSeverityFilter(next: AnnotationSeverity | 'unset' | null) {
  severityFilter.value = severityFilter.value === next ? null : next;
}

const SEVERITY_FILTER_BUCKETS: {
  key: AnnotationSeverity | 'unset';
  label: string;
  colorClass: string;
  dotClass: string;
}[] = [
  { key: 'critical', label: '致命', colorClass: 'bg-red-100 text-red-700 border-red-200', dotClass: 'bg-red-500' },
  { key: 'severe', label: '严重', colorClass: 'bg-orange-100 text-orange-700 border-orange-200', dotClass: 'bg-orange-500' },
  { key: 'normal', label: '一般', colorClass: 'bg-blue-100 text-blue-700 border-blue-200', dotClass: 'bg-blue-500' },
  { key: 'suggestion', label: '建议', colorClass: 'bg-slate-100 text-slate-600 border-slate-200', dotClass: 'bg-slate-400' },
  { key: 'unset', label: '未设置', colorClass: 'bg-muted text-muted-foreground border-border', dotClass: 'bg-gray-300' },
];

const sortedText = computed(() => {
  return [...store.annotations.value]
    .filter(matchesSeverityFilter)
    .sort((a, b) => {
      const bySeverity = compareAnnotationSeverity(a.severity, b.severity);
      return bySeverity !== 0 ? bySeverity : b.createdAt - a.createdAt;
    });
});

const sortedCloud = computed(() => {
  return [...store.cloudAnnotations.value]
    .filter(matchesSeverityFilter)
    .sort((a, b) => {
      const bySeverity = compareAnnotationSeverity(a.severity, b.severity);
      return bySeverity !== 0 ? bySeverity : b.createdAt - a.createdAt;
    });
});

const sortedRect = computed(() => {
  return [...store.rectAnnotations.value]
    .filter(matchesSeverityFilter)
    .sort((a, b) => {
      const bySeverity = compareAnnotationSeverity(a.severity, b.severity);
      return bySeverity !== 0 ? bySeverity : b.createdAt - a.createdAt;
    });
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

const currentFocusType = computed<AnnotationType | null>(() => {
  switch (store.toolMode.value) {
    case 'annotation':
      return 'text';
    case 'annotation_cloud':
      return 'cloud';
    case 'annotation_rect':
      return 'rect';
    case 'annotation_obb':
      return 'obb';
    default:
      return store.activeAnnotationContext.value?.type ?? null;
  }
});

const currentFocusTypeLabel = computed(() => {
  switch (currentFocusType.value) {
    case 'text':
      return '文字批注';
    case 'cloud':
      return '云线批注';
    case 'rect':
      return '矩形批注';
    case 'obb':
      return '批注';
    default:
      return '未选择';
  }
});

const currentSelectionSummary = computed(() => {
  const active = store.activeAnnotationContext.value;
  if (!active) return '当前未选中批注';
  const record = active.record as any;
  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : active.id;
  return `${currentFocusTypeLabel.value} / ${title}`;
});

const activeTextCollapsed = computed(() => activeText.value?.collapsed === true);

const activeTextCollapseLabel = computed(() => (activeTextCollapsed.value ? '已最小化' : '展开中'));

function isSectionFocused(type: AnnotationType): boolean {
  return currentFocusType.value === type;
}

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

function toggleTextVisible(id: string, current: boolean) {
  store.updateAnnotationVisible(id, !current);
}

function toggleCloudVisible(id: string, current: boolean) {
  store.updateCloudAnnotationVisible(id, !current);
}

function toggleRectVisible(id: string, current: boolean) {
  store.updateRectAnnotationVisible(id, !current);
}

/**
 * 确保批注关联的模型（按 refnos）已加载，再把视角飞过去。
 *
 * Phase 2 统一读取：借助 `getAnnotationRefnos`，text / cloud / rect / obb
 * 都走一样的逻辑，不再按 `refno` / `refnos` 分叉。
 */
function dispatchShowModelByAnnotation(
  record: { refno?: string; refnos?: string[] } | undefined,
): void {
  if (!record) return;
  const refnos = getAnnotationRefnos(record);
  if (refnos.length === 0) return;
  window.dispatchEvent(
    new CustomEvent('showModelByRefnos', {
      detail: { refnos, regenModel: false },
    }),
  );
}

function flyText(id: string) {
  dispatchShowModelByAnnotation(store.annotations.value.find((a) => a.id === id));
  props.tools.flyToAnnotation(id);
}

function flyCloud(id: string) {
  dispatchShowModelByAnnotation(store.cloudAnnotations.value.find((a) => a.id === id));
  props.tools.flyToCloudAnnotation?.(id);
}

function flyRect(id: string) {
  props.tools.flyToRectAnnotation?.(id);
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
    return;
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
    return;
  }
}

function toggleActiveTextCollapsed() {
  if (!activeText.value) return;
  store.updateAnnotation(activeText.value.id, { collapsed: !activeTextCollapsed.value });
}

// ==================== 严重度 ====================

const SEVERITY_OPTIONS: { value: AnnotationSeverity | ''; label: string }[] = [
  { value: '', label: '未设置' },
  ...ANNOTATION_SEVERITY_VALUES.map((v) => ({ value: v, label: getAnnotationSeverityDisplay(v).label })),
];

/** 当前选中批注是否允许当前用户编辑严重度（作者或审核侧） */
const canEditActiveSeverity = computed<boolean>(() => {
  const rec = activeAny.value as { authorId?: string } | null;
  return canEditAnnotationSeverity(userStore.currentUser.value, rec?.authorId);
});

function applyLocalSeverity(type: AnnotationType, id: string, severity: AnnotationSeverity | undefined) {
  store.updateAnnotationSeverity(type, id, severity);
}

async function handleChangeSeverity(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  if (!target) return;
  const active = store.activeAnnotationContext.value;
  if (!active) return;
  if (!canEditActiveSeverity.value) return;

  const raw = target.value;
  const next: AnnotationSeverity | undefined = raw === '' ? undefined : (raw as AnnotationSeverity);
  const prev = (active.record as { severity?: AnnotationSeverity }).severity;

  applyLocalSeverity(active.type, active.id, next);

  try {
    const resp = await annotationSeverityUpdate(active.id, active.type, next ?? null);
    if (resp && resp.success === false) {
      applyLocalSeverity(active.type, active.id, prev);
      target.value = prev ?? '';
       
      console.warn('[annotation] 严重度同步后端被拒绝，已回滚：', resp.error_message);
    }
  } catch (err) {
    // 后端接口不可用/网络异常时保留本地（与现有评论流程一致），避免用户输入丢失
     
    console.warn('[annotation] 严重度接口暂不可用，保留本地：', err);
  }
}

// 文字批注创建后弹窗编辑
const showTextEditDialog = ref(false);
const pendingTextTitle = ref('');
const pendingTextDescription = ref('');
// 获取待编辑文字批注的关联 refno（Phase 2：通过 `getAnnotationRefnos` 统一读取）
const pendingAnnotationRefno = computed(() => {
  const id = store.pendingTextAnnotationEditId.value;
  if (!id) return null;
  const rec = store.annotations.value.find((a) => a.id === id);
  if (!rec) return null;
  return getAnnotationRefnos(rec)[0] ?? null;
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
}, { immediate: true });

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

// ==================== 评论/意见管理 ====================

const newCommentContent = ref('');
const replyToCommentId = ref<string | null>(null);
const editingCommentId = ref<string | null>(null);
const editingCommentContent = ref('');

// 意见视图模式：timeline = 时间线, columns = 三栏视图, list = 列表视图
const commentsViewMode = ref<'timeline' | 'list' | 'columns'>('timeline');

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

function getRoleInlineStyle(role: UserRole): Record<string, string> {
  const theme = getRoleTheme(role);
  return {
    backgroundColor: theme.bgColor,
    color: theme.textColor,
    borderColor: theme.columnBorder,
  };
}

/**
 * DUAL_READ 同步：每次 inline 评论变更后，如果 thread store 已激活，
 * 把 inline 数据推入 store 并记录差异日志。
 */
function dualReadSync(annType: AnnotationType, annId: string) {
  if (!isReviewCommentThreadStoreActive()) return;
  const inline = store.getAnnotationComments(annType, annId);
  syncInlineToStore(annType, annId, inline, {
    store: getReviewCommentThreadStore(),
    log: getReviewCommentEventLog(),
  });
}

async function loadCommentsForListView() {
  if (commentsViewMode.value !== 'list') return;
  if (!activeAny.value || !activeAnnotationType.value) return;
  const annType = activeAnnotationType.value;
  const annId = activeAny.value.id;
  try {
    const resp = await reviewCommentGetByAnnotation(annId, annType);
    if (resp.success && resp.comments) {
      const normalized = [...resp.comments].sort((a, b) => a.createdAt - b.createdAt);
      store.setAnnotationComments(annType, annId, normalized);
      dualReadSync(annType, annId);
    }
  } catch {
    // 列表模式拉取失败时保留本地缓存
  }
}

watch(
  () => [commentsViewMode.value, activeAnnotationType.value, activeAny.value?.id],
  () => {
    void loadCommentsForListView();
  },
  { immediate: true }
);

// 添加评论
async function addComment() {
  if (!newCommentContent.value.trim()) return;
  if (!activeAny.value || !activeAnnotationType.value) return;

  const user = userStore.currentUser.value;
  if (!user) return;

  const content = newCommentContent.value.trim();
  const replyToId = replyToCommentId.value || undefined;

  const annType = activeAnnotationType.value;
  const annId = activeAny.value.id;

  try {
    const resp = await reviewCommentCreate({
      annotationId: annId,
      annotationType: annType,
      authorId: user.id,
      authorName: user.name,
      authorRole: user.role,
      content,
      replyToId,
    });
    if (resp.success && resp.comment) {
      store.addCommentToAnnotation(annType, annId, resp.comment);
      dualReadSync(annType, annId);
    } else {
      emitToast({ message: resp.error_message || '评论发送失败，请重试', level: 'warning' });
      return;
    }
  } catch {
    emitToast({ message: '网络异常，评论发送失败', level: 'error' });
    return;
  }

  newCommentContent.value = '';
  replyToCommentId.value = null;
}

// 开始编辑评论
function startEditComment(comment: AnnotationComment) {
  editingCommentId.value = comment.id;
  editingCommentContent.value = comment.content;
}

async function saveEditComment() {
  if (!editingCommentId.value || !editingCommentContent.value.trim()) return;
  if (!activeAny.value || !activeAnnotationType.value) return;

  const content = editingCommentContent.value.trim();
  const commentId = editingCommentId.value;
  const annType = activeAnnotationType.value;
  const annId = activeAny.value.id;
  const prevContent = activeComments.value.find(c => c.id === commentId)?.content;

  store.updateAnnotationComment(annType, annId, commentId, { content });

  try {
    const resp = await reviewCommentUpdate(commentId, content);
    if (resp && resp.success === false) {
      store.updateAnnotationComment(annType, annId, commentId, { content: prevContent });
      emitToast({ message: resp.error_message || '评论更新被拒绝，已回滚', level: 'warning' });
    }
  } catch {
    // 网络异常保留本地（与严重度策略一致）
  }

  dualReadSync(annType, annId);
  editingCommentId.value = null;
  editingCommentContent.value = '';
}

// 取消编辑
function cancelEditComment() {
  editingCommentId.value = null;
  editingCommentContent.value = '';
}

async function deleteComment(commentId: string) {
  if (!activeAny.value || !activeAnnotationType.value) return;

  const annType = activeAnnotationType.value;
  const annId = activeAny.value.id;

  try {
    await reviewCommentDelete(commentId);
  } catch {
    // 后端失败降级本地
  }

  store.removeAnnotationComment(annType, annId, commentId);
  dualReadSync(annType, annId);
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
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        文字/云线/矩形：点击模型表面创建 reviewer 可见批注。
      </div>

      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        <div class="rounded-md border border-border bg-muted/40 px-3 py-2">
          <div class="text-[11px] text-muted-foreground">当前类型</div>
          <div data-testid="annotation-panel-current-type-label" class="mt-1 text-sm font-medium text-foreground">
            {{ currentFocusTypeLabel }}
          </div>
        </div>
        <div class="rounded-md border border-border bg-muted/40 px-3 py-2">
          <div class="text-[11px] text-muted-foreground">当前选中</div>
          <div data-testid="annotation-panel-current-selection-label" class="mt-1 truncate text-sm font-medium text-foreground">
            {{ currentSelectionSummary }}
          </div>
        </div>
      </div>

      <!-- 严重度概览与筛选 -->
      <div data-testid="annotation-panel-severity-overview" class="mt-3">
        <div class="flex items-center justify-between">
          <div class="text-[11px] text-muted-foreground">按严重度筛选（点击切换）</div>
          <button type="button"
            data-testid="annotation-panel-severity-filter-clear"
            class="h-6 rounded border px-2 text-[11px] transition-colors"
            :class="severityFilter === null ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background text-muted-foreground hover:bg-muted'"
            @click="severityFilter = null">
            全部 ({{ totalAnnotations }})
          </button>
        </div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <button v-for="bucket in SEVERITY_FILTER_BUCKETS"
            :key="bucket.key"
            type="button"
            :data-testid="'annotation-panel-severity-filter-' + bucket.key"
            class="inline-flex items-center gap-1.5 h-6 rounded border px-2 text-[11px] transition-opacity"
            :class="[
              bucket.colorClass,
              severityFilter === bucket.key ? 'ring-2 ring-primary/40' : '',
              severityCounts[bucket.key] === 0 ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80',
            ]"
            :disabled="severityCounts[bucket.key] === 0"
            @click="toggleSeverityFilter(bucket.key)">
            <span class="inline-block h-1.5 w-1.5 rounded-full" :class="bucket.dotClass" />
            {{ bucket.label }}
            <span class="ml-0.5 font-semibold">{{ severityCounts[bucket.key] }}</span>
          </button>
        </div>
      </div>
    </div>

    <div data-testid="annotation-panel-section-text"
      class="rounded-md border border-border bg-background p-3 transition-colors"
      :data-active="isSectionFocused('text') ? 'true' : 'false'"
      :class="isSectionFocused('text') ? 'border-ring bg-muted/20' : ''">
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
                <span v-if="a.severity" class="ml-1 inline-block rounded border px-1 py-0.5 text-[10px]"
                  :class="getAnnotationSeverityDisplay(a.severity).color"
                  :title="'严重度：' + getAnnotationSeverityDisplay(a.severity).label">
                  {{ getAnnotationSeverityDisplay(a.severity).label }}
                </span>
                <span v-if="a.collapsed" class="ml-1 inline-block rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  已最小化
                </span>
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

    <div data-testid="annotation-panel-section-cloud"
      class="rounded-md border border-border bg-background p-3 transition-colors"
      :data-active="isSectionFocused('cloud') ? 'true' : 'false'"
      :class="isSectionFocused('cloud') ? 'border-ring bg-muted/20' : ''">
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
                <span v-if="a.severity" class="ml-1 inline-block rounded border px-1 py-0.5 text-[10px]"
                  :class="getAnnotationSeverityDisplay(a.severity).color"
                  :title="'严重度：' + getAnnotationSeverityDisplay(a.severity).label">
                  {{ getAnnotationSeverityDisplay(a.severity).label }}
                </span>
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

    <div data-testid="annotation-panel-section-rect"
      class="rounded-md border border-border bg-background p-3 transition-colors"
      :data-active="isSectionFocused('rect') ? 'true' : 'false'"
      :class="isSectionFocused('rect') ? 'border-ring bg-muted/20' : ''">
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
                <span v-if="a.severity" class="ml-1 inline-block rounded border px-1 py-0.5 text-[10px]"
                  :class="getAnnotationSeverityDisplay(a.severity).color"
                  :title="'严重度：' + getAnnotationSeverityDisplay(a.severity).label">
                  {{ getAnnotationSeverityDisplay(a.severity).label }}
                </span>
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
      <div class="text-sm font-semibold">编辑</div>

      <div v-if="!activeAny" class="mt-2 text-sm text-muted-foreground">
        选择一个批注后可编辑标题与描述。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <template v-if="activeText">
          <div class="rounded-md border border-border bg-muted/40 px-3 py-2">
            <div class="text-[11px] text-muted-foreground">显示状态</div>
            <div class="mt-1 flex items-center justify-between gap-3">
              <div data-testid="annotation-panel-text-collapse-state" class="text-sm font-medium text-foreground">
                {{ activeTextCollapseLabel }}
              </div>
              <button data-testid="annotation-panel-text-collapse-toggle"
                type="button"
                class="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted"
                @click="toggleActiveTextCollapsed">
                {{ activeTextCollapsed ? '恢复展开' : '最小化' }}
              </button>
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              最小化后，视图中的文字面板会收成锚点处的水滴图钉。
            </div>
          </div>
        </template>

        <label class="text-xs text-muted-foreground">标题</label>
        <input class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          :value="activeAny.title"
          @input="updateTitle(($event.target as HTMLInputElement).value)" />

        <label class="text-xs text-muted-foreground">描述</label>
        <textarea class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          :value="activeAny.description"
          @input="updateDescription(($event.target as HTMLTextAreaElement).value)" />

        <label class="mt-1 text-xs text-muted-foreground">
          严重程度
          <span v-if="!canEditActiveSeverity" class="ml-1 text-[10px] text-muted-foreground">（仅批注作者或校对/审核可修改）</span>
        </label>
        <div class="flex items-center gap-2">
          <select data-testid="annotation-panel-severity-select"
            class="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            :value="(activeAny as any).severity || ''"
            :disabled="!canEditActiveSeverity"
            @change="handleChangeSeverity">
            <option v-for="opt in SEVERITY_OPTIONS" :key="opt.value || 'none'" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <span v-if="(activeAny as any).severity"
            class="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
            :class="getAnnotationSeverityDisplay((activeAny as any).severity).color">
            <span class="inline-block h-1.5 w-1.5 rounded-full"
              :class="getAnnotationSeverityDisplay((activeAny as any).severity).dot" />
            {{ getAnnotationSeverityDisplay((activeAny as any).severity).label }}
          </span>
        </div>

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
        <div class="flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-[#F3F4F6] p-1">
          <button type="button"
            class="flex h-6 w-6 items-center justify-center rounded-md transition-colors"
            :class="commentsViewMode === 'timeline' ? 'bg-[#FF6B00] text-white shadow-sm' : 'text-[#6B7280] hover:bg-white'"
            title="时间线视图"
            @click="commentsViewMode = 'timeline'">
            <MessageSquareMore class="h-3.5 w-3.5" />
          </button>
          <button type="button"
            class="flex h-6 w-6 items-center justify-center rounded-md transition-colors"
            :class="commentsViewMode === 'columns' ? 'bg-[#FF6B00] text-white shadow-sm' : 'text-[#6B7280] hover:bg-white'"
            title="三栏视图"
            @click="commentsViewMode = 'columns'">
            <LayoutGrid class="h-3.5 w-3.5" />
          </button>
          <button type="button"
            class="flex h-6 w-6 items-center justify-center rounded-md transition-colors"
            :class="commentsViewMode === 'list' ? 'bg-[#FF6B00] text-white shadow-sm' : 'text-[#6B7280] hover:bg-white'"
            title="列表视图"
            @click="commentsViewMode = 'list'">
            <List class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div v-if="!activeAny" class="mt-2 text-sm text-muted-foreground">
        选择一个批注后可查看和添加意见。
      </div>

      <!-- 时间线视图 -->
      <div v-else-if="commentsViewMode === 'timeline'" class="mt-3">
        <ReviewCommentsTimeline :annotation-type="activeAnnotationType"
          :annotation-id="activeAny?.id || null"
          :annotation-label="activeAny ? currentSelectionSummary : undefined" />
      </div>

      <!-- 三栏视图 -->
      <div v-else-if="commentsViewMode === 'columns'" class="mt-3">
        <ReviewCommentsPanel :annotation-type="activeAnnotationType"
          :annotation-id="activeAny?.id || null" />
      </div>

      <!-- 列表视图 (原有逻辑) -->
      <div v-else class="mt-2 flex flex-col gap-3">
        <!-- 按角色分组显示评论 -->
        <template v-if="Object.keys(commentsByRole).length > 0">
          <div v-for="(comments, role) in commentsByRole" :key="role" class="rounded-md border p-2"
            :style="getRoleInlineStyle(role as UserRole)">
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
              :style="getRoleInlineStyle(userStore.currentUser.value.role)">
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
