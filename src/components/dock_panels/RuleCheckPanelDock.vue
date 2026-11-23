<script setup lang="ts">
import RuleCheckPanel from '@/components/rule-check/RuleCheckPanel.vue';

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
    <RuleCheckPanel />
  </div>
</template>
