<script setup lang="ts">
import RenderModeSettingsPanel from '@/components/tools/RenderModeSettingsPanel.vue';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <RenderModeSettingsPanel />
  </div>
</template>
