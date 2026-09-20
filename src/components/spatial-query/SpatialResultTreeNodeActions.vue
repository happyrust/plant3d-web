<template>
  <!-- 叠在标题单元格右端（父级 relative）：不占宽；行悬停 / 行内有焦点时才可见可点，盖住标题被截断的尾巴。
       用 visibility 而不是 opacity：Vuetify main.css 的 .opacity-0 / .pointer-events-none 带 !important，会压掉 Tailwind 的 group-hover 变体 -->
  <div class="invisible absolute inset-y-0 right-0 flex items-center gap-1 rounded-l-md bg-gray-50 pl-2 group-hover:visible group-has-[:focus-visible]:visible"
    data-testid="spatial-tree-node-actions">
    <button type="button"
      class="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="disabled"
      :title="title"
      data-testid="spatial-tree-node-load"
      @click.stop="emit('load', treeNodeRefnos(target), label)">
      加载
    </button>
    <button type="button"
      class="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="disabled"
      :title="title"
      data-testid="spatial-tree-node-show-only"
      @click.stop="emit('showOnly', treeNodeRefnos(target))">
      仅显示
    </button>
    <button type="button"
      class="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="disabled"
      :title="title"
      data-testid="spatial-tree-node-isolate"
      @click.stop="emit('isolate', treeNodeRefnos(target))">
      隔离
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { treeNodeLeavesInline, treeNodeRefnos, type SpatialTreeActionNode } from '@/composables/spatialTree';
import { getSpecValueName } from '@/types/spec';

/**
 * 房间层级树一行的三个小动作：加载 / 仅显示 / 隔离（ADR 0068，Q6）。作用对象 = 节点下已内联的全部构件；
 * 叶子没内联齐（服务端超上限）的节点先不可点——单元 / noun 组可以先展开取叶子，更高层要等它们都到。
 *
 * 布局：不在行里占一格（336 px 抽屉里三个按钮占掉 1/3 宽，标题被截成 `R432 · /1RX-RM…`），而是绝对定位在标题单元格
 * 右端、平时 `visibility: hidden`（不接指针、不可聚焦）；行（`.group`）悬停或行内有键盘焦点（`:has(:focus-visible)`）时才可见可点，
 * 盖住标题尾巴，计数始终露在右侧。键盘：Tab 到行首折叠按钮 → 动作显出 → 再 Tab 进到它们；鼠标点折叠按钮不算键盘焦点，
 * 鼠标一离开动作就收，不会把一排按钮留在刚点过的行上。
 * 不用 `opacity-0 group-hover:opacity-100`：Vuetify `main.css` 同名工具类带 `!important`，Tailwind 的变体永远赢不了（2026-09-20 真机核出）。
 */
const props = defineProps<{
  target: SpatialTreeActionNode;
  /** 这个节点能不能单独取叶子（单元 / noun 组有；房间 / 专业 / 单元类型没有） */
  expandable?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  load: [refnos: string[], label: string];
  showOnly: [refnos: string[]];
  isolate: [refnos: string[]];
}>();

const inline = computed(() => treeNodeLeavesInline(props.target));
const disabled = computed(() => Boolean(props.busy) || !inline.value);
const title = computed(() => {
  if (inline.value) return undefined;
  return props.expandable ? '先展开取该组构件' : '构件太多未全部下发，先展开单元或构件类型取构件';
});
const label = computed(() => {
  const target = props.target;
  switch (target.kind) {
    case 'room':
      return `房间 ${target.node.room_num}`;
    case 'spec':
      return getSpecValueName(target.node.spec_value);
    case 'unitType':
      return target.node.noun;
    case 'unit':
      return target.node.name || target.node.refno;
    case 'others':
      return '其他构件';
    case 'otherNoun':
      return target.node.noun;
    default:
      return '';
  }
});
</script>
