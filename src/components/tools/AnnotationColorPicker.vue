<script setup lang="ts">
import { ref } from 'vue';

import { ChevronDown } from 'lucide-vue-next';

const model = defineModel<string>({ default: '#EF4444' });

const open = ref(false);

const presetColors = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280',
  '#000000', '#FFFFFF',
];

function selectColor(color: string) {
  model.value = color;
  open.value = false;
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.color-picker-container')) {
    open.value = false;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', handleClickOutside, { capture: true });
}
</script>

<template>
  <div class="color-picker-container relative">
    <button type="button"
      class="inline-flex items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted"
      @click.stop="open = !open">
      <span class="h-4 w-4 rounded-full border-2 border-border shadow-sm"
        :style="{ backgroundColor: model }" />
      <ChevronDown class="h-3 w-3 text-muted-foreground" />
    </button>

    <Transition enter-active-class="transition duration-100 ease-out"
      enter-from-class="scale-95 opacity-0"
      enter-to-class="scale-100 opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="scale-100 opacity-100"
      leave-to-class="scale-95 opacity-0">
      <div v-if="open"
        class="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-xl border border-border bg-background p-3 shadow-xl">
        <div class="grid grid-cols-5 gap-2">
          <button v-for="color in presetColors"
            :key="color"
            type="button"
            class="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
            :class="model === color ? 'border-primary ring-2 ring-primary/30 shadow-md' : 'border-transparent'"
            :style="{ backgroundColor: color }"
            @click.stop="selectColor(color)" />
        </div>
      </div>
    </Transition>
  </div>
</template>
