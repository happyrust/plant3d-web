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
 * 顶部居中挂在查看器容器（.viewer-panel-container，position: relative; overflow: hidden）里：
 * left/right 各留 12px、width: fit-content + margin auto 居中，所以卡永远在容器里；宽度随 statusText
 * 长到 480px 就换行。以前没有 max-width，一句 70 字的提示把卡撑到 750px，再叠上宿主用内联
 * left: 12px 覆盖了 left 却没覆盖 translateX(-50%)，左半张卡整个画在容器外面被裁掉。
 * 位置只在这里定，宿主不要再用内联样式改 left / transform。
 */
.measurement-wizard-card {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  width: fit-content;
  min-width: min(300px, 100%);
  max-width: 480px; /* 再宽会压到右上角的导航立方 */
  margin: 0 auto;
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
