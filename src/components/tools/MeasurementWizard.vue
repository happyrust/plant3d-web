<script setup lang="ts">
import { useToolStore } from '@/composables/useToolStore';

const store = useToolStore();

const props = defineProps<{
  title?: string;
  statusText: string;
}>();

function cancel() {
  store.setToolMode('none');
}

</script>

<template>
  <div class="measurement-wizard-card">
    <div class="wizard-header">
      <div class="wizard-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ruler-combined"><path d="M21 21v-4" /><path d="M21 17h-3" /><path d="M21 12v5" /><path d="M21 7v5" /><path d="M21 12h-3" /><path d="M12 21v-4" /><path d="M12 17h-3" /><path d="M12 12v5" /><path d="M12 7v5" /><path d="M12 12h-3" /><path d="M21 7h-3" /><path d="M21 2v5" /><path d="M21 2H3v9" /><path d="M3 11v9h9" /></svg>
      </div>
      <span class="wizard-title">{{ props.title || '点到面测量' }}</span>
    </div>
    
    <div class="wizard-body">
      <div class="wizard-step-text">{{ statusText }}</div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn-cancel" @click="cancel">
        取消测量
      </button>
    </div>
  </div>
</template>

<style scoped>
/*
 * 挂在查看器容器（.viewer-panel-container，position: relative; overflow: hidden）左上角、左侧竖排工具栏右边：
 * left 64px = 工具栏 left 12px + 宽 48px + 4px 间隙（矮容器里工具栏顶到 y≈14，放 12px 会压住它顶上的按钮），
 * right 12px 兜底、width: fit-content，所以卡永远在容器里、也不碰左侧工具栏。
 * max-width 360px：右上角的空间查询 / 构件最近点抽屉在 right 56–60px、宽 336–340px，360 宽的卡从 64 起到 424，
 * 常规视口（查看器 ≳820px 宽）刚好落在工具栏与抽屉之间；statusText 长就在这 360 里折两三行。
 * 以前没有 max-width，一句 70 字的提示把卡撑到 750px，再叠上宿主用内联 left: 12px 覆盖了 left 却没覆盖
 * translateX(-50%)，左半张卡整个画在容器外面被裁掉。位置只在这里定，宿主不要再用内联样式改 left / transform。
 */
.measurement-wizard-card {
  position: absolute;
  top: 12px;
  left: 64px;
  right: 12px;
  width: fit-content;
  min-width: min(300px, calc(100% - 76px)); /* 76 = left 64 + right 12，超窄容器里也不越右边界 */
  max-width: 360px;
  z-index: 940;
  box-sizing: border-box;
  
  display: flex;
  flex-direction: column;
  gap: 8px;
  
  background-color: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 12px 16px;
}

.wizard-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid hsl(var(--border));
  color: hsl(var(--foreground));
  font-weight: 600;
  font-size: 14px;
}

.wizard-icon {
  color: hsl(var(--primary));
  display: flex;
}

.wizard-body {
  padding: 8px 0;
}

.wizard-step-text {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.wizard-footer {
  display: flex;
  justify-content: flex-end;
}

.wizard-btn-cancel {
  background-color: transparent;
  border: 1px solid hsl(var(--border));
  color: hsl(var(--foreground));
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.wizard-btn-cancel:hover {
  background-color: hsl(var(--muted));
}
</style>
