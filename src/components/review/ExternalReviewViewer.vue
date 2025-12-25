<template>
  <v-dialog
    v-model="dialog"
    fullscreen
    hide-overlay
    transition="dialog-bottom-transition"
  >
    <v-card>
      <v-toolbar dark color="primary">
        <v-btn icon dark @click="dialog = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
        <v-toolbar-title>三维校审 (External Review)</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-toolbar-items>
          <v-btn dark text @click="dialog = false">完成</v-btn>
        </v-toolbar-items>
      </v-toolbar>

      <v-card-text class="pa-0 fill-height" style="height: calc(100vh - 64px);">
        <iframe
          v-if="url"
          :src="url"
          frameborder="0"
          style="width: 100%; height: 100%;"
          allow="fullscreen"
        ></iframe>
        <div v-else class="d-flex justify-center align-center fill-height">
          <v-progress-circular indeterminate color="primary"></v-progress-circular>
          <span class="ml-4">正在获取校审地址...</span>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { reviewGetEmbedUrl } from '@/api/reviewApi';
import { useUserStore } from '@/composables/useUserStore';

const props = defineProps<{
  modelValue: boolean;
  projectId: string;
}>();

const emit = defineEmits(['update:modelValue']);

const dialog = ref(props.modelValue);
const url = ref<string | null>(null);
const userStore = useUserStore();

watch(() => props.modelValue, (val) => {
  dialog.value = val;
  if (val && !url.value) {
    loadUrl();
  }
});

watch(dialog, (val) => {
  emit('update:modelValue', val);
});

async function loadUrl() {
  try {
    const userId = userStore.currentUser.value?.id || 'guest';
    const response = await reviewGetEmbedUrl(props.projectId, userId);
    url.value = response.url;
  } catch (e) {
    console.error('Failed to get review embed URL:', e);
    // Handle error (show toast, etc.)
  }
}
</script>

<style scoped>
.fill-height {
  height: 100%;
}
</style>
