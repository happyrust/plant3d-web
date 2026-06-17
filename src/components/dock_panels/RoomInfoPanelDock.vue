<script setup lang="ts">
import RoomInfoPanel from '@/components/tools/RoomInfoPanel.vue';

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
    <RoomInfoPanel />
  </div>
</template>
