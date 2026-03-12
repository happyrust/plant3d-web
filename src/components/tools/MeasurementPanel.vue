<script setup lang="ts">
import { computed, watch, type Ref } from 'vue';

import { useToolStore } from '@/composables/useToolStore';
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

const sorted = computed(() => {
  return [...store.measurements.value].sort((a, b) => b.createdAt - a.createdAt);
});

function setMode(mode: 'none' | 'measure_distance' | 'measure_angle') {
  store.setToolMode(mode);
}

function toggleVisible(id: string, current: boolean) {
  store.updateMeasurementVisible(id, !current);
}

function remove(id: string) {
  props.tools.removeMeasurement(id);
}

function fly(id: string) {
  props.tools.flyToMeasurement(id);
}

function syncSelectedMeasurement(id: string | null) {
  const annotationSystem = ctx.annotationSystem.value;
  if (!annotationSystem) return;

  try {
    if (id) {
      annotationSystem.selectAnnotation(`meas_${id}`);
      return;
    }

    if (annotationSystem.selectedId.value?.startsWith('meas_')) {
      annotationSystem.selectAnnotation(null);
    }
  } catch {
    // ignore
  }
}

function selectMeasurement(id: string) {
  store.activeMeasurementId.value = id;
}

function clearMeasurements() {
  store.clearMeasurements();
}

watch(
  () => store.activeMeasurementId.value,
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
      <div class="mt-1 text-xs text-muted-foreground">{{ tools.statusText }}</div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'none' ? 'bg-muted' : ''"
          @click="setMode('none')">
          关闭
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'measure_distance' ? 'bg-muted' : ''"
          @click="setMode('measure_distance')">
          距离
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'measure_angle' ? 'bg-muted' : ''"
          @click="setMode('measure_angle')">
          角度
        </button>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        模型加载完成后可用；点击模型表面按提示点选即可创建。
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">测量列表</div>
        <div class="text-xs text-muted-foreground">共 {{ store.measurementCount }} 条</div>
      </div>

      <div v-if="sorted.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无测量。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <div v-for="m in sorted"
          :key="m.id"
          :data-testid="`measurement-row-${m.id}`"
          :data-selected="store.activeMeasurementId.value === m.id ? 'true' : 'false'"
          class="rounded-md border p-2 transition-colors"
          :class="store.activeMeasurementId.value === m.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'"
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
