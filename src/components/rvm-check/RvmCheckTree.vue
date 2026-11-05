<script setup lang="ts">
import { onMounted, ref } from 'vue';

import RvmCheckTreeNode, { type RvmTreeRow } from './RvmCheckTreeNode.vue';

import { genModelV1TreeChildren, genModelV1TreeRoots, toV1Refno, type EleTreeNodeDto } from '@/api/genModelV1Api';

const emit = defineEmits<{ select: [row: { refno: string; name: string; noun: string }] }>();

const roots = ref<RvmTreeRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selected = ref('');

function toRow(node: EleTreeNodeDto, depth: number): RvmTreeRow {
  return {
    refnoSlash: toV1Refno(node.refno),
    noun: node.noun,
    name: node.name,
    shortName: node.short_name || node.name,
    depth,
    expanded: false,
    loading: false,
    childrenCount: node.children_count,
    children: [],
  };
}

async function loadRoots(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const response = await genModelV1TreeRoots();
    roots.value = (response.nodes ?? []).map((node) => toRow(node, 0));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

async function toggle(row: RvmTreeRow): Promise<void> {
  row.expanded = !row.expanded;
  if (!row.expanded || row.children.length > 0 || row.childrenCount === 0) return;
  row.loading = true;
  try {
    const response = await genModelV1TreeChildren(row.refnoSlash);
    row.children = (response.nodes ?? []).map((node) => toRow(node, row.depth + 1));
  } catch (cause) {
    row.expanded = false;
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    row.loading = false;
  }
}

function choose(row: RvmTreeRow): void {
  selected.value = row.refnoSlash;
  emit('select', {
    refno: row.refnoSlash,
    name: row.shortName || row.name || row.noun,
    noun: row.noun,
  });
}

onMounted(() => {
  void loadRoots();
});
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto rounded border border-border">
    <p v-if="loading" class="px-2 py-2 text-[11px] text-muted-foreground">正在读模型树…</p>
    <p v-else-if="error" class="px-2 py-2 text-[11px] text-red-700">{{ error }}</p>
    <p v-else-if="roots.length === 0" class="px-2 py-2 text-[11px] text-muted-foreground">这棵树是空的</p>
    <ul v-else class="py-1 text-xs">
      <RvmCheckTreeNode :rows="roots" :selected="selected" @toggle="toggle" @choose="choose" />
    </ul>
  </div>
</template>
