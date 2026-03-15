<script setup lang="ts">
import { computed } from 'vue';

import { Loader2 } from 'lucide-vue-next';

import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    class?: string;
  }>(),
  {
    variant: 'primary',
    size: 'md',
    disabled: false,
    loading: false,
    type: 'button',
    class: '',
  }
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[#FF6B00] text-white shadow-sm hover:opacity-90 focus-visible:ring-[#FF6B00]/30',
  secondary: 'border border-[#D1D5DB] bg-white text-[#1F2937] shadow-sm hover:bg-[#F9FAFB] hover:opacity-90 focus-visible:ring-[#D1D5DB]/60',
  danger: 'bg-[#EF4444] text-white shadow-sm hover:opacity-90 focus-visible:ring-[#EF4444]/30',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

const isDisabled = computed(() => props.disabled || props.loading);

const buttonClass = computed(() =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-0',
    'active:translate-y-px active:scale-[0.99]',
    'disabled:translate-y-0 disabled:scale-100 disabled:cursor-not-allowed disabled:opacity-60',
    variantClasses[props.variant],
    sizeClasses[props.size],
    props.class
  )
);

function handleClick(event: MouseEvent) {
  if (isDisabled.value) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  emit('click', event);
}
</script>

<template>
  <button :type="type"
    :class="buttonClass"
    :disabled="isDisabled"
    :aria-busy="loading ? 'true' : 'false'"
    :data-loading="loading ? 'true' : 'false'"
    @click="handleClick">
    <Loader2 v-if="loading" class="h-4 w-4 animate-spin" aria-hidden="true" />
    <slot />
  </button>
</template>
