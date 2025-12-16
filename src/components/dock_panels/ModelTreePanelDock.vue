<script setup lang="ts">
import { computed } from 'vue';

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
const viewer = computed(() => ctx.viewerRef.value);
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <ModelTreePanel :viewer="viewer" />
  </div>
</template>
