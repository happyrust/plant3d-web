<template>
  <div class="project-card-list">
    <div class="header">
      <h1 class="title">选择项目</h1>
      <p class="subtitle">请选择一个项目开始工作</p>
    </div>

    <div v-if="isLoading" class="loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else class="cards-grid">
      <v-card
        v-for="project in projects"
        :key="project.id"
        class="project-card"
        hover
        @click="$emit('select', project.id)"
      >
        <v-img
          :src="project.thumbnail || '/favicon.ico'"
          height="200"
          cover
          class="card-image"
        />
        <v-card-title>{{ project.name }}</v-card-title>
        <v-card-text>
          <p class="description">{{ project.description }}</p>
          <p v-if="project.updatedAt" class="update-time">
            更新时间: {{ project.updatedAt }}
          </p>
        </v-card-text>
      </v-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useModelProjects } from '@/composables/useModelProjects';

defineEmits<{
  select: [projectId: string];
}>();

const { projects, isLoading } = useModelProjects();
</script>

<style scoped>
.project-card-list {
  min-height: 100vh;
  background: #f5f5f5;
  padding: 48px 24px;
}

.header {
  text-align: center;
  margin-bottom: 48px;
}

.title {
  font-size: 32px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 8px;
}

.subtitle {
  font-size: 16px;
  color: #666;
}

.loading {
  display: flex;
  justify-content: center;
  padding: 64px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.project-card {
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.project-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
}

.card-image {
  background: #e0e0e0;
}

.description {
  color: #666;
  margin-bottom: 8px;
}

.update-time {
  font-size: 12px;
  color: #999;
  margin: 0;
}
</style>
