<script setup lang="ts">
import { ExternalLink, RotateCcw, Save } from 'lucide-vue-next';

import type { DockviewApi, DockviewPanelApi } from 'dockview-vue';

const props = defineProps<{
  params: {
    params: {
      onResetLayout?: () => void;
      onSaveLayout?: () => void;
    };
    api: DockviewPanelApi;
    containerApi: DockviewApi;
  };
}>();

function handlePopout() {
  const containerApi = props.params.containerApi;
  const toolbarGroup = containerApi.getPanel('toolbar')?.group;
  const activeGroup = containerApi.activeGroup;
  if (activeGroup && activeGroup !== toolbarGroup) {
    containerApi.addPopoutGroup(activeGroup);
  }
}

function handleSave() {
  props.params.params.onSaveLayout?.();
}

function handleReset() {
  props.params.params.onResetLayout?.();
}
</script>

<template>
  <div class="flex h-full items-center gap-2 bg-background px-3">
    <span class="text-sm font-semibold">Vue Xeokit Viewer</span>
    <div class="flex-1" />
    <button
      type="button"
      class="inline-flex h-7 items-center gap-1.5 rounded border border-input bg-background px-2 text-xs hover:bg-muted"
      title="弹出当前面板"
      @click="handlePopout">
      <ExternalLink class="h-3.5 w-3.5" />
      <span>弹出</span>
    </button>
    <button
      type="button"
      class="inline-flex h-7 items-center gap-1.5 rounded border border-input bg-background px-2 text-xs hover:bg-muted"
      title="保存布局"
      @click="handleSave">
      <Save class="h-3.5 w-3.5" />
      <span>保存</span>
    </button>
    <button
      type="button"
      class="inline-flex h-7 items-center gap-1.5 rounded border border-input bg-background px-2 text-xs hover:bg-muted"
      title="重置为默认布局"
      @click="handleReset">
      <RotateCcw class="h-3.5 w-3.5" />
      <span>重置</span>
    </button>
  </div>
</template>
