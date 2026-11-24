/**
 * 库内 RVM 核对结果的取数：四个查询各包一层 TanStack Query，统一挂在 `['rvm-store', …]` 键下，
 * 「刷新」只要让这一个前缀失效。运行记录往回翻页、差异明细按偏移翻页，都不一次拉全量。
 */

import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/vue-query';

import {
  fetchRvmStoreMismatches,
  fetchRvmStoreReasons,
  fetchRvmStoreRollup,
  fetchRvmStoreRuns,
  RVM_STORE_MAX_LIMIT,
  type RvmStoreMismatchFilter,
  type RvmStoreRun,
  type RvmStoreRunFilter,
  type RvmStoreRuns,
} from '@/api/rvmCheckStoreApi';

export const RVM_STORE_QUERY_KEY = 'rvm-store';

/** 伪批次：页面上发起的单根核对不属于任何批次，汇总接口也不收它们 */
export const RVM_STORE_PAGE_RUNS = '@page';

/** 运行记录一页多少行 */
export const RVM_STORE_RUN_PAGE_SIZE = 100;

/** 读回来的结果这么久之内不重拉；想看最新的点「刷新」 */
const STALE_MS = 30_000;

/** 出错立刻让人看见，不在后台悄悄重试 */
const COMMON = { staleTime: STALE_MS, retry: false, refetchOnWindowFocus: false } as const;

export type RvmStoreRunPage = {
  runs: RvmStoreRun[];
  /** 下一页的 `before`；没有下一页时为 null */
  next: number | null;
};

type RunsFetcher = (filter: RvmStoreRunFilter, options: { signal?: AbortSignal }) => Promise<RvmStoreRuns>;

/**
 * 取一页运行记录。服务端只能按「完成时刻早于某个毫秒」往回翻，同一毫秒落库的几行可能被页边界切开，
 * 所以下一页从「不晚于上一页最后一行」起取（会重复几行，由 `mergeRunPages` 去重）；续页多取一行，
 * 抵掉必然重叠的那一行，这样「加载更多」每次正好多出一页。
 * 整页都是同一毫秒时游标挪不动，放大这一页再取，直到出现更早的行或到头。
 */
export async function fetchRunPage(
  filter: RvmStoreRunFilter,
  before: number | null,
  pageSize: number,
  signal?: AbortSignal,
  fetcher: RunsFetcher = fetchRvmStoreRuns,
): Promise<RvmStoreRunPage> {
  let limit = before == null ? pageSize : pageSize + 1;
  for (;;) {
    const { runs } = await fetcher({ ...filter, before: before ?? undefined, limit }, { signal });
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (!first || !last || runs.length < limit) return { runs, next: null };
    if (first.finished_unix_ms !== last.finished_unix_ms) return { runs, next: last.finished_unix_ms + 1 };
    // 到了服务端上限还是同一毫秒：只能跳过这一毫秒里剩下的
    if (limit >= RVM_STORE_MAX_LIMIT) return { runs, next: last.finished_unix_ms };
    limit = Math.min(limit * 4, RVM_STORE_MAX_LIMIT);
  }
}

/** 各页接起来，按 `run_id` 去重（页与页之间有意重叠）。 */
export function mergeRunPages(pages: RvmStoreRunPage[]): RvmStoreRun[] {
  const seen = new Set<string>();
  const merged: RvmStoreRun[] = [];
  for (const page of pages) {
    for (const run of page.runs) {
      if (seen.has(run.run_id)) continue;
      seen.add(run.run_id);
      merged.push(run);
    }
  }
  return merged;
}

/** 按上级根汇总。条件为 null 时不发请求。 */
export function useRvmStoreRollup(filter: MaybeRefOrGetter<RvmStoreRunFilter | null>) {
  return useQuery({
    queryKey: computed(() => [RVM_STORE_QUERY_KEY, 'rollup', toValue(filter)] as const),
    queryFn: ({ signal }) => fetchRvmStoreRollup(toValue(filter) ?? {}, { signal }),
    enabled: computed(() => toValue(filter) !== null),
    ...COMMON,
  });
}

/** 运行记录，「加载更多」式往回翻页。 */
export function useRvmStoreRunPages(filter: MaybeRefOrGetter<RvmStoreRunFilter>, pageSize = RVM_STORE_RUN_PAGE_SIZE) {
  const query = useInfiniteQuery({
    queryKey: computed(() => [RVM_STORE_QUERY_KEY, 'runs', toValue(filter), pageSize] as const),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => fetchRunPage(toValue(filter), pageParam, pageSize, signal),
    getNextPageParam: (last: RvmStoreRunPage) => last.next,
    ...COMMON,
  });
  const runs = computed(() => mergeRunPages(query.data.value?.pages ?? []));
  return { query, runs };
}

export type RvmStoreRunTarget = {
  /** 批次编号，或 `RVM_STORE_PAGE_RUNS` */
  batchId: string;
  /** 根 / 单元自己的 refno */
  refno: string;
  /** 知道就给：页面单根同一个节点可能核对过多次 */
  runId: string | null;
};

export function runQueryKey(target: RvmStoreRunTarget | null) {
  return [RVM_STORE_QUERY_KEY, 'run', target?.batchId ?? null, target?.refno ?? null, target?.runId ?? null] as const;
}

/** 一次运行的那一行。批量行按「批次 + refno」找；页面单根按 refno 取最近的几次，再认 `run_id`。找不到给 null。 */
export function useRvmStoreRun(target: MaybeRefOrGetter<RvmStoreRunTarget | null>) {
  return useQuery({
    queryKey: computed(() => runQueryKey(toValue(target))),
    queryFn: async ({ signal }): Promise<RvmStoreRun | null> => {
      const current = toValue(target);
      if (!current) return null;
      const filter: RvmStoreRunFilter = current.batchId === RVM_STORE_PAGE_RUNS
        ? { source: 'page', refno: current.refno, limit: 50 }
        : { batch_id: current.batchId, refno: current.refno, limit: 10 };
      const { runs } = await fetchRvmStoreRuns(filter, { signal });
      return runs.find((run) => run.run_id === current.runId) ?? runs[0] ?? null;
    },
    enabled: computed(() => toValue(target) !== null),
    ...COMMON,
  });
}

/** 差异明细的一页；翻页、换筛选时先留着上一页，不闪空。 */
export function useRvmStoreMismatchPage(filter: MaybeRefOrGetter<RvmStoreMismatchFilter>) {
  return useQuery({
    queryKey: computed(() => [RVM_STORE_QUERY_KEY, 'mismatches', toValue(filter)] as const),
    queryFn: ({ signal }) => fetchRvmStoreMismatches(toValue(filter), { signal }),
    placeholderData: keepPreviousData,
    ...COMMON,
  });
}

/** 差异按「原因种类 × 分类 × 严重级别」计数。 */
export function useRvmStoreReasons(filter: MaybeRefOrGetter<RvmStoreMismatchFilter>) {
  return useQuery({
    queryKey: computed(() => [RVM_STORE_QUERY_KEY, 'reasons', toValue(filter)] as const),
    queryFn: ({ signal }) => fetchRvmStoreReasons(toValue(filter), { signal }),
    placeholderData: keepPreviousData,
    ...COMMON,
  });
}

/** 列表里已经读到的那一行直接放进缓存，点进去不必再等一次请求。 */
export function useRvmStoreRunSeed() {
  const client = useQueryClient();
  return (target: RvmStoreRunTarget, run: RvmStoreRun): void => {
    client.setQueryData(runQueryKey(target), run);
  };
}

/** 让库内结果的全部查询失效并重拉正在看的那些。 */
export function useRvmStoreRefresh() {
  const client = useQueryClient();
  return (): Promise<void> => client.invalidateQueries({ queryKey: [RVM_STORE_QUERY_KEY] });
}
