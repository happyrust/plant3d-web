<script setup lang="ts">
import { computed } from 'vue';

import { RefreshCw, X } from 'lucide-vue-next';

import { STATUS_CLASS, STATUS_LABEL } from './nodeVersionPanelFormat';

import type { ModelNodeDiffGroup, ModelNodeDiffScope, ModelNodeDiffSummary } from '@/model-source';

import {
  countGroupProjections,
  formatModelUnitVersionTime,
  modelUnitVersionAbsentNote,
  MODEL_UNIT_COMPARE_MAX_UNITS,
  type ModelUnitCompareSide,
  type ModelUnitCompareViewMode,
  type ModelUnitGeometryDiff,
  type ModelUnitGeometryStatus,
  type ModelUnitVersionCompareRuntimeState,
} from '@/utils/modelUnitVersionCompare';

/**
 * 节点版本面板的「模型对比」tab（版本对比审核计划 P2-2 从 `ModelUnitVersionComparePanel` 拆出）：差异摘要卡、「在三维中对比」、
 * 多单元装载进度、阈值确认框、分组列表与总按钮、三维查看运行态卡（单视口 / 分屏 / 只看差异 / 环境）、几何差异摘要与清单。
 * 只画与发事件，装载 / 释放 / 事件派发都在面板；`data-testid` 与拆出前逐字相同。
 */

const props = defineProps<{
  scope: ModelNodeDiffScope;
  pairReady: boolean;
  beforeSesno: number | null;
  afterSesno: number | null;
  hasUnit: boolean;
  /** 对比按这个单元跑；查的是构件时是解出来的所属单元根 */
  comparedUnitRefno: string;
  /** 查的是单元里的某个构件时才有：清单里那一行高亮、标「本构件」 */
  queriedElementRefno: string | null;
  diffSummary: ModelNodeDiffSummary | null;
  loadingSummary: boolean;
  diffSummaryUnavailable: boolean;
  /** `所有子节点` 下有几何要重算的组，每组一个「在三维中对比」 */
  geometryGroups: ModelNodeDiffGroup[];
  comparing: boolean;
  loadingVersions: boolean;
  /** 多单元一次装载的进度「正在生成历史投影 n / m」；m ≤ 2 不露 */
  compareProgress: { done: number; total: number; current: string[] } | null;
  /** 阈值确认（P2-b）待确认的那批组；null = 没在问 */
  pendingGroupsConfirm: ModelNodeDiffGroup[] | null;
  /** 三维里当前装的是哪几个单元 */
  comparedInViewer: string[];
  /** 视口回报的运行态；null = 三维里没在对比 */
  compareRuntime: ModelUnitVersionCompareRuntimeState | null;
  compareCompleted: boolean;
  /** 本次对比的几何差异行（全部，含 unchanged） */
  rows: ModelUnitGeometryDiff[];
  /** 两个版本几何相同的承诺（只加载了一次） */
  sameGeometry: boolean;
}>();

const statusFilter = defineModel<'all' | Exclude<ModelUnitGeometryStatus, 'unchanged'>>('statusFilter', { required: true });
/** 「包含未变化」：与属性对比 tab 的「含戳」是同一个开关（拆出前就共用 `includeUnchanged`） */
const includeUnchanged = defineModel<boolean>('includeUnchanged', { required: true });

const emit = defineEmits<{
  run: [];
  runGroup: [group: ModelNodeDiffGroup];
  runGroups: [groups: readonly ModelNodeDiffGroup[]];
  confirm: [choice: 'all' | 'top' | 'cancel'];
  close: [];
  setViewMode: [viewMode: ModelUnitCompareViewMode];
  setSide: [side: ModelUnitCompareSide];
  setDiffOnly: [diffOnly: boolean];
  refreshEnvironment: [];
  focusRow: [refno: string];
}>();

const summary = computed(() => {
  const counts: Record<ModelUnitGeometryStatus, number> = { added: 0, deleted: 0, modified: 0, unchanged: 0 };
  for (const row of props.rows) counts[row.status] += 1;
  return counts;
});
const noGeometryDifference = computed(() => props.compareCompleted
  && summary.value.added === 0
  && summary.value.deleted === 0
  && summary.value.modified === 0);
const visibleRows = computed(() => props.rows.filter((row) => {
  if (!includeUnchanged.value && row.status === 'unchanged') return false;
  return statusFilter.value === 'all' || row.status === statusFilter.value;
}));

/** 总按钮 / 确认框上的「N 个单元 · 约 M 份历史投影」 */
const groupsProjectionText = computed(() => `${props.geometryGroups.length} 个单元 · 约 ${countGroupProjections(props.geometryGroups)} 份历史投影`);

/** 视口那边正在对比的那份 `rows` 里有没有非 unchanged 的行（没有就把「三维只看差异」置灰） */
const compareRuntimeHasGeometryDifference = computed(() => (
  (props.compareRuntime?.detail.rows ?? []).some((row) => row.status !== 'unchanged')
));

/** 多单元一次装载时，这一侧不存在（tombstone）的那几个单元根：A / B 卡上列出来（并起来的那一侧只有全空才标 tombstone） */
function absentUnits(detail: ModelUnitVersionCompareRuntimeState['detail'], side: ModelUnitCompareSide): string[] {
  return (detail.units ?? []).filter((unit) => unit[side].version.impactKind === 'tombstone').map((unit) => unit.unitRefno);
}

function runCompare(): void { emit('run'); }
function runCompareGroup(group: ModelNodeDiffGroup): void { emit('runGroup', group); }
function runCompareGroups(groups: readonly ModelNodeDiffGroup[]): void { emit('runGroups', groups); }
function confirmGroups(choice: 'all' | 'top' | 'cancel'): void { emit('confirm', choice); }
function closeCompare(): void { emit('close'); }
function setCompareViewMode(viewMode: ModelUnitCompareViewMode): void { emit('setViewMode', viewMode); }
function setCompareSide(side: ModelUnitCompareSide): void { emit('setSide', side); }
function setCompareDiffOnly(diffOnly: boolean): void { emit('setDiffOnly', diffOnly); }
function refreshCompareEnvironment(): void { emit('refreshEnvironment'); }
function focusRow(refno: string): void { emit('focusRow', refno); }
</script>

<template>
  <section class="mt-2" data-testid="model-unit-compare-model">
    <div v-if="diffSummary && pairReady" class="rounded-md border border-border bg-muted/20 p-2" data-testid="model-unit-compare-diff-summary">
      <div class="text-[11px] font-semibold text-foreground">A {{ beforeSesno }} → B {{ afterSesno }} · 差异摘要（未生成几何）</div>
      <div class="mt-1 flex flex-wrap gap-1 text-[10px]">
        <span class="rounded bg-primary/10 px-1.5 py-0.5 text-primary">变了的单元 {{ diffSummary.units.changed }}</span>
        <span class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">未变单元 {{ diffSummary.units.unchanged }}<template v-if="!diffSummary.units.complete">+</template></span>
        <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">新增 {{ diffSummary.elements.added }}</span>
        <span class="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">删除 {{ diffSummary.elements.deleted }}</span>
        <span class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">修改 {{ diffSummary.elements.modified }}</span>
        <span class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">noop {{ diffSummary.elements.noop }}</span>
      </div>
      <p v-if="diffSummary.needsConfirm" class="mt-1 text-[10px] text-amber-700" data-testid="model-unit-compare-needs-confirm">
        变了的单元超过阈值 {{ diffSummary.confirmThresholdUnits }} 个（服务端估约 {{ diffSummary.estimatedProjections }} 份历史投影）：一起进三维前会先问一句，也可以逐组点开看。
      </p>
      <p v-if="diffSummary.warnings.length" class="mt-1 text-[10px] text-muted-foreground">{{ diffSummary.warnings[0] }}</p>
    </div>
    <p v-else-if="loadingSummary" class="text-[10px] text-muted-foreground">正在算差异摘要…</p>
    <p v-else-if="diffSummaryUnavailable && pairReady" class="text-[10px] text-amber-600" data-testid="model-unit-compare-summary-missing">
      服务端还没有 <code>node/diff-summary</code>：差异摘要要新版服务端，直接「在三维中对比」也能拿到几何差异。
    </p>

    <div class="mt-2 flex gap-2">
      <button class="flex-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
        data-testid="model-unit-compare-run"
        :disabled="comparing || loadingVersions || !hasUnit"
        :title="hasUnit ? `装载 ${comparedUnitRefno} 的 A / B 两版` : '不在任何最小交付单元下，没有几何'"
        @click="runCompare">
        {{ comparing ? '正在比较…' : (scope === 'subtree' && geometryGroups.length > 1 ? `在三维中对比 · ${comparedUnitRefno}` : '在三维中对比') }}
      </button>
    </div>

    <!-- 多单元一次装载的进度（P2-a，设计稿 S2b「正在生成历史投影 3 / 4」）：份 = 要去 history/generate 的单元@sesno；单单元（≤ 2 份）不露 -->
    <div v-if="compareProgress && compareProgress.total > 2"
      class="mt-2 rounded-md border border-indigo-200 bg-indigo-50/40 p-2 text-[11px] text-indigo-900"
      data-testid="model-unit-compare-progress"
      :data-done="compareProgress.done"
      :data-total="compareProgress.total">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold">正在生成历史投影 {{ compareProgress.done }} / {{ compareProgress.total }}</span>
        <span class="truncate font-mono text-[10px] opacity-75">{{ compareProgress.current.join(' · ') }}</span>
      </div>
      <div class="mt-1 h-1.5 overflow-hidden rounded bg-indigo-100">
        <div class="h-full rounded bg-indigo-500 transition-[width]" :style="{ width: `${Math.round((compareProgress.done / Math.max(1, compareProgress.total)) * 100)}%` }" />
      </div>
    </div>

    <!-- 阈值确认（P2-b，设计稿 S2b ②）：超过一次装载上限或服务端说要确认时先问；「先装变化最大的 N 个」按组内变更数排 -->
    <div v-if="pendingGroupsConfirm"
      class="mt-2 rounded-md border border-amber-300 bg-amber-50/70 p-2 text-[11px] text-amber-900"
      data-testid="model-unit-compare-confirm"
      role="alertdialog">
      <div class="font-semibold">
        一次要装 {{ pendingGroupsConfirm.length }} 个单元、约 {{ countGroupProjections(pendingGroupsConfirm) }} 份历史投影
        <template v-if="pendingGroupsConfirm.length > MODEL_UNIT_COMPARE_MAX_UNITS">，超过一次装载上限 {{ MODEL_UNIT_COMPARE_MAX_UNITS }} 个</template>
        <template v-else-if="diffSummary?.needsConfirm">，服务端提示超过阈值 {{ diffSummary.confirmThresholdUnits }} 个</template>
      </div>
      <div class="mt-0.5 opacity-80">每份都要服务端按会话重算一遍几何，多的话要等一会儿；装进来的单元越多，三维里越挤。</div>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <button type="button"
          class="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
          data-testid="model-unit-compare-confirm-all"
          @click="confirmGroups('all')">
          全部生成
        </button>
        <button v-if="pendingGroupsConfirm.length > MODEL_UNIT_COMPARE_MAX_UNITS"
          type="button"
          class="rounded-md border border-amber-400 bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted/50"
          data-testid="model-unit-compare-confirm-top"
          @click="confirmGroups('top')">
          先装变化最大的 {{ MODEL_UNIT_COMPARE_MAX_UNITS }} 个
        </button>
        <button type="button"
          class="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          data-testid="model-unit-compare-confirm-cancel"
          @click="confirmGroups('cancel')">
          取消
        </button>
      </div>
    </div>

    <!-- 设计稿 S2 那一颗总按钮：变了的单元一起进三维（P2-a）；只有一组时没必要，组里那颗就是。放在分组列表外（e2e 数的是列表里的 div） -->
    <div v-if="scope === 'subtree' && geometryGroups.length > 1"
      class="mt-2 flex items-center gap-2 rounded-md border border-dashed border-indigo-300 bg-indigo-50/30 px-2 py-1.5 text-xs"
      data-testid="model-unit-compare-run-groups-row">
      <div class="min-w-0 flex-1">
        <div class="font-semibold text-foreground">全部变了的单元一起进三维</div>
        <div class="text-[10px] text-muted-foreground">{{ groupsProjectionText }}<template v-if="geometryGroups.length > MODEL_UNIT_COMPARE_MAX_UNITS">（超过一次装载上限 {{ MODEL_UNIT_COMPARE_MAX_UNITS }}，会先问）</template></div>
      </div>
      <button type="button"
        class="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
        :disabled="comparing || pendingGroupsConfirm !== null"
        :title="`把这 ${geometryGroups.length} 个单元的 A / B 一起装进三维（每份历史投影都要服务端按会话重算）`"
        data-testid="model-unit-compare-run-groups"
        @click="runCompareGroups(geometryGroups)">
        {{ comparedInViewer.length > 1 && comparedInViewer.length === geometryGroups.length ? '三维中' : '在三维中对比' }}
      </button>
    </div>
    <div v-if="scope === 'subtree' && geometryGroups.length > 0" class="mt-2 space-y-1" data-testid="model-unit-compare-groups">
      <div v-for="group in geometryGroups" :key="group.unitRefno ?? 'orphan'"
        class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
        :class="group.unitRefno && comparedInViewer.includes(group.unitRefno) ? 'border-indigo-300 bg-indigo-50/50' : 'border-border'">
        <div class="min-w-0 flex-1">
          <div class="truncate font-mono font-semibold">{{ group.unitNoun }} {{ group.unitRefno }}<span v-if="group.unitName" class="ml-1 font-sans text-[10px] font-normal text-muted-foreground">{{ group.unitName }}</span></div>
          <div class="flex flex-wrap gap-1 text-[10px]">
            <span v-if="group.counts.added" class="rounded bg-emerald-100 px-1 text-emerald-700">新增 {{ group.counts.added }}</span>
            <span v-if="group.counts.deleted" class="rounded bg-rose-100 px-1 text-rose-700">删除 {{ group.counts.deleted }}</span>
            <span v-if="group.counts.modified" class="rounded bg-amber-100 px-1 text-amber-700">修改 {{ group.counts.modified }}</span>
            <span v-if="group.counts.noop" class="rounded bg-slate-100 px-1 text-slate-600">noop {{ group.counts.noop }}</span>
          </div>
        </div>
        <button type="button"
          class="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted/50 disabled:opacity-50"
          :disabled="comparing"
          :data-testid="`model-unit-compare-run-group-${group.unitRefno}`"
          @click="runCompareGroup(group)">
          {{ group.unitRefno && comparedInViewer.includes(group.unitRefno) ? (comparedInViewer.length > 1 ? '三维中 · 只看这组' : '三维中') : '在三维中对比' }}
        </button>
      </div>
    </div>

    <section v-if="compareRuntime"
      class="mt-3 rounded-md border border-indigo-200 bg-indigo-50/30 p-2.5"
      data-testid="model-unit-compare-runtime">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-xs font-semibold text-foreground">三维查看</div>
          <div class="truncate font-mono text-[10px] text-muted-foreground" data-testid="model-unit-compare-runtime-title">
            <template v-if="compareRuntime.detail.units?.length">{{ compareRuntime.detail.units.length }} 个单元 · {{ compareRuntime.detail.unitRefno }} 下 · </template>
            <template v-else>{{ compareRuntime.detail.unitRefno }} · </template>DB {{ compareRuntime.detail.dbnum }}
          </div>
        </div>
        <button type="button"
          class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
          data-testid="model-unit-compare-close"
          @click="closeCompare">
          <X class="h-3 w-3" />退出
        </button>
      </div>

      <div v-if="compareRuntime.status === 'loading'" class="mt-2 text-xs text-muted-foreground">
        正在加载两个精确版本…
      </div>
      <div v-else-if="compareRuntime.status === 'error'"
        class="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
        {{ compareRuntime.error }}
      </div>
      <template v-else>
        <div class="mt-2 grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-xs">
          <button type="button"
            class="rounded px-2 py-1.5"
            :class="compareRuntime.viewMode === 'single' ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="compareRuntime.viewMode === 'single'"
            data-testid="model-unit-compare-single-mode"
            @click="setCompareViewMode('single')">
            单视口切换
          </button>
          <button type="button"
            class="rounded px-2 py-1.5"
            :class="compareRuntime.viewMode === 'split' ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="compareRuntime.viewMode === 'split'"
            data-testid="model-unit-compare-split-mode"
            @click="setCompareViewMode('split')">
            双视口分屏
          </button>
        </div>

        <div v-if="compareRuntime.viewMode === 'single'" class="mt-2 grid grid-cols-2 gap-2 text-xs">
          <button type="button"
            class="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-left text-blue-700 transition-opacity"
            :class="compareRuntime.activeSide === 'before' ? 'ring-2 ring-blue-500' : 'opacity-60'"
            data-testid="model-unit-compare-show-before"
            @click="setCompareSide('before')">
            <div class="font-semibold">A · sesno {{ compareRuntime.detail.before.sesno }}</div>
            <div class="mt-0.5 text-[10px] opacity-75">{{ formatModelUnitVersionTime(compareRuntime.detail.before.version.sessionTime ?? '') }}</div>
            <div v-if="compareRuntime.detail.before.version.impactKind === 'tombstone'" class="mt-0.5 text-[10px] opacity-75">{{ modelUnitVersionAbsentNote('before') }}</div>
            <div v-else-if="absentUnits(compareRuntime.detail, 'before').length" class="mt-0.5 text-[10px] opacity-75" data-testid="model-unit-compare-absent-before">
              {{ absentUnits(compareRuntime.detail, 'before').length }} 个单元{{ modelUnitVersionAbsentNote('before') }}：{{ absentUnits(compareRuntime.detail, 'before').join('、') }}
            </div>
          </button>
          <button type="button"
            class="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-left text-emerald-700 transition-opacity"
            :class="compareRuntime.activeSide === 'after' ? 'ring-2 ring-emerald-500' : 'opacity-60'"
            data-testid="model-unit-compare-show-after"
            @click="setCompareSide('after')">
            <div class="font-semibold">B · sesno {{ compareRuntime.detail.after.sesno }}</div>
            <div class="mt-0.5 text-[10px] opacity-75">{{ formatModelUnitVersionTime(compareRuntime.detail.after.version.sessionTime ?? '') }}</div>
            <div v-if="compareRuntime.detail.after.version.impactKind === 'tombstone'" class="mt-0.5 text-[10px] opacity-75">{{ modelUnitVersionAbsentNote('after') }}</div>
            <div v-else-if="absentUnits(compareRuntime.detail, 'after').length" class="mt-0.5 text-[10px] opacity-75" data-testid="model-unit-compare-absent-after">
              {{ absentUnits(compareRuntime.detail, 'after').length }} 个单元{{ modelUnitVersionAbsentNote('after') }}：{{ absentUnits(compareRuntime.detail, 'after').join('、') }}
            </div>
          </button>
        </div>
        <div v-else
          class="mt-2 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground"
          data-testid="model-unit-compare-split-summary">
          左 A · sesno {{ compareRuntime.detail.before.sesno }}
          <span class="px-1">·</span>
          右 B · sesno {{ compareRuntime.detail.after.sesno }}
          <!-- P3-c：软渲染（远程桌面 / 虚拟机 / 无显卡驱动）下分屏不走描边合成器，照实说 -->
          <div v-if="compareRuntime.splitOutline && !compareRuntime.splitOutline.compositor"
            class="mt-1 text-[10px] text-amber-700"
            :title="compareRuntime.splitOutline.renderer ?? ''"
            data-testid="model-unit-compare-split-direct-render">
            这台机子是软渲染（{{ compareRuntime.splitOutline.renderer ?? '显卡串未知' }}）：分屏走直接渲染、不走描边合成器——选中的环境构件按选中色显示、没有描边，帧率优先。
          </div>
        </div>
        <label class="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"
          :class="compareRuntimeHasGeometryDifference ? '' : 'opacity-60'"
          :title="compareRuntimeHasGeometryDifference
            ? '三维里藏掉两版都没变的构件，只剩新增 / 删除 / 修改；着色与下方徽章同一套'
            : '本次对比没有几何差异，三维里没有可单看的构件'">
          <input type="checkbox"
            :checked="compareRuntime.diffOnly === true"
            :disabled="!compareRuntimeHasGeometryDifference"
            data-testid="model-unit-compare-diff-only"
            @change="setCompareDiffOnly(($event.target as HTMLInputElement).checked)" />
          三维只看差异
        </label>
      </template>

      <div v-if="compareRuntime.environment"
        class="mt-2 rounded-md border border-amber-200 bg-amber-50/80 p-2 text-[10px] text-amber-900"
        data-testid="model-unit-compare-environment">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-semibold">
              {{ compareRuntime.environment.error ? '当前环境（刷新失败）' : '最新环境' }}
            </div>
            <div class="mt-0.5 opacity-80">已固定当前加载范围：{{ compareRuntime.environment.loadedRefnos }} 个 refno</div>
          </div>
          <button type="button"
            class="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-background px-1.5 py-1 font-medium disabled:opacity-50"
            data-testid="model-unit-compare-refresh-environment"
            :disabled="compareRuntime.environment.refreshing"
            @click="refreshCompareEnvironment">
            <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': compareRuntime.environment.refreshing }" />
            刷新
          </button>
        </div>
        <div class="mt-1 border-t border-amber-200 pt-1">
          {{ compareRuntime.environment.error
            ? '整库最新环境不可用；当前仅显示两个所选最小交付单元。'
            : '混合时间视图：环境始终取 dbnum 最新模型，目标单元取所选 sesno。' }}
        </div>
        <div v-if="compareRuntime.environment.error" class="mt-1 text-destructive">
          {{ compareRuntime.environment.error }}
        </div>
      </div>
    </section>

    <template v-if="compareCompleted">
      <div class="mt-3 rounded-md border border-border bg-muted/20 p-2" data-testid="model-unit-compare-summary">
        <div v-if="comparedInViewer.length" class="mb-1 font-mono text-[10px] text-muted-foreground" data-testid="model-unit-compare-summary-title">
          <template v-if="comparedInViewer.length === 1">{{ comparedInViewer[0] }} · 几何差异</template>
          <template v-else>{{ comparedInViewer.length }} 个单元 · 几何差异（{{ comparedInViewer.join('、') }}）</template>
        </div>
        <div class="flex flex-wrap gap-1.5 text-[11px]">
          <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">新增 {{ summary.added }}</span>
          <span class="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">删除 {{ summary.deleted }}</span>
          <span class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">修改 {{ summary.modified }}</span>
          <span class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">未变 {{ summary.unchanged }}</span>
        </div>
        <p v-if="noGeometryDifference" class="mt-2 text-xs font-medium text-emerald-700" data-testid="model-unit-compare-noop">
          无几何差异<span v-if="sameGeometry">；A/B 几何相同，只加载了一次</span>
        </p>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-1" data-testid="model-unit-compare-filters">
        <button v-for="filter in ['all', 'added', 'deleted', 'modified'] as const"
          :key="filter"
          class="rounded border px-2 py-1 text-[11px]"
          :class="statusFilter === filter ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'"
          @click="statusFilter = filter">
          {{ { all: '全部差异', added: '新增', deleted: '删除', modified: '修改' }[filter] }}
        </button>
        <label class="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          <input v-model="includeUnchanged" type="checkbox" />包含未变化
        </label>
      </div>

      <div class="mt-2 space-y-1" data-testid="model-unit-compare-list">
        <button v-for="row in visibleRows"
          :key="row.refno"
          class="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs hover:bg-muted/50"
          :class="row.refno === queriedElementRefno ? 'border-primary bg-primary/5' : 'border-border'"
          :data-queried-element="row.refno === queriedElementRefno ? 'true' : undefined"
          @click="focusRow(row.refno)">
          <span class="rounded px-1.5 py-0.5 text-[10px]" :class="STATUS_CLASS[row.status]">
            {{ STATUS_LABEL[row.status] }}
          </span>
          <span class="min-w-0 flex-1 truncate font-mono">{{ row.refno }}</span>
          <span v-if="row.refno === queriedElementRefno" class="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">本构件</span>
          <span class="text-[10px] text-muted-foreground">{{ row.noun }}</span>
        </button>
        <p v-if="visibleRows.length === 0" class="py-4 text-center text-xs text-muted-foreground">当前筛选没有差异项</p>
      </div>
    </template>
  </section>
</template>
