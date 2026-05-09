<script setup lang="ts">
import { computed } from 'vue';

import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    class?: string;
  }>(),
  {
    class: '',
  }
);

const containerClass = computed(() =>
  cn('relative overflow-hidden', props.class)
);
</script>

<template>
  <div :class="containerClass">
    <div class="h-full w-full overflow-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.scrollbar-thin {
  scrollbar-width: thin;
}

.scrollbar-thin::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background-color: hsl(var(--border));
  border-radius: 4px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--muted-foreground) / 0.5);
}
</style>
