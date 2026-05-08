<script setup lang="ts">
import { computed, ref } from 'vue';

import { Crosshair, Eye } from 'lucide-vue-next';

import type { CollisionItem } from '@/api/reviewApi';

const props = defineProps<{
  items: CollisionItem[];
  total: number;
}>();

const emit = defineEmits<{
  (e: 'locate', item: CollisionItem): void;
  (e: 'highlight', item: CollisionItem): void;
}>();

const expandedIndex = ref<number | null>(null);

function toggleExpand(idx: number) {
  expandedIndex.value = expandedIndex.value === idx ? null : idx;
}

// 根据 ErrorStatus 返回对应的样式
function getStatusStyle(status: string) {
  switch (status?.toLowerCase()) {
    case 'new':
    case '新':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    case 'resolved':
    case '已解决':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    case 'ignored':
    case '已忽略':
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    default:
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300';
  }
}

const displayItems = computed(() => props.items);
</script>

<template>
  <div class="space-y-1">
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>共 {{ total }} 条碰撞记录</span>
      <span>显示 {{ displayItems.length }} 条</span>
    </div>

    <div v-if="displayItems.length === 0" class="py-2 text-center text-xs text-muted-foreground">
      无碰撞数据
    </div>

    <div v-for="(item, idx) in displayItems" :key="idx"
      class="rounded-md border border-border bg-background text-xs">
      <!-- 摘要行 -->
      <div class="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-muted/50"
        @click="toggleExpand(idx)">
        <span :class="['inline-block rounded px-1.5 py-0.5 text-[10px] font-medium', getStatusStyle(item.ErrorStatus)]">
          {{ item.ErrorStatus || '未知' }}
        </span>
        <span class="flex-1 truncate font-medium">
          {{ item.ObjectOne }}
          <span class="text-muted-foreground">⇔</span>
          {{ item.ObjectTow }}
        </span>
        <div class="flex gap-1">
          <button type="button"
            class="rounded p-1 hover:bg-muted"
            title="定位到碰撞位置"
            @click.stop="emit('locate', item)">
            <Crosshair class="h-3.5 w-3.5 text-blue-600" />
          </button>
          <button type="button"
            class="rounded p-1 hover:bg-muted"
            title="高亮碰撞构件"
            @click.stop="emit('highlight', item)">
            <Eye class="h-3.5 w-3.5 text-orange-600" />
          </button>
        </div>
      </div>

      <!-- 展开详情 -->
      <div v-if="expandedIndex === idx"
        class="border-t border-border px-2 py-1.5 space-y-1 bg-muted/20">
        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <span class="text-muted-foreground">对象1:</span>
          <span>{{ item.ObjectOne }} ({{ item.ObjectOneLoc }})</span>
          <span class="text-muted-foreground">对象2:</span>
          <span>{{ item.ObjectTow }} ({{ item.ObjectTowLoc }})</span>
          <span class="text-muted-foreground">专业1:</span>
          <span>{{ item.ObjectOneMajor }}</span>
          <span class="text-muted-foreground">专业2:</span>
          <span>{{ item.ObjectTwoMajor }}</span>
          <span class="text-muted-foreground">错误描述:</span>
          <span class="text-red-600">{{ item.ErrorMsg }}</span>
          <span class="text-muted-foreground">检查人:</span>
          <span>{{ item.CheckUsr }} ({{ item.CheckDate }})</span>
          <template v-if="item.UpUsr">
            <span class="text-muted-foreground">更新人:</span>
            <span>{{ item.UpUsr }} ({{ item.UpTime }})</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
