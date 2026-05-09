<script setup lang="ts">
import { ref, nextTick, onMounted, watch, computed } from 'vue';

import { useParquetSqlStore, type QueryResult } from '@/composables/useParquetSqlStore';

const store = useParquetSqlStore();

const inputValue = ref('');
const dbnoInput = ref('');
const scrollContainer = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

// 计算属性：结果表格数据
const tableData = computed(() => store.lastResult.value);

function scrollToBottom() {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
    }
  });
}

// Watch for new logs to scroll
watch(
  () => store.logs.value.length,
  () => {
    scrollToBottom();
  }
);

function handleContainerClick() {
  const selection = window.getSelection();
  if (!selection || selection.type !== 'Range') {
    inputRef.value?.focus();
  }
}

function handleEnter() {
  store.executeQuery(inputValue.value);
  inputValue.value = '';
  scrollToBottom();
}

function handleUp() {
  const prev = store.getHistoryPrevious();
  if (prev !== null) {
    inputValue.value = prev;
    nextTick(() => {
      if (inputRef.value) {
        inputRef.value.selectionStart = inputRef.value.selectionEnd = inputValue.value.length;
      }
    });
  }
}

function handleDown() {
  const next = store.getHistoryNext();
  if (next !== null) {
    inputValue.value = next;
  } else {
    inputValue.value = '';
  }
}

async function handleLoadFiles() {
  const dbno = parseInt(dbnoInput.value, 10);
  if (isNaN(dbno)) {
    store.addLog('error', '请输入有效的 dbno');
    return;
  }
  await store.listAvailableFiles(dbno);
}

async function handleFileSelect(event: Event) {
  const target = event.target as HTMLSelectElement;
  const filename = target.value;
  if (filename) {
    await store.loadParquetFile(filename);
  }
}

onMounted(() => {
  scrollToBottom();
  // 初始化 DuckDB
  store.initDuckDB();
});

// 格式化单元格值
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
</script>

<template>
  <div class="flex h-full w-full flex-col bg-white text-sm font-mono text-gray-900"
    @click="handleContainerClick">
    <!-- Header -->
    <div class="flex flex-none items-center justify-end border-b border-gray-200 bg-gray-50 px-2 py-1 text-xs select-none">
      <button class="hover:bg-gray-200 text-gray-600 hover:text-gray-900 rounded px-2 py-0.5 transition-colors"
        title="清空控制台"
        @click.stop="store.clearLogs()">
        清空
      </button>
    </div>

    <!-- File Selection Area -->
    <div class="flex flex-none items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2" @click.stop>
      <label class="text-xs text-gray-600 shrink-0">dbno:</label>
      <input v-model="dbnoInput"
        type="text"
        placeholder="输入 dbno"
        class="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-500"
        @keydown.enter="handleLoadFiles" />
      <button :disabled="store.isLoading.value"
        class="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        @click="handleLoadFiles">
        {{ store.isLoading.value ? '加载中...' : '获取文件' }}
      </button>
      
      <div class="w-px h-5 bg-gray-300 mx-1" />
      
      <label class="text-xs text-gray-600 shrink-0">文件:</label>
      <select :disabled="store.availableFiles.value.length === 0 || store.isLoading.value"
        class="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-500 disabled:opacity-50"
        @change="handleFileSelect">
        <option value="">选择 Parquet 文件</option>
        <option v-for="file in store.availableFiles.value"
          :key="file"
          :value="file">
          {{ file }}
        </option>
      </select>
    </div>

    <!-- Main Content Area -->
    <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
      <!-- Results Table (if available) -->
      <div v-if="tableData && tableData.rows.length > 0" class="flex-none max-h-48 overflow-auto border-b border-gray-200 bg-gray-50">
        <table class="w-full text-xs border-collapse">
          <thead class="sticky top-0 bg-gray-100">
            <tr>
              <th v-for="col in tableData.columns" 
                :key="col"
                class="px-2 py-1 text-left font-semibold text-gray-700 border-b border-gray-200">
                {{ col }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in tableData.rows.slice(0, 100)" 
              :key="idx"
              class="hover:bg-blue-50">
              <td v-for="col in tableData.columns" 
                :key="col"
                class="px-2 py-1 border-b border-gray-100 max-w-xs truncate"
                :title="formatCellValue(row[col])">
                {{ formatCellValue(row[col]) }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="tableData.rows.length > 100" class="px-2 py-1 text-xs text-gray-500 bg-gray-100">
          显示前 100 行，共 {{ tableData.rows.length }} 行
        </div>
      </div>

      <!-- Logs & Input Area -->
      <div ref="scrollContainer" class="flex-1 overflow-y-auto p-3 cursor-text">
        <div v-if="store.logs.value.length === 0" class="text-gray-500 italic mb-2">
          Parquet SQL Console<br />
          输入 'help' 查看可用命令。
        </div>
        
        <!-- Render Logs -->
        <div v-for="log in store.logs.value" :key="log.id" class="break-words mb-1 leading-relaxed">
          <!-- Input line representation -->
          <div v-if="log.type === 'input'" class="flex">
            <span class="text-green-600 mr-2 shrink-0 select-none font-bold">SQL&gt;</span>
            <span class="text-gray-900 font-semibold whitespace-pre-wrap">{{ log.content }}</span>
          </div>
          
          <!-- Error line -->
          <div v-else-if="log.type === 'error'" class="text-red-600 whitespace-pre-wrap pl-4">{{ log.content }}</div>
          
          <!-- Info line -->
          <div v-else-if="log.type === 'info'" class="text-blue-600 whitespace-pre-wrap pl-4">{{ log.content }}</div>
          
          <!-- Output line / default -->
          <div v-else class="text-gray-700 whitespace-pre-wrap pl-4">{{ log.content }}</div>
        </div>

        <!-- Active Input Line -->
        <div class="flex items-center mt-1">
          <span class="text-green-600 mr-2 shrink-0 select-none font-bold">SQL&gt;</span>
          <input ref="inputRef"
            v-model="inputValue"
            type="text"
            class="flex-1 bg-transparent outline-none border-none text-gray-900 placeholder-gray-400 min-w-0"
            placeholder="输入 SQL 查询..."
            spellcheck="false"
            autocomplete="off"
            @keydown.enter="handleEnter"
            @keydown.up.prevent="handleUp"
            @keydown.down.prevent="handleDown" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Custom scrollbar for light theme */
div::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
div::-webkit-scrollbar-track {
  background: #f3f4f6;
}
div::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 5px;
  border: 2px solid #f3f4f6;
}
div::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}

/* Hide focus outline completely as we rely on the blinking cursor of input */
input:focus {
  outline: none;
}

/* Table styles */
table {
  font-size: 11px;
}
</style>
