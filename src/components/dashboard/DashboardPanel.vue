<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import {
  AlertTriangle,
  CheckSquare,
  Clock,
  Folder,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-vue-next';

import { useUserStore } from '@/composables/useUserStore';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { getRoleDisplayName } from '@/types/auth';

const userStore = useUserStore();

const isLoading = ref(false);

const currentUser = computed(() => userStore.currentUser.value);
const allTasks = computed(() => userStore.reviewTasks.value);
const myInitiated = computed(() => userStore.myInitiatedTasks.value);
const pendingReview = computed(() => userStore.pendingReviewTasks.value);

const stats = computed(() => ({
  total: allTasks.value.length,
  inReview: allTasks.value.filter((t) => t.status === 'in_review' || t.status === 'submitted').length,
  approved: allTasks.value.filter((t) => t.status === 'approved').length,
  approvalRate: allTasks.value.length > 0
    ? Math.round((allTasks.value.filter((t) => t.status === 'approved').length / allTasks.value.length) * 100)
    : 0,
}));

const recentTasks = computed(() => {
  return [...allTasks.value]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
});

const quickActions = [
  { id: 'open', label: '上传/打开模型', icon: Upload, bgColor: 'bg-blue-50', iconColor: 'text-blue-600' },
  { id: 'initiate', label: '发起提资', icon: Plus, bgColor: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  { id: 'review', label: '待办校审', icon: CheckSquare, bgColor: 'bg-amber-50', iconColor: 'text-amber-600' },
  { id: 'collision', label: '碰撞检查', icon: AlertTriangle, bgColor: 'bg-red-50', iconColor: 'text-red-600' },
];

function handleQuickAction(actionId: string) {
  switch (actionId) {
    case 'initiate':
      ensurePanelAndActivate('initiateReview');
      break;
    case 'review':
      ensurePanelAndActivate('reviewerTasks');
      break;
    default:
      break;
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function getStatusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'approved': return { label: '已通过', cls: 'bg-emerald-100 text-emerald-700' };
    case 'rejected': return { label: '已驳回', cls: 'bg-red-100 text-red-700' };
    case 'submitted': return { label: '待审核', cls: 'bg-amber-100 text-amber-700' };
    case 'in_review': return { label: '审核中', cls: 'bg-sky-100 text-sky-700' };
    case 'draft': return { label: '草稿', cls: 'bg-slate-100 text-slate-600' };
    default: return { label: status, cls: 'bg-slate-100 text-slate-600' };
  }
}

async function refreshData() {
  isLoading.value = true;
  try {
    await userStore.loadReviewTasks();
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  refreshData();
});
</script>

<template>
  <div class="flex h-full overflow-hidden bg-slate-100">
    <!-- 左侧导航 -->
    <div class="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div class="flex items-center gap-3 px-6 py-5">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">P</div>
        <span class="text-sm font-semibold text-slate-900">Plant3D Web</span>
      </div>
      <nav class="flex flex-col gap-1 px-4">
        <button type="button"
          class="flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-600">
          <LayoutDashboard class="h-5 w-5" />
          首页 (Dashboard)
        </button>
        <button type="button"
          class="flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <Folder class="h-5 w-5" />
          模型工程
        </button>
        <button type="button"
          class="flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          @click="ensurePanelAndActivate('review')">
          <CheckSquare class="h-5 w-5" />
          校审批注
        </button>
      </nav>
    </div>

    <!-- 主内容区 -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- 顶部栏 -->
      <div class="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
        <h1 class="text-xl font-semibold text-slate-900">概览</h1>
        <div class="flex items-center gap-3">
          <button type="button"
            class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            :disabled="isLoading"
            @click="refreshData">
            <RefreshCw :class="['h-5 w-5', isLoading && 'animate-spin']" />
          </button>
          <div v-if="currentUser" class="flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-sm font-semibold text-white">
              {{ currentUser.name.charAt(0) }}
            </div>
          </div>
        </div>
      </div>

      <!-- 滚动区域 -->
      <div class="flex-1 overflow-y-auto p-8">
        <div class="flex flex-col gap-8">

          <!-- 快捷操作 -->
          <section>
            <h2 class="mb-4 text-lg font-semibold text-slate-900">快捷操作</h2>
            <div class="grid grid-cols-4 gap-4">
              <button v-for="action in quickActions" :key="action.id"
                type="button"
                class="flex flex-col items-start gap-3 rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:shadow-md"
                @click="handleQuickAction(action.id)">
                <div class="flex h-10 w-10 items-center justify-center rounded-lg" :class="action.bgColor">
                  <component :is="action.icon" class="h-5 w-5" :class="action.iconColor" />
                </div>
                <span class="text-base font-medium text-slate-800">{{ action.label }}</span>
              </button>
            </div>
          </section>

          <!-- 两列布局 -->
          <div class="grid grid-cols-2 gap-6">
            <!-- 左列：数据统计 -->
            <div class="flex flex-col gap-6">
              <section>
                <h2 class="mb-4 text-lg font-semibold text-slate-900">数据统计</h2>
                <div class="flex flex-col gap-4">
                  <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4">
                    <div class="text-sm text-slate-500">总工作项</div>
                    <div class="text-2xl font-bold text-slate-900">{{ stats.total }}</div>
                  </div>
                  <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4">
                    <div class="text-sm text-slate-500">审核中任务</div>
                    <div class="text-2xl font-bold text-amber-600">{{ stats.inReview }}</div>
                  </div>
                  <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4">
                    <div class="text-sm text-slate-500">审核通过率</div>
                    <div class="text-2xl font-bold text-emerald-600">{{ stats.approvalRate }}%</div>
                  </div>
                </div>
              </section>

              <!-- 模型健康度看板 -->
              <section>
                <h2 class="mb-4 text-lg font-semibold text-slate-900">模型健康度看板</h2>
                <div class="flex items-center justify-around rounded-xl border border-slate-200 bg-white p-6">
                  <div class="flex flex-col items-center gap-2">
                    <div class="relative flex h-20 w-20 items-center justify-center">
                      <svg class="h-20 w-20 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E5E7EB" stroke-width="3" />
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#10B981" stroke-width="3"
                          stroke-dasharray="88 100" stroke-linecap="round" />
                      </svg>
                      <span class="absolute text-lg font-bold text-emerald-600">88%</span>
                    </div>
                    <span class="text-xs text-slate-500">设计完成率</span>
                  </div>
                  <div class="h-16 w-px bg-slate-200" />
                  <div class="flex flex-col items-center gap-2">
                    <div class="relative flex h-20 w-20 items-center justify-center">
                      <svg class="h-20 w-20 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E5E7EB" stroke-width="3" />
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3B82F6" stroke-width="3"
                          stroke-dasharray="92 100" stroke-linecap="round" />
                      </svg>
                      <span class="absolute text-lg font-bold text-blue-600">92%</span>
                    </div>
                    <span class="text-xs text-slate-500">渲染准确率</span>
                  </div>
                </div>
              </section>
            </div>

            <!-- 右列：任务概览 + 团队动态 -->
            <div class="flex flex-col gap-6">
              <section>
                <h2 class="mb-4 text-lg font-semibold text-slate-900">任务概览</h2>
                <div class="rounded-xl border border-slate-200 bg-white p-6">
                  <div class="mb-4 flex items-center gap-6 border-b border-slate-200 pb-3 text-sm">
                    <span class="font-semibold text-blue-600">我发起的</span>
                    <span class="text-slate-400">我审核的</span>
                  </div>
                  <div v-if="recentTasks.length === 0" class="py-4 text-center text-sm text-slate-400">
                    暂无任务
                  </div>
                  <div v-else class="flex flex-col gap-3">
                    <div v-for="task in recentTasks" :key="task.id"
                      class="flex items-center justify-between gap-3">
                      <div class="flex min-w-0 items-center gap-2">
                        <Clock class="h-4 w-4 shrink-0 text-slate-400" />
                        <span class="truncate text-sm text-slate-700">{{ task.title }}</span>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <span class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          :class="getStatusBadge(task.status).cls">
                          {{ getStatusBadge(task.status).label }}
                        </span>
                        <span class="text-[11px] text-slate-400">{{ formatDate(task.updatedAt) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 class="mb-4 text-lg font-semibold text-slate-900">团队动态</h2>
                <div class="rounded-xl border border-slate-200 bg-white p-5">
                  <div class="flex flex-col gap-4">
                    <div class="flex gap-3">
                      <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-600">
                        张
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="text-sm">
                          <span class="font-semibold text-slate-900">王建国 (王工)</span>
                        </div>
                        <p class="mt-0.5 text-xs text-slate-500">
                          提交了一份1号厂房管线碰撞问题包 · 涉及给排水专业全部4区...
                        </p>
                        <span class="mt-1 block text-[11px] text-slate-400">3小时前</span>
                      </div>
                    </div>
                    <div class="flex gap-3">
                      <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-600">
                        张
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="text-sm">
                          <span class="font-semibold text-slate-900">张晓明 (项目总)</span>
                        </div>
                        <p class="mt-0.5 text-xs text-slate-500">
                          完成了 2 号厂房方案 3 处管线碰撞修复，通报配套专业维护检查评估...
                        </p>
                        <span class="mt-1 block text-[11px] text-slate-400">9小时前</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <!-- 最近打开的工程 -->
          <section>
            <h2 class="mb-4 text-lg font-semibold text-slate-900">最近打开的工程</h2>
            <div class="grid grid-cols-3 gap-4">
              <div v-for="i in 3" :key="i"
                class="cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:shadow-md">
                <div class="h-24 bg-slate-200" />
                <div class="p-4">
                  <div class="text-sm font-medium text-slate-900">工程项目 {{ i }}</div>
                  <div class="mt-1 text-xs text-slate-400">最近修改 · 2天前</div>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  </div>
</template>
