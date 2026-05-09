<template>
  <div class="h-full flex flex-col bg-[#F8FAFC] text-slate-900" data-testid="site-dashboard-shell">
    <header class="h-20 shrink-0 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-slate-900">站点管理</h2>
        <p class="text-sm text-slate-500 mt-1">
          <template v-if="identity?.site_id">
            当前站点：{{ identity.site_name || identity.site_id }}
          </template>
          <template v-else>
            当前站点身份未注册
          </template>
        </p>
      </div>
      <div class="flex items-center gap-3">
        <button class="px-4 py-2 rounded-lg bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          data-testid="site-create-open"
          @click="creationWizardOpen = true">
          新建站点
        </button>
        <button class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          @click="refreshAll">
          刷新
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-6 space-y-6">
      <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <button class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-left transition-colors hover:border-blue-200 hover:bg-blue-50/40"
          :class="!filters.status ? 'ring-1 ring-blue-200 border-blue-200 bg-blue-50/50' : ''"
          data-testid="site-stat-card-total"
          @click="applyStatusQuickFilter('')">
          <p class="text-sm text-slate-500">总站点数</p>
          <p class="text-3xl font-bold text-slate-900 mt-3">{{ stats.total }}</p>
        </button>
        <button class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"
          :class="filters.status === 'Running' ? 'ring-1 ring-emerald-200 border-emerald-200 bg-emerald-50/50' : ''"
          data-testid="site-stat-card-running"
          @click="applyStatusQuickFilter('Running')">
          <p class="text-sm text-slate-500">运行中</p>
          <p class="text-3xl font-bold text-emerald-600 mt-3">{{ stats.running }}</p>
        </button>
        <button class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-left transition-colors hover:border-amber-200 hover:bg-amber-50/40"
          :class="filters.status === 'Offline' ? 'ring-1 ring-amber-200 border-amber-200 bg-amber-50/50' : ''"
          data-testid="site-stat-card-offline"
          @click="applyStatusQuickFilter('Offline')">
          <p class="text-sm text-slate-500">离线</p>
          <p class="text-3xl font-bold text-amber-600 mt-3">{{ stats.offline }}</p>
        </button>
        <button class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-left transition-colors hover:border-rose-200 hover:bg-rose-50/40"
          :class="filters.status === 'Failed' ? 'ring-1 ring-rose-200 border-rose-200 bg-rose-50/50' : ''"
          data-testid="site-stat-card-failed"
          @click="applyStatusQuickFilter('Failed')">
          <p class="text-sm text-slate-500">失败</p>
          <p class="text-3xl font-bold text-rose-600 mt-3">{{ stats.failed }}</p>
        </button>
        <article class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <p class="text-sm text-slate-500">当前站点</p>
          <p class="text-base font-semibold text-slate-900 mt-3 break-all">
            {{ identity?.site_name || identity?.site_id || '未注册' }}
          </p>
        </article>
      </section>

      <section class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 class="text-lg font-semibold text-slate-900">站点列表</h3>
            <p class="text-xs text-slate-400 mt-1">控制台读取 deployment-sites 事实源</p>
          </div>
        </div>

        <div class="px-6 py-4 border-b border-slate-100 bg-slate-50/70 space-y-3">
          <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_160px_180px_auto] gap-3 items-end">
            <label class="flex flex-col gap-1 text-sm text-slate-600">
              <span>关键词</span>
              <input v-model="filters.q"
                data-testid="site-filter-search"
                type="text"
                placeholder="搜索站点名、项目名或地址"
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </label>

            <label class="flex flex-col gap-1 text-sm text-slate-600">
              <span>状态</span>
              <select v-model="filters.status"
                data-testid="site-filter-status"
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                @change="quickFilterSourceLabel = null">
                <option value="">全部状态</option>
                <option value="Running">运行中</option>
                <option value="Offline">离线</option>
                <option value="Failed">失败</option>
                <option value="Deploying">部署中</option>
                <option value="Configuring">配置中</option>
              </select>
            </label>

            <label class="flex flex-col gap-1 text-sm text-slate-600">
              <span>排序</span>
              <select v-model="filters.sort"
                data-testid="site-filter-sort"
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                <option value="updated_at:desc">最近更新</option>
                <option value="name:asc">名称 A-Z</option>
                <option value="name:desc">名称 Z-A</option>
              </select>
            </label>

            <div class="flex items-center gap-2">
              <button class="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                data-testid="site-filter-advanced-toggle"
                @click="advancedFiltersOpen = !advancedFiltersOpen">
                {{ showAdvancedFilters ? '收起高级筛选' : '展开高级筛选' }}
              </button>
              <button class="h-10 px-4 rounded-lg bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                data-testid="site-filter-apply"
                @click="applySiteFilters">
                应用筛选
              </button>
              <button class="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                data-testid="site-filter-clear"
                @click="clearSiteFilters">
                清空
              </button>
            </div>
          </div>

          <div v-if="showAdvancedFilters"
            class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-end"
            data-testid="site-filter-advanced-panel">
            <label class="flex flex-col gap-1 text-sm text-slate-600">
              <span>地域</span>
              <select v-model="filters.region"
                data-testid="site-filter-region"
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                <option value="">全部地域</option>
                <option value="cn-east">cn-east</option>
                <option value="cn-west">cn-west</option>
              </select>
            </label>

            <label class="flex flex-col gap-1 text-sm text-slate-600">
              <span>负责人</span>
              <input v-model="filters.owner"
                data-testid="site-filter-owner"
                type="text"
                placeholder="例如 alice"
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </label>

            <label class="flex flex-col gap-1 text-sm text-slate-600">
              <span>环境</span>
              <select v-model="filters.env"
                data-testid="site-filter-env"
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                <option value="">全部环境</option>
                <option value="prod">prod</option>
                <option value="staging">staging</option>
                <option value="dev">dev</option>
              </select>
            </label>

            <label class="flex flex-col gap-1 text-sm text-slate-600">
              <span>项目</span>
              <input v-model="filters.project_name"
                data-testid="site-filter-project"
                type="text"
                placeholder="例如 RemoteProject"
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </label>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500"
            data-testid="site-filter-summary">
            <span>当前共 {{ sites.length }} 个站点</span>
            <span v-if="activeFilterCount > 0"
              class="inline-flex rounded-full bg-blue-50 px-2 py-1 text-blue-700">
              已应用 {{ activeFilterCount }} 项筛选
            </span>
            <span v-else>未应用额外筛选</span>
          </div>

          <div v-if="quickFilterFeedback"
            class="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
            data-testid="site-quick-filter-feedback">
            {{ quickFilterFeedback }}
          </div>

          <div v-if="activeFilterChips.length > 0"
            class="flex flex-wrap items-center gap-2"
            data-testid="site-filter-chips">
            <span v-for="chip in activeFilterChips"
              :key="chip.key"
              class="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
              <span>{{ chip.label }}: {{ chip.value }}</span>
              <button type="button"
                class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-blue-700 transition-colors hover:bg-blue-100"
                :data-testid="`site-filter-chip-remove-${chip.key}`"
                @click="removeFilterChip(chip.key)">
                ×
              </button>
            </span>
          </div>
        </div>

        <div v-if="loading" class="px-6 py-8 text-sm text-slate-500">正在加载站点列表...</div>
        <div v-else-if="error" class="px-6 py-8 text-sm text-rose-500">{{ error }}</div>
        <div v-else-if="sites.length === 0"
          class="px-6 py-10 text-center space-y-3">
          <p v-if="hasActiveFilters"
            class="text-sm text-slate-500">
            当前筛选条件下没有匹配站点，请调整筛选项后重试。
          </p>
          <p v-else
            class="text-sm text-slate-500">
            还没有已注册站点，请先新建或导入站点。
          </p>
          <button v-if="hasActiveFilters"
            class="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            data-testid="site-empty-clear-filters"
            @click="clearSiteFilters">
            清空筛选
          </button>
        </div>
        <div v-else class="divide-y divide-slate-100">
          <article v-for="site in sites"
            :key="site.site_id"
            class="px-6 py-4 flex items-center justify-between gap-4"
            :data-testid="`site-row-${site.site_id}`">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h4 class="font-semibold text-slate-900">{{ site.name }}</h4>
                <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="getStatusBadgeClass(site.status)"
                  :data-testid="`site-status-badge-${site.site_id}`">
                  {{ site.status }}
                </span>
                <span v-if="isCurrentSite(site)"
                  class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
                  当前站点
                </span>
              </div>
              <p class="text-sm text-slate-500 mt-1">
                {{ site.project_name }} · {{ site.backend_url || `${site.bind_host}:${site.bind_port || ''}` }}
              </p>
            </div>
            <button class="text-sm font-medium text-blue-600 hover:text-blue-800"
              @click="handleOpenSiteDetail(site.site_id)">
              查看详情
            </button>
          </article>
        </div>

        <div class="flex flex-col gap-3 border-t border-slate-100 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div class="flex items-center gap-2 text-sm text-slate-500">
            <span>第 {{ pagination.page }} / {{ pagination.pages }} 页</span>
            <span class="text-slate-300">·</span>
            <span>总计 {{ pagination.total }} 条</span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-2 text-sm text-slate-600">
              <span>每页</span>
              <select v-model="filters.per_page"
                data-testid="site-pagination-per-page"
                class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                @change="handlePerPageChange">
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
            </label>

            <button class="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="site-pagination-prev"
              :disabled="!canGoPrevPage"
              @click="handlePageChange(pagination.page - 1)">
              上一页
            </button>
            <button class="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="site-pagination-next"
              :disabled="!canGoNextPage"
              @click="handlePageChange(pagination.page + 1)">
              下一页
            </button>
          </div>
        </div>
      </section>
    </div>

    <SiteDetailDrawer :open="detailDrawerOpen"
      :site="selectedSite"
      :is-current-site="isSelectedCurrentSite"
      :busy="actionBusy"
      @close="closeDetailDrawer"
      @healthcheck="handleHealthcheck"
      @open-frontend="handleOpenFrontend"
      @copy-backend="handleCopyBackend"
      @edit="handleEditSite"
      @delete="handleDeleteSite"
      @create-parsing-task="handleTaskShortcut('parsing')"
      @create-model-task="handleTaskShortcut('model')"
      @open-task-monitor="handleTaskShortcut('monitor')" />

    <SiteCreationWizard :open="creationWizardOpen"
      @update:open="creationWizardOpen = $event"
      @created="handleCreatedSite" />

    <SiteEditWizard :open="editWizardOpen"
      :site="selectedSite"
      @update:open="editWizardOpen = $event"
      @saved="handleEditedSite" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import SiteCreationWizard from '@/components/site/SiteCreationWizard.vue';
import SiteDetailDrawer from '@/components/site/SiteDetailDrawer.vue';
import SiteEditWizard from '@/components/site/SiteEditWizard.vue';
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';
import { useCurrentSiteIdentity } from '@/composables/useCurrentSiteIdentity';
import { useDeploymentSites } from '@/composables/useDeploymentSites';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useTaskCreationStore } from '@/composables/useTaskCreationStore';
import { emitToast } from '@/ribbon/toastBus';

const {
  sites,
  loading,
  error,
  filters,
  pagination,
  stats,
  loadSites,
  openSiteDetail,
  selectedSite,
  deleteSite,
  healthcheckSite,
} = useDeploymentSites();

const {
  identity,
  refresh,
  isCurrentSite,
} = useCurrentSiteIdentity();
const taskCreationStore = useTaskCreationStore();
const confirmDialog = useConfirmDialogStore();

const detailDrawerOpen = ref(false);
const creationWizardOpen = ref(false);
const editWizardOpen = ref(false);
const actionBusy = ref(false);
const advancedFiltersOpen = ref(false);
const quickFilterSourceLabel = ref<string | null>(null);

const refreshAll = async () => {
  await Promise.all([loadSites(), refresh()]);
};

const isSelectedCurrentSite = computed(() => isCurrentSite(selectedSite.value));
const canGoPrevPage = computed(() => pagination.value.page > 1);
const canGoNextPage = computed(() => pagination.value.page < pagination.value.pages);
const activeFilterChips = computed(() => {
  const chipDefs = [
    { key: 'q', label: '关键词', value: filters.q?.trim() || '' },
    { key: 'status', label: '状态', value: filters.status || '' },
    { key: 'region', label: '地域', value: filters.region || '' },
    { key: 'owner', label: '负责人', value: filters.owner?.trim() || '' },
    { key: 'env', label: '环境', value: filters.env || '' },
    { key: 'project_name', label: '项目', value: filters.project_name?.trim() || '' },
  ] as const;

  return chipDefs.filter((chip) => chip.value);
});
const activeFilterCount = computed(() => {
  const candidates = [
    filters.q,
    filters.status,
    filters.region,
    filters.owner,
    filters.env,
    filters.project_name,
  ];

  return candidates.reduce((count, value) => {
    if (typeof value === 'string' && value.trim()) {
      return count + 1;
    }
    return count;
  }, 0);
});
const hasActiveFilters = computed(() => activeFilterCount.value > 0);
const hasActiveAdvancedFilters = computed(() => {
  const candidates = [
    filters.region,
    filters.owner,
    filters.env,
    filters.project_name,
  ];

  return candidates.some((value) => typeof value === 'string' && value.trim());
});
const showAdvancedFilters = computed(() => advancedFiltersOpen.value || hasActiveAdvancedFilters.value);
const quickFilterFeedback = computed(() => {
  if (!quickFilterSourceLabel.value) return '';
  return `当前通过“${quickFilterSourceLabel.value}”快捷筛选查看站点`;
});

function getStatusBadgeClass(status: string | undefined) {
  switch (status) {
    case 'Running':
      return 'bg-emerald-100 text-emerald-700';
    case 'Offline':
      return 'bg-amber-100 text-amber-700';
    case 'Failed':
      return 'bg-rose-100 text-rose-700';
    case 'Deploying':
      return 'bg-sky-100 text-sky-700';
    case 'Configuring':
      return 'bg-violet-100 text-violet-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

async function applySiteFilters() {
  await loadSites({
    q: filters.q?.trim() || '',
    status: filters.status || '',
    region: filters.region || '',
    owner: filters.owner?.trim() || '',
    env: filters.env || '',
    project_name: filters.project_name?.trim() || '',
    sort: filters.sort || 'updated_at:desc',
    page: 1,
  });
}

async function applyStatusQuickFilter(status: string) {
  filters.status = status;
  quickFilterSourceLabel.value = status ? getStatusLabel(status) : null;
  await applySiteFilters();
}

async function removeFilterChip(key: 'q' | 'status' | 'region' | 'owner' | 'env' | 'project_name') {
  filters[key] = '';
  if (key === 'status') {
    quickFilterSourceLabel.value = null;
  }
  await applySiteFilters();
}

async function handlePageChange(targetPage: number) {
  const safePage = Math.min(Math.max(targetPage, 1), Math.max(pagination.value.pages, 1));
  if (safePage === pagination.value.page) return;

  await loadSites({
    page: safePage,
    per_page: filters.per_page ?? pagination.value.per_page,
  });
}

async function handlePerPageChange() {
  const nextPerPage = Number(filters.per_page ?? pagination.value.per_page ?? 20);
  filters.per_page = nextPerPage;
  await loadSites({
    page: 1,
    per_page: nextPerPage,
  });
}

async function clearSiteFilters() {
  filters.q = '';
  filters.status = '';
  filters.region = '';
  filters.owner = '';
  filters.env = '';
  filters.project_name = '';
  filters.sort = 'updated_at:desc';
  quickFilterSourceLabel.value = null;
  await loadSites({
    q: '',
    status: '',
    region: '',
    owner: '',
    env: '',
    project_name: '',
    sort: 'updated_at:desc',
    page: 1,
  });
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'Running':
      return '运行中';
    case 'Offline':
      return '离线';
    case 'Failed':
      return '失败';
    case 'Deploying':
      return '部署中';
    case 'Configuring':
      return '配置中';
    default:
      return status;
  }
}

async function handleOpenSiteDetail(siteId: string) {
  detailDrawerOpen.value = true;
  await openSiteDetail(siteId);
}

function closeDetailDrawer() {
  detailDrawerOpen.value = false;
}

async function handleCreatedSite(siteId: string) {
  creationWizardOpen.value = false;
  await loadSites();
  await handleOpenSiteDetail(siteId);
  emitToast({
    level: 'success',
    message: `站点 [${siteId}] 已创建`,
  });
}

async function handleHealthcheck() {
  if (!selectedSite.value) return;

  actionBusy.value = true;
  try {
    const detail = await healthcheckSite(selectedSite.value.site_id);
    if (detail) {
      emitToast({
        level: 'success',
        message: `站点 [${detail.name}] 健康检查已完成`,
      });
    } else {
      emitToast({
        level: 'error',
        message: '站点健康检查失败，请稍后重试',
      });
    }
  } finally {
    actionBusy.value = false;
  }
}

function handleOpenFrontend() {
  if (!selectedSite.value?.frontend_url) {
    emitToast({
      level: 'warning',
      message: '当前站点未配置 frontend_url',
    });
    return;
  }

  window.open(selectedSite.value.frontend_url, '_blank', 'noopener');
}

async function handleCopyBackend() {
  if (!selectedSite.value) return;

  const backendAddress = selectedSite.value.backend_url
    || `${selectedSite.value.bind_host}:${selectedSite.value.bind_port || ''}`.replace(/:$/, '');

  if (!backendAddress) {
    emitToast({
      level: 'warning',
      message: '当前站点缺少可复制的后端地址',
    });
    return;
  }

  try {
    await navigator.clipboard.writeText(backendAddress);
    emitToast({
      level: 'success',
      message: '后端地址已复制到剪贴板',
    });
  } catch {
    emitToast({
      level: 'error',
      message: '复制后端地址失败',
    });
  }
}

function handleEditSite() {
  if (!selectedSite.value) return;
  editWizardOpen.value = true;
}

async function handleEditedSite(siteId: string) {
  editWizardOpen.value = false;
  await loadSites();
  await handleOpenSiteDetail(siteId);
  emitToast({
    level: 'success',
    message: `站点 [${siteId}] 已更新`,
  });
}

async function handleDeleteSite() {
  if (!selectedSite.value) return;

  const target = selectedSite.value;
  const confirmed = await confirmDialog.open({
    title: '删除站点',
    message: `确认删除站点 [${target.name}] 吗？该操作会从站点注册表中移除当前站点。`,
    confirmText: '删除',
    cancelText: '取消',
  });

  if (!confirmed) {
    return;
  }

  actionBusy.value = true;
  try {
    const deleted = await deleteSite(target.site_id);
    if (deleted) {
      closeDetailDrawer();
      emitToast({
        level: 'success',
        message: `站点 [${target.name}] 已删除`,
      });
      return;
    }

    emitToast({
      level: 'error',
      message: `删除站点 [${target.name}] 失败`,
    });
  } finally {
    actionBusy.value = false;
  }
}

function handleTaskShortcut(kind: 'parsing' | 'model' | 'monitor') {
  if (!selectedSite.value) {
    return;
  }

  if (kind === 'monitor') {
    ensurePanelAndActivate('taskMonitor');
    return;
  }

  if (!isSelectedCurrentSite.value) {
    emitToast({
      level: 'info',
      message: '跨站任务调度未开放，请进入目标站点执行任务',
    });
    return;
  }

  taskCreationStore.setPresetType(kind === 'parsing' ? 'DataParsingWizard' : 'DataGeneration');
  taskCreationStore.setPresetContext({
    initialConfig: selectedSite.value.config,
    siteContext: {
      siteId: selectedSite.value.site_id,
      siteName: selectedSite.value.name,
      isCurrentSite: true,
    },
  });
  ensurePanelAndActivate('taskCreation');
  closeDetailDrawer();

  const labelMap = {
    parsing: '创建解析任务',
    model: '创建建模任务',
    monitor: '打开任务监控',
  } as const;

  emitToast({
    level: 'success',
    message: `${labelMap[kind]} 面板已打开`,
  });
}
</script>
