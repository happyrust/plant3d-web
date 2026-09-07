<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

import { useGenModelV1Health } from '@/composables/useGenModelV1Health';
import { useGenModelV1ModelSync } from '@/composables/useGenModelV1ModelSync';
import { isGenModelV1Source } from '@/model-source/kind';

/**
 * 树面板顶部的 gen-model 连接徽标（plan P1-4 / P5）：一个状态点 + 身份摘要 + 库三态，点一下重探。
 * 只在 `model_source=gen-model-v1`（或 `?gm_health=1`）时被父组件挂出来；挂上才开始轮询 / 订阅 WS，卸掉就停。
 * 模型变更同步（P5）只在数据源真的是 gen-model-v1 时起——`?gm_health=1` 只看不动场景。
 */
const health = useGenModelV1Health();
const sync = useGenModelV1ModelSync();
const syncEnabled = isGenModelV1Source();

const dotClass = computed(() => {
  switch (health.state.status) {
    case 'ok': {
      const gateClosed = health.state.modelPhaseOpen === false || health.state.modelReady === false;
      // 滞后是「模型落后于数据」，值得提醒；not_judged 只是没判，不画成告警（d-594）
      return gateClosed || health.state.verdict.lagging > 0 ? 'bg-warning' : 'bg-success';
    }
    case 'error':
      return 'bg-danger';
    case 'loading':
      return 'bg-muted-foreground animate-pulse';
    default:
      return 'bg-muted-foreground/50';
  }
});

const text = computed(() => {
  const verdict = health.verdictText.value;
  return verdict ? `${health.summary.value} · ${verdict}` : health.summary.value;
});

const title = computed(() => {
  const s = health.state;
  const lines = [health.summary.value];
  if (s.namespace) lines.push(`namespace ${s.namespace}`);
  if (s.version) lines.push(`gen-model v${s.version}`);
  if (s.dataFace) lines.push(`data_face ${s.dataFace}`);
  if (s.deliveryUnitTypes.length) lines.push(`最小交付单元 ${s.deliveryUnitTypes.join('/')}`);
  if (s.initializationStatus) lines.push(`initialization ${s.initializationStatus}`);
  if (s.verdict.total > 0) {
    lines.push(`库 model_verdict：同步 ${s.verdict.inSync} / 滞后 ${s.verdict.lagging} / 未判 ${s.verdict.notJudged}（共 ${s.verdict.total} 个 DESI）`);
    if (s.verdict.laggingDbnums.length) lines.push(`滞后库：${s.verdict.laggingDbnums.join(', ')}`);
  }
  if (s.verdict.error) lines.push(`/dbnums：${s.verdict.error}`);
  if (syncEnabled) {
    lines.push(`模型同步：${sync.summary.value}${sync.state.lastReloaded.length ? `（最近 ${sync.state.lastReloaded.join(', ')}）` : ''}`);
    if (sync.state.error) lines.push(`同步：${sync.state.error}`);
  }
  if (s.error) lines.push(s.error);
  if (s.lastCheckedAt) lines.push(`上次探测 ${new Date(s.lastCheckedAt).toLocaleTimeString()}`);
  lines.push('点击重探');
  return lines.join('\n');
});

onMounted(() => {
  health.start();
  if (syncEnabled) sync.start();
});
onUnmounted(() => {
  health.stop();
  if (syncEnabled) sync.stop();
});
</script>

<template>
  <button type="button"
    data-testid="gen-model-v1-health-badge"
    class="inline-flex h-7 max-w-[360px] items-center gap-1.5 rounded-sm border border-border/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
    :title="title"
    @mousedown.stop
    @click="health.refresh()">
    <span class="inline-block h-2 w-2 shrink-0 rounded-full"
      :class="dotClass" />
    <span class="truncate">{{ text }}</span>
    <span v-if="syncEnabled"
      class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      :class="sync.state.socket === 'open' ? 'bg-success' : sync.state.socket === 'connecting' || sync.state.socket === 'closed' ? 'bg-warning animate-pulse' : 'bg-muted-foreground/40'"
      :title="`WS ${sync.state.socket}`" />
  </button>
</template>
