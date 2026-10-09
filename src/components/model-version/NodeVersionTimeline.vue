<script setup lang="ts">
import { Check, Link } from 'lucide-vue-next';

import { impactClass, impactLabel } from './nodeVersionPanelFormat';

import type { ModelNodeDiffScope } from '@/model-source';

import { formatModelUnitVersionTime } from '@/utils/modelUnitVersionCompare';
import {
  NODE_TIMELINE_INITIAL_ROWS,
  timelineRowAttributeOnly,
  timelineRowImpact,
  type NodeTimelineRow,
  type NodeTimelineSlice,
} from '@/utils/nodeVersionTimeline';

/**
 * 节点版本面板的「版本时间线」块（版本对比审核计划 P2-2 从 `ModelUnitVersionComparePanel` 拆出）：标题与两个勾选、
 * 「与上一版比 / 与最新比 / 复制链接」、A / B 时间下拉、手填会话号（容器撞上旧服务端）、逐行 A / B 按钮与徽章、「加载更早」。
 * 只画与发事件，状态与选择在 `useNodeVersionTimeline`；`data-testid` 与拆出前逐字相同。
 */

const props = defineProps<{
  /** 全部行（新 → 旧），A / B 时间下拉的选项按它 */
  rows: NodeTimelineRow[];
  /** 实际画出来的那一段 + 折起的更早版数 */
  slice: NodeTimelineSlice;
  counts: { versions: number; attributeOnly: number };
  scope: ModelNodeDiffScope;
  beforeSesno: number | null;
  afterSesno: number | null;
  pairReady: boolean;
  /** 旧服务端只给得出单元那一列：「只看自身变的」置灰、徽章只剩单元列 */
  selfColumnUnknown: boolean;
  /** 查的节点自己就是单元根（或容器）：徽章只画一颗；否则「单元 x」+「本构件 y」两颗 */
  queriedIsUnitRoot: boolean;
  /** 属性变化时间线取不到的原因；null = 取到了 */
  historyUnavailable: string | null;
  /** 容器撞上旧服务端（没有 node/versions）：露出手填会话号那一栏 */
  showManualPair: boolean;
  shareStatus: 'idle' | 'copied' | 'address';
}>();

/** 两个勾选、手填的两个输入框：父组件的 `useNodeVersionTimeline` 持有 */
const selfOnly = defineModel<boolean>('selfOnly', { required: true });
const geometryOnly = defineModel<boolean>('geometryOnly', { required: true });
const manualA = defineModel<string>('manualA', { required: true });
const manualB = defineModel<string>('manualB', { required: true });

const emit = defineEmits<{
  pick: [side: 'a' | 'b', sesno: number];
  withPrevious: [];
  withLatest: [];
  copyLink: [];
  applyManualPair: [];
  expand: [];
}>();

function rowImpact(row: NodeTimelineRow) {
  return timelineRowImpact(row, props.scope, props.selfColumnUnknown);
}

function attributeOnlyShown(row: NodeTimelineRow): boolean {
  return timelineRowAttributeOnly(row, props.scope, props.selfColumnUnknown);
}
</script>

<template>
  <div class="mt-1 flex items-center justify-between gap-2">
    <h3 class="text-xs font-semibold text-foreground" data-testid="model-unit-compare-timeline-head">
      版本时间线 · 本范围 {{ counts.versions }} 版<template v-if="counts.attributeOnly"> · 仅属性 {{ counts.attributeOnly }}</template>
    </h3>
    <span class="flex items-center gap-2 text-[10px] text-muted-foreground">
      <label v-if="scope === 'subtree'" class="flex items-center gap-1" :class="selfColumnUnknown ? 'opacity-50' : ''"
        :title="selfColumnUnknown ? '服务端没给出节点自身那一列，分不出哪些会话是它自己变的' : '只列节点自身记录变过的会话（含只改了属性的）；子树里别的构件动了、它自己没动的不列'">
        <input v-model="selfOnly" type="checkbox" :disabled="selfColumnUnknown" data-testid="model-unit-compare-self-only" />只看自身变的
      </label>
      <label class="flex items-center gap-1">
        <input v-model="geometryOnly" type="checkbox" data-testid="model-unit-compare-geometry-only" />只看几何变的
      </label>
    </span>
  </div>
  <p v-if="historyUnavailable" class="mt-1 text-[10px] text-amber-600" data-testid="model-unit-compare-history-missing">{{ historyUnavailable }}</p>

  <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
    <button type="button" class="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted/50"
      data-testid="model-unit-compare-with-previous" @click="emit('withPrevious')">
      与上一版比
    </button>
    <button type="button" class="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted/50"
      data-testid="model-unit-compare-with-latest" @click="emit('withLatest')">
      与最新比
    </button>
    <button type="button"
      class="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-background text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="!pairReady"
      :aria-label="shareStatus === 'copied' ? '对比链接已复制' : '复制对比链接'"
      :title="shareStatus === 'copied' ? '对比链接已复制' : '复制当前节点与 A/B 版本的直达链接'"
      data-testid="model-unit-compare-copy-link"
      @click="emit('copyLink')">
      <Check v-if="shareStatus === 'copied'" class="h-3 w-3 text-emerald-600" />
      <Link v-else class="h-3 w-3" />
    </button>
  </div>
  <div class="mt-2 grid grid-cols-1 gap-1.5 text-[10px]">
    <label class="min-w-0 text-blue-700" data-testid="model-unit-compare-a" :data-sesno="beforeSesno ?? ''">
      <span class="mb-0.5 block font-semibold">A 时间</span>
      <select class="h-8 w-full rounded-md border border-blue-200 bg-blue-50 px-1.5 text-[11px] font-medium text-blue-800 outline-none focus:ring-2 focus:ring-blue-500"
        :value="beforeSesno ?? ''"
        aria-label="选择 A 版本时间"
        data-testid="model-unit-compare-a-time-select"
        @change="emit('pick', 'a', Number(($event.target as HTMLSelectElement).value))">
        <option v-for="row in rows" :key="`a-${row.sesno}`" :value="row.sesno">
          {{ formatModelUnitVersionTime(row.sessionTime ?? '') || '时间未知' }} · {{ row.sesno }}
        </option>
      </select>
    </label>
    <label class="min-w-0 text-emerald-700" data-testid="model-unit-compare-b" :data-sesno="afterSesno ?? ''">
      <span class="mb-0.5 block font-semibold">B 时间</span>
      <select class="h-8 w-full rounded-md border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-800 outline-none focus:ring-2 focus:ring-emerald-500"
        :value="afterSesno ?? ''"
        aria-label="选择 B 版本时间"
        data-testid="model-unit-compare-b-time-select"
        @change="emit('pick', 'b', Number(($event.target as HTMLSelectElement).value))">
        <option v-for="row in rows" :key="`b-${row.sesno}`" :value="row.sesno">
          {{ formatModelUnitVersionTime(row.sessionTime ?? '') || '时间未知' }} · {{ row.sesno }}
        </option>
      </select>
    </label>
  </div>
  <p v-if="shareStatus === 'address'" class="mt-1 text-right text-[10px] text-amber-700" data-testid="model-unit-compare-copy-link-status">
    浏览器未开放剪贴板，直达链接已写入地址栏
  </p>

  <form v-if="showManualPair" class="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground" data-testid="model-unit-compare-manual-pair" @submit.prevent="emit('applyManualPair')">
    <span>手填会话号</span>
    <input v-model="manualA" class="w-14 rounded border border-input bg-background px-1 py-0.5 font-mono text-[10px]" placeholder="A" inputmode="numeric" data-testid="model-unit-compare-manual-a" />
    <span>→</span>
    <input v-model="manualB" class="w-14 rounded border border-input bg-background px-1 py-0.5 font-mono text-[10px]" placeholder="B" inputmode="numeric" data-testid="model-unit-compare-manual-b" />
    <button type="submit" class="rounded border border-border bg-background px-1.5 py-0.5 text-foreground hover:bg-muted/50" data-testid="model-unit-compare-manual-apply">应用</button>
    <span class="truncate">（容器的子树时间线要新版 node/versions，先手填）</span>
  </form>

  <ul class="mt-2 space-y-1" data-testid="model-unit-compare-timeline">
    <li v-for="row in slice.rows"
      :key="row.sesno"
      class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
      :class="[
        row.sesno === afterSesno ? 'border-emerald-300 bg-emerald-50/60' : row.sesno === beforeSesno ? 'border-blue-300 bg-blue-50/60' : 'border-border',
        row.inScope ? '' : 'opacity-50',
      ]"
      :data-sesno="row.sesno"
      :data-in-scope="row.inScope ? 'true' : 'false'">
      <span class="flex shrink-0 flex-col gap-0.5">
        <button type="button"
          class="rounded px-1 text-[9px] font-bold leading-4"
          :class="row.sesno === beforeSesno ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground hover:bg-blue-100 hover:text-blue-700'"
          :title="`把 sesno ${row.sesno} 设为 A`"
          :data-testid="`model-unit-compare-pick-a-${row.sesno}`"
          @click="emit('pick', 'a', row.sesno)">A</button>
        <button type="button"
          class="rounded px-1 text-[9px] font-bold leading-4"
          :class="row.sesno === afterSesno ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700'"
          :title="`把 sesno ${row.sesno} 设为 B`"
          :data-testid="`model-unit-compare-pick-b-${row.sesno}`"
          @click="emit('pick', 'b', row.sesno)">B</button>
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="font-mono font-semibold text-foreground">sesno {{ row.sesno }}</span>
          <span class="text-[10px] text-muted-foreground">{{ formatModelUnitVersionTime(row.sessionTime ?? '') }}</span>
          <span v-if="row.user" class="text-[10px] text-foreground/80">{{ row.user }}</span>
        </div>
        <div v-if="row.comment" class="truncate text-[10px] text-muted-foreground" :title="row.comment">{{ row.comment }}</div>
      </div>
      <span class="flex shrink-0 flex-wrap justify-end gap-1">
        <span v-if="!row.inScope" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">本范围无变化</span>
        <span v-if="row.changedCount" class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">属性 {{ row.changedCount }}</span>
        <span v-if="scope === 'subtree' && row.unitsChanged !== null && row.unitsChanged > 0"
          class="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700"
          :title="`这一会话有几何要重算的最小交付单元数`"
          data-testid="model-unit-compare-units-changed">单元 {{ row.unitsChanged }}</span>
        <template v-if="queriedIsUnitRoot">
          <span v-if="attributeOnlyShown(row)" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
            title="这一会话只改了不进模型提取的属性（UDA 之类）：版本表不算它一版，属性变化时间线照列"
            data-testid="model-unit-compare-attribute-only">仅属性</span>
          <span v-else class="rounded px-1.5 py-0.5 text-[10px]" :class="impactClass(rowImpact(row))">
            {{ impactLabel(rowImpact(row)) }}
          </span>
        </template>
        <template v-else>
          <span v-if="scope === 'subtree'" class="rounded px-1.5 py-0.5 text-[10px]" :class="impactClass(row.unitImpact)">单元 {{ impactLabel(row.unitImpact) }}</span>
          <span v-if="row.attributeOnly" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
            title="这一会话本构件只改了不进模型提取的属性（UDA 之类）：版本表不算它一版，属性变化时间线照列"
            data-testid="model-unit-compare-attribute-only">本构件 仅属性</span>
          <span v-else class="rounded px-1.5 py-0.5 text-[10px]" :class="impactClass(row.selfImpact)">
            本构件 {{ selfColumnUnknown ? '?' : impactLabel(row.selfImpact) }}
          </span>
        </template>
      </span>
    </li>
  </ul>
  <button v-if="slice.hidden > 0" type="button"
    class="mt-1 w-full rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
    :title="`缺省只列最近 ${NODE_TIMELINE_INITIAL_ROWS} 版；点开列全（版本表早已取回，不再请求服务端）`"
    data-testid="model-unit-compare-timeline-more"
    :data-hidden="slice.hidden"
    @click="emit('expand')">
    加载更早 {{ slice.hidden }} 版…
  </button>
</template>
