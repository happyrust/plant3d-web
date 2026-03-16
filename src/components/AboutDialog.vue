<template>
  <v-dialog v-model="dialog" max-width="500">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon="mdi-information-outline" size="small" />
    </template>
    <v-card>
      <v-card-title>About</v-card-title>
      <v-card-text>
        <div class="mb-4">
          <h3 class="text-subtitle-1 font-weight-bold">Frontend</h3>
          <div class="text-body-2">Version: {{ frontendVersion.version }}</div>
          <div class="text-body-2">Commit: {{ frontendVersion.commit }}</div>
          <div class="text-body-2">Build Date: {{ frontendVersion.buildDate }}</div>
        </div>
        <div>
          <h3 class="text-subtitle-1 font-weight-bold">Backend</h3>
          <div class="text-body-2">Version: {{ backendVersion.version }}</div>
          <div class="text-body-2">Commit: {{ backendVersion.commit }}</div>
          <div class="text-body-2">Build Date: {{ backendVersion.buildDate }}</div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="dialog = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

import { getDefaultFrontendVersion, loadVersionInfo, UNKNOWN_VERSION_INFO } from '@/utils/versionInfo';

const dialog = ref(false);
const frontendVersion = ref(getDefaultFrontendVersion());
const backendVersion = ref(UNKNOWN_VERSION_INFO);

onMounted(async () => {
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
});
</script>
