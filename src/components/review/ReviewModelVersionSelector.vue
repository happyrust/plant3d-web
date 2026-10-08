<script setup lang="ts">
import { nextTick } from 'vue';

import type { ReviewModelVersionGroup } from './reviewModelVersionGroups';

const props = defineProps<{ groups: ReviewModelVersionGroup[]; selectedKey: string | null }>();
const emit = defineEmits<{ select: [key: string | null] }>();
function selectVersion(event: Event) {
  const target = event.target as HTMLSelectElement;
  emit('select', target.value || null);
  void nextTick(() => { target.value = props.selectedKey ?? ''; });
}
</script>

<template>
  <label v-if="groups.length > 1" class="block w-full text-xs" data-testid="review-model-version-selector">
    <span class="mb-1 block">确认记录版本</span>
    <select :value="selectedKey ?? ''" aria-label="确认记录版本" class="w-full rounded border border-current bg-transparent px-2 py-1" @change="selectVersion">
      <option value="" disabled>请选择一个模型版本查看</option>
      <option v-for="group in groups" :key="group.key" :value="group.key" :disabled="group.disabled">{{ group.label }} · {{ group.count }} 条记录</option>
    </select>
    <span class="mt-1 block opacity-75">每次只回放所选版本。旧记录未绑定版本时无法合并查看。</span>
  </label>
</template>
