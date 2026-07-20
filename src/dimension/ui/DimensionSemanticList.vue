<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { normalizeExternalDimension } from '../adapters/normalizeExternalDimensions';
import { normalizeUserDimension } from '../adapters/normalizeUserDimensions';
import { formatDimensionLabel } from '../kernel/format';
import { deriveDimensionValue } from '../kernel/value';

import {
  getDimensionBoundActions,
  isExternalDimensionRecord,
  isDimensionRebindAction,
  rebindActionSlot,
} from './dimensionBoundActions';

import type { DimensionBoundAction } from './dimensionBoundActions';
import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { UserDimensionRecord } from '../domain/types';
import type { DimensionFormatPolicy } from '../kernel/format';
import type { NormalizedDimensionInput } from '../kernel/types';

type DimensionListItem = UserDimensionRecord | ExternalDimensionRecord;

const props = withDefaults(defineProps<{
  items: readonly DimensionListItem[];
  selectedId: string | null;
  user: { id: string; role: string } | null;
  formatPolicy: DimensionFormatPolicy;
  hiddenExternalIds?: readonly string[];
  onSelect: (item: DimensionListItem) => void;
  onAction: (action: DimensionBoundAction, item: DimensionListItem) => void;
}>(), {
  hiddenExternalIds: () => [],
});

const activeIndex = ref(0);
const hiddenExternal = computed(() => new Set(props.hiddenExternalIds));

watch(
  () => [props.selectedId, props.items] as const,
  ([selectedId, items]) => {
    const selectedIndex = items.findIndex(item => item.id === selectedId);
    if (selectedIndex >= 0) {
      activeIndex.value = selectedIndex;
      return;
    }
    activeIndex.value = Math.min(
      activeIndex.value,
      Math.max(0, items.length - 1),
    );
  },
  { immediate: true },
);

function optionId(item: DimensionListItem): string {
  return `dimension-option-${item.id}`;
}

function actionsFor(item: DimensionListItem): readonly DimensionBoundAction[] {
  return getDimensionBoundActions(item, props.user);
}

function normalizedLabel(input: NormalizedDimensionInput): string {
  const formatted = formatDimensionLabel(
    input,
    deriveDimensionValue(input),
    props.formatPolicy,
  );
  return formatted.ok ? formatted.text : input.id;
}

function itemLabel(item: DimensionListItem): string {
  if (isExternalDimensionRecord(item)) {
    const normalized = normalizeExternalDimension(item);
    const label = 'formattedLabel' in normalized
      ? normalized.formattedLabel
      : normalizedLabel(normalized);
    return `${item.sourceLabel} ${label}`;
  }

  const normalized = normalizeUserDimension(item);
  if (!normalized) return `STALE ${item.kind} ${item.id}`;
  return `${item.kind} ${normalizedLabel(normalized)}`;
}

function statusLabel(item: DimensionListItem): string {
  if (isExternalDimensionRecord(item)) return '只读';
  if (item.validity === 'invalid') return 'STALE';
  const normalized = normalizeUserDimension(item);
  return normalized?.role === 'approximate' ? '近似' : '';
}

function actionLabel(
  action: Exclude<DimensionBoundAction, 'select'>,
  item: DimensionListItem,
): string {
  if (isDimensionRebindAction(action)) {
    const labels = {
      a: '重绑起点',
      b: '重绑终点',
      vertex: '重绑顶点',
      rayA: '重绑第一射线',
      rayB: '重绑第二射线',
      center: '重绑圆心',
      rim: '重绑圆周点',
    } as const;
    return labels[rebindActionSlot(action)];
  }
  switch (action) {
    case 'delete':
      return '删除';
    case 'flip-angle':
      return '翻转角度';
    case 'toggle-radial-display':
      return '切换半径/直径';
    case 'hide-external':
      return hiddenExternal.value.has(item.id) ? '临时显示' : '临时隐藏';
  }
}

function selectItem(item: DimensionListItem, index: number): void {
  activeIndex.value = index;
  props.onSelect(item);
}

function invokeAction(
  action: Exclude<DimensionBoundAction, 'select'>,
  item: DimensionListItem,
): void {
  props.onAction(action, item);
}

function onKeydown(event: KeyboardEvent): void {
  if (props.items.length === 0) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, props.items.length - 1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
    return;
  }

  const active = props.items[activeIndex.value];
  if (!active) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    props.onSelect(active);
    return;
  }
  if (
    (event.key === 'Delete' || event.key === 'Backspace')
    && actionsFor(active).includes('delete')
  ) {
    event.preventDefault();
    props.onAction('delete', active);
  }
}
</script>

<template>
  <div class="dimension-semantic-list"
    role="listbox"
    tabindex="0"
    aria-label="尺寸列表"
    :aria-activedescendant="items[activeIndex] ? optionId(items[activeIndex]) : undefined"
    @keydown="onKeydown">
    <div v-for="(item, index) in items"
      :id="optionId(item)"
      :key="item.id"
      class="dimension-semantic-list__row"
      :class="{ 'is-active': index === activeIndex }"
      role="option"
      :aria-selected="item.id === selectedId"
      :data-dimension-id="item.id"
      @click="selectItem(item, index)">
      <div class="dimension-semantic-list__content">
        <span>{{ itemLabel(item) }}</span>
        <span v-if="statusLabel(item)"
          class="dimension-semantic-list__status">
          {{ statusLabel(item) }}
        </span>
      </div>
      <div class="dimension-semantic-list__actions">
        <button v-for="action in actionsFor(item).filter(action => action !== 'select')"
          :key="action"
          type="button"
          :data-action="action"
          @click.stop="invokeAction(action, item)">
          {{ actionLabel(action, item) }}
        </button>
      </div>
    </div>
    <div v-if="items.length === 0" class="dimension-semantic-list__empty">
      暂无尺寸
    </div>
  </div>
</template>

<style scoped>
.dimension-semantic-list {
  display: flex;
  height: 100%;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
  padding: 8px;
  outline: none;
}

.dimension-semantic-list__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 6px 8px;
}

.dimension-semantic-list__row.is-active {
  border-color: #7c3aed;
}

.dimension-semantic-list__row[aria-selected='true'] {
  background: rgb(124 58 237 / 12%);
}

.dimension-semantic-list__content,
.dimension-semantic-list__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dimension-semantic-list__status {
  font-size: 0.75rem;
  font-weight: 700;
}

.dimension-semantic-list__actions button {
  border: 1px solid currentcolor;
  border-radius: 3px;
  padding: 2px 5px;
  font-size: 0.75rem;
}

.dimension-semantic-list__empty {
  padding: 16px;
  text-align: center;
  opacity: 0.7;
}
</style>
