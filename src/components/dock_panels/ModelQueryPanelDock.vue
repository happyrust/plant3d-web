<script setup lang="ts">
import ModelQueryPanel from '@/components/model-query/ModelQueryPanel.vue';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();
</script>

<template>
  <div class="h-full w-full overflow-hidden">
    <ModelQueryPanel />
  </div>
</template>
