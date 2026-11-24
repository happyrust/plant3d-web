<script setup lang="ts">
/**
 * 终态及个数的一排标签，没过的排在前面。
 * `clickable` 时每个标签是按钮；再加 `withAll` 就是一组筛选（带「全部」，再点一次已选的取消）。
 */
import { computed } from 'vue';

import { verdictTone } from './rvmCheckFormat';
import RvmStatusIcon from './RvmStatusIcon.vue';
import { statusCounts } from './rvmStoreFormat';

const props = withDefaults(defineProps<{
  status: Record<string, number> | null | undefined;
  clickable?: boolean;
  withAll?: boolean;
  selected?: string | null;
  /** 「全部」上的总数；不给就用各终态之和 */
  total?: number;
}>(), { clickable: false, withAll: false, selected: null, total: undefined });

const emit = defineEmits<{ select: [status: string | null] }>();

const items = computed(() => statusCounts(props.status));
const sum = computed(() => props.total ?? items.value.reduce((count, item) => count + item.count, 0));

const chip = 'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px]';

function pick(status: string): void {
  emit('select', props.withAll && props.selected === status ? null : status);
}
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1" data-testid="rvm-store-status-chips">
    <button v-if="withAll" type="button"
      :class="[chip, !selected ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted']"
      :aria-pressed="!selected"
      data-testid="rvm-store-status-all"
      @click="emit('select', null)">
      全部 {{ sum }}
    </button>
    <template v-for="item in items" :key="item.status">
      <button v-if="clickable" type="button"
        :class="[chip, verdictTone(item.tone).chip, 'hover:brightness-95', selected === item.status ? 'ring-1 ring-foreground/60' : '']"
        :title="item.hint"
        :aria-pressed="withAll ? selected === item.status : undefined"
        :data-status="item.status"
        data-testid="rvm-store-status-chip"
        @click.stop="pick(item.status)">
        <RvmStatusIcon :verdict="item.tone" />
        {{ item.label }} {{ item.count }}
      </button>
      <span v-else :class="[chip, verdictTone(item.tone).chip]" :title="item.hint" :data-status="item.status" data-testid="rvm-store-status-chip">
        <RvmStatusIcon :verdict="item.tone" />
        {{ item.label }} {{ item.count }}
      </span>
    </template>
  </span>
</template>
