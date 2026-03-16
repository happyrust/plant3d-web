<script setup lang="ts">
import DimensionPanel from '@/components/tools/DimensionPanel.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
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
  <div class="flex h-full w-full flex-col overflow-hidden bg-background p-2">
    <ScrollArea v-if="ctx.tools.value" class="min-h-0 flex-1 rounded-md">
      <div class="pr-2">
        <DimensionPanel :tools="ctx.tools.value" />
      </div>
    </ScrollArea>
    <div v-else class="text-muted-foreground p-4">等待 Viewer 初始化...</div>
  </div>
</template>

