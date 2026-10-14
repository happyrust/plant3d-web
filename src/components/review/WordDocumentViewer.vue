<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

import { ViewerClient, ViewerError } from '@zrimo/viewer';

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
  });
  if (seq !== mountSeq) {
    await nextViewer.destroy().catch(() => undefined);
    await nextClient.destroy().catch(() => undefined);
    return;
  }
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
  <div class="flex h-full min-h-0 flex-col" role="document" :aria-label="label" data-testid="review-attachment-word">
    <div ref="hostEl" class="min-h-0 flex-1" data-testid="zrimo-word-preview" />
  </div>
</template>
