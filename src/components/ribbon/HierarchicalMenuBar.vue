<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { emitCommand } from '@/ribbon/commandBus';
import { buildHierarchicalMenuTabs } from '@/ribbon/hierarchicalMenu';
import { RIBBON_TABS } from '@/ribbon/ribbonConfig';
import { ribbonIcons, type RibbonIconName } from '@/ribbon/ribbonIcons';
import { onToast, type ToastLevel } from '@/ribbon/toastBus';

const menuTabs = computed(() => buildHierarchicalMenuTabs(RIBBON_TABS));
const activeTabId = ref(menuTabs.value[0]?.id ?? '');
const openTabId = ref<string | null>(null);

const activeTab = computed(() => {
  return menuTabs.value.find((tab) => tab.id === activeTabId.value) ?? menuTabs.value[0] ?? null;
});

const snackbarOpen = ref(false);
const snackbarText = ref('');
const snackbarColor = ref<string>('surface-variant');
const snackbarTimeout = ref(2200);

function mapToastLevel(level: ToastLevel | undefined): { color: string; timeout: number } {
  switch (level) {
    case 'success':
      return { color: 'success', timeout: 2200 };
    case 'warning':
      return { color: 'warning', timeout: 4500 };
    case 'error':
      return { color: 'error', timeout: 6000 };
    default:
      return { color: 'primary', timeout: 2200 };
  }
}

let offToast: (() => void) | null = null;

onMounted(() => {
  offToast = onToast(({ message, level }) => {
    const m = mapToastLevel(level);
    snackbarColor.value = m.color;
    snackbarTimeout.value = m.timeout;
    snackbarText.value = message;
    snackbarOpen.value = true;
  });
});

onUnmounted(() => {
  if (offToast) offToast();
  offToast = null;
});

function resolveIcon(name?: string) {
  if (!name) return null;
  return ribbonIcons[name as RibbonIconName] ?? null;
}

function openTab(tabId: string) {
  activeTabId.value = tabId;
  openTabId.value = tabId;
}

function closeMenu(tabId?: string) {
  if (!tabId || openTabId.value === tabId) {
    openTabId.value = null;
  }
}

function toggleTab(tabId: string) {
  if (openTabId.value === tabId) {
    openTabId.value = null;
    activeTabId.value = tabId;
    return;
  }
  openTab(tabId);
}

function onClickCommand(commandId: string) {
  emitCommand(commandId);
  openTabId.value = null;
}
</script>

<template>
  <div class="hierarchical-menu-root">
    <div class="hierarchical-menu-bar">
      <div class="hierarchical-menu-tabs" role="menubar">
        <div v-for="tab in menuTabs"
          :key="tab.id"
          class="hierarchical-menu-tab"
          :data-hierarchical-tab="tab.id"
          @mouseenter="openTab(tab.id)"
          @mouseleave="closeMenu(tab.id)">
          <button type="button"
            class="hierarchical-menu-tab__trigger"
            :class="{ 'hierarchical-menu-tab__trigger--active': activeTab?.id === tab.id }"
            :aria-expanded="openTabId === tab.id ? 'true' : 'false'"
            :data-ribbon-tab="tab.id"
            @click="toggleTab(tab.id)">
            {{ tab.label }}
          </button>

          <div v-if="openTabId === tab.id"
            class="hierarchical-menu-dropdown">
            <section v-for="group in tab.groups"
              :key="group.id"
              class="hierarchical-menu-group">
              <div class="hierarchical-menu-group__label">{{ group.label }}</div>
              <button v-for="command in group.commands"
                :key="command.id"
                type="button"
                class="hierarchical-menu-item"
                :data-command="command.commandId"
                :disabled="command.disabled"
                @click="onClickCommand(command.commandId)">
                <component :is="resolveIcon(command.icon)" v-if="command.icon" class="hierarchical-menu-item__icon" />
                <span class="hierarchical-menu-item__text">{{ command.label }}</span>
              </button>
            </section>
          </div>
        </div>
      </div>

      <div class="hierarchical-menu-actions">
        <slot name="header-right" />
      </div>
    </div>

    <v-snackbar v-model="snackbarOpen" :timeout="snackbarTimeout" :color="snackbarColor" multi-line>
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.hierarchical-menu-root {
  display: flex;
  width: 100%;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 0.92), rgb(244 247 251 / 0.94)),
    hsl(var(--background));
  border-bottom: 1px solid rgb(148 163 184 / 0.28);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.7);
}

.hierarchical-menu-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 46px;
  padding: 0 10px 0 8px;
  gap: 16px;
}

.hierarchical-menu-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.hierarchical-menu-tab {
  position: relative;
}

.hierarchical-menu-tab__trigger {
  position: relative;
  height: 30px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: rgb(30 41 59);
  cursor: pointer;
  font-size: 12px;
  letter-spacing: 0.01em;
  transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}

.hierarchical-menu-tab__trigger:hover {
  background: rgb(226 232 240 / 0.7);
  border-color: rgb(203 213 225 / 0.95);
}

.hierarchical-menu-tab__trigger--active {
  background: linear-gradient(180deg, rgb(255 255 255), rgb(235 241 247));
  border-color: rgb(186 200 214);
  color: rgb(15 23 42);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.8);
}

.hierarchical-menu-tab__trigger--active::after {
  content: '';
  position: absolute;
  inset: auto 8px -7px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgb(37 99 235), rgb(14 165 233));
}

.hierarchical-menu-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 40;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 14px;
  min-width: 420px;
  max-width: min(82vw, 760px);
  padding: 12px 12px 10px;
  border: 1px solid rgb(191 219 254 / 0.9);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 0.98), rgb(245 248 252 / 0.98)),
    hsl(var(--background));
  box-shadow:
    0 18px 50px rgb(15 23 42 / 0.18),
    0 2px 6px rgb(15 23 42 / 0.08);
}

.hierarchical-menu-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding-left: 1px;
}

.hierarchical-menu-group + .hierarchical-menu-group {
  position: relative;
}

.hierarchical-menu-group + .hierarchical-menu-group::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 2px;
  bottom: 2px;
  width: 1px;
  background: linear-gradient(180deg, transparent, rgb(203 213 225), transparent);
}

.hierarchical-menu-group__label {
  padding: 2px 8px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(100 116 139);
}

.hierarchical-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: rgb(15 23 42);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease, transform 0.14s ease;
}

.hierarchical-menu-item:hover {
  background: linear-gradient(180deg, rgb(239 246 255), rgb(226 232 240));
  border-color: rgb(186 230 253);
  transform: translateX(1px);
}

.hierarchical-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hierarchical-menu-item__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.hierarchical-menu-item__text {
  font-size: 12px;
  line-height: 1.2;
}

.hierarchical-menu-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

@media (max-width: 960px) {
  .hierarchical-menu-bar {
    flex-wrap: wrap;
    align-items: stretch;
    padding-top: 6px;
    padding-bottom: 6px;
  }

  .hierarchical-menu-tabs {
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .hierarchical-menu-dropdown {
    position: fixed;
    left: 12px;
    right: 12px;
    top: 56px;
    min-width: auto;
    max-width: none;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .hierarchical-menu-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
