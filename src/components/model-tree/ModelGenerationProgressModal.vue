<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  open: boolean;
  progress: number;
  status: string;
  error?: string | null;
  /** 待生成的总数 */
  totalCount?: number;
  /** 当前正在生成的索引 (1-based) */
  currentIndex?: number;
  /** 当前正在处理的 refno */
  currentRefno?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const progressStyle = computed(() => ({
  width: `${Math.max(0, Math.min(100, props.progress))}%`
}));

/** 显示 “1/10” 格式的进度文本 */
const progressText = computed(() => {
  if (props.totalCount !== undefined && props.totalCount > 0 && props.currentIndex !== undefined) {
    return `${props.currentIndex}/${props.totalCount}`;
  }
  return `${Math.round(props.progress)}%`;
});

/** 是否显示详细进度（总数 > 0 时显示） */
const showDetailedProgress = computed(() => 
  props.totalCount !== undefined && props.totalCount > 0
);

/** 已完成数量：默认用 currentIndex-1；当 progress=100 时显示 totalCount */
const completedCount = computed(() => {
  const total = props.totalCount ?? 0;
  if (!total) return 0;
  if (props.progress >= 100) return total;
  const idx = props.currentIndex ?? 1;
  return Math.max(0, Math.min(total, idx - 1));
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" 
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all animate-in fade-in duration-200">
      <div 
        class="w-[400px] rounded-lg border border-border bg-background p-6 shadow-lg transition-all animate-in zoom-in-95 duration-200">
        
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold leading-none tracking-tight">
            {{ error ? '生成失败' : '正在生成模型' }}
          </h3>
          <span v-if="!error" class="text-sm font-medium tabular-nums">
            {{ progressText }}
          </span>
        </div>
        
        <div v-if="!error">
          <!-- 当前处理的 refno -->
          <div v-if="currentRefno" class="mb-2 truncate text-xs text-muted-foreground">
            当前: <span class="font-mono">{{ currentRefno }}</span>
          </div>
          
          <div class="mb-2 flex justify-between text-sm text-muted-foreground">
            <span>{{ status }}</span>
          </div>
          
          <!-- Progress Bar -->
          <div class="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div class="h-full bg-primary transition-all duration-300 ease-out" 
              :style="progressStyle">
            </div>
          </div>
          
          <!-- 详细进度显示 -->
          <div v-if="showDetailedProgress" class="mt-2 text-center text-xs text-muted-foreground">
            已完成 {{ completedCount }} / {{ totalCount }} 个
          </div>
        </div>

        <div v-else class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {{ error }}
        </div>

        <div v-if="error" class="mt-4 flex justify-end">
          <button 
            type="button"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            @click="emit('close')">
            关闭
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
