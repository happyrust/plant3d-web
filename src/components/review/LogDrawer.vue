<script setup lang="ts">
// 校审页日志抽屉（spec 003-review-log-viewer T202）。
// flag REVIEW_H_LOG_DRAWER 开启时由 ReviewPanel 挂载；默认过滤当前 form/task。
import { computed, onUnmounted, ref, watch } from 'vue';

import { FileText, RefreshCw, X } from 'lucide-vue-next';

import { fetchLogTypes, fetchLogs, type LogEntry, type LogTypeInfo } from '@/api/logsApi';
import { getCurrentSiteIdentity } from '@/api/siteRegistryApi';

const props = defineProps<{
  formId?: string | null;
  taskId?: string | null;
  siteId?: string | null;
}>();

const open = ref(false);
const types = ref<LogTypeInfo[]>([]);
const typesLoaded = ref(false);
// spec 004：标题区显示当前站点名（identity 拉取失败时静默隐藏）。
const siteName = ref<string | null>(null);
const siteIdentityLoaded = ref(false);
const activeType = ref<string>('review.workflow');
const entries = ref<LogEntry[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const errorMessage = ref<string | null>(null);
const scopeCurrent = ref(true);
const polling = ref(false);
const expandedKeys = ref(new Set<number>());

let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 5000;

const activeTypeInfo = computed(() => types.value.find((t) => t.id === activeType.value));
const needsSiteId = computed(() => activeType.value.startsWith('site.file.'));

function levelClass(level: string): string {
  if (level === 'error') return 'bg-red-100 text-red-700';
  if (level === 'warn') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function formatTs(tsMs?: number): string {
  if (!tsMs) return '-';
  try {
    return new Date(tsMs).toLocaleString();
  } catch {
    return String(tsMs);
  }
}

function detailText(entry: LogEntry): string {
  if (typeof entry.detail === 'string') return entry.detail;
  try {
    return JSON.stringify(entry.detail, null, 2);
  } catch {
    return String(entry.detail);
  }
}

async function ensureTypes(): Promise<void> {
  if (typesLoaded.value) return;
  try {
    types.value = await fetchLogTypes();
    typesLoaded.value = true;
    if (types.value.length > 0 && !types.value.some((t) => t.id === activeType.value)) {
      activeType.value = types.value[0]!.id;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function ensureSiteIdentity(): Promise<void> {
  if (siteIdentityLoaded.value) return;
  siteIdentityLoaded.value = true;
  try {
    const identity = await getCurrentSiteIdentity();
    siteName.value = identity.site_name || identity.site_id || null;
  } catch {
    siteName.value = null;
  }
}

async function loadEntries(append = false): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  errorMessage.value = null;
  try {
    const resp = await fetchLogs({
      type: activeType.value,
      formId: scopeCurrent.value ? props.formId?.trim() || undefined : undefined,
      taskId: scopeCurrent.value ? props.taskId?.trim() || undefined : undefined,
      siteId: needsSiteId.value ? props.siteId?.trim() || undefined : undefined,
      cursor: append ? nextCursor.value ?? undefined : undefined,
      limit: 50,
    });
    entries.value = append ? [...entries.value, ...resp.entries] : resp.entries;
    nextCursor.value = resp.next_cursor;
    if (!append) expandedKeys.value = new Set();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
    if (!append) entries.value = [];
  } finally {
    loading.value = false;
  }
}

function toggleExpand(index: number): void {
  const next = new Set(expandedKeys.value);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  expandedKeys.value = next;
}

function stopPolling(): void {
  polling.value = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function togglePolling(): void {
  if (polling.value) {
    stopPolling();
    return;
  }
  polling.value = true;
  pollTimer = setInterval(() => {
    if (open.value && !loading.value) void loadEntries(false);
  }, POLL_INTERVAL_MS);
}

async function openDrawer(): Promise<void> {
  open.value = true;
  void ensureSiteIdentity();
  await ensureTypes();
  await loadEntries(false);
}

function closeDrawer(): void {
  open.value = false;
  stopPolling();
}

watch(activeType, () => {
  if (open.value) void loadEntries(false);
});

watch(scopeCurrent, () => {
  if (open.value) void loadEntries(false);
});

onUnmounted(stopPolling);
</script>

<template>
  <!-- 悬浮入口按钮 -->
  <button v-if="!open"
    type="button"
    class="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-md transition-colors hover:bg-slate-50"
    data-testid="log-drawer-trigger"
    @click="() => void openDrawer()">
    <FileText class="h-3.5 w-3.5" />
    日志
  </button>

  <!-- 抽屉 -->
  <div v-if="open"
    class="fixed inset-y-0 right-0 z-50 flex w-[560px] max-w-full flex-col border-l border-slate-200 bg-white shadow-2xl"
    data-testid="log-drawer">
    <!-- 头部 -->
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <div class="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <FileText class="h-4 w-4" />
        日志查看
        <span v-if="siteName" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
          {{ siteName }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-1 text-xs text-slate-500">
          <input v-model="scopeCurrent" type="checkbox" class="h-3.5 w-3.5" />
          仅当前单据
        </label>
        <button type="button"
          class="rounded-md px-2 py-1 text-xs font-medium transition-colors"
          :class="polling ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          @click="togglePolling">
          {{ polling ? '轮询中(5s)' : '自动刷新' }}
        </button>
        <button type="button"
          class="rounded-md bg-slate-100 p-1.5 text-slate-600 transition-colors hover:bg-slate-200"
          :disabled="loading"
          title="刷新"
          @click="() => void loadEntries(false)">
          <RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" />
        </button>
        <button type="button"
          class="rounded-md bg-slate-100 p-1.5 text-slate-600 transition-colors hover:bg-slate-200"
          title="关闭"
          @click="closeDrawer">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- 类型 tab -->
    <div class="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <button v-for="t in types"
        :key="t.id"
        type="button"
        class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
        :class="activeType === t.id
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-500 hover:bg-slate-200 hover:text-slate-700'"
        @click="activeType = t.id">
        {{ t.name }}
      </button>
      <span v-if="typesLoaded && types.length === 0" class="px-2 py-1 text-xs text-slate-400">
        当前角色无可见日志类型
      </span>
    </div>

    <!-- 内容 -->
    <div class="flex-1 overflow-y-auto px-3 py-2">
      <div v-if="errorMessage"
        class="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {{ errorMessage }}
      </div>
      <div v-if="!loading && entries.length === 0 && !errorMessage"
        class="py-10 text-center text-xs text-slate-400">
        没有匹配的日志记录
      </div>

      <ul class="space-y-1.5">
        <li v-for="(entry, index) in entries" :key="index">
          <button type="button"
            class="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-left transition-colors hover:bg-slate-50"
            @click="toggleExpand(index)">
            <div class="flex items-center gap-2">
              <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                :class="levelClass(entry.level)">
                {{ entry.level }}
              </span>
              <span class="shrink-0 text-[11px] tabular-nums text-slate-400">{{ formatTs(entry.ts_ms) }}</span>
              <span class="truncate text-xs text-slate-700">{{ entry.summary }}</span>
            </div>
          </button>
          <pre v-if="expandedKeys.has(index)"
            class="mt-1 max-h-72 overflow-auto rounded-md bg-slate-900 p-2.5 text-[11px] leading-relaxed text-slate-100">{{ detailText(entry) }}</pre>
        </li>
      </ul>

      <button v-if="nextCursor"
        type="button"
        class="mt-2 w-full rounded-md border border-slate-200 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50"
        :disabled="loading"
        @click="() => void loadEntries(true)">
        加载更多
      </button>
    </div>
  </div>
</template>
