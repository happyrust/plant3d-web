<script setup lang="ts">
import { computed, ref } from 'vue';

import DockLayout from '@/components/DockLayout.vue';
import RibbonBar from '@/components/ribbon/RibbonBar.vue';

const ribbonBarRef = ref<InstanceType<typeof RibbonBar> | null>(null);

const isCollapsed = computed(() => {
  const exposed = ribbonBarRef.value as unknown as { collapsed?: { value: boolean } | boolean } | null;
  const c = exposed?.collapsed;
  return typeof c === 'boolean' ? c : (c?.value ?? false);
});

const extensionHeight = computed(() => {
  return isCollapsed.value ? 32 : 128;
});
</script>

<template>
  <v-app class="h-screen">
    <v-app-bar
      class="ribbon-app-bar"
      :height="0"
      :extension-height="extensionHeight"
    >
      <template #extension>
        <RibbonBar ref="ribbonBarRef" />
      </template>
    </v-app-bar>

    <v-main class="flex-1 min-h-0 d-flex flex-column">
      <DockLayout />
    </v-main>
  </v-app>
</template>

<style>
.ribbon-app-bar {
  transition: height 0.2s ease;
}

.ribbon-app-bar.ribbon-collapsed {
  height: 96px !important;
}

.ribbon-app-bar.ribbon-collapsed .v-toolbar__extension {
  height: 32px !important;
  min-height: 32px !important;
}
</style>
