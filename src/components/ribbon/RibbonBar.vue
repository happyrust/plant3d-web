<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { emitCommand } from '@/ribbon/commandBus';
import { RIBBON_TABS } from '@/ribbon/ribbonConfig';
import { ribbonIcons, type RibbonIconName } from '@/ribbon/ribbonIcons';
import { onToast } from '@/ribbon/toastBus';

const activeTabId = ref(RIBBON_TABS[0]?.id ?? '');
const collapsed = ref(false);

const activeTab = computed(() => {
  return RIBBON_TABS.find((t) => t.id === activeTabId.value) ?? RIBBON_TABS[0];
});

function toggleCollapse() {
  collapsed.value = !collapsed.value;
}

defineExpose({ collapsed });

const snackbarOpen = ref(false);
const snackbarText = ref('');

let offToast: (() => void) | null = null;

onMounted(() => {
  offToast = onToast(({ message }) => {
    snackbarText.value = message;
    snackbarOpen.value = true;
  });
});

onUnmounted(() => {
  if (offToast) offToast();
  offToast = null;
});

function onClickCommand(commandId: string) {
  console.log('[RibbonBar] onClickCommand:', commandId);
  emitCommand(commandId);
}

function resolveIcon(name?: string) {
  if (!name) return null;
  return ribbonIcons[name as RibbonIconName] ?? null;
}
</script>

<template>
  <div class="ribbon-root">
    <!-- Tab Header -->
    <div class="ribbon-tab-header">
      <button v-for="tab in RIBBON_TABS"
        :key="tab.id"
        type="button"
        class="ribbon-tab-btn"
        :class="{ 'ribbon-tab-btn--active': tab.id === activeTabId }"
        @click="activeTabId = tab.id">
        {{ tab.label }}
      </button>
      <!-- Spacer to push collapse button to the right -->
      <div class="ribbon-tab-spacer" />
      <!-- Collapse/Expand Button -->
      <button type="button" class="ribbon-collapse-btn" :title="collapsed ? '展开' : '折叠'" @click="toggleCollapse">
        <component :is="collapsed ? ribbonIcons.chevron_down : ribbonIcons.chevron_up" class="ribbon-collapse-icon" />
      </button>
    </div>

    <!-- Tab Content Panel -->
    <div v-show="!collapsed" class="ribbon-content-panel">
      <div v-for="group in activeTab?.groups"
        :key="group.id"
        class="ribbon-group">
        <!-- Group Content -->
        <div class="ribbon-group__content">
          <template v-for="item in group.items" :key="item.id">
            <!-- Large Button -->
            <button v-if="item.kind === 'button'"
              type="button"
              class="ribbon-btn ribbon-btn--large"
              :disabled="item.disabled"
              @click="onClickCommand(item.commandId)">
              <component :is="resolveIcon(item.icon)" v-if="item.icon" class="ribbon-btn__icon--large" />
              <span class="ribbon-btn__text--large">{{ item.label }}</span>
            </button>

            <!-- Stack (small buttons) -->
            <div v-else-if="item.kind === 'stack'" class="ribbon-stack">
              <button v-for="sub in item.items"
                :key="sub.id"
                type="button"
                class="ribbon-btn ribbon-btn--small"
                :disabled="sub.disabled"
                @click="onClickCommand(sub.commandId)">
                <component :is="resolveIcon(sub.icon)" v-if="sub.icon" class="ribbon-btn__icon--small" />
                <span class="ribbon-btn__text--small">{{ sub.label }}</span>
              </button>
            </div>

            <!-- Separator -->
            <div v-else-if="item.kind === 'separator'" class="ribbon-separator" />
          </template>
        </div>
        <!-- Group Label -->
        <div class="ribbon-group__label">{{ group.label }}</div>
      </div>
    </div>

    <v-snackbar v-model="snackbarOpen" timeout="1800">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.ribbon-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  background-color: hsl(var(--background));
  border-bottom: 1px solid hsl(var(--border));
}

/* Tab Header */
.ribbon-tab-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0 4px;
  gap: 2px;
}

.ribbon-tab-btn {
  position: relative;
  padding: 6px 16px;
  font-size: 13px;
  color: hsl(var(--foreground));
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
}

.ribbon-tab-btn:hover {
  background-color: hsl(var(--muted));
}

.ribbon-tab-btn--active {
  font-weight: 600;
}

.ribbon-tab-btn--active::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 2px;
  background-color: hsl(var(--primary));
}

/* Spacer to push collapse button to the right */
.ribbon-tab-spacer {
  flex: 1;
}

/* Collapse/Expand Button */
.ribbon-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  margin-right: 4px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
}

.ribbon-collapse-btn:hover {
  background-color: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.ribbon-collapse-icon {
  width: 16px;
  height: 16px;
}

/* Content Panel */
.ribbon-content-panel {
  display: flex;
  flex-direction: row;
  overflow-x: auto;
  background-color: hsl(var(--background));
  border-top: 1px solid hsl(var(--border));
}

.ribbon-content-panel::-webkit-scrollbar {
  height: 6px;
}

.ribbon-content-panel::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground));
  border-radius: 5px;
}

/* Group */
.ribbon-group {
  position: relative;
  display: grid;
  grid-template-rows: 1fr auto;
  justify-items: center;
  flex-shrink: 0;
  padding: 0 8px;
}

.ribbon-group::after {
  content: "";
  position: absolute;
  right: 0;
  top: 8px;
  bottom: 8px;
  width: 1px;
  background-color: hsl(var(--border));
}

.ribbon-group:last-child::after {
  display: none;
}

.ribbon-group__content {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 72px;
  gap: 4px;
  padding: 4px 0;
}

.ribbon-group__label {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  padding: 2px 4px 4px;
  text-align: center;
}

/* Large Button */
.ribbon-btn--large {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  min-width: 48px;
  max-width: 72px;
  height: auto;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  gap: 4px;
}

.ribbon-btn--large:hover {
  background-color: hsl(var(--muted));
}

.ribbon-btn--large:active {
  background-color: hsl(var(--accent));
}

.ribbon-btn--large:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ribbon-btn__icon--large {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

.ribbon-btn__text--large {
  font-size: 11px;
  color: hsl(var(--foreground));
  text-align: center;
  white-space: normal;
  word-break: break-word;
  line-height: 1.2;
}

/* Stack */
.ribbon-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Small Button */
.ribbon-btn--small {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 4px 8px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  gap: 6px;
}

.ribbon-btn--small:hover {
  background-color: hsl(var(--muted));
}

.ribbon-btn--small:active {
  background-color: hsl(var(--accent));
}

.ribbon-btn--small:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ribbon-btn__icon--small {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.ribbon-btn__text--small {
  font-size: 12px;
  color: hsl(var(--foreground));
  white-space: nowrap;
}

/* Separator */
.ribbon-separator {
  width: 1px;
  height: 48px;
  margin: 0 4px;
  background-color: hsl(var(--border));
}
</style>
