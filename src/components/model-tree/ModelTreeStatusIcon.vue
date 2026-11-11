<script setup lang="ts">
/**
 * 模型树行尾的合并状态图标：颜色和符号是 RVM 核对结论，实心 / 空心 / 角标是模型生成状态。
 * 没核对过时退回生成状态圆点；核对排队或进行中只画时钟 / 转圈，不叠生成状态。
 * `outdated`（增量待校验 / 增量后过期）在右下角叠蓝色刷新角标，从没核对过时画灰色空心圆。
 *
 * 生成状态的画法（`DbnumModelStatusKind`）：`current` 绿；`file_ahead`（库文件还有新会话没更新）蓝——叠在核对结论上
 * 时是右上角蓝点；`stale`（模型落后于已入库数据）琥珀——叠在核对结论上时是右上角琥珀点；`updating` / `probing` 转圈；
 * `empty` 空心；`unknown` 虚线。
 *
 * 已加载的节点（SITE / ZONE 行）传进来的是它自己的结论（`useLoadedNodeStatus`）：最新 = `current`、落后 = `stale`，
 * 另多一种 `reloadable`（库里的模型比本页装的新，点「重载」能换上）——蓝色刷新图标，叠在核对结论上时是右上角蓝点。
 */
import { computed } from 'vue';

import { Check, Circle, CircleDashed, LoaderCircle, Minus, RefreshCw, Slash, X } from 'lucide-vue-next';

import type { RvmNodeVerdict } from '@/components/rvm-check/rvmCheckFormat';
import type { DbnumModelStatusKind } from '@/composables/useGenModelV1DbnumStatus';

import RvmOutdatedBadge from '@/components/rvm-check/RvmOutdatedBadge.vue';
import RvmStatusIcon from '@/components/rvm-check/RvmStatusIcon.vue';

const props = defineProps<{
  verdict: RvmNodeVerdict | null;
  generation: DbnumModelStatusKind | 'reloadable' | null;
  outdated?: boolean;
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
const outdated = computed(() => props.outdated === true && !inFlight.value);
/** 有已生成的模型（最新、库文件有新会话、落后、或有更新可重载）才画实心 */
const solid = computed(() =>
  !!props.verdict && !inFlight.value
  && (props.generation === 'current' || props.generation === 'file_ahead' || props.generation === 'stale' || props.generation === 'reloadable'));
const stale = computed(() => solid.value && props.generation === 'stale');
const fileAhead = computed(() => solid.value && props.generation === 'file_ahead');
const reloadable = computed(() => solid.value && props.generation === 'reloadable');
/** 生成状态还没探明（或库正在被写）时，核对结论淡一点画 */
const dim = computed(() =>
  !!props.verdict && !inFlight.value
  && (props.generation === 'unknown' || props.generation === 'probing' || props.generation === 'updating'));
</script>

<template>
  <span class="relative inline-flex h-3.5 w-3.5 items-center justify-center"
    data-testid="model-tree-status-icon"
    :data-fill="verdict && !inFlight ? (solid ? 'solid' : 'outline') : undefined"
    :data-rvm-outdated="outdated ? 'true' : undefined">
    <template v-if="verdict || outdated">
      <span v-if="solid" class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-white" :class="SOLID_BG[verdict!]">
        <Check v-if="verdict === 'pass'" class="h-2.5 w-2.5" :stroke-width="3" />
        <X v-else-if="verdict === 'fail'" class="h-2.5 w-2.5" :stroke-width="3" />
        <Slash v-else-if="verdict === 'external'" class="h-2.5 w-2.5" :stroke-width="3" />
        <Minus v-else-if="verdict === 'empty'" class="h-2.5 w-2.5" :stroke-width="3" />
        <span v-else class="text-[9px] font-bold leading-none">{{ verdict === 'kind_differ' ? '!' : '?' }}</span>
      </span>
      <RvmStatusIcon v-else :verdict="verdict" :class="dim ? 'opacity-60' : ''" />
      <RvmOutdatedBadge v-if="outdated" />
      <span v-if="stale"
        class="absolute -right-0.5 -top-0.5 h-[5px] w-[5px] rounded-full bg-amber-500 ring-1 ring-white"
        data-testid="model-tree-status-stale" />
      <span v-else-if="fileAhead"
        class="absolute -right-0.5 -top-0.5 h-[5px] w-[5px] rounded-full bg-sky-500 ring-1 ring-white"
        data-testid="model-tree-status-file-ahead" />
      <span v-else-if="reloadable"
        class="absolute -right-0.5 -top-0.5 h-[5px] w-[5px] rounded-full bg-sky-500 ring-1 ring-white"
        data-testid="model-tree-status-reloadable" />
    </template>
    <template v-else-if="generation">
      <LoaderCircle v-if="generation === 'probing' || generation === 'updating'" class="h-3 w-3 animate-spin text-muted-foreground" />
      <RefreshCw v-else-if="generation === 'reloadable'" class="h-3 w-3 text-sky-600" :stroke-width="2.5"
        data-testid="model-tree-status-reloadable-icon" />
      <Circle v-else-if="generation === 'current'" class="h-3 w-3 fill-success text-success" />
      <Circle v-else-if="generation === 'file_ahead'" class="h-3 w-3 fill-sky-500 text-sky-500" />
      <Circle v-else-if="generation === 'stale'" class="h-3 w-3 fill-warning text-warning" />
      <Circle v-else-if="generation === 'empty'" class="h-3 w-3 text-muted-foreground/60" />
      <CircleDashed v-else class="h-3 w-3 text-muted-foreground/40" />
    </template>
  </span>
</template>
