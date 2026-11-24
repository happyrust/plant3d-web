<script setup lang="ts">
/**
 * 按原因种类的汇总：每种原因的中文名、说明、落在哪些分类下、最重的级别、行数和占比。
 * 点一行就按这个原因筛下面的明细，再点一次取消。一行一种原因，说明太长时截断，完整的在提示里。
 */
import { computed } from 'vue';

import { reasonKindInfo, severityInfo, storeCategoryLabel, type RvmStoreReasonTotal } from './rvmStoreFormat';

const props = withDefaults(defineProps<{
  items: RvmStoreReasonTotal[];
  /** 选中的原因种类；null 是不按原因筛 */
  selected?: string | null;
}>(), { selected: null });

const emit = defineEmits<{ select: [reasonKind: string | null] }>();

const total = computed(() => props.items.reduce((sum, item) => sum + item.n, 0));

function share(count: number): string {
  if (total.value <= 0) return '0%';
  return `${Math.max(2, Math.round((count / total.value) * 100))}%`;
}

function percent(count: number): string {
  if (total.value <= 0) return '';
  const value = (count / total.value) * 100;
  return value >= 10 || value === 0 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}

function categories(item: RvmStoreReasonTotal): string {
  return item.categories.map(storeCategoryLabel).join('、');
}

function toggle(kind: string): void {
  emit('select', props.selected === kind ? null : kind);
}
</script>

<template>
  <details class="shrink-0 rounded border border-border" open data-testid="rvm-store-reason-summary">
    <summary class="cursor-pointer select-none px-2 py-1 text-[11px] text-muted-foreground">
      <span class="font-medium text-foreground">按原因种类汇总</span>
      · {{ items.length }} 种 · {{ total.toLocaleString('zh-CN') }} 行
      <span v-if="selected" class="ml-1 text-foreground">· 正按「{{ reasonKindInfo(selected).label }}」筛</span>
    </summary>
    <div class="max-h-40 overflow-auto border-t border-border">
      <table class="w-full min-w-[720px] table-fixed text-left text-[11px]">
        <colgroup>
          <col class="w-72" />
          <col />
          <col class="w-28" />
          <col class="w-14" />
          <col class="w-36" />
        </colgroup>
        <thead class="sticky top-0 bg-muted text-muted-foreground">
          <tr class="border-b border-border">
            <th scope="col" class="px-2 py-1 font-medium">原因种类</th>
            <th scope="col" class="px-2 py-1 font-medium">说明</th>
            <th scope="col" class="px-2 py-1 font-medium">分类</th>
            <th scope="col" class="px-2 py-1 font-medium">级别</th>
            <th scope="col" class="px-2 py-1 text-right font-medium">行数</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items"
            :key="item.reason_kind"
            class="cursor-pointer border-b border-border/60 hover:bg-muted/60"
            :class="selected === item.reason_kind ? 'bg-sky-50 shadow-[inset_2px_0_0_theme(colors.sky.600)]' : ''"
            data-testid="rvm-store-reason-row"
            :data-reason="item.reason_kind"
            @click="toggle(item.reason_kind)">
            <td class="truncate px-2 py-1">
              <button type="button"
                class="text-left font-medium text-foreground underline-offset-2 hover:underline"
                :aria-pressed="selected === item.reason_kind"
                @click.stop="toggle(item.reason_kind)">
                {{ reasonKindInfo(item.reason_kind).label }}
              </button>
              <span class="ml-1.5 font-mono text-[10px] text-muted-foreground">{{ item.reason_kind }}</span>
            </td>
            <td class="truncate px-2 py-1 text-muted-foreground" :title="reasonKindInfo(item.reason_kind).hint">
              {{ reasonKindInfo(item.reason_kind).hint || '—' }}
            </td>
            <td class="truncate px-2 py-1" :title="categories(item)">{{ categories(item) }}</td>
            <td class="px-2 py-1">
              <span class="whitespace-nowrap rounded border px-1 py-0.5" :class="severityInfo(item.severity).chip">{{ severityInfo(item.severity).label }}</span>
            </td>
            <td class="px-2 py-1">
              <div class="flex items-center justify-end gap-2">
                <span class="h-1.5 w-16 overflow-hidden rounded bg-muted" aria-hidden="true">
                  <span class="block h-full rounded bg-foreground/50" :style="{ width: share(item.n) }" />
                </span>
                <span class="w-10 text-right text-[10px] text-muted-foreground">{{ percent(item.n) }}</span>
                <span class="w-12 text-right font-mono">{{ item.n.toLocaleString('zh-CN') }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>
