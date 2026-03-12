<script setup lang="ts">
import { ref } from 'vue';

import { Download, FileText } from 'lucide-vue-next';

import { reviewSyncExport, reviewSyncImport } from '@/api/reviewApi';
import { useReviewStore } from '@/composables/useReviewStore';

const reviewStore = useReviewStore();

const syncOverwrite = ref(false);
const syncExporting = ref(false);
const syncImporting = ref(false);

async function exportFromServer() {
  syncExporting.value = true;
  try {
    const data = await reviewSyncExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review-sync-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('[ReviewDataSync] Export failed:', e);
  } finally {
    syncExporting.value = false;
  }
}

async function importFromFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  syncImporting.value = true;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await reviewSyncImport(data, syncOverwrite.value);
    // 重新加载确认记录
    if (reviewStore.currentTask.value) {
      await reviewStore.loadConfirmedRecords(reviewStore.currentTask.value.id);
    }
  } catch (e) {
    console.error('[ReviewDataSync] Import failed:', e);
  } finally {
    syncImporting.value = false;
    target.value = '';
  }
}
</script>

<template>
  <div class="rounded-md border border-border bg-background p-3">
    <div class="flex items-center justify-between">
      <div class="text-sm font-semibold">数据同步（后端）</div>
      <label class="flex items-center gap-2 text-xs text-muted-foreground">
        <input v-model="syncOverwrite" type="checkbox" />
        导入覆盖
      </label>
    </div>
    <div class="mt-2 flex gap-2">
      <button type="button"
        class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs hover:bg-muted disabled:opacity-50"
        :disabled="syncExporting"
        @click="exportFromServer">
        <Download class="h-3.5 w-3.5" />
        导出(后端)
      </button>
      <label class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs hover:bg-muted disabled:opacity-50 cursor-pointer"
        :class="{ 'opacity-50 pointer-events-none': syncImporting }">
        <FileText class="h-3.5 w-3.5" />
        导入(后端)
        <input type="file" accept="application/json" class="hidden" @change="importFromFile" />
      </label>
    </div>
    <div class="mt-2 text-xs text-muted-foreground">
      说明：导出/导入走 `/api/review/sync/export|import`，用于跨环境迁移校审数据。
    </div>
  </div>
</template>
