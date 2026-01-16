<script setup lang="ts">
import { computed, ref } from 'vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';

import DockLayout from '@/components/DockLayout.vue';
import RibbonBar from '@/components/ribbon/RibbonBar.vue';
import UserAvatar from '@/components/user/UserAvatar.vue';

const ribbonBarRef = ref<InstanceType<typeof RibbonBar> | null>(null);
const ribbonCollapsed = computed(() => ribbonBarRef.value?.collapsed ?? false);

// 展开时高度 = tab header (32px) + content panel (约 92px)
// 折叠时高度 = tab header (32px)
const extensionHeight = computed(() => (ribbonCollapsed.value ? 32 : 124));

const urlParams = new URLSearchParams(window.location.search);
const showBenchmark = urlParams.get('benchmark') === 'true';
</script>

<template>
  <v-app class="h-screen">
    <ConfirmDialog />
    <v-app-bar
      class="ribbon-app-bar"
      :height="0"
      :extension-height="extensionHeight"
    >
      <template #extension>
        <div class="flex items-start w-full">
          <RibbonBar ref="ribbonBarRef" class="flex-1" />
          <div class="px-2 h-8 flex items-center">
            <UserAvatar />
          </div>
        </div>
      </template>
    </v-app-bar>

    <v-main class="flex-1 min-h-0 d-flex flex-row">
      <div v-if="showBenchmark" style="width: 400px; border-right: 1px solid #333; overflow: hidden;">
        <BenchmarkView />
      </div>
      <div class="flex-1 min-h-0">
        <DockLayout />
      </div>
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
