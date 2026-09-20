<template>
  <div v-if="!leaves" class="ml-4 px-1 py-1 text-[11px] text-gray-400" data-testid="spatial-tree-leaves-pending">
    取构件中…
  </div>
  <div v-else class="ml-2 border-l border-gray-100 pl-1">
    <div v-for="leaf in leaves"
      :key="leaf.refno"
      class="flex items-center gap-1 rounded-md px-1 py-0.5"
      :class="activeRefno === leaf.refno ? 'bg-brand-subtle' : 'hover:bg-gray-50'"
      data-testid="spatial-tree-leaf"
      :data-refno="leaf.refno">
      <button type="button"
        class="flex min-w-0 flex-1 items-center gap-1 text-left font-mono text-[11px]"
        :class="itemOf(leaf).loaded ? 'text-gray-800' : 'text-gray-400'"
        :title="leafTitle(leaf)"
        @click="emit('focus', itemOf(leaf))">
        <span class="truncate">{{ leaf.refno }}</span>
        <span class="shrink-0 font-sans text-gray-500">{{ leaf.noun }}</span>
        <span class="shrink-0 font-sans text-gray-400">{{ formatDistance(leaf.distance) }}</span>
        <span v-if="leaf.shared_rooms && leaf.shared_rooms > 1"
          class="shrink-0 rounded bg-warning-subtle px-1 font-sans text-[10px] text-warning"
          data-testid="spatial-tree-shared">
          跨 {{ leaf.shared_rooms }} 房
        </span>
      </button>
      <button type="button"
        class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white hover:text-gray-800"
        :title="itemOf(leaf).visible ? '隐藏' : '显示'"
        data-testid="spatial-tree-leaf-visibility"
        @click.stop="emit('toggleVisible', itemOf(leaf))">
        <Eye v-if="itemOf(leaf).visible" class="h-3.5 w-3.5" />
        <EyeOff v-else class="h-3.5 w-3.5" />
      </button>
      <button type="button"
        class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white hover:text-gray-800"
        title="飞行定位"
        data-testid="spatial-tree-leaf-locate"
        @click.stop="emit('focus', itemOf(leaf))">
        <ArrowUpRight class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowUpRight, Eye, EyeOff } from 'lucide-vue-next';

import type { SpatialTreeLeafNode } from '@/api/genModelSpatialApi';
import type { SpatialQueryResultItem } from '@/types/spatialQuery';

/**
 * 房间层级树的一组叶子（构件）：一行一个——refno · noun · 距离（· 跨 N 房），未加载灰字；眼睛切显隐、箭头定位。
 * refno 是唯一会被截的段（noun / 距离 / 跨房标 `shrink-0`），整行文字连名字（store 里有才有）都在 `title` 里。
 * `leaves` 还没到（服务端超上限、正在按 `unit=` / `other_noun=` 取）时一句「取构件中…」。
 */
const props = defineProps<{
  leaves: SpatialTreeLeafNode[] | undefined;
  /** store 条目按 refno 查（loaded / visible）；刚补进来的叶子 store 里也有，兜底合成最小可用项 */
  itemsByRefno: Map<string, SpatialQueryResultItem>;
  activeRefno: string | null;
}>();

const emit = defineEmits<{
  focus: [item: SpatialQueryResultItem];
  toggleVisible: [item: SpatialQueryResultItem];
}>();

const METERS_TO_MM = 1000;

function formatDistance(distance: number): string {
  const meters = distance / METERS_TO_MM;
  return `${meters >= 10 ? meters.toFixed(0) : meters.toFixed(2)} m`;
}

/** 叶子行的 title：refno · noun · 距离（· 名字，store 里有且不是 refno 本身才有）（· 跨 N 房）（· 未加载） */
function leafTitle(leaf: SpatialTreeLeafNode): string {
  const item = itemOf(leaf);
  return [
    leaf.refno,
    leaf.noun,
    formatDistance(leaf.distance),
    item.name && item.name !== leaf.refno ? item.name : null,
    leaf.shared_rooms && leaf.shared_rooms > 1 ? `跨 ${leaf.shared_rooms} 房` : null,
    item.loaded ? null : '未加载',
  ].filter(Boolean).join(' · ');
}

function itemOf(leaf: SpatialTreeLeafNode): SpatialQueryResultItem {
  return props.itemsByRefno.get(leaf.refno) ?? {
    refno: leaf.refno,
    noun: leaf.noun,
    specValue: 0,
    specName: '',
    dbnum: null,
    distance: leaf.distance,
    loaded: false,
    visible: true,
    matchedBy: 'server-spatial-index',
    name: null,
    position: null,
    bbox: null,
    sourceModel: null,
  };
}
</script>
