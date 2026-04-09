<template>
  <div v-if="open"
    class="pointer-events-auto absolute right-[60px] top-[120px] z-[950] flex max-h-[85vh] w-[360px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
    @pointerdown.stop
    @wheel.stop>
    <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3">
      <div>
        <div class="font-ui text-base font-semibold text-gray-900">空间查询</div>
        <div class="mt-0.5 text-xs text-gray-500">统一使用毫米坐标与半径</div>
      </div>
      <button type="button" class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900" title="关闭" @click="closePanel">
        <X class="h-4 w-4" />
      </button>
    </div>

    <div class="flex flex-1 flex-col overflow-y-auto px-4 py-4">
      <div class="flex rounded-md bg-gray-100 p-1">
        <button type="button"
          class="flex-1 rounded py-1.5 text-sm font-medium transition-colors"
          :class="draft.mode === 'range' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
          @click="setMode('range')">
          范围查询
        </button>
        <button type="button"
          class="flex-1 rounded py-1.5 text-sm font-medium transition-colors"
          :class="draft.mode === 'distance' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
          @click="setMode('distance')">
          距离查询
        </button>
      </div>

      <div class="mt-4 flex flex-col gap-4">
        <template v-if="draft.mode === 'range'">
          <section class="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">中心来源</div>
            <div class="mt-2 grid grid-cols-3 gap-2">
              <button type="button"
                class="rounded-md border px-2 py-2 text-xs transition-colors"
                :class="draft.rangeCenterSource === 'selected' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.rangeCenterSource = 'selected'">
                当前选中
              </button>
              <button type="button"
                class="rounded-md border px-2 py-2 text-xs transition-colors"
                :class="draft.rangeCenterSource === 'pick' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="startPick">
                拾取中心
              </button>
              <button type="button"
                class="rounded-md border px-2 py-2 text-xs transition-colors"
                :class="draft.rangeCenterSource === 'coordinates' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.rangeCenterSource = 'coordinates'">
                手输坐标
              </button>
            </div>
            <div class="mt-2 flex gap-2">
              <button type="button"
                class="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                @click="useSelection">
                <MousePointerClick class="h-3.5 w-3.5" />
                使用当前选中
              </button>
              <div class="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
                <MapPinned class="h-3.5 w-3.5 text-[#FF6B00]" />
                <span>{{ centerSummary }}</span>
              </div>
            </div>
          </section>

          <section class="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">查询形状</div>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <button type="button"
                class="rounded-md border px-3 py-2 text-sm transition-colors"
                :class="draft.shape === 'sphere' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.shape = 'sphere'">
                球形
              </button>
              <button type="button"
                class="rounded-md border px-3 py-2 text-sm transition-colors"
                :class="draft.shape === 'cube' ? 'border-[#FF6B00] bg-[#FFF1E8] text-[#C84D00]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.shape = 'cube'">
                立方体
              </button>
            </div>
          </section>
        </template>

        <template v-else>
          <section class="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">起始位置</div>
            <div class="mt-2 flex rounded-md bg-white p-1">
              <button type="button"
                class="flex-1 rounded py-1.5 text-sm font-medium transition-colors"
                :class="draft.distanceCenterSource === 'refno' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'"
                @click="draft.distanceCenterSource = 'refno'">
                通过 Refno
              </button>
              <button type="button"
                class="flex-1 rounded py-1.5 text-sm font-medium transition-colors"
                :class="draft.distanceCenterSource === 'coordinates' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'"
                @click="draft.distanceCenterSource = 'coordinates'">
                通过坐标
              </button>
            </div>
            <div v-if="draft.distanceCenterSource === 'refno'" class="mt-3">
              <label class="mb-1 block text-xs text-gray-500">起始物项 Refno</label>
              <input v-model="draft.refno"
                type="text"
                placeholder="例如：24381_100818"
                class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
            </div>
          </section>
        </template>

        <section v-if="showCoordinateInputs" class="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">中心坐标</div>
          <div class="mt-2 grid grid-cols-3 gap-2">
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">X</span>
              <input v-model.number="draft.center.x"
                type="number"
                class="h-10 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Y</span>
              <input v-model.number="draft.center.y"
                type="number"
                class="h-10 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Z</span>
              <input v-model.number="draft.center.z"
                type="number"
                class="h-10 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
          </div>
        </section>

        <section class="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
          <div class="grid grid-cols-2 gap-3">
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">查询半径 (mm)</span>
              <input v-model.number="draft.radius"
                type="number"
                min="1"
                class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">最大结果数</span>
              <input v-model.number="draft.limit"
                type="number"
                min="1"
                class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
          </div>
        </section>

        <section class="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">过滤条件</div>
          <div class="mt-3 flex flex-col gap-3">
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Noun 类型（逗号分隔）</span>
              <input v-model="draft.nounText"
                type="text"
                placeholder="例如：PIPE,EQUI,BRAN"
                class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <div class="text-xs text-gray-500">
              <div class="mb-1 block">专业筛选</div>
              <div class="flex flex-wrap gap-2">
                <button v-for="spec in specOptions"
                  :key="spec.value"
                  type="button"
                  class="rounded-full border px-3 py-1.5 transition-colors"
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
                class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
            </label>
            <div class="flex flex-wrap gap-2">
              <label class="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                <input v-model="draft.onlyLoaded" type="checkbox" />
                <span>仅看已加载</span>
              </label>
              <label class="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                <input v-model="draft.onlyVisible" type="checkbox" />
                <span>仅看当前可见</span>
              </label>
            </div>
          </div>
        </section>

        <button type="button"
          :disabled="!canSubmit || isBusy"
          class="mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#FF6B00] px-4 text-sm font-medium text-white transition-colors hover:bg-[#E35F00] disabled:cursor-not-allowed disabled:opacity-50"
          @click="runQuery">
          <Loader2 v-if="isBusy" class="h-4 w-4 animate-spin" />
          <Search v-else class="h-4 w-4" />
          <span>{{ isBusy ? statusLabel : '执行空间查询' }}</span>
        </button>

        <div v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {{ error }}
        </div>

        <section class="rounded-xl border border-gray-100 bg-white">
          <div class="flex items-center justify-between border-b border-gray-100 px-3 py-3">
            <div>
              <div class="text-sm font-semibold text-gray-900">查询结果</div>
              <div class="mt-0.5 text-xs text-gray-500">
                {{ summaryText }}
              </div>
            </div>
            <button v-if="resultSet"
              type="button"
              class="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              @click="clearResults">
              清空
            </button>
          </div>

          <div v-if="resultSet" class="border-b border-gray-100 px-3 py-2">
            <div class="grid grid-cols-2 gap-2">
              <button type="button" class="rounded-md border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50" @click="showAll">
                全部显示
              </button>
              <button type="button" class="rounded-md border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50" @click="hideAll">
                全部隐藏
              </button>
              <button type="button" class="rounded-md border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50" @click="isolateAll">
                隔离结果
              </button>
              <button type="button" class="rounded-md border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50" @click="restoreAll">
                恢复场景
              </button>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isBusy"
                @click="loadCurrentResults">
                加载当前筛选结果
              </button>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isBusy"
                @click="loadUnloadedResults">
                只加载未加载结果
              </button>
            </div>
          </div>

          <div v-if="resultSet?.warnings.length" class="space-y-2 border-b border-gray-100 px-3 py-2">
            <div v-for="warning in resultSet.warnings"
              :key="warning"
              class="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
              {{ warning }}
            </div>
          </div>

          <div v-if="!resultSet && !isBusy" class="px-3 py-8 text-center text-sm text-gray-400">
            暂无结果，执行一次空间查询后会在这里按专业分组显示。
          </div>

          <div v-else-if="resultSet && resultSet.items.length === 0 && !isBusy" class="px-3 py-8 text-center text-sm text-gray-400">
            当前条件下没有匹配结果。
          </div>

          <div v-else class="max-h-[320px] overflow-y-auto px-3 py-3">
            <div v-for="group in resultSet?.groups ?? []" :key="group.specValue" class="mb-4 last:mb-0">
              <div class="mb-2 flex items-center justify-between">
                <div>
                  <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {{ group.specName }}
                  </div>
                  <div class="mt-1 text-xs text-gray-400">{{ group.count }} 项</div>
                </div>
                <div class="flex items-center gap-2">
                  <button type="button"
                    class="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="isBusy"
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

              <div class="space-y-2">
                <button v-for="item in group.items"
                  :key="item.refno"
                  type="button"
                  class="w-full rounded-xl border px-3 py-2 text-left transition-colors"
                  :class="activeResultRefno === item.refno ? 'border-[#FF6B00] bg-[#FFF1E8]' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'"
                  @click="focusItem(item)">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-gray-900">{{ item.name || item.refno }}</div>
                      <div class="mt-1 truncate font-mono text-xs text-gray-500">{{ item.refno }}</div>
                      <div class="mt-1 flex flex-wrap gap-1.5">
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
                        class="rounded-md p-1.5 text-gray-500 hover:bg-white hover:text-gray-800"
                        :title="item.visible ? '隐藏' : '显示'"
                        @click.stop="toggleVisibility(item)">
                        <Eye v-if="item.visible" class="h-4 w-4" />
                        <EyeOff v-else class="h-4 w-4" />
                      </button>
                      <button type="button"
                        class="rounded-md p-1.5 text-gray-500 hover:bg-white hover:text-gray-800"
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

const props = defineProps<{
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

const isBusy = computed(() => ['resolving-center', 'querying-local', 'querying-server', 'merging-results', 'loading-model-for-result', 'loading-results-batch', 'flying-to-result'].includes(status.value));
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

// keep template syntax concise
function setMode(mode: SpatialQueryMode) {
  setModeAndKeepDraft(mode);
}
</script>

<style scoped>
.font-ui {
  font-family: "Fira Sans", system-ui, sans-serif;
}
</style>
