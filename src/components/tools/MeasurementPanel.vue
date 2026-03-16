<script setup lang="ts">
import { computed, watch, type Ref } from 'vue';

import {
  type MeasurementRecord,
  type XeokitMeasurementRecord,
  useToolStore,
} from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';

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

watch(
  () => selectedMeasurementId.value,
  (id) => {
    syncSelectedMeasurement(id);
  },
  { immediate: true }
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
          :data-testid="`measurement-row-${m.id}`"
          :data-selected="selectedMeasurementId === m.id ? 'true' : 'false'"
          class="rounded-md border p-2 transition-colors"
          :class="selectedMeasurementId === m.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'"
          role="button"
          tabindex="0"
          @click="selectMeasurement(m.id)"
          @keydown.enter.prevent="selectMeasurement(m.id)"
          @keydown.space.prevent="selectMeasurement(m.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ m.kind === 'distance' ? '距离' : '角度' }}</span>
                <span class="ml-2 text-xs text-muted-foreground">{{ new Date(m.createdAt).toLocaleString() }}</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">ID: {{ m.id }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <button type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
                @click.stop="fly(m.id)">
                定位
              </button>

              <button type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
                @click.stop="toggleVisible(m.id, m.visible)">
                {{ m.visible ? '隐藏' : '显示' }}
              </button>

              <button type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
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
