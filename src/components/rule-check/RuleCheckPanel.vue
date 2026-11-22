<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { CheckSquare, Crosshair, Loader2, Play, RefreshCw, Search, Square, X } from 'lucide-vue-next';

import type { UnifiedRuleViolation } from '@/api/ruleCheckApi';

import {
  RULE_CHECK_DISCIPLINES,
  RULE_CHECK_ENGINE_LABELS,
  useRuleCheck,
  type RuleCheckEngineFilter,
} from '@/composables/useRuleCheck';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useSpatialQuery } from '@/composables/useSpatialQuery';
import { useViewerContext } from '@/composables/useViewerContext';

const ruleCheck = useRuleCheck();
const {
  state,
  filteredCatalog,
  engineCounts,
  disciplineCounts,
  allViolations,
  summaryStats,
  loadCatalogs,
  toggleRuleSelection,
  selectAllFiltered,
  clearRuleSelection,
  setBranRefno,
  appendScopeRefno,
  clearResults,
  cancelRun,
  runChecks,
} = ruleCheck;

const selectionStore = useSelectionStore();
const viewerContext = useViewerContext();
const spatialQuery = useSpatialQuery();

const activeTab = ref<'catalog' | 'results'>('catalog');
const onlyViolationsFilter = ref(true);

const ENGINE_OPTIONS: RuleCheckEngineFilter[] = ['all', 'spatial', 'bran', 'rooms', 'attrs'];

const showBranInput = computed(
  () => state.activeEngine === 'bran' || state.activeEngine === 'all',
);

const showScopeInput = computed(
  () => state.activeEngine === 'attrs' || state.activeEngine === 'all',
);

const visibleViolations = computed(() => allViolations.value);

onMounted(() => {
  if (!state.catalogLoaded && !state.catalogLoading) {
    void loadCatalogs();
  }
});

async function handleRunChecks() {
  activeTab.value = 'results';
  await runChecks();
}

function handleFillBranFromSelection() {
  const refno = selectionStore.selectedRefno.value;
  if (refno) {
    setBranRefno(refno);
  }
}

function handleAppendScopeFromSelection() {
  const refno = selectionStore.selectedRefno.value;
  if (refno) {
    appendScopeRefno(refno);
  }
}

function severityBadge(v: UnifiedRuleViolation): { label: string; cls: string } {
  if (v.highlightColor === 'red') {
    return { label: '扩散性火灾', cls: 'bg-red-500/15 text-red-600 border-red-500/30' };
  }
  if (v.highlightColor === 'yellow') {
    return { label: '局部性火灾', cls: 'bg-amber-500/15 text-amber-700 border-amber-500/30' };
  }
  if (v.severity === 'reminder') {
    return { label: '提醒', cls: 'bg-sky-500/15 text-sky-700 border-sky-500/30' };
  }
  if (v.severity === 'semi_auto') {
    return { label: '半自动复核', cls: 'bg-violet-500/15 text-violet-700 border-violet-500/30' };
  }
  return { label: '违规', cls: 'bg-destructive/15 text-destructive border-destructive/30' };
}

/** 点击违规行 → 装载/可见/高亮全部关联构件，并将三维相机飞至其联合包围盒。 */
async function focusViolation(violation: UnifiedRuleViolation) {
  state.activeViolationKey = violation.key;
  const refnos = violation.highlightRefnos.filter(Boolean);
  if (refnos.length === 0) return;

  selectionStore.setSelectedRefno(refnos[0]!);
  const viewer = viewerContext.viewerRef.value;
  if (!viewer?.scene) return;

  await spatialQuery.ensureRefnosLoaded(refnos).catch(() => null);
  viewer.scene.ensureRefnos(refnos);
  viewer.scene.setObjectsVisible(refnos, true);
  viewer.scene.setObjectsSelected(refnos, true);
  const aabb = viewer.scene.getAABB(refnos) ?? viewer.scene.getAABB([refnos[0]!]) ?? null;
  if (aabb) {
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }
}
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground text-xs">
    <!-- 顶部栏 -->
    <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-semibold text-sm truncate">规范校验</span>
        <span
          class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
          data-testid="rule-check-total-count"
        >
          {{ engineCounts.all }} 条
        </span>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          :disabled="state.catalogLoading"
          title="重新加载四套引擎规则目录"
          @click="loadCatalogs()"
        >
          <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': state.catalogLoading }" />
          刷新目录
        </button>
        <button
          v-if="state.running"
          type="button"
          class="inline-flex items-center gap-1 rounded bg-destructive px-2.5 py-1 text-[11px] font-medium text-destructive-foreground hover:opacity-90"
          @click="cancelRun()"
        >
          <X class="h-3 w-3" />
          取消
        </button>
        <button
          v-else
          type="button"
          data-testid="rule-check-run-btn"
          class="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          :disabled="state.catalogLoading"
          @click="handleRunChecks()"
        >
          <Play class="h-3 w-3" />
          {{ state.selectedRuleIds.length > 0 ? `运行已选 (${state.selectedRuleIds.length})` : '执行校验' }}
        </button>
      </div>
    </div>

    <!-- 引擎与专业筛选 -->
    <div class="space-y-2 border-b border-border px-3 py-2">
      <div class="flex flex-wrap gap-1">
        <button
          v-for="eng in ENGINE_OPTIONS"
          :key="eng"
          type="button"
          class="rounded border px-2 py-0.5 text-[11px] transition-colors"
          :class="
            state.activeEngine === eng
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-muted'
          "
          @click="state.activeEngine = eng"
        >
          {{ RULE_CHECK_ENGINE_LABELS[eng] }}
          <span class="ml-0.5 font-mono opacity-80">{{ engineCounts[eng] }}</span>
        </button>
      </div>

      <div class="flex flex-wrap gap-1">
        <button
          type="button"
          class="rounded border px-2 py-0.5 text-[11px]"
          :class="
            state.activeDiscipline === 'all'
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-border text-muted-foreground hover:bg-muted'
          "
          @click="state.activeDiscipline = 'all'"
        >
          全专业 <span class="font-mono">{{ disciplineCounts.all ?? 0 }}</span>
        </button>
        <button
          v-for="disc in RULE_CHECK_DISCIPLINES"
          :key="disc"
          type="button"
          class="rounded border px-2 py-0.5 text-[11px]"
          :class="
            state.activeDiscipline === disc
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-border text-muted-foreground hover:bg-muted'
          "
          @click="state.activeDiscipline = disc"
        >
          {{ disc }} <span class="font-mono">{{ disciplineCounts[disc] ?? 0 }}</span>
        </button>
      </div>

      <!-- BRAN 与交互选集输入 -->
      <div v-if="showBranInput" class="flex items-center gap-1.5">
        <label class="w-16 shrink-0 text-[11px] text-muted-foreground">BRAN</label>
        <input
          v-model="state.branRefno"
          type="text"
          placeholder="如 24381_145018（BRAN 拓扑规则必填）"
          class="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          class="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
          title="填入当前三维选中构件的 refno"
          @click="handleFillBranFromSelection()"
        >
          取选中
        </button>
      </div>

      <div v-if="showScopeInput" class="flex items-center gap-1.5">
        <label class="w-16 shrink-0 text-[11px] text-muted-foreground">交互选集</label>
        <input
          v-model="state.attrScopeText"
          type="text"
          placeholder="可选：逗号分隔 refno（通道/火灾/点选支架）"
          class="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          class="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
          title="按序追加当前三维选中构件"
          @click="handleAppendScopeFromSelection()"
        >
          +选中
        </button>
      </div>
    </div>

    <!-- 主视图切换 Tab -->
    <div class="flex items-center justify-between border-b border-border px-3">
      <div class="flex">
        <button
          type="button"
          class="border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors"
          :class="
            activeTab === 'catalog'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'catalog'"
        >
          规则目录 ({{ filteredCatalog.length }})
        </button>
        <button
          type="button"
          data-testid="rule-check-results-tab"
          class="border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors"
          :class="
            activeTab === 'results'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'results'"
        >
          校验结果 ({{ summaryStats.totalReported }})
        </button>
      </div>
      <div v-if="activeTab === 'catalog'" class="flex items-center gap-1.5 text-[11px]">
        <button type="button" class="text-primary hover:underline" @click="selectAllFiltered()">全选</button>
        <span class="text-muted-foreground">/</span>
        <button type="button" class="text-muted-foreground hover:underline" @click="clearRuleSelection()">清空</button>
      </div>
      <div v-else-if="state.results.length > 0" class="flex items-center gap-2 text-[11px]">
        <label class="inline-flex items-center gap-1 text-muted-foreground">
          <input v-model="onlyViolationsFilter" type="checkbox" class="rounded" />
          仅看有检出
        </label>
        <button type="button" class="text-muted-foreground hover:underline" @click="clearResults()">清空</button>
      </div>
    </div>

    <!-- 错误与告警提示 -->
    <div v-if="state.catalogError || state.runError" class="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-destructive">
      {{ state.runError || state.catalogError }}
    </div>
    <div
      v-if="state.catalogWarnings.length > 0 || state.runWarnings.length > 0"
      class="max-h-20 overflow-y-auto border-b border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-800 dark:text-amber-300"
    >
      <div v-for="(w, i) in [...state.catalogWarnings, ...state.runWarnings]" :key="i">
        · {{ w }}
      </div>
    </div>

    <!-- Tab 1: 规则目录 -->
    <div v-if="activeTab === 'catalog'" class="flex flex-1 flex-col overflow-hidden">
      <div class="border-b border-border px-3 py-1.5">
        <div class="relative">
          <Search class="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            v-model="state.searchKeyword"
            type="text"
            placeholder="搜索规则 id / 标题 / 规范要求 / #工单号…"
            class="w-full rounded border border-border bg-background py-1 pl-7 pr-2 text-[11px] focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto divide-y divide-border">
        <div v-if="state.catalogLoading" class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          正在加载规则目录…
        </div>
        <div v-else-if="filteredCatalog.length === 0" class="py-8 text-center text-muted-foreground">
          无匹配规则条目
        </div>
        <div
          v-for="row in filteredCatalog"
          :key="`${row.engine}:${row.id}`"
          class="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-muted/50"
          @click="toggleRuleSelection(row.id)"
        >
          <component
            :is="state.selectedRuleIds.includes(row.id) ? CheckSquare : Square"
            class="mt-0.5 h-3.5 w-3.5 shrink-0"
            :class="state.selectedRuleIds.includes(row.id) ? 'text-primary' : 'text-muted-foreground'"
          />
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-mono font-medium text-foreground">{{ row.id }}</span>
              <span class="rounded bg-muted px-1 py-0.2 text-[10px] text-muted-foreground">{{ row.discipline }}</span>
              <span class="rounded border border-border px-1 py-0.2 text-[10px] text-muted-foreground">
                {{ RULE_CHECK_ENGINE_LABELS[row.engine] }}
              </span>
              <span class="font-mono text-[10px] text-muted-foreground">#{{ row.issue }}</span>
            </div>
            <div class="text-[11px] text-foreground">{{ row.title }}</div>
            <div class="font-mono text-[10px] text-muted-foreground">规范：{{ row.requirement }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: 校验结果与三维高亮定位 -->
    <div v-else class="flex flex-1 flex-col overflow-hidden">
      <div
        v-if="state.results.length > 0"
        class="grid grid-cols-4 gap-1.5 border-b border-border bg-muted/30 px-3 py-2 text-center"
      >
        <div class="rounded border border-border bg-card py-1">
          <div class="font-mono text-sm font-semibold">{{ summaryStats.rulesRun }}</div>
          <div class="text-[10px] text-muted-foreground">已跑规则</div>
        </div>
        <div class="rounded border border-border bg-card py-1">
          <div class="font-mono text-sm font-semibold text-destructive">{{ summaryStats.violations }}</div>
          <div class="text-[10px] text-muted-foreground">违规项</div>
        </div>
        <div class="rounded border border-border bg-card py-1">
          <div class="font-mono text-sm font-semibold text-amber-600">
            {{ summaryStats.reminders + summaryStats.semiAuto + summaryStats.firezones }}
          </div>
          <div class="text-[10px] text-muted-foreground">提醒/标注</div>
        </div>
        <div class="rounded border border-border bg-card py-1">
          <div class="font-mono text-sm font-semibold">{{ state.totalElapsedMs }} ms</div>
          <div class="text-[10px] text-muted-foreground">耗时</div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto divide-y divide-border">
        <div v-if="state.running" class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          正在执行规范校验…
        </div>
        <div v-else-if="state.results.length === 0" class="py-8 text-center text-muted-foreground">
          点击右上角「执行校验」运行规则评测
        </div>
        <template v-else>
          <div v-if="visibleViolations.length === 0 && onlyViolationsFilter" class="py-8 text-center text-emerald-600">
            全部 {{ summaryStats.rulesRun }} 条已执行规则 0 违规通过
          </div>
          <div
            v-for="v in visibleViolations"
            :key="v.key"
            data-testid="rule-check-violation-row"
            class="space-y-1 px-3 py-2 transition-colors hover:bg-muted/50"
            :class="{ 'bg-primary/5': state.activeViolationKey === v.key }"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-1 min-w-0">
                <span
                  class="rounded border px-1.5 py-0.2 text-[10px] font-medium"
                  :class="severityBadge(v).cls"
                >
                  {{ severityBadge(v).label }}
                </span>
                <span class="font-mono font-medium">{{ v.ruleId }}</span>
                <span class="rounded bg-muted px-1 text-[10px] text-muted-foreground">{{ v.discipline }}</span>
                <span v-if="v.roomNum" class="font-mono text-[10px] text-muted-foreground">房 {{ v.roomNum }}</span>
                <span v-if="v.hasColumn" class="rounded bg-amber-500/15 px-1 text-[10px] text-amber-700">有柱</span>
              </div>
              <button
                type="button"
                data-testid="rule-check-focus-btn"
                class="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:border-primary hover:text-primary disabled:opacity-40"
                :disabled="v.highlightRefnos.length === 0"
                @click="focusViolation(v)"
              >
                <Crosshair class="h-3 w-3" />
                定位高亮
              </button>
            </div>
            <div class="text-[11px] leading-snug text-foreground">{{ v.detail }}</div>
            <div class="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span v-if="v.measuredMm !== undefined">实测 {{ v.measuredMm.toFixed(1) }}</span>
              <span v-if="v.thresholdMm !== undefined">阈值 {{ v.thresholdMm.toFixed(1) }}</span>
              <span v-if="v.highlightRefnos.length > 0">高亮 {{ v.highlightRefnos.join(', ') }}</span>
            </div>
          </div>

          <!-- 非过滤模式下展示 0 违规通过规则汇总 -->
          <div v-if="!onlyViolationsFilter" class="bg-muted/20 px-3 py-2">
            <div class="mb-1 text-[11px] font-medium text-muted-foreground">通过规则（0 违规）</div>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="r in state.results.filter((x) => x.violationTotal === 0)"
                :key="`${r.engine}:${r.id}`"
                class="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700"
              >
                {{ r.id }}
              </span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
