<script setup lang="ts">
/**
 * 差异明细的翻页条：这一页是第几条到第几条、一共多少条、每页多少条，
 * 首页 / 上一页 / 下一页 / 末页，以及直接填页码跳过去（几千条差异时不必一页页点）。
 */
import { computed } from 'vue';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-vue-next';

const props = withDefaults(defineProps<{
  /** 这一页第一行之前跳过了多少行 */
  offset: number;
  pageSize: number;
  /** 当前筛选下一共多少行 */
  total: number;
  /** 这一页实际拿到多少行 */
  shown: number;
  busy?: boolean;
  sizes?: number[];
}>(), { busy: false, sizes: () => [50, 100, 200, 500] });

const emit = defineEmits<{ 'update:offset': [offset: number]; 'update:pageSize': [size: number] }>();

// 换筛选后新的一页还没到时，表里暂时留着上一页的行：范围按合计封顶，不显示成「第 1–40 条，共 1 条」
const to = computed(() => Math.min(props.offset + props.shown, props.total));
const from = computed(() => (to.value > props.offset ? props.offset + 1 : 0));
const page = computed(() => Math.floor(props.offset / props.pageSize) + 1);
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const hasPrev = computed(() => props.offset > 0);
const hasNext = computed(() => props.offset + props.pageSize < props.total);

function goTo(target: number): void {
  const clamped = Math.min(pages.value, Math.max(1, Math.round(target) || 1));
  emit('update:offset', (clamped - 1) * props.pageSize);
}

function onPageInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  goTo(Number(input.value));
  input.value = String(page.value);
}

function onSize(event: Event): void {
  emit('update:pageSize', Number((event.target as HTMLSelectElement).value));
}

const btn = 'inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 hover:bg-muted disabled:opacity-40';
</script>

<template>
  <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-testid="rvm-store-pager">
    <span data-testid="rvm-store-pager-range">
      第 {{ from.toLocaleString('zh-CN') }}–{{ to.toLocaleString('zh-CN') }} 条，共 {{ total.toLocaleString('zh-CN') }} 条
    </span>
    <span v-if="busy" role="status">正在读…</span>
    <span class="ml-auto flex flex-wrap items-center gap-1.5">
      <label class="flex items-center gap-1">
        每页
        <select class="rounded border border-border bg-background px-1 py-0.5 text-foreground" :value="pageSize" data-testid="rvm-store-page-size" @change="onSize">
          <option v-for="size in sizes" :key="size" :value="size">{{ size }}</option>
        </select>
        条
      </label>
      <label class="flex items-center gap-1">
        第
        <input type="number"
          class="w-14 rounded border border-border bg-background px-1 py-0.5 text-right font-mono text-foreground"
          min="1"
          :max="pages"
          :value="page"
          :disabled="pages <= 1"
          data-testid="rvm-store-page-input"
          @change="onPageInput"
          @keydown.enter.prevent="onPageInput" />
        / {{ pages.toLocaleString('zh-CN') }} 页
      </label>
      <button type="button" :class="btn" :disabled="!hasPrev || busy" aria-label="首页" title="首页" data-testid="rvm-store-first" @click="goTo(1)">
        <ChevronsLeft class="h-3 w-3" aria-hidden="true" />
      </button>
      <button type="button" :class="btn" :disabled="!hasPrev || busy" data-testid="rvm-store-prev" @click="goTo(page - 1)">
        <ChevronLeft class="h-3 w-3" aria-hidden="true" />
        上一页
      </button>
      <button type="button" :class="btn" :disabled="!hasNext || busy" data-testid="rvm-store-next" @click="goTo(page + 1)">
        下一页
        <ChevronRight class="h-3 w-3" aria-hidden="true" />
      </button>
      <button type="button" :class="btn" :disabled="!hasNext || busy" aria-label="末页" title="末页" data-testid="rvm-store-last" @click="goTo(pages)">
        <ChevronsRight class="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  </div>
</template>
