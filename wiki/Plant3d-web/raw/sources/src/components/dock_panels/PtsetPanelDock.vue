<script setup lang="ts">
import { computed } from 'vue';

import PtsetPanel from '@/components/tools/PtsetPanel.vue';
import { useViewerContext } from '@/composables/useViewerContext';

const props = defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const ctx = useViewerContext();

const ptsetVis = computed(() => ctx.ptsetVis.value);
const refno = computed(() => ptsetVis.value?.currentRefno.value ?? null);
const response = computed(() => ptsetVis.value?.currentResponse.value ?? null);
const isVisible = computed(() => ptsetVis.value?.isVisible.value ?? false);
const showCrosses = computed(() => ptsetVis.value?.showCrosses.value ?? true);
const showLabels = computed(() => ptsetVis.value?.showLabels.value ?? true);
const showArrows = computed(() => ptsetVis.value?.showArrows.value ?? true);

function closePanel() {
  ptsetVis.value?.clearAll();
  try {
    (props.params.api as any)?.close?.();
  } catch {
    // ignore
  }
}
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <PtsetPanel v-if="ptsetVis"
      :refno="refno"
      :response="response"
      :is-visible="isVisible"
      :show-crosses="showCrosses"
      :show-labels="showLabels"
      :show-arrows="showArrows"
      @close="closePanel"
      @toggle-visible="ptsetVis.setVisible"
      @toggle-crosses="ptsetVis.setCrossesVisible"
      @toggle-labels="ptsetVis.setLabelsVisible"
      @toggle-arrows="ptsetVis.setArrowsVisible"
      @fly-to="ptsetVis.flyToPtset" />
    <div v-else class="text-muted-foreground p-4">等待 Viewer 初始化...</div>
  </div>
</template>

