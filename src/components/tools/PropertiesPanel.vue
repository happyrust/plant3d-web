<script setup lang="ts">
import { computed } from 'vue';

import { useSelectionStore } from '@/composables/useSelectionStore';

const sel = useSelectionStore();

const rows = computed(() => {
  const data = sel.propertiesData.value;
  if (!data) return [] as Array<{ key: string; value: unknown }>;
  return Object.keys(data)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ key, value: data[key] }));
});

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
</script>

<template>
  <div class="flex h-full flex-col gap-2">
    <div class="flex items-center justify-between">
      <div class="text-sm font-semibold">属性</div>
      <div class="text-xs text-muted-foreground">{{ sel.selectedRefno.value ?? '未选择' }}</div>
    </div>

    <div v-if="sel.propertiesLoading.value" class="text-sm text-muted-foreground">
      加载中...
    </div>
    <div v-else-if="sel.propertiesError.value" class="text-sm text-destructive">
      {{ sel.propertiesError.value }}
    </div>
    <div v-else-if="rows.length === 0" class="text-sm text-muted-foreground">
      无数据
    </div>

    <div v-else class="min-h-0 flex-1 overflow-auto rounded-md border border-border">
      <table class="w-full table-fixed text-sm">
        <tbody>
          <tr v-for="r in rows" :key="r.key" class="border-b border-border last:border-b-0">
            <td class="w-44 truncate px-2 py-1 font-mono text-xs text-muted-foreground">{{ r.key }}</td>
            <td class="px-2 py-1">
              <div class="whitespace-pre-wrap break-words font-mono text-xs">{{ formatValue(r.value) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
