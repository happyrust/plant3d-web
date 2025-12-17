<script setup lang="ts">
import { computed } from 'vue';

import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'secondary' | 'outline' | 'destructive';
    class?: string;
  }>(),
  {
    variant: 'default',
    class: '',
  }
);

const variantClasses = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/80',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/80',
};

const badgeClass = computed(() =>
  cn(
    'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
    variantClasses[props.variant],
    props.class
  )
);
</script>

<template>
  <span :class="badgeClass">
    <slot />
  </span>
</template>
