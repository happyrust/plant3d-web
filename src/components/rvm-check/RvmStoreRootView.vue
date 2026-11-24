<script setup lang="ts">
/**
 * 一个上级根（SITE / APPLDW）在一批里的全部单元，和它们的差异与原因汇总。
 * `rootRefno` 为 null 时是页面单根核对：没有批次也没有上级根，列的是页面上发起的历次核对。
 */
import { computed, ref } from 'vue';

import { formatAt } from './rvmCheckFormat';
import { elementName, formatCount, formatPeakMb, formatSeconds, rollupTotals, sumSeconds, UNNAMED } from './rvmStoreFormat';
import RvmStoreMismatchExplorer from './RvmStoreMismatchExplorer.vue';
import RvmStoreNotice from './RvmStoreNotice.vue';
import RvmStoreTabs from './RvmStoreTabs.vue';
import RvmStoreUnitList from './RvmStoreUnitList.vue';
import { RVM_STORE_PAGE_RUNS, useRvmStoreRollup, useRvmStoreRunSeed } from './useRvmStoreQueries';

import type { RvmStoreRunRef } from './useRvmStoreBrowser';
import type { RvmStoreMismatch, RvmStoreMismatchFilter, RvmStoreRun, RvmStoreRunFilter } from '@/api/rvmCheckStoreApi';

const props = withDefaults(defineProps<{
  batchId: string;
  rootRefno: string | null;
  /** 单元列表选中的终态 */
  status?: string | null;
  locatable?: boolean;
}>(), { status: null, locatable: false });

const emit = defineEmits<{
  'update:status': [status: string | null];
  'open-run': [run: RvmStoreRunRef];
}>();

const isPageRuns = computed(() => props.batchId === RVM_STORE_PAGE_RUNS);

const scope = computed<RvmStoreRunFilter & RvmStoreMismatchFilter>(() => {
  if (isPageRuns.value) return { source: 'page' };
  return { batch_id: props.batchId, root_refno: props.rootRefno ?? undefined };
});

// 页面单根不进汇总，没有个数可给
const rollup = useRvmStoreRollup(() => (isPageRuns.value ? null : scope.value));
const rows = computed(() => rollup.data.value?.roots ?? []);
const totals = computed(() => rollupTotals(rows.value));
const head = computed(() => rows.value[0] ?? null);

const tab = ref('units');
const tabs = computed(() => [
  { id: 'units', label: isPageRuns.value ? '运行记录' : '单元', count: isPageRuns.value ? null : totals.value.runs },
  { id: 'mismatches', label: '差异与原因', count: isPageRuns.value ? null : totals.value.mismatchTotal },
]);

const seed = useRvmStoreRunSeed();

function openRun(run: RvmStoreRun): void {
  const target = { refno: run.refno, runId: run.run_id };
  seed({ batchId: props.batchId, ...target }, run);
  emit('open-run', target);
}

function openUnit(row: RvmStoreMismatch): void {
  emit('open-run', { refno: row.refno, runId: row.run_id });
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-2" data-testid="rvm-store-root-view">
    <RvmStoreNotice v-if="rollup.error.value" kind="error" title="读不到这个上级根的汇总" :error="rollup.error.value" @retry="rollup.refetch()" />
    <RvmStoreNotice v-else-if="!isPageRuns && rollup.isPending.value" kind="loading" title="正在读这个上级根的汇总…" :rows="3" />
    <template v-else>
      <div v-if="isPageRuns" class="text-[11px] leading-relaxed text-muted-foreground" data-testid="rvm-store-root-summary">
        页面上「核对这个节点」发起的单根核对：每次一行，同一个节点核对过几次就有几行。这里的差异清单是完整的，不截到前 400 条。
      </div>
      <div v-else-if="head" class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px]" data-testid="rvm-store-root-summary">
        <h2 class="text-sm font-semibold">
          <span class="text-[11px] font-normal text-muted-foreground">{{ head.root_noun }}</span>
          {{ elementName(head.root_name, head.root_noun) ?? UNNAMED }}
          <span class="font-mono text-[11px] font-normal text-muted-foreground">{{ head.root_refno }}</span>
        </h2>
        <span class="text-muted-foreground">
          库 {{ head.dbnum ?? '—' }} · {{ formatCount(totals.runs) }} 个单元 ·
          <span :class="totals.notCleanRuns ? 'font-semibold text-red-700' : ''">没过 {{ formatCount(totals.notCleanRuns) }}</span>
          · 差异 {{ formatCount(totals.mismatchTotal) }} 行
          · 用时 {{ formatSeconds(sumSeconds(totals.seconds)) }}（生成 {{ formatSeconds(totals.seconds.generate) }}、E3D 导出 {{ formatSeconds(totals.seconds.e3d_export) }}）
          · 生成峰值 {{ formatPeakMb(totals.peakMb) }}
          <template v-if="totals.finishedAt"> · 最后完成 {{ formatAt(totals.finishedAt) }}</template>
        </span>
      </div>
      <RvmStoreNotice v-else
        kind="empty"
        title="这一批里没有这个上级根"
        :detail="`rvm_check_run 里没有 batch_id 为 ${batchId}、上级根为 ${rootRefno} 的行。`" />

      <template v-if="isPageRuns || head">
        <div class="border-b border-border">
          <RvmStoreTabs v-model="tab" :tabs="tabs" label="这个上级根看什么" />
        </div>
        <RvmStoreUnitList v-if="tab === 'units'"
          :scope="scope"
          :status-map="isPageRuns ? null : totals.status"
          :unit-map="isPageRuns ? null : totals.units"
          :total="isPageRuns ? null : totals.runs"
          :status="status"
          @update:status="emit('update:status', $event)"
          @open="openRun" />
        <RvmStoreMismatchExplorer v-else
          :key="`${batchId}|${rootRefno}`"
          :scope="scope"
          :empty-text="isPageRuns ? '页面单根核对没有留下差异行。' : '这个上级根下没有差异行：它的单元都是通过或无可比内容。'"
          show-unit
          :locatable="locatable"
          @open-unit="openUnit" />
      </template>
    </template>
  </section>
</template>
