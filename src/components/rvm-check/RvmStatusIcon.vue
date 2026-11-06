<script setup lang="ts">
/**
 * 树行尾的 RVM 核对结论图标。模型树和核对页的树共用，颜色和形状只在这里定。
 * `verdict` 为 null 表示从没核对过，只在增量待校验时出现，画灰色空心圆；
 * `outdated` 在右下角叠蓝色刷新角标（增量待校验 / 增量后过期）。
 */
import { Circle, CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleSlash, CircleX, Clock, LoaderCircle } from 'lucide-vue-next';

import RvmOutdatedBadge from './RvmOutdatedBadge.vue';
import RvmStatusIconBase from './RvmStatusIconBase.vue';

import type { RvmNodeVerdict } from './rvmCheckFormat';

defineProps<{ verdict: RvmNodeVerdict | null; outdated?: boolean }>();
</script>

<template>
  <!-- 带角标时根节点换成定位容器；不带时根节点仍是图标本身，外面传的 class 落在 svg 上 -->
  <span v-if="outdated" class="relative inline-flex h-3.5 w-3.5 shrink-0" data-rvm-outdated="true">
    <RvmStatusIconBase :verdict="verdict" />
    <RvmOutdatedBadge />
  </span>
  <RvmStatusIconBase v-else :verdict="verdict" />
</template>
