<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  ChevronDown,
  DraftingCompass,
  Download,
  Eye,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Trash2,
} from 'lucide-vue-next';

import { formatAttachmentSize } from './reviewAttachmentFlow';

import type { ReviewAttachment } from '@/types/auth';

import {
  activeReviewAttachmentPreview,
  buildReviewAttachmentDownloadUrl,
  getReviewAttachmentPreviewKind,
} from '@/composables/useReviewAttachmentPreview';

const props = withDefaults(defineProps<{
  attachments?: ReviewAttachment[];
  /** 区块标题；默认保持原“关联校验文件”场景 */
  title?: string;
  /** 标题下描述文案；传空字符串隐藏 */
  description?: string;
  /** 空状态文案 */
  emptyText?: string;
  /** 空状态补充说明；传空字符串隐藏 */
  emptyHint?: string;
  /** 是否提供“查看”入口（仅 PDF/图片显示；Office/CAD 只显示“下载查看”） */
  previewable?: boolean;
  /** 是否可编辑（显示删除按钮） */
  editable?: boolean;
}>(), {
  attachments: () => [],
  title: '关联校验文件',
  description: '以下文件根据当前选择的模型构件自动关联',
  emptyText: '暂无关联文件',
  emptyHint: '支持 PDF、图片、CAD 图纸、表格与文档；其中 PDF 与图片可直接在「文档预览」面板中打开。',
  previewable: false,
  editable: false,
});

const emit = defineEmits<{
  (e: 'preview', attachment: ReviewAttachment): void;
  (e: 'download', attachment: ReviewAttachment): void;
  (e: 'delete', attachment: ReviewAttachment): void;
}>();

type FileGroup = {
  label: string;
  items: ReviewAttachment[];
};

// 记录被用户手动收起的分组；默认全部展开，保证操作按钮直接可见
const collapsedGroups = ref<Set<string>>(new Set());

/** 固定分组顺序：新增一个附件不应该让整张列表重排 */
const GROUP_ORDER = ['PDF 文件', '图片文件', 'CAD 图纸', '表格文件', '文档文件', '其他文件'] as const;

function resolveGroupLabel(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'PDF 文件';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return '图片文件';
  if (ext === 'dwg' || ext === 'dxf') return 'CAD 图纸';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return '表格文件';
  if (ext === 'doc' || ext === 'docx') return '文档文件';
  return '其他文件';
}

const groups = computed<FileGroup[]>(() => {
  if (props.attachments.length === 0) return [];

  const byType = new Map<string, ReviewAttachment[]>();
  for (const att of props.attachments) {
    const label = resolveGroupLabel(att.name);
    if (!byType.has(label)) byType.set(label, []);
    byType.get(label)!.push(att);
  }

  return GROUP_ORDER
    .filter((label) => byType.has(label))
    .map((label) => ({ label, items: byType.get(label)! }));
});

function toggleGroup(label: string) {
  if (collapsedGroups.value.has(label)) {
    collapsedGroups.value.delete(label);
  } else {
    collapsedGroups.value.add(label);
  }
  collapsedGroups.value = new Set(collapsedGroups.value);
}

function isGroupExpanded(label: string): boolean {
  return !collapsedGroups.value.has(label);
}

function canPreview(attachment: ReviewAttachment): boolean {
  return props.previewable && getReviewAttachmentPreviewKind(attachment) !== null;
}

/** 当前正在「文档预览」面板中打开的那一条，列表里要看得出来 */
function isPreviewing(attachment: ReviewAttachment): boolean {
  return props.previewable && activeReviewAttachmentPreview.value?.attachment.id === attachment.id;
}

function handlePreview(attachment: ReviewAttachment) {
  emit('preview', attachment);
}

function handleDelete(attachment: ReviewAttachment) {
  emit('delete', attachment);
}

function downloadFile(attachment: ReviewAttachment) {
  emit('download', attachment);
  const href = buildReviewAttachmentDownloadUrl(attachment);
  if (!href) return;

  const link = document.createElement('a');
  link.href = href;
  link.download = attachment.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function formatUploadTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf' || ext === 'doc' || ext === 'docx') return FileText;
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return FileImage;
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return FileSpreadsheet;
  if (ext === 'dwg' || ext === 'dxf') return DraftingCompass;
  return File;
}

function getTypeLabel(attachment: ReviewAttachment): string {
  const ext = attachment.name.split('.').pop()?.toUpperCase();
  return ext || (attachment.mimeType || attachment.type || '文件');
}
</script>

<template>
  <div class="rounded-xl border border-border bg-card p-4"
    data-testid="associated-files-list">
    <!-- Header -->
    <div class="mb-2">
      <h3 class="flex items-center gap-2 text-sm font-semibold text-foreground">
        {{ title }}
        <span class="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground"
          data-testid="associated-files-count">
          {{ attachments.length }}
        </span>
      </h3>
      <p v-if="description" class="mt-1 text-xs leading-relaxed text-muted-foreground">{{ description }}</p>
    </div>

    <!-- Empty state -->
    <div v-if="attachments.length === 0"
      class="flex flex-col items-center gap-2 px-4 py-8 text-center"
      data-testid="associated-files-empty">
      <FolderOpen class="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
      <p class="text-sm text-muted-foreground">{{ emptyText }}</p>
      <p v-if="emptyHint" class="max-w-[42ch] text-xs leading-relaxed text-muted-foreground">
        {{ emptyHint }}
      </p>
    </div>

    <!-- File groups：分组之间用发丝线分隔，不再套第二层卡片 -->
    <div v-else>
      <section v-for="group in groups" :key="group.label"
        class="border-t border-border first:border-t-0">
        <h4>
          <button type="button"
            class="flex w-full items-center gap-2 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            :aria-expanded="isGroupExpanded(group.label)"
            @click="toggleGroup(group.label)">
            <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none"
              :class="{ '-rotate-90': !isGroupExpanded(group.label) }"
              aria-hidden="true" />
            <span class="text-xs font-medium text-foreground">{{ group.label }}</span>
            <span class="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              {{ group.items.length }}
            </span>
          </button>
        </h4>

        <ul v-show="isGroupExpanded(group.label)" class="pb-1.5">
          <li v-for="item in group.items" :key="item.id"
            class="flex items-center gap-2.5 rounded-md px-1.5 py-2 transition-colors"
            :class="isPreviewing(item) ? 'bg-brand-subtle' : 'hover:bg-muted'">
            <component :is="getFileIcon(item.name)"
              class="h-4 w-4 shrink-0"
              :class="isPreviewing(item) ? 'text-brand' : 'text-muted-foreground'"
              aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm text-foreground" :title="item.name">{{ item.name }}</div>
              <div class="mt-0.5 truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                {{ getTypeLabel(item) }} · {{ formatAttachmentSize(item.size) }}<template v-if="formatUploadTime(item.uploadedAt)"> · {{ formatUploadTime(item.uploadedAt) }}</template>
              </div>
            </div>

            <!-- 查看：仅 PDF / 图片；正在预览的那条填充为实心，标出面板里放的是谁 -->
            <button v-if="canPreview(item)"
              type="button"
              :data-testid="`review-attachment-preview-${item.id}`"
              class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              :class="isPreviewing(item)
                ? 'bg-brand text-brand-foreground'
                : 'text-brand hover:bg-brand-subtle'"
              :aria-pressed="isPreviewing(item)"
              @click="handlePreview(item)">
              <Eye class="h-3.5 w-3.5" aria-hidden="true" />
              {{ isPreviewing(item) ? '预览中' : '查看' }}
            </button>

            <!-- 下载：不可预览的格式明确提示“下载查看”，并接过主操作的份量 -->
            <button type="button"
              :data-testid="`review-attachment-download-${item.id}`"
              class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              :class="canPreview(item) ? 'text-muted-foreground hover:text-foreground' : 'text-foreground'"
              :title="canPreview(item) ? '下载' : '该格式不支持在线预览，请下载后查看'"
              @click="downloadFile(item)">
              <Download class="h-3.5 w-3.5" aria-hidden="true" />
              {{ previewable && !canPreview(item) ? '下载查看' : '下载' }}
            </button>

            <!-- 删除：破坏性操作，静默待命，悬停/聚焦时才转成危险色 -->
            <button v-if="editable"
              type="button"
              :data-testid="`review-attachment-delete-${item.id}`"
              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
              :title="`删除「${item.name}」`"
              :aria-label="`删除附件 ${item.name}`"
              @click="handleDelete(item)">
              <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
