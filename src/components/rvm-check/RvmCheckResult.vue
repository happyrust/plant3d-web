<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';

import { ChevronDown, ChevronRight, CornerLeftUp, Crosshair, Download, RefreshCw, ScanEye, TriangleAlert } from 'lucide-vue-next';

import {
  bannerCounts,
  categoryLabel,
  describeMismatch,
  formatAabb,
  formatAt,
  formatDeltaMm,
  formatDurationMs,
  mismatchDisplayName,
  mismatchLocateTarget,
  rvmRefnoKey,
  summarizeKinds,
  verdictTone,
} from './rvmCheckFormat';
import {
  classifyReport,
  REASON_ORDER,
  reasonBrief,
  reasonInfo,
  VERDICT_HINTS,
  type E3dLogInfo,
  type ReasonDetail,
  type RvmReason,
} from './rvmMismatchReason';
import RvmStatusIcon from './RvmStatusIcon.vue';
import { useRvmMismatchLocate } from './useRvmMismatchLocate';

import { downloadRvmCheckFile, RVM_CHECK_E3D_LOG, type RvmCheckReport, type RvmMismatch } from '@/api/rvmCheckApi';
import { useRvmCheckStore } from '@/composables/useRvmCheckStore';

const props = defineProps<{
  taskId: string;
  report: RvmCheckReport;
  /** 核对完成时刻，标题行显示 */
  at?: string | null;
  /** 工作台里有三维视图，才给「定位」和「在 3D 中查看」 */
  locatable?: boolean;
}>();

const store = useRvmCheckStore();
const locator = useRvmMismatchLocate();

const reasonFilter = ref<RvmReason | 'all'>('all');
const sortMode = ref<'delta_desc' | 'delta_asc' | 'reason'>('delta_desc');
const includeExternal = ref(false);
const expanded = ref<Record<number, boolean>>({});
const activeRow = ref<number | null>(null);
const rowNotes = ref<Record<number, string>>({});
const locating = ref(false);
const locateNote = ref<string | null>(null);
const downloadError = ref<string | null>(null);
const filesOpen = ref(false);

/** e3d.log 读完才分得出「E3D 目录错误」，读的过程要让人看得见 */
const logState = ref<'none' | 'loading' | 'ready' | 'failed'>('none');
const logInfo = shallowRef<E3dLogInfo | null>(null);
watch(
  () => [props.taskId, props.report.files.includes(RVM_CHECK_E3D_LOG)] as const,
  ([taskId, hasLog]) => {
    logInfo.value = null;
    reasonFilter.value = 'all';
    expanded.value = {};
    activeRow.value = null;
    rowNotes.value = {};
    locateNote.value = null;
    filesOpen.value = false;
    if (!hasLog) {
      logState.value = 'none';
      return;
    }
    logState.value = 'loading';
    void store.loadE3dLog(taskId).then((info) => {
      if (props.taskId !== taskId) return;
      logInfo.value = info;
      logState.value = info ? 'ready' : 'failed';
    });
  },
  { immediate: true },
);

const classified = computed(() => classifyReport(props.report, logInfo.value));
const verdict = computed(() => classified.value.nodeVerdict);
const tone = computed(() => verdictTone(verdict.value));
const verdictHint = computed(() => VERDICT_HINTS[verdict.value] ?? null);
const counts = computed(() => bannerCounts(props.report.counts));
const duration = computed(() => formatDurationMs(props.report.timings_ms));
/** 工具故障时直接给出排查用的两个文件，只列这次真有的 */
const TOOL_ERROR_FILES = ['compare.log', 'e3d.rvm'];
const toolErrorFiles = computed(() => (verdict.value === 'tool_error' ? TOOL_ERROR_FILES.filter((name) => props.report.files.includes(name)) : []));
const total = computed(() => props.report.mismatches.length);
const oursRows = computed(() => total.value - classified.value.externalRows);
const oursReasons = computed(() => classified.value.summary.filter((item) => reasonInfo(item.reason).ours));
const externalReasons = computed(() => classified.value.summary.filter((item) => !reasonInfo(item.reason).ours));
const mainReasons = computed(() => reasonBrief(oursReasons.value.length ? oursReasons.value : classified.value.summary));

function reasonOf(index: number): ReasonDetail {
  return classified.value.rows.get(index) ?? { reason: 'other', text: null };
}

function toggleReason(reason: RvmReason | 'all'): void {
  reasonFilter.value = reason === 'all' || reasonFilter.value === reason ? 'all' : reason;
}

const rows = computed(() => {
  const filtered = props.report.mismatches
    .map((row, index) => ({ row, index, detail: reasonOf(index) }))
    .filter(({ detail }) => reasonFilter.value === 'all' || detail.reason === reasonFilter.value);
  return filtered.sort((left, right) => {
    const delta = (right.row.max_axis_delta_mm ?? -1) - (left.row.max_axis_delta_mm ?? -1);
    if (sortMode.value === 'reason') {
      const rank = REASON_ORDER.indexOf(left.detail.reason) - REASON_ORDER.indexOf(right.detail.reason);
      return rank !== 0 ? rank : delta;
    }
    return sortMode.value === 'delta_desc' ? delta : -delta;
  });
});

/** 「在 3D 中查看」跟着当前筛选走；非几何行默认不隔离，除非勾上或者正按这个原因筛选 */
const isolateTargets = computed(() => rows.value
  .filter(({ detail }) => includeExternal.value || reasonInfo(detail.reason).ours || reasonFilter.value === detail.reason)
  .map(({ row }) => row.name));

const rechecking = computed(() => {
  const refno = rvmRefnoKey(props.report.refno);
  return store.queue.value.some((item) => item.refno === refno && (item.state === 'queued' || item.state === 'running'));
});

async function recheck(): Promise<void> {
  await store.recheck({ refno: props.report.refno, name: props.report.name ?? '', noun: props.report.noun ?? '' });
}

async function showProblems(): Promise<void> {
  const names = isolateTargets.value;
  locateNote.value = null;
  if (names.length === 0) {
    locateNote.value = '当前筛选下没有要查我们这边的行；要看非几何问题请勾上「含非几何问题」';
    return;
  }
  locating.value = true;
  try {
    const result = await locator.showProblems(props.report.refno, names);
    if (result.error) locateNote.value = result.error;
    else if (result.located === 0) locateNote.value = '载入了被核对的节点，但问题构件一个都没在模型树里找到';
    else locateNote.value = `已隔离 ${result.located} 个构件${result.missing ? `，${result.missing} 行找不到` : ''}`;
  } finally {
    locating.value = false;
  }
}

function clearIsolation(): void {
  locator.clear();
  locateNote.value = null;
  activeRow.value = null;
}

function canLocate(row: RvmMismatch): boolean {
  return !!mismatchLocateTarget(row.name) && locator.resolved[row.name] !== null;
}

function viaOwner(row: RvmMismatch): boolean {
  return !!mismatchLocateTarget(row.name)?.viaOwner;
}

async function locateRow(row: RvmMismatch, index: number): Promise<void> {
  const error = await locator.locateRow(props.report.refno, row.name);
  rowNotes.value = { ...rowNotes.value, [index]: error ?? '' };
  if (!error) activeRow.value = index;
}

function toggleRow(index: number): void {
  expanded.value = { ...expanded.value, [index]: !expanded.value[index] };
}

async function download(name: string): Promise<void> {
  filesOpen.value = false;
  downloadError.value = null;
  try {
    await downloadRvmCheckFile(props.taskId, name);
  } catch (cause) {
    downloadError.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function rowSubtitle(row: RvmMismatch): string {
  return [categoryLabel(row.category), row.noun].filter(Boolean).join(' · ');
}

function kindsText(row: RvmMismatch): string {
  return `E3D ${summarizeKinds(row.baseline_kinds) || '无'} · 生成 ${summarizeKinds(row.generated_kinds) || '无'}`;
}

/** 选中行蓝底加左侧竖条，其余隔行加底色；展开的详情行跟着它的行走 */
function rowClass(index: number, position: number): string {
  if (activeRow.value === index) return 'bg-sky-50 shadow-[inset_2px_0_0_theme(colors.sky.600)]';
  return position % 2 === 1 ? 'bg-muted/30' : '';
}

const chipBase = 'rounded border px-1.5 py-0.5 text-[11px]';
const btnBase = 'inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-40';
</script>

<template>
  <section class="flex min-h-0 flex-col gap-2" data-testid="rvm-check-result">
    <div class="flex flex-wrap items-start gap-x-2 gap-y-1 text-xs">
      <div class="min-w-0 flex-1" data-testid="rvm-check-title">
        <div class="flex items-baseline gap-1.5">
          <span class="shrink-0 text-[11px] text-muted-foreground">{{ report.noun }}</span>
          <span class="truncate text-sm font-semibold" :title="report.name || report.refno">{{ report.name || report.refno }}</span>
        </div>
        <div class="truncate font-mono text-[11px] text-muted-foreground">
          {{ report.refno }}<template v-if="report.sesno != null"> · 会话 {{ report.sesno }}</template><template v-if="at"> · {{ formatAt(at) }}</template><template v-if="duration"> · {{ duration }}</template>
        </div>
      </div>
      <span class="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <button type="button" :class="btnBase" :disabled="rechecking" data-testid="rvm-check-recheck" @click="recheck">
          <RefreshCw class="h-3 w-3" :class="rechecking ? 'animate-spin' : ''" />
          {{ rechecking ? '已排进队列' : '重新核对' }}
        </button>
        <template v-if="locatable && total">
          <button type="button"
            class="inline-flex items-center gap-1 rounded bg-foreground px-2 py-0.5 text-[11px] text-background disabled:opacity-40"
            :disabled="locating || isolateTargets.length === 0"
            :title="isolateTargets.length === 0 ? '当前筛选下没有要查我们这边的行；勾上「含非几何问题」才能看' : ''"
            data-testid="rvm-check-show-problems"
            @click="showProblems">
            <ScanEye class="h-3 w-3" />
            {{ locating ? '定位中…' : `在 3D 中查看 ${isolateTargets.length} 行` }}
          </button>
          <label class="flex items-center gap-1 text-[11px]">
            <input v-model="includeExternal" type="checkbox" data-testid="rvm-check-include-external" />
            含非几何问题
          </label>
          <button type="button" :class="btnBase" @click="clearIsolation">取消隔离</button>
        </template>
        <span class="relative">
          <button type="button" :class="btnBase" :aria-expanded="filesOpen" aria-haspopup="menu" data-testid="rvm-check-files" @click="filesOpen = !filesOpen">
            <Download class="h-3 w-3" />
            文件
            <ChevronDown class="h-3 w-3" />
          </button>
          <span v-if="filesOpen" role="menu" class="absolute right-0 top-full z-10 mt-1 flex min-w-40 flex-col rounded border border-border bg-background py-1 shadow-md">
            <button v-for="name in report.files"
              :key="name"
              type="button"
              role="menuitem"
              class="px-3 py-1 text-left text-[11px] hover:bg-muted"
              @click="download(name)">
              {{ name }}
            </button>
          </span>
        </span>
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3 py-2" :class="tone.banner" data-testid="rvm-check-banner">
      <span class="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full" :class="tone.iconBg">
        <RvmStatusIcon :verdict="verdict" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="text-sm font-semibold">{{ tone.label }}</span>
          <span v-if="total" class="text-xs">
            {{ oursRows }} 行要查我们这边<template v-if="classified.externalRows">，{{ classified.externalRows }} 行不是几何问题</template>
          </span>
          <span v-else-if="verdict !== 'tool_error'" class="text-xs">{{ report.message }}</span>
        </div>
        <div v-if="mainReasons" class="text-[11px] opacity-80" data-testid="rvm-check-main-reasons">主要原因：{{ mainReasons }}</div>
      </div>
      <dl v-if="counts.length" class="flex shrink-0 items-end gap-4" data-testid="rvm-check-banner-counts">
        <div v-for="item in counts" :key="item.label" class="flex flex-col items-end leading-tight">
          <dd class="font-mono text-base font-semibold">{{ item.value }}</dd>
          <dt class="text-[10px] opacity-80">{{ item.label }}</dt>
        </div>
      </dl>
      <div v-if="verdictHint" class="basis-full text-[11px]" data-testid="rvm-check-verdict-hint">{{ verdictHint }}</div>
      <div v-if="verdict === 'tool_error'" class="basis-full rounded border border-stone-300 bg-background/70 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-stone-700" data-testid="rvm-check-tool-error">
        <span class="text-muted-foreground">{{ report.stage }}</span>
        <span class="block whitespace-pre-wrap break-all">{{ report.message }}</span>
      </div>
    </div>

    <div v-if="toolErrorFiles.length" class="flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="rvm-check-tool-error-files">
      <span class="text-muted-foreground">排查先看：</span>
      <button v-for="name in toolErrorFiles" :key="name" type="button" :class="btnBase" data-testid="rvm-check-tool-error-file" @click="download(name)">
        <Download class="h-3 w-3" />
        {{ name }}
      </button>
    </div>

    <div v-if="classified.summary.length" class="flex flex-wrap items-center gap-1 text-[11px]" data-testid="rvm-check-reason-summary">
      <button type="button"
        :class="[chipBase, reasonFilter === 'all' ? 'border-foreground bg-foreground text-background' : 'border-border']"
        :aria-pressed="reasonFilter === 'all'"
        @click="toggleReason('all')">
        全部 {{ total }}
      </button>
      <template v-if="oursReasons.length">
        <span class="ml-1 text-muted-foreground">要查</span>
        <button v-for="item in oursReasons"
          :key="item.reason"
          type="button"
          :class="[chipBase, reasonInfo(item.reason).chip, reasonFilter === item.reason ? 'ring-1 ring-foreground/60' : '']"
          :aria-pressed="reasonFilter === item.reason"
          data-testid="rvm-check-reason-chip"
          :data-reason="item.reason"
          @click="toggleReason(item.reason)">
          {{ reasonInfo(item.reason).label }} {{ item.count }}
        </button>
      </template>
      <template v-if="externalReasons.length">
        <span class="mx-1 h-3.5 w-px bg-border" />
        <span class="text-muted-foreground" title="不算我们的问题，默认不在 3D 里隔离">非几何</span>
        <button v-for="item in externalReasons"
          :key="item.reason"
          type="button"
          :class="[chipBase, reasonInfo(item.reason).chip, reasonFilter === item.reason ? 'ring-1 ring-foreground/60' : '']"
          :aria-pressed="reasonFilter === item.reason"
          data-testid="rvm-check-reason-chip"
          :data-reason="item.reason"
          @click="toggleReason(item.reason)">
          {{ reasonInfo(item.reason).label }} {{ item.count }}
        </button>
      </template>
      <span v-if="logState === 'loading'" class="text-muted-foreground" data-testid="rvm-check-log-state">正在读 e3d.log…</span>
      <span v-else-if="logState === 'failed'" class="text-amber-700" data-testid="rvm-check-log-state">没读到 e3d.log，「E3D 目录错误」这一类分不出来</span>
      <label class="ml-auto flex items-center gap-1 text-muted-foreground">
        排序
        <select v-model="sortMode" class="rounded border border-border bg-background px-1 py-0.5 text-foreground">
          <option value="delta_desc">偏差从大到小</option>
          <option value="delta_asc">偏差从小到大</option>
          <option value="reason">按原因</option>
        </select>
      </label>
    </div>

    <p v-if="locateNote || downloadError" class="text-[11px]" :class="downloadError ? 'text-red-700' : 'text-muted-foreground'">
      {{ downloadError || locateNote }}
    </p>

    <div v-if="total" class="min-h-40 flex-1 overflow-auto rounded border border-border">
      <table class="w-full table-fixed text-left text-[11px]">
        <colgroup>
          <col v-if="locatable" class="w-16" />
          <col class="w-24" />
          <col class="w-[38%]" />
          <col />
          <col class="w-16" />
        </colgroup>
        <thead class="sticky top-0 bg-muted text-muted-foreground">
          <tr class="border-b border-border">
            <th v-if="locatable" class="px-2 py-1 font-medium"><span class="sr-only">定位</span></th>
            <th class="px-2 py-1 font-medium">原因</th>
            <th class="px-2 py-1 font-medium">构件</th>
            <th class="px-2 py-1 font-medium">差异</th>
            <th class="px-2 py-1 text-right font-medium">偏差 mm</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rows.length === 0">
            <td :colspan="locatable ? 5 : 4" class="px-2 py-3 text-muted-foreground">这个原因下没有行。</td>
          </tr>
          <template v-for="({ row, index, detail }, position) in rows" :key="index">
            <tr class="cursor-pointer border-b border-border/60 align-top hover:bg-muted/60"
              :class="[rowClass(index, position), reasonInfo(detail.reason).ours ? '' : 'text-muted-foreground']"
              :aria-expanded="!!expanded[index]"
              data-testid="rvm-check-row"
              @click="toggleRow(index)">
              <td v-if="locatable" class="whitespace-nowrap px-2 py-1" @click.stop>
                <button v-if="canLocate(row)"
                  type="button"
                  class="inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 hover:bg-muted disabled:opacity-40"
                  :class="activeRow === index ? 'border-sky-600 text-sky-700' : 'border-border'"
                  :disabled="locator.resolved[row.name] === 'pending'"
                  :title="viaOwner(row) ? '无名构件，定位到最近的有名属主' : '在 3D 中选中并飞过去'"
                  data-testid="rvm-check-locate-row"
                  @click="locateRow(row, index)">
                  <CornerLeftUp v-if="viaOwner(row)" class="h-3 w-3" />
                  <Crosshair v-else class="h-3 w-3" />
                  {{ locator.resolved[row.name] === 'pending' ? '…' : (viaOwner(row) ? '属主' : '定位') }}
                </button>
                <span v-else class="px-1.5 text-muted-foreground" title="这一行的名称在模型树里找不到对应构件">—</span>
              </td>
              <td class="px-2 py-1">
                <span class="whitespace-nowrap rounded border px-1 py-0.5" :class="reasonInfo(detail.reason).chip" data-testid="rvm-check-row-reason">
                  {{ reasonInfo(detail.reason).label }}
                </span>
              </td>
              <td class="px-2 py-1">
                <div class="flex items-start gap-1">
                  <ChevronRight class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform" :class="expanded[index] ? 'rotate-90' : ''" />
                  <div class="min-w-0">
                    <div class="break-all font-mono text-[10.5px] text-foreground" :title="row.name">{{ mismatchDisplayName(row.name) }}</div>
                    <div class="text-[10px] text-muted-foreground">{{ rowSubtitle(row) }}</div>
                  </div>
                </div>
              </td>
              <td class="px-2 py-1">
                {{ detail.text ?? describeMismatch(row) }}
                <span v-if="rowNotes[index]" class="block text-red-700">{{ rowNotes[index] }}</span>
              </td>
              <td class="px-2 py-1 text-right font-mono">{{ formatDeltaMm(row.max_axis_delta_mm) }}</td>
            </tr>
            <tr v-if="expanded[index]" class="border-b border-border/60" :class="rowClass(index, position)" data-testid="rvm-check-row-detail">
              <td :colspan="locatable ? 5 : 4" class="px-2 pb-2 pt-0.5">
                <dl class="grid grid-cols-3 gap-x-4 pl-[calc(6rem+1.25rem)] text-[10.5px]">
                  <div class="min-w-0">
                    <dt class="text-[10px] text-muted-foreground">图元</dt>
                    <dd class="break-all font-mono">{{ kindsText(row) }}</dd>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-[10px] text-muted-foreground">E3D 包围盒</dt>
                    <dd class="break-all font-mono">{{ formatAabb(row.baseline_aabb) || '—' }}</dd>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-[10px] text-muted-foreground">生成包围盒</dt>
                    <dd class="break-all font-mono">{{ formatAabb(row.generated_aabb) || '—' }}</dd>
                  </div>
                </dl>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
      <span v-if="total">显示 {{ rows.length }} / {{ total }} 行</span>
      <span v-if="report.mismatches_truncated" class="inline-flex items-center gap-1 text-amber-700">
        <TriangleAlert class="h-3 w-3" />
        不一致清单只保留了前 400 条
      </span>
      <span v-if="report.centreline_only_baseline.length">中心线只在 E3D 一侧：{{ report.centreline_only_baseline.join('、') }}，这不算失败。</span>
    </div>
  </section>
</template>
