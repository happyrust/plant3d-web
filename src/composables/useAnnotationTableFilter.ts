/**
 * useAnnotationTableFilter · 批注表格视图的状态容器
 *
 * 持有 sort / filters 的 session 级 ref（不入 localStorage），
 * 并计算 filteredItems（内部调 applyAnnotationTablePipeline）。
 *
 * 使用场景：`AnnotationTableView.vue` 直接 `useAnnotationTableFilter(itemsRef)`
 * 获得一套完整的搜索 / 筛选 / 排序状态与操作器。
 */

import { computed, ref, watch, type Ref } from 'vue';

import type { AnnotationWorkspaceItem } from '@/components/review/annotationWorkspaceModel';

import {
  applyAnnotationTablePipeline,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  type AnnotationTableFilters,
  type AnnotationTableSeverityFilter,
  type AnnotationTableSort,
  type AnnotationTableSortKey,
  type AnnotationTableStatusFilter,
} from '@/components/review/annotationTableSorting';

export type UseAnnotationTableFilter = {
  sort: Ref<AnnotationTableSort>;
  filters: Ref<AnnotationTableFilters>;
  filteredItems: Ref<AnnotationWorkspaceItem[]>;
  currentPage: Ref<number>;

  setSort(key: AnnotationTableSortKey, direction?: 'asc' | 'desc'): void;
  toggleSort(key: AnnotationTableSortKey): void;
  setStatusFilter(status: AnnotationTableStatusFilter): void;
  setSeverityFilter(severity: AnnotationTableSeverityFilter): void;
  setSearch(query: string): void;
  setPage(page: number): void;
  reset(): void;
};

/**
 * 列头三态切换：
 *   · 当前非此列 → 设为该列 desc
 *   · 当前此列 desc → 翻转为 asc
 *   · 当前此列 asc → 回到默认 sort（清空此列排序）
 */
function nextToggleSort(
  current: AnnotationTableSort,
  key: AnnotationTableSortKey,
): AnnotationTableSort {
  if (current.key !== key) return { key, direction: 'desc' };
  if (current.direction === 'desc') return { key, direction: 'asc' };
  return { ...DEFAULT_SORT };
}

export function useAnnotationTableFilter(
  items: Ref<AnnotationWorkspaceItem[]>,
): UseAnnotationTableFilter {
  const sort = ref<AnnotationTableSort>({ ...DEFAULT_SORT });
  const filters = ref<AnnotationTableFilters>({ ...DEFAULT_FILTERS });
  const currentPage = ref(1);

  const filteredItems = computed(() =>
    applyAnnotationTablePipeline(items.value, filters.value, sort.value),
  );

  /**
   * 任何影响过滤结果的改动都把 currentPage 重置为 1，
   * 避免"在第 3 页删光条件后留在越界页"的尴尬。
   */
  watch([
    () => filters.value.status,
    () => filters.value.severity,
    () => filters.value.search,
    () => sort.value.key,
    () => sort.value.direction,
  ], () => {
    currentPage.value = 1;
  });

  function setSort(key: AnnotationTableSortKey, direction: 'asc' | 'desc' = 'desc') {
    sort.value = { key, direction };
  }

  function toggleSort(key: AnnotationTableSortKey) {
    sort.value = nextToggleSort(sort.value, key);
  }

  function setStatusFilter(status: AnnotationTableStatusFilter) {
    filters.value = { ...filters.value, status };
  }

  function setSeverityFilter(severity: AnnotationTableSeverityFilter) {
    filters.value = { ...filters.value, severity };
  }

  function setSearch(query: string) {
    filters.value = { ...filters.value, search: query };
  }

  function setPage(page: number) {
    currentPage.value = Math.max(1, Math.floor(page));
  }

  function reset() {
    sort.value = { ...DEFAULT_SORT };
    filters.value = { ...DEFAULT_FILTERS };
    currentPage.value = 1;
  }

  return {
    sort,
    filters,
    filteredItems,
    currentPage,
    setSort,
    toggleSort,
    setStatusFilter,
    setSeverityFilter,
    setSearch,
    setPage,
    reset,
  };
}
