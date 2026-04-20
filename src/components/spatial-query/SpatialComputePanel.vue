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
            ? 'bg-white text-[#EA580C] shadow-sm font-semibold'
            : 'text-muted-foreground hover:text-foreground'"
          @click="setPanelMode('compute')">
          计算
        </button>
      </div>
    </div>

    <div v-if="panelMode === 'compute'" class="flex-1 overflow-y-auto px-5 py-4">
      <div class="flex flex-col gap-4">
        <!-- Banner -->
        <div class="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
          <div class="text-xs font-bold text-orange-800">两种输入方式</div>
          <div class="text-[11px] leading-relaxed text-orange-700">读取当前选中构件，或输入编号后计算。</div>
        </div>

        <!-- Scenario Accordion -->
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-[13px] font-bold text-foreground">场景选择</div>
              <div class="text-[11px] font-medium text-muted-foreground">折叠后仅显示当前场景，减少 Dock 纵向占用</div>
            </div>
            <div class="flex items-center gap-1.5">
              <span v-if="!scenarioExpanded" class="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700">已折叠</span>
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
                ? 'border-orange-300 bg-orange-50'
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
              <span class="rounded-full bg-[#FFF0E6] px-2 py-0.5 text-[11px] font-semibold text-orange-700">当前场景</span>
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
            <span class="shrink-0 rounded-full bg-orange-50 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-orange-700">
              默认样例：{{ currentScenarioMeta.exampleRefno }}
            </span>
          </div>

          <!-- Form -->
          <div class="mt-3 space-y-2.5">
            <label class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">SUPPO Refno</span>
              <input v-model="computeState.suppoRefno"
                type="text"
                :placeholder="`${currentScenarioMeta.exampleRefno}`"
                class="h-10 w-full rounded-[10px] border bg-orange-50 px-3 font-mono text-[13px] font-medium text-foreground outline-none transition-colors focus:border-orange-400"
                :class="computeState.suppoRefno ? 'border-orange-300' : 'border-gray-200'" />
              <span class="mt-0.5 block text-[11px] font-medium text-gray-400">格式示例：24383_88342</span>
            </label>

            <label v-if="hasField('tolerance')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">容差 tolerance（可选，mm）</span>
              <input v-model="computeState.tolerance"
                type="number"
                placeholder="可空"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] font-medium text-foreground outline-none focus:border-orange-400" />
            </label>

            <div v-if="hasField('suppoType') || hasField('searchRadius')" class="grid grid-cols-2 gap-2.5">
              <label v-if="hasField('suppoType')" class="block">
                <span class="mb-1 block text-xs font-semibold text-muted-foreground">suppo_type</span>
                <input v-model="computeState.suppoType"
                  type="text"
                  placeholder="S1 / S2，可空"
                  class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 text-[13px] text-foreground outline-none focus:border-orange-400" />
              </label>
              <label v-if="hasField('searchRadius')" class="block">
                <span class="mb-1 block text-xs font-semibold text-muted-foreground">search_radius (mm)</span>
                <input v-model="computeState.searchRadius"
                  type="number"
                  placeholder="可空"
                  class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] text-foreground outline-none focus:border-orange-400" />
              </label>
            </div>

            <label v-if="hasField('targetNouns')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">target_nouns</span>
              <input v-model="computeState.targetNouns"
                type="text"
                placeholder="WALL,COLUMN,FIXING"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 text-[13px] text-foreground outline-none focus:border-orange-400" />
            </label>

            <label v-if="hasField('neighborWindow')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">neighbor_window (mm)</span>
              <input v-model="computeState.neighborWindow"
                type="number"
                placeholder="可空"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] text-foreground outline-none focus:border-orange-400" />
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
              class="flex-1 rounded-[10px] bg-[#EA580C] py-2.5 text-center text-[13px] font-bold text-white transition-colors hover:bg-[#C2410C] disabled:cursor-not-allowed disabled:opacity-50"
              @click="runComputeScenario()">
              <Loader2 v-if="computeState.loading" class="mr-1 inline h-3.5 w-3.5 animate-spin" />
              {{ computeState.loading ? '计算中...' : '执行计算并定位' }}
            </button>
          </div>

          <!-- Result Table -->
          <div v-if="computeState.resultRows.length > 0 || computeState.error" class="mt-3">
            <div class="flex items-center justify-between pb-2">
              <div class="text-[13px] font-bold text-foreground">查询结果表</div>
              <div class="text-xs font-bold text-[#EA580C]">可点击行自动选中并跳转</div>
            </div>

            <div v-if="computeState.error" class="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {{ computeState.error }}
            </div>

            <div v-if="computeState.resultRows.length > 0" class="overflow-hidden rounded-[10px] border border-gray-200">
              <!-- Table Header -->
              <div class="flex h-9 items-center bg-gray-50 text-[11px] font-semibold text-muted-foreground">
                <div class="w-[130px] px-3">构件 Refno</div>
                <div class="w-[70px] px-2">类型</div>
                <div class="w-[56px] px-2">距离</div>
                <div class="flex-1 px-2.5 text-right">操作</div>
              </div>
              <!-- Rows -->
              <div v-for="(row, idx) in computeState.resultRows" :key="idx"
                class="flex items-center border-t text-xs"
                :class="idx === 0 ? 'border-orange-200 bg-orange-50' : 'border-gray-200'">
                <div class="w-[130px] truncate px-3 py-2.5 font-mono text-xs font-medium text-foreground">{{ row.refno }}</div>
                <div class="w-[70px] px-2 py-2.5 font-medium text-gray-700">{{ row.noun }}</div>
                <div class="w-[56px] px-2 py-2.5"
                  :class="idx === 0 ? 'font-semibold text-[#C2410C]' : 'text-muted-foreground'">
                  {{ formatDistanceMm(row.distanceMm) }}
                </div>
                <div class="flex flex-1 justify-end px-2.5 py-2">
                  <button type="button"
                    class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors"
                    :class="idx === 0
                      ? 'bg-[#EA580C] text-white hover:bg-[#C2410C]'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50'"
                    @click="$emit('select-refno', row.refno)">
                    选中并跳转
                    <MousePointerClick class="h-3 w-3" />
                  </button>
                </div>
              </div>
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
import { ChevronDown, Loader2, MousePointerClick } from 'lucide-vue-next';

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
} = spatialCompute;

const computeState = currentScenarioState;

function runComputeScenario() {
  void submitScenario();
}

function hasField(field: 'tolerance' | 'suppoType' | 'searchRadius' | 'targetNouns' | 'neighborWindow') {
  return currentScenarioMeta.value.fields.includes(field);
}

function formatDistanceMm(mm: number | null): string {
  if (mm == null) return '-';
  if (mm >= 1000) return `${(mm / 1000).toFixed(1)}m`;
  return `${mm.toFixed(0)}mm`;
}
</script>
