<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import {
  externalDimensionCategory,
  normalizeExternalDimension,
} from '../adapters/normalizeExternalDimensions';
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
  /**
   * 父组件给某些行另起组名（MBD 按直段分组，W3-6）；返回 null 的行走默认的
   * 「用户尺寸 / 外部尺寸 / 外部标注图元」三分。列表顺序仍由父组件按组排好。
   */
  groupLabel?: (item: DimensionListItem) => string | null;
  onSelect: (item: DimensionListItem) => void;
  onAction: (action: DimensionBoundAction, item: DimensionListItem) => void;
}>(), {
  hiddenExternalIds: () => [],
  // 函数型 prop 的默认值本身就是那个函数，不再套工厂：返回 null = 这一行没有自定义组名。
  groupLabel: () => null,
});

const activeIndex = ref(0);
const hiddenExternal = computed(() => new Set(props.hiddenExternalIds));

function itemGroup(item: DimensionListItem): string {
  const named = props.groupLabel?.(item);
  if (named) return named;
  if (!isExternalDimensionRecord(item)) return '用户尺寸';
  return externalDimensionCategory(item) === 'annotation'
    ? '外部标注图元'
    : '外部尺寸';
}

/** 折叠状态只活在内存里，默认全部展开；组名一变（如成员数更新）就回到展开。 */
const collapsedGroups = ref<ReadonlySet<string>>(new Set());

type ListRow = Readonly<{
  item: DimensionListItem;
  index: number;
  group: string;
  /** 本行是该组第一行，组标题渲染在它前面（列表顺序由父组件按组排好）。 */
  headsGroup: boolean;
  /** 所在组折叠时整行不渲染，键盘也跳过它。 */
  visible: boolean;
}>;

const rows = computed<readonly ListRow[]>(() => {
  const groups = props.items.map(item => itemGroup(item));
  return props.items.map((item, index) => {
    const group = groups[index]!;
    return {
      item,
      index,
      group,
      headsGroup: index === 0 || groups[index - 1] !== group,
      visible: !collapsedGroups.value.has(group),
    };
  });
});

const groupSizes = computed(() => {
  const sizes = new Map<string, number>();
  for (const row of rows.value) sizes.set(row.group, (sizes.get(row.group) ?? 0) + 1);
  return sizes;
});

function toggleGroup(group: string): void {
  const next = new Set(collapsedGroups.value);
  if (!next.delete(group)) next.add(group);
  collapsedGroups.value = next;
}

function isRowVisible(index: number): boolean {
  return rows.value[index]?.visible ?? false;
}

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

const activeDescendant = computed(() => {
  const row = rows.value[activeIndex.value];
  return row?.visible ? optionId(row.item) : undefined;
});

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
    return `${item.sourceLabel} ${label}`.trim();
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
    case 'restore-auto-layout':
      return '恢复自动布局';
    case 'hide-external':
      if (isExternalDimensionRecord(item) && item.source === 'pipe-information') return '隐藏';
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

/** 键盘只在展开的行之间走；折叠组里的行跳过，到头就停住。 */
function stepActive(direction: 1 | -1): void {
  const count = props.items.length;
  let next = activeIndex.value + direction;
  while (next >= 0 && next < count && !isRowVisible(next)) next += direction;
  if (next >= 0 && next < count) activeIndex.value = next;
}

function onKeydown(event: KeyboardEvent): void {
  if (props.items.length === 0) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    stepActive(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    stepActive(-1);
    return;
  }

  const active = props.items[activeIndex.value];
  if (!active || !isRowVisible(activeIndex.value)) return;
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
    :aria-activedescendant="activeDescendant"
    @keydown="onKeydown">
    <template v-for="row in rows" :key="row.item.id">
      <div v-if="row.headsGroup"
        class="dimension-semantic-list__group"
        role="presentation">
        <button type="button"
          class="dimension-semantic-list__group-toggle"
          :data-group="row.group"
          :aria-expanded="row.visible"
          @click="toggleGroup(row.group)">
          {{ row.group }}
        </button>
        <span class="dimension-semantic-list__group-count"
          :data-group-count="row.group">
          {{ groupSizes.get(row.group) }}
        </span>
      </div>
      <div v-if="row.visible"
        :id="optionId(row.item)"
        class="dimension-semantic-list__row"
        :class="{ 'is-active': row.index === activeIndex }"
        role="option"
        :aria-selected="row.item.id === selectedId"
        :data-dimension-id="row.item.id"
        @click="selectItem(row.item, row.index)">
        <div class="dimension-semantic-list__content">
          <span>{{ itemLabel(row.item) }}</span>
          <span v-if="statusLabel(row.item)"
            class="dimension-semantic-list__status">
            {{ statusLabel(row.item) }}
          </span>
        </div>
        <div class="dimension-semantic-list__actions">
          <button v-for="action in actionsFor(row.item).filter(action => action !== 'select')"
            :key="action"
            type="button"
            :data-action="action"
            @click.stop="invokeAction(action, row.item)">
            {{ actionLabel(action, row.item) }}
          </button>
        </div>
      </div>
    </template>
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

.dimension-semantic-list__group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px 2px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  opacity: 0.65;
}

.dimension-semantic-list__group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  padding: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
}

.dimension-semantic-list__group-toggle::before {
  content: '▾';
}

.dimension-semantic-list__group-toggle[aria-expanded='false']::before {
  content: '▸';
}

.dimension-semantic-list__group-count {
  font-weight: 400;
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
