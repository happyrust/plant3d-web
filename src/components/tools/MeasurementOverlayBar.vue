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
import {
  MEASUREMENT_PICK_FILTER_AVAILABILITY,
  MEASUREMENT_PICK_FILTER_HINTS,
  MEASUREMENT_PICK_FILTER_IDS,
  MEASUREMENT_PICK_FILTER_LABELS,
  MEASUREMENT_PICK_TYPE_AVAILABILITY,
  MEASUREMENT_PICK_TYPE_HINTS,
  MEASUREMENT_PICK_TYPE_IDS,
  MEASUREMENT_PICK_TYPE_LABELS,
  MEASUREMENT_PICK_TYPE_VALUE_KEY,
  MEASUREMENT_SIGNIFICANT_SNAP_POINT_HINTS,
  MEASUREMENT_SIGNIFICANT_SNAP_POINT_IDS,
  MEASUREMENT_SIGNIFICANT_SNAP_POINT_LABELS,
  measurementPickFilterAdmits,
  type MeasurementPickFilterId,
  type MeasurementPickTypeId,
  type MeasurementPickTypeValues,
  type MeasurementSignificantSnapPointId,
} from '@/measurement/pick/pickLayerModel';

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
  // E3D 分步命令提示：`第 1/2 步 选择起点 · Snap: <目标>`（r5 P0-1）。
  const stepText = status.match(/第 \d\/\d 步[^；]*/)?.[0];
  if (stepText) return stepText.trim();
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
/**
 * 表面点捕捉开着，但当前拾取过滤器 × 拾取类型不放行它（Any / Element 只在 Cursor 类型取元素表面点，Pline / Ppoint / Graphics / Aid
 * 从不给表面点，ADR 0060（1 修订））——用户开着开关却拾不到裸表面点，提示一句该切什么。
 */
const surfaceNotAdmitted = computed(() => (
  meshPointSourceEnabled.value
  && !measurementPickFilterAdmits(pickLayer.value.filter, pickLayer.value.pickType, 'surface')
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

// ── E3D Positioning Control 拾取层：过滤器 × 拾取类型 + Significant Snaps ──
const pickLayer = computed(() => measurementStyle.state.measurementPickLayer);
const pickTypeValueKey = computed<keyof MeasurementPickTypeValues | null>(() => (
  MEASUREMENT_PICK_TYPE_VALUE_KEY[pickLayer.value.pickType] ?? null
));
const PICK_TYPE_VALUE_FIELD: Readonly<Record<keyof MeasurementPickTypeValues, {
  label: string;
  min: number;
  max?: number;
  step: number;
}>> = {
  distanceMm: { label: '距离 (mm)', min: -1e9, step: 1 },
  fraction: { label: '等分数 n', min: 1, step: 1 },
  proportion: { label: '比例 0–1', min: 0, max: 1, step: 0.05 },
};
const pickTypeValueField = computed(() => (
  pickTypeValueKey.value ? PICK_TYPE_VALUE_FIELD[pickTypeValueKey.value] : null
));
const pickTypeValue = computed(() => (
  pickTypeValueKey.value ? pickLayer.value.values[pickTypeValueKey.value] : null
));

function pickFilterTitle(id: MeasurementPickFilterId): string {
  const availability = MEASUREMENT_PICK_FILTER_AVAILABILITY[id];
  return availability.available
    ? MEASUREMENT_PICK_FILTER_HINTS[id]
    : `${MEASUREMENT_PICK_FILTER_HINTS[id]}——${availability.reason}`;
}

function pickTypeTitle(id: MeasurementPickTypeId): string {
  const availability = MEASUREMENT_PICK_TYPE_AVAILABILITY[id];
  return availability.available
    ? MEASUREMENT_PICK_TYPE_HINTS[id]
    : `${MEASUREMENT_PICK_TYPE_HINTS[id]}——${availability.reason}`;
}

function setPickFilter(filter: MeasurementPickFilterId): void {
  if (!MEASUREMENT_PICK_FILTER_AVAILABILITY[filter].available) return;
  measurementStyle.updateMeasurementPickLayer({ filter });
}

function setPickType(pickType: MeasurementPickTypeId): void {
  if (!MEASUREMENT_PICK_TYPE_AVAILABILITY[pickType].available) return;
  measurementStyle.updateMeasurementPickLayer({ pickType });
}

function setPickTypeValue(target: HTMLInputElement): void {
  const key = pickTypeValueKey.value;
  if (!key) return;
  measurementStyle.updateMeasurementPickLayer({ values: { [key]: target.value } as Partial<MeasurementPickTypeValues> });
  // Redisplay what the store kept (E3D `EDGPOSCNTRL.setPickType` 1434 / the dp-0 gadget: typing `2.5`
  // for Fraction shows `3`). `:value` alone would not repaint when the normalised value did not change.
  const kept = pickLayer.value.values[key];
  target.value = Number.isFinite(kept) ? String(kept) : '';
}

function setSignificantSnaps(checked: boolean): void {
  measurementStyle.updateMeasurementPickLayer({ significantSnaps: checked });
}

// ── E3D Pick Settings → Sections & Walls：Pline End Position（EDGPLINE.cut）+ Significant Snap Points ──
const PLINE_END_OPTIONS: readonly Readonly<{ id: 'uncut' | 'cut'; cut: boolean; label: string; hint: string }>[] = [
  {
    id: 'uncut',
    cut: false,
    label: 'Uncut',
    hint: 'Uncut (Intersect with cutplane)：p-line 取 POSS / POSE 截面平面上的两端（E3D PLSTART → PLEND，缺省）',
  },
  {
    id: 'cut',
    cut: true,
    label: 'Cut',
    hint: 'Cut (Use end preparation)：p-line 取按 DRNS / DRNE 斜切后的两端（E3D PLSTCUT → PLENCUT）；平头端不变',
  },
];

function setPlineCut(cut: boolean): void {
  measurementStyle.updateMeasurementPickLayer({ plineCut: cut });
}

function setSignificantSnapPoint(id: MeasurementSignificantSnapPointId, checked: boolean): void {
  measurementStyle.updateMeasurementPickLayer({ significantSnapPoints: { [id]: checked } });
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
  if (!visible) {
    settingsOpen.value = false;
    return;
  }
  // E3D 口径：测量命令激活时结果窗体随命令打开（Result Inspector 常驻）。
  ensurePanelAndActivate('measurement');
}, { immediate: true });

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
        class="flex h-12 max-w-[440px] flex-nowrap items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-lg backdrop-blur">
        <div data-testid="measurement-overlay-status"
          class="flex h-10 min-w-0 max-w-52 items-center gap-1 truncate rounded-lg bg-muted/60 px-2 text-xs"
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
            : surfaceNotAdmitted
              ? `${pickModeLabel}设置，当前过滤器 × 类型不放行表面点`
              : `${pickModeLabel}设置`"
          :title="`${pickMode === 'e3d' ? 'E3D 捕捉' : '自由表面'}设置`"
          @click="toggleSettings">
          <span>{{ pickModeLabel }}</span>
          <ChevronDown class="h-3.5 w-3.5" />
          <span v-if="freeSurfaceWithoutMeshSnap || surfaceNotAdmitted"
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

        <div v-if="surfaceNotAdmitted"
          data-testid="measurement-overlay-surface-not-admitted-hint"
          class="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-700">
          当前过滤器 {{ MEASUREMENT_PICK_FILTER_LABELS[pickLayer.filter] }} × 类型 {{ MEASUREMENT_PICK_TYPE_LABELS[pickLayer.pickType] }} 不放行模型表面点：要表面点切 Cursor 类型或 Screen 过滤器（E3D Any / Element 只在 Cursor 下取元素上的点）。
        </div>

        <!-- E3D Positioning Control：拾取过滤器 × 拾取类型 + Significant Snaps -->
        <div data-testid="measurement-overlay-pick-layer"
          class="mt-3 rounded-lg border border-border bg-muted/30 p-2">
          <div class="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>拾取过滤器</span>
            <span data-testid="measurement-overlay-pick-layer-summary">
              {{ MEASUREMENT_PICK_FILTER_LABELS[pickLayer.filter] }} · {{ MEASUREMENT_PICK_TYPE_LABELS[pickLayer.pickType] }}
            </span>
          </div>
          <div role="radiogroup" aria-label="拾取过滤器" class="grid grid-cols-4 gap-1">
            <button v-for="id in MEASUREMENT_PICK_FILTER_IDS"
              :key="id"
              type="button"
              role="radio"
              :data-testid="`measurement-overlay-pick-filter-${id}`"
              class="h-8 rounded-md border px-1 text-[11px] leading-none disabled:cursor-not-allowed disabled:opacity-40"
              :class="pickLayer.filter === id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted'"
              :aria-checked="pickLayer.filter === id"
              :disabled="!MEASUREMENT_PICK_FILTER_AVAILABILITY[id].available"
              :title="pickFilterTitle(id)"
              @click="setPickFilter(id)">
              {{ MEASUREMENT_PICK_FILTER_LABELS[id] }}
            </button>
          </div>

          <div class="mb-1 mt-2 text-[11px] text-muted-foreground">拾取类型</div>
          <div role="radiogroup" aria-label="拾取类型" class="grid grid-cols-4 gap-1">
            <button v-for="id in MEASUREMENT_PICK_TYPE_IDS"
              :key="id"
              type="button"
              role="radio"
              :data-testid="`measurement-overlay-pick-type-${id}`"
              class="h-8 rounded-md border px-1 text-[11px] leading-none disabled:cursor-not-allowed disabled:opacity-40"
              :class="pickLayer.pickType === id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted'"
              :aria-checked="pickLayer.pickType === id"
              :disabled="!MEASUREMENT_PICK_TYPE_AVAILABILITY[id].available"
              :title="pickTypeTitle(id)"
              @click="setPickType(id)">
              {{ MEASUREMENT_PICK_TYPE_LABELS[id] }}
            </button>
          </div>

          <label v-if="pickTypeValueField && pickTypeValueKey"
            class="mt-2 flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-background px-2">
            <span class="text-[11px] text-muted-foreground">{{ pickTypeValueField.label }}</span>
            <input type="number"
              :data-testid="`measurement-overlay-pick-type-value-${pickTypeValueKey}`"
              class="h-7 w-24 rounded border border-input bg-background px-1 text-right text-xs"
              :value="pickTypeValue"
              :min="pickTypeValueField.min"
              :max="pickTypeValueField.max"
              :step="pickTypeValueField.step"
              :aria-label="pickTypeValueField.label"
              @change="setPickTypeValue($event.target as HTMLInputElement)" />
          </label>

          <label class="mt-2 flex h-9 cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-background/70">
            <input type="checkbox"
              data-testid="measurement-overlay-significant-snaps"
              class="h-3.5 w-3.5 accent-primary"
              :checked="pickLayer.significantSnaps"
              aria-label="Significant Snaps：吸到显著点 / 分段"
              @change="setSignificantSnaps(($event.target as HTMLInputElement).checked)" />
            <span>Significant snaps</span>
            <span class="text-[11px] text-muted-foreground">（提示条尾巴的 Snap）</span>
          </label>

          <!-- E3D Pick Settings → Sections & Walls：Pline End Position + Significant Snap Points -->
          <div data-testid="measurement-overlay-pick-settings-sections"
            class="mt-2 rounded-md border border-border/70 bg-background/60 p-2">
            <div class="mb-1 text-[11px] text-muted-foreground">Pick Settings · Sections &amp; Walls</div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] text-muted-foreground" title="E3D Pick Settings「Pline End Position」：Pline 过滤器拾中的 p-line 用哪一对端点">Pline 端点</span>
              <div role="radiogroup" aria-label="Pline End Position" class="grid grid-cols-2 gap-1">
                <button v-for="option in PLINE_END_OPTIONS"
                  :key="option.id"
                  type="button"
                  role="radio"
                  :data-testid="`measurement-overlay-pline-end-${option.id}`"
                  class="h-7 rounded-md border px-2 text-[11px] leading-none"
                  :class="pickLayer.plineCut === option.cut
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted'"
                  :aria-checked="pickLayer.plineCut === option.cut"
                  :title="option.hint"
                  @click="setPlineCut(option.cut)">
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div class="mt-2 flex items-center justify-between gap-2">
              <span class="text-[11px] text-muted-foreground"
                :class="{ 'opacity-50': !pickLayer.significantSnaps }"
                title="E3D Pick Settings「Significant Snap Points」：型材上的哪些成员把 p-line 分段（只在 Significant snaps 开着时起作用）">
                Significant snap points
              </span>
              <div class="flex items-center gap-2">
                <label v-for="id in MEASUREMENT_SIGNIFICANT_SNAP_POINT_IDS"
                  :key="id"
                  class="flex h-7 cursor-pointer items-center gap-1 rounded-md px-1 hover:bg-muted"
                  :class="{ 'opacity-50': !pickLayer.significantSnaps }"
                  :title="MEASUREMENT_SIGNIFICANT_SNAP_POINT_HINTS[id]">
                  <input type="checkbox"
                    :data-testid="`measurement-overlay-significant-snap-point-${id}`"
                    class="h-3.5 w-3.5 accent-primary"
                    :checked="pickLayer.significantSnapPoints[id]"
                    :aria-label="`Significant Snap Points：${MEASUREMENT_SIGNIFICANT_SNAP_POINT_LABELS[id]}`"
                    @change="setSignificantSnapPoint(id, ($event.target as HTMLInputElement).checked)" />
                  <span class="text-[11px]">{{ MEASUREMENT_SIGNIFICANT_SNAP_POINT_LABELS[id] }}</span>
                </label>
              </div>
            </div>
          </div>
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
