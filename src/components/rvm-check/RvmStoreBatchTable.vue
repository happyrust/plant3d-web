<script setup lang="ts">
/**
 * 全部批次：一批一行，最新的在前，没过的单元数单独一列。
 * 批次清单是从「按上级根汇总」并出来的，所以只有批量命令跑的批；页面上发起的单根核对另有入口。
 */
import { computed, ref } from 'vue';

import { ArrowRight, TriangleAlert } from 'lucide-vue-next';

import { formatAt } from './rvmCheckFormat';
import { formatCount, formatPeakMb, formatSeconds, groupBatches, modeLabel, sumSeconds } from './rvmStoreFormat';
import RvmStoreNotice from './RvmStoreNotice.vue';
import RvmStoreStatusChips from './RvmStoreStatusChips.vue';
import { RVM_STORE_PAGE_RUNS, useRvmStoreRollup } from './useRvmStoreQueries';

const emit = defineEmits<{ open: [batchId: string] }>();

const rollup = useRvmStoreRollup(() => ({}));
const batches = computed(() => groupBatches(rollup.data.value?.roots ?? []));

const keyword = ref('');
const onlyNotClean = ref(false);
const visible = computed(() => {
  const needle = keyword.value.trim().toLowerCase();
  return batches.value.filter((batch) => (!onlyNotClean.value || batch.notCleanRuns > 0)
    && (!needle || batch.batchId.toLowerCase().includes(needle)));
});
const notCleanBatches = computed(() => batches.value.filter((batch) => batch.notCleanRuns > 0).length);
const truncated = computed(() => !!rollup.data.value?.truncated);
const scanned = computed(() => rollup.data.value?.scanned ?? 0);
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-2" data-testid="rvm-store-batches">
    <RvmStoreNotice v-if="rollup.error.value" kind="error" title="读不到库内的核对结果" :error="rollup.error.value" @retry="rollup.refetch()" />
    <RvmStoreNotice v-else-if="rollup.isPending.value" kind="loading" title="正在读批次清单…" :rows="6" />
    <RvmStoreNotice v-else-if="batches.length === 0"
      kind="empty"
      title="库里还没有批量核对的结果"
      detail="用 aios-database rvm-check 跑一批（可加 --unit zone 按 ZONE 比），每跑完一个根或单元就会落一行到 rvm_check_run，这里随即能看到。">
      <button type="button"
        class="mt-1 inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
        data-testid="rvm-store-open-page-runs"
        @click="emit('open', RVM_STORE_PAGE_RUNS)">
        看页面上发起的单根核对
        <ArrowRight class="h-3 w-3" aria-hidden="true" />
      </button>
    </RvmStoreNotice>
    <template v-else>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        <span>
          共 {{ batches.length }} 批<template v-if="notCleanBatches">，其中 <span class="font-semibold text-red-700">{{ notCleanBatches }} 批有没过的单元</span></template>
        </span>
        <label class="flex items-center gap-1">
          <input v-model="onlyNotClean" type="checkbox" data-testid="rvm-store-batches-only-not-clean" />
          只看有没过的
        </label>
        <label class="flex items-center gap-1">
          <span class="sr-only">按批次编号过滤</span>
          <input v-model="keyword"
            type="search"
            class="w-48 rounded border border-border bg-background px-1.5 py-0.5 text-foreground"
            placeholder="批次编号里包含…"
            data-testid="rvm-store-batches-keyword" />
        </label>
        <button type="button"
          class="ml-auto inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-foreground hover:bg-muted"
          title="页面上「核对这个节点」发起的单根核对不属于任何批次，在这里看"
          data-testid="rvm-store-open-page-runs"
          @click="emit('open', RVM_STORE_PAGE_RUNS)">
          页面单根核对的记录
          <ArrowRight class="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      <p v-if="truncated" class="inline-flex items-center gap-1 text-[11px] text-amber-700" data-testid="rvm-store-truncated">
        <TriangleAlert class="h-3 w-3" aria-hidden="true" />
        运行记录太多，这里只汇总了最新的 {{ formatCount(scanned) }} 行，更早的批次没有列出来。
      </p>

      <RvmStoreNotice v-if="visible.length === 0" kind="empty" title="没有符合条件的批次" detail="去掉「只看有没过的」或清空过滤词。" />
      <div v-else class="min-h-32 flex-1 overflow-auto rounded border border-border">
        <!-- 批次一列给定宽、终态一列吃剩下的：面板窄时表格横向滚，不把批次编号挤没 -->
        <table class="w-full min-w-[1180px] table-fixed text-left text-[11px]">
          <colgroup>
            <col class="w-64" />
            <col class="w-16" />
            <col class="w-24" />
            <col class="w-14" />
            <col class="w-14" />
            <col class="w-14" />
            <col />
            <col class="w-16" />
            <col class="w-24" />
            <col class="w-20" />
            <col class="w-36" />
          </colgroup>
          <thead class="sticky top-0 z-[1] bg-muted text-muted-foreground">
            <tr class="border-b border-border">
              <th scope="col" class="px-2 py-1 font-medium">批次</th>
              <th scope="col" class="px-2 py-1 font-medium">跑法</th>
              <th scope="col" class="px-2 py-1 font-medium">库</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">上级根</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">单元</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">没过</th>
              <th scope="col" class="px-2 py-1 font-medium">终态</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">差异行</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">用时</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">生成峰值</th>
              <th scope="col" class="px-2 py-1 font-medium">完成时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(batch, position) in visible"
              :key="batch.batchId"
              class="cursor-pointer border-b border-border/60 align-top hover:bg-muted/60"
              :class="position % 2 === 1 ? 'bg-muted/30' : ''"
              data-testid="rvm-store-batch-row"
              :data-batch="batch.batchId"
              @click="emit('open', batch.batchId)">
              <td class="px-2 py-1">
                <button type="button"
                  class="break-all text-left font-mono font-medium text-foreground underline-offset-2 hover:underline"
                  data-testid="rvm-store-batch-open"
                  @click.stop="emit('open', batch.batchId)">
                  {{ batch.batchId || '（没有批次编号）' }}
                </button>
              </td>
              <td class="px-2 py-1">{{ batch.modes.map(modeLabel).join('、') }}</td>
              <td class="px-2 py-1 font-mono" :title="batch.dbnums.join('、')">
                {{ batch.dbnums.length > 2 ? `${batch.dbnums.length} 个库` : batch.dbnums.join('、') || '—' }}
              </td>
              <td class="px-2 py-1 text-right font-mono">{{ formatCount(batch.roots) }}</td>
              <td class="px-2 py-1 text-right font-mono">{{ formatCount(batch.runs) }}</td>
              <td class="px-2 py-1 text-right font-mono" :class="batch.notCleanRuns ? 'font-semibold text-red-700' : 'text-muted-foreground'">
                {{ formatCount(batch.notCleanRuns) }}
              </td>
              <td class="px-2 py-1"><RvmStoreStatusChips :status="batch.status" /></td>
              <td class="px-2 py-1 text-right font-mono" :class="batch.mismatchTotal ? 'font-semibold text-red-700' : 'text-muted-foreground'">
                {{ formatCount(batch.mismatchTotal) }}
              </td>
              <td class="whitespace-nowrap px-2 py-1 text-right font-mono">{{ formatSeconds(sumSeconds(batch.seconds)) }}</td>
              <td class="whitespace-nowrap px-2 py-1 text-right font-mono">{{ formatPeakMb(batch.peakMb) }}</td>
              <td class="whitespace-nowrap px-2 py-1 font-mono text-[10.5px]">{{ batch.finishedAt ? formatAt(batch.finishedAt) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
