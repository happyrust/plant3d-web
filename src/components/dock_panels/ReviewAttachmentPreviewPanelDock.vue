<script setup lang="ts">
import { watch } from 'vue';

import { Download, ExternalLink, FileSearch, Loader2, RefreshCw } from 'lucide-vue-next';

import { formatAttachmentSize } from '@/components/review/reviewAttachmentFlow';
import {
  activeReviewAttachmentPreview,
  buildReviewAttachmentDownloadUrl,
  buildReviewAttachmentInlineUrl,
  clearReviewAttachmentPreview,
  markReviewAttachmentPreviewFailed,
  retryReviewAttachmentPreview,
  reviewAttachmentPreviewError,
  reviewAttachmentPreviewStatus,
} from '@/composables/useReviewAttachmentPreview';
import { useReviewStore } from '@/composables/useReviewStore';

const reviewStore = useReviewStore();

watch(
  () => reviewStore.currentTask.value?.id,
  taskId => {
    const preview = activeReviewAttachmentPreview.value;
    if (preview && preview.taskId !== taskId) clearReviewAttachmentPreview();
  },
  { immediate: true },
);

function downloadAttachment(): void {
  const preview = activeReviewAttachmentPreview.value;
  if (!preview) return;
  const link = document.createElement('a');
  link.href = buildReviewAttachmentDownloadUrl({
    name: preview.attachment.name,
    url: preview.url,
  });
  link.download = preview.attachment.name;
  link.click();
}

function openInNewWindow(): void {
  const preview = activeReviewAttachmentPreview.value;
  if (!preview) return;
  const href = buildReviewAttachmentInlineUrl({
    name: preview.attachment.name,
    url: preview.url,
  });
  window.open(href, '_blank', 'noopener,noreferrer');
}

function handleImageError(): void {
  markReviewAttachmentPreviewFailed('图片无法在页面内显示');
}

/** 头部副标题：类型 + 体积，让预览面板自己交代打开的是什么 */
function describeAttachment(): string {
  const preview = activeReviewAttachmentPreview.value;
  if (!preview) return '';
  const extension = preview.attachment.name.split('.').pop()?.toUpperCase();
  return [extension, formatAttachmentSize(preview.attachment.size)]
    .filter(Boolean)
    .join(' · ');
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100">
    <header v-if="activeReviewAttachmentPreview"
      class="flex shrink-0 items-center gap-2.5 border-b border-slate-800 px-3 py-2">
      <FileSearch class="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm leading-tight" :title="activeReviewAttachmentPreview.attachment.name">
          {{ activeReviewAttachmentPreview.attachment.name }}
        </div>
        <div v-if="describeAttachment()"
          class="truncate font-mono text-[11px] leading-tight tabular-nums text-slate-400">
          {{ describeAttachment() }}
        </div>
      </div>
      <span v-if="reviewAttachmentPreviewStatus === 'loading'"
        class="flex shrink-0 items-center gap-1 text-xs text-slate-300"
        data-testid="review-attachment-preview-loading">
        <Loader2 class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        校验中
      </span>
      <button type="button"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
        aria-label="下载附件"
        title="下载"
        @click="downloadAttachment">
        <Download class="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
        aria-label="在新窗口打开附件"
        title="在新窗口打开"
        @click="openInNewWindow">
        <ExternalLink class="h-4 w-4" aria-hidden="true" />
      </button>
    </header>

    <div class="min-h-0 flex-1">
      <!-- 加载失败：保留预览面板，提供重试 / 下载 / 新窗口打开降级操作 -->
      <div v-if="activeReviewAttachmentPreview && reviewAttachmentPreviewStatus === 'error'"
        class="flex h-full flex-col items-center justify-center gap-4 p-6 text-center"
        role="alert"
        data-testid="review-attachment-preview-error">
        <div class="space-y-1.5">
          <p class="max-w-sm text-sm text-slate-100">
            {{ reviewAttachmentPreviewError || '附件加载失败' }}
          </p>
          <p class="max-w-sm text-xs leading-relaxed text-slate-400">
            文件可能已被删除或移动。可以重试一次，或改用下载 / 新窗口打开。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-xs font-medium text-white transition-colors hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
            data-testid="review-attachment-preview-retry"
            @click="retryReviewAttachmentPreview">
            <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
            重试
          </button>
          <button type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 px-3 text-xs text-slate-200 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
            data-testid="review-attachment-preview-download"
            @click="downloadAttachment">
            <Download class="h-3.5 w-3.5" aria-hidden="true" />
            下载
          </button>
          <button type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 px-3 text-xs text-slate-200 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
            data-testid="review-attachment-preview-open-window"
            @click="openInNewWindow">
            <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            新窗口打开
          </button>
        </div>
      </div>
      <!-- PDF / 图片内容与 URL 校验并行加载 -->
      <div v-else-if="activeReviewAttachmentPreview?.kind === 'pdf'"
        class="flex h-full min-h-0 flex-col">
        <iframe data-testid="review-attachment-pdf"
          :src="activeReviewAttachmentPreview.url"
          :title="activeReviewAttachmentPreview.attachment.name"
          class="min-h-0 flex-1 border-0 bg-white" />
        <p class="shrink-0 border-t border-slate-800 px-3 py-1.5 text-[11px] text-slate-400">
          若浏览器无法内嵌此 PDF，请在新窗口打开或下载后查看。
        </p>
      </div>
      <div v-else-if="activeReviewAttachmentPreview?.kind === 'image'"
        class="flex h-full items-center justify-center overflow-auto bg-slate-900 p-4">
        <img data-testid="review-attachment-image"
          :src="activeReviewAttachmentPreview.url"
          :alt="activeReviewAttachmentPreview.attachment.name"
          class="max-h-full max-w-full rounded-md object-contain shadow-lg shadow-black/40"
          @error="handleImageError" />
      </div>
      <div v-else
        class="flex h-full flex-col items-center justify-center gap-2.5 p-6 text-center">
        <FileSearch class="h-7 w-7 text-slate-600" aria-hidden="true" />
        <p class="text-sm text-slate-300">请从校审附件列表中选择文档</p>
        <p class="max-w-[36ch] text-xs leading-relaxed text-slate-400">
          在附件材料里点「查看」，PDF 与图片会直接在这里打开，模型和资料可以并排看。
          CAD 图纸、表格与 Office 文档需下载后查看。
        </p>
      </div>
    </div>
  </section>
</template>
