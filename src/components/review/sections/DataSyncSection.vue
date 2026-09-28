<script setup lang="ts">
import { ref } from 'vue';

import { Download, Upload, Database } from 'lucide-vue-next';

interface Props {
  loading?: boolean;
}

interface Emits {
  (e: 'export'): void;
  (e: 'import', file: File, overwrite: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const overwriteMode = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

function handleImportClick() {
  fileInputRef.value?.click();
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    emit('import', file, overwriteMode.value);
    input.value = '';
  }
}
</script>

<template>
  <div class="data-sync-section border-b border-gray-200 bg-white p-4">
    <div class="mb-3 flex items-center gap-2">
      <Database class="h-5 w-5 text-gray-600" />
      <h4 class="text-sm font-medium text-gray-700">数据同步</h4>
    </div>

    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <button type="button"
          :disabled="loading"
          class="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          @click="emit('export')">
          <Download class="mr-1.5 h-4 w-4" />
          导出
        </button>

        <button type="button"
          :disabled="loading"
          class="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          @click="handleImportClick">
          <Upload class="mr-1.5 h-4 w-4" />
          导入
        </button>

        <input ref="fileInputRef"
          type="file"
          accept=".json"
          class="hidden"
          @change="handleFileChange" />
      </div>

      <label class="flex items-center gap-2 text-xs text-gray-600">
        <input v-model="overwriteMode"
          type="checkbox"
          class="rounded border-gray-300" />
        导入时覆盖现有数据
      </label>
    </div>
  </div>
</template>
