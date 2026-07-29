<script setup lang="ts">
import { computed, watch, type Ref } from 'vue';

import {
  Eye,
  EyeOff,
  Focus,
  PanelRightOpen,
  Trash,
  Trash2,
  X,
} from 'lucide-vue-next';

import { ensurePanelAndActivate } from '@/composables/useDockApi';
import {
  type XeokitMeasurementKind,
  type XeokitMeasurementRecord,
  useToolStore,
} from '@/composables/useToolStore';
import { useXeokitMeasurementStyleStore } from '@/composables/useXeokitMeasurementStyleStore';
import { formatMeasurementKindLabel } from '@/utils/xeokitMeasurementFormat';

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  currentMeasurement: Ref<unknown>;
  hasVisibleMeasurements: Ref<boolean>;
  hasHiddenMeasurements: Ref<boolean>;
  flyToMeasurement: (id: string) => void;
  setMeasurementVisible: (id: string, visible: boolean) => void;
  setAllMeasurementsVisible: (visible: boolean) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;
  deactivate: () => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();
const measurementStyle = useXeokitMeasurementStyleStore();

const isVisible = computed(() => {
  return (
    store.toolMode.value === 'xeokit_measure_distance' ||
    store.toolMode.value === 'xeokit_measure_angle' ||
    store.toolMode.value === 'xeokit_measure_elevation_point' ||
    store.toolMode.value === 'xeokit_measure_elevation_delta'
  );
});

const sorted = computed<XeokitMeasurementRecord[]>(() => {
  return [...store.allXeokitMeasurements.value].sort((a, b) => b.createdAt - a.createdAt);
});

const activeMeasurement = computed(() => {
  const id = store.activeXeokitMeasurementId.value;
  if (!id) return null;
  return sorted.value.find((item) => item.id === id) ?? null;
});

const currentVisibilityLabel = computed(() => {
  return activeMeasurement.value?.visible ? '隐藏当前' : '显示当前';
});

const allVisibilityLabel = computed(() => {
  return props.tools.hasHiddenMeasurements.value ? '全部显示' : '全部隐藏';
});

const hasAnyMeasurements = computed(() => sorted.value.length > 0);
const currentActionDisabled = computed(() => !activeMeasurement.value);
const pointSetSourceEnabled = computed(() => {
  const source = measurementStyle.state.measurementPickSources.ptset;
  return source.snap;
});
const centerPointSourceEnabled = computed(() => {
  const source = measurementStyle.state.measurementPickSources.position;
  return source.snap;
});
const meshPointSourceEnabled = computed(() => {
  const source = measurementStyle.state.measurementPickSources.mesh_pick_point;
  return source.snap;
});
const isDistanceMode = computed(() => store.toolMode.value === 'xeokit_measure_distance');
const continuousMeasureEnabled = computed(() => store.continuousDistanceMeasureEnabled.value);
const pickMode = computed(() => measurementStyle.state.measurementPickMode);
/** 自由表面模式但表面点捕捉被关：合法组合，给出提示而不是静默切模式。 */
const freeSurfaceWithoutMeshSnap = computed(() => (
  pickMode.value === 'free_surface' && !meshPointSourceEnabled.value
));
const modeLabel = computed(() => {
  const modeToKind: Record<string, XeokitMeasurementKind> = {
    xeokit_measure_distance: 'distance',
    xeokit_measure_angle: 'angle',
    xeokit_measure_elevation_point: 'elevation_point',
    xeokit_measure_elevation_delta: 'elevation_delta',
  };
  return formatMeasurementKindLabel(modeToKind[store.toolMode.value] ?? 'distance');
});

function setMeasurementSource(source: 'ptset' | 'position' | 'mesh_pick_point', checked: boolean): void {
  measurementStyle.updateMeasurementPickSource(source, { snap: checked });
}

function setContinuousMeasure(checked: boolean): void {
  store.continuousDistanceMeasureEnabled.value = checked;
}

function setPickMode(mode: 'e3d' | 'free_surface'): void {
  measurementStyle.setMeasurementPickMode(mode);
}

function openMeasurementPanel(): void {
  ensurePanelAndActivate('measurement');
}

function flyCurrent(): void {
  if (!activeMeasurement.value) return;
  props.tools.flyToMeasurement(activeMeasurement.value.id);
}

function toggleCurrentVisible(): void {
  if (!activeMeasurement.value) return;
  props.tools.setMeasurementVisible(activeMeasurement.value.id, !activeMeasurement.value.visible);
}

function deleteCurrent(): void {
  if (!activeMeasurement.value) return;
  props.tools.removeMeasurement(activeMeasurement.value.id);
}

function toggleAllVisible(): void {
  if (!hasAnyMeasurements.value) return;
  props.tools.setAllMeasurementsVisible(props.tools.hasHiddenMeasurements.value);
}

function clearAll(): void {
  props.tools.clearMeasurements();
}

function exitMeasurement(): void {
  props.tools.deactivate();
}

watch(
  () => sorted.value.length,
  (count) => {
    if (count === 0) {
      store.activeXeokitMeasurementId.value = null;
    }
  },
);
</script>

<template>
  <div v-if="isVisible"
    data-testid="measurement-overlay-root"
    class="pointer-events-none absolute right-4 top-20 flex justify-end"
    style="z-index: 940">
    <div class="pointer-events-auto flex flex-col items-end gap-3"
      @pointerdown.stop
      @wheel.stop>
      <div data-testid="measurement-overlay-bar"
        class="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-background/90 px-3 py-2 shadow-lg backdrop-blur">
        <div class="mr-1 hidden items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground md:flex">
          <span class="font-medium text-foreground">{{ modeLabel }}</span>
          <span>共 {{ sorted.length }} 条</span>
        </div>

        <div data-testid="measurement-overlay-pick-mode"
          class="flex items-center overflow-hidden rounded-xl border border-border text-xs">
          <button type="button"
            data-testid="measurement-overlay-mode-e3d"
            class="h-8 px-2.5"
            :class="pickMode === 'e3d' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'"
            title="E3D 设计点捕捉：P-Point / Item 原点（Item Origin），P-Point 加载中不落点"
            @click="setPickMode('e3d')">
            E3D 捕捉
          </button>
          <button type="button"
            data-testid="measurement-overlay-mode-free"
            class="h-8 px-2.5"
            :class="pickMode === 'free_surface' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'"
            title="自由表面测量：模型表面点参与捕捉，不等待 P-Point"
            @click="setPickMode('free_surface')">
            自由表面
          </button>
        </div>

        <span v-if="freeSurfaceWithoutMeshSnap"
          data-testid="measurement-overlay-free-surface-hint"
          class="inline-flex h-8 items-center rounded-xl border border-amber-500/50 bg-amber-500/10 px-2 text-xs text-amber-600"
          title="自由表面模式下表面点捕捉已关闭，当前不会登记表面点；可在下方点源中重新开启">
          表面点捕捉已关
        </span>

        <div data-testid="measurement-overlay-source-picker"
          class="flex items-center gap-1 rounded-xl border border-border bg-muted/40 px-2 py-1 text-xs text-foreground">
          <label class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 hover:bg-background/70">
            <input type="checkbox"
              data-testid="measurement-overlay-source-ptset"
              class="h-3.5 w-3.5 accent-primary"
              :checked="pointSetSourceEnabled"
              aria-label="启用 P-Point 捕捉"
              title="P-Point"
              @change="setMeasurementSource('ptset', ($event.target as HTMLInputElement).checked)" />
            <span>P-Point</span>
          </label>
          <label class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 hover:bg-background/70">
            <input type="checkbox"
              data-testid="measurement-overlay-source-position"
              class="h-3.5 w-3.5 accent-primary"
              :checked="centerPointSourceEnabled"
              aria-label="启用 Item 原点捕捉"
              title="Item Origin（元素原点）"
              @change="setMeasurementSource('position', ($event.target as HTMLInputElement).checked)" />
            <span>Item 原点</span>
          </label>
          <label class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 hover:bg-background/70">
            <input type="checkbox"
              data-testid="measurement-overlay-source-mesh"
              class="h-3.5 w-3.5 accent-primary"
              :checked="meshPointSourceEnabled"
              aria-label="启用模型表面点测量"
              title="模型表面点"
              @change="setMeasurementSource('mesh_pick_point', ($event.target as HTMLInputElement).checked)" />
            <span>模型表面点</span>
          </label>
        </div>

        <label v-if="isDistanceMode"
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-2 text-xs text-foreground hover:bg-background/70">
          <input type="checkbox"
            data-testid="measurement-overlay-continuous"
            class="h-3.5 w-3.5 accent-primary"
            :checked="continuousMeasureEnabled"
            aria-label="启用连续距离测量"
            title="完成一段后自动以终点为起点继续测量（空格键重复上一段）"
            @change="setContinuousMeasure(($event.target as HTMLInputElement).checked)" />
          <span>连续测量</span>
        </label>

        <button type="button"
          data-testid="measurement-overlay-details-toggle"
          class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          title="打开测量面板"
          aria-label="打开测量面板"
          @click="openMeasurementPanel">
          <PanelRightOpen class="h-4 w-4" />
        </button>

        <button type="button"
          data-testid="measurement-overlay-fly-current"
          class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="currentActionDisabled"
          title="定位当前"
          aria-label="定位当前"
          @click="flyCurrent">
          <Focus class="h-4 w-4" />
        </button>

        <button type="button"
          data-testid="measurement-overlay-current-visibility"
          class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="currentActionDisabled"
          :title="currentVisibilityLabel"
          :aria-label="currentVisibilityLabel"
          @click="toggleCurrentVisible">
          <component :is="activeMeasurement?.visible ? EyeOff : Eye" class="h-4 w-4" />
        </button>

        <button type="button"
          data-testid="measurement-overlay-delete-current"
          class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="currentActionDisabled"
          title="删除当前"
          aria-label="删除当前"
          @click="deleteCurrent">
          <Trash2 class="h-4 w-4" />
        </button>

        <div class="h-7 w-px bg-border/80" />

        <button type="button"
          data-testid="measurement-overlay-all-visibility"
          class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!hasAnyMeasurements"
          :title="allVisibilityLabel"
          :aria-label="allVisibilityLabel"
          @click="toggleAllVisible">
          <component :is="props.tools.hasHiddenMeasurements.value ? Eye : EyeOff" class="h-4 w-4" />
        </button>

        <button type="button"
          data-testid="measurement-overlay-clear-all"
          class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!hasAnyMeasurements"
          title="清空全部"
          aria-label="清空全部"
          @click="clearAll">
          <Trash class="h-4 w-4" />
        </button>

        <div class="h-7 w-px bg-border/80" />

        <button type="button"
          data-testid="measurement-overlay-exit"
          class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-background text-sm hover:bg-muted"
          title="退出测量"
          aria-label="退出测量"
          @click="exitMeasurement">
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.18s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
