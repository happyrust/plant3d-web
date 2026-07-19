<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { Crosshair, LoaderCircle } from 'lucide-vue-next';

import {
  AnchorMissingError,
  ExpiredError,
  getSnapshot,
  resolveAnchor,
  type ModelHistorySnapshot,
} from '@/api/modelVersionApi';
import { normalizeTreeDiffStatus, type TreeDiffModel } from '@/composables/useTreeVersionDiff';

const props = defineProps<{
  model: TreeDiffModel;
  dbnum?: number;
  fromSesno?: number;
  toSesno?: number;
  /** 幽灵节点不可定位 3D */
  canLocate: boolean;
}>();

const emit = defineEmits<(e: 'locate', refno: string) => void>();

type AttrDiffStatus = 'added' | 'removed' | 'changed';

type AttrDiffRow = {
  name: string;
  before: unknown;
  after: unknown;
  status: AttrDiffStatus;
};

const rows = ref<AttrDiffRow[]>([]);
const loading = ref(false);
/** 降级原因（非空即渲染「属性差异暂不可用」区，不回落演示数据，FR-012） */
const unavailable = ref<string | null>(null);
/** resolve-anchor 回退命中提示（exact=false） */
const fallbackHint = ref<string | null>(null);
let requestSeq = 0;
let inFlight: AbortController | null = null;

const status = computed(() => normalizeTreeDiffStatus(props.model.status));

const statusBadge = computed(() => {
  if (status.value === 'added') return { label: '增', cls: 'bg-success-subtle text-success border-success' };
  if (status.value === 'deleted') return { label: '删', cls: 'bg-danger-subtle text-danger border-danger' };
  return { label: '改', cls: 'bg-warning-subtle text-warning border-warning' };
});

const fromLabel = computed(() => (props.fromSesno ? `变更前 · ${props.fromSesno}` : '变更前'));
const toLabel = computed(() => (props.toSesno ? `变更后 · ${props.toSesno}` : '变更后'));

function cellText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function beforeCellClass(row: AttrDiffRow): string {
  if (row.status === 'changed' || row.status === 'removed') return 'bg-danger-subtle text-danger';
  return 'text-foreground/80';
}

function afterCellClass(row: AttrDiffRow): string {
  if (row.status === 'changed' || row.status === 'added') return 'bg-success-subtle text-success';
  return 'text-foreground/80';
}

// ---------------------------------------------------------------------------
// 前端做差：对 from/to 两份元素快照的 pe / att 字段逐属性比对。
// 与 rs-core version_query::flatten_changes 对齐：pe 无前缀、att 前缀 `att.`、
// 跳过 `id`、仅产出有差异的行（changed / added / removed），未变更属性不出行。
// ---------------------------------------------------------------------------

const ABSENT = Symbol('absent');

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function diffValue(path: string, before: unknown, after: unknown, out: AttrDiffRow[]): void {
  const hasBefore = before !== ABSENT;
  const hasAfter = after !== ABSENT;
  if (!hasBefore && !hasAfter) return;
  if (!hasBefore) {
    out.push({ name: path, before: undefined, after, status: 'added' });
    return;
  }
  if (!hasAfter) {
    out.push({ name: path, before, after: undefined, status: 'removed' });
    return;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    diffObject(path, before, after, out);
    return;
  }
  if (!valuesEqual(before, after)) {
    out.push({ name: path, before, after, status: 'changed' });
  }
}

function diffObject(
  prefix: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  out: AttrDiffRow[],
): void {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  for (const key of keys) {
    if (key === 'id') continue;
    const childPath = prefix ? `${prefix}.${key}` : key;
    const b = Object.prototype.hasOwnProperty.call(before, key) ? before[key] : ABSENT;
    const a = Object.prototype.hasOwnProperty.call(after, key) ? after[key] : ABSENT;
    diffValue(childPath, b, a, out);
  }
}

function diffSnapshots(fromSnap: ModelHistorySnapshot, toSnap: ModelHistorySnapshot): AttrDiffRow[] {
  const out: AttrDiffRow[] = [];
  diffObject('', asObject(fromSnap.pe), asObject(toSnap.pe), out);
  diffObject('att', asObject(fromSnap.att), asObject(toSnap.att), out);
  return out;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function describeError(error: unknown): string {
  if (error instanceof ExpiredError) return `历史已过期（${error.message}）`;
  if (error instanceof AnchorMissingError) return `锚点缺失（${error.message}）`;
  return error instanceof Error ? error.message : String(error);
}

async function reload() {
  const seq = ++requestSeq;
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  rows.value = [];
  unavailable.value = null;
  fallbackHint.value = null;

  const dbnum = props.dbnum;
  const from = props.fromSesno;
  const to = props.toSesno;
  if (!dbnum || from === undefined || to === undefined) {
    unavailable.value = '缺少版本上下文（dbnum / sesno），无法查询属性差异';
    return;
  }

  const refno = props.model.refno;
  const opts = { signal: controller.signal };
  loading.value = true;
  try {
    // 先解析 from/to 两个锚点（任一失败即整体降级，getSnapshot 不再发起）
    const [fromAnchor, toAnchor] = await Promise.all([
      resolveAnchor(dbnum, from, undefined, opts),
      resolveAnchor(dbnum, to, undefined, opts),
    ]);
    if (seq !== requestSeq) return;

    // 用解析出的锚点 sesno 各取一份元素快照，前端做差
    const [fromSnap, toSnap] = await Promise.all([
      getSnapshot(dbnum, fromAnchor.sesno, refno, undefined, opts),
      getSnapshot(dbnum, toAnchor.sesno, refno, undefined, opts),
    ]);
    if (seq !== requestSeq) return;

    const fellBack = Array.from(new Set(
      [fromAnchor, toAnchor].filter((hit) => hit.exact === false).map((hit) => hit.sesno),
    ));
    if (fellBack.length > 0) {
      fallbackHint.value = `已回退到 sesno ${fellBack.join('、')}`;
    }

    rows.value = diffSnapshots(fromSnap, toSnap);
  } catch (e) {
    if (seq !== requestSeq) return;
    if (isAbortError(e)) return;
    unavailable.value = describeError(e);
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

watch(
  () => [props.model.refno, props.dbnum, props.fromSesno, props.toSesno] as const,
  () => {
    void reload();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  inFlight?.abort();
});
</script>

<template>
  <div class="flex min-h-0 flex-col border-t border-border bg-background"
    data-testid="model-tree-diff-attr-panel">
    <div class="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="shrink-0 text-xs font-medium text-foreground">属性差异</span>
        <span class="truncate font-mono text-xs text-muted-foreground">{{ model.refno }}</span>
        <span class="inline-flex shrink-0 items-center rounded border px-1 text-[10px] leading-4"
          :class="statusBadge.cls">
          {{ statusBadge.label }}
        </span>
      </div>
      <button type="button"
        class="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-input px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canLocate"
        :title="canLocate ? '在 3D 中加载并定位该模型' : '幽灵节点仅展示，不可定位 3D'"
        data-testid="model-tree-diff-attr-locate"
        @click="emit('locate', model.refno)">
        <Crosshair class="h-3 w-3" />
        在 3D 中定位
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-3 pb-1">
      <div v-if="loading" class="flex items-center gap-1.5 py-3 text-xs text-muted-foreground">
        <LoaderCircle class="h-3.5 w-3.5 animate-spin" />
        属性差异加载中…
      </div>
      <div v-else-if="unavailable" class="py-3 text-xs" data-testid="attr-diff-unavailable">
        <div class="font-medium text-foreground/80">属性差异暂不可用</div>
        <div class="mt-0.5 text-muted-foreground">{{ unavailable }}</div>
      </div>
      <template v-else>
        <div v-if="fallbackHint"
          class="mb-1 rounded border border-warning bg-warning-subtle px-2 py-1 text-[11px] text-warning"
          data-testid="attr-diff-anchor-fallback">
          {{ fallbackHint }}
        </div>
        <table class="w-full border-collapse text-xs" data-testid="attr-diff-table">
          <thead>
            <tr class="border-b border-border text-left text-[11px] text-muted-foreground">
              <th class="py-1 pr-2 font-normal">属性</th>
              <th class="py-1 pr-2 font-normal">{{ fromLabel }}</th>
              <th class="py-1 font-normal">{{ toLabel }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.name" class="border-b border-border/50">
              <td class="py-1 pr-2 font-mono text-[11px] text-muted-foreground">{{ row.name }}</td>
              <td class="py-1 pr-2" :class="beforeCellClass(row)">
                <span class="inline-block rounded px-1">{{ cellText(row.before) }}</span>
              </td>
              <td class="py-1" :class="afterCellClass(row)">
                <span class="inline-block rounded px-1">{{ cellText(row.after) }}</span>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="3" class="py-3 text-center text-muted-foreground">无属性差异记录</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <div class="px-3 pb-2 pt-1 text-[10px] leading-4 text-muted-foreground/80">
      点击带徽章节点查看属性差异；幽灵节点仅展示，不可定位 3D
    </div>
  </div>
</template>
