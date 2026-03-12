<template>
  <!-- Main Panel Container -->
  <div v-if="open"
    class="pointer-events-auto absolute right-[60px] top-[120px] z-[950] flex w-[320px] flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-lg overflow-y-auto max-h-[85vh]"
    @pointerdown.stop @wheel.stop>
    <!-- Header -->
    <div class="flex items-center justify-between">
      <span class="font-ui text-base font-semibold text-gray-900">按距离查询</span>
      <button type="button" class="text-gray-500 hover:text-gray-900" title="关闭" @click="closePanel">
        <X class="h-4 w-4" />
      </button>
    </div>

    <!-- Segmented Control for tabs -->
    <div class="flex rounded-md bg-gray-100 p-1">
      <button type="button" 
        class="flex-1 rounded py-1 text-sm font-medium transition-colors"
        :class="activeTab === 'refno' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
        @click="activeTab = 'refno'">
        通过 Refno
      </button>
      <button type="button" 
        class="flex-1 rounded py-1 text-sm font-medium transition-colors"
        :class="activeTab === 'coords' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
        @click="activeTab = 'coords'">
        通过坐标
      </button>
    </div>

    <!-- Input Form: Refno -->
    <div v-if="activeTab === 'refno'" class="flex flex-col gap-3">
      <div class="flex flex-col gap-1.5">
        <label class="font-ui text-[13px] font-medium text-gray-700">物项编号 (Refno)</label>
        <div class="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 focus-within:border-[#FF6B00]">
          <input v-model="refnoStr" type="text" placeholder="例如: 17496_123456" 
            class="w-full bg-transparent font-mono text-sm text-gray-900 outline-none placeholder:text-gray-400" />
        </div>
      </div>
    </div>

    <!-- Input Form: Coords -->
    <div v-if="activeTab === 'coords'" class="flex flex-col gap-3">
      <div class="grid grid-cols-3 gap-2">
        <div class="flex flex-col gap-1">
          <label class="font-ui text-xs text-gray-500">X (mm)</label>
          <input v-model.number="coordX" type="number" class="w-full rounded border border-gray-200 bg-white px-2 py-1 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-ui text-xs text-gray-500">Y (mm)</label>
          <input v-model.number="coordY" type="number" class="w-full rounded border border-gray-200 bg-white px-2 py-1 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-ui text-xs text-gray-500">Z (mm)</label>
          <input v-model.number="coordZ" type="number" class="w-full rounded border border-gray-200 bg-white px-2 py-1 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
        </div>
      </div>
    </div>

    <!-- Common Radius Input -->
    <div class="flex flex-col gap-1.5">
      <label class="font-ui text-[13px] font-medium text-gray-700">查询半径 (mm)</label>
      <div class="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 focus-within:border-[#FF6B00]">
        <Search class="h-4 w-4 text-gray-400" />
        <input v-model.number="radius" type="number" placeholder="5000" 
          class="w-full bg-transparent font-mono text-sm text-gray-900 outline-none placeholder:text-gray-400" />
      </div>
    </div>

    <hr class="border-gray-100" />

    <!-- Filters -->
    <div class="flex flex-col gap-3">
      <span class="font-ui text-[13px] font-semibold text-gray-500">过滤条件 (可选)</span>
      
      <div class="flex flex-col gap-1.5">
        <label class="font-ui text-xs text-gray-500">Noun 类型 (多选逗号分隔)</label>
        <input v-model="nounTypes" type="text" placeholder="PIPE, EQUI..." 
          class="w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
      </div>
      
      <div class="flex flex-col gap-1.5">
        <label class="font-ui text-xs text-gray-500">最大结果数</label>
        <input v-model.number="limit" type="number" placeholder="100" 
          class="w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 font-mono text-sm text-gray-900 outline-none focus:border-[#FF6B00]" />
      </div>
    </div>

    <!-- Submit Button -->
    <button type="button" 
      class="mt-2 flex w-full items-center justify-center rounded-md bg-[#FF6B00] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#e66000]"
      @click="triggerQuery">
      查询周边物项
    </button>

    <!-- Results Area (Placeholder) -->
    <div v-if="hasResults" class="mt-2 flex flex-col gap-2">
      <span class="font-ui text-[13px] font-semibold text-gray-500">查询结果</span>
      <div class="flex max-h-[160px] flex-col gap-2 overflow-y-auto pr-1">
        <div v-for="(res, idx) in dummyResults" :key="idx" class="flex items-center justify-between rounded bg-[#FFF0E6] p-2 hover:bg-[#FFE3D1] transition-colors cursor-pointer" @click="clickResult(res)">
          <div class="flex items-center gap-2">
            <Box class="h-4 w-4 text-[#FF6B00]" />
            <div class="flex flex-col">
              <span class="font-ui text-xs font-semibold text-gray-900">{{ res.type }}</span>
              <span class="font-mono text-xs text-gray-500">{{ res.refno }}</span>
            </div>
          </div>
          <span class="font-mono text-[13px] font-medium text-[#FF6B00]">{{ res.distance }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

import { X, Search, Box } from 'lucide-vue-next';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<(e: 'update:open', value: boolean) => void>();

const activeTab = ref<'refno' | 'coords'>('refno');
const refnoStr = ref('');
const coordX = ref(0);
const coordY = ref(0);
const coordZ = ref(0);
const radius = ref(5000);

const nounTypes = ref('');
const limit = ref(100);

const hasResults = ref(true); // For demo
const dummyResults = ref([
  { type: '工艺管道', refno: '24381_145018', distance: '1.2m' },
  { type: '仪表设备', refno: '17496_123456', distance: '3.5m' },
]);

function closePanel() {
  emit('update:open', false);
}

function triggerQuery() {
  console.log('[DistanceQueryPanel] triggerQuery called with:', {
    activeTab: activeTab.value,
    refnoStr: refnoStr.value,
    coords: [coordX.value, coordY.value, coordZ.value],
    radius: radius.value,
    nounTypes: nounTypes.value,
    limit: limit.value
  });
  hasResults.value = true;
}

function clickResult(res: Record<string, unknown>) {
  console.log('[DistanceQueryPanel] clicked result:', res);
}
</script>

<style scoped>
.font-ui {
  font-family: "Fira Sans", system-ui, sans-serif;
}
</style>
