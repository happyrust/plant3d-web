/**
 * annotationTableSorting · 批注表格的排序 / 筛选 / 搜索纯函数
 *
 * 约定
 *   - 所有函数不修改入参，返回新数组
 *   - 搜索大小写不敏感，忽略 ASCII 与中文间的空格差异
 *   - 排序稳定：同 key 值时按 activityAt 降序（更新更近的在前）
 *
 * 与 annotationWorkspaceModel 的关系
 *   - 本文件只依赖 AnnotationWorkspaceItem 类型
 *   - 不负责构造 item（构造走 buildAnnotationWorkspaceItems）
 *   - 可被 AnnotationTableView.vue 和未来的 batch-export 工具复用
 */

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';
import type { AnnotationSeverity } from '@/types/auth';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type AnnotationTableSortKey =
  | 'index'
  | 'severity'
  | 'status'
  | 'activity'
  | 'refno';

export type AnnotationTableSortDirection = 'asc' | 'desc';

export type AnnotationTableSort = {
  key: AnnotationTableSortKey;
  direction: AnnotationTableSortDirection;
};

export type AnnotationTableStatusFilter =
  | 'all'
  | 'pending'
  | 'fixed'
  | 'rejected'
  | 'approved'
  | 'wont_fix';

export type AnnotationTableSeverityFilter =
  | 'all'
  | AnnotationSeverity
  | 'unset';

export type AnnotationTableFilters = {
  status: AnnotationTableStatusFilter;
  severity: AnnotationTableSeverityFilter;
  search: string;
};

// ------------------------------------------------------------
// Severity / Status ranks（用于排序）
// ------------------------------------------------------------

/** 错误类型降序排名：原则错误排最前 */
const SEVERITY_RANK: Record<AnnotationSeverity, number> = {
  principle: 3,
  general: 2,
  drawing: 1,
};

/** 状态排名：pending 最优先（设计师最需处理）*/
const STATUS_RANK: Record<AnnotationWorkspaceItem['statusKey'], number> = {
  pending: 5,
  rejected: 4,
  fixed: 3,
  wont_fix: 2,
  approved: 1,
};

function severityRank(severity?: AnnotationSeverity): number {
  if (!severity) return 0;
  return SEVERITY_RANK[severity] ?? 0;
}

function statusRank(item: AnnotationWorkspaceItem): number {
  return STATUS_RANK[item.statusKey] ?? 0;
}

// ------------------------------------------------------------
// Search · 大小写不敏感，支持中英文混合
// ------------------------------------------------------------

/** 归一化：去首尾空白，转小写，折叠所有空白到单空格 */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchSubstring(haystack: string | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

/**
 * 判断 item 是否命中 query
 *
 * 搜索字段：
 *   · id（少见但允许，便于调试）
 *   · title
 *   · description
 *   · refnos（以 `/` 和 `_` 都可匹配：搜 `24381_145018` 和 `24381/145018` 都生效）
 *   · 错误类型中文名（"原则错误" / "一般错误" / "图面错误"）
 *   · 状态中文名（item.statusLabel）
 *
 * 空 query 一律返回 true（不过滤）。
 */
export function matchesSearchQuery(item: AnnotationWorkspaceItem, query: string): boolean {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return true;

  if (matchSubstring(item.id, normalized)) return true;
  if (matchSubstring(item.title, normalized)) return true;
  if (matchSubstring(item.description, normalized)) return true;
  if (matchSubstring(item.priorityLabel, normalized)) return true;
  if (matchSubstring(item.statusLabel, normalized)) return true;

  for (const refno of item.refnos) {
    if (matchSubstring(refno, normalized)) return true;
    if (matchSubstring(refno.replace(/_/g, '/'), normalized)) return true;
    if (matchSubstring(refno.replace(/\//g, '_'), normalized)) return true;
  }

  return false;
}

export function searchAnnotationTableRows(
  items: AnnotationWorkspaceItem[],
  query: string,
): AnnotationWorkspaceItem[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return items;
  return items.filter((item) => matchesSearchQuery(item, normalized));
}

// ------------------------------------------------------------
// Filter · 按状态 / 错误类型
// ------------------------------------------------------------

export function filterByStatus(
  items: AnnotationWorkspaceItem[],
  status: AnnotationTableStatusFilter,
): AnnotationWorkspaceItem[] {
  if (status === 'all') return items;
  return items.filter((item) => item.statusKey === status);
}

export function filterBySeverity(
  items: AnnotationWorkspaceItem[],
  severity: AnnotationTableSeverityFilter,
): AnnotationWorkspaceItem[] {
  if (severity === 'all') return items;
  if (severity === 'unset') return items.filter((item) => !item.severity);
  return items.filter((item) => item.severity === severity);
}

// ------------------------------------------------------------
// Sort · 按 key + direction 排序，稳定
// ------------------------------------------------------------

const SORT_KEY_EXTRACTOR: Record<AnnotationTableSortKey, (item: AnnotationWorkspaceItem, index: number) => number | string> = {
  index: (_, idx) => idx,
  severity: (item) => severityRank(item.severity),
  status: (item) => statusRank(item),
  activity: (item) => item.activityAt,
  refno: (item) => item.refnos[0] ?? '',
};

/**
 * 排序。
 *
 * - 稳定排序：key 值相等时使用 activityAt 降序 tiebreaker
 * - 字符串 key（refno）使用 localeCompare（支持中文）
 * - 未知 key fall back 为 `index`
 */
export function sortAnnotationTableRows(
  items: AnnotationWorkspaceItem[],
  sort: AnnotationTableSort,
): AnnotationWorkspaceItem[] {
  const extractor = SORT_KEY_EXTRACTOR[sort.key] ?? SORT_KEY_EXTRACTOR.index;
  const sign = sort.direction === 'asc' ? 1 : -1;

  return items
    .map((item, index) => ({ item, index, value: extractor(item, index) }))
    .sort((a, b) => {
      const cmp = compareValues(a.value, b.value);
      if (cmp !== 0) return cmp * sign;
      return b.item.activityAt - a.item.activityAt;
    })
    .map((entry) => entry.item);
}

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), 'zh-Hans-CN');
}

// ------------------------------------------------------------
// 聚合流水线 · 一口气跑完过滤 + 搜索 + 排序
// ------------------------------------------------------------

/**
 * 典型用法：`applyAnnotationTablePipeline(items, { status, severity, search }, { key, direction })`
 *
 * 执行顺序 filter → search → sort，保证同一数据最多只过一次完整流水线。
 */
export function applyAnnotationTablePipeline(
  items: AnnotationWorkspaceItem[],
  filters: AnnotationTableFilters,
  sort: AnnotationTableSort,
): AnnotationWorkspaceItem[] {
  let result = items;
  result = filterByStatus(result, filters.status);
  result = filterBySeverity(result, filters.severity);
  result = searchAnnotationTableRows(result, filters.search);
  result = sortAnnotationTableRows(result, sort);
  return result;
}

// ------------------------------------------------------------
// 默认值 · 组件初始化用
// ------------------------------------------------------------

export const DEFAULT_SORT: AnnotationTableSort = {
  key: 'status',
  direction: 'desc',
};

export const DEFAULT_FILTERS: AnnotationTableFilters = {
  status: 'all',
  severity: 'all',
  search: '',
};

export const SORTABLE_COLUMNS: Record<AnnotationTableSortKey, { label: string; sortable: true }> = {
  index: { label: '序号', sortable: true },
  severity: { label: '错误标记', sortable: true },
  status: { label: '处理情况', sortable: true },
  activity: { label: '最近活动', sortable: true },
  refno: { label: 'RefNo', sortable: true },
};
