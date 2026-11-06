<script setup lang="ts">
/**
 * 重新部署弹窗里的「RVM 校验」块：汇总通过 / 失败 / 进行中，逐个 SITE 列进度和结论。
 * 点没通过的 SITE 打开 RVM 核对面板定位到那次核对的结果；弹窗随之关掉，面板在它后面。
 */
import { computed } from 'vue';

import { nodeVerdictLabel, stageLabel } from '@/components/rvm-check/rvmCheckFormat';
import RvmStatusIcon from '@/components/rvm-check/RvmStatusIcon.vue';
import {
  isFollowUpFailure,
  type FollowUpSiteRow,
  type FollowUpSiteState,
  type FollowUpSummary,
} from '@/composables/redeployRvmFollowUp';

const props = defineProps<{
  rows: FollowUpSiteRow[];
  summary: FollowUpSummary;
  queuedDbnums: number[];
  error: string | null;
}>();
const emit = defineEmits<{ open: [row: FollowUpSiteRow | null] }>();

function stateLabel(row: FollowUpSiteRow): string {
  if (row.state === 'cancelled') return '已取消';
  if (row.state === 'request_error') return '请求失败';
  if (row.state === 'running' && row.stage) return `核对中 · ${stageLabel(row.stage)}`;
  return nodeVerdictLabel(row.state);
}

function iconVerdict(state: FollowUpSiteState) {
  return state === 'cancelled' ? 'queued' : state === 'request_error' ? 'tool_error' : state;
}

const headline = computed(() => {
  const { total, passed, failed, pending, stopped } = props.summary;
  if (total === 0) return `库 ${props.queuedDbnums.join('、') || '—'} 下没有 SITE`;
  const parts = [`${passed} 通过`];
  if (failed > 0) parts.push(`${failed} 未通过`);
  if (pending > 0) parts.push(`${pending} 进行中`);
  if (stopped > 0) parts.push(`${stopped} 已取消`);
  return `${total} 个 SITE：${parts.join(' · ')}`;
});
</script>

<template>
  <section class="rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2 text-zinc-600" data-testid="redeploy-rvm-followup">
    <div class="flex items-center gap-2">
      <span class="font-medium text-zinc-700">RVM 校验</span>
      <span data-testid="redeploy-rvm-summary"
        :class="summary.failed > 0 ? 'text-red-700' : summary.pending > 0 ? 'text-zinc-600' : 'text-emerald-700'">
        {{ headline }}
      </span>
      <button type="button" class="ml-auto text-[11px] text-zinc-500 hover:text-zinc-700" @click="emit('open', null)">
        打开核对面板
      </button>
    </div>
    <ul v-if="rows.length > 0" class="mt-1.5 max-h-40 space-y-0.5 overflow-auto" data-testid="redeploy-rvm-sites">
      <li v-for="row in rows" :key="row.refno">
        <component :is="isFollowUpFailure(row.state) ? 'button' : 'div'"
          :type="isFollowUpFailure(row.state) ? 'button' : undefined"
          class="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left"
          :class="isFollowUpFailure(row.state) ? 'hover:bg-red-50' : ''"
          :title="row.message || undefined"
          :data-testid="`redeploy-rvm-site-${row.refno}`"
          :data-state="row.state"
          @click="isFollowUpFailure(row.state) && emit('open', row)">
          <RvmStatusIcon :verdict="iconVerdict(row.state)" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate font-mono text-zinc-800">{{ row.name }}</span>
          <span class="shrink-0 text-[10px]" :class="isFollowUpFailure(row.state) ? 'text-red-700 underline' : 'text-zinc-500'">
            {{ stateLabel(row) }}
          </span>
        </component>
      </li>
    </ul>
    <div v-if="error" class="mt-1 text-red-600">{{ error }}</div>
  </section>
</template>
