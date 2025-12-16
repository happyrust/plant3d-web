<script setup lang="ts">
import PropertiesPanel from '@/components/tools/PropertiesPanel.vue';

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
    <PropertiesPanel />
  </div>
</template>
