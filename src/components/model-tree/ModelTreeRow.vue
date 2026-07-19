<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';

import { ChevronDown, ChevronRight, CircleMinus, Eye, EyeOff, LoaderCircle } from 'lucide-vue-next';

import type { TreeDiffStatus } from '@/composables/useTreeVersionDiff';

import { type CheckState, type FlatRow } from '@/composables/useModelTree';
import { getPdmsTypeIconUrl } from '@/lib/pdmsTypeIcon';
import { cn } from '@/lib/utils';

const props = defineProps<{
  row: FlatRow;
  index: number;
  expanded: boolean;
  selected: boolean;
  checkState: CheckState;
  loading?: boolean;
  /** 版本差异模式：该节点自身的变更类别 */
  diffStatus?: TreeDiffStatus;
  /** 版本差异模式：后代变更数量汇总（容器节点） */
  diffCount?: number;
  /** 版本差异模式：幽灵节点（已删除，仅展示） */
  ghost?: boolean;
  /** 幽灵节点因原父节点未知而挂载于根节点 */
  ghostUnplaced?: boolean;
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

function normalizePdmsName(value: string | undefined): string {
  return String(value || '').trim().replace(/^\/+/, '');
}

function fallbackRefnoLabel(id: string): string {
  // refno 格式：24381_145018 → 24381/145018
  return id && id.includes('_') ? id.replace('_', '/') : id || '';
}

const rawDisplayName = computed(() => normalizePdmsName(props.row.name));
const nameLooksLikeRefno = computed(() => {
  const id = props.row.id;
  const name = rawDisplayName.value;
  return !!id && !!name && (name === id || name === id.replace('_', '/'));
});

const diffBadge = computed(() => {
  if (!props.diffStatus) return null;
  if (props.diffStatus === 'added') return { label: '增', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (props.diffStatus === 'deleted') return { label: '删', cls: 'bg-rose-100 text-rose-700 border-rose-200' };
  return { label: '改', cls: 'bg-amber-100 text-amber-700 border-amber-200' };
});

const ghostTitle = computed(() => {
  if (!props.ghost) return undefined;
  return props.ghostUnplaced
    ? '已删除节点：原父节点未知，挂载于根节点下；仅展示，不可定位 3D'
    : '已删除节点：仅展示，不可定位 3D';
});

/** 显示名称：PDMS 节点显示为 "NOUN NAME"，为空时用 refno 兜底 */
const displayName = computed(() => {
  const name = rawDisplayName.value;
  const fallback = fallbackRefnoLabel(props.row.id);
  const type = String(props.row.type || '').trim();

  if (!name || nameLooksLikeRefno.value) return fallback;
  if (!type || type === 'WORL') return name;
  if (name.toUpperCase().startsWith(`${type.toUpperCase()} `)) return name;
  return `${type} ${name}`;
});
const isNameFallback = computed(() => !rawDisplayName.value || nameLooksLikeRefno.value);

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
       )"
    data-testid="model-tree-row"
    :data-node-type="row.type"
    :data-refno="row.refno || row.id"
    :data-selected="selected ? 'true' : 'false'"
    :data-diff-status="diffStatus || undefined"
    :data-ghost="ghost ? 'true' : undefined"
    :title="ghostTitle"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @mousedown.prevent="onSelect"
    @contextmenu="onContext">
    <!-- Indentation guides -->
    <div class="flex h-full shrink-0 select-none">
      <span v-for="n in safeDepth" :key="n" class="h-full border-r border-border/40" :style="{ width: `${INDENT_PX}px` }" />
    </div>

    <div class="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
      <button v-if="row.hasChildren && !ghost" type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground" @mousedown.stop @click="onToggleExpand">
        <ChevronDown v-if="expanded" class="h-3.5 w-3.5" />
        <ChevronRight v-else class="h-3.5 w-3.5" />
      </button>
      <span v-else class="h-5 w-5 shrink-0" />

      <CircleMinus v-if="ghost" class="h-4 w-4 shrink-0 text-muted-foreground/60" />
      <img v-else-if="typeIconUrl" :src="typeIconUrl" class="h-4 w-4 shrink-0 opacity-80" :alt="row.type" />
      <span v-else class="h-4 w-4 shrink-0" />

      <div class="min-w-0 flex-1 leading-none">
        <div v-if="ghost" class="truncate text-xs text-muted-foreground/70">
          <span class="line-through">{{ displayName }}</span> (已删除)
        </div>
        <div v-else class="truncate" :class="isNameFallback ? 'text-muted-foreground text-xs' : 'font-medium'">{{ displayName }}</div>
      </div>

      <span v-if="diffBadge"
        class="inline-flex shrink-0 items-center rounded border px-1 text-[10px] leading-4"
        :class="diffBadge.cls"
        data-testid="model-tree-diff-badge">
        {{ diffBadge.label }}
      </span>

      <span v-if="!diffStatus && (diffCount ?? 0) > 0"
        class="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground"
        :title="`后代包含 ${diffCount} 处变更`"
        data-testid="model-tree-diff-count">
        {{ diffCount }}
      </span>

      <button v-if="!ghost" type="button" class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus:opacity-100 transition-opacity disabled:cursor-wait disabled:opacity-100" :class="!isVisible ? 'opacity-100 text-destructive/70' : showEyeIcon || props.loading ? 'opacity-100' : 'opacity-0'" :disabled="props.loading" @mousedown.stop @click="onToggleVisible">
        <LoaderCircle v-if="props.loading" class="h-3.5 w-3.5 animate-spin" />
        <Eye v-if="isVisible" class="h-3.5 w-3.5" />
        <EyeOff v-else-if="!props.loading" class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>
