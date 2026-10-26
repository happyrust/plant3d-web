<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

import { useQueryClient, type QueryClient } from '@tanstack/vue-query';

import { useGenModelV1Health } from '@/composables/useGenModelV1Health';
import { useGenModelV1UpdateNotice } from '@/composables/useGenModelV1UpdateNotice';

/**
 * 底部状态栏的 gen-model 连接徽标（plan P1-4）：一个状态点 + 身份摘要 + 库三态，点一下重探。
 * 徽标常驻在 App.vue 底部状态栏左侧；数据源本身持有轮询，
 * 徽标挂载/卸载只增减自己的展示 owner，不再决定缓存正确性探针是否存活。
 * 徽标本身只探 `/health` 与 `/dbnums`。旁边多一条「轻量联动」提示（2026-10-26）：后端自己跑完的增量批次落在当前
 * 装入的库 / 根上时只提示「有更新」，由人点「重载」才换场景里的实例；不被动重载（收口计划 §12「只吃自己 ensure
 * 出来的数据」仍成立）。
 */
const health = useGenModelV1Health();
const updateNotice = useGenModelV1UpdateNotice();
// 属性面板的 ui-attr 查询走 TanStack Query；单测 / 独立挂载没装 VueQueryPlugin 时没有 client，徒步省掉失效这一步即可。
let queryClient: QueryClient | null = null;
try {
  queryClient = useQueryClient();
} catch {
  queryClient = null;
}

const noticeText = computed(() => {
  const n = updateNotice.notice.value;
  if (!n) return '';
  const span = n.startSesno !== null && n.startSesno !== n.endSesno ? `${n.startSesno}→${n.endSesno}` : String(n.endSesno);
  const affected = n.loadedRoots.length > 0 ? `，场景内 ${n.loadedRoots.length} 根受影响` : '';
  return `库 ${n.dbnum} 已更新到会话 ${span}（改 ${n.changedElements} 项${affected}）`;
});
const noticeTitle = computed(() => {
  const n = updateNotice.notice.value;
  if (!n) return '';
  const lines = [`gen-model 任务 ${n.taskId}`, `批次里的生成根：${n.roots.join(', ') || '（无模型工作单元）'}`];
  lines.push(n.loadedRoots.length > 0
    ? `点「重载」按最新记录替换场景里的 ${n.loadedRoots.join(', ')}；不重新生成、不动相机`
    : '受影响的构件都不在场景里，不用重载');
  return lines.join('\n');
});

function reloadFromNotice(): void {
  const refnos = updateNotice.reload();
  // 属性面板走 TanStack Query（staleTime 5 min）：选中的构件可能就在这批里，一并让它重拉
  if (refnos.length > 0 && queryClient) void queryClient.invalidateQueries({ queryKey: ['pdms', 'ui-attr'] });
}

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
  if (s.startedAt) lines.push(`started_at ${s.startedAt} · generation ${s.serviceGeneration}`);
  if (s.dataFace) lines.push(`data_face ${s.dataFace}`);
  if (s.sulDbMedium) lines.push(`sul_db ${s.sulDbMedium} · durable=${String(s.sulDbDurable)}`);
  if (s.deliveryUnitTypes.length) lines.push(`最小交付单元 ${s.deliveryUnitTypes.join('/')}`);
  if (s.initializationStatus) lines.push(`initialization ${s.initializationStatus}`);
  if (s.verdict.total > 0) {
    lines.push(`库 model_verdict：同步 ${s.verdict.inSync} / 滞后 ${s.verdict.lagging} / 未判 ${s.verdict.notJudged}（共 ${s.verdict.total} 个 DESI）`);
    if (s.verdict.laggingDbnums.length) lines.push(`滞后库：${s.verdict.laggingDbnums.join(', ')}`);
  }
  if (s.verdict.error) lines.push(`/dbnums：${s.verdict.error}`);
  if (s.error) lines.push(s.error);
  if (s.lastCheckedAt) lines.push(`上次探测 ${new Date(s.lastCheckedAt).toLocaleTimeString()}`);
  lines.push('点击重探');
  return lines.join('\n');
});

onMounted(() => {
  health.start();
});
onUnmounted(() => {
  health.stop();
});
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <button type="button"
      data-testid="gen-model-v1-health-badge"
      class="inline-flex h-5 max-w-[360px] items-center gap-1.5 rounded-sm px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      :title="title"
      @mousedown.stop
      @click="health.refresh()">
      <span class="inline-block h-2 w-2 shrink-0 rounded-full"
        :class="dotClass" />
      <span class="truncate">{{ text }}</span>
    </button>
    <span v-if="updateNotice.notice.value"
      data-testid="gen-model-v1-update-notice"
      class="inline-flex h-5 max-w-[420px] items-center gap-1 rounded-sm border border-warning/50 bg-warning/15 px-1.5 text-[11px] text-foreground"
      :title="noticeTitle">
      <span class="truncate">{{ noticeText }}</span>
      <button v-if="updateNotice.notice.value.loadedRoots.length > 0"
        type="button"
        class="shrink-0 font-medium underline underline-offset-2 hover:text-primary"
        @mousedown.stop
        @click="reloadFromNotice">重载</button>
      <button type="button"
        class="shrink-0 px-0.5 text-muted-foreground hover:text-foreground"
        title="忽略"
        @mousedown.stop
        @click="updateNotice.dismiss()">×</button>
    </span>
  </span>
</template>
