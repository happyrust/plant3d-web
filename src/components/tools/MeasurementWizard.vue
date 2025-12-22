<script setup lang="ts">
import { computed } from 'vue';
import { useToolStore } from '@/composables/useToolStore';
import { useXeokitTools } from '@/composables/useXeokitTools';

const store = useToolStore();
// We assume useXeokitTools is available or can be injected/imported correctly.
// Since useXeokitTools usually requires viewerRef, here we might just need to rely on store
// or we need to pass the status via props or store.
// Alternatively, we can inspect the status text from the store if we expose it there, 
// but looking at existing code, statusText is in useXeokitTools.
// For the wizard, we mainly need the step information. 
// We can infer the step from `pointToRefnoStart` presence, but `pointToRefnoStart` is local to useXeokitTools.
// However, the `statusText` in `useXeokitTools` already describes the step.
// Let's pass the status text as a prop or rely on a store state if we had one.
//
// To make it self-contained without prop drilling too much, let's assume the parent 
// passes the current status text or we use a store value. 
// But looking at the requirement: "Floating wizard".
// Let's create a component that shows the current instruction and a cancel button.

const props = defineProps<{
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
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ruler-combined"><path d="M21 21v-4"/><path d="M21 17h-3"/><path d="M21 12v5"/><path d="M21 7v5"/><path d="M21 12h-3"/><path d="M12 21v-4"/><path d="M12 17h-3"/><path d="M12 12v5"/><path d="M12 7v5"/><path d="M12 12h-3"/><path d="M21 7h-3"/><path d="M21 2v5"/><path d="M21 2H3v9"/><path d="M3 11v9h9"/></svg>
      </div>
      <span class="wizard-title">点到面测量</span>
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
.measurement-wizard-card {
  position: absolute;
  top: 80px; /* Below Ribbon */
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  
  display: flex;
  flex-direction: column;
  gap: 8px;
  
  background-color: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 12px 16px;
  min-width: 300px;
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
