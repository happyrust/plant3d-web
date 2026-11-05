<script setup lang="ts">
import RvmCheckPanel from '@/components/rvm-check/RvmCheckPanel.vue';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();
</script>

<template>
  <div class="h-full overflow-hidden">
    <RvmCheckPanel />
  </div>
</template>
