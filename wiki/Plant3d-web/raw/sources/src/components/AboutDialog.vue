<template>
  <v-dialog v-model="dialog" max-width="500">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon="mdi-information-outline" size="small" />
    </template>
    <v-card>
      <v-card-title>关于</v-card-title>
      <v-card-text>
        <div class="mb-4">
          <h3 class="text-subtitle-1 font-weight-bold">前端</h3>
          <div class="text-body-2">版本：{{ displayVersionText(frontendVersion.version) }}</div>
          <div class="text-body-2">提交：{{ displayVersionText(frontendVersion.commit) }}</div>
          <div class="text-body-2">编译日期：{{ displayVersionText(frontendVersion.buildDate) }}</div>
        </div>
        <div>
          <h3 class="text-subtitle-1 font-weight-bold">后端</h3>
          <div class="text-body-2">版本：{{ displayVersionText(backendVersion.version) }}</div>
          <div class="text-body-2">提交：{{ displayVersionText(backendVersion.commit) }}</div>
          <div class="text-body-2">编译日期：{{ displayVersionText(backendVersion.buildDate) }}</div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="dialog = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';

import { onCommand } from '@/ribbon/commandBus';
import {
  displayVersionText,
  getDefaultFrontendVersion,
  loadVersionInfo,
  UNKNOWN_VERSION_INFO,
} from '@/utils/versionInfo';

const dialog = ref(false);
const frontendVersion = ref(getDefaultFrontendVersion());
const backendVersion = ref(UNKNOWN_VERSION_INFO);

let offHelpAbout: (() => void) | null = null;

async function refreshVersionInfo() {
  try {
    const version = await loadVersionInfo('/version.json');
    if (version) {
      frontendVersion.value = version;
    }
  } catch (e) {
    console.warn('Failed to load frontend version', e);
  }

  try {
    const version = await loadVersionInfo('/api/version');
    if (version) {
      backendVersion.value = version;
    }
  } catch (e) {
    console.warn('Failed to load backend version', e);
  }
}

onMounted(() => {
  offHelpAbout = onCommand((commandId) => {
    if (commandId === 'help.about') {
      dialog.value = true;
    }
  });
  void refreshVersionInfo();
});

onUnmounted(() => {
  offHelpAbout?.();
  offHelpAbout = null;
});

watch(dialog, (open) => {
  if (open) {
    void refreshVersionInfo();
  }
});
</script>
