<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { MoveHorizontal, ZoomIn, ZoomOut } from 'lucide-vue-next';

import type { Editor, IElement } from '@hufe921/canvas-editor';

import { WORD_PREVIEW_PAGE } from '@/utils/wordPreview';

const props = defineProps<{
  elements: IElement[];
  label?: string;
}>();

const emit = defineEmits<{
  error: [message: string];
}>();

const MIN_SCALE = 0.3;
const MAX_SCALE = 2;
const SCALE_STEP = 0.1;
const PAGE_GAP = 16;

const scrollEl = ref<HTMLDivElement | null>(null);
const hostEl = ref<HTMLDivElement | null>(null);
const pageCount = ref(0);
const pageNo = ref(1);
const scale = ref(1);
const fitWidth = ref(true);

let editor: Editor | null = null;
// 换文档或卸载后，还在加载 canvas-editor 的那一次不再建编辑器
let mountSeq = 0;
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

function fittedScale(): number {
  const width = scrollEl.value?.clientWidth || WORD_PREVIEW_PAGE.width;
  return clampScale((width - PAGE_GAP * 2) / WORD_PREVIEW_PAGE.width);
}

function destroyEditor(): void {
  editor?.destroy();
  editor = null;
}

async function mountEditor(elements: IElement[]): Promise<void> {
  const seq = ++mountSeq;
  let canvasEditor: typeof import('@hufe921/canvas-editor');
  try {
    canvasEditor = await import('@hufe921/canvas-editor');
  } catch {
    if (seq === mountSeq) emit('error', '文档查看组件加载失败，请刷新页面后重试');
    return;
  }
  if (seq !== mountSeq || !hostEl.value) return;
  destroyEditor();
  if (fitWidth.value) scale.value = fittedScale();
  pageNo.value = 1;
  pageCount.value = 0;
  try {
    editor = new canvasEditor.Editor(hostEl.value, { main: structuredClone(elements) }, {
      mode: canvasEditor.EditorMode.READONLY,
      width: WORD_PREVIEW_PAGE.width,
      height: WORD_PREVIEW_PAGE.height,
      margins: [...WORD_PREVIEW_PAGE.margins],
      pageGap: PAGE_GAP,
      scale: scale.value,
    });
  } catch (error) {
    destroyEditor();
    emit('error', `文档排版失败：${error instanceof Error ? error.message : '未知错误'}`);
    return;
  }
  editor.listener.pageSizeChange = (count) => {
    pageCount.value = count;
  };
  editor.listener.pageScaleChange = (value) => {
    scale.value = value;
  };
}

function applyScale(value: number): void {
  const next = clampScale(value);
  if (next === scale.value) return;
  scale.value = next;
  editor?.command.executePageScale(next);
}

function zoomBy(delta: number): void {
  fitWidth.value = false;
  applyScale(scale.value + delta);
}

function fitToWidth(): void {
  fitWidth.value = true;
  applyScale(fittedScale());
}

function updatePageNo(): void {
  const scroller = scrollEl.value;
  if (!scroller || !hostEl.value) return;
  const marker = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
  let current = 1;
  hostEl.value.querySelectorAll('canvas[data-index]').forEach((page, index) => {
    if (page.getBoundingClientRect().top <= marker) current = index + 1;
  });
  pageNo.value = current;
}

onMounted(() => {
  if (scrollEl.value) {
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (fitWidth.value && Math.abs(fittedScale() - scale.value) >= 0.02) applyScale(fittedScale());
      });
    });
    resizeObserver.observe(scrollEl.value);
  }
  void mountEditor(props.elements);
});

watch(() => props.elements, (elements) => {
  void mountEditor(elements);
});

onBeforeUnmount(() => {
  mountSeq++;
  cancelAnimationFrame(resizeFrame);
  resizeObserver?.disconnect();
  destroyEditor();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-slate-900">
    <div class="flex shrink-0 items-center gap-1 border-b border-slate-800 px-3 py-1 text-xs text-slate-300">
      <span class="tabular-nums" data-testid="word-preview-page-indicator">
        第 {{ pageNo }} / {{ pageCount || '–' }} 页
      </span>
      <span class="flex-1" />
      <button type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="缩小"
        title="缩小"
        data-testid="word-preview-zoom-out"
        :disabled="scale <= MIN_SCALE"
        @click="zoomBy(-SCALE_STEP)">
        <ZoomOut class="h-4 w-4" aria-hidden="true" />
      </button>
      <span class="w-11 text-center font-mono tabular-nums" data-testid="word-preview-scale">
        {{ Math.round(scale * 100) }}%
      </span>
      <button type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="放大"
        title="放大"
        data-testid="word-preview-zoom-in"
        :disabled="scale >= MAX_SCALE"
        @click="zoomBy(SCALE_STEP)">
        <ZoomIn class="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
        :class="fitWidth ? 'bg-slate-800 text-sky-300' : ''"
        aria-label="适应宽度"
        title="适应宽度"
        :aria-pressed="fitWidth"
        data-testid="word-preview-fit-width"
        @click="fitToWidth">
        <MoveHorizontal class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
    <div ref="scrollEl"
      class="min-h-0 flex-1 overflow-auto bg-slate-800/60 p-4"
      role="document"
      :aria-label="label"
      @scroll.passive="updatePageNo">
      <div ref="hostEl" class="[&>div]:mx-auto" data-testid="word-preview-pages" />
    </div>
  </div>
</template>
