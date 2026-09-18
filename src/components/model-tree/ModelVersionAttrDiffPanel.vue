<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { LoaderCircle } from 'lucide-vue-next';

import type { ModelVersionAttributeRow, ModelVersionAttributes } from '@/model-source/ports';

import { normalizeTreeDiffStatus, type TreeDiffAttributesAt, type TreeDiffModel } from '@/composables/useTreeVersionDiff';
import { diffAttributeRows, type AttrDiffRow } from '@/utils/modelVersionAttrDiff';

/**
 * 差异模式底部的「属性历史对比」：选中的变更构件在版本 A / B 下的属性逐项 before / after。
 *
 * 取数经 `TreeDiffContext.attributesAt`（版本对比面板闭包住两份版本几何的句柄），行与属性面板同型
 * （gen-model-refactor `history/query tool=attributes`，契约见其 ADR-081 候选条）。这里只做差、不认数据源：
 * 一侧 `exists: false` = 该版本下构件不存在（还没建 / 已删），是正常态；取数失败才是「暂不可用」。
 * 2026-09-18 之前这块是钉在 legacy `/api/model-history/*` 上的 `ModelTreeAttrDiffPanel`，随 legacy 版本链退役（plan §7.2 第 6 组）。
 */
const props = defineProps<{
  model: TreeDiffModel;
  fromSesno?: number;
  toSesno?: number;
  attributesAt?: TreeDiffAttributesAt;
}>();

const rows = ref<AttrDiffRow[]>([]);
const sides = ref<{ before: ModelVersionAttributes; after: ModelVersionAttributes } | null>(null);
const loading = ref(false);
const unavailable = ref<string | null>(null);
const showUnchanged = ref(false);
let requestSeq = 0;
let inFlight: AbortController | null = null;

const status = computed(() => normalizeTreeDiffStatus(props.model.status));
const statusBadge = computed(() => {
  if (status.value === 'added') return { label: '增', cls: 'bg-success-subtle text-success border-success' };
  if (status.value === 'deleted') return { label: '删', cls: 'bg-danger-subtle text-danger border-danger' };
  return { label: '改', cls: 'bg-warning-subtle text-warning border-warning' };
});
const fromLabel = computed(() => (props.fromSesno !== undefined ? `A · sesno ${props.fromSesno}` : 'A'));
const toLabel = computed(() => (props.toSesno !== undefined ? `B · sesno ${props.toSesno}` : 'B'));

const changedCount = computed(() => rows.value.filter((row) => row.status !== 'unchanged').length);
const visibleRows = computed(() => (showUnchanged.value ? rows.value : rows.value.filter((row) => row.status !== 'unchanged')));

function cellText(row: ModelVersionAttributeRow | null): string {
  if (!row) return '—';
  if (row.isUnset) return 'unset';
  return row.display === '' ? '—' : row.display;
}

function beforeCellClass(row: AttrDiffRow): string {
  if (row.status === 'changed' || row.status === 'only-before') return 'bg-danger-subtle text-danger';
  return 'text-foreground/80';
}

function afterCellClass(row: AttrDiffRow): string {
  if (row.status === 'changed' || row.status === 'only-after') return 'bg-success-subtle text-success';
  return 'text-foreground/80';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function reload(): Promise<void> {
  const seq = ++requestSeq;
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  rows.value = [];
  sides.value = null;
  unavailable.value = null;

  const attributesAt = props.attributesAt;
  if (!attributesAt) {
    unavailable.value = '本次差异上下文没有带属性取数口（请重新运行版本对比）';
    return;
  }
  const refno = props.model.refno;
  loading.value = true;
  try {
    const [before, after] = await Promise.all([
      attributesAt('before', refno, controller.signal),
      attributesAt('after', refno, controller.signal),
    ]);
    if (seq !== requestSeq) return;
    sides.value = { before, after };
    rows.value = diffAttributeRows(before.exists ? before.attributes : [], after.exists ? after.attributes : []);
  } catch (error) {
    if (seq !== requestSeq || isAbortError(error)) return;
    unavailable.value = messageOf(error);
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

watch(
  () => [props.model.refno, props.fromSesno, props.toSesno, props.attributesAt] as const,
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
    data-testid="model-version-attr-diff-panel">
    <div class="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="shrink-0 text-xs font-medium text-foreground">属性历史对比</span>
        <span class="truncate font-mono text-xs text-muted-foreground">{{ model.refno }}</span>
        <span class="inline-flex shrink-0 items-center rounded border px-1 text-[10px] leading-4"
          :class="statusBadge.cls">
          {{ statusBadge.label }}
        </span>
        <span v-if="sides && rows.length > 0" class="shrink-0 text-[10px] text-muted-foreground" data-testid="attr-diff-count">
          变更 {{ changedCount }} / {{ rows.length }}
        </span>
      </div>
      <label v-if="sides && rows.length > 0" class="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
        <input v-model="showUnchanged" type="checkbox" class="h-3 w-3" data-testid="attr-diff-show-unchanged" />
        显示未变
      </label>
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-3 pb-1">
      <div v-if="loading" class="flex items-center gap-1.5 py-3 text-xs text-muted-foreground">
        <LoaderCircle class="h-3.5 w-3.5 animate-spin" />
        属性加载中…
      </div>
      <div v-else-if="unavailable" class="py-3 text-xs" data-testid="attr-diff-unavailable">
        <div class="font-medium text-foreground/80">属性历史对比暂不可用</div>
        <div class="mt-0.5 break-all text-muted-foreground">{{ unavailable }}</div>
      </div>
      <template v-else-if="sides">
        <div v-if="!sides.before.exists || !sides.after.exists"
          class="mb-1 rounded border border-warning bg-warning-subtle px-2 py-1 text-[11px] text-warning"
          data-testid="attr-diff-missing-side">
          <template v-if="!sides.before.exists && !sides.after.exists">该构件在 A / B 两个版本下都不存在</template>
          <template v-else-if="!sides.before.exists">该构件在版本 A 不存在（新建于 A 之后）</template>
          <template v-else>该构件在版本 B 不存在（已删除）</template>
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
            <tr v-for="row in visibleRows" :key="row.name" class="border-b border-border/50" :data-attr-status="row.status">
              <td class="py-1 pr-2 font-mono text-[11px] text-muted-foreground">{{ row.name }}</td>
              <td class="py-1 pr-2" :class="beforeCellClass(row)">
                <span class="inline-block rounded px-1">{{ cellText(row.before) }}</span>
              </td>
              <td class="py-1" :class="afterCellClass(row)">
                <span class="inline-block rounded px-1">{{ cellText(row.after) }}</span>
              </td>
            </tr>
            <tr v-if="visibleRows.length === 0">
              <td colspan="3" class="py-3 text-center text-muted-foreground" data-testid="attr-diff-empty">
                {{ rows.length === 0 ? '两个版本下都没有属性可比' : '属性无差异' }}
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <div class="px-3 pb-2 pt-1 text-[10px] leading-4 text-muted-foreground/80">
      点击带徽章节点查看该构件在 A / B 两版下的属性；两侧由同一个渲染器印字，字不同就是变了
    </div>
  </div>
</template>
