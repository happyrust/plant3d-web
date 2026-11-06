<script setup lang="ts">
import RvmCheckTreeNode from './RvmCheckTreeNode.vue';
import RvmStatusIcon from './RvmStatusIcon.vue';

import { rvmNodeBadge } from '@/composables/useIncrementalRvmCheck';

export type RvmTreeRow = {
  refnoSlash: string;
  noun: string;
  name: string;
  shortName: string;
  depth: number;
  expanded: boolean;
  loading: boolean;
  childrenCount: number;
  children: RvmTreeRow[];
};

defineProps<{
  rows: RvmTreeRow[];
  selected: string;
}>();

const emit = defineEmits<{
  toggle: [row: RvmTreeRow];
  choose: [row: RvmTreeRow];
}>();
</script>

<template>
  <li v-for="row in rows" :key="row.refnoSlash">
    <div class="flex items-center gap-1 px-1 py-0.5"
      :style="{ paddingLeft: `${row.depth * 12 + 4}px` }"
      :class="selected === row.refnoSlash ? 'bg-sky-50' : ''">
      <button type="button" class="w-4 shrink-0 text-muted-foreground" @click="emit('toggle', row)">
        {{ row.childrenCount === 0 ? '' : (row.loading ? '…' : (row.expanded ? '▾' : '▸')) }}
      </button>
      <button type="button" class="min-w-0 flex-1 truncate text-left" @click="emit('choose', row)">
        <span class="mr-1 text-muted-foreground">{{ row.noun }}</span>
        {{ row.shortName || row.name }}
        <span class="ml-1 text-muted-foreground">{{ row.refnoSlash }}</span>
      </button>
      <span v-if="!rvmNodeBadge(row.refnoSlash).empty"
        class="shrink-0"
        :title="rvmNodeBadge(row.refnoSlash).title"
        :data-rvm-status="rvmNodeBadge(row.refnoSlash).verdict ?? undefined"
        data-testid="rvm-check-tree-status">
        <RvmStatusIcon :verdict="rvmNodeBadge(row.refnoSlash).verdict" :outdated="rvmNodeBadge(row.refnoSlash).outdated" />
      </span>
    </div>
    <ul v-if="row.expanded && row.children.length">
      <RvmCheckTreeNode :rows="row.children"
        :selected="selected"
        @toggle="emit('toggle', $event)"
        @choose="emit('choose', $event)" />
    </ul>
  </li>
</template>
