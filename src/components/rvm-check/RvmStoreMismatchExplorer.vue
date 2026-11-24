<script setup lang="ts">
/**
 * 一个范围（整批 / 一个上级根 / 一次运行）里的差异：上面是按原因种类的汇总，下面是明细表，带筛选和翻页。
 * 筛选项和各项行数都从汇总那一次计数里算，明细只取当前这一页。
 */
import { computed, ref, useId, watch } from 'vue';

import { FilterX } from 'lucide-vue-next';

import { facetOptions, facetTotal, reasonKindInfo, reasonTotals, severityInfo, storeCategoryLabel } from './rvmStoreFormat';
import RvmStoreMismatchTable from './RvmStoreMismatchTable.vue';
import RvmStoreNotice from './RvmStoreNotice.vue';
import RvmStorePager from './RvmStorePager.vue';
import RvmStoreReasonSummary from './RvmStoreReasonSummary.vue';
import { useRvmStoreMismatchPage, useRvmStoreReasons } from './useRvmStoreQueries';

import type { RvmStoreMismatch, RvmStoreMismatchFilter } from '@/api/rvmCheckStoreApi';

const props = withDefaults(defineProps<{
  /** 范围：`batch_id` / `root_refno` / `run_id` / `source` 的组合 */
  scope: RvmStoreMismatchFilter;
  /** 范围里没有差异时怎么说 */
  emptyText?: string;
  showUnit?: boolean;
  locatable?: boolean;
  runStatus?: string | null;
}>(), { emptyText: '这个范围里没有差异行。', showUnit: false, locatable: false, runStatus: null });

const emit = defineEmits<{ 'open-unit': [row: RvmStoreMismatch] }>();

const severity = ref('');
const category = ref('');
const reasonKind = ref('');
const noun = ref('');
const nounDraft = ref('');
const offset = ref(0);
const pageSize = ref(100);
const nounListId = useId();

watch(() => JSON.stringify(props.scope), () => {
  severity.value = '';
  category.value = '';
  reasonKind.value = '';
  noun.value = '';
  nounDraft.value = '';
  offset.value = 0;
});
watch([severity, category, reasonKind, noun, pageSize], () => {
  offset.value = 0;
});

// 原因计数：分类 / 级别 / 原因种类这三格在前端从同一份计数里算，只有 noun 要让服务端重新数
const reasons = useRvmStoreReasons(() => ({ ...props.scope, noun: noun.value || undefined }));
const kinds = computed(() => reasons.data.value?.kinds ?? []);
const facet = computed(() => ({
  category: category.value || undefined,
  severity: severity.value || undefined,
  reason_kind: reasonKind.value || undefined,
}));
const total = computed(() => facetTotal(kinds.value, facet.value));
// 刷新后行数变少（比如这一批重跑过）：停在已经不存在的页上时退到最后一页
watch(total, (count) => {
  if (count > 0 && offset.value >= count) offset.value = Math.floor((count - 1) / pageSize.value) * pageSize.value;
});
const reasonItems = computed(() => reasonTotals(kinds.value, facet.value));
const severityOptions = computed(() => facetOptions(kinds.value, 'severity', facet.value));
const categoryOptions = computed(() => facetOptions(kinds.value, 'category', facet.value));
const reasonOptions = computed(() => facetOptions(kinds.value, 'reason_kind', facet.value));

const page = useRvmStoreMismatchPage(() => ({
  ...props.scope,
  ...facet.value,
  noun: noun.value || undefined,
  limit: pageSize.value,
  offset: offset.value,
}));
const rows = computed(() => page.data.value?.rows ?? []);
const nounHints = computed(() => [...new Set(rows.value.map((row) => row.noun ?? '').filter(Boolean))].sort());

const filtered = computed(() => !!(severity.value || category.value || reasonKind.value || noun.value));
const error = computed(() => reasons.error.value ?? page.error.value);
const firstLoad = computed(() => reasons.isPending.value || page.isPending.value);
const busy = computed(() => page.isFetching.value || reasons.isFetching.value);

function applyNoun(): void {
  noun.value = nounDraft.value.trim().toUpperCase();
  nounDraft.value = noun.value;
}

function clearFilters(): void {
  severity.value = '';
  category.value = '';
  reasonKind.value = '';
  noun.value = '';
  nounDraft.value = '';
}

function retry(): void {
  void reasons.refetch();
  void page.refetch();
}

const select = 'rounded border border-border bg-background px-1 py-0.5 text-foreground';
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-2" data-testid="rvm-store-mismatch-explorer">
    <RvmStoreNotice v-if="error" kind="error" title="读不到差异明细" :error="error" @retry="retry" />
    <RvmStoreNotice v-else-if="firstLoad" kind="loading" title="正在读差异明细…" :rows="6" />
    <RvmStoreNotice v-else-if="total === 0 && !filtered" kind="empty" title="没有差异" :detail="emptyText" />
    <template v-else>
      <RvmStoreReasonSummary :items="reasonItems" :selected="reasonKind || null" @select="reasonKind = $event ?? ''" />

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground" data-testid="rvm-store-filters">
        <label class="flex items-center gap-1">
          级别
          <select v-model="severity" :class="select" data-testid="rvm-store-filter-severity">
            <option value="">全部</option>
            <option v-for="option in severityOptions" :key="option.value" :value="option.value">{{ severityInfo(option.value).label }} {{ option.n }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1">
          分类
          <select v-model="category" :class="select" data-testid="rvm-store-filter-category">
            <option value="">全部</option>
            <option v-for="option in categoryOptions" :key="option.value" :value="option.value">{{ storeCategoryLabel(option.value) }} {{ option.n }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1">
          原因种类
          <select v-model="reasonKind" :class="[select, 'max-w-48']" data-testid="rvm-store-filter-reason">
            <option value="">全部</option>
            <option v-for="option in reasonOptions" :key="option.value" :value="option.value">{{ reasonKindInfo(option.value).label }} {{ option.n }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1" title="构件的 noun，如 TUBI、BOX、SCTN；只在一侧的件没有 noun，填了就筛不出它们">
          noun
          <input v-model="nounDraft"
            class="w-20 rounded border border-border bg-background px-1 py-0.5 font-mono uppercase text-foreground"
            :list="nounListId"
            placeholder="全部"
            data-testid="rvm-store-filter-noun"
            @change="applyNoun"
            @keydown.enter.prevent="applyNoun" />
          <datalist :id="nounListId">
            <option v-for="value in nounHints" :key="value" :value="value" />
          </datalist>
        </label>
        <button v-if="filtered" type="button"
          class="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-foreground hover:bg-muted"
          data-testid="rvm-store-clear-filters"
          @click="clearFilters">
          <FilterX class="h-3 w-3" aria-hidden="true" />
          清除筛选
        </button>
      </div>

      <RvmStoreNotice v-if="total === 0" kind="empty" title="当前筛选下没有行" detail="换一个级别、分类、原因种类或 noun 试试。" />
      <div v-else class="min-h-32 flex-1 overflow-auto rounded border border-border" :class="page.isPlaceholderData.value ? 'opacity-60' : ''" :aria-busy="busy">
        <RvmStoreMismatchTable :rows="rows" :show-unit="showUnit" :locatable="locatable" :run-status="runStatus" @open-unit="emit('open-unit', $event)" />
      </div>
      <RvmStorePager v-if="total > 0" v-model:offset="offset" v-model:page-size="pageSize" :total="total" :shown="rows.length" :busy="busy" />
    </template>
  </section>
</template>
