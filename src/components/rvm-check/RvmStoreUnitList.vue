<script setup lang="ts">
/**
 * 运行记录列表：一个上级根在一批里的全部单元，或页面单根核对的历次运行。一行一个根 / 单元，最新的在前。
 * 一次只取一页，底下「加载更多」往回翻；上千个单元时先用终态筛到没过的那些。
 */
import { computed, ref, watch } from 'vue';

import { ChevronDown } from 'lucide-vue-next';

import { countsSummary, formatAt } from './rvmCheckFormat';
import RvmStatusIcon from './RvmStatusIcon.vue';
import {
  countCellClass,
  countOf,
  elementName,
  formatCount,
  formatPeakMb,
  formatSeconds,
  runStatusKey,
  STORE_COUNT_COLUMNS,
  storeStatusInfo,
  sumSeconds,
  unitKindHint,
  unitKindLabel,
  UNNAMED,
} from './rvmStoreFormat';
import RvmStoreNotice from './RvmStoreNotice.vue';
import RvmStoreStatusChips from './RvmStoreStatusChips.vue';
import { useRvmStoreRunPages } from './useRvmStoreQueries';

import type { RvmStoreRun, RvmStoreRunFilter } from '@/api/rvmCheckStoreApi';

const props = withDefaults(defineProps<{
  /** 范围：`{ batch_id, root_refno }`，或页面单根的 `{ source: 'page' }` */
  scope: RvmStoreRunFilter;
  /** 终态 → 个数（来自汇总）；有它就画成带个数的筛选标签，没有就给一个下拉框 */
  statusMap?: Record<string, number> | null;
  /** 单元种类 → 个数（来自汇总） */
  unitMap?: Record<string, number> | null;
  /** 不筛选时一共多少行 */
  total?: number | null;
  /** 选中的终态 */
  status?: string | null;
}>(), { statusMap: null, unitMap: null, total: null, status: null });

const emit = defineEmits<{ 'update:status': [status: string | null]; open: [run: RvmStoreRun] }>();

const unitKind = ref('');
watch(() => JSON.stringify(props.scope), () => {
  unitKind.value = '';
});

const filter = computed<RvmStoreRunFilter>(() => ({
  ...props.scope,
  status: props.status || undefined,
  unit: unitKind.value || undefined,
}));
const { query, runs } = useRvmStoreRunPages(filter);

const unitKinds = computed(() => Object.entries(props.unitMap ?? {}).filter(([, count]) => count > 0));
const filtered = computed(() => !!(props.status || unitKind.value));

/** 当前筛选下一共多少行；两格同时筛时汇总里没有这个数，给 null */
const expected = computed<number | null>(() => {
  if (props.status && unitKind.value) return null;
  if (props.status) return props.statusMap?.[props.status] ?? null;
  if (unitKind.value) return props.unitMap?.[unitKind.value] ?? null;
  return props.total;
});

function onStatusSelect(event: Event): void {
  emit('update:status', (event.target as HTMLSelectElement).value || null);
}

const select = 'rounded border border-border bg-background px-1 py-0.5 text-foreground';
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-2" data-testid="rvm-store-unit-list">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
      <RvmStoreStatusChips v-if="statusMap"
        :status="statusMap"
        :selected="status"
        :total="total ?? undefined"
        clickable
        with-all
        @select="emit('update:status', $event)" />
      <label v-else class="flex items-center gap-1">
        结论
        <select :class="select" :value="status ?? ''" data-testid="rvm-store-unit-status" @change="onStatusSelect">
          <option value="">全部</option>
          <option value="fail">不一致 / 没跑完</option>
          <option value="kind_differ">种类不一致</option>
          <option value="pass">通过</option>
        </select>
      </label>
      <label v-if="unitKinds.length > 1" class="flex items-center gap-1">
        单元种类
        <select v-model="unitKind" :class="select" data-testid="rvm-store-unit-kind">
          <option value="">全部</option>
          <option v-for="[kind, count] in unitKinds" :key="kind" :value="kind">{{ unitKindLabel(kind) }} {{ count }}</option>
        </select>
      </label>
    </div>

    <RvmStoreNotice v-if="query.error.value" kind="error" title="读不到运行记录" :error="query.error.value" @retry="query.refetch()" />
    <RvmStoreNotice v-else-if="query.isPending.value" kind="loading" title="正在读运行记录…" :rows="6" />
    <RvmStoreNotice v-else-if="runs.length === 0"
      kind="empty"
      :title="filtered ? '当前筛选下没有单元' : '没有运行记录'"
      :detail="filtered ? '换一个终态或单元种类试试。' : '库里这个范围下还没有落进任何一次比对。'" />
    <template v-else>
      <div class="min-h-32 flex-1 overflow-auto rounded border border-border">
        <table class="w-full min-w-[1240px] table-fixed text-left text-[11px]">
          <colgroup>
            <col class="w-28" />
            <col />
            <col class="w-14" />
            <col class="w-14" />
            <col v-for="column in STORE_COUNT_COLUMNS" :key="column.key" class="w-16" />
            <col class="w-16" />
            <col class="w-24" />
            <col class="w-20" />
            <col class="w-36" />
          </colgroup>
          <thead class="sticky top-0 z-[1] bg-muted text-muted-foreground">
            <tr class="border-b border-border">
              <th scope="col" class="px-2 py-1 font-medium">终态</th>
              <th scope="col" class="px-2 py-1 font-medium">单元</th>
              <th scope="col" class="px-2 py-1 font-medium">种类</th>
              <th scope="col" class="px-2 py-1 font-medium">库</th>
              <th v-for="column in STORE_COUNT_COLUMNS" :key="column.key" scope="col" class="px-2 py-1 text-right font-medium">{{ column.label }}</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">差异行</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">用时</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">生成峰值</th>
              <th scope="col" class="px-2 py-1 font-medium">完成时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(run, position) in runs"
              :key="run.run_id"
              class="cursor-pointer border-b border-border/60 align-top hover:bg-muted/60"
              :class="position % 2 === 1 ? 'bg-muted/30' : ''"
              data-testid="rvm-store-unit-row"
              :data-status="runStatusKey(run)"
              @click="emit('open', run)">
              <td class="px-2 py-1">
                <span class="inline-flex items-center gap-1 whitespace-nowrap" :title="storeStatusInfo(runStatusKey(run)).hint">
                  <RvmStatusIcon :verdict="storeStatusInfo(runStatusKey(run)).tone" />
                  {{ storeStatusInfo(runStatusKey(run)).label }}
                </span>
              </td>
              <td class="px-2 py-1">
                <button type="button" class="block w-full text-left" data-testid="rvm-store-unit-open" @click.stop="emit('open', run)">
                  <span class="text-[10px] text-muted-foreground">{{ run.noun }}</span>
                  <span class="ml-1 break-all font-medium text-foreground underline-offset-2 hover:underline">{{ elementName(run.name, run.noun) ?? UNNAMED }}</span>
                  <span class="ml-1 whitespace-nowrap font-mono text-[10px] text-muted-foreground">{{ run.refno }}</span>
                </button>
                <p v-if="!storeStatusInfo(runStatusKey(run)).clean && run.message" class="line-clamp-2 break-all text-[10px] text-muted-foreground" :title="run.message">
                  {{ run.message }}
                </p>
              </td>
              <td class="px-2 py-1" :title="unitKindHint(run.unit)">{{ unitKindLabel(run.unit) }}</td>
              <td class="px-2 py-1 font-mono">{{ run.dbnum ?? '—' }}</td>
              <td v-for="column in STORE_COUNT_COLUMNS"
                :key="column.key"
                class="px-2 py-1 text-right font-mono"
                :class="countCellClass(run.counts, column)"
                :title="countsSummary(run.counts)">
                {{ formatCount(countOf(run.counts, column.key)) }}
              </td>
              <td class="px-2 py-1 text-right font-mono" :class="run.mismatch_total ? 'font-semibold text-red-700' : 'text-muted-foreground'">
                {{ formatCount(run.mismatch_total ?? 0) }}
              </td>
              <td class="whitespace-nowrap px-2 py-1 text-right font-mono">{{ formatSeconds(sumSeconds(run.seconds)) }}</td>
              <td class="whitespace-nowrap px-2 py-1 text-right font-mono">{{ formatPeakMb(run.gen_peak_private_mb) }}</td>
              <td class="whitespace-nowrap px-2 py-1 font-mono text-[10.5px]">{{ run.finished_at ? formatAt(run.finished_at) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground" data-testid="rvm-store-unit-footer">
        <span data-testid="rvm-store-unit-shown">
          已显示 {{ runs.length.toLocaleString('zh-CN') }}<template v-if="expected != null"> / {{ expected.toLocaleString('zh-CN') }}</template> 个
        </span>
        <button v-if="query.hasNextPage.value" type="button"
          class="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-foreground hover:bg-muted disabled:opacity-40"
          :disabled="query.isFetchingNextPage.value"
          data-testid="rvm-store-unit-more"
          @click="query.fetchNextPage()">
          <ChevronDown class="h-3 w-3" aria-hidden="true" />
          {{ query.isFetchingNextPage.value ? '正在读…' : '加载更多' }}
        </button>
        <span v-else>已到最早的一条</span>
        <span v-if="query.isFetching.value && !query.isFetchingNextPage.value" role="status">正在刷新…</span>
      </div>
    </template>
  </section>
</template>
