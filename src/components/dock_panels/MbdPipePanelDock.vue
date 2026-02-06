<script setup lang="ts">
import { computed } from 'vue'

import MbdPipePanel from '@/components/tools/MbdPipePanel.vue'
import { useViewerContext } from '@/composables/useViewerContext'

const props = defineProps<{
  params: {
    params: unknown
    api: unknown
    containerApi: unknown
  }
}>()

const ctx = useViewerContext()
const mbdPipeVis = computed(() => ctx.mbdPipeVis.value)

function closePanel() {
  mbdPipeVis.value?.clearAll()
  try {
    ;(props.params.api as any)?.close?.()
  } catch {
    // ignore
  }
}
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <MbdPipePanel
      v-if="mbdPipeVis"
      :vis="mbdPipeVis"
      @close="closePanel" />
    <div v-else class="text-muted-foreground p-4">等待 Viewer 初始化...</div>
  </div>
</template>

