<template>
  <div class="flex h-screen w-full bg-white text-gray-900 overflow-hidden">
    <!-- Sidebar -->
    <aside class="w-60 h-full border-r border-gray-200 bg-gray-50 flex flex-col pt-8">
      <!-- Logo & Title -->
      <div class="px-6 flex items-center gap-3 mb-8">
        <div class="w-6 h-6 bg-blue-500 rounded flex-shrink-0" />
        <h1 class="font-semibold text-lg text-gray-900">Plant3D Web</h1>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 px-4 space-y-1">
        <button class="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors"
          :class="activeMenu === 'dashboard' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'"
          @click="activeMenu = 'dashboard'">
          <LayoutDashboardIcon class="w-4 h-4" />
          首页 (Dashboard)
        </button>

        <button class="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors"
          :class="activeMenu === 'projects' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'"
          @click="activeMenu = 'projects'">
          <FolderIcon class="w-4 h-4" />
          模型工程
        </button>

        <button class="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors"
          :class="activeMenu === 'reviews' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'"
          @click="activeMenu = 'reviews'">
          <ClockIcon class="w-4 h-4" />
          校审批注
        </button>
      </nav>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 min-w-0 h-full overflow-y-auto bg-gray-50/50">
      <DashboardOverview v-if="activeMenu === 'dashboard'"
        @navigate="activeMenu = $event"
        @select="$emit('select', $event)" />
      <ProjectCardList v-else-if="activeMenu === 'projects'" @select="$emit('select', $event)" />
      <DashboardReviewsPanel v-else />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

import { LayoutDashboardIcon, FolderIcon, ClockIcon } from 'lucide-vue-next';

import DashboardOverview from './DashboardOverview.vue';

import DashboardReviewsPanel from '@/components/dashboard/DashboardReviewsPanel.vue';
import ProjectCardList from '@/components/model-project/ProjectCardList.vue';

defineEmits<{
  select: [projectId: string];
}>();

type MenuId = 'dashboard' | 'projects' | 'reviews';
const activeMenu = ref<MenuId>('dashboard');
</script>
