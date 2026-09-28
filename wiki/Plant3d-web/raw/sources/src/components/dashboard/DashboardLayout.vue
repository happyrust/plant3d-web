<template>
  <div class="flex h-screen w-full overflow-hidden bg-[#F3F4F6] text-gray-900">
    <aside class="hidden h-full w-[280px] shrink-0 border-r border-gray-200 bg-white lg:flex lg:flex-col">
      <div class="flex h-20 items-center gap-3 px-6">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-sm font-bold text-white">
          P
        </div>
        <div>
          <p class="text-xl font-bold text-gray-800">Plant3D Web</p>
          <p class="text-xs text-gray-400">三维校审工作台</p>
        </div>
      </div>

      <nav class="flex-1 px-4 py-4">
        <button v-for="item in navItems"
          :key="item.id"
          class="mb-1 flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-colors"
          :class="activeMenu === item.id
            ? 'bg-[#EFF6FF] font-semibold text-blue-500'
            : 'font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900'"
          @click="activeMenu = item.id">
          <component :is="item.icon" class="h-5 w-5" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header class="flex h-20 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-5 sm:px-8">
        <h1 class="min-w-0 truncate text-2xl font-bold text-gray-800">{{ activePage.title }}</h1>

        <div class="flex items-center">
          <div class="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500 text-sm font-semibold text-white"
            :aria-label="currentUserName">
            {{ userInitial }}
          </div>
        </div>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto">
        <DashboardOverview v-if="activeMenu === 'dashboard'"
          @navigate="activeMenu = $event"
          @select="handleProjectSelect" />
        <SiteDashboardPanel v-else-if="activeMenu === 'sites'" />
        <ProjectCardList v-else-if="activeMenu === 'projects'" @select="handleProjectSelect" />
        <DashboardReviewsPanel v-else />
      </main>

      <nav class="grid shrink-0 grid-cols-4 border-t border-gray-200 bg-white p-2 lg:hidden">
        <button v-for="item in navItems"
          :key="`${item.id}-mobile`"
          class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs transition-colors"
          :class="activeMenu === item.id ? 'bg-[#EFF6FF] font-semibold text-blue-500' : 'text-gray-500'"
          @click="activeMenu = item.id">
          <component :is="item.icon" class="h-4 w-4" />
          <span>{{ item.shortLabel }}</span>
        </button>
      </nav>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  CheckSquareIcon,
  FolderIcon,
  LayoutDashboardIcon,
  ServerIcon,
} from 'lucide-vue-next';

import DashboardOverview from './DashboardOverview.vue';

import DashboardReviewsPanel from '@/components/dashboard/DashboardReviewsPanel.vue';
import ProjectCardList from '@/components/model-project/ProjectCardList.vue';
import SiteDashboardPanel from '@/components/site/SiteDashboardPanel.vue';
import { useModelProjects } from '@/composables/useModelProjects';
import { useUserStore } from '@/composables/useUserStore';

defineEmits<{
  select: [projectId: string];
}>();

type MenuId = 'dashboard' | 'sites' | 'projects' | 'reviews';

const activeMenu = ref<MenuId>('projects');
const { selectProject } = useModelProjects();
const userStore = useUserStore();

const navItems: {
  id: MenuId;
  label: string;
  shortLabel: string;
  title: string;
  icon: typeof LayoutDashboardIcon;
}[] = [
  {
    id: 'dashboard',
    label: '首页 (Dashboard)',
    shortLabel: '首页',
    title: '概览',
    icon: LayoutDashboardIcon,
  },
  {
    id: 'sites',
    label: '站点管理',
    shortLabel: '站点',
    title: '站点管理',
    icon: ServerIcon,
  },
  {
    id: 'projects',
    label: '模型工程',
    shortLabel: '工程',
    title: '模型工程',
    icon: FolderIcon,
  },
  {
    id: 'reviews',
    label: '校审批注',
    shortLabel: '校审',
    title: '校审批注',
    icon: CheckSquareIcon,
  },
];

const activePage = computed(() => navItems.find((item) => item.id === activeMenu.value) ?? navItems[0]);
const currentUserName = computed(() => userStore.currentUser.value?.name ?? '协作用户');
const userInitial = computed(() => currentUserName.value.charAt(0).toUpperCase());

function handleProjectSelect(projectId: string) {
  selectProject(projectId);
  activeMenu.value = 'projects';
}
</script>
