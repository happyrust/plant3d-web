<template>
  <div class="h-full flex flex-col">
    <header class="h-20 flex-shrink-0 bg-white border-b border-gray-200 px-8 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-gray-900">全局工作台</h2>
        <p class="text-sm text-gray-500 mt-1">{{ currentUserName }} · {{ lastUpdatedLabel }}</p>
      </div>
      <button class="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        @click="refresh">
        刷新
      </button>
    </header>

    <div class="flex-1 overflow-y-auto p-8 space-y-8">
      <section>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">快捷操作</h3>
          <span class="text-xs text-gray-400">未选项目时的全局入口</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <button data-testid="dashboard-quick-action-projects"
            class="bg-white border border-gray-200 rounded-2xl p-4 text-left hover:shadow-md transition-shadow"
            @click="$emit('navigate', 'projects')">
            <div class="flex items-center gap-4">
              <div class="p-2 bg-blue-50 rounded-lg text-blue-600"><UploadCloudIcon class="w-6 h-6" /></div>
              <div>
                <div class="font-medium text-gray-900">上传/打开模型</div>
                <div class="text-xs text-gray-500 mt-1">进入项目列表选择模型</div>
              </div>
            </div>
          </button>

          <button class="bg-white border border-gray-200 rounded-2xl p-4 text-left hover:shadow-md transition-shadow"
            @click="$emit('navigate', 'reviews')">
            <div class="flex items-center gap-4">
              <div class="p-2 bg-green-50 rounded-lg text-green-600"><SendIcon class="w-6 h-6" /></div>
              <div>
                <div class="font-medium text-gray-900">发起提资</div>
                <div class="text-xs text-gray-500 mt-1">进入校审中心查看任务</div>
              </div>
            </div>
          </button>

          <button class="bg-white border border-gray-200 rounded-2xl p-4 text-left hover:shadow-md transition-shadow"
            @click="$emit('navigate', 'reviews')">
            <div class="flex items-center gap-4">
              <div class="p-2 bg-yellow-50 rounded-lg text-yellow-600"><FileCheckIcon class="w-6 h-6" /></div>
              <div>
                <div class="font-medium text-gray-900">待办校审</div>
                <div class="text-xs text-gray-500 mt-1">聚焦当前用户审核待办</div>
              </div>
            </div>
          </button>

          <div class="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-4 text-left opacity-70">
            <div class="flex items-center gap-4">
              <div class="p-2 bg-red-50 rounded-lg text-red-500"><ZapIcon class="w-6 h-6" /></div>
              <div>
                <div class="font-medium text-gray-700">碰撞检查</div>
                <div class="text-xs text-gray-500 mt-1">请选择项目后进入</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">运行概览</h3>
          <span v-if="statsLoading" class="text-xs text-gray-400">加载中...</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <template v-if="statsLoading">
            <div v-for="i in 4" :key="i" class="h-28 bg-white border border-gray-200 rounded-2xl animate-pulse" />
          </template>

          <template v-else>
            <article v-for="card in metricCards"
              :key="card.id"
              class="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <p class="text-sm text-gray-500">{{ card.label }}</p>
              <p class="text-3xl font-bold text-gray-900 mt-3">{{ card.value }}</p>
              <p class="text-xs text-gray-400 mt-2">{{ card.hint }}</p>
            </article>
          </template>
        </div>

        <p v-if="statsError" class="text-sm text-red-500 mt-3">{{ statsError }}</p>
      </section>

      <section class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <article class="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div class="flex items-center justify-between px-6 pt-5">
            <h3 class="text-lg font-semibold text-gray-900">任务概览</h3>
            <span class="text-xs text-gray-400">复用现有校审任务体系</span>
          </div>

          <div class="flex border-b border-gray-200 px-6 pt-2">
            <button class="px-4 py-3 text-sm font-medium border-b-2 transition-colors"
              :class="activeTaskTab === 'my_tasks' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'"
              @click="activeTaskTab = 'my_tasks'">
              我发起的任务
            </button>
            <button class="px-4 py-3 text-sm font-medium border-b-2 transition-colors"
              :class="activeTaskTab === 'pending_reviews' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'"
              @click="activeTaskTab = 'pending_reviews'">
              待我评审
            </button>
          </div>

          <div class="p-6 space-y-3 min-h-[220px]">
            <template v-if="tasksLoading">
              <div v-for="i in 3" :key="i" class="h-16 rounded-xl bg-gray-100 animate-pulse" />
            </template>
            <p v-else-if="tasksError" class="text-sm text-red-500">{{ tasksError }}</p>
            <p v-else-if="currentTasks.length === 0" class="text-sm text-gray-400">当前分类暂无任务</p>
            <template v-else>
              <article v-for="task in currentTasks"
                :key="task.id"
                class="flex items-center justify-between gap-4 rounded-xl border border-gray-200 p-4">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h4 class="font-semibold text-gray-900 truncate">{{ task.title }}</h4>
                    <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', task.priorityClass]">
                      {{ task.priorityLabel }}
                    </span>
                  </div>
                  <p class="text-sm text-gray-500 mt-1">{{ task.subtitle }}</p>
                </div>
                <div class="text-right shrink-0">
                  <div :class="['inline-flex px-2 py-1 rounded-full text-xs font-medium', task.statusClass]">
                    {{ task.statusLabel }}
                  </div>
                  <div class="text-xs text-gray-500 mt-2">{{ task.actionText }}</div>
                </div>
              </article>
            </template>
          </div>
        </article>

        <article class="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">团队动态</h3>
            <span v-if="activitiesLoading" class="text-xs text-gray-400">加载中...</span>
          </div>

          <div class="space-y-4 min-h-[220px]">
            <template v-if="activitiesLoading">
              <div v-for="i in 3" :key="i" class="flex gap-3 animate-pulse">
                <div class="w-8 h-8 rounded-full bg-gray-200 shrink-0" />
                <div class="space-y-2 flex-1 pt-1">
                  <div class="h-4 bg-gray-200 rounded w-1/3" />
                  <div class="h-3 bg-gray-200 rounded w-4/5" />
                </div>
              </div>
            </template>
            <p v-else-if="activitiesError" class="text-sm text-red-500">{{ activitiesError }}</p>
            <p v-else-if="activities.length === 0" class="text-sm text-gray-400">近期暂无动态</p>
            <article v-for="activity in activities" :key="activity.id" class="flex gap-3">
              <div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                :class="activity.userType === 'system_bot' ? 'bg-indigo-500' : 'bg-gray-400'">
                {{ activity.userName.charAt(0).toUpperCase() }}
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-semibold text-gray-900">{{ activity.userName }}</h4>
                  <span class="text-xs text-gray-400">{{ activity.createdAt }}</span>
                </div>
                <p class="text-sm text-gray-600 mt-1">
                  {{ activity.actionTitle }}
                  <span class="font-medium text-gray-800">[{{ activity.targetName }}]</span>
                  <template v-if="activity.actionDesc">，{{ activity.actionDesc }}</template>
                </p>
              </div>
            </article>
          </div>
        </article>
      </section>

      <section>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">最近打开的工程</h3>
          <span v-if="recentProjectsLoading" class="text-xs text-gray-400">同步项目中...</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <template v-if="recentProjectsLoading">
            <div v-for="i in 3" :key="i" class="h-32 rounded-2xl bg-white border border-gray-200 animate-pulse" />
          </template>
          <p v-else-if="recentProjects.length === 0" class="text-sm text-gray-400">暂无最近项目记录</p>
          <button v-for="project in recentProjects"
            :key="project.id"
            :data-testid="`dashboard-recent-project-${project.id}`"
            class="bg-white border border-gray-200 rounded-2xl overflow-hidden text-left hover:shadow-lg transition-transform hover:-translate-y-1"
            @click="$emit('select', project.id)">
            <div class="h-24 bg-gray-100 w-full flex items-center justify-center text-gray-400 text-sm">
              {{ project.path }}
            </div>
            <div class="p-4">
              <h4 class="font-semibold text-sm text-gray-900">{{ project.name }}</h4>
              <p class="text-xs text-gray-500 mt-1">
                {{ project.lastOpenedAt ? `最近访问 ${project.lastOpenedAt}` : '按项目更新时间排序' }}
              </p>
            </div>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import {
  UploadCloudIcon,
  SendIcon,
  FileCheckIcon,
  ZapIcon,
} from 'lucide-vue-next';

import { useDashboardWorkbench } from '@/composables/useDashboardWorkbench';

defineEmits<{
  navigate: ['dashboard' | 'projects' | 'reviews'];
  select: [projectId: string];
}>();

const activeTaskTab = ref<'my_tasks' | 'pending_reviews'>('pending_reviews');

const {
  activities,
  activitiesError,
  activitiesLoading,
  currentUserName,
  lastUpdatedLabel,
  metricCards,
  recentProjects,
  recentProjectsLoading,
  refresh,
  statsError,
  statsLoading,
  taskGroups,
  tasksError,
  tasksLoading,
} = useDashboardWorkbench();

const currentTasks = computed(() => taskGroups.value[activeTaskTab.value]);

onMounted(() => {
  refresh();
});
</script>
