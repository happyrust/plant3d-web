<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

import { ViewerClient, ViewerError, type ViewerTranslations } from '@zrimo/viewer';

import '@zrimo/viewer/styles.css';

const props = defineProps<{
  bytes: ArrayBuffer;
  fileName: string;
  label?: string;
}>();

const emit = defineEmits<{
  error: [message: string];
}>();

const hostEl = ref<HTMLElement | null>(null);

const ZH_CN_VIEWER_TRANSLATIONS: Partial<ViewerTranslations> = Object.freeze({
  previous: '上一页',
  next: '下一页',
  page: '页码',
  of: '/',
  zoomIn: '放大',
  zoomOut: '缩小',
  fitWidth: '适应宽度',
  fitPage: '适应整页',
  search: '搜索文档',
  searchPlaceholder: '搜索文档内容…',
  matches: '处匹配',
  thumbnails: '页面缩略图',
  fullscreen: '全屏查看',
  exitFullscreen: '退出全屏',
  download: '下载原文件',
  sheets: '工作表',
  selectedRange: '选中区域',
  loading: '加载中…',
  close: '关闭',
  noMatches: '无匹配结果',
});

let client: ViewerClient | null = null;
let viewer: ReturnType<ViewerClient['createViewer']> | null = null;
let mountSeq = 0;

function messageOf(error: unknown): string {
  if (error instanceof ViewerError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}

async function destroyViewer(): Promise<void> {
  const currentViewer = viewer;
  const currentClient = client;
  viewer = null;
  client = null;
  await currentViewer?.destroy().catch(() => undefined);
  await currentClient?.destroy().catch(() => undefined);
}

async function openDocument(bytes: ArrayBuffer, fileName: string): Promise<void> {
  const seq = ++mountSeq;
  await destroyViewer();
  if (seq !== mountSeq || !hostEl.value) return;
  const nextClient = ViewerClient.create({
    assetBaseUrl: new URL('/vendor/zrimo/', window.location.href),
    limits: { maxInputBytes: 50 * 1024 * 1024 },
  });
  const nextViewer = nextClient.createViewer({
    container: hostEl.value,
    ui: true,
    fit: 'width',
    translations: ZH_CN_VIEWER_TRANSLATIONS,
  });
  if (seq !== mountSeq) {
    await nextViewer.destroy().catch(() => undefined);
    await nextClient.destroy().catch(() => undefined);
    return;
  }
  const uiRoot = hostEl.value.querySelector<HTMLElement>('[data-zrimo-ui="root"]');
  if (uiRoot) uiRoot.lang = 'zh-CN';
  client = nextClient;
  viewer = nextViewer;
  try {
    await nextViewer.load(bytes.slice(0), { fileName });
  } catch (error) {
    if (seq === mountSeq) emit('error', `文档打开失败：${messageOf(error)}`);
  }
}

watch(
  () => props.bytes,
  (bytes) => { void openDocument(bytes, props.fileName); },
  { immediate: true, flush: 'post' },
);

onBeforeUnmount(() => {
  mountSeq += 1;
  void destroyViewer();
});
</script>

<template>
  <div class="word-document-viewer flex h-full min-h-0 flex-col" role="document" :aria-label="label" data-testid="review-attachment-word">
    <div ref="hostEl" class="min-h-0 flex-1" data-testid="zrimo-word-preview" />
  </div>
</template>

<style scoped>
/* 外层 ReviewAttachmentPreviewPanelDock Header 已提供统一的下载按钮，隐藏内部重复的下载按钮 */
.word-document-viewer :deep(.zrimo-ui__button[data-action="download"]) {
  display: none;
}
</style>