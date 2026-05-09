<script setup lang="ts">
import { computed, watch, type Ref } from 'vue';

import { useToolStore } from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { formatXeokitHoverHint } from '@/composables/xeokitMeasurementUi';

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  currentMeasurement: Ref<unknown>;
  activate: (mode: 'xeokit_measure_distance' | 'xeokit_measure_angle') => void;
  deactivate: () => void;
  reset: () => void;
  flyToMeasurement: (id: string) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();
const ctx = useViewerContext();

const sorted = computed(() => {
  return [...store.allXeokitMeasurements.value].sort((a, b) => b.createdAt - a.createdAt);
});

const statusText = computed(() => ctx.viewerError.value || props.tools.statusText.value);
const draftHint = computed(() => {
  if (store.currentXeokitDistanceDraft.value) {
    return '距离草稿已创建，移动鼠标预览后第二击完成。';
  }
  const angleDraft = store.currentXeokitAngleDraft.value;
  if (!angleDraft) return '尚未创建草稿。';
  return angleDraft.stage === 'finding_corner'
    ? '角度草稿已创建，请锁定拐点。'
    : '拐点已锁定，请选择终点。';
});
const hoverHint = computed(() => {
  return formatXeokitHoverHint({
    hover: store.xeokitHoverState.value,
    lens: store.xeokitPointerLensState.value,
  });
});

function selectMeasurement(id: string) {
  store.activeXeokitMeasurementId.value = id;
  ctx.annotationSystem.value?.selectAnnotation?.(`xmeas_${id}`);
}

function setMode(mode: 'xeokit_measure_distance' | 'xeokit_measure_angle') {
  props.tools.activate(mode);
}

function stopMode() {
  props.tools.deactivate();
}

function toggleVisible(id: string, current: boolean) {
  store.updateXeokitMeasurementVisible(id, !current);
}

function remove(id: string) {
  props.tools.removeMeasurement(id);
}

function fly(id: string) {
  props.tools.flyToMeasurement(id);
}

watch(
  () => store.activeXeokitMeasurementId.value,
  (id) => {
    ctx.annotationSystem.value?.selectAnnotation?.(id ? `xmeas_${id}` : null);
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">测量状态</div>
      <div class="mt-1 text-xs text-muted-foreground">{{ statusText }}</div>
      <div class="mt-2 text-xs text-muted-foreground">{{ draftHint }}</div>
      <div data-testid="xeokit-hover-hint" class="mt-1 text-xs text-muted-foreground">{{ hoverHint }}</div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'xeokit_measure_distance' ? 'bg-muted' : ''"
          :disabled="!props.tools.ready.value"
          @click="setMode('xeokit_measure_distance')">
          距离
        </button>
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'xeokit_measure_angle' ? 'bg-muted' : ''"
          :disabled="!props.tools.ready.value"
          @click="setMode('xeokit_measure_angle')">
          角度
        </button>
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          @click="props.tools.reset()">
          重置草稿
        </button>
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          @click="stopMode">
          关闭
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">测量列表</div>
        <div class="text-xs text-muted-foreground">共 {{ store.xeokitMeasurementCount }} 条</div>
      </div>

      <div v-if="sorted.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无测量数据。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <div v-for="m in sorted"
          :key="m.id"
          :data-testid="`xeokit-measurement-row-${m.id}`"
          :data-selected="store.activeXeokitMeasurementId.value === m.id ? 'true' : 'false'"
          class="rounded-md border p-2 transition-colors"
          :class="store.activeXeokitMeasurementId.value === m.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'"
          role="button"
          tabindex="0"
          @click="selectMeasurement(m.id)"
          @keydown.enter.prevent="selectMeasurement(m.id)"
          @keydown.space.prevent="selectMeasurement(m.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ m.kind === 'distance' ? '距离' : '角度' }}</span>
                <span v-if="m.approximate" class="ml-2 text-xs text-muted-foreground">草稿</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">
                {{ m.kind === 'distance' ? `${m.origin.entityId} → ${m.target.entityId}` : `${m.origin.entityId} / ${m.corner.entityId} / ${m.target.entityId}` }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
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
          data-testid="xeokit-measurement-clear-all"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm text-destructive hover:bg-muted"
          @click="props.tools.clearMeasurements()">
          清空测量
        </button>
      </div>
    </div>
  </div>
</template>
