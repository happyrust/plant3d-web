<script setup lang="ts">
import { PanelLeft, PanelBottom, PanelRight } from 'lucide-vue-next';

import { isZoneCollapsed } from '@/composables/usePanelZones';
import { emitCommand } from '@/ribbon/commandBus';

const leftCollapsed = isZoneCollapsed('left');
const bottomCollapsed = isZoneCollapsed('bottom');
const rightCollapsed = isZoneCollapsed('right');

function onToggleLeft() {
  emitCommand('zone.toggleLeft');
}

function onToggleBottom() {
  emitCommand('zone.toggleBottom');
}

function onToggleRight() {
  emitCommand('zone.toggleRight');
}
</script>

<template>
  <div class="layout-toggle-group">
    <button type="button"
      class="layout-toggle-btn layout-toggle-btn--left"
      :class="{ 'layout-toggle-btn--inactive': leftCollapsed }"
      title="左侧面板"
      @click="onToggleLeft">
      <PanelLeft class="layout-toggle-icon" />
    </button>
    <button type="button"
      class="layout-toggle-btn layout-toggle-btn--bottom"
      :class="{ 'layout-toggle-btn--inactive': bottomCollapsed }"
      title="底部面板"
      @click="onToggleBottom">
      <PanelBottom class="layout-toggle-icon" />
    </button>
    <button type="button"
      class="layout-toggle-btn layout-toggle-btn--right"
      :class="{ 'layout-toggle-btn--inactive': rightCollapsed }"
      title="右侧面板"
      @click="onToggleRight">
      <PanelRight class="layout-toggle-icon" />
    </button>
  </div>
</template>

<style scoped>
.layout-toggle-group {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  overflow: hidden;
  background: hsl(var(--background));
}

.layout-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: hsl(var(--foreground));
  transition: background-color 0.15s ease, color 0.15s ease;
}

/* Vertical separators between buttons */
.layout-toggle-btn + .layout-toggle-btn {
  border-left: 1px solid hsl(var(--border));
}

.layout-toggle-btn:hover {
  background-color: hsl(var(--muted));
}

.layout-toggle-btn:active {
  background-color: hsl(var(--accent));
}

/* Inactive (collapsed) state: dimmed icon */
.layout-toggle-btn--inactive {
  color: hsl(var(--muted-foreground));
  opacity: 0.5;
}

.layout-toggle-btn--inactive:hover {
  opacity: 0.8;
  background-color: hsl(var(--muted));
}

.layout-toggle-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
</style>
