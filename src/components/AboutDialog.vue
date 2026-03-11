<template>
  <v-dialog v-model="dialog" max-width="500">
    <template v-slot:activator="{ props }">
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
import { ref, onMounted } from 'vue'

const dialog = ref(false)
const frontendVersion = ref({ version: 'unknown', commit: 'unknown', buildDate: 'unknown' })
const backendVersion = ref({ version: 'unknown', commit: 'unknown', buildDate: 'unknown' })

onMounted(async () => {
  try {
    const res = await fetch('/version.json')
    frontendVersion.value = await res.json()
  } catch (e) {
    console.warn('Failed to load frontend version', e)
  }
  
  try {
    const res = await fetch('/api/version')
    backendVersion.value = await res.json()
  } catch (e) {
    console.warn('Failed to load backend version', e)
  }
})
</script>
