<script setup lang="ts">
import { computed } from 'vue';

import type { ReviewClearanceConflict, ReviewClearanceResolution, ReviewClearanceSnapshot } from './reviewClearanceSnapshot';

const props = defineProps<{ conflict?: ReviewClearanceConflict | null; backup?: ReviewClearanceConflict | null; keptLocal?: ReviewClearanceConflict | null; busy?: boolean }>();
const emit = defineEmits<{ resolve: [action: ReviewClearanceResolution['action']]; undo: []; recompare: [] }>();
function summarize(snapshot: ReviewClearanceSnapshot) {
  const component = snapshot.component as { records?: { snapshot?: { distanceM?: number } | null }[] };
  const pipe = snapshot.pipe as { results?: { distance?: number }[] };
  const bran = snapshot.bran as { branGroups?: { candidates?: { distance_mm?: number }[] }[] };
  const groups = [component.records ?? [], pipe.results ?? [], (bran.branGroups ?? []).flatMap(group => group.candidates ?? [])];
  const distances = [(component.records ?? []).map(record => record.snapshot?.distanceM === undefined ? undefined : record.snapshot.distanceM * 1000),
    (pipe.results ?? []).map(record => record.distance), (bran.branGroups ?? []).flatMap(group => (group.candidates ?? []).map(record => record.distance_mm))];
  return groups.map((group, index) => {
    const finite = distances[index]!.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return { count: group.length, nearest: finite.length ? Math.min(...finite).toFixed(2) + ' mm' : '—' };
  });
}
const rows = computed(() => {
  if (!props.conflict) return [];
  const local = summarize(props.conflict.local), cloud = summarize(props.conflict.cloud);
  return ['构件净距', '管间净距', 'BRAN 净距'].map((label, index) => ({ label, local: local[index]!, cloud: cloud[index]! }));
});
function downloadBackup() {
  if (!props.backup) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(props.backup.local, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = '校审净距本机备份.json';
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div v-if="conflict || backup || keptLocal" class="w-full rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-xs text-slate-900" data-testid="review-clearance-conflict">
    <template v-if="conflict">
      <p class="font-semibold">本机净距结果与云端不同，本机结果已保留</p>
      <table class="my-2 w-full text-left">
        <thead><tr><th>类型</th><th>本机：条数 / 最近距离</th><th>云端：条数 / 最近距离</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.label"><td>{{ row.label }}</td><td>{{ row.local.count }} / {{ row.local.nearest }}</td><td>{{ row.cloud.count }} / {{ row.cloud.nearest }}</td></tr></tbody>
      </table>
      <p>保留本机后可继续核对并保存；恢复云端前会备份本机三类结果。恢复结果仍需重算或专业核对。</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <button type="button" class="rounded border border-slate-500 px-2 py-1 disabled:opacity-50" :disabled="busy" @click="emit('resolve', 'keep-local')">保留本机结果</button>
        <button type="button" class="rounded border border-slate-500 px-2 py-1 disabled:opacity-50" :disabled="busy" @click="emit('resolve', 'use-cloud')">备份本机并恢复云端</button>
      </div>
    </template>
    <div v-if="keptLocal && !conflict" class="flex flex-wrap items-center gap-2">
      <span>已选择保留本机净距结果，保存后才会更新云端。</span>
      <button type="button" class="underline disabled:opacity-50" :disabled="busy" @click="emit('recompare')">重新比较</button>
    </div>
    <div v-if="backup" class="mt-2 flex flex-wrap items-center gap-2">
      <span>本次恢复前的本机结果已备份。</span>
      <button type="button" class="underline disabled:opacity-50" :disabled="busy" @click="emit('undo')">撤销本次云端恢复</button>
      <button type="button" class="underline" @click="downloadBackup">下载本机备份</button>
    </div>
  </div>
</template>
