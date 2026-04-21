<script setup lang="ts">
import { ref, computed } from 'vue';

import { Database, Search, MapPin, Highlighter } from 'lucide-vue-next';

import CollisionResultList from '../CollisionResultList.vue';
import ReviewAuxData from '../ReviewAuxData.vue';

import type { ReviewTask } from '@/types/auth';

interface CollisionItem {
  ObjectOne: string;
  ObjectTow: string;
  Distance: number;
}

interface Props {
  task: ReviewTask | null;
  formId?: string;
  projectId?: string;
}

interface Emits {
  (e: 'locate', item: CollisionItem): void;
  (e: 'highlight', item: CollisionItem): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const activeTab = ref<'collision' | 'auxdata'>('collision');
const collisionData = ref<CollisionItem[]>([]);
const collisionLoading = ref(false);

const effectiveFormId = computed(() => props.formId || props.task?.formId || undefined);
const effectiveProjectId = computed(() => props.projectId || 'default');
</script>

<template>
  <div class="auxiliary-data-section border-b border-gray-200 bg-white p-4">
    <div class="mb-3 flex items-center gap-2">
      <Database class="h-5 w-5 text-gray-600" />
      <h4 class="text-sm font-medium text-gray-700">辅助数据</h4>
    </div>

    <!-- Tab 切换 -->
    <div class="mb-3 flex gap-2 border-b border-gray-200">
      <button :class="[
                'px-3 py-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'collision'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              ]"
        @click="activeTab = 'collision'">
        碰撞查询
      </button>
      <button :class="[
                'px-3 py-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'auxdata'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              ]"
        @click="activeTab = 'auxdata'">
        辅助数据
      </button>
    </div>

    <!-- 碰撞查询 -->
    <div v-show="activeTab === 'collision'" class="space-y-3">
      <CollisionResultList :items="collisionData"
        :loading="collisionLoading"
        @locate="emit('locate', $event)"
        @highlight="emit('highlight', $event)" />
    </div>

    <!-- 辅助数据 -->
    <div v-show="activeTab === 'auxdata'">
      <ReviewAuxData :task="task"
        :form-id="effectiveFormId"
        :project-id="effectiveProjectId" />
    </div>
  </div>
</template>
