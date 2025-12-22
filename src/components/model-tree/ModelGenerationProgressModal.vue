<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  open: boolean;
  progress: number;
  status: string;
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const progressStyle = computed(() => ({
  width: `${Math.max(0, Math.min(100, props.progress))}%`
}));
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
          <span v-if="!error" class="text-sm font-medium">{{ Math.round(progress) }}%</span>
        </div>
        
        <div v-if="!error">
          <div class="mb-2 flex justify-between text-sm text-muted-foreground">
            <span>{{ status }}</span>
          </div>
          
          <!-- Progress Bar -->
          <div class="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div class="h-full bg-primary transition-all duration-300 ease-out" 
              :style="progressStyle">
            </div>
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
