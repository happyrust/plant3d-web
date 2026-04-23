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
  type XeokitMeasurementRecord,
  useToolStore,
} from '@/composables/useToolStore';

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

const isVisible = computed(() => {
  return (
    store.toolMode.value === 'xeokit_measure_distance' ||
    store.toolMode.value === 'xeokit_measure_angle'
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
const modeLabel = computed(() => {
  return store.toolMode.value === 'xeokit_measure_angle' ? '角度测量' : '距离测量';
});

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
