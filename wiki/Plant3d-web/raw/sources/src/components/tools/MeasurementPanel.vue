<script setup lang="ts">
import { computed, nextTick, ref, watch, type Ref } from 'vue';

import {
  type MeasurementRecord,
  type XeokitMeasurementRecord,
  useToolStore,
} from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { useXeokitMeasurementStyleStore } from '@/composables/useXeokitMeasurementStyleStore';

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  flyToMeasurement: (id: string) => void;
  removeMeasurement: (id: string) => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();
const ctx = useViewerContext();
const xeokitTools = computed(() => ctx.xeokitMeasurementTools.value);
const measurementStyle = useXeokitMeasurementStyleStore();
const measurementRowEls = ref(new Map<string, HTMLElement>());

const isXeokitMode = computed(() => {
  return (
    store.toolMode.value === 'xeokit_measure_distance' ||
    store.toolMode.value === 'xeokit_measure_angle'
  );
});

const sorted = computed<(MeasurementRecord | XeokitMeasurementRecord)[]>(() => {
  const records = isXeokitMode.value
    ? [...store.allXeokitMeasurements.value]
    : [...store.measurements.value];
  return records.sort((a, b) => b.createdAt - a.createdAt);
});

const isMeasurementReady = computed(() => {
  return isXeokitMode.value
    ? (xeokitTools.value?.ready.value ?? false)
    : props.tools.ready.value;
});

const measurementStatusText = computed(() => {
  const status = isXeokitMode.value
    ? xeokitTools.value?.statusText.value
    : props.tools.statusText.value;
  return ctx.viewerError.value || status || props.tools.statusText.value;
});

const selectedMeasurementId = computed(() =>
  isXeokitMode.value ? store.activeXeokitMeasurementId.value : store.activeMeasurementId.value,
);
const canShowStyleSettings = computed(() => !!xeokitTools.value);
const distanceStylePreview = computed(() => {
  const items: string[] = [];
  if (measurementStyle.state.distanceShowTotalLabel) items.push('总长标签');
  if (measurementStyle.state.distanceShowMarkers) items.push('端点');
  if (measurementStyle.state.distanceShowAxisBreakdown) items.push('XYZ 分解');
  return items.length > 0 ? items.join(' · ') : '仅保留主线';
});
const angleStylePreview = computed(() => {
  const items: string[] = [];
  if (measurementStyle.state.angleShowLabel) items.push('角度标签');
  if (measurementStyle.state.angleShowMarkers) items.push('端点');
  return items.length > 0 ? items.join(' · ') : '仅保留角度连线';
});
const distanceStyleNote = computed(() => {
  return measurementStyle.state.distanceShowAxisBreakdown
    ? '当前会同时显示总长和 X / Y / Z 分量标签。'
    : '开启后会额外显示 X / Y / Z 三段分量线和标签。';
});

function isApproximateMeasurement(record: MeasurementRecord | XeokitMeasurementRecord): boolean {
  return 'approximate' in record && Boolean(record.approximate);
}

function getMeasurementSummary(record: MeasurementRecord | XeokitMeasurementRecord): string {
  if (record.kind === 'distance') {
    return `起点 ${record.origin.entityId} · 终点 ${record.target.entityId}`;
  }
  return `起点 ${record.origin.entityId} · 拐点 ${record.corner.entityId} · 终点 ${record.target.entityId}`;
}

function getVisibilityActionLabel(visible: boolean): string {
  return visible ? '隐藏' : '恢复显示';
}

function setMeasurementRowRef(id: string, el: Element | null) {
  if (el instanceof HTMLElement) {
    measurementRowEls.value.set(id, el);
    return;
  }
  measurementRowEls.value.delete(id);
}

function setMode(mode: 'none' | 'measure_distance' | 'measure_angle') {
  if (!isXeokitMode.value && store.toolMode.value === mode) {
    store.setToolMode('none');
    return;
  }

  if (mode === 'none') {
    if (isXeokitMode.value) {
      xeokitTools.value?.deactivate();
      return;
    }
    store.setToolMode('none');
    return;
  }

  const nextMode = mode === 'measure_distance' ? 'xeokit_measure_distance' : 'xeokit_measure_angle';
  if (xeokitTools.value) {
    xeokitTools.value.activate(nextMode);
    return;
  }

  store.setToolMode(nextMode);
}

function toggleVisible(id: string, current: boolean) {
  if (isXeokitMode.value) {
    store.updateXeokitMeasurementVisible(id, !current);
    return;
  }
  store.updateMeasurementVisible(id, !current);
}

function remove(id: string) {
  if (isXeokitMode.value) {
    xeokitTools.value?.removeMeasurement(id);
    return;
  }
  props.tools.removeMeasurement(id);
}

function fly(id: string) {
  if (isXeokitMode.value) {
    xeokitTools.value?.flyToMeasurement(id);
    return;
  }
  props.tools.flyToMeasurement(id);
}

function syncSelectedMeasurement(id: string | null) {
  const annotationSystem = ctx.annotationSystem.value;
  if (!annotationSystem) return;

  try {
    if (id) {
      if (isXeokitMode.value) {
        annotationSystem.selectAnnotation(`xmeas_${id}`);
      } else {
        annotationSystem.selectAnnotation(`meas_${id}`);
      }
      return;
    }

    if (
      annotationSystem.selectedId.value?.startsWith(isXeokitMode.value ? 'xmeas_' : 'meas_')
    ) {
      annotationSystem.selectAnnotation(null);
    }
  } catch {
    // ignore
  }
}

function selectMeasurement(id: string) {
  if (isXeokitMode.value) {
    store.activeXeokitMeasurementId.value = id;
    return;
  }
  store.activeMeasurementId.value = id;
}

function clearMeasurements() {
  if (isXeokitMode.value) {
    xeokitTools.value?.clearMeasurements();
    return;
  }
  store.clearMeasurements();
}

function updateMeasurementStyle(key: 'distanceShowTotalLabel' | 'distanceShowMarkers' | 'distanceShowAxisBreakdown' | 'angleShowLabel' | 'angleShowMarkers', checked: boolean) {
  measurementStyle.updateStyle({ [key]: checked });
}

function resetMeasurementStyle() {
  measurementStyle.resetStyle();
}

watch(
  () => selectedMeasurementId.value,
  (id) => {
    syncSelectedMeasurement(id);
    if (!id) return;
    nextTick(() => {
      measurementRowEls.value.get(id)?.scrollIntoView?.({
        block: 'nearest',
        inline: 'nearest',
      });
    });
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">工具状态</div>
      <div class="mt-1 text-xs text-muted-foreground">{{ measurementStatusText }}</div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'none' ? 'bg-muted' : ''"
          @click="setMode('none')">
          关闭
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'xeokit_measure_distance' ? 'bg-muted' : ''"
          :disabled="!isMeasurementReady"
          @click="setMode('measure_distance')">
          距离
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'xeokit_measure_angle' ? 'bg-muted' : ''"
          :disabled="!isMeasurementReady"
          @click="setMode('measure_angle')">
          角度
        </button>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        <template v-if="isMeasurementReady">
          模型加载完成后可用；点击模型表面按提示点选即可创建。
        </template>
        <template v-else>
          当前未满足测量条件，请先排除上面的 Viewer / DTX 初始化问题。
        </template>
      </div>

      <details v-if="canShowStyleSettings" class="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2">
        <summary class="cursor-pointer select-none text-sm font-medium">样式设置</summary>

        <div class="mt-3 flex flex-col gap-3 text-sm">
          <div data-testid="measurement-style-distance-section"
            class="rounded-lg border border-border bg-background/80 p-3 shadow-sm">
            <div class="flex items-center justify-between gap-2">
              <div class="font-medium">长度测量</div>
              <button type="button"
                data-testid="measurement-style-reset"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
                @click="resetMeasurementStyle">
                恢复默认
              </button>
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              默认仅显示总长；需要时可再打开端点和 XYZ 分解。
            </div>
            <div data-testid="measurement-style-distance-note"
              class="mt-2 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
              {{ distanceStyleNote }}
            </div>
            <div data-testid="measurement-style-distance-preview"
              class="mt-2 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
              当前效果：{{ distanceStylePreview }}
            </div>
            <div class="mt-2 flex flex-col gap-2">
              <label class="flex items-center gap-2">
                <input data-testid="measurement-style-distance-total-label"
                  type="checkbox"
                  :checked="measurementStyle.state.distanceShowTotalLabel"
                  @change="updateMeasurementStyle('distanceShowTotalLabel', ($event.target as HTMLInputElement).checked)" />
                <span>显示总长标签</span>
              </label>
              <label class="flex items-center gap-2">
                <input data-testid="measurement-style-distance-markers"
                  type="checkbox"
                  :checked="measurementStyle.state.distanceShowMarkers"
                  @change="updateMeasurementStyle('distanceShowMarkers', ($event.target as HTMLInputElement).checked)" />
                <span>显示端点</span>
              </label>
              <label class="flex items-center gap-2">
                <input data-testid="measurement-style-distance-axis"
                  type="checkbox"
                  :checked="measurementStyle.state.distanceShowAxisBreakdown"
                  @change="updateMeasurementStyle('distanceShowAxisBreakdown', ($event.target as HTMLInputElement).checked)" />
                <span>显示 XYZ 分解</span>
              </label>
            </div>
          </div>

          <div data-testid="measurement-style-angle-section"
            class="rounded-lg border border-border bg-background/80 p-3 shadow-sm">
            <div class="font-medium">角度测量</div>
            <div class="mt-1 text-xs text-muted-foreground">
              默认显示角度标签和关键端点，可按需要精简表现。
            </div>
            <div data-testid="measurement-style-angle-preview"
              class="mt-2 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
              当前效果：{{ angleStylePreview }}
            </div>
            <div class="mt-2 flex flex-col gap-2">
              <label class="flex items-center gap-2">
                <input data-testid="measurement-style-angle-label"
                  type="checkbox"
                  :checked="measurementStyle.state.angleShowLabel"
                  @change="updateMeasurementStyle('angleShowLabel', ($event.target as HTMLInputElement).checked)" />
                <span>显示角度标签</span>
              </label>
              <label class="flex items-center gap-2">
                <input data-testid="measurement-style-angle-markers"
                  type="checkbox"
                  :checked="measurementStyle.state.angleShowMarkers"
                  @change="updateMeasurementStyle('angleShowMarkers', ($event.target as HTMLInputElement).checked)" />
                <span>显示端点</span>
              </label>
            </div>
          </div>
        </div>
      </details>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">测量列表</div>
        <div class="text-xs text-muted-foreground">共 {{ sorted.length }} 条</div>
      </div>

      <div v-if="sorted.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无测量。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <div v-for="m in sorted"
          :key="m.id"
          :ref="(el) => setMeasurementRowRef(m.id, el)"
          :data-testid="`measurement-row-${m.id}`"
          :data-selected="selectedMeasurementId === m.id ? 'true' : 'false'"
          class="rounded-lg border p-3 transition-colors"
          :class="selectedMeasurementId === m.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:bg-muted/40'"
          role="button"
          tabindex="0"
          @click="selectMeasurement(m.id)"
          @keydown.enter.prevent="selectMeasurement(m.id)"
          @keydown.space.prevent="selectMeasurement(m.id)">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
                  {{ m.kind === 'distance' ? '距离测量' : '角度测量' }}
                </span>
                <span v-if="isApproximateMeasurement(m)"
                  :data-testid="`measurement-approximate-badge-${m.id}`"
                  class="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700">
                  近似
                </span>
                <span v-if="selectedMeasurementId === m.id"
                  :data-testid="`measurement-selected-badge-${m.id}`"
                  class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  当前选中
                </span>
                <span :data-testid="`measurement-visibility-badge-${m.id}`"
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="m.visible ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-muted-foreground'">
                  {{ m.visible ? '显示中' : '已隐藏' }}
                </span>
              </div>
              <div class="mt-2 truncate text-sm font-semibold">
                {{ new Date(m.createdAt).toLocaleString() }}
              </div>
              <div :data-testid="`measurement-summary-${m.id}`"
                class="mt-1 truncate text-xs text-muted-foreground">
                {{ getMeasurementSummary(m) }}
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">ID: {{ m.id }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/80 p-1">
              <button type="button"
                :data-testid="`measurement-fly-button-${m.id}`"
                class="h-8 rounded-md px-2 text-xs"
                :class="selectedMeasurementId === m.id ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'hover:bg-muted'"
                @click.stop="fly(m.id)">
                定位
              </button>

              <button type="button"
                :data-testid="`measurement-visibility-button-${m.id}`"
                class="h-8 rounded-md px-2 text-xs hover:bg-muted"
                @click.stop="toggleVisible(m.id, m.visible)">
                {{ getVisibilityActionLabel(m.visible) }}
              </button>

              <button type="button"
                class="h-8 rounded-md px-2 text-xs text-destructive hover:bg-muted"
                @click.stop="remove(m.id)">
                删除
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-3 flex justify-end">
        <button type="button"
          data-testid="measurement-clear-all"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm text-destructive hover:bg-muted"
          @click="clearMeasurements()">
          清空测量
        </button>
      </div>
    </div>
  </div>
</template>
