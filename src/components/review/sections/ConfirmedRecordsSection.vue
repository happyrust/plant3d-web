<script setup lang="ts">
import { computed } from 'vue';

import { Trash2, ClipboardCheck, Calendar, FileText } from 'lucide-vue-next';

interface ConfirmedRecordEntry {
  id: string;
  taskId: string;
  note: string;
  confirmedAt: number;
  confirmedBy: string;
  annotations: any[];
  cloudAnnotations: any[];
  rectAnnotations: any[];
  obbAnnotations: any[];
}

interface Props {
  taskId?: string;
  records: ConfirmedRecordEntry[];
  loading?: boolean;
}

interface Emits {
  (e: 'delete', recordId: string): void;
  (e: 'clear-all'): void;
  (e: 'refresh'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const totalCount = computed(() => props.records.length);

const getAnnotationCount = (record: ConfirmedRecordEntry) => {
  return record.annotations.length +
    record.cloudAnnotations.length +
    record.rectAnnotations.length +
    record.obbAnnotations.length;
};

const formatDateTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};
</script>

<template>
  <div class="confirmed-records-section border-b border-gray-200 bg-white p-4">
    <div class="mb-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <ClipboardCheck class="h-5 w-5 text-gray-600" />
        <h4 class="text-sm font-medium text-gray-700">确认记录</h4>
        <span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
          {{ totalCount }}
        </span>
      </div>
      
      <button v-if="totalCount > 0"
        type="button"
        :disabled="loading"
        class="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
        @click="emit('clear-all')">
        清空全部
      </button>
    </div>

    <div v-if="totalCount === 0" class="py-8 text-center text-sm text-gray-500">
      暂无确认记录
    </div>

    <div v-else class="space-y-2 max-h-96 overflow-y-auto">
      <div v-for="record in records"
        :key="record.id"
        class="rounded-lg border border-gray-200 bg-gray-50 p-3 hover:bg-gray-100">
        <div class="flex items-start justify-between">
          <div class="flex-1 space-y-1">
            <div class="flex items-center gap-2 text-xs text-gray-600">
              <Calendar class="h-3 w-3" />
              {{ formatDateTime(record.confirmedAt) }}
              <span class="text-gray-400">·</span>
              <span>{{ record.confirmedBy }}</span>
            </div>
            
            <div class="flex items-center gap-2 text-xs">
              <FileText class="h-3 w-3 text-gray-400" />
              <span class="text-gray-700">{{ getAnnotationCount(record) }} 个批注</span>
            </div>
            
            <div v-if="record.note" class="text-xs text-gray-600">
              备注：{{ record.note }}
            </div>
          </div>
          
          <button type="button"
            class="ml-2 text-gray-400 hover:text-red-600"
            @click="emit('delete', record.id)">
            <Trash2 class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
