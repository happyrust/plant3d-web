<script setup lang="ts">
import { ref, nextTick, onMounted, watch } from 'vue';

import { useConsoleStore } from '@/composables/useConsoleStore';
import { usePdmsConsoleCommands } from '@/composables/usePdmsConsoleCommands';

const props = defineProps<{
  params?: {
    api?: unknown;
    containerApi?: unknown;
  };
}>();

const store = useConsoleStore();
usePdmsConsoleCommands(); // Register PDMS commands

const inputValue = ref('');
const scrollContainer = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

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
  // Focus input when clicking anywhere in the container, unless selecting text
  const selection = window.getSelection();
  if (!selection || selection.type !== 'Range') {
    inputRef.value?.focus();
  }
}

function handleEnter() {
  store.executeCommand(inputValue.value);
  inputValue.value = '';
  scrollToBottom();
}

function handleUp() {
  const prev = store.getHistoryPrevious();
  if (prev !== null) {
    inputValue.value = prev;
    // Move cursor to end
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

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <div class="flex h-full w-full flex-col bg-white text-sm font-mono text-gray-900"
    @click="handleContainerClick">
    <!-- Logs & Input Area -->
    <div ref="scrollContainer" class="flex-1 overflow-y-auto p-3 cursor-text">
      <div v-if="store.logs.value.length === 0" class="text-gray-500 italic mb-2">
        Plant3D Web Console [Version 1.0.0] <br />
        输入 'help' 查看可用命令。
      </div>
      
      <!-- Render Logs -->
      <div v-for="log in store.logs.value" :key="log.id" class="break-words mb-1 leading-relaxed">
        <!-- Input line representation -->
        <div v-if="log.type === 'input'" class="flex">
          <span class="text-blue-600 mr-2 shrink-0 select-none font-bold">&gt;</span>
          <span class="text-gray-900 font-semibold whitespace-pre-wrap">{{ log.content.replace(/^> /, '') }}</span>
        </div>
        
        <!-- Error line -->
        <div v-else-if="log.type === 'error'" class="text-red-600 whitespace-pre-wrap pl-4">{{ log.content }}</div>
        
        <!-- Info line -->
        <div v-else-if="log.type === 'info'" class="text-blue-600 whitespace-pre-wrap pl-4">{{ log.content }}</div>

        <!-- Warning line -->
        <div v-else-if="log.type === 'warning'" class="text-amber-700 whitespace-pre-wrap pl-4">{{ log.content }}</div>
        
        <!-- Output line / default -->
        <div v-else class="text-gray-700 whitespace-pre-wrap pl-4">{{ log.content }}</div>
      </div>

      <!-- Active Input Line -->
      <div class="flex items-center mt-1">
        <span class="text-blue-600 mr-2 shrink-0 select-none font-bold">&gt;</span>
        <input ref="inputRef"
          v-model="inputValue"
          type="text"
          class="flex-1 bg-transparent outline-none border-none text-gray-900 placeholder-gray-400 min-w-0"
          placeholder=""
          spellcheck="false"
          autocomplete="off"
          @keydown.enter="handleEnter"
          @keydown.up.prevent="handleUp"
          @keydown.down.prevent="handleDown" />
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
</style>
