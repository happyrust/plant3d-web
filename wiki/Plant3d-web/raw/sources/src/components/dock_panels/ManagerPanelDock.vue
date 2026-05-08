<script setup lang="ts">
import ToolManagerPanel from '@/components/tools/ToolManagerPanel.vue';
import { useViewerContext } from '@/composables/useViewerContext';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const ctx = useViewerContext();
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <ToolManagerPanel v-if="ctx.tools.value" :tools="ctx.tools.value" />
    <div v-else class="text-muted-foreground p-4">等待 Viewer 初始化...</div>
  </div>
</template>
