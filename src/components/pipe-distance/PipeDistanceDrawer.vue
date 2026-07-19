<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue';

import {
  BoxSelect,
  Check,
  Eye,
  EyeOff,
  MousePointerClick,
  RefreshCw,
  X,
  Locate,
  Trash2,
} from 'lucide-vue-next';
import { Vector3, type Matrix4 } from 'three';

import type { Vec3 } from '@/types/vec3';

import {
  findNounByRefnoAcrossAllDbnos,
  resolveDtxObjectIdsByRefno,
} from '@/composables/useDbnoInstancesDtxLoader';
import { usePipeDistanceAnnotationThree } from '@/composables/usePipeDistanceAnnotationThree';
import { usePipeDistanceStore, type PipeDistanceResult } from '@/composables/usePipeDistanceStore';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';
import {
  detectDtxBranchAxisDistances,
  resolveDtxAxisDistanceDbnum,
  type DtxBranchAxisDistanceLayer,
} from '@/utils/three/geometry/clearance/detectDtxBranchAxisDistances';

type ViewerWithDtxLayerMatrix = {
  __dtxLayer?: DtxBranchAxisDistanceLayer & {
    getGlobalModelMatrix?: () => Matrix4 | null;
  };
};

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const store = usePipeDistanceStore();
const toolStore = useToolStore();
const selectionStore = useSelectionStore();
const ctx = useViewerContext();

const isPicking = computed(() => toolStore.toolMode.value === 'pick_refno');
const isBoxPicking = computed(() => toolStore.toolMode.value === 'pick_refno_box');
const isAnyPicking = computed(() => isPicking.value || isBoxPicking.value);

// 3D 标注渲染（仅渲染当前可见的结果：跳过被 hide 的 + 不满足距离阈值的）
const annotationVis = usePipeDistanceAnnotationThree(
  computed(() => ctx.viewerRef.value),
  store.visibleResults,
  store.showAnnotations,
  computed(() => ctx.annotationSystem.value)
);

onUnmounted(() => {
  annotationVis.clearAnnotations();
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    delete (window as typeof window & { __plant3dPipeDistanceE2E?: unknown }).__plant3dPipeDistanceE2E;
  }
});

// --- pick BRAN pipe ---
function startPickBran() {
  toolStore.startPickRefno(['BRAN'], (refnos) => {
    for (const refno of refnos) {
      store.addBranRefno(refno);
    }
  });
}

function startBoxPickBran() {
  toolStore.startBoxPickRefno(['BRAN'], (refnos) => {
    for (const refno of refnos) {
      store.addBranRefno(refno);
    }
  });
}

// --- detection ---
function createSceneTransformPoint(): ((point: Vec3) => Vec3) | undefined {
  const matrix = (ctx.viewerRef.value as ViewerWithDtxLayerMatrix | null)?.__dtxLayer?.getGlobalModelMatrix?.();
  if (!matrix) return undefined;
  return (point: Vec3): Vec3 => {
    const p = new Vector3(point[0], point[1], point[2]).applyMatrix4(matrix);
    return [p.x, p.y, p.z];
  };
}

function createDtxAxisDistanceFallback(refnos: string[]): PipeDistanceResult[] {
  const dtxLayer = (ctx.viewerRef.value as ViewerWithDtxLayerMatrix | null)?.__dtxLayer;
  if (!dtxLayer) return [];

  return detectDtxBranchAxisDistances(dtxLayer, {
    refnos,
    maxAngleDeg: store.maxAngle.value,
    maxDistanceMm: store.maxDistance.value,
    includeBeyondMaxDistanceForSinglePair: true,
    resolveObjectIdsByRefno: (refno) => {
      const dbnum = resolveDtxAxisDistanceDbnum(refno);
      return dbnum ? resolveDtxObjectIdsByRefno(dbnum, refno) : [];
    },
  });
}

function applyDetectionFallbackResults(refnos: string[], fallbackResults: PipeDistanceResult[]): boolean {
  if (fallbackResults.length === 0) return false;
  store.setBranRefnos(refnos);
  store.showAnnotations.value = true;
  store.results.value = fallbackResults;
  store.activeResultIndex.value = 0;
  store.detectError.value = null;
  return true;
}

async function detectBransWithDtxFallback(refnos: string[]) {
  await store.autoDetectBrans(refnos, {
    transformPoint: createSceneTransformPoint(),
  });
  if (store.results.value.length > 0) return;

  const fallbackResults = createDtxAxisDistanceFallback(refnos);
  applyDetectionFallbackResults(refnos, fallbackResults);
}

async function handleDetect() {
  await detectBransWithDtxFallback(store.selectedBranRefnos.value);
}

function getCurrentSelectedBrans(): string[] {
  const candidates = [
    ...selectionStore.selectedRefnos.value,
    selectionStore.selectedRefno.value,
  ].filter((refno): refno is string => !!refno);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const refno of candidates) {
    const normalized = refno.trim().replace(/\//g, '_');
    if (!normalized || seen.has(normalized)) continue;
    const noun = (findNounByRefnoAcrossAllDbnos(normalized) || '').toUpperCase();
    if (noun !== 'BRAN') continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function detectCurrentSelectedBrans(options: { quiet?: boolean } = {}) {
  const refnos = getCurrentSelectedBrans();
  if (refnos.length < 2) {
    if (!options.quiet) {
      store.detectError.value = '当前选中不足 2 根 BRAN 管道';
    }
    return;
  }
  await detectBransWithDtxFallback(refnos);
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as typeof window & {
    __plant3dPipeDistanceE2E?: {
      detectBrans: (refnos: string[]) => Promise<void>;
      setDebugResults: (results: PipeDistanceResult[]) => void;
      getSnapshot: () => {
        selectedBranRefnos: string[];
        detectError: string | null;
        visibleResults: PipeDistanceResult[];
        results: PipeDistanceResult[];
      };
    };
  }).__plant3dPipeDistanceE2E = {
    detectBrans: detectBransWithDtxFallback,
    setDebugResults: (results: PipeDistanceResult[]) => {
      store.setBranRefnos([...new Set(results.flatMap((result) => [result.pipeA, result.pipeB]))]);
      const maxInjectedDistance = Math.max(0, ...results.map((result) => result.distance));
      if (Number.isFinite(maxInjectedDistance)) {
        store.maxDistance.value = Math.max(store.maxDistance.value, Math.ceil(maxInjectedDistance));
      }
      store.showAnnotations.value = true;
      store.results.value = [...results];
      store.activeResultIndex.value = results.length > 0 ? 0 : null;
      store.detectError.value = null;
    },
    getSnapshot: () => ({
      selectedBranRefnos: [...store.selectedBranRefnos.value],
      detectError: store.detectError.value,
      visibleResults: [...store.visibleResults.value],
      results: [...store.results.value],
    }),
  };
}

// --- result click ---
function onResultClick(index: number, result: PipeDistanceResult) {
  store.setActiveResult(index);
  const viewer = ctx.viewerRef.value;
  if (!viewer) return;
  try {
    // 取消之前的选中
    const prev = viewer.scene.selectedObjectIds;
    if (prev.length > 0) viewer.scene.setObjectsSelected(prev, false);
    // 高亮选中的管道对
    viewer.scene.ensureRefnos([result.pipeA, result.pipeB]);
    viewer.scene.setObjectsSelected([result.pipeA, result.pipeB], true);
    // 飞行定位到管道对
    const [s, e] = [result.start, result.end];
    const aabb: [number, number, number, number, number, number] = [
      Math.min(s[0], e[0]), Math.min(s[1], e[1]), Math.min(s[2], e[2]),
      Math.max(s[0], e[0]), Math.max(s[1], e[1]), Math.max(s[2], e[2]),
    ];
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  } catch {
    // ignore
  }
}

function close() {
  if (isAnyPicking.value) {
    toolStore.cancelPickRefno();
  }
  emit('update:open', false);
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    if (store.selectedBranRefnos.value.length > 0 || store.results.value.length > 0) return;
    void detectCurrentSelectedBrans({ quiet: true });
  },
);

// --- validation helpers ---
const clampedMaxDistance = computed({
  get: () => store.maxDistance.value,
  set: (v: number) => {
    store.maxDistance.value = Math.max(50, Math.min(2000, Number(v) || 500));
  },
});

const clampedMaxAngle = computed({
  get: () => store.maxAngle.value,
  set: (v: number) => {
    store.maxAngle.value = Math.max(1, Math.min(15, Number(v) || 5));
  },
});

const resultMinDistanceInput = computed({
  get: () => store.resultMinDistance.value ?? 0,
  set: (v: number) => {
    const n = Number(v);
    store.setResultMinDistance(Number.isFinite(n) && n > 0 ? Math.round(n) : null);
  },
});

const hiddenCount = computed(() => store.results.value.filter((r) => store.hiddenResultIds.value.has(r.id)).length);

function isResultHidden(id: string): boolean {
  return store.hiddenResultIds.value.has(id);
}
</script>

<template>
  <div>
    <!-- drawer panel -->
    <Transition name="pd-drawer-slide">
      <div v-if="open"
        class="pointer-events-auto absolute bottom-0 right-0 top-0 flex w-80 flex-col border-l border-border bg-background/95 shadow-xl backdrop-blur"
        style="z-index: 942"
        @pointerdown.stop
        @wheel.stop
        @click.stop>
        <!-- header -->
        <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div class="text-sm font-semibold">距离标注控制</div>
          <button type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
            @click="close">
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- scrollable content -->
        <div class="flex-1 overflow-auto">
          <!-- 1. 显示控制 -->
          <div class="border-b border-border/60 px-4 py-3">
            <label class="flex cursor-pointer items-center gap-2">
              <span class="flex h-4 w-4 items-center justify-center rounded"
                :class="store.showAnnotations.value
                  ? 'bg-brand'
                  : 'border border-gray-300 bg-white'">
                <Check v-if="store.showAnnotations.value" class="h-3 w-3 text-white" />
              </span>
              <input v-model="store.showAnnotations.value" type="checkbox" class="sr-only" />
              <span class="text-sm">显示管道间距离标注</span>
            </label>
          </div>

          <!-- 2. 选择 BRAN 管道（点击 + 拖框 两种模式） -->
          <div class="space-y-2 border-b border-border/60 px-4 py-3">
            <div class="grid grid-cols-2 gap-2">
              <button type="button"
                class="inline-flex items-center justify-center gap-1.5 rounded-md border-2 border-brand px-2 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
                :class="isPicking ? 'bg-brand/10' : ''"
                :title="isPicking ? '逐根点击 (Enter 确认 / ESC 取消)' : '逐根点击 BRAN'"
                @click="startPickBran">
                <MousePointerClick class="h-3.5 w-3.5" />
                <span>{{ isPicking ? '点击中...' : '点击选' }}</span>
              </button>
              <button type="button"
                class="inline-flex items-center justify-center gap-1.5 rounded-md border-2 border-brand px-2 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
                :class="isBoxPicking ? 'bg-brand/10' : ''"
                :title="isBoxPicking ? '在 3D 视图里拖框选择多根 BRAN' : '拖框选择多根 BRAN'"
                @click="startBoxPickBran">
                <BoxSelect class="h-3.5 w-3.5" />
                <span>{{ isBoxPicking ? '拖框中...' : '拖框选' }}</span>
              </button>
            </div>
            <button type="button"
              class="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
              :disabled="store.isDetecting.value"
              title="导入当前选中的 BRAN 并立即检测"
              @click="detectCurrentSelectedBrans()">
              <Check class="h-3.5 w-3.5" />
              当前选中并检测
            </button>
            <div v-if="isAnyPicking" class="text-[11px] text-muted-foreground">
              <template v-if="isPicking">逐根点击 BRAN，按 Enter 确认 / ESC 取消</template>
              <template v-else>在 3D 视图里按住左键拖出选择框（向左拖：完全包含；向右拖：相交即选）</template>
            </div>

            <!-- 已选管道列表 -->
            <div v-if="store.selectedBranRefnos.value.length > 0" class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">已选 {{ store.selectedBranRefnos.value.length }} 根管道</span>
                <button type="button"
                  class="text-xs text-destructive hover:underline"
                  @click="store.clearBranRefnos()">
                  清空
                </button>
              </div>
              <div class="flex flex-wrap gap-1">
                <span v-for="refno in store.selectedBranRefnos.value" :key="refno"
                  class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {{ refno }}
                  <button type="button"
                    class="hover:text-destructive"
                    @click="store.removeBranRefno(refno)">
                    <X class="h-3 w-3" />
                  </button>
                </span>
              </div>
            </div>
          </div>

          <!-- 3. 参数设置 -->
          <div class="space-y-3 border-b border-border/60 px-4 py-3">
            <!-- 最大距离 -->
            <div class="space-y-1">
              <label class="text-xs font-medium text-foreground">最大距离</label>
              <div class="flex items-center gap-2">
                <input v-model.number="clampedMaxDistance"
                  type="number"
                  min="50" max="2000"
                  class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                <span class="text-xs text-muted-foreground">mm</span>
              </div>
            </div>

            <!-- 最大夹角 -->
            <div class="space-y-1">
              <label class="text-xs font-medium text-foreground">最大夹角</label>
              <div class="flex items-center gap-2">
                <input v-model.number="clampedMaxAngle"
                  type="number"
                  min="1" max="15"
                  class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                <span class="text-xs text-muted-foreground">°</span>
              </div>
            </div>

            <!-- 重新检测 -->
            <button type="button"
              :disabled="store.isDetecting.value || store.selectedBranRefnos.value.length < 2"
              class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              @click="handleDetect">
              <RefreshCw class="h-4 w-4" :class="store.isDetecting.value ? 'animate-spin' : ''" />
              <span>{{ store.isDetecting.value ? '检测中...' : '重新检测' }}</span>
            </button>
            <div v-if="store.selectedBranRefnos.value.length < 2 && !store.isDetecting.value"
              class="text-xs text-muted-foreground">
              至少选择 2 根 BRAN 管道才能检测
            </div>

            <!-- 错误提示 -->
            <div v-if="store.detectError.value"
              class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {{ store.detectError.value }}
            </div>
          </div>

          <!-- 4. 检测结果 -->
          <div class="px-4 py-3">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-semibold text-foreground">
                检测结果 ({{ store.visibleResults.value.length }}
                <span v-if="store.visibleResults.value.length !== store.results.value.length" class="text-muted-foreground">/ {{ store.results.value.length }}</span>)
              </span>
              <button v-if="store.results.value.length > 0" type="button"
                class="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                @click="store.clearResults()">
                <Trash2 class="h-3 w-3" />
                清空
              </button>
            </div>

            <!-- 距离阈值筛选 -->
            <div v-if="store.results.value.length > 0" class="mb-2 flex items-center gap-2">
              <label class="text-[11px] text-muted-foreground whitespace-nowrap">仅看 ≥</label>
              <input v-model.number="resultMinDistanceInput"
                type="number"
                min="0" max="2000"
                placeholder="0"
                class="flex h-7 w-20 rounded-md border border-input bg-background px-2 py-0.5 font-mono text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <span class="text-[11px] text-muted-foreground">mm</span>
              <button v-if="store.resultMinDistance.value !== null || hiddenCount > 0"
                type="button"
                class="ml-auto text-[11px] text-brand hover:underline"
                @click="store.resetResultFilters()">
                重置筛选
              </button>
            </div>

            <div v-if="hiddenCount > 0" class="mb-2 text-[11px] text-muted-foreground">
              已隐藏 {{ hiddenCount }} 条
            </div>

            <div v-if="store.results.value.length === 0"
              class="py-4 text-center text-xs text-muted-foreground">
              暂无检测结果
            </div>

            <!-- result list (scrollable) -->
            <div v-else-if="store.visibleResults.value.length === 0"
              class="py-4 text-center text-xs text-muted-foreground">
              所有结果均被筛选 / 隐藏，<button type="button" class="text-brand hover:underline" @click="store.resetResultFilters()">点此重置</button>
            </div>
            <div v-else
              class="max-h-[200px] overflow-auto rounded-md border border-border">
              <div v-for="(result, idx) in store.results.value"
                v-show="!isResultHidden(result.id) && (store.resultMinDistance.value === null || result.distance >= store.resultMinDistance.value)"
                :key="result.id"
                class="group flex cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2.5 transition-colors last:border-b-0"
                :class="store.activeResultIndex.value === idx
                  ? 'bg-brand-subtle border-l-2 border-l-brand'
                  : 'hover:bg-muted'"
                @click="onResultClick(idx, result)">
                <span class="font-mono text-sm font-semibold"
                  :class="store.activeResultIndex.value === idx ? 'text-brand' : 'text-foreground'">
                  {{ result.distance }}
                </span>
                <span class="text-xs text-muted-foreground">mm</span>
                <span class="flex-1 truncate text-xs text-muted-foreground">
                  {{ result.pipeA }} ↔ {{ result.pipeB }}
                </span>
                <button type="button"
                  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 transition-colors hover:bg-muted-foreground/20 hover:text-foreground group-hover:opacity-100"
                  :title="isResultHidden(result.id) ? '显示该条标注' : '隐藏该条标注'"
                  @click.stop="store.toggleResultHidden(result.id)">
                  <EyeOff v-if="isResultHidden(result.id)" class="h-3 w-3" />
                  <Eye v-else class="h-3 w-3" />
                </button>
                <button type="button"
                  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-muted-foreground/20 group-hover:opacity-100"
                  title="定位"
                  @click.stop="onResultClick(idx, result)">
                  <Locate class="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.pd-drawer-slide-enter-active,
.pd-drawer-slide-leave-active {
  transition: transform 0.25s ease;
}
.pd-drawer-slide-enter-from,
.pd-drawer-slide-leave-to {
  transform: translateX(100%);
}
.pd-drawer-fade-enter-active,
.pd-drawer-fade-leave-active {
  transition: opacity 0.25s ease;
}
.pd-drawer-fade-enter-from,
.pd-drawer-fade-leave-to {
  opacity: 0;
}
</style>
