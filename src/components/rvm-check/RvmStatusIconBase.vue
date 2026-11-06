<script setup lang="ts">
/** RVM 核对结论的基础图标：只按 verdict 出形状和颜色，不带增量角标。 */
import { Circle, CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleSlash, CircleX, Clock, LoaderCircle } from 'lucide-vue-next';

import type { RvmNodeVerdict } from './rvmCheckFormat';

defineProps<{ verdict: RvmNodeVerdict | null }>();
</script>

<template>
  <CircleCheck v-if="verdict === 'pass'" class="h-3.5 w-3.5 text-emerald-600" />
  <CircleAlert v-else-if="verdict === 'kind_differ'" class="h-3.5 w-3.5 text-amber-500" />
  <CircleX v-else-if="verdict === 'fail'" class="h-3.5 w-3.5 text-red-600" />
  <CircleMinus v-else-if="verdict === 'empty'" class="h-3.5 w-3.5 text-zinc-400" />
  <span v-else-if="verdict === 'tool_error'" class="relative inline-flex h-3.5 w-3.5 items-center justify-center text-stone-500">
    <CircleDashed class="h-3.5 w-3.5" />
    <span class="absolute text-[8px] font-bold leading-none">!</span>
  </span>
  <CircleSlash v-else-if="verdict === 'external'" class="h-3.5 w-3.5 text-slate-500" />
  <Clock v-else-if="verdict === 'queued'" class="h-3.5 w-3.5 text-muted-foreground" />
  <LoaderCircle v-else-if="verdict === 'running'" class="h-3.5 w-3.5 animate-spin text-sky-600" />
  <Circle v-else class="h-3.5 w-3.5 text-zinc-400" data-rvm-never="true" />
</template>
