import { computed, ref } from 'vue';

import { getDashboardActivities, type DashboardActivityItem } from '@/api/dashboardApi';
import { taskGetSystemMetrics } from '@/api/genModelTaskApi';
import { type RecentProjectRecord, buildRecentProjectCards } from '@/composables/dashboardRecentProjects';
import { useModelProjects } from '@/composables/useModelProjects';
import { useUserStore } from '@/composables/useUserStore';
import { type ReviewTask, getPriorityDisplayName, getTaskStatusDisplayName } from '@/types/auth';

export type DashboardMetricCard = {
  id: string;
  label: string;
  value: string;
  hint?: string;
  tone: 'blue' | 'green' | 'amber' | 'slate';
};

export type DashboardReviewTaskItem = {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusClass: string;
  priorityLabel: string;
  priorityClass: string;
  actionText: string;
};

type TaskTabId = 'my_tasks' | 'pending_reviews';

function formatTaskSubtitle(task: ReviewTask): string {
  const parts = [task.modelName, task.requesterName].filter(Boolean);
  return parts.join(' · ');
}

function mapTask(task: ReviewTask, tab: TaskTabId): DashboardReviewTaskItem {
  const status = getTaskStatusDisplayName(task.status);
  const priority = getPriorityDisplayName(task.priority);
  return {
    id: task.id,
    title: task.title,
    subtitle: formatTaskSubtitle(task),
    statusLabel: status.label,
    statusClass: status.color,
    priorityLabel: priority.label,
    priorityClass: priority.color,
    actionText: tab === 'pending_reviews' ? '前往校审' : '查看进度',
  };
}

function formatLastUpdated(date: Date | null): string {
  if (!date) return '尚未刷新';
  return `更新于 ${date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

const activities = ref<DashboardActivityItem[]>([]);
const activitiesLoading = ref(false);
const activitiesError = ref<string | null>(null);
const statsLoading = ref(false);
const statsError = ref<string | null>(null);
const systemMetrics = ref<{
  cpuUsage: number;
  memoryUsage: number;
  activeTaskCount: number;
  queuedTaskCount: number;
  databaseConnected?: boolean;
  surrealdbConnected?: boolean;
  uptimeSeconds?: number;
} | null>(null);
const lastUpdatedAt = ref<Date | null>(null);

export function useDashboardWorkbench() {
  const { projects, isLoading: projectsLoading, loadProjects } = useModelProjects();
  const userStore = useUserStore();

  const currentUserName = computed(() => userStore.currentUser.value?.name || '当前用户');

  const metricCards = computed<DashboardMetricCard[]>(() => {
    const projectCount = projects.value.length;
    const activeTaskCount = systemMetrics.value?.activeTaskCount ?? 0;
    const pendingReviewCount = userStore.pendingReviewTasks.value.length;
    const dbConnected = systemMetrics.value?.databaseConnected;

    return [
      {
        id: 'projects',
        label: '项目总数',
        value: String(projectCount),
        hint: '当前可用项目',
        tone: 'blue',
      },
      {
        id: 'running_tasks',
        label: '运行中任务',
        value: String(activeTaskCount),
        hint: systemMetrics.value ? `排队 ${systemMetrics.value.queuedTaskCount} 个` : '等待系统状态',
        tone: 'green',
      },
      {
        id: 'pending_reviews',
        label: '待我评审',
        value: String(pendingReviewCount),
        hint: '来自当前审核流',
        tone: 'amber',
      },
      {
        id: 'system_status',
        label: '数据库状态',
        value: dbConnected == null ? '未知' : (dbConnected ? '正常' : '异常'),
        hint: systemMetrics.value
          ? `CPU ${Math.round(systemMetrics.value.cpuUsage)}% · 内存 ${Math.round(systemMetrics.value.memoryUsage)}%`
          : '等待系统状态',
        tone: 'slate',
      },
    ];
  });

  const taskGroups = computed<Record<TaskTabId, DashboardReviewTaskItem[]>>(() => ({
    my_tasks: [...userStore.myInitiatedTasks.value]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((task) => mapTask(task, 'my_tasks')),
    pending_reviews: [...userStore.pendingReviewTasks.value]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((task) => mapTask(task, 'pending_reviews')),
  }));

  const recentProjects = computed<RecentProjectRecord[]>(() => {
    return buildRecentProjectCards(projects.value);
  });

  const tasksLoading = computed(() => userStore.loading.value);
  const tasksError = computed(() => userStore.error.value);
  const recentProjectsLoading = computed(() => projectsLoading.value);
  const lastUpdatedLabel = computed(() => formatLastUpdated(lastUpdatedAt.value));

  async function refresh() {
    statsLoading.value = true;
    activitiesLoading.value = true;
    statsError.value = null;
    activitiesError.value = null;

    const results = await Promise.allSettled([
      loadProjects(),
      userStore.loadCurrentUser(),
      userStore.loadReviewTasks(),
      taskGetSystemMetrics(),
      getDashboardActivities(10),
    ]);

    const metricsResult = results[3];
    if (metricsResult.status === 'fulfilled') {
      if (metricsResult.value.success && metricsResult.value.metrics) {
        systemMetrics.value = metricsResult.value.metrics;
      } else {
        statsError.value = metricsResult.value.error_message || '系统状态加载失败';
      }
    } else {
      statsError.value = metricsResult.reason instanceof Error
        ? metricsResult.reason.message
        : '系统状态加载失败';
    }

    const activitiesResult = results[4];
    if (activitiesResult.status === 'fulfilled') {
      if (activitiesResult.value.success) {
        activities.value = Array.isArray(activitiesResult.value.data) ? activitiesResult.value.data : [];
      } else {
        activities.value = [];
        activitiesError.value = activitiesResult.value.error_message || '活动流加载失败';
      }
    } else {
      activities.value = [];
      activitiesError.value = activitiesResult.reason instanceof Error
        ? activitiesResult.reason.message
        : '活动流加载失败';
    }

    statsLoading.value = false;
    activitiesLoading.value = false;
    lastUpdatedAt.value = new Date();
  }

  return {
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
  };
}
