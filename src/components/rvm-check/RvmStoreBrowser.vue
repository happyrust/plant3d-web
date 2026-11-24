<script setup lang="ts">
/**
 * 库内结果：gen-model 的 `rvm_check_run` / `rvm_check_mismatch` 里存着的核对结果，一路点下去——
 * 全部批次 → 一个批次按上级根（SITE / APPLDW）的汇总 → 一个上级根下的单元（ZONE）→ 一个单元的差异明细。
 * 每一层另有「差异与原因」页签，看这个范围里按原因种类的汇总。只读，不发起核对。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { useIsFetching } from '@tanstack/vue-query';
import { ChevronRight, ExternalLink, RefreshCw } from 'lucide-vue-next';

import RvmStoreBatchTable from './RvmStoreBatchTable.vue';
import RvmStoreBatchView from './RvmStoreBatchView.vue';
import { elementName } from './rvmStoreFormat';
import RvmStoreRootView from './RvmStoreRootView.vue';
import RvmStoreRunView from './RvmStoreRunView.vue';
import { standaloneStoreUrl, useRvmStoreBrowser, type RvmStoreLevel } from './useRvmStoreBrowser';
import { RVM_STORE_QUERY_KEY, useRvmStoreRefresh, useRvmStoreRollup, useRvmStoreRun } from './useRvmStoreQueries';

/** 工作台里有三维视图，差异行才给「定位」；独立页没有 */
withDefaults(defineProps<{ locatable?: boolean }>(), { locatable: false });

const AUTO_REFRESH_MS = 15_000;

const browser = useRvmStoreBrowser();
const { place, level, runIsRoot, isPageRuns } = browser;

/** 停靠面板窄：带着当前位置开到独立页 */
function openStandalone(): void {
  window.open(standaloneStoreUrl(window.location.href, place), '_blank', 'noopener');
}

const refresh = useRvmStoreRefresh();
const fetching = useIsFetching({ queryKey: [RVM_STORE_QUERY_KEY] });

const autoRefresh = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
watch(autoRefresh, (on) => {
  if (timer) clearInterval(timer);
  timer = on ? setInterval(() => void refresh(), AUTO_REFRESH_MS) : null;
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

// 面包屑上的名字：与各层用的是同一份查询，不多发请求
const rootRollup = useRvmStoreRollup(() => (place.batchId && place.rootRefno && !isPageRuns.value
  ? { batch_id: place.batchId, root_refno: place.rootRefno }
  : null));
const rootRow = computed(() => rootRollup.data.value?.roots[0] ?? null);
const runQuery = useRvmStoreRun(() => (place.batchId && place.run
  ? { batchId: place.batchId, refno: place.run.refno, runId: place.run.runId }
  : null));

type Crumb = { id: RvmStoreLevel; prefix: string; label: string; mono: boolean; go: () => void };

const crumbs = computed<Crumb[]>(() => {
  const list: Crumb[] = [{ id: 'batches', prefix: '', label: '全部批次', mono: false, go: browser.openBatches }];
  const batchId = place.batchId;
  if (!batchId) return list;
  list.push({
    id: 'batch',
    prefix: '',
    label: isPageRuns.value ? '页面单根核对' : batchId,
    mono: !isPageRuns.value,
    go: () => browser.openBatch(batchId),
  });
  const rootRefno = place.rootRefno;
  if (rootRefno) {
    list.push({
      id: 'root',
      prefix: rootRow.value?.root_noun ?? '',
      label: elementName(rootRow.value?.root_name, rootRow.value?.root_noun) ?? rootRefno,
      mono: false,
      go: () => browser.openRoot(rootRefno, place.unitStatus),
    });
  }
  if (place.run && !runIsRoot.value) {
    const run = runQuery.data.value;
    list.push({ id: 'run', prefix: run?.noun ?? '', label: elementName(run?.name, run?.noun) ?? place.run.refno, mono: false, go: () => undefined });
  }
  return list;
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col text-foreground" data-testid="rvm-store-browser">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-xs">
      <nav class="min-w-0 flex-1" aria-label="库内结果里的位置" data-testid="rvm-store-breadcrumb">
        <ol class="m-0 flex list-none flex-wrap items-center gap-1 p-0">
          <li v-for="(crumb, index) in crumbs" :key="crumb.id" class="inline-flex min-w-0 items-center gap-1">
            <ChevronRight v-if="index > 0" class="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span v-if="index === crumbs.length - 1" class="min-w-0 break-all font-semibold" aria-current="page" :data-crumb="crumb.id">
              <span v-if="crumb.prefix" class="mr-1 text-[10px] font-normal text-muted-foreground">{{ crumb.prefix }}</span>
              <span :class="crumb.mono ? 'font-mono' : ''">{{ crumb.label }}</span>
            </span>
            <button v-else type="button"
              class="min-w-0 break-all text-left text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              :data-crumb="crumb.id"
              data-testid="rvm-store-crumb"
              @click="crumb.go()">
              <span v-if="crumb.prefix" class="mr-1 text-[10px]">{{ crumb.prefix }}</span>
              <span :class="crumb.mono ? 'font-mono' : ''">{{ crumb.label }}</span>
            </button>
          </li>
        </ol>
      </nav>
      <label class="flex items-center gap-1 text-[11px] text-muted-foreground" title="批量命令每跑完一个单元就落库一行；正在跑的批次开着它就能看着结果进来">
        <input v-model="autoRefresh" type="checkbox" data-testid="rvm-store-auto-refresh" />
        每 15 秒自动刷新
      </label>
      <button type="button"
        class="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 hover:bg-muted disabled:opacity-40"
        :disabled="fetching > 0"
        data-testid="rvm-store-refresh"
        @click="refresh()">
        <RefreshCw class="h-3 w-3" :class="fetching > 0 ? 'animate-spin' : ''" aria-hidden="true" />
        {{ fetching > 0 ? '正在读…' : '刷新' }}
      </button>
      <button v-if="locatable" type="button"
        class="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        title="在新标签页里用整页宽度看当前这一层"
        data-testid="rvm-store-open-standalone"
        @click="openStandalone">
        独立页
        <ExternalLink class="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
    <!-- 面板很矮时（工作台底部停靠）整块内容自己滚，不把表格压没 -->
    <div class="flex min-h-0 flex-1 flex-col overflow-auto p-3">
      <RvmStoreBatchTable v-if="level === 'batches' || !place.batchId" @open="browser.openBatch" />
      <RvmStoreRunView v-else-if="place.run"
        :key="`${place.batchId}|${place.run.refno}|${place.run.runId ?? ''}`"
        :batch-id="place.batchId"
        :refno="place.run.refno"
        :run-id="place.run.runId"
        :locatable="locatable" />
      <RvmStoreRootView v-else-if="place.rootRefno || isPageRuns"
        :key="`${place.batchId}|${place.rootRefno ?? ''}`"
        :batch-id="place.batchId"
        :root-refno="place.rootRefno"
        :status="place.unitStatus"
        :locatable="locatable"
        @update:status="browser.setUnitStatus"
        @open-run="browser.openRun($event)" />
      <RvmStoreBatchView v-else
        :key="place.batchId"
        :batch-id="place.batchId"
        :locatable="locatable"
        @open-root="browser.openRoot"
        @open-run="browser.openRun" />
    </div>
  </div>
</template>
