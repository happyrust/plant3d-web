<template>
  <div class="h-full flex flex-col">
    <header class="h-20 flex-shrink-0 bg-white border-b border-gray-200 px-8 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-gray-900">校审中心</h2>
        <p class="text-sm text-gray-500 mt-1">集中查看当前用户的待办校审与我发起的任务</p>
      </div>
      <button class="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        @click="refresh">
        刷新
      </button>
    </header>

    <div class="flex-1 overflow-y-auto p-8 space-y-6">
      <section class="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">待我评审</h3>
          <span class="text-sm text-gray-400">{{ pendingReviews.length }} 项</span>
        </div>

        <div v-if="loading" class="space-y-3">
          <div v-for="i in 3" :key="i" class="h-16 rounded-xl bg-gray-100 animate-pulse" />
        </div>
        <div v-else-if="error" class="text-sm text-red-500">{{ error }}</div>
        <div v-else-if="pendingReviews.length === 0" class="text-sm text-gray-400">当前没有待我评审任务</div>
        <div v-else class="space-y-3">
          <article v-for="task in pendingReviews"
            :key="task.id"
            class="rounded-xl border border-gray-200 p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h4 class="font-semibold text-gray-900">{{ task.title }}</h4>
                <p class="text-sm text-gray-500 mt-1">{{ task.modelName || '未命名模型' }} · 发起人 {{ task.requesterName }}</p>
              </div>
              <span class="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                {{ task.status }}
              </span>
            </div>
          </article>
        </div>
      </section>

      <section class="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">我发起的任务</h3>
          <span class="text-sm text-gray-400">{{ initiatedTasks.length }} 项</span>
        </div>

        <div v-if="loading" class="space-y-3">
          <div v-for="i in 3" :key="i" class="h-16 rounded-xl bg-gray-100 animate-pulse" />
        </div>
        <div v-else-if="error" class="text-sm text-red-500">{{ error }}</div>
        <div v-else-if="initiatedTasks.length === 0" class="text-sm text-gray-400">当前没有我发起的任务</div>
        <div v-else class="space-y-3">
          <article v-for="task in initiatedTasks"
            :key="task.id"
            class="rounded-xl border border-gray-200 p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h4 class="font-semibold text-gray-900">{{ task.title }}</h4>
                <p class="text-sm text-gray-500 mt-1">{{ task.modelName || '未命名模型' }} · 当前节点 {{ task.currentNode || 'sj' }}</p>
              </div>
              <span class="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                {{ task.status }}
              </span>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';

import { useUserStore } from '@/composables/useUserStore';

const userStore = useUserStore();

const pendingReviews = computed(() => userStore.pendingReviewTasks.value);
const initiatedTasks = computed(() => userStore.myInitiatedTasks.value);
const loading = computed(() => userStore.loading.value);
const error = computed(() => userStore.error.value);

async function refresh() {
  await userStore.loadCurrentUser();
  await userStore.loadReviewTasks();
}

onMounted(() => {
  refresh();
});
</script>
