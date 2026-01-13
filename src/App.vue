<script setup lang="ts">
import { ref } from 'vue';

import DockLayout from '@/components/DockLayout.vue';
import RibbonBar from '@/components/ribbon/RibbonBar.vue';
import UserAvatar from '@/components/user/UserAvatar.vue';

// 固定高度，不再随展开缩放
const extensionHeight = 32;

const urlParams = new URLSearchParams(window.location.search);
const showBenchmark = urlParams.get('benchmark') === 'true';
</script>

<template>
  <v-app class="h-screen">
    <v-app-bar
      class="ribbon-app-bar"
      :height="0"
      :extension-height="extensionHeight"
    >
      <template #extension>
        <div class="flex items-center w-full">
          <RibbonBar class="flex-1" />
          <div class="px-2">
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
