<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from 'vue';

import {
  ChevronDown,
  ListChecks,
  Trash2,
  X,
} from 'lucide-vue-next';

import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useToolStore } from '@/composables/useToolStore';
import { useXeokitMeasurementStyleStore } from '@/composables/useXeokitMeasurementStyleStore';

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  removeMeasurement: (id: string) => void;
  deactivate: () => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();
const measurementStyle = useXeokitMeasurementStyleStore();
const rootEl = ref<HTMLElement | null>(null);
const settingsTriggerEl = ref<HTMLButtonElement | null>(null);
const settingsPopoverEl = ref<HTMLElement | null>(null);
const settingsOpen = ref(false);

const isVisible = computed(() => {
  return (
    store.toolMode.value === 'xeokit_measure_distance' ||
    store.toolMode.value === 'xeokit_measure_angle' ||
    store.toolMode.value === 'xeokit_measure_elevation_point' ||
    store.toolMode.value === 'xeokit_measure_elevation_delta'
  );
});

const sorted = computed(() => {
  return [...store.allXeokitMeasurements.value].sort((a, b) => b.createdAt - a.createdAt);
});

const activeMeasurement = computed(() => {
  const id = store.activeXeokitMeasurementId.value;
  if (!id) return null;
  return sorted.value.find((item) => item.id === id) ?? null;
});

const modeLabel = computed(() => {
  const labels: Record<string, string> = {
    xeokit_measure_distance: '距离',
    xeokit_measure_angle: '角度',
    xeokit_measure_elevation_point: '点标高',
    xeokit_measure_elevation_delta: '高差',
  };
  return labels[store.toolMode.value] ?? '测量';
});

const compactStatusText = computed(() => {
  if (!props.tools.ready.value) return '未就绪';
  const status = props.tools.statusText.value;
  return status.match(/捕捉[^（，；]+/)?.[0] ?? '等待取点';
});

const pointSetSourceEnabled = computed(() => {
  return measurementStyle.state.measurementPickSources.ptset.snap;
});
const centerPointSourceEnabled = computed(() => {
  return measurementStyle.state.measurementPickSources.position.snap;
});
const meshPointSourceEnabled = computed(() => {
  return measurementStyle.state.measurementPickSources.mesh_pick_point.snap;
});
const isDistanceMode = computed(() => store.toolMode.value === 'xeokit_measure_distance');
const continuousMeasureEnabled = computed(() => store.continuousDistanceMeasureEnabled.value);
const pickMode = computed(() => measurementStyle.state.measurementPickMode);
const pickModeLabel = computed(() => pickMode.value === 'e3d' ? 'E3D' : '自由表面');
const freeSurfaceWithoutMeshSnap = computed(() => (
  pickMode.value === 'free_surface' && !meshPointSourceEnabled.value
));
const currentActionDisabled = computed(() => !activeMeasurement.value);

function setMeasurementSource(
  source: 'ptset' | 'position' | 'mesh_pick_point',
  checked: boolean,
): void {
  measurementStyle.updateMeasurementPickSource(source, { snap: checked });
}

function setContinuousMeasure(checked: boolean): void {
  store.continuousDistanceMeasureEnabled.value = checked;
}

function setPickMode(mode: 'e3d' | 'free_surface'): void {
  measurementStyle.setMeasurementPickMode(mode);
}

async function toggleSettings(): Promise<void> {
  settingsOpen.value = !settingsOpen.value;
  if (!settingsOpen.value) return;
  await nextTick();
  settingsPopoverEl.value?.querySelector<HTMLElement>('button, input')?.focus();
}

function openMeasurementPanel(): void {
  settingsOpen.value = false;
  ensurePanelAndActivate('measurement');
}

function deleteCurrent(): void {
  if (!activeMeasurement.value) return;
  props.tools.removeMeasurement(activeMeasurement.value.id);
}

function exitMeasurement(): void {
  settingsOpen.value = false;
  props.tools.deactivate();
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!settingsOpen.value) return;
  const target = event.target;
  if (target instanceof Node && !rootEl.value?.contains(target)) {
    settingsOpen.value = false;
  }
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !settingsOpen.value) return;
  event.preventDefault();
  event.stopPropagation();
  settingsOpen.value = false;
  settingsTriggerEl.value?.focus();
}

watch(
  () => sorted.value.length,
  (count) => {
    if (count === 0) {
      store.activeXeokitMeasurementId.value = null;
    }
  },
);

watch(isVisible, (visible) => {
  if (!visible) settingsOpen.value = false;
});

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
});
</script>

<template>
  <div v-if="isVisible"
    ref="rootEl"
    data-testid="measurement-overlay-root"
    class="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2"
    style="z-index: 940">
    <div class="pointer-events-auto relative"
      @pointerdown.stop
      @wheel.stop>
      <div data-testid="measurement-overlay-bar"
        class="flex h-12 max-w-[360px] flex-nowrap items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-lg backdrop-blur">
        <div data-testid="measurement-overlay-status"
          class="flex h-10 min-w-0 max-w-28 items-center gap-1 truncate rounded-lg bg-muted/60 px-2 text-xs"
          role="status"
          aria-live="polite"
          :title="props.tools.statusText.value">
          <span class="shrink-0 font-semibold text-foreground">{{ modeLabel }}</span>
          <span class="truncate text-muted-foreground">· {{ compactStatusText }}</span>
        </div>

        <button ref="settingsTriggerEl"
          type="button"
          data-testid="measurement-overlay-settings-trigger"
          class="relative inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-input bg-background px-2 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="settingsOpen ? 'bg-muted' : ''"
          :aria-expanded="settingsOpen"
          aria-controls="measurement-overlay-settings"
          aria-haspopup="dialog"
          :aria-label="freeSurfaceWithoutMeshSnap
            ? `${pickModeLabel}设置，表面点捕捉已关闭`
            : `${pickModeLabel}设置`"
          :title="`${pickMode === 'e3d' ? 'E3D 捕捉' : '自由表面'}设置`"
          @click="toggleSettings">
          <span>{{ pickModeLabel }}</span>
          <ChevronDown class="h-3.5 w-3.5" />
          <span v-if="freeSurfaceWithoutMeshSnap"
            data-testid="measurement-overlay-warning-dot"
            class="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500"
            aria-hidden="true" />
        </button>

        <button type="button"
          data-testid="measurement-overlay-delete-current"
          class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-destructive hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="currentActionDisabled"
          title="删除当前测量"
          aria-label="删除当前测量"
          @click="deleteCurrent">
          <Trash2 class="h-4 w-4" />
        </button>

        <button type="button"
          data-testid="measurement-overlay-details-toggle"
          class="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :title="`打开测量列表（${sorted.length} 条）`"
          :aria-label="`打开测量列表，共 ${sorted.length} 条`"
          @click="openMeasurementPanel">
          <ListChecks class="h-4 w-4" />
          <span class="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
            {{ sorted.length }}
          </span>
        </button>

        <button type="button"
          data-testid="measurement-overlay-exit"
          class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="退出测量"
          aria-label="退出测量"
          @click="exitMeasurement">
          <X class="h-4 w-4" />
        </button>
      </div>

      <div v-if="settingsOpen"
        id="measurement-overlay-settings"
        ref="settingsPopoverEl"
        data-testid="measurement-overlay-settings-popover"
        class="absolute right-0 top-[calc(100%+0.5rem)] w-64 rounded-xl border border-border bg-background/95 p-3 text-xs shadow-xl backdrop-blur"
        role="dialog"
        aria-label="测量捕捉设置">
        <div data-testid="measurement-overlay-pick-mode"
          class="grid grid-cols-2 overflow-hidden rounded-lg border border-border">
          <button type="button"
            data-testid="measurement-overlay-mode-e3d"
            class="h-10 px-2"
            :class="pickMode === 'e3d' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'"
            title="E3D 设计点捕捉：P-Point / Item 原点"
            @click="setPickMode('e3d')">
            E3D 捕捉
          </button>
          <button type="button"
            data-testid="measurement-overlay-mode-free"
            class="h-10 px-2"
            :class="pickMode === 'free_surface' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'"
            title="自由表面测量：模型表面点参与捕捉"
            @click="setPickMode('free_surface')">
            自由表面
          </button>
        </div>

        <div data-testid="measurement-overlay-source-picker"
          class="mt-3 flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <label class="flex h-10 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-background/70">
            <input type="checkbox"
              data-testid="measurement-overlay-source-ptset"
              class="h-3.5 w-3.5 accent-primary"
              :checked="pointSetSourceEnabled"
              aria-label="启用 P-Point 捕捉"
              @change="setMeasurementSource('ptset', ($event.target as HTMLInputElement).checked)" />
            <span>P-Point</span>
          </label>
          <label class="flex h-10 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-background/70">
            <input type="checkbox"
              data-testid="measurement-overlay-source-position"
              class="h-3.5 w-3.5 accent-primary"
              :checked="centerPointSourceEnabled"
              aria-label="启用 Item 原点捕捉"
              @change="setMeasurementSource('position', ($event.target as HTMLInputElement).checked)" />
            <span>Item 原点</span>
          </label>
          <label class="flex h-10 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-background/70">
            <input type="checkbox"
              data-testid="measurement-overlay-source-mesh"
              class="h-3.5 w-3.5 accent-primary"
              :checked="meshPointSourceEnabled"
              aria-label="启用模型表面点测量"
              @change="setMeasurementSource('mesh_pick_point', ($event.target as HTMLInputElement).checked)" />
            <span>模型表面点</span>
          </label>
        </div>

        <div v-if="freeSurfaceWithoutMeshSnap"
          data-testid="measurement-overlay-free-surface-hint"
          class="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-700">
          自由表面模式下表面点捕捉已关闭。
        </div>

        <label v-if="isDistanceMode"
          class="mt-2 flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-2 hover:bg-muted">
          <input type="checkbox"
            data-testid="measurement-overlay-continuous"
            class="h-3.5 w-3.5 accent-primary"
            :checked="continuousMeasureEnabled"
            aria-label="启用连续距离测量"
            @change="setContinuousMeasure(($event.target as HTMLInputElement).checked)" />
          <span>连续测量</span>
        </label>

        <button type="button"
          data-testid="measurement-overlay-more-settings"
          class="mt-3 h-10 w-full rounded-lg border border-input bg-background px-3 text-left hover:bg-muted"
          @click="openMeasurementPanel">
          更多测量设置…
        </button>
      </div>
    </div>
  </div>
</template>
