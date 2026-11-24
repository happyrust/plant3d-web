<script setup lang="ts">
/**
 * 一个批次：按上级根（SITE / APPLDW）汇总，一个根的每种跑法一行；另一个页签是整批的差异与原因汇总。
 * 点一行进它下面的单元列表；整根只有一次运行的直接进那次运行；点终态标签进单元列表并筛到那个终态。
 */
import { computed, ref } from 'vue';

import { countsSummary, formatAt } from './rvmCheckFormat';
import {
  countCellClass,
  countOf,
  elementName,
  formatCount,
  formatPeakMb,
  formatSeconds,
  modeLabel,
  rollupTotals,
  STORE_COUNT_COLUMNS,
  storeStatusInfo,
  sumSeconds,
  UNNAMED,
} from './rvmStoreFormat';
import RvmStoreMismatchExplorer from './RvmStoreMismatchExplorer.vue';
import RvmStoreNotice from './RvmStoreNotice.vue';
import RvmStoreStatusChips from './RvmStoreStatusChips.vue';
import RvmStoreTabs from './RvmStoreTabs.vue';
import { useRvmStoreRollup } from './useRvmStoreQueries';

import type { RvmStoreRunRef } from './useRvmStoreBrowser';
import type { RvmStoreMismatch, RvmStoreRollupRow } from '@/api/rvmCheckStoreApi';

const props = withDefaults(defineProps<{ batchId: string; locatable?: boolean }>(), { locatable: false });

const emit = defineEmits<{
  'open-root': [rootRefno: string, status: string | null];
  'open-run': [run: RvmStoreRunRef, rootRefno: string];
}>();

const rollup = useRvmStoreRollup(() => ({ batch_id: props.batchId }));
const rows = computed(() => rollup.data.value?.roots ?? []);
const totals = computed(() => rollupTotals(rows.value));

const tab = ref('roots');
const tabs = computed(() => [
  { id: 'roots', label: '上级根', count: totals.value.roots },
  { id: 'mismatches', label: '差异与原因', count: totals.value.mismatchTotal },
]);

const keyword = ref('');
const onlyNotClean = ref(false);
const visible = computed(() => {
  const needle = keyword.value.trim().toLowerCase();
  return rows.value.filter((row) => (!onlyNotClean.value || !row.clean)
    && (!needle || `${row.root_name ?? ''} ${row.root_refno} ${row.root_noun ?? ''}`.toLowerCase().includes(needle)));
});

/** 整根只比了一次：没有单元列表可看，直接进那次运行 */
function isSingleRun(row: RvmStoreRollupRow): boolean {
  return row.mode === 'root' && row.runs === 1;
}

function open(row: RvmStoreRollupRow, status: string | null = null): void {
  if (isSingleRun(row)) emit('open-run', { refno: row.root_refno, runId: null }, row.root_refno);
  else emit('open-root', row.root_refno, status);
}

function openUnit(row: RvmStoreMismatch): void {
  emit('open-run', { refno: row.refno, runId: row.run_id }, row.root_refno || row.refno);
}

function notCleanTitle(row: RvmStoreRollupRow): string {
  if (!row.not_clean_runs) return '';
  const listed = row.not_clean
    .map((unit) => `${elementName(unit.name, unit.noun) ?? unit.refno}（${storeStatusInfo(unit.status).label}）`)
    .join('\n');
  const more = row.not_clean_runs - row.not_clean.length;
  return more > 0 ? `${listed}\n…还有 ${more} 个` : listed;
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-2" data-testid="rvm-store-batch-view">
    <RvmStoreNotice v-if="rollup.error.value" kind="error" title="读不到这一批的汇总" :error="rollup.error.value" @retry="rollup.refetch()" />
    <RvmStoreNotice v-else-if="rollup.isPending.value" kind="loading" title="正在读这一批的汇总…" :rows="6" />
    <RvmStoreNotice v-else-if="rows.length === 0"
      kind="empty"
      title="库里没有这个批次"
      :detail="`rvm_check_run 里没有 batch_id 为 ${batchId} 的行。批次编号是产物目录的最后两级。`" />
    <template v-else>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" data-testid="rvm-store-batch-summary">
        <span class="text-muted-foreground">
          {{ formatCount(totals.roots) }} 个上级根 · {{ formatCount(totals.runs) }} 个单元 ·
          <span :class="totals.notCleanRuns ? 'font-semibold text-red-700' : ''">没过 {{ formatCount(totals.notCleanRuns) }}</span>
          · 差异 {{ formatCount(totals.mismatchTotal) }} 行
        </span>
        <RvmStoreStatusChips :status="totals.status" />
        <span class="text-muted-foreground">
          用时 {{ formatSeconds(sumSeconds(totals.seconds)) }}（生成 {{ formatSeconds(totals.seconds.generate) }}、E3D 导出 {{ formatSeconds(totals.seconds.e3d_export) }}、比对 {{ formatSeconds(totals.seconds.compare) }}）
          · 生成峰值 {{ formatPeakMb(totals.peakMb) }}
          <template v-if="totals.finishedAt"> · 最后完成 {{ formatAt(totals.finishedAt) }}</template>
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-x-3 border-b border-border">
        <RvmStoreTabs v-model="tab" :tabs="tabs" label="这一批看什么" />
        <template v-if="tab === 'roots'">
          <label class="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <input v-model="onlyNotClean" type="checkbox" data-testid="rvm-store-roots-only-not-clean" />
            只看没过的
          </label>
          <label class="flex items-center gap-1 text-[11px]">
            <span class="sr-only">按上级根的名称或 refno 过滤</span>
            <input v-model="keyword"
              type="search"
              class="w-44 rounded border border-border bg-background px-1.5 py-0.5 text-foreground"
              placeholder="名称或 refno 里包含…"
              data-testid="rvm-store-roots-keyword" />
          </label>
        </template>
      </div>

      <template v-if="tab === 'roots'">
        <RvmStoreNotice v-if="visible.length === 0" kind="empty" title="没有符合条件的上级根" detail="去掉「只看没过的」或清空过滤词。" />
        <div v-else class="min-h-32 flex-1 overflow-auto rounded border border-border">
          <table class="w-full min-w-[1260px] table-fixed text-left text-[11px]">
            <colgroup>
              <col class="w-56" />
              <col class="w-14" />
              <col class="w-14" />
              <col class="w-14" />
              <col class="w-14" />
              <col />
              <col v-for="column in STORE_COUNT_COLUMNS" :key="column.key" class="w-16" />
              <col class="w-14" />
              <col class="w-24" />
              <col class="w-20" />
              <col class="w-36" />
            </colgroup>
            <thead class="sticky top-0 z-[1] bg-muted text-muted-foreground">
              <tr class="border-b border-border">
                <th scope="col" class="px-2 py-1 font-medium">上级根</th>
                <th scope="col" class="px-2 py-1 font-medium">库</th>
                <th scope="col" class="px-2 py-1 font-medium">跑法</th>
                <th scope="col" class="px-2 py-1 text-right font-medium">单元</th>
                <th scope="col" class="px-2 py-1 text-right font-medium">没过</th>
                <th scope="col" class="px-2 py-1 font-medium">终态</th>
                <th v-for="column in STORE_COUNT_COLUMNS" :key="column.key" scope="col" class="px-2 py-1 text-right font-medium">{{ column.label }}</th>
                <th scope="col" class="px-2 py-1 text-right font-medium">差异行</th>
                <th scope="col" class="px-2 py-1 text-right font-medium">用时</th>
                <th scope="col" class="px-2 py-1 text-right font-medium">生成峰值</th>
                <th scope="col" class="px-2 py-1 font-medium">完成时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, position) in visible"
                :key="`${row.root_refno}-${row.mode}`"
                class="cursor-pointer border-b border-border/60 align-top hover:bg-muted/60"
                :class="position % 2 === 1 ? 'bg-muted/30' : ''"
                data-testid="rvm-store-root-row"
                :data-root="row.root_refno"
                :data-mode="row.mode"
                @click="open(row)">
                <td class="px-2 py-1">
                  <button type="button" class="block w-full text-left" data-testid="rvm-store-root-open" @click.stop="open(row)">
                    <span class="block">
                      <span class="text-[10px] text-muted-foreground">{{ row.root_noun }}</span>
                      <span class="ml-1 break-all font-medium text-foreground underline-offset-2 hover:underline">{{ elementName(row.root_name, row.root_noun) ?? UNNAMED }}</span>
                    </span>
                    <span class="block font-mono text-[10px] text-muted-foreground">{{ row.root_refno }}</span>
                  </button>
                </td>
                <td class="px-2 py-1 font-mono">{{ row.dbnum ?? '—' }}</td>
                <td class="px-2 py-1">{{ modeLabel(row.mode) }}</td>
                <td class="px-2 py-1 text-right font-mono">{{ formatCount(row.runs) }}</td>
                <td class="px-2 py-1 text-right font-mono" :class="row.not_clean_runs ? 'font-semibold text-red-700' : 'text-muted-foreground'" :title="notCleanTitle(row)">
                  {{ formatCount(row.not_clean_runs) }}
                </td>
                <td class="px-2 py-1">
                  <RvmStoreStatusChips :status="row.status" :clickable="!isSingleRun(row)" @select="open(row, $event)" />
                </td>
                <td v-for="column in STORE_COUNT_COLUMNS"
                  :key="column.key"
                  class="px-2 py-1 text-right font-mono"
                  :class="countCellClass(row.counts, column)"
                  :title="countsSummary(row.counts)">
                  {{ formatCount(countOf(row.counts, column.key)) }}
                </td>
                <td class="px-2 py-1 text-right font-mono" :class="row.mismatch_total ? 'font-semibold text-red-700' : 'text-muted-foreground'">
                  {{ formatCount(row.mismatch_total) }}
                </td>
                <td class="whitespace-nowrap px-2 py-1 text-right font-mono">{{ formatSeconds(sumSeconds(row.seconds)) }}</td>
                <td class="whitespace-nowrap px-2 py-1 text-right font-mono">{{ formatPeakMb(row.gen_peak_private_mb) }}</td>
                <td class="whitespace-nowrap px-2 py-1 font-mono text-[10.5px]">{{ row.finished_at ? formatAt(row.finished_at) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <RvmStoreMismatchExplorer v-else
        :key="batchId"
        :scope="{ batch_id: batchId }"
        empty-text="这一批没有任何差异行：所有单元都是通过或无可比内容。"
        show-unit
        :locatable="locatable"
        @open-unit="openUnit" />
    </template>
  </section>
</template>
