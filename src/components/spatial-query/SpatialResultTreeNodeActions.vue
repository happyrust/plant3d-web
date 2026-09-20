<template>
  <div class="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
 * 房间层级树一行右侧的三个小动作：加载 / 仅显示 / 隔离（ADR 0068，Q6）。作用对象 = 节点下已内联的全部构件；
 * 叶子没内联齐（服务端超上限）的节点先不可点——单元 / noun 组可以先展开取叶子，更高层要等它们都到。
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
