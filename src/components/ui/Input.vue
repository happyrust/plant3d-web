<script setup lang="ts">
import { computed, useAttrs } from 'vue';

import { cn } from '@/lib/utils';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
    class?: string;
    inputClass?: string;
  }>(),
  {
    modelValue: '',
    type: 'text',
    placeholder: '',
    disabled: false,
    error: false,
    class: '',
    inputClass: '',
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const attrs = useAttrs();

const wrapperClass = computed(() =>
  cn(
    'flex h-10 w-full items-center rounded-lg border bg-white px-3 text-sm text-[#111827] shadow-sm transition-colors duration-150',
    'focus-within:border-[#3B82F6]',
    props.error
      ? 'border-[#EF4444] focus-within:border-[#EF4444]'
      : 'border-[#D1D5DB]',
    props.disabled && 'cursor-not-allowed bg-[#F3F4F6] text-[#9CA3AF]',
    props.class
  )
);

const fieldClass = computed(() =>
  cn(
    'h-full w-full border-0 bg-transparent p-0 text-sm text-inherit outline-none ring-0',
    'placeholder:text-[#9CA3AF]',
    'disabled:cursor-not-allowed',
    props.inputClass
  )
);

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <label :class="wrapperClass"
    :data-disabled="disabled ? 'true' : 'false'"
    :data-error="error ? 'true' : 'false'">
    <span v-if="$slots.prefixIcon" class="mr-2 inline-flex shrink-0 items-center text-[#6B7280]">
      <slot name="prefixIcon" />
    </span>
    <input v-bind="attrs"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : 'false'"
      :class="fieldClass"
      @input="onInput" />
  </label>
</template>
