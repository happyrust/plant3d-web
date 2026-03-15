<script setup lang="ts">
import { computed, useSlots } from 'vue';

import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    title?: string;
    class?: string;
    bodyClass?: string;
    headerClass?: string;
  }>(),
  {
    title: '',
    class: '',
    bodyClass: '',
    headerClass: '',
  }
);

const slots = useSlots();

const hasHeader = computed(() => Boolean(props.title || slots.header));

const cardClass = computed(() =>
  cn(
    'w-full overflow-hidden rounded-[12px] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.1)]',
    props.class
  )
);

const headerClass = computed(() =>
  cn(
    'min-w-0 border-b border-[#F3F4F6] px-5 py-4',
    props.headerClass
  )
);

const bodyClass = computed(() =>
  cn(
    'min-w-0 px-5 py-5 text-sm leading-6 text-[#1F2937] break-words',
    props.bodyClass
  )
);
</script>

<template>
  <section :class="cardClass">
    <header v-if="hasHeader" :class="headerClass">
      <slot name="header">
        <h3 class="truncate text-base font-semibold text-[#111827]">{{ title }}</h3>
      </slot>
    </header>
    <div :class="bodyClass">
      <slot />
    </div>
  </section>
</template>
