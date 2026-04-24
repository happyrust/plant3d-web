<template>
  <div v-if="open"
    class="pointer-events-auto absolute right-14 top-24 z-[950] flex max-h-[82vh] w-[400px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
    @pointerdown.stop
    @wheel.stop>
    <div class="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
      <div>
        <div class="font-ui text-base font-semibold text-gray-900">空间查询</div>
        <div class="mt-0.5 text-[11px] text-gray-500">范围查询与距离查询</div>
      </div>
      <button type="button" class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900" title="关闭" @click="closePanel">
        <X class="h-4 w-4" />
      </button>
    </div>

    <div class="flex flex-1 flex-col overflow-y-auto px-3 py-3">
      <div class="flex flex-col gap-3">
        <div class="flex rounded-md bg-gray-100 p-1">
          <button type="button"
            class="flex-1 rounded py-1.5 text-xs font-medium transition-colors"
            :class="draft.mode === 'range' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
            @click="setMode('range')">
            范围查询
          </button>
          <button type="button"
            class="flex-1 rounded py-1.5 text-xs font-medium transition-colors"
            :class="draft.mode === 'distance' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
            @click="setMode('distance')">
            距离查询
          </button>
        </div>

        <template v-if="draft.mode === 'range'">
          <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">中心来源</div>
            <div class="mt-2 grid grid-cols-3 gap-1.5">
              <button type="button"
                class="rounded-md border px-2 py-1.5 text-xs transition-colors"
                :class="draft.rangeCenterSource === 'selected' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.rangeCenterSource = 'selected'">
                当前选中
              </button>
              <button type="button"
                class="rounded-md border px-2 py-1.5 text-xs transition-colors"
                :class="draft.rangeCenterSource === 'pick' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="startPick">
                拾取中心
              </button>
              <button type="button"
                class="rounded-md border px-2 py-1.5 text-xs transition-colors"
                :class="draft.rangeCenterSource === 'coordinates' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.rangeCenterSource = 'coordinates'">
                手输坐标
              </button>
            </div>
            <div class="mt-2 flex gap-1.5">
              <button type="button"
                class="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                @click="useSelection">
                <MousePointerClick class="h-3.5 w-3.5" />
                使用当前选中
              </button>
              <div class="flex min-w-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-500">
                <MapPinned class="h-3.5 w-3.5 text-[#FF6B00]" />
                <span>{{ centerSummary }}</span>
              </div>
            </div>
          </section>

          <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">查询形状</div>
            <div class="mt-2 grid grid-cols-2 gap-1.5">
              <button type="button"
                class="rounded-md border px-2.5 py-1.5 text-xs transition-colors"
                :class="draft.shape === 'sphere' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.shape = 'sphere'">
                球形
              </button>
              <button type="button"
                class="rounded-md border px-2.5 py-1.5 text-xs transition-colors"
                :class="draft.shape === 'cube' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.shape = 'cube'">
                立方体
              </button>
            </div>
          </section>
        </template>

        <template v-else>
          <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">起始位置</div>
              <div class="flex rounded-md bg-white p-0.5 text-[11px]">
                <button type="button"
                  class="rounded px-2 py-0.5 font-medium transition-colors"
                  :class="draft.distanceCenterSource === 'refno' ? 'bg-[#FFF1E8] text-[#C84D00]' : 'text-gray-500 hover:text-gray-700'"
                  @click="draft.distanceCenterSource = 'refno'">
                  通过 Refno
                </button>
                <button type="button"
                  class="rounded px-2 py-0.5 font-medium transition-colors"
                  :class="draft.distanceCenterSource === 'coordinates' ? 'bg-[#FFF1E8] text-[#C84D00]' : 'text-gray-500 hover:text-gray-700'"
                  @click="draft.distanceCenterSource = 'coordinates'">
                  通过坐标
                </button>
              </div>
            </div>
            <div v-if="draft.distanceCenterSource === 'refno'" class="mt-3 space-y-2">
              <label class="block text-xs text-gray-500">拾取起始物项</label>
              <div class="flex gap-1.5">
                <button type="button"
                  class="inline-flex items-center gap-1 rounded-md border border-[#FF6B00] bg-[#FF6B00] px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#E35F00]"
                  data-testid="pick-from-selection"
                  @click="pickRefnoFromSelection">
                  <MousePointerClick class="h-3.5 w-3.5" />
                  拾取物项
                </button>
                <div class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs">
                  <span class="h-2 w-2 shrink-0 rounded-full"
                    :class="draft.refno.trim() ? 'bg-emerald-500' : 'bg-gray-300'"
                    aria-hidden="true" />
                  <span v-if="draft.refno.trim()" class="truncate font-mono text-gray-900">{{ draft.refno.trim() }}</span>
                  <span v-else class="text-gray-400">尚未选中物项</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <label class="text-[11px] text-gray-400">或手填 Refno</label>
                <input v-model="draft.refno"
                  type="text"
                  placeholder="例如：24381_100818"
                  class="h-7 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-[11px] text-gray-900 outline-none focus:border-[#FF6B00]" />
              </div>
            </div>
          </section>

          <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">查询半径</div>
              <div class="font-mono text-lg font-semibold text-[#C84D00]">
                {{ draft.radius }} <span class="text-xs text-[#C84D00]/70">mm</span>
              </div>
            </div>
            <input :value="draft.radius"
              type="range"
              :min="DISTANCE_RADIUS_MIN"
              :max="DISTANCE_RADIUS_MAX"
              :step="DISTANCE_RADIUS_STEP"
              data-testid="radius-slider"
              class="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-[#FF6B00]"
              @input="onRadiusSliderInput" />
            <div class="mt-1 flex justify-between text-[10px] text-gray-400">
              <span>{{ DISTANCE_RADIUS_MIN }} mm</span>
              <span>{{ DISTANCE_RADIUS_MAX }} mm</span>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button v-for="preset in DISTANCE_RADIUS_PRESETS"
                :key="preset"
                type="button"
                class="rounded-full border px-2.5 py-0.5 text-[11px] transition-colors"
                :class="draft.radius === preset ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                data-testid="radius-preset"
                @click="draft.radius = preset">
                {{ preset }} mm
              </button>
            </div>
          </section>
        </template>

        <section v-if="showCoordinateInputs" class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">中心坐标</div>
          <div class="mt-2 grid grid-cols-3 gap-1.5">
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">X</span>
              <input v-model.number="draft.center.x"
                type="number"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-xs text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Y</span>
              <input v-model.number="draft.center.y"
                type="number"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-xs text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Z</span>
              <input v-model.number="draft.center.z"
                type="number"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-xs text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
          </div>
        </section>

        <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <div class="grid gap-1.5" :class="draft.mode === 'range' ? 'grid-cols-2' : 'grid-cols-1'">
            <label v-if="draft.mode === 'range'" class="text-xs text-gray-500">
              <span class="mb-1 block">查询半径 (mm)</span>
              <input v-model.number="draft.radius"
                type="number"
                min="1"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-xs text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">最大结果数</span>
              <input v-model.number="draft.limit"
                type="number"
                min="1"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-xs text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
          </div>
        </section>

        <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">过滤条件</div>
          <div class="mt-2 flex flex-col gap-2.5">
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Noun 类型（逗号分隔）</span>
              <input v-model="draft.nounText"
                type="text"
                placeholder="例如：PIPE,EQUI,BRAN"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-xs text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <div class="text-xs text-gray-500">
              <div class="mb-1 block">专业筛选</div>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="spec in specOptions"
                  :key="spec.value"
                  type="button"
                  class="rounded-full border px-2.5 py-1 text-[11px] transition-colors"
                  :class="selectedSpecValues.has(spec.value) ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                  @click="toggleSpecValue(spec.value)">
                  {{ spec.label }}
                </button>
              </div>
            </div>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">关键字（Refno / 名称）</span>
              <input v-model="draft.keyword"
                type="text"
                placeholder="支持 Refno 或名称关键字"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <div class="flex flex-wrap gap-1.5">
              <label class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600">
                <input v-model="draft.onlyLoaded" type="checkbox" />
                <span>仅看已加载</span>
              </label>
              <label class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600">
                <input v-model="draft.onlyVisible" type="checkbox" />
                <span>仅看当前可见</span>
              </label>
            </div>
          </div>
        </section>

        <button type="button"
          :disabled="!canSubmit || isQueryBusy"
          class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#FF6B00] px-3 text-sm font-medium text-white transition-colors hover:bg-[#E35F00] disabled:cursor-not-allowed disabled:opacity-50"
          @click="runQuery">
          <Loader2 v-if="isQueryBusy" class="h-4 w-4 animate-spin" />
          <Search v-else class="h-4 w-4" />
          <span>{{ isQueryBusy ? statusLabel : '执行空间查询' }}</span>
        </button>

        <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
          {{ error }}
        </div>

        <section class="rounded-lg border border-gray-100 bg-white">
          <div class="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <div>
              <div class="text-sm font-semibold text-gray-900">查询结果</div>
              <div class="mt-0.5 text-[11px] text-gray-500">
                {{ summaryText }}
              </div>
            </div>
            <button v-if="resultSet"
              type="button"
              class="rounded-md px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              @click="clearResults">
              清空
            </button>
          </div>

          <div v-if="resultSet" class="border-b border-gray-100 px-3 py-2">
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="showAll">
                全部显示
              </button>
              <button type="button" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="hideAll">
                全部隐藏
              </button>
              <button type="button" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="isolateAll">
                隔离结果
              </button>
              <button type="button" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="restoreAll">
                恢复场景
              </button>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isQueryBusy"
                @click="loadCurrentResults">
                加载当前筛选结果
              </button>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isQueryBusy"
                @click="loadUnloadedResults">
                只加载未加载结果
              </button>
            </div>
          </div>

          <div v-if="resultSet?.warnings.length" class="space-y-1.5 border-b border-gray-100 px-3 py-2">
            <div v-for="warning in resultSet.warnings"
              :key="warning"
              class="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
              {{ warning }}
            </div>
          </div>

          <div v-if="!resultSet && !isQueryBusy" class="px-3 py-6 text-center text-xs text-gray-400">
            暂无结果，执行一次空间查询后会在这里按专业分组显示。
          </div>

          <div v-else-if="resultSet && resultSet.items.length === 0 && !isQueryBusy" class="px-3 py-6 text-center text-xs text-gray-400">
            当前条件下没有匹配结果。
          </div>

          <div v-else class="max-h-[280px] overflow-y-auto px-3 py-2.5">
            <div v-for="group in resultSet?.groups ?? []" :key="group.specValue" class="mb-3 last:mb-0">
              <div class="mb-1.5 flex items-center justify-between">
                <div>
                  <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {{ group.specName }}
                  </div>
                  <div class="mt-0.5 text-[11px] text-gray-400">{{ group.count }} 项</div>
                </div>
                <div class="flex items-center gap-1.5">
                  <button type="button"
                    class="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="isQueryBusy"
                    @click="loadSpecGroup(group.specValue)">
                    加载本专业
                  </button>
                  <button type="button"
                    class="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-white"
                    @click="showOnlyGroup(group.specValue)">
                    仅显示本专业
                  </button>
                </div>
              </div>

              <div class="space-y-1.5">
                <button v-for="item in group.items"
                  :key="item.refno"
                  type="button"
                  class="w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors"
                  :class="activeResultRefno === item.refno ? 'border-[#FF6B00] bg-[#FFF1E8]' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'"
                  @click="focusItem(item)">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="truncate text-xs font-medium text-gray-900">{{ item.name || item.refno }}</div>
                      <div class="mt-0.5 truncate font-mono text-[11px] text-gray-500">{{ item.refno }}</div>
                      <div class="mt-1 flex flex-wrap gap-1">
                        <span class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{{ item.noun || 'UNKNOWN' }}</span>
                        <span class="rounded-full px-2 py-0.5 text-[11px]" :class="item.loaded ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-700'">
                          {{ item.loaded ? '已加载' : '未加载' }}
                        </span>
                        <span v-if="item.distance !== null" class="rounded-full bg-[#FFF1E8] px-2 py-0.5 text-[11px] text-[#C84D00]">
                          {{ formatDistance(item.distance) }}
                        </span>
                      </div>
                    </div>

                    <div class="flex shrink-0 items-center gap-1">
                      <button type="button"
                        class="rounded-md p-1 text-gray-500 hover:bg-white hover:text-gray-800"
                        :title="item.visible ? '隐藏' : '显示'"
                        @click.stop="toggleVisibility(item)">
                        <Eye v-if="item.visible" class="h-4 w-4" />
                        <EyeOff v-else class="h-4 w-4" />
                      </button>
                      <button type="button"
                        class="rounded-md p-1 text-gray-500 hover:bg-white hover:text-gray-800"
                        title="飞行定位"
                        @click.stop="focusItem(item)">
                        <ArrowUpRight class="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { ArrowUpRight, Eye, EyeOff, Loader2, MapPinned, MousePointerClick, Search, X } from 'lucide-vue-next';

import type { SpatialQueryMode, SpatialQueryResultItem } from '@/types/spatialQuery';

import { useSpatialQuery } from '@/composables/useSpatialQuery';
import { SITE_SPEC_OPTIONS } from '@/types/spec';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const spatialQuery = useSpatialQuery();
const {
  draft,
  status,
  error,
  resultSet,
  activeResultRefno,
  canSubmit,
  setMode: setSpatialQueryMode,
  applyCurrentSelection,
  startPickCenter,
  submitQuery,
  clearResults,
  activateResult,
  loadResults,
  showOnlySpecGroup,
  toggleResultVisible,
  setAllResultsVisible,
  isolateResults,
  restoreScene,
} = spatialQuery;

const DISTANCE_RADIUS_MIN = 100;
const DISTANCE_RADIUS_MAX = 10000;
const DISTANCE_RADIUS_STEP = 100;
const DISTANCE_RADIUS_PRESETS = [100, 500, 1000, 5000] as const;

const isQueryBusy = computed(() => ['resolving-center', 'querying-local', 'querying-server', 'merging-results', 'loading-model-for-result', 'loading-results-batch', 'flying-to-result'].includes(status.value));
const specOptions = SITE_SPEC_OPTIONS;
const selectedSpecValues = computed(() => new Set(draft.specValues));

const showCoordinateInputs = computed(() => {
  return (draft.mode === 'range' && (draft.rangeCenterSource === 'coordinates' || draft.rangeCenterSource === 'pick'))
    || (draft.mode === 'distance' && draft.distanceCenterSource === 'coordinates');
});

const centerSummary = computed(() => {
  return `${draft.center.x.toFixed(0)}, ${draft.center.y.toFixed(0)}, ${draft.center.z.toFixed(0)}`;
});

const statusLabel = computed(() => {
  switch (status.value) {
    case 'resolving-center':
      return '解析中心点...';
    case 'querying-local':
      return '扫描已加载模型...';
    case 'querying-server':
      return '查询空间索引...';
    case 'merging-results':
      return '合并结果...';
    case 'loading-model-for-result':
      return '加载模型...';
    case 'loading-results-batch':
      return '批量加载模型...';
    case 'flying-to-result':
      return '定位结果...';
    default:
      return '处理中...';
  }
});

const summaryText = computed(() => {
  if (!resultSet.value) {
    return '支持范围查询与距离查询，结果会按专业分组。';
  }
  return `共 ${resultSet.value.total} 项，已加载 ${resultSet.value.loadedCount} 项，未加载 ${resultSet.value.unloadedCount} 项`;
});

function closePanel() {
  emit('update:open', false);
}

function runQuery() {
  void submitQuery();
}

function useSelection() {
  applyCurrentSelection();
}

function startPick() {
  draft.rangeCenterSource = 'pick';
  startPickCenter();
}

/**
 * Distance 模式下从 viewer 当前选中拾取 Refno。
 * 复用 applyCurrentSelection 获取 refno，但保持 distanceCenterSource='refno' 不变。
 * applyCurrentSelection 会把 rangeCenterSource 改为 'selected'，在 distance 模式下无副作用（UI 走 distanceCenterSource）。
 */
function pickRefnoFromSelection() {
  applyCurrentSelection();
}

function onRadiusSliderInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = Number(target.value);
  if (Number.isFinite(value)) {
    draft.radius = value;
  }
}

function toggleSpecValue(specValue: number) {
  const next = new Set(draft.specValues);
  if (next.has(specValue)) {
    next.delete(specValue);
  } else {
    next.add(specValue);
  }
  draft.specValues = Array.from(next).sort((a, b) => a - b);
}

function focusItem(item: SpatialQueryResultItem) {
  void activateResult(item);
}

function toggleVisibility(item: SpatialQueryResultItem) {
  toggleResultVisible(item);
}

function showAll() {
  setAllResultsVisible(true);
}

function hideAll() {
  setAllResultsVisible(false);
}

function isolateAll() {
  isolateResults();
}

function restoreAll() {
  restoreScene();
}

function loadCurrentResults() {
  void loadResults({ flyTo: true });
}

function loadUnloadedResults() {
  void loadResults({ onlyUnloaded: true, flyTo: true });
}

function loadSpecGroup(specValue: number) {
  void loadResults({ specValue, flyTo: true });
}

function showOnlyGroup(specValue: number) {
  showOnlySpecGroup(specValue);
}

function formatDistance(distance: number) {
  return `${distance.toFixed(0)} mm`;
}

function setModeAndKeepDraft(mode: SpatialQueryMode) {
  setSpatialQueryMode(mode);
}

function setMode(mode: SpatialQueryMode) {
  setModeAndKeepDraft(mode);
}
</script>

<style scoped>
.font-ui {
  font-family: 'Fira Sans', system-ui, sans-serif;
}
</style>
