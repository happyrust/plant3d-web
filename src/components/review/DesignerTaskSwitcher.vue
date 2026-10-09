<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { ChevronsUpDown, FileText, RefreshCw } from 'lucide-vue-next';

import { getCanonicalReturnedMetadata, getResubmissionLatestReturnTime } from './reviewTaskFilters';

import type { ReviewTask } from '@/types/auth';

import { getPriorityDisplayName } from '@/types/auth';

const props = withDefaults(defineProps<{
  tasks: ReviewTask[];
  currentTask?: ReviewTask | null;
  loading?: boolean;
  error?: string | null;
}>(), {
  currentTask: null,
  loading: false,
  error: null,
});

const emit = defineEmits<{
  select: [task: ReviewTask];
  retry: [];
}>();

const open = ref(false);
const activeIndex = ref(-1);
const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

const currentIndex = computed(() => (
  props.currentTask ? props.tasks.findIndex((task) => task.id === props.currentTask?.id) : -1
));
const canOpen = computed(() => props.tasks.length > 0);

const summaryLine = computed(() => {
  const total = props.tasks.length;
  if (total === 0) {
    if (props.loading) return '正在加载退回单据…';
    if (props.error) return '退回单据加载失败';
    return '暂无退回单据';
  }
  if (currentIndex.value < 0) return `退回单据 ${total} 张`;
  const others = total - 1;
  return others > 0
    ? `退回单据 ${currentIndex.value + 1} / ${total} · 其余 ${others} 张待处理`
    : `退回单据 ${currentIndex.value + 1} / ${total}`;
});

const titleLine = computed(() => {
  if (props.currentTask?.title) return props.currentTask.title;
  return canOpen.value ? '选择退回单据' : '—';
});

function returnReasonOf(task: ReviewTask): string {
  return getCanonicalReturnedMetadata(task).returnReason || '未填写退回意见';
}

function returnTimeOf(task: ReviewTask): string | null {
  const timestamp = getResubmissionLatestReturnTime(task.workflowHistory || []);
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function focusOption(index: number) {
  const options = listEl.value?.querySelectorAll<HTMLElement>('[role="option"]');
  if (!options?.length) return;
  const bounded = Math.max(0, Math.min(index, options.length - 1));
  activeIndex.value = bounded;
  options[bounded]?.focus();
}

function openList() {
  if (!canOpen.value) return;
  open.value = true;
  activeIndex.value = currentIndex.value >= 0 ? currentIndex.value : 0;
  void nextTick(() => focusOption(activeIndex.value));
}

function closeList(refocusTrigger = false) {
  open.value = false;
  if (refocusTrigger) triggerEl.value?.focus();
}

function toggleList() {
  if (open.value) closeList();
  else openList();
}

function chooseTask(task: ReviewTask) {
  closeList(true);
  if (task.id !== props.currentTask?.id) emit('select', task);
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  if (!open.value) openList();
}

function handleListKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusOption(activeIndex.value + 1);
      return;
    case 'ArrowUp':
      event.preventDefault();
      focusOption(activeIndex.value - 1);
      return;
    case 'Home':
      event.preventDefault();
      focusOption(0);
      return;
    case 'End':
      event.preventDefault();
      focusOption(props.tasks.length - 1);
      return;
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      closeList(true);
      return;
    case 'Tab':
      closeList();
  }
}

function handleDocumentMouseDown(event: MouseEvent) {
  if (event.target instanceof Node && rootEl.value?.contains(event.target)) return;
  closeList();
}

watch(open, (isOpen) => {
  if (typeof document === 'undefined') return;
  if (isOpen) document.addEventListener('mousedown', handleDocumentMouseDown);
  else document.removeEventListener('mousedown', handleDocumentMouseDown);
});

watch(() => props.tasks.length, (length) => {
  if (length === 0) closeList();
});

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('mousedown', handleDocumentMouseDown);
});
</script>

<template>
  <div ref="rootEl" class="relative flex min-w-0 items-center gap-2" data-testid="designer-task-switcher">
    <button ref="triggerEl"
      type="button"
      class="flex min-w-0 max-w-[420px] items-center gap-2.5 rounded-lg border border-solid border-slate-200 bg-white px-2.5 py-1.5 text-left enabled:hover:border-slate-300 enabled:hover:bg-slate-50 disabled:cursor-default"
      data-testid="designer-task-switcher-trigger"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :disabled="!canOpen"
      @click="toggleList"
      @keydown="handleTriggerKeydown">
      <FileText class="h-4 w-4 shrink-0 text-slate-500" />
      <span class="flex min-w-0 flex-col">
        <span class="truncate text-[11px] text-slate-400" data-testid="designer-task-switcher-summary">{{ summaryLine }}</span>
        <span class="truncate text-sm font-semibold text-slate-950" :title="currentTask?.title">{{ titleLine }}</span>
      </span>
      <ChevronsUpDown v-if="canOpen" class="h-4 w-4 shrink-0 text-slate-400" />
    </button>

    <button v-if="error"
      type="button"
      class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-0 bg-transparent p-0 text-xs font-medium text-danger hover:underline"
      data-testid="designer-task-switcher-retry"
      :title="error"
      :disabled="loading"
      @click="emit('retry')">
      <RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" />
      重试
    </button>

    <div v-if="open"
      ref="listEl"
      class="absolute left-0 top-full z-30 mt-1 max-h-[360px] w-[360px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
      role="listbox"
      aria-label="退回单据"
      data-testid="designer-task-switcher-list"
      @keydown="handleListKeydown">
      <button v-for="(task, index) in tasks"
        :key="task.id"
        type="button"
        role="option"
        class="flex w-full flex-col gap-1 rounded-lg border-0 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand"
        :class="task.id === currentTask?.id ? 'bg-brand-subtle' : 'bg-transparent hover:bg-slate-50'"
        :aria-selected="task.id === currentTask?.id"
        :tabindex="index === activeIndex ? 0 : -1"
        :data-testid="`designer-task-switcher-option-${task.id}`"
        @click="chooseTask(task)">
        <span class="flex w-full min-w-0 items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900" :title="task.title">{{ task.title }}</span>
          <span class="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
            :class="getPriorityDisplayName(task.priority).color">
            {{ getPriorityDisplayName(task.priority).label }}
          </span>
        </span>
        <span class="w-full truncate text-xs text-slate-500" :title="returnReasonOf(task)">{{ returnReasonOf(task) }}</span>
        <span v-if="returnTimeOf(task)" class="text-[11px] text-slate-400">退回于 {{ returnTimeOf(task) }}</span>
      </button>
    </div>
  </div>
</template>
