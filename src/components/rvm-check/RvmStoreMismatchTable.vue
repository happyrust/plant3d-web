<script setup lang="ts">
/**
 * 库内差异明细的表：一行一条差异，点开看两侧的图元种类和包围盒。
 * `stage_failure` 行（某一步没跑完）在原因前面标出它是缺基准、生成失败、生成超时、内存护栏还是比对失败。
 */
import { computed, ref, watch } from 'vue';

import { ChevronRight, CornerLeftUp, Crosshair } from 'lucide-vue-next';

import { describeMismatch, formatAabb, formatDeltaMm, summarizeKinds } from './rvmCheckFormat';
import {
  FAILURE_CLASSES,
  reasonKindInfo,
  severityInfo,
  stageFailureClass,
  storeCategoryLabel,
  storeLocateTarget,
  type RvmFailureClassInfo,
} from './rvmStoreFormat';
import { useRvmMismatchLocate } from './useRvmMismatchLocate';

import type { RvmStoreMismatch } from '@/api/rvmCheckStoreApi';

const props = withDefaults(defineProps<{
  rows: RvmStoreMismatch[];
  /** 跨单元看时多一列「所在单元」 */
  showUnit?: boolean;
  /** 工作台里有三维视图，才给「定位」 */
  locatable?: boolean;
  /** 只看一次运行时给它的终态：没跑完的那一类以终态为准 */
  runStatus?: string | null;
}>(), { showUnit: false, locatable: false, runStatus: null });

const emit = defineEmits<{ 'open-unit': [row: RvmStoreMismatch] }>();

const locator = useRvmMismatchLocate();

const expanded = ref<Record<string, boolean>>({});
const activeKey = ref<string | null>(null);
const notes = ref<Record<string, string>>({});

watch(() => props.rows, () => {
  expanded.value = {};
  activeKey.value = null;
  notes.value = {};
});

const columns = computed(() => 7 + (props.showUnit ? 1 : 0) + (props.locatable ? 1 : 0));

function keyOf(row: RvmStoreMismatch): string {
  return `${row.run_id}#${row.seq}`;
}

function toggle(row: RvmStoreMismatch): void {
  const key = keyOf(row);
  expanded.value = { ...expanded.value, [key]: !expanded.value[key] };
}

function isStageFailure(row: RvmStoreMismatch): boolean {
  return row.category === 'stage_failure';
}

function failure(row: RvmStoreMismatch): RvmFailureClassInfo {
  return FAILURE_CLASSES[stageFailureClass(row.reason_kind, props.runStatus)];
}

/** 原因那句话；老行没存这一格时按分类和包围盒现算一句。 */
function reasonText(row: RvmStoreMismatch): string {
  if (row.reason) return row.reason;
  return describeMismatch({
    category: row.category,
    name: row.name ?? '',
    noun: row.noun ?? '',
    max_axis_delta_mm: row.max_axis_delta_mm ?? null,
    baseline_kinds: row.baseline_kinds ?? [],
    generated_kinds: row.generated_kinds ?? [],
    baseline_aabb: row.baseline_aabb ?? null,
    generated_aabb: row.generated_aabb ?? null,
  });
}

function kindsText(row: RvmStoreMismatch): string {
  return `E3D ${summarizeKinds(row.baseline_kinds) || '无'} · 生成 ${summarizeKinds(row.generated_kinds) || '无'}`;
}

function locateState(row: RvmStoreMismatch): 'none' | 'pending' | 'ready' {
  const target = storeLocateTarget(row.name);
  if (!target) return 'none';
  const found = locator.resolved[target.name];
  if (found === null) return 'none';
  return found === 'pending' ? 'pending' : 'ready';
}

function viaOwner(row: RvmStoreMismatch): boolean {
  return !!storeLocateTarget(row.name)?.viaOwner;
}

async function locate(row: RvmStoreMismatch): Promise<void> {
  const target = storeLocateTarget(row.name);
  if (!target) return;
  const key = keyOf(row);
  const error = await locator.locateRow(row.refno, target.name);
  notes.value = { ...notes.value, [key]: error ?? '' };
  if (!error) activeKey.value = key;
}

function rowClass(row: RvmStoreMismatch, position: number): string {
  if (activeKey.value === keyOf(row)) return 'bg-sky-50 shadow-[inset_2px_0_0_theme(colors.sky.600)]';
  return position % 2 === 1 ? 'bg-muted/30' : '';
}
</script>

<template>
  <table class="w-full table-fixed text-left text-[11px]" :class="showUnit || locatable ? 'min-w-[1080px]' : 'min-w-[900px]'" data-testid="rvm-store-mismatch-table">
    <colgroup>
      <col class="w-12" />
      <col class="w-24" />
      <col class="w-32" />
      <col />
      <col class="w-[24%]" />
      <col class="w-14" />
      <col class="w-20" />
      <col v-if="showUnit" class="w-28" />
      <col v-if="locatable" class="w-16" />
    </colgroup>
    <thead class="sticky top-0 z-[1] bg-muted text-muted-foreground">
      <tr class="border-b border-border">
        <th scope="col" class="px-2 py-1 font-medium">级别</th>
        <th scope="col" class="px-2 py-1 font-medium">分类</th>
        <th scope="col" class="px-2 py-1 font-medium">原因种类</th>
        <th scope="col" class="px-2 py-1 font-medium">原因</th>
        <th scope="col" class="px-2 py-1 font-medium">构件</th>
        <th scope="col" class="px-2 py-1 font-medium">noun</th>
        <th scope="col" class="px-2 py-1 text-right font-medium">最大轴差 mm</th>
        <th v-if="showUnit" scope="col" class="px-2 py-1 font-medium">所在单元</th>
        <th v-if="locatable" scope="col" class="px-2 py-1 font-medium"><span class="sr-only">定位</span></th>
      </tr>
    </thead>
    <tbody>
      <template v-for="(row, position) in rows" :key="keyOf(row)">
        <tr class="cursor-pointer border-b border-border/60 align-top hover:bg-muted/60"
          :class="[rowClass(row, position), severityInfo(row.severity).severity === 'info' ? 'text-muted-foreground' : '']"
          data-testid="rvm-store-mismatch-row"
          :data-category="row.category"
          @click="toggle(row)">
          <td class="px-2 py-1">
            <span class="whitespace-nowrap rounded border px-1 py-0.5" :class="severityInfo(row.severity).chip" data-testid="rvm-store-row-severity">{{ severityInfo(row.severity).label }}</span>
          </td>
          <td class="px-2 py-1" :title="row.category">{{ storeCategoryLabel(row.category) }}</td>
          <td class="px-2 py-1" :title="`${row.reason_kind}${reasonKindInfo(row.reason_kind).hint ? `：${reasonKindInfo(row.reason_kind).hint}` : ''}`" data-testid="rvm-store-row-reason-kind">
            {{ reasonKindInfo(row.reason_kind).label }}
          </td>
          <td class="px-2 py-1" data-testid="rvm-store-row-reason">
            <span v-if="isStageFailure(row)"
              class="mr-1 inline-flex whitespace-nowrap rounded border border-stone-300 bg-stone-100 px-1 py-0.5 font-medium text-stone-700"
              :title="failure(row).hint"
              data-testid="rvm-store-failure-class">{{ failure(row).label }}</span>
            <span :class="isStageFailure(row) ? 'break-all font-mono text-[10.5px]' : ''">{{ reasonText(row) }}</span>
            <span v-if="notes[keyOf(row)]" class="block text-red-700">{{ notes[keyOf(row)] }}</span>
          </td>
          <td class="px-2 py-1">
            <button type="button"
              class="flex w-full items-start gap-1 text-left"
              :aria-expanded="!!expanded[keyOf(row)]"
              :aria-label="`${expanded[keyOf(row)] ? '收起' : '展开'} ${row.name || row.refno} 的图元种类和包围盒`"
              data-testid="rvm-store-row-toggle"
              @click.stop="toggle(row)">
              <ChevronRight class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform" :class="expanded[keyOf(row)] ? 'rotate-90' : ''" aria-hidden="true" />
              <span class="min-w-0 break-all font-mono text-[10.5px] text-foreground" :title="row.name ?? ''">{{ row.name || '—' }}</span>
            </button>
          </td>
          <td class="px-2 py-1 font-mono">{{ row.noun || '—' }}</td>
          <td class="px-2 py-1 text-right font-mono">{{ formatDeltaMm(row.max_axis_delta_mm) || '—' }}</td>
          <td v-if="showUnit" class="px-2 py-1">
            <button type="button"
              class="font-mono text-[10.5px] text-foreground underline-offset-2 hover:underline"
              title="看这个单元的全部差异"
              data-testid="rvm-store-row-unit"
              @click.stop="emit('open-unit', row)">
              {{ row.refno }}
            </button>
          </td>
          <td v-if="locatable" class="whitespace-nowrap px-2 py-1" @click.stop>
            <button v-if="locateState(row) !== 'none'"
              type="button"
              class="inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 hover:bg-muted disabled:opacity-40"
              :class="activeKey === keyOf(row) ? 'border-sky-600 text-sky-700' : 'border-border'"
              :disabled="locateState(row) === 'pending'"
              :title="viaOwner(row) ? '这一件没有自己的名称，定位到最近的有名属主' : '在 3D 中选中并飞过去'"
              data-testid="rvm-store-locate-row"
              @click="locate(row)">
              <CornerLeftUp v-if="viaOwner(row)" class="h-3 w-3" aria-hidden="true" />
              <Crosshair v-else class="h-3 w-3" aria-hidden="true" />
              {{ locateState(row) === 'pending' ? '…' : (viaOwner(row) ? '属主' : '定位') }}
            </button>
            <span v-else class="px-1.5 text-muted-foreground" title="这一行的名称在模型树里找不到对应构件">—</span>
          </td>
        </tr>
        <tr v-if="expanded[keyOf(row)]" class="border-b border-border/60" :class="rowClass(row, position)" data-testid="rvm-store-row-detail">
          <td :colspan="columns" class="px-2 pb-2 pt-0.5">
            <dl class="grid grid-cols-1 gap-x-4 gap-y-1 pl-5 text-[10.5px] sm:grid-cols-3">
              <div class="min-w-0">
                <dt class="text-[10px] text-muted-foreground">图元种类</dt>
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
              <div class="min-w-0 sm:col-span-2">
                <dt class="text-[10px] text-muted-foreground">原因种类</dt>
                <dd>
                  {{ reasonKindInfo(row.reason_kind).label }}
                  <span class="font-mono text-muted-foreground">{{ row.reason_kind }}</span>
                  <template v-if="reasonKindInfo(row.reason_kind).hint">：{{ reasonKindInfo(row.reason_kind).hint }}</template>
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-[10px] text-muted-foreground">所在运行</dt>
                <dd class="break-all font-mono">{{ row.run_id }} · 第 {{ row.seq + 1 }} 条</dd>
              </div>
            </dl>
          </td>
        </tr>
      </template>
    </tbody>
  </table>
</template>
