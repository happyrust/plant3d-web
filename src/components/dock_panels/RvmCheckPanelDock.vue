<script setup lang="ts">
import RvmCheckPanel from '@/components/rvm-check/RvmCheckPanel.vue';
import RvmStoreBrowser from '@/components/rvm-check/RvmStoreBrowser.vue';
import RvmStoreTabs from '@/components/rvm-check/RvmStoreTabs.vue';
import { RVM_CHECK_VIEW_TABS, useRvmStoreBrowser } from '@/components/rvm-check/useRvmStoreBrowser';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const { view } = useRvmStoreBrowser();
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <div class="border-b border-border px-3">
      <RvmStoreTabs v-model="view" :tabs="RVM_CHECK_VIEW_TABS" label="RVM 核对的两个视图" />
    </div>
    <!-- 切到库内结果时只藏起来不卸载：正在跑的队列和看着的结果都留着 -->
    <RvmCheckPanel v-show="view === 'check'" class="min-h-0 flex-1" />
    <RvmStoreBrowser v-if="view === 'store'" class="min-h-0 flex-1" locatable />
  </div>
</template>
