<script setup lang="ts">
import { computed, onBeforeUnmount, useId, useSlots, watch } from 'vue';

import { X } from 'lucide-vue-next';

import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    persistent?: boolean;
    showClose?: boolean;
    class?: string;
    overlayClass?: string;
    panelClass?: string;
    headerClass?: string;
    bodyClass?: string;
    footerClass?: string;
  }>(),
  {
    title: '',
    persistent: false,
    showClose: true,
    class: '',
    overlayClass: '',
    panelClass: '',
    headerClass: '',
    bodyClass: '',
    footerClass: '',
  }
);

const emit = defineEmits<{
  'update:open': [value: boolean];
  close: [];
}>();

const slots = useSlots();
const instanceScrollLockId = useId();
const titleId = useId();

const hasTitle = computed(() => Boolean(props.title || slots.title));
const hasHeader = computed(() => Boolean(hasTitle.value || props.showClose));
const hasFooter = computed(() => Boolean(slots.footer));
const dialogAriaLabelledby = computed(() => (hasTitle.value ? titleId : undefined));

const overlayClass = computed(() =>
  cn(
    'fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 px-4 py-6',
    props.overlayClass,
    props.class
  )
);

const panelClass = computed(() =>
  cn(
    'relative w-full max-w-[32rem] overflow-hidden rounded-[12px] bg-white shadow-[0_24px_60px_rgba(17,24,39,0.22)]',
    'transition-all duration-200',
    props.panelClass
  )
);

const headerClass = computed(() =>
  cn(
    'flex items-start justify-between gap-4 border-b border-[#F3F4F6] px-6 py-5',
    props.headerClass
  )
);

const bodyClass = computed(() =>
  cn(
    'px-6 py-5 text-sm leading-6 text-[#1F2937]',
    props.bodyClass
  )
);

const footerClass = computed(() =>
  cn(
    'flex items-center justify-end gap-3 border-t border-[#F3F4F6] px-6 py-4',
    props.footerClass
  )
);

type DialogScrollLockState = {
  count: number;
  lockedOverflow: string;
  activeIds: Set<string>;
};

const scrollLockState: DialogScrollLockState = (() => {
  if (typeof window === 'undefined') {
    return {
      count: 0,
      lockedOverflow: '',
      activeIds: new Set<string>(),
    };
  }

  const dialogWindow = window as Window & {
    __dialogScrollLockState__?: DialogScrollLockState;
  };

  if (!dialogWindow.__dialogScrollLockState__) {
    dialogWindow.__dialogScrollLockState__ = {
      count: 0,
      lockedOverflow: '',
      activeIds: new Set<string>(),
    };
  }

  return dialogWindow.__dialogScrollLockState__;
})();

function resetScrollLockState() {
  scrollLockState.count = 0;
  scrollLockState.lockedOverflow = '';
  scrollLockState.activeIds.clear();
}

function setOpen(value: boolean) {
  if (!props.open && !value) {
    return;
  }
  emit('update:open', value);
  if (!value) {
    emit('close');
  }
}

function handleOverlayClick() {
  if (props.persistent) {
    return;
  }
  setOpen(false);
}

function lockBodyScroll() {
  if (typeof document === 'undefined') {
    return;
  }

  if (scrollLockState.activeIds.has(instanceScrollLockId)) {
    return;
  }

  if (scrollLockState.count > 0 && document.body.style.overflow !== 'hidden') {
    resetScrollLockState();
  }

  if (scrollLockState.count === 0) {
    scrollLockState.lockedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  scrollLockState.activeIds.add(instanceScrollLockId);
  scrollLockState.count += 1;
}

function unlockBodyScroll() {
  if (typeof document === 'undefined' || !scrollLockState.activeIds.has(instanceScrollLockId)) {
    return;
  }

  scrollLockState.activeIds.delete(instanceScrollLockId);
  scrollLockState.count = Math.max(0, scrollLockState.count - 1);

  if (scrollLockState.count === 0) {
    document.body.style.overflow = scrollLockState.lockedOverflow;
    scrollLockState.lockedOverflow = '';
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      lockBodyScroll();
      return;
    }
    unlockBodyScroll();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  unlockBodyScroll();
});

if (import.meta.env.MODE === 'test') {
  window.__dialogScrollLockTestReset__ = resetScrollLockState;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open"
      :class="overlayClass"
      data-testid="dialog-overlay"
      @click.self="handleOverlayClick">
      <section :class="panelClass"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="dialogAriaLabelledby"
        :aria-label="!hasTitle && title ? title : undefined"
        @click.stop>
        <header v-if="hasHeader" :class="headerClass">
          <div class="min-w-0 flex-1">
            <slot name="title" :title-id="titleId">
              <h2 v-if="title" :id="titleId" class="text-lg font-semibold text-[#111827]">{{ title }}</h2>
            </slot>
          </div>
          <button v-if="showClose"
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#111827]"
            aria-label="Close dialog"
            data-testid="dialog-close"
            @click="setOpen(false)">
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div :class="bodyClass">
          <slot />
        </div>

        <footer v-if="hasFooter" :class="footerClass">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>
