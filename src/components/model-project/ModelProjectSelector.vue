<template>
  <div v-if="projects.length > 1" class="model-project-selector">
    <div class="flex items-center gap-2">
      <Package class="h-4 w-4 text-muted-foreground" />
      <select
        v-model="selectedProjectId"
        class="flex-1 h-8 px-2 text-sm border rounded bg-background"
        :disabled="isLoading"
        @change="handleProjectChange"
      >
        <option value="" disabled>选择模型项目</option>
        <option
          v-for="project in projects"
          :key="project.id"
          :value="project.id"
        >
          {{ project.name }}
        </option>
      </select>
      <button
        v-if="isLoading"
        class="h-8 w-8 rounded border bg-background animate-spin"
        disabled
      >
        <RefreshCw class="h-4 w-4" />
      </button>
      <button
        v-else
        class="h-8 w-8 rounded border bg-background hover:bg-muted"
        title="刷新项目列表"
        @click="loadProjects"
      >
        <RefreshCw class="h-4 w-4" />
      </button>
    </div>
    <div v-if="currentProject" class="mt-1 text-xs text-muted-foreground">
      {{ currentProject.description }}
    </div>
  </div>
  <!-- 只有一个项目时，只显示项目信息 -->
  <div v-else-if="currentProject" class="model-project-info">
    <div class="flex items-center gap-2">
      <Package class="h-4 w-4 text-muted-foreground" />
      <span class="text-sm font-medium">{{ currentProject.name }}</span>
    </div>
    <div class="mt-1 text-xs text-muted-foreground">
      {{ currentProject.description }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';

import { Package, RefreshCw } from 'lucide-vue-next';

import { useModelProjects } from '@/composables/useModelProjects';

const modelProjects = useModelProjects();

const { projects, currentProject, isLoading, loadProjects, switchProject } = modelProjects;

const selectedProjectId = computed({
  get: () => currentProject.value?.id || '',
  set: (value: string) => {
    if (value) {
      switchProject(value);
    }
  }
});

function handleProjectChange() {
  // 项目切换逻辑已在 switchProject 中处理
}

// 监听项目变化，可以在这里添加额外的处理逻辑
watch(currentProject, (newProject) => {
  if (newProject) {
    console.log('切换到项目:', newProject.name);
  }
});
</script>

<style scoped>
.model-project-selector {
  @apply flex flex-col;
}

select {
  @apply outline-none focus:ring-2 focus:ring-ring;
}
</style>
