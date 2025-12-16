<script setup lang="ts">
import { computed, ref, type Ref } from 'vue';

import { useToolStore } from '@/composables/useToolStore';

type ToolsApi = {
  ready: Ref<boolean>;
  syncFromStore: () => void;
  clearAllInScene: () => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();

const exportText = computed(() => store.exportJSON());

const importText = ref('');
const importError = ref<string | null>(null);

async function copyExport() {
  const text = exportText.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function doImport() {
  importError.value = null;
  try {
    store.importJSON(importText.value);
    props.tools.syncFromStore();
  } catch (e) {
    importError.value = e instanceof Error ? e.message : String(e);
  }
}

function clearAll() {
  props.tools.clearAllInScene();
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">总览</div>
        <div class="text-xs text-muted-foreground">
          测量 {{ store.measurementCount }} 条 / 批注 {{ store.annotationCount }} 条
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm text-destructive hover:bg-muted"
          @click="clearAll">
          清空全部
        </button>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        清空会同时删除场景中的标记，并清除本地存储。
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">导出</div>
        <button type="button"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
          @click="copyExport">
          复制
        </button>
      </div>

      <textarea class="mt-2 min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
        readonly
        :value="exportText" />
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">导入</div>
      <textarea v-model="importText"
        class="mt-2 min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
        placeholder="粘贴 JSON 后点击导入" />

      <div v-if="importError" class="mt-2 text-sm text-destructive">
        {{ importError }}
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          @click="doImport">
          导入并同步
        </button>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        导入后会覆盖当前本地数据，并尝试同步到当前场景。
      </div>
    </div>
  </div>
</template>
