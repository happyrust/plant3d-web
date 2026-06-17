<script setup lang="ts">
import { computed, nextTick, ref, watch, type Ref } from 'vue';

import {
  MEASUREMENT_PICK_SOURCE_LABELS,
  type MeasurementPickSourceId,
} from '@/composables/useMeasurementPickSources';
import { usePipeDistanceStore } from '@/composables/usePipeDistanceStore';
import {
  type MeasurementRecord,
  type XeokitMeasurementRecord,
  useToolStore,
} from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { useXeokitMeasurementStyleStore } from '@/composables/useXeokitMeasurementStyleStore';
import { emitCommand } from '@/ribbon/commandBus';
import {
  formatMeasurementKindLabel,
  formatMeasurementSummary,
} from '@/utils/xeokitMeasurementFormat';

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
const pipeDistanceStore = usePipeDistanceStore();
const ctx = useViewerContext();
const xeokitTools = computed(() => ctx.xeokitMeasurementTools.value);
const measurementStyle = useXeokitMeasurementStyleStore();
const unitSettings = useUnitSettingsStore();
const measurementRowEls = ref(new Map<string, HTMLElement>());
const measurementPickSourceRows: {
  id: MeasurementPickSourceId;
  description: string;
}[] = [
  {
    id: 'ptset',
    description: '构件 PTSET 点，默认显示并捕捉。',
  },
  {
    id: 'mesh_pick_point',
    description: '光标射线命中的模型表面点，需手动启用捕捉。',
  },
  {
    id: 'position',
    description: '实例位置/原点；当前阶段无数据时会提示不可用。',
  },
  {
    id: 'primitive_key_point',
    description: '基本体关键点；依赖模型包导出的关键点数据。',
  },
];

const isXeokitMode = computed(() => {
  return (
    store.toolMode.value === 'xeokit_measure_distance' ||
    store.toolMode.value === 'xeokit_measure_angle' ||
    store.toolMode.value === 'xeokit_measure_elevation_point' ||
    store.toolMode.value === 'xeokit_measure_elevation_delta'
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
const elevationPointStylePreview = computed(() => {
  const items: string[] = [];
  if (measurementStyle.state.elevationPointShowAbsoluteLabel) items.push('绝对标高');
  if (measurementStyle.state.elevationPointShowRelativeLabel) items.push('相对基准');
  if (measurementStyle.state.elevationPointShowMarker) items.push('点标记');
  if (measurementStyle.state.elevationPointShowLeader) items.push('引线');
  return items.length > 0 ? items.join(' · ') : '仅保留标签容器';
});
const elevationDeltaStylePreview = computed(() => {
  const items: string[] = [];
  if (measurementStyle.state.elevationDeltaShowEndpointLabels) items.push('起终点标高');
  if (measurementStyle.state.elevationDeltaShowDeltaLabel) items.push('高差标签');
  if (measurementStyle.state.elevationDeltaShowVerticalGuide) items.push('竖向辅助线');
  if (measurementStyle.state.elevationDeltaShowMarkers) items.push('端点');
  return items.length > 0 ? items.join(' · ') : '仅保留基础几何';
});
const distanceStyleNote = computed(() => {
  return measurementStyle.state.distanceShowAxisBreakdown
    ? '当前会同时显示总长和 X / Y / Z 分量标签。'
    : '开启后会额外显示 X / Y / Z 三段分量线和标签。';
});
const pipeDistanceStatusText = computed(() => {
  if (pipeDistanceStore.isDetecting.value) return '正在检测管道间净距';
  if (pipeDistanceStore.detectError.value) return pipeDistanceStore.detectError.value;
  const count = pipeDistanceStore.results.value.length;
  return count > 0 ? `已生成 ${count} 条净距结果` : '尚未生成净距结果';
});

function isApproximateMeasurement(record: MeasurementRecord | XeokitMeasurementRecord): boolean {
  return 'approximate' in record && Boolean(record.approximate);
}

function getMeasurementSummary(record: MeasurementRecord | XeokitMeasurementRecord): string {
  return formatMeasurementSummary(
    record,
    unitSettings.displayUnit.value,
    unitSettings.precision.value,
  );
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

function setMode(mode: 'none' | 'measure_distance' | 'measure_angle' | 'measure_elevation_point' | 'measure_elevation_delta') {
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

  const nextMode =
    mode === 'measure_distance'
      ? 'xeokit_measure_distance'
      : mode === 'measure_angle'
        ? 'xeokit_measure_angle'
        : mode === 'measure_elevation_point'
          ? 'xeokit_measure_elevation_point'
          : 'xeokit_measure_elevation_delta';
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

function openPipeDistanceTool(): void {
  emitCommand('measurement.pipe_to_pipe');
}

function updateMeasurementStyle(
  key:
    | 'distanceShowTotalLabel'
    | 'distanceShowMarkers'
    | 'distanceShowAxisBreakdown'
    | 'angleShowLabel'
    | 'angleShowMarkers'
    | 'elevationPointShowAbsoluteLabel'
    | 'elevationPointShowRelativeLabel'
    | 'elevationPointShowMarker'
    | 'elevationPointShowLeader'
    | 'elevationDeltaShowEndpointLabels'
    | 'elevationDeltaShowDeltaLabel'
    | 'elevationDeltaShowVerticalGuide'
    | 'elevationDeltaShowMarkers',
  checked: boolean,
) {
  measurementStyle.updateStyle({ [key]: checked });
}

function updateMeasurementPickSource(
  source: MeasurementPickSourceId,
  key: 'show' | 'snap',
  checked: boolean,
): void {
  measurementStyle.updateMeasurementPickSource(source, { [key]: checked });
}

function updateMeasurementPickSourceThreshold(source: MeasurementPickSourceId, raw: string): void {
  const parsed = Number(raw);
  const clamped = Number.isFinite(parsed)
    ? Math.min(40, Math.max(4, Math.round(parsed)))
    : measurementStyle.state.measurementPickSources[source].thresholdPx;
  measurementStyle.updateMeasurementPickSource(source, { thresholdPx: clamped });
}

function resetMeasurementStyle() {
  measurementStyle.resetStyle();
}

function updateDatumElevation(raw: string): void {
  const parsed = Number(raw);
  measurementStyle.updateStyle({
    elevationDatum: Number.isFinite(parsed) ? parsed : 0,
  });
}

function resetDatumElevation(): void {
  measurementStyle.updateStyle({ elevationDatum: 0 });
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
          :class="store.toolMode.value === 'xeokit_measure_elevation_point' ? 'bg-muted' : ''"
          :disabled="!isMeasurementReady"
          @click="setMode('measure_elevation_point')">
          点标高
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'xeokit_measure_elevation_delta' ? 'bg-muted' : ''"
          :disabled="!isMeasurementReady"
          @click="setMode('measure_elevation_delta')">
          高差
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'xeokit_measure_angle' ? 'bg-muted' : ''"
          :disabled="!isMeasurementReady"
          @click="setMode('measure_angle')">
          角度
        </button>
      </div>

      <div class="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2">
        <div class="flex flex-wrap items-center gap-2">
          <div class="text-xs font-medium text-foreground">标高基准</div>
          <input type="number"
            step="0.001"
            class="h-8 w-32 rounded-md border border-input bg-background px-2 text-sm"
            :value="measurementStyle.state.elevationDatum"
            @change="updateDatumElevation(($event.target as HTMLInputElement).value)" />
          <span class="text-xs text-muted-foreground">{{ unitSettings.displayUnit.value }}</span>
          <button type="button"
            class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            @click="resetDatumElevation">
            恢复 0
          </button>
        </div>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        <template v-if="isMeasurementReady">
          模型加载完成后可用；测量点按下方已启用的点源捕捉，Mesh Pick Point 需手动启用。
        </template>
        <template v-else>
          当前未满足测量条件，请先排除上面的 Viewer / DTX 初始化问题。
        </template>
      </div>

      <div data-testid="measurement-pipe-distance-card"
        class="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-semibold">管-管净距</div>
            <div class="mt-1 text-xs text-muted-foreground">
              选择多根 BRAN 管道后检测并展示管道间最近净距。
            </div>
            <div data-testid="measurement-pipe-distance-status"
              class="mt-1 text-xs text-muted-foreground">
              {{ pipeDistanceStatusText }}
            </div>
            <div class="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>
                已选
                <strong data-testid="measurement-pipe-distance-selected-count"
                  class="text-foreground">
                  {{ pipeDistanceStore.selectedBranRefnos.value.length }}
                </strong>
                根
              </span>
              <span>
                结果
                <strong data-testid="measurement-pipe-distance-result-count"
                  class="text-foreground">
                  {{ pipeDistanceStore.results.value.length }}
                </strong>
                条
              </span>
            </div>
          </div>
          <button type="button"
            data-testid="measurement-open-pipe-distance"
            class="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            @click="openPipeDistanceTool">
            打开
          </button>
        </div>
      </div>

      <details v-if="canShowStyleSettings" class="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2">
        <summary class="cursor-pointer select-none text-sm font-medium">样式设置</summary>

        <div class="mt-3 flex flex-col gap-3 text-sm">
          <div data-testid="measurement-style-snap-section"
            class="rounded-lg border border-border bg-background/80 p-3 shadow-sm">
            <div class="font-medium">测量点源</div>
            <div class="mt-1 text-xs text-muted-foreground">
              显示和捕捉互相独立；关闭捕捉后该点源不会参与测量登记。
            </div>
            <div class="mt-3 overflow-x-auto">
              <table class="w-full min-w-[420px] text-left text-xs">
                <thead class="text-muted-foreground">
                  <tr>
                    <th class="pb-2 font-medium">点源</th>
                    <th class="pb-2 text-center font-medium">显示</th>
                    <th class="pb-2 text-center font-medium">捕捉</th>
                    <th class="pb-2 font-medium">阈值(px)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in measurementPickSourceRows"
                    :key="row.id"
                    class="border-t border-border">
                    <td class="py-2 pr-3 align-top">
                      <div class="font-medium text-foreground">
                        {{ MEASUREMENT_PICK_SOURCE_LABELS[row.id] }}
                      </div>
                      <div class="mt-0.5 text-muted-foreground">{{ row.description }}</div>
                    </td>
                    <td class="py-2 text-center align-top">
                      <input :data-testid="`measurement-source-${row.id}-show`"
                        type="checkbox"
                        :checked="measurementStyle.state.measurementPickSources[row.id].show"
                        @change="updateMeasurementPickSource(row.id, 'show', ($event.target as HTMLInputElement).checked)" />
                    </td>
                    <td class="py-2 text-center align-top">
                      <input :data-testid="`measurement-source-${row.id}-snap`"
                        type="checkbox"
                        :checked="measurementStyle.state.measurementPickSources[row.id].snap"
                        @change="updateMeasurementPickSource(row.id, 'snap', ($event.target as HTMLInputElement).checked)" />
                    </td>
                    <td class="py-2 align-top">
                      <input :data-testid="`measurement-source-${row.id}-threshold`"
                        type="number" min="4" max="40" step="1"
                        class="h-8 w-20 rounded-md border border-input bg-background px-2 text-xs"
                        :disabled="!measurementStyle.state.measurementPickSources[row.id].snap"
                        :value="measurementStyle.state.measurementPickSources[row.id].thresholdPx"
                        @change="updateMeasurementPickSourceThreshold(row.id, ($event.target as HTMLInputElement).value)" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

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

          <div class="rounded-lg border border-border bg-background/80 p-3 shadow-sm">
            <div class="font-medium">点标高</div>
            <div class="mt-1 text-xs text-muted-foreground">
              同时控制绝对标高、相对基准、点标记与引线显示。
            </div>
            <div class="mt-2 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
              当前效果：{{ elevationPointStylePreview }}
            </div>
            <div class="mt-2 flex flex-col gap-2">
              <label class="flex items-center gap-2">
                <input type="checkbox"
                  :checked="measurementStyle.state.elevationPointShowAbsoluteLabel"
                  @change="updateMeasurementStyle('elevationPointShowAbsoluteLabel', ($event.target as HTMLInputElement).checked)" />
                <span>显示绝对标高</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox"
                  :checked="measurementStyle.state.elevationPointShowRelativeLabel"
                  @change="updateMeasurementStyle('elevationPointShowRelativeLabel', ($event.target as HTMLInputElement).checked)" />
                <span>显示相对基准</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox"
                  :checked="measurementStyle.state.elevationPointShowMarker"
                  @change="updateMeasurementStyle('elevationPointShowMarker', ($event.target as HTMLInputElement).checked)" />
                <span>显示点标记</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox"
                  :checked="measurementStyle.state.elevationPointShowLeader"
                  @change="updateMeasurementStyle('elevationPointShowLeader', ($event.target as HTMLInputElement).checked)" />
                <span>显示引线</span>
              </label>
            </div>
          </div>

          <div class="rounded-lg border border-border bg-background/80 p-3 shadow-sm">
            <div class="font-medium">高差</div>
            <div class="mt-1 text-xs text-muted-foreground">
              控制起终点标高、高差标签、竖向辅助线与端点显示。
            </div>
            <div class="mt-2 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
              当前效果：{{ elevationDeltaStylePreview }}
            </div>
            <div class="mt-2 flex flex-col gap-2">
              <label class="flex items-center gap-2">
                <input type="checkbox"
                  :checked="measurementStyle.state.elevationDeltaShowEndpointLabels"
                  @change="updateMeasurementStyle('elevationDeltaShowEndpointLabels', ($event.target as HTMLInputElement).checked)" />
                <span>显示起终点标高</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox"
                  :checked="measurementStyle.state.elevationDeltaShowDeltaLabel"
                  @change="updateMeasurementStyle('elevationDeltaShowDeltaLabel', ($event.target as HTMLInputElement).checked)" />
                <span>显示高差标签</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox"
                  :checked="measurementStyle.state.elevationDeltaShowVerticalGuide"
                  @change="updateMeasurementStyle('elevationDeltaShowVerticalGuide', ($event.target as HTMLInputElement).checked)" />
                <span>显示竖向辅助线</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox"
                  :checked="measurementStyle.state.elevationDeltaShowMarkers"
                  @change="updateMeasurementStyle('elevationDeltaShowMarkers', ($event.target as HTMLInputElement).checked)" />
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
                  {{ formatMeasurementKindLabel(m.kind) }}
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
