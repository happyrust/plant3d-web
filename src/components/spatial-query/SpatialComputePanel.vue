<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <!-- Header -->
    <div class="flex items-start justify-between border-b border-border px-5 py-4">
      <div>
        <div class="text-lg font-bold text-foreground">支架空间计算</div>
        <div class="mt-0.5 text-[11px] text-muted-foreground">快速估算支架占用空间。</div>
      </div>
    </div>

    <!-- Tabs: 属性 / 计算 -->
    <div class="px-5 pt-4">
      <div class="flex rounded-[10px] border border-gray-200 bg-gray-50 p-[3px]">
        <button type="button"
          class="flex-1 rounded-lg py-2 text-center text-xs font-medium transition-all"
          :class="panelMode === 'query'
            ? 'bg-white text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'"
          @click="setPanelMode('query')">
          属性
        </button>
        <button type="button"
          class="flex-1 rounded-lg py-2 text-center text-xs font-medium transition-all"
          :class="panelMode === 'compute'
            ? 'bg-white text-brand shadow-sm font-semibold'
            : 'text-muted-foreground hover:text-foreground'"
          @click="setPanelMode('compute')">
          计算
        </button>
      </div>
    </div>

    <div v-if="panelMode === 'compute'" class="flex-1 overflow-y-auto px-5 py-4">
      <div class="flex flex-col gap-4">
        <!-- Banner -->
        <div class="rounded-xl border border-brand/25 bg-brand-subtle px-3 py-2">
          <div class="text-xs font-bold text-brand">两种输入方式</div>
          <div class="text-[11px] leading-relaxed text-brand">读取当前选中构件，或输入编号后计算。</div>
        </div>

        <!-- Scenario Accordion -->
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-[13px] font-bold text-foreground">场景选择</div>
              <div class="text-[11px] font-medium text-muted-foreground">折叠后仅显示当前场景，减少 Dock 纵向占用</div>
            </div>
            <div class="flex items-center gap-1.5">
              <span v-if="!scenarioExpanded" class="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand">已折叠</span>
              <button type="button"
                class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-white"
                @click="toggleScenarioExpanded">
                {{ scenarioExpanded ? '收起' : `展开 ${scenarioList.length} 个场景` }}
                <ChevronDown class="h-3.5 w-3.5 text-muted-foreground transition-transform" :class="scenarioExpanded && 'rotate-180'" />
              </button>
            </div>
          </div>

          <!-- Expanded: all scenarios -->
          <div v-if="scenarioExpanded" class="mt-3 grid grid-cols-2 gap-2">
            <button v-for="scenario in scenarioList"
              :key="scenario.key"
              type="button"
              class="rounded-lg border p-2.5 text-left transition-colors"
              :class="activeScenario === scenario.key
                ? 'border-brand bg-brand-subtle'
                : 'border-gray-200 bg-white hover:border-gray-300'"
              @click="setActiveScenario(scenario.key); scenarioExpanded = false">
              <div class="text-xs font-semibold text-foreground">{{ scenario.title }}</div>
              <div class="mt-0.5 text-[11px] text-muted-foreground">{{ scenario.endpoint }}</div>
            </button>
          </div>

          <!-- Collapsed: active scenario card -->
          <div v-else class="mt-2 rounded-[10px] border border-gray-200 bg-white p-2.5">
            <div class="flex items-center justify-between">
              <div class="text-xs font-bold text-foreground">{{ currentScenarioMeta.title }}</div>
              <span class="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand">当前场景</span>
            </div>
            <div class="mt-1 text-[11px] font-medium text-muted-foreground">{{ currentScenarioMeta.description }}</div>
            <div class="mt-1 text-[11px] text-gray-400">其余 {{ scenarioList.length - 1 }} 个场景已折叠，点击"展开"查看。</div>
          </div>
        </div>

        <!-- Detail Card -->
        <div class="rounded-2xl border border-gray-200 bg-white p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1">
              <div class="text-[15px] font-bold text-foreground">{{ currentScenarioMeta.title }}</div>
              <div class="mt-1 text-xs leading-relaxed text-muted-foreground">{{ currentScenarioMeta.description }}</div>
            </div>
            <span class="shrink-0 rounded-full bg-brand-subtle px-2.5 py-1.5 font-mono text-[11px] font-semibold text-brand">
              默认样例：{{ currentScenarioMeta.exampleRefno }}
            </span>
          </div>

          <!-- Form -->
          <div class="mt-3 space-y-2.5">
            <label class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">{{ currentScenarioMeta.sourceLabel }}</span>
              <input v-model="computeState.suppoRefno"
                type="text"
                :placeholder="`${currentScenarioMeta.exampleRefno}`"
                class="h-10 w-full rounded-[10px] border bg-brand-subtle px-3 font-mono text-[13px] font-medium text-foreground outline-none transition-colors focus:border-brand"
                :class="computeState.suppoRefno ? 'border-brand' : 'border-gray-200'" />
              <span class="mt-0.5 block text-[11px] font-medium text-gray-400">{{ currentScenarioMeta.sourceHelp }}</span>
            </label>

            <label v-if="hasField('tolerance')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">容差 tolerance（可选，mm）</span>
              <input v-model="computeState.tolerance"
                type="number"
                placeholder="可空"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] font-medium text-foreground outline-none focus:border-brand" />
            </label>

            <div v-if="hasField('suppoType') || hasField('searchRadius')" class="grid grid-cols-2 gap-2.5">
              <label v-if="hasField('suppoType')" class="block">
                <span class="mb-1 block text-xs font-semibold text-muted-foreground">suppo_type</span>
                <input v-model="computeState.suppoType"
                  type="text"
                  placeholder="S1 / S2，可空"
                  class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 text-[13px] text-foreground outline-none focus:border-brand" />
              </label>
              <label v-if="hasField('searchRadius')" class="block">
                <span class="mb-1 block text-xs font-semibold text-muted-foreground">search_radius (mm)</span>
                <input v-model="computeState.searchRadius"
                  type="number"
                  placeholder="可空"
                  class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] text-foreground outline-none focus:border-brand" />
              </label>
            </div>

            <label v-if="hasField('targetNouns')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">target_nouns</span>
              <input v-model="computeState.targetNouns"
                type="text"
                placeholder="WALL,COLUMN,FIXING"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 text-[13px] text-foreground outline-none focus:border-brand" />
            </label>

            <label v-if="hasField('excludeNouns')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">exclude_nouns（可空，先剔掉的噪声类型）</span>
              <input v-model="computeState.excludeNouns"
                type="text"
                data-testid="bran-exclude-nouns"
                placeholder="WELD,ATTA"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] text-foreground outline-none focus:border-brand" />
              <span class="mt-0.5 block text-[11px] font-medium text-gray-400">目标类型不用先选：计算后按半径内出现的类型逐个勾选。</span>
            </label>

            <label v-if="hasField('neighborWindow')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">neighbor_window (mm)</span>
              <input v-model="computeState.neighborWindow"
                type="number"
                placeholder="可空"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] text-foreground outline-none focus:border-brand" />
            </label>
          </div>

          <!-- Action Row -->
          <div class="mt-3 flex gap-2">
            <button type="button"
              class="flex-1 rounded-[10px] border border-gray-200 bg-white py-2.5 text-center text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              @click="applyComputeSelection">
              从场景读取 Refno
            </button>
            <button type="button"
              :disabled="computeState.loading || isComputeBusy"
              class="flex-1 rounded-[10px] bg-primary py-2.5 text-center text-[13px] font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              @click="runComputeScenario()">
              <Loader2 v-if="computeState.loading" class="mr-1 inline h-3.5 w-3.5 animate-spin" />
              {{ computeState.loading ? '计算中...' : '执行计算并定位' }}
            </button>
          </div>

          <!-- BRAN 净距：由 noun_counts 驱动的类型 facet（计算后才出现；勾选只在前端过滤，不重新请求） -->
          <div v-if="isBranScenario && computeState.nounFacets.length > 0" class="mt-3" data-testid="bran-noun-facet">
            <div class="flex items-center justify-between pb-1.5">
              <div class="text-xs font-semibold text-muted-foreground">
                目标类型 · 半径内 {{ computeState.nounFacets.length }} 类 / {{ branFacetTotal }} 个候选
              </div>
              <div class="flex items-center gap-2 text-[11px] font-semibold">
                <button type="button" class="text-brand hover:underline" data-testid="bran-noun-facet-all" @click="setAllBranNounFacets(true)">全选</button>
                <button type="button" class="text-muted-foreground hover:underline" data-testid="bran-noun-facet-none" @click="setAllBranNounFacets(false)">清空</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="facet in computeState.nounFacets"
                :key="facet.noun"
                type="button"
                :data-testid="`bran-noun-chip-${facet.noun}`"
                :aria-pressed="facet.selected"
                class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors"
                :class="facet.selected
                  ? 'border-brand bg-brand-subtle text-brand'
                  : 'border-gray-200 bg-white text-muted-foreground hover:border-gray-300'"
                @click="toggleBranNounFacet(facet.noun)">
                <Check v-if="facet.selected" class="h-3 w-3" />
                <span class="font-mono">{{ facet.noun }}</span>
                <span class="rounded-full px-1.5 text-[10px] tabular-nums" :class="facet.selected ? 'bg-brand/15' : 'bg-gray-100'">{{ facet.count }}</span>
              </button>
            </div>
            <div class="mt-1.5 text-[11px] leading-relaxed text-gray-400">
              每类默认只标注最近 1 条，其余候选可在下表逐条开关「标注」；已排除 BRAN 自身成员 {{ computeState.excludedSelfMembers }} 个。
            </div>
          </div>

          <!-- Result Table -->
          <div v-if="computeState.resultRows.length > 0 || computeState.error || computeState.responseText" class="mt-3">
            <div class="flex items-center justify-between pb-2">
              <div class="text-[13px] font-bold text-foreground">查询结果表</div>
              <div class="text-xs font-bold text-brand">{{ isBranScenario ? '高亮行已画进三维尺寸' : '可点击行自动选中并跳转' }}</div>
            </div>

            <div v-if="computeState.error" class="rounded-[10px] border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger">
              {{ computeState.error }}
            </div>

            <div v-if="computeState.resultRows.length > 0" class="overflow-hidden rounded-[10px] border border-gray-200">
              <!-- Table Header -->
              <div class="flex h-9 items-center bg-gray-50 text-[11px] font-semibold text-muted-foreground">
                <div class="w-[130px] px-3">构件 Refno</div>
                <div class="w-[70px] px-2">类型</div>
                <div class="w-[56px] px-2">距离</div>
                <div v-if="isBranScenario" class="flex-1 px-2">BRAN 段</div>
                <div class="flex-1 px-2.5 text-right">操作</div>
              </div>
              <!-- Rows -->
              <div v-for="(row, idx) in computeState.resultRows" :key="row.candidateKey ?? idx"
                class="flex items-center border-t text-xs"
                :data-testid="isBranScenario ? 'bran-result-row' : undefined"
                :data-drawn="isBranScenario ? String(Boolean(row.drawn)) : undefined"
                :class="isRowEmphasized(row, idx) ? 'border-brand/25 bg-brand-subtle' : 'border-gray-200'">
                <div class="w-[130px] truncate px-3 py-2.5 font-mono text-xs font-medium text-foreground">{{ row.refno }}</div>
                <div class="w-[70px] px-2 py-2.5 font-medium text-gray-700">{{ row.noun }}</div>
                <div class="w-[56px] px-2 py-2.5"
                  :class="isRowEmphasized(row, idx) ? 'font-semibold text-brand' : 'text-muted-foreground'">
                  {{ formatDistanceMm(row.distanceMm) }}
                </div>
                <div v-if="isBranScenario" class="min-w-0 flex-1 truncate px-2 py-2.5 text-[11px] text-muted-foreground">
                  {{ row.label || '-' }}
                </div>
                <div class="flex items-center justify-end gap-1 px-2.5 py-2" :class="isBranScenario ? 'w-[150px]' : 'flex-1'">
                  <button v-if="isBranScenario && row.candidateKey"
                    type="button"
                    :data-testid="`bran-draw-toggle-${row.candidateKey}`"
                    :aria-pressed="Boolean(row.drawn)"
                    class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors"
                    :class="row.drawn
                      ? 'bg-brand-subtle text-brand hover:bg-brand/15'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50'"
                    @click="toggleBranCandidateDrawn(row.candidateKey)">
                    <Ruler class="h-3 w-3" />
                    {{ row.drawn ? '已标注' : '标注' }}
                  </button>
                  <button type="button"
                    class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors"
                    :class="isRowEmphasized(row, idx)
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50'"
                    @click="$emit('select-refno', row.refno)">
                    {{ isBranScenario ? '跳转' : '选中并跳转' }}
                    <MousePointerClick class="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="!computeState.error" class="rounded-[10px] border border-gray-200 bg-gray-50 px-3 py-4 text-center text-sm text-muted-foreground">
              {{ isBranScenario && computeState.nounFacets.length > 0 ? '所有类型都已取消勾选，勾回任意类型即可显示候选。' : '未找到符合条件的结果。' }}
            </div>
          </div>

          <!-- Empty state -->
          <div v-else-if="!computeState.loading && !computeState.responseText" class="mt-3 rounded-[10px] border border-gray-200 bg-white px-3 py-8 text-center text-sm text-muted-foreground">
            结果将在执行计算后显示。
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>点击结果表任意行，场景将选中并飞到目标位置。</span>
          <span>已选场景：{{ currentScenarioMeta.endpoint.split('/').pop() }}</span>
        </div>
      </div>
    </div>

    <!-- 属性 tab placeholder -->
    <div v-else class="flex flex-1 items-center justify-center px-5 text-sm text-muted-foreground">
      属性面板暂未启用，请切换到"计算"标签。
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { Check, ChevronDown, Loader2, MousePointerClick, Ruler } from 'lucide-vue-next';

import type { SpatialComputeResultRow, SpatialComputeScenarioField } from '@/composables/useSpatialCompute';

import { useSpatialCompute } from '@/composables/useSpatialCompute';

defineEmits<{
  'select-refno': [refno: string];
}>();

const spatialCompute = useSpatialCompute();
const {
  panelMode,
  activeScenario,
  scenarioList,
  scenarioExpanded,
  currentScenarioMeta,
  currentScenarioState,
  isBusy: isComputeBusy,
  setPanelMode,
  setActiveScenario,
  applyCurrentSelection: applyComputeSelection,
  submitScenario,
  toggleScenarioExpanded,
  toggleBranNounFacet,
  setAllBranNounFacets,
  toggleBranCandidateDrawn,
} = spatialCompute;

const computeState = currentScenarioState;
const isBranScenario = computed(() => activeScenario.value === 'branNearestClearance');
/** facet 上的候选总数（`noun_counts` 之和，截断前口径）。 */
const branFacetTotal = computed(() => computeState.value.nounFacets.reduce((sum, facet) => sum + facet.count, 0));

function runComputeScenario() {
  void submitScenario();
}

function hasField(field: SpatialComputeScenarioField) {
  return currentScenarioMeta.value.fields.includes(field);
}

/** BRAN 净距按「画进三维了没」高亮；其余场景沿用「首行 = 最近 / 主结果」。 */
function isRowEmphasized(row: SpatialComputeResultRow, idx: number): boolean {
  return isBranScenario.value ? Boolean(row.drawn) : idx === 0;
}

function formatDistanceMm(mm: number | null): string {
  if (mm == null) return '-';
  if (isBranScenario.value) return `${Math.round(mm)}mm`;
  if (mm >= 1000) return `${(mm / 1000).toFixed(1)}m`;
  return `${mm.toFixed(0)}mm`;
}
</script>
