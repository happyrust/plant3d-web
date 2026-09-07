<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

import { useGenModelV1Health } from '@/composables/useGenModelV1Health';

/**
 * 树面板顶部的 gen-model 连接徽标（plan P1-4）：一个状态点 + 一句摘要，点一下重探。
 * 只在 `model_source=gen-model-v1`（或 `?gm_health=1`）时被父组件挂出来；挂上才开始轮询，卸掉就停。
 */
const health = useGenModelV1Health();

const dotClass = computed(() => {
  switch (health.state.status) {
    case 'ok':
      return health.state.modelPhaseOpen === false || health.state.modelReady === false ? 'bg-warning' : 'bg-success';
    case 'error':
      return 'bg-danger';
    case 'loading':
      return 'bg-muted-foreground animate-pulse';
    default:
      return 'bg-muted-foreground/50';
  }
});

const title = computed(() => {
  const s = health.state;
  const lines = [health.summary.value];
  if (s.namespace) lines.push(`namespace ${s.namespace}`);
  if (s.version) lines.push(`gen-model v${s.version}`);
  if (s.dataFace) lines.push(`data_face ${s.dataFace}`);
  if (s.deliveryUnitTypes.length) lines.push(`最小交付单元 ${s.deliveryUnitTypes.join('/')}`);
  if (s.initializationStatus) lines.push(`initialization ${s.initializationStatus}`);
  if (s.error) lines.push(s.error);
  if (s.lastCheckedAt) lines.push(`上次探测 ${new Date(s.lastCheckedAt).toLocaleTimeString()}`);
  lines.push('点击重探');
  return lines.join('\n');
});

onMounted(() => health.start());
onUnmounted(() => health.stop());
</script>

<template>
  <button type="button"
    data-testid="gen-model-v1-health-badge"
    class="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-sm border border-border/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
    :title="title"
    @mousedown.stop
    @click="health.refresh()">
    <span class="inline-block h-2 w-2 shrink-0 rounded-full"
      :class="dotClass" />
    <span class="truncate">{{ health.summary.value }}</span>
  </button>
</template>
