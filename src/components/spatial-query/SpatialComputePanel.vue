<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <div class="border-b border-border px-4 py-3">
      <div class="text-base font-semibold text-foreground">支架空间计算</div>
      <div class="mt-1 text-xs text-muted-foreground">只需完整 Refno，结果直接展示原始 JSON。</div>
    </div>

    <div class="flex-1 overflow-y-auto px-4 py-4">
      <div class="flex flex-col gap-4">
        <section class="rounded-xl border border-border bg-muted/30 p-3">
          <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">计算场景</div>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <button v-for="scenario in scenarioList"
              :key="scenario.key"
              type="button"
              class="rounded-xl border px-3 py-3 text-left transition-colors"
              :class="activeScenario === scenario.key ? 'border-[#FF6B00] bg-[#FFF1E8]' : 'border-border bg-background hover:border-gray-300 hover:bg-muted/60'"
              @click="setActiveScenario(scenario.key)">
              <div class="text-sm font-medium text-foreground">{{ scenario.title }}</div>
              <div class="mt-1 text-xs text-muted-foreground">{{ scenario.endpoint }}</div>
            </button>
          </div>
        </section>

        <section class="rounded-xl border border-border bg-background p-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-foreground">{{ currentScenarioMeta.title }}</div>
              <div class="mt-1 text-xs text-muted-foreground">{{ currentScenarioMeta.description }}</div>
              <div class="mt-1 text-[11px] text-muted-foreground">默认样例：{{ currentScenarioMeta.exampleRefno }}</div>
            </div>
            <div class="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">{{ currentScenarioMeta.endpoint }}</div>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2">
            <button type="button"
              class="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:bg-muted/60"
              @click="applyComputeSelection">
              <MousePointerClick class="h-3.5 w-3.5" />
              使用当前选中
            </button>
            <button type="button"
              class="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:bg-muted/60"
              @click="resetComputeScenario()">
              <RotateCcwIcon class="h-3.5 w-3.5" />
              重置样例
            </button>
          </div>

          <div class="mt-3 space-y-3">
            <label class="block text-xs text-muted-foreground">
              <span class="mb-1 block">suppo_refno</span>
              <input v-model="computeState.suppoRefno"
                type="text"
                placeholder="24383/89904 或 24383_89904"
                class="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-[#FF6B00]" />
            </label>

            <div v-if="hasComputeField('tolerance')" class="grid grid-cols-1 gap-3">
              <label class="block text-xs text-muted-foreground">
                <span class="mb-1 block">tolerance (mm)</span>
                <input v-model="computeState.tolerance"
                  type="number"
                  placeholder="可空"
                  class="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-[#FF6B00]" />
              </label>
            </div>

            <div v-if="hasComputeField('suppoType') || hasComputeField('searchRadius')" class="grid grid-cols-2 gap-3">
              <label v-if="hasComputeField('suppoType')" class="block text-xs text-muted-foreground">
                <span class="mb-1 block">suppo_type</span>
                <input v-model="computeState.suppoType"
                  type="text"
                  placeholder="S1 / S2，可空"
                  class="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-[#FF6B00]" />
              </label>
              <label v-if="hasComputeField('searchRadius')" class="block text-xs text-muted-foreground">
                <span class="mb-1 block">search_radius (mm)</span>
                <input v-model="computeState.searchRadius"
                  type="number"
                  placeholder="可空"
                  class="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-[#FF6B00]" />
              </label>
            </div>

            <label v-if="hasComputeField('targetNouns')" class="block text-xs text-muted-foreground">
              <span class="mb-1 block">target_nouns</span>
              <input v-model="computeState.targetNouns"
                type="text"
                placeholder="WALL,COLUMN,FIXING"
                class="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-[#FF6B00]" />
            </label>

            <label v-if="hasComputeField('neighborWindow')" class="block text-xs text-muted-foreground">
              <span class="mb-1 block">neighbor_window (mm)</span>
              <input v-model="computeState.neighborWindow"
                type="number"
                placeholder="可空"
                class="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-[#FF6B00]" />
            </label>
          </div>
        </section>

        <button type="button"
          :disabled="computeState.loading || isComputeBusy"
          class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#FF6B00] px-4 text-sm font-medium text-white transition-colors hover:bg-[#E35F00] disabled:cursor-not-allowed disabled:opacity-50"
          @click="runComputeScenario()">
          <Loader2 v-if="computeState.loading" class="h-4 w-4 animate-spin" />
          <Search v-else class="h-4 w-4" />
          <span>{{ computeState.loading ? '计算中...' : '执行空间计算' }}</span>
        </button>

        <div class="rounded-xl border border-border bg-background">
          <div class="border-b border-border px-3 py-3">
            <div class="text-sm font-semibold text-foreground">结果</div>
            <div class="mt-0.5 text-xs text-muted-foreground">{{ computeSummary }}</div>
          </div>
          <div v-if="computeState.error" class="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {{ computeState.error }}
          </div>
          <div v-if="!computeState.responseText && !computeState.loading" class="px-3 py-8 text-center text-sm text-muted-foreground">
            这里会显示当前场景的原始 JSON 响应。
          </div>
          <pre v-else-if="computeState.responseText" class="max-h-[360px] overflow-auto bg-slate-950 px-3 py-3 text-xs leading-6 text-slate-100">{{ computeState.responseText }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader2, MousePointerClick, RotateCcwIcon, Search } from 'lucide-vue-next';

import { useSpatialCompute } from '@/composables/useSpatialCompute';

const spatialCompute = useSpatialCompute();
const {
  activeScenario,
  scenarioList,
  currentScenarioMeta,
  currentScenarioState,
  currentSummary,
  isBusy: isComputeBusy,
  setActiveScenario,
  resetScenario,
  applyCurrentSelection: applyComputeSelection,
  submitScenario,
} = spatialCompute;

const computeState = currentScenarioState;
const computeSummary = currentSummary;

function runComputeScenario() {
  void submitScenario();
}

function hasComputeField(field: 'tolerance' | 'suppoType' | 'searchRadius' | 'targetNouns' | 'neighborWindow') {
  return currentScenarioMeta.value.fields.includes(field);
}

function resetComputeScenario() {
  resetScenario();
}
</script>
