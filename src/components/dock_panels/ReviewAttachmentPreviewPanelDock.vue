<script setup lang="ts">
import { ref, watch } from 'vue';

import { Download, ExternalLink, FileSearch } from 'lucide-vue-next';

import {
  activeReviewAttachmentPreview,
  clearReviewAttachmentPreview,
} from '@/composables/useReviewAttachmentPreview';
import { useReviewStore } from '@/composables/useReviewStore';

const reviewStore = useReviewStore();
const imageFailed = ref(false);

watch(
  () => reviewStore.currentTask.value?.id,
  taskId => {
    const preview = activeReviewAttachmentPreview.value;
    if (preview && preview.taskId !== taskId) clearReviewAttachmentPreview();
  },
  { immediate: true },
);

watch(activeReviewAttachmentPreview, () => {
  imageFailed.value = false;
});

function downloadAttachment(): void {
  const preview = activeReviewAttachmentPreview.value;
  if (!preview) return;
  const link = document.createElement('a');
  link.href = preview.url;
  link.download = preview.attachment.name;
  link.click();
}

function openInNewWindow(): void {
  const preview = activeReviewAttachmentPreview.value;
  if (preview) window.open(preview.url, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100">
    <header v-if="activeReviewAttachmentPreview"
      class="flex shrink-0 items-center gap-2 border-b border-slate-800 px-3 py-2">
      <FileSearch class="h-4 w-4 shrink-0 text-sky-400" />
      <span class="min-w-0 flex-1 truncate text-sm" :title="activeReviewAttachmentPreview.attachment.name">
        {{ activeReviewAttachmentPreview.attachment.name }}
      </span>
      <button type="button"
        class="rounded p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
        aria-label="下载附件"
        title="下载"
        @click="downloadAttachment">
        <Download class="h-4 w-4" />
      </button>
      <button type="button"
        class="rounded p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
        aria-label="在新窗口打开附件"
        title="在新窗口打开"
        @click="openInNewWindow">
        <ExternalLink class="h-4 w-4" />
      </button>
    </header>

    <div class="min-h-0 flex-1">
      <div v-if="activeReviewAttachmentPreview?.kind === 'pdf'"
        class="flex h-full min-h-0 flex-col">
        <iframe data-testid="review-attachment-pdf"
          :src="activeReviewAttachmentPreview.url"
          :title="activeReviewAttachmentPreview.attachment.name"
          class="min-h-0 flex-1 border-0 bg-white" />
        <p class="shrink-0 border-t border-slate-800 px-3 py-1.5 text-xs text-slate-400">
          若浏览器无法内嵌此 PDF，请在新窗口打开或下载后查看。
        </p>
      </div>
      <div v-else-if="activeReviewAttachmentPreview?.kind === 'image'"
        class="flex h-full items-center justify-center overflow-auto bg-slate-900 p-4">
        <img v-if="!imageFailed"
          data-testid="review-attachment-image"
          :src="activeReviewAttachmentPreview.url"
          :alt="activeReviewAttachmentPreview.attachment.name"
          class="max-h-full max-w-full object-contain"
          @error="imageFailed = true" />
        <p v-else class="max-w-sm text-center text-sm text-slate-400">
          图片无法在页面内显示，请在新窗口打开或下载后查看。
        </p>
      </div>
      <div v-else
        class="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">
        请从校审附件列表中选择文档
      </div>
    </div>
  </section>
</template>
