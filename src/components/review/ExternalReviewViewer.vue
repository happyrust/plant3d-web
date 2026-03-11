<script setup lang="ts">
import { ref, watch } from 'vue';

import { Loader2, X } from 'lucide-vue-next';

import { reviewGetEmbedUrl } from '@/api/reviewApi';
import { useModelProjects } from '@/composables/useModelProjects';
import { useUserStore } from '@/composables/useUserStore';

const props = defineProps<{
  modelValue: boolean;
  projectId: string;
}>();

const emit = defineEmits(['update:modelValue']);

const dialog = ref(props.modelValue);
const url = ref<string | null>(null);
const loadError = ref<string | null>(null);
const userStore = useUserStore();
const { switchProjectById } = useModelProjects();

watch(() => props.modelValue, (val) => {
  dialog.value = val;
  if (val && !url.value) {
    loadUrl();
  }
});

watch(dialog, (val) => {
  emit('update:modelValue', val);
});

function handleClose() {
  dialog.value = false;
}

async function loadUrl() {
  loadError.value = null;
  try {
    // 切换到目标项目
    if (props.projectId) {
      switchProjectById(props.projectId);
    }
    
    const userId = userStore.currentUser.value?.id || 'guest';
    const response = await reviewGetEmbedUrl(props.projectId, userId);
    url.value = response.url;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '获取校审地址失败';
    console.error('Failed to get review embed URL:', e);
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="dialog"
      class="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-950">
      <!-- 顶部工具栏 -->
      <div class="flex h-14 shrink-0 items-center justify-between border-b bg-gray-50 px-4 dark:bg-gray-900">
        <div class="flex items-center gap-3">
          <span class="text-base font-semibold text-foreground">三维校审 (External Review)</span>
        </div>
        <div class="flex items-center gap-2">
          <button type="button"
            class="rounded-md border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
            @click="handleClose">
            完成
          </button>
          <button type="button"
            class="rounded-md p-1.5 hover:bg-gray-200 dark:hover:bg-gray-800"
            @click="handleClose">
            <X class="h-5 w-5 text-gray-500" />
          </button>
        </div>
      </div>

      <!-- 内容区域 -->
      <div class="flex-1">
        <iframe v-if="url"
          :src="url"
          frameborder="0"
          class="h-full w-full"
          allow="fullscreen" />
        <div v-else-if="loadError" class="flex h-full items-center justify-center">
          <div class="text-center">
            <p class="text-sm text-red-600">{{ loadError }}</p>
            <button type="button"
              class="mt-3 rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
              @click="loadUrl">
              重试
            </button>
          </div>
        </div>
        <div v-else class="flex h-full items-center justify-center">
          <Loader2 class="h-6 w-6 animate-spin text-blue-500" />
          <span class="ml-3 text-sm text-muted-foreground">正在获取校审地址...</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
