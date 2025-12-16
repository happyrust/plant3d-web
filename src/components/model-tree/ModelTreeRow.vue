<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';

import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-vue-next';

import { type CheckState, type FlatRow } from '@/composables/useModelTree';
import { getPdmsTypeIconUrl } from '@/lib/pdmsTypeIcon';
import { cn } from '@/lib/utils';

const props = defineProps<{
  row: FlatRow;
  index: number;
  expanded: boolean;
  selected: boolean;
  checkState: CheckState;
}>();

const emit = defineEmits<{
  (e: 'toggle-expand', id: string): void;
  (e: 'toggle-visible', id: string, visible: boolean): void;
  (e: 'select', index: number, ev: MouseEvent): void;
  (e: 'context', id: string, ev: MouseEvent): void;
}>();

const INDENT_PX = 20;
const safeDepth = computed(() => {
  const d = Number(props.row.depth);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.floor(d);
});

const isVisible = computed(() => props.checkState !== 'unchecked');
const typeIconUrl = computed(() => getPdmsTypeIconUrl(props.row.type));

// hover 状态管理
const isHovering = ref(false);
const showEyeIcon = ref(false);
let hoverTimer: number | null = null;

function onMouseEnter() {
  isHovering.value = true;
  // 清除之前的定时器
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
  }
  // 设置 0.5 秒延迟显示 eye 图标
  hoverTimer = window.setTimeout(() => {
    if (isHovering.value) {
      showEyeIcon.value = true;
    }
  }, 500);
}

function onMouseLeave() {
  isHovering.value = false;
  showEyeIcon.value = false;
  // 清除定时器
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function onToggleExpand(ev: MouseEvent) {
  ev.stopPropagation();
  emit('toggle-expand', props.row.id);
}

function onToggleVisible(ev: MouseEvent) {
  ev.stopPropagation();
  emit('toggle-visible', props.row.id, !isVisible.value);
}

function onSelect(ev: MouseEvent) {
  emit('select', props.index, ev);
}

function onContext(ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  emit('context', props.row.id, ev);
}

// 组件卸载时清理定时器
onUnmounted(() => {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
  }
});
</script>

<template>
  <div :class="cn(
    'flex h-8 items-center rounded-sm pr-2 text-sm transition-colors',
    selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
  )" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave" @mousedown.prevent="onSelect" @contextmenu="onContext">
    <!-- Indentation guides -->
    <div class="flex h-full shrink-0 select-none">
      <span v-for="n in safeDepth" :key="n" class="h-full border-r border-border/40" :style="{ width: `${INDENT_PX}px` }" />
    </div>

    <div class="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
      <button v-if="row.hasChildren" type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground" @mousedown.stop @click="onToggleExpand">
        <ChevronDown v-if="expanded" class="h-3.5 w-3.5" />
        <ChevronRight v-else class="h-3.5 w-3.5" />
      </button>
      <span v-else class="h-5 w-5 shrink-0" />

      <img v-if="typeIconUrl" :src="typeIconUrl" class="h-4 w-4 shrink-0 opacity-80" :alt="row.type" />
      <span v-else class="h-4 w-4 shrink-0" />

      <div class="min-w-0 flex-1 leading-none">
        <div class="truncate font-medium">{{ row.name }}</div>
      </div>

      <button type="button" class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus:opacity-100 transition-opacity" :class="!isVisible ? 'opacity-100 text-destructive/70' : showEyeIcon ? 'opacity-100' : 'opacity-0'" @mousedown.stop @click="onToggleVisible">
        <Eye v-if="isVisible" class="h-3.5 w-3.5" />
        <EyeOff v-else class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>
