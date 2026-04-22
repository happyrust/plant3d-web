<script setup lang="ts">
/**
 * AnnotationTableView · 批注表格视图
 *
 * MVP PR 2 · 独立可跑，不接入 DesignerCommentHandlingPanel（PR 3 再做）
 * 数据层复用 PR 1 的 annotationTableSorting / annotationTableExport 纯函数
 * 状态层通过 useAnnotationTableFilter composable 持有（session 级）
 *
 * 事件命名与 AnnotationWorkspace.vue 对齐，PR 3 接入时可无缝复用现有处理函数。
 */

import { computed, onBeforeUnmount, ref, shallowRef, toRef, watch } from 'vue';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Inbox,
  LocateFixed,
  MessageSquare,
  Search,
} from 'lucide-vue-next';

import {
  buildCsvFilename,
  downloadCsv,
  toAnnotationTableCsv,
} from './annotationTableExport';
import { highlightMatches } from './annotationTableHighlight';

import type { AnnotationTableSortKey } from './annotationTableSorting';
import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';
import type { AnnotationType } from '@/types/auth';

import { useAnnotationTableFilter } from '@/composables/useAnnotationTableFilter';
import { useContainerQuery } from '@/composables/useContainerQuery';

// ----------------------------------------------------------------------
// Props & Emits
// ----------------------------------------------------------------------

const props = withDefaults(defineProps<{
  items: AnnotationWorkspaceItem[];
  currentAnnotationId?: string | null;
  currentAnnotationType?: AnnotationType | null;
  emptyTitle?: string;
  emptyDescription?: string;
  /** 任务 key，用于生成 CSV 文件名 */
  taskKey?: string | null;
  /** 副标题：显示在标题右侧（如任务编号 · 描述） */
  subtitle?: string | null;
  /** 每页行数，默认 10 */
  pageSize?: number;
}>(), {
  currentAnnotationId: null,
  currentAnnotationType: null,
  emptyTitle: '当前范围内还没有可处理的批注',
  emptyDescription: '请选择退回任务，或等待对应 form_id 的批注同步后再处理。',
  taskKey: null,
  subtitle: null,
  pageSize: 10,
});

const emit = defineEmits<{
  (e: 'select-annotation', item: AnnotationWorkspaceItem): void;
  (e: 'open-annotation', item: AnnotationWorkspaceItem): void;
  (e: 'locate-annotation', item: AnnotationWorkspaceItem): void;
}>();

// ----------------------------------------------------------------------
// State
// ----------------------------------------------------------------------

const itemsRef = toRef(props, 'items');
const {
  sort,
  filters,
  filteredItems,
  currentPage,
  toggleSort,
  setStatusFilter,
  setSeverityFilter,
  setSearch,
  setPage,
} = useAnnotationTableFilter(itemsRef);

// ----------------------------------------------------------------------
// Responsive container query
// ----------------------------------------------------------------------

const rootEl = ref<HTMLElement | null>(null);
const { mode: layoutMode } = useContainerQuery(rootEl);

const isCompact = computed(() => layoutMode.value === 'compact');
const isMedium = computed(() => layoutMode.value === 'medium');
const isWide = computed(() => layoutMode.value === 'wide');

// ----------------------------------------------------------------------
// 搜索高亮 helpers
// ----------------------------------------------------------------------

function highlightTitle(item: AnnotationWorkspaceItem): string {
  return highlightMatches(item.title, filters.value.search);
}

function highlightDescription(item: AnnotationWorkspaceItem): string {
  return highlightMatches(item.description, filters.value.search);
}

// ----------------------------------------------------------------------
// 键盘导航 · ↑ ↓ Home End PageUp PageDown
// ----------------------------------------------------------------------

function getRowElements(): HTMLElement[] {
  if (!rootEl.value) return [];
  return Array.from(rootEl.value.querySelectorAll<HTMLElement>('[role="row"], [role="listitem"]'));
}

function focusRowByIndex(index: number) {
  const rows = getRowElements();
  if (rows.length === 0) return;
  const clamped = Math.max(0, Math.min(rows.length - 1, index));
  rows[clamped]?.focus();
}

function findCurrentRowIndex(): number {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return -1;
  return getRowElements().indexOf(active);
}

function handleRowKeyNav(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  // 仅当焦点在行上时响应（不拦截搜索框输入）
  const isOnRow = target.getAttribute('role') === 'row' || target.getAttribute('role') === 'listitem';
  if (!isOnRow) return;

  const current = findCurrentRowIndex();
  const rows = getRowElements();

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusRowByIndex(current < 0 ? 0 : current + 1);
      return;
    case 'ArrowUp':
      event.preventDefault();
      focusRowByIndex(current < 0 ? rows.length - 1 : current - 1);
      return;
    case 'Home':
      event.preventDefault();
      focusRowByIndex(0);
      return;
    case 'End':
      event.preventDefault();
      focusRowByIndex(rows.length - 1);
      return;
    case 'PageDown':
      event.preventDefault();
      if (currentPage.value < totalPages.value) {
        setPage(currentPage.value + 1);
      }
      return;
    case 'PageUp':
      event.preventDefault();
      if (currentPage.value > 1) {
        setPage(currentPage.value - 1);
      }
      return;
    default:
      return;
  }
}

const searchInput = ref('');
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchInput, (query) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    setSearch(query);
    searchDebounceTimer = null;
  }, 300);
});

onBeforeUnmount(() => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  if (clickDelayTimer) clearTimeout(clickDelayTimer);
});

// ----------------------------------------------------------------------
// Pagination
// ----------------------------------------------------------------------

const totalCount = computed(() => filteredItems.value.length);
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / props.pageSize)));
const showFooter = computed(() => totalCount.value > props.pageSize);
const pagedItems = computed(() => {
  const start = (currentPage.value - 1) * props.pageSize;
  return filteredItems.value.slice(start, start + props.pageSize);
});
const pageStart = computed(() => (totalCount.value === 0 ? 0 : (currentPage.value - 1) * props.pageSize + 1));
const pageEnd = computed(() => Math.min(totalCount.value, currentPage.value * props.pageSize));

function goPrev() {
  if (currentPage.value > 1) setPage(currentPage.value - 1);
}
function goNext() {
  if (currentPage.value < totalPages.value) setPage(currentPage.value + 1);
}

// ----------------------------------------------------------------------
// Summary pill counts（不受筛选影响，基于全量 items）
// ----------------------------------------------------------------------

const summaryCounts = computed(() => {
  const result = { total: 0, pending: 0, fixed: 0, approved: 0 };
  for (const item of props.items) {
    result.total += 1;
    if (item.statusKey === 'pending') result.pending += 1;
    if (item.statusKey === 'fixed') result.fixed += 1;
    if (item.statusKey === 'approved') result.approved += 1;
  }
  return result;
});

// ----------------------------------------------------------------------
// Click / Double-click 区分（220ms delay）
// ----------------------------------------------------------------------

let clickDelayTimer: ReturnType<typeof setTimeout> | null = null;
const pendingClickItem = shallowRef<AnnotationWorkspaceItem | null>(null);

function handleRowClick(item: AnnotationWorkspaceItem) {
  if (clickDelayTimer) return;
  pendingClickItem.value = item;
  clickDelayTimer = setTimeout(() => {
    if (pendingClickItem.value) emit('select-annotation', pendingClickItem.value);
    pendingClickItem.value = null;
    clickDelayTimer = null;
  }, 220);
}

function handleRowDblClick(item: AnnotationWorkspaceItem) {
  if (clickDelayTimer) {
    clearTimeout(clickDelayTimer);
    clickDelayTimer = null;
    pendingClickItem.value = null;
  }
  emit('open-annotation', item);
}

// ----------------------------------------------------------------------
// Row highlight
// ----------------------------------------------------------------------

function isActiveRow(item: AnnotationWorkspaceItem): boolean {
  return item.id === props.currentAnnotationId && item.type === props.currentAnnotationType;
}

// ----------------------------------------------------------------------
// Sort header
// ----------------------------------------------------------------------

const SORTABLE_KEYS: AnnotationTableSortKey[] = ['index', 'severity', 'status'];

function isSortable(key: AnnotationTableSortKey): boolean {
  return SORTABLE_KEYS.includes(key);
}

function onHeaderClick(key: AnnotationTableSortKey) {
  if (!isSortable(key)) return;
  toggleSort(key);
}

function sortIconState(key: AnnotationTableSortKey): 'asc' | 'desc' | 'off' {
  if (sort.value.key !== key) return 'off';
  return sort.value.direction;
}

// ----------------------------------------------------------------------
// Severity / Status pill tone
// ----------------------------------------------------------------------

function severityPillClass(item: AnnotationWorkspaceItem): string {
  switch (item.severity) {
    case 'critical':
      return 'bg-rose-100 text-rose-700 ring-1 ring-rose-200';
    case 'severe':
      return 'bg-orange-100 text-orange-800 ring-1 ring-orange-200';
    case 'normal':
      return 'bg-blue-100 text-blue-700 ring-1 ring-blue-200';
    case 'suggestion':
    default:
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200';
  }
}

function severityDotClass(item: AnnotationWorkspaceItem): string {
  switch (item.severity) {
    case 'critical': return 'bg-rose-500';
    case 'severe':   return 'bg-orange-500';
    case 'normal':   return 'bg-blue-500';
    case 'suggestion':
    default:         return 'bg-slate-400';
  }
}

function severityLabel(item: AnnotationWorkspaceItem): string {
  const prefix = item.severity === 'critical' ? 'A · ' : item.severity === 'severe' ? 'B · ' : item.severity === 'normal' ? 'C · ' : '';
  return `${prefix}${item.priorityLabel || '低'}`;
}

function statusTextClass(item: AnnotationWorkspaceItem): string {
  switch (item.statusKey) {
    case 'pending':  return 'text-orange-700';
    case 'fixed':    return 'text-emerald-700';
    case 'rejected': return 'text-rose-700';
    case 'approved': return 'text-emerald-800';
    case 'wont_fix': return 'text-amber-700';
    default:         return 'text-slate-700';
  }
}

function statusPrefix(item: AnnotationWorkspaceItem): string {
  switch (item.statusKey) {
    case 'pending':  return '⏱';
    case 'fixed':    return '✓';
    case 'rejected': return '✕';
    case 'approved': return '★';
    case 'wont_fix': return '—';
    default:         return '';
  }
}

// ----------------------------------------------------------------------
// Export
// ----------------------------------------------------------------------

function handleExport() {
  const csv = toAnnotationTableCsv(filteredItems.value);
  const filename = buildCsvFilename({ taskKey: props.taskKey ?? undefined });
  downloadCsv(filename, csv);
}

// ----------------------------------------------------------------------
// Filter UI bindings
// ----------------------------------------------------------------------

const statusOptions: { value: import('./annotationTableSorting').AnnotationTableStatusFilter; label: string }[] = [
  { value: 'all',      label: '全部状态' },
  { value: 'pending',  label: '待处理' },
  { value: 'fixed',    label: '已修改' },
  { value: 'rejected', label: '已驳回' },
  { value: 'approved', label: '已通过' },
  { value: 'wont_fix', label: '不修改' },
];

const severityOptions: { value: import('./annotationTableSorting').AnnotationTableSeverityFilter; label: string }[] = [
  { value: 'all',        label: '全部严重度' },
  { value: 'critical',   label: 'A · 紧急' },
  { value: 'severe',     label: 'B · 高' },
  { value: 'normal',     label: 'C · 中' },
  { value: 'suggestion', label: '建议' },
];
</script>

<template>
  <section ref="rootEl"
    class="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    :data-testid="'annotation-table-view'"
    :data-layout-mode="layoutMode"
    @keydown="handleRowKeyNav">
    <!-- Toolbar -->
    <header class="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2.5">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-slate-950">批注表格</h2>
        <p v-if="subtitle" class="text-[11px] text-slate-400 truncate">{{ subtitle }}</p>
      </div>

      <div class="flex-1" />

      <!-- Search -->
      <label class="relative flex items-center">
        <Search class="absolute left-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        <input v-model="searchInput"
          type="search"
          placeholder="搜索问题、refno、处理说明..."
          class="h-8 w-64 rounded-md border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
          data-testid="annotation-table-search" />
      </label>

      <!-- Severity filter -->
      <select :value="filters.severity"
        class="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
        data-testid="annotation-table-severity-filter"
        @change="setSeverityFilter(($event.target as HTMLSelectElement).value as any)">
        <option v-for="opt in severityOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>

      <!-- Status filter -->
      <select :value="filters.status"
        class="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
        data-testid="annotation-table-status-filter"
        @change="setStatusFilter(($event.target as HTMLSelectElement).value as any)">
        <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </header>

    <!-- Stats -->
    <div class="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-[11px]">
      <span class="font-semibold text-slate-950">共 {{ summaryCounts.total }} 条</span>
      <span class="h-1 w-1 rounded-full bg-slate-300" />
      <span class="font-medium text-orange-700">待处理 {{ summaryCounts.pending }}</span>
      <span class="h-1 w-1 rounded-full bg-slate-300" />
      <span class="font-medium text-emerald-700">已处理 {{ summaryCounts.fixed }}</span>
      <span v-if="totalCount !== summaryCounts.total" class="ml-2 italic text-slate-400"
        data-testid="annotation-table-filter-hint">
        · 筛选后 {{ totalCount }} 条
      </span>
      <div class="flex-1" />

      <button type="button"
        class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="totalCount === 0"
        data-testid="annotation-table-export"
        @click="handleExport">
        <Download class="h-3 w-3" />
        导出 CSV
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="totalCount === 0"
      class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center"
      data-testid="annotation-table-empty">
      <Inbox class="h-9 w-9 text-slate-300" />
      <div class="text-sm font-semibold text-slate-700">{{ emptyTitle }}</div>
      <div class="text-xs leading-5 text-slate-500 max-w-md">{{ emptyDescription }}</div>
    </div>

    <!-- Table head + body · Wide / Medium 档 -->
    <template v-else>
      <!-- Head（Compact 不显示表头）-->
      <div v-if="!isCompact" role="rowgroup" class="flex h-9 items-center border-b border-slate-200 bg-slate-50 px-4 text-[11px] font-semibold text-slate-950">
        <button type="button"
          class="w-10 text-center flex items-center justify-center gap-1 hover:text-orange-600"
          data-testid="annotation-table-sort-index"
          @click="onHeaderClick('index')">
          <span>序号</span>
          <ArrowUp v-if="sortIconState('index') === 'asc'" class="h-3 w-3 text-orange-500" />
          <ArrowDown v-else-if="sortIconState('index') === 'desc'" class="h-3 w-3 text-orange-500" />
          <ArrowUpDown v-else class="h-3 w-3 text-slate-300" />
        </button>
        <button type="button"
          class="w-24 text-left flex items-center gap-1 hover:text-orange-600"
          data-testid="annotation-table-sort-severity"
          @click="onHeaderClick('severity')">
          <span>错误标记</span>
          <ArrowUp v-if="sortIconState('severity') === 'asc'" class="h-3 w-3 text-orange-500" />
          <ArrowDown v-else-if="sortIconState('severity') === 'desc'" class="h-3 w-3 text-orange-500" />
          <ArrowUpDown v-else class="h-3 w-3 text-slate-300" />
        </button>
        <div class="flex-1">校核发现问题</div>
        <button type="button"
          class="text-left flex items-center gap-1 hover:text-orange-600"
          :class="isWide ? 'w-56' : 'w-40'"
          data-testid="annotation-table-sort-status"
          @click="onHeaderClick('status')">
          <span>处理情况</span>
          <ArrowUp v-if="sortIconState('status') === 'asc'" class="h-3 w-3 text-orange-500" />
          <ArrowDown v-else-if="sortIconState('status') === 'desc'" class="h-3 w-3 text-orange-500" />
          <ArrowUpDown v-else class="h-3 w-3 text-slate-300" />
        </button>
        <div class="w-16 text-center">操作</div>
      </div>

      <!-- Body · Wide / Medium: 表格行 -->
      <div v-if="!isCompact" role="rowgroup" class="flex-1 overflow-y-auto">
        <div v-for="(item, localIdx) in pagedItems"
          :key="`${item.type}:${item.id}`"
          role="row"
          tabindex="0"
          :aria-selected="isActiveRow(item)"
          :data-testid="`annotation-table-row-${item.id}`"
          class="flex items-center h-16 border-b border-slate-100 px-4 cursor-pointer transition-colors"
          :class="[
            isActiveRow(item) ? 'bg-amber-50 ring-1 ring-amber-300' : 'hover:bg-amber-50',
            localIdx % 2 === 1 && !isActiveRow(item) ? 'bg-slate-50/40' : '',
          ]"
          @click="handleRowClick(item)"
          @dblclick="handleRowDblClick(item)"
          @keydown.enter.prevent="handleRowClick(item)"
          @keydown.space.prevent="handleRowDblClick(item)">
          <!-- 序号 -->
          <div class="w-10 text-center text-sm font-semibold text-slate-950">
            {{ (currentPage - 1) * pageSize + localIdx + 1 }}
          </div>

          <!-- 错误标记 -->
          <div class="w-24">
            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none"
              :class="severityPillClass(item)">
              <span class="h-1.5 w-1.5 rounded-full" :class="severityDotClass(item)" />
              {{ severityLabel(item) }}
            </span>
          </div>

          <!-- 校核发现问题 · Medium 下隐藏 description 只保留 title -->
          <!-- v-html is SAFE here: highlightMatches() escapes text first then wraps <mark> -->
          <div class="flex-1 pr-4 text-xs leading-snug text-slate-700 line-clamp-2">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <span class="font-semibold text-slate-950" v-html="highlightTitle(item)" />
            <template v-if="isWide && item.description">
              <span class="text-slate-500"> · </span>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <span class="text-slate-500" v-html="highlightDescription(item)" />
            </template>
          </div>

          <!-- 处理情况 · Medium 下收窄 -->
          <div class="pr-2 min-w-0" :class="isWide ? 'w-56' : 'w-40'">
            <div class="text-[11px] font-semibold" :class="statusTextClass(item)">
              {{ statusPrefix(item) }} {{ item.statusLabel }}
            </div>
            <div v-if="item.commentCount > 0" class="text-[11px] text-slate-500 truncate">
              {{ item.commentCount }} 条讨论
            </div>
            <div v-else-if="item.statusKey === 'pending'" class="text-[11px] text-slate-400">
              尚未录入处理说明
            </div>
          </div>

          <!-- 操作列 -->
          <div class="w-16 flex justify-center gap-2 text-slate-400">
            <button type="button"
              class="hover:text-slate-900"
              :data-testid="`annotation-table-locate-${item.id}`"
              @click.stop="emit('locate-annotation', item)">
              <LocateFixed class="h-3.5 w-3.5" />
            </button>
            <button type="button"
              class="hover:text-slate-900"
              :data-testid="`annotation-table-comment-${item.id}`"
              @click.stop="handleRowClick(item)">
              <MessageSquare class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <!-- Body · Compact: 纵向卡片列表 -->
      <div v-else role="list" class="flex-1 overflow-y-auto p-2 space-y-2 bg-slate-50/30"
        data-testid="annotation-table-compact-list">
        <article v-for="(item, localIdx) in pagedItems"
          :key="`${item.type}:${item.id}`"
          role="listitem"
          tabindex="0"
          :aria-selected="isActiveRow(item)"
          :data-testid="`annotation-table-row-${item.id}`"
          class="rounded-lg border bg-white p-3 cursor-pointer transition-shadow hover:shadow-sm"
          :class="isActiveRow(item) ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200'"
          @click="handleRowClick(item)"
          @dblclick="handleRowDblClick(item)"
          @keydown.enter.prevent="handleRowClick(item)"
          @keydown.space.prevent="handleRowDblClick(item)">
          <header class="flex items-center gap-2">
            <span class="text-[11px] font-mono text-slate-400">#{{ (currentPage - 1) * pageSize + localIdx + 1 }}</span>
            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none"
              :class="severityPillClass(item)">
              <span class="h-1.5 w-1.5 rounded-full" :class="severityDotClass(item)" />
              {{ severityLabel(item) }}
            </span>
            <span class="ml-auto flex gap-1.5 text-slate-400">
              <button type="button"
                class="hover:text-slate-900"
                :data-testid="`annotation-table-locate-${item.id}`"
                @click.stop="emit('locate-annotation', item)">
                <LocateFixed class="h-4 w-4" />
              </button>
              <button type="button"
                class="hover:text-slate-900"
                :data-testid="`annotation-table-comment-${item.id}`"
                @click.stop="handleRowClick(item)">
                <MessageSquare class="h-4 w-4" />
              </button>
            </span>
          </header>

          <!-- v-html is SAFE here: highlightMatches() escapes text first then wraps <mark> -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <h3 class="mt-1.5 text-sm font-semibold text-slate-950 line-clamp-1" v-html="highlightTitle(item)" />
          <!-- eslint-disable-next-line vue/no-v-html -->
          <p v-if="item.description" class="mt-0.5 text-xs leading-snug text-slate-600 line-clamp-2" v-html="highlightDescription(item)" />

          <footer class="mt-2 flex items-center gap-2 text-[11px]">
            <span class="font-semibold" :class="statusTextClass(item)">
              {{ statusPrefix(item) }} {{ item.statusLabel }}
            </span>
            <span v-if="item.commentCount > 0" class="text-slate-400">· {{ item.commentCount }} 条讨论</span>
          </footer>
        </article>
      </div>

      <!-- Footer · Pagination -->
      <div v-if="showFooter"
        class="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-[11px] text-slate-500">
        <span>当前 {{ pageStart }}-{{ pageEnd }} · 共 {{ totalCount }} 条</span>
        <div class="flex items-center gap-1.5">
          <button type="button"
            class="rounded border border-slate-200 bg-white p-1 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="currentPage <= 1"
            data-testid="annotation-table-prev"
            @click="goPrev">
            <ChevronLeft class="h-3 w-3" />
          </button>
          <span class="rounded bg-slate-900 px-2 py-0.5 font-semibold text-white">
            {{ currentPage }}/{{ totalPages }}
          </span>
          <button type="button"
            class="rounded border border-slate-200 bg-white p-1 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="currentPage >= totalPages"
            data-testid="annotation-table-next"
            @click="goNext">
            <ChevronRight class="h-3 w-3" />
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
