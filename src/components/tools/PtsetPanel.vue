<script setup lang="ts">
import { computed } from 'vue';
import { Eye, EyeOff, X, MapPin, Tag, ArrowRight, Focus } from 'lucide-vue-next';

import Badge from '@/components/ui/Badge.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';

const props = defineProps<{
  refno: string | null;
  response: PtsetResponse | null;
  isVisible: boolean;
  showCrosses: boolean;
  showLabels: boolean;
  showArrows: boolean;
}>();

const emit = defineEmits<{
  close: [];
  toggleVisible: [visible: boolean];
  toggleCrosses: [visible: boolean];
  toggleLabels: [visible: boolean];
  toggleArrows: [visible: boolean];
  flyTo: [];
}>();

const points = computed(() => {
  if (!props.response?.success) return [];
  return props.response.ptset;
});

const unitInfo = computed(() => {
  return props.response?.unit_info;
});

function formatCoord(pt: [number, number, number], factor: number = 1): string {
  return `(${(pt[0] * factor).toFixed(1)}, ${(pt[1] * factor).toFixed(1)}, ${(pt[2] * factor).toFixed(1)})`;
}

function formatDir(dir: [number, number, number] | null): string {
  if (!dir) return '-';
  return `(${dir[0].toFixed(2)}, ${dir[1].toFixed(2)}, ${dir[2].toFixed(2)})`;
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 头部 -->
    <div class="flex-shrink-0 border-b border-border px-3 py-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-foreground">点集数据</span>
        <div class="flex items-center gap-2">
          <Badge v-if="refno" variant="outline" class="font-mono text-[10px]">
            {{ refno }}
          </Badge>
          <button
            v-if="refno"
            type="button"
            class="rounded p-0.5 hover:bg-muted"
            title="关闭"
            @click="emit('close')"
          >
            <X class="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!refno || !response" class="flex flex-1 items-center justify-center">
      <span class="text-xs text-muted-foreground">未加载点集</span>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="!response.success" class="flex flex-1 items-center justify-center p-3">
      <div class="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {{ response.error_message || '加载失败' }}
      </div>
    </div>

    <!-- 内容 -->
    <template v-else>
      <!-- 控制栏 -->
      <div class="flex-shrink-0 border-b border-border px-2 py-1.5">
        <div class="flex items-center gap-1">
          <!-- 整体显示开关 -->
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors"
            :class="isVisible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
            :title="isVisible ? '隐藏点集' : '显示点集'"
            @click="emit('toggleVisible', !isVisible)"
          >
            <component :is="isVisible ? Eye : EyeOff" class="h-3.5 w-3.5" />
            <span>{{ isVisible ? '显示' : '隐藏' }}</span>
          </button>

          <div class="mx-1 h-4 w-px bg-border" />

          <!-- 十字星显示 -->
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded transition-colors"
            :class="showCrosses ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'"
            :disabled="!isVisible"
            title="显示/隐藏标记点"
            @click="emit('toggleCrosses', !showCrosses)"
          >
            <MapPin class="h-3.5 w-3.5" />
          </button>

          <!-- 标签显示 -->
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded transition-colors"
            :class="showLabels ? 'bg-blue-500/10 text-blue-600' : 'bg-muted text-muted-foreground'"
            :disabled="!isVisible"
            title="显示/隐藏坐标标签"
            @click="emit('toggleLabels', !showLabels)"
          >
            <Tag class="h-3.5 w-3.5" />
          </button>

          <!-- 箭头显示 -->
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded transition-colors"
            :class="showArrows ? 'bg-orange-500/10 text-orange-600' : 'bg-muted text-muted-foreground'"
            :disabled="!isVisible"
            title="显示/隐藏方向箭头"
            @click="emit('toggleArrows', !showArrows)"
          >
            <ArrowRight class="h-3.5 w-3.5" />
          </button>

          <div class="mx-1 h-4 w-px bg-border" />

          <!-- 飞行到视图 -->
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded bg-muted transition-colors hover:bg-accent"
            title="飞行到点集视图"
            @click="emit('flyTo')"
          >
            <Focus class="h-3.5 w-3.5" />
          </button>
        </div>

        <!-- 统计信息 -->
        <div class="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{{ points.length }} 个连接点</span>
          <span v-if="unitInfo">| 单位: {{ unitInfo.target_unit }}</span>
        </div>
      </div>

      <!-- 点集列表 -->
      <ScrollArea class="min-h-0 flex-1">
        <div class="divide-y divide-border/50">
          <div
            v-for="point in points"
            :key="point.number"
            class="px-3 py-2 hover:bg-accent/50"
          >
            <!-- 点编号行 -->
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-green-600">#{{ point.number }}</span>
              <Badge v-if="point.pbore > 0" variant="secondary" class="text-[10px]">
                {{ unitInfo ? `Ø${(point.pbore * (unitInfo.conversion_factor || 1)).toFixed(1)}${unitInfo.target_unit}` : `Ø${point.pbore.toFixed(1)}` }}
              </Badge>
            </div>

            <!-- 坐标 -->
            <div class="mt-1 text-[11px] text-muted-foreground">
              <span class="text-foreground/70">位置:</span>
              {{ formatCoord(point.pt, unitInfo?.conversion_factor || 1) }}
            </div>

            <!-- 方向 -->
            <div v-if="point.dir" class="mt-0.5 text-[11px] text-muted-foreground">
              <span class="text-foreground/70">方向:</span>
              {{ formatDir(point.dir) }}
            </div>
          </div>
        </div>
      </ScrollArea>
    </template>
  </div>
</template>
