<script setup lang="ts">
import { shallowRef, watch } from 'vue';

import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import ModelTreePanel from '@/components/model-tree/ModelTreePanel.vue';
import { useViewerContext } from '@/composables/useViewerContext';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const ctx = useViewerContext();
const viewer = shallowRef<DtxCompatViewer | null>(null);

watch(
  () => ctx.viewerRef.value,
  (v) => {
    viewer.value = v;
  },
  { immediate: true }
);
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <ModelTreePanel :viewer="viewer" />
  </div>
</template>
