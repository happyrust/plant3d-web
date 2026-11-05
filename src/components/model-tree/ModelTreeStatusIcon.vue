<script setup lang="ts">
/**
 * 模型树行尾的合并状态图标：颜色和符号是 RVM 核对结论，实心 / 空心 / 角标是模型生成状态。
 * 没核对过时退回生成状态圆点；核对排队或进行中只画时钟 / 转圈，不叠生成状态。
 */
import { computed } from 'vue';

import { Check, Circle, CircleDashed, LoaderCircle, Minus, Slash, X } from 'lucide-vue-next';

import type { RvmNodeVerdict } from '@/components/rvm-check/rvmCheckFormat';
import type { DbnumModelStatusKind } from '@/composables/useGenModelV1DbnumStatus';

import RvmStatusIcon from '@/components/rvm-check/RvmStatusIcon.vue';

const props = defineProps<{
  verdict: RvmNodeVerdict | null;
  generation: DbnumModelStatusKind | null;
}>();

const SOLID_BG: Partial<Record<RvmNodeVerdict, string>> = {
  pass: 'bg-emerald-600',
  fail: 'bg-red-600',
  kind_differ: 'bg-amber-500',
  external: 'bg-slate-500',
  empty: 'bg-zinc-400',
  tool_error: 'bg-stone-500',
};

const inFlight = computed(() => props.verdict === 'running' || props.verdict === 'queued');
/** 有已生成的模型（最新或滞后）才画实心 */
const solid = computed(() =>
  !!props.verdict && !inFlight.value && (props.generation === 'current' || props.generation === 'stale'));
const stale = computed(() => solid.value && props.generation === 'stale');
/** 生成状态还没探明时，核对结论淡一点画 */
const dim = computed(() =>
  !!props.verdict && !inFlight.value && (props.generation === 'unknown' || props.generation === 'probing'));
</script>

<template>
  <span class="relative inline-flex h-3.5 w-3.5 items-center justify-center"
    data-testid="model-tree-status-icon"
    :data-fill="verdict && !inFlight ? (solid ? 'solid' : 'outline') : undefined">
    <template v-if="verdict">
      <span v-if="solid" class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-white" :class="SOLID_BG[verdict]">
        <Check v-if="verdict === 'pass'" class="h-2.5 w-2.5" :stroke-width="3" />
        <X v-else-if="verdict === 'fail'" class="h-2.5 w-2.5" :stroke-width="3" />
        <Slash v-else-if="verdict === 'external'" class="h-2.5 w-2.5" :stroke-width="3" />
        <Minus v-else-if="verdict === 'empty'" class="h-2.5 w-2.5" :stroke-width="3" />
        <span v-else class="text-[9px] font-bold leading-none">{{ verdict === 'kind_differ' ? '!' : '?' }}</span>
      </span>
      <RvmStatusIcon v-else :verdict="verdict" :class="dim ? 'opacity-60' : ''" />
      <span v-if="stale"
        class="absolute -right-0.5 -top-0.5 h-[5px] w-[5px] rounded-full bg-amber-500 ring-1 ring-white"
        data-testid="model-tree-status-stale" />
    </template>
    <template v-else-if="generation">
      <LoaderCircle v-if="generation === 'probing'" class="h-3 w-3 animate-spin text-muted-foreground" />
      <Circle v-else-if="generation === 'current'" class="h-3 w-3 fill-success text-success" />
      <Circle v-else-if="generation === 'stale'" class="h-3 w-3 fill-warning text-warning" />
      <Circle v-else-if="generation === 'empty'" class="h-3 w-3 text-muted-foreground/60" />
      <CircleDashed v-else class="h-3 w-3 text-muted-foreground/40" />
    </template>
  </span>
</template>
