<script setup lang="ts">
/** 「增量后过期 / 增量待校验」角标：图标右下角的蓝色小圆 + 刷新符号。父元素需要 `relative`。 */
import { RefreshCw } from 'lucide-vue-next';
</script>

<template>
  <span class="pointer-events-none absolute -bottom-0.5 -right-0.5 inline-flex h-2 w-2 items-center justify-center rounded-full bg-blue-700 text-white ring-1 ring-white"
    data-testid="rvm-status-outdated">
    <RefreshCw class="h-[6px] w-[6px]" :stroke-width="3.5" />
  </span>
</template>
