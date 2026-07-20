<script setup lang="ts">
import { Camera } from 'lucide-vue-next';

import type { AnnotationScreenshot } from '@/types/auth';

defineProps<{
  screenshot?: AnnotationScreenshot | null;
  canCapture: boolean;
  capturing: boolean;
  uploadProgress: number;
}>();

defineEmits<(e: 'capture') => void>();
</script>

<template>
  <!-- 代表截图：有则显示，hover 显示「重拍」角标；无且可拍则显示虚线「添加截图」入口 -->
  <div v-if="screenshot?.url"
    data-testid="annotation-shot-card"
    class="group relative mt-2 overflow-hidden rounded border border-border"
    style="height: 120px;">
    <img :src="screenshot.url" alt="批注截图" class="h-full w-full object-cover" />
    <div v-if="capturing"
      class="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/55 px-4 text-white">
      <div class="text-xs font-semibold">{{ uploadProgress > 0 ? `${uploadProgress}%` : '截图上传中…' }}</div>
      <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/25">
        <div class="h-full rounded-full bg-white transition-all"
          :style="{ width: `${Math.max(uploadProgress, 8)}%` }" />
      </div>
    </div>
    <button v-if="canCapture" type="button"
      data-testid="annotation-shot-retake"
      class="absolute right-1 top-1 flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[11px] text-slate-900 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
      :disabled="capturing"
      title="重新截图"
      @click.stop="$emit('capture')">
      <Camera class="h-3 w-3" />
      <span>{{ capturing ? '截图中…' : '重拍' }}</span>
    </button>
  </div>
  <button v-else-if="canCapture" type="button"
    data-testid="annotation-shot-capture"
    class="mt-2 flex h-[80px] w-full flex-col items-center justify-center gap-2 rounded border border-dashed border-slate-300 text-xs text-muted-foreground hover:border-brand/40 hover:bg-brand-subtle hover:text-brand"
    :disabled="capturing"
    @click.stop="$emit('capture')">
    <span class="inline-flex items-center gap-2">
      <Camera class="h-3.5 w-3.5" />
      <span>{{ capturing ? '正在截图…' : '添加截图 · 记录当前视角' }}</span>
    </span>
    <span v-if="capturing" class="w-40 overflow-hidden rounded-full bg-slate-200">
      <span class="block h-1.5 rounded-full bg-brand transition-all"
        :style="{ width: `${Math.max(uploadProgress, 8)}%` }" />
    </span>
  </button>
</template>
