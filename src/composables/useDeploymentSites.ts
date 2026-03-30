import { computed, reactive, ref } from 'vue';

import type {
  DeploymentSite,
  DeploymentSiteCreateRequest,
  DeploymentSiteImportRequest,
  DeploymentSiteQueryParams,
  DeploymentSiteUpdateRequest,
} from '@/types/site';

import {
  createDeploymentSite,
  deleteDeploymentSite,
  getDeploymentSite,
  getDeploymentSites,
  healthcheckDeploymentSite,
  importDeploymentSiteFromDbOption,
  updateDeploymentSite,
} from '@/api/siteRegistryApi';

export type DeploymentSiteStats = {
  total: number;
  running: number;
  failed: number;
  offline: number;
  deploying: number;
  configuring: number;
};

export type DeploymentSitePagination = {
  total: number;
  page: number;
  per_page: number;
  pages: number;
};

const sites = ref<DeploymentSite[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedSite = ref<DeploymentSite | null>(null);
const initialized = ref(false);
const pagination = ref<DeploymentSitePagination>({
  total: 0,
  page: 1,
  per_page: 20,
  pages: 1,
});

const filters = reactive<DeploymentSiteQueryParams>({
  q: '',
  status: '',
  owner: '',
  env: '',
  region: '',
  project_name: '',
  page: 1,
  per_page: 20,
  sort: 'updated_at:desc',
});

function normalizeErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) {
    return `${fallback}: ${err.message}`;
  }
  return fallback;
}

async function loadSites(query?: Partial<DeploymentSiteQueryParams>): Promise<void> {
  loading.value = true;
  error.value = null;

  if (query) {
    Object.assign(filters, query);
  }

  try {
    const response = await getDeploymentSites({ ...filters });
    sites.value = Array.isArray(response.items) ? response.items : [];
    pagination.value = {
      total: Number.isFinite(response.total) ? response.total : sites.value.length,
      page: Number.isFinite(response.page) ? response.page : Number(filters.page ?? 1),
      per_page: Number.isFinite(response.per_page) ? response.per_page : Number(filters.per_page ?? 20),
      pages: Number.isFinite(response.pages) ? response.pages : 1,
    };
  } catch (err) {
    sites.value = [];
    pagination.value = {
      total: 0,
      page: Number(filters.page ?? 1),
      per_page: Number(filters.per_page ?? 20),
      pages: 1,
    };
    error.value = normalizeErrorMessage(err, '加载站点列表失败');
  } finally {
    loading.value = false;
    initialized.value = true;
  }
}

async function openSiteDetail(siteId: string): Promise<DeploymentSite | null> {
  error.value = null;
  try {
    const detail = await getDeploymentSite(siteId);
    selectedSite.value = detail;
    return detail;
  } catch (err) {
    error.value = normalizeErrorMessage(err, '加载站点详情失败');
    return null;
  }
}

async function createSite(payload: DeploymentSiteCreateRequest): Promise<DeploymentSite | null> {
  error.value = null;
  try {
    const response = await createDeploymentSite(payload);
    await loadSites();
    const detail = response.item ?? null;
    if (detail) {
      selectedSite.value = detail;
    }
    return detail;
  } catch (err) {
    error.value = normalizeErrorMessage(err, '创建站点失败');
    return null;
  }
}

async function importSite(payload: DeploymentSiteImportRequest): Promise<DeploymentSite | null> {
  error.value = null;
  try {
    const response = await importDeploymentSiteFromDbOption(payload);
    await loadSites();
    const detail = response.item ?? null;
    if (detail) {
      selectedSite.value = detail;
    }
    return detail;
  } catch (err) {
    error.value = normalizeErrorMessage(err, '导入站点失败');
    return null;
  }
}

async function updateSite(siteId: string, payload: DeploymentSiteUpdateRequest): Promise<DeploymentSite | null> {
  error.value = null;
  try {
    const response = await updateDeploymentSite(siteId, payload);
    await loadSites();
    const detail = response.item ?? null;
    if (detail) {
      selectedSite.value = detail;
    }
    return detail;
  } catch (err) {
    error.value = normalizeErrorMessage(err, '更新站点失败');
    return null;
  }
}

async function removeSite(siteId: string): Promise<boolean> {
  error.value = null;
  try {
    await deleteDeploymentSite(siteId);
    if (selectedSite.value?.site_id === siteId) {
      selectedSite.value = null;
    }
    await loadSites();
    return true;
  } catch (err) {
    error.value = normalizeErrorMessage(err, '删除站点失败');
    return false;
  }
}

async function healthcheckSite(siteId: string): Promise<DeploymentSite | null> {
  error.value = null;
  try {
    const response = await healthcheckDeploymentSite(siteId);
    await loadSites();
    const detail = response.item ?? null;
    if (detail && selectedSite.value?.site_id === siteId) {
      selectedSite.value = detail;
    }
    return detail;
  } catch (err) {
    error.value = normalizeErrorMessage(err, '站点健康检查失败');
    return null;
  }
}

const stats = computed<DeploymentSiteStats>(() => {
  const summary: DeploymentSiteStats = {
    total: sites.value.length,
    running: 0,
    failed: 0,
    offline: 0,
    deploying: 0,
    configuring: 0,
  };

  for (const site of sites.value) {
    switch (site.status) {
      case 'Running':
        summary.running += 1;
        break;
      case 'Failed':
        summary.failed += 1;
        break;
      case 'Offline':
        summary.offline += 1;
        break;
      case 'Deploying':
        summary.deploying += 1;
        break;
      case 'Configuring':
        summary.configuring += 1;
        break;
      default:
        break;
    }
  }

  return summary;
});

export function useDeploymentSites() {
  if (!initialized.value) {
    void loadSites();
  }

  return {
    sites: computed(() => sites.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    filters,
    pagination: computed(() => pagination.value),
    stats,
    selectedSite: computed(() => selectedSite.value),
    loadSites,
    openSiteDetail,
    createSite,
    importSite,
    updateSite,
    deleteSite: removeSite,
    healthcheckSite,
  };
}
