<script setup lang="ts">
/** 库内结果各层共用的三种状态：加载中（骨架）、没有数据、读不到（带「先查哪里」和重试）。 */
import { computed } from 'vue';

import { Inbox, RefreshCw, TriangleAlert } from 'lucide-vue-next';

import { describeStoreError } from './rvmStoreFormat';

const props = withDefaults(defineProps<{
  kind: 'loading' | 'empty' | 'error';
  title?: string;
  detail?: string;
  /** `error` 时给请求抛出来的错误 */
  error?: unknown;
  /** 骨架画几行 */
  rows?: number;
}>(), { title: '', detail: '', error: undefined, rows: 4 });

defineEmits<{ retry: [] }>();

const errorText = computed(() => describeStoreError(props.error));
</script>

<template>
  <div v-if="kind === 'loading'" class="flex flex-col gap-1.5 p-3" role="status" aria-busy="true" data-testid="rvm-store-loading">
    <span class="sr-only">{{ title || '正在读库内结果…' }}</span>
    <div v-for="index in rows" :key="index" class="h-6 animate-pulse rounded bg-muted" />
  </div>
  <div v-else-if="kind === 'empty'" class="flex flex-col items-center gap-1.5 px-4 py-8 text-center" role="status" data-testid="rvm-store-empty">
    <Inbox class="h-6 w-6 text-muted-foreground" aria-hidden="true" />
    <div class="text-xs font-medium">{{ title || '没有数据' }}</div>
    <p v-if="detail" class="max-w-xl text-[11px] leading-relaxed text-muted-foreground">{{ detail }}</p>
    <slot />
  </div>
  <div v-else class="m-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800" role="alert" data-testid="rvm-store-error">
    <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <div class="text-xs font-semibold">{{ title || '读不到库内结果' }}</div>
      <p class="mt-0.5 break-all font-mono text-[10.5px] leading-relaxed">{{ errorText.message }}</p>
      <p v-if="errorText.hint" class="mt-1 text-[11px]">{{ errorText.hint }}</p>
    </div>
    <button type="button"
      class="inline-flex shrink-0 items-center gap-1 rounded border border-red-300 bg-background px-2 py-0.5 text-[11px] text-red-800 hover:bg-red-100"
      data-testid="rvm-store-retry"
      @click="$emit('retry')">
      <RefreshCw class="h-3 w-3" aria-hidden="true" />
      重试
    </button>
  </div>
</template>
