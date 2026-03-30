import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import type { DeploymentSite, DeploymentSiteIdentity } from '@/types/site';

const listSitesMock = vi.fn();
const getSiteMock = vi.fn();
const createSiteMock = vi.fn();
const updateSiteMock = vi.fn();
const deleteSiteMock = vi.fn();
const healthcheckSiteMock = vi.fn();
const getCurrentSiteIdentityMock = vi.fn();

vi.mock('@/api/siteRegistryApi', () => ({
  getDeploymentSites: listSitesMock,
  getDeploymentSite: getSiteMock,
  createDeploymentSite: createSiteMock,
  updateDeploymentSite: updateSiteMock,
  deleteDeploymentSite: deleteSiteMock,
  healthcheckDeploymentSite: healthcheckSiteMock,
  getCurrentSiteIdentity: getCurrentSiteIdentityMock,
}));

const flushPromises = async () => {
  await Promise.resolve();
  await nextTick();
};

function buildSite(partial: Partial<DeploymentSite> = {}): DeploymentSite {
  return {
    site_id: partial.site_id ?? 'site-1',
    name: partial.name ?? 'Site 1',
    project_name: partial.project_name ?? 'AvevaMarineSample',
    bind_host: partial.bind_host ?? '127.0.0.1',
    bind_port: partial.bind_port ?? 3100,
    status: partial.status ?? 'Running',
    config: partial.config ?? {
      name: '配置',
      manual_db_nums: [],
      manual_refnos: [],
      project_name: 'AvevaMarineSample',
      project_path: '',
      project_code: 1516,
      mdb_name: 'ALL',
      module: 'DESI',
      db_type: 'surrealdb',
      surreal_ns: 1516,
      db_ip: '127.0.0.1',
      db_port: '8009',
      db_user: 'root',
      db_password: 'root',
      gen_model: true,
      gen_mesh: true,
      gen_spatial_tree: true,
      apply_boolean_operation: true,
      mesh_tol_ratio: 0.01,
      room_keyword: '-RM',
      export_json: false,
      export_parquet: true,
    },
    ...partial,
  };
}

describe('useDeploymentSites', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    listSitesMock.mockResolvedValue({
      items: [
        buildSite({ site_id: 'running-1', status: 'Running', name: 'Running Site' }),
        buildSite({ site_id: 'failed-1', status: 'Failed', name: 'Failed Site' }),
        buildSite({ site_id: 'offline-1', status: 'Offline', name: 'Offline Site' }),
      ],
      total: 3,
      page: 1,
      per_page: 20,
      pages: 1,
    });
    getSiteMock.mockImplementation(async (siteId: string) => buildSite({ site_id: siteId, name: `Detail ${siteId}` }));
    createSiteMock.mockResolvedValue({ status: 'success', item: buildSite({ site_id: 'created-1', name: 'Created Site' }) });
    updateSiteMock.mockResolvedValue({ status: 'success', item: buildSite({ site_id: 'running-1', name: 'Running Site Updated' }) });
    deleteSiteMock.mockResolvedValue({ status: 'success' });
    healthcheckSiteMock.mockResolvedValue({ status: 'success', healthy: true, item: buildSite({ site_id: 'running-1', status: 'Running' }) });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('应正确统计 Running / Failed / Offline 数量', async () => {
    const { useDeploymentSites } = await import('./useDeploymentSites');

    const sitesState = useDeploymentSites();
    await flushPromises();

    expect(sitesState.stats.value.total).toBe(3);
    expect(sitesState.stats.value.running).toBe(1);
    expect(sitesState.stats.value.failed).toBe(1);
    expect(sitesState.stats.value.offline).toBe(1);
  });

  it('应暴露列表分页元信息', async () => {
    const { useDeploymentSites } = await import('./useDeploymentSites');

    const sitesState = useDeploymentSites();
    await flushPromises();

    expect(sitesState.pagination.value.total).toBe(3);
    expect(sitesState.pagination.value.page).toBe(1);
    expect(sitesState.pagination.value.per_page).toBe(20);
    expect(sitesState.pagination.value.pages).toBe(1);
  });

  it('openSiteDetail 应按 site_id 读取详情并设置 selectedSite', async () => {
    const { useDeploymentSites } = await import('./useDeploymentSites');

    const sitesState = useDeploymentSites();
    await flushPromises();
    await sitesState.openSiteDetail('running-1');

    expect(getSiteMock).toHaveBeenCalledWith('running-1');
    expect(sitesState.selectedSite.value?.site_id).toBe('running-1');
    expect(sitesState.selectedSite.value?.name).toBe('Detail running-1');
  });

  it('loadSites 失败时应设置 error', async () => {
    listSitesMock.mockRejectedValueOnce(new Error('network down'));
    const { useDeploymentSites } = await import('./useDeploymentSites');

    const sitesState = useDeploymentSites();
    await flushPromises();

    expect(sitesState.error.value).toContain('network down');
    expect(sitesState.loading.value).toBe(false);
  });
});

describe('useCurrentSiteIdentity', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getCurrentSiteIdentityMock.mockResolvedValue({
      site_id: 'running-1',
      site_name: 'Running Site',
      registration_status: 'registered',
      backend_url: 'http://127.0.0.1:3100',
    } satisfies Partial<DeploymentSiteIdentity>);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('应按 site_id 判断当前站点', async () => {
    const { useCurrentSiteIdentity } = await import('./useCurrentSiteIdentity');

    const identityState = useCurrentSiteIdentity();
    await flushPromises();

    expect(identityState.identity.value?.site_id).toBe('running-1');
    expect(identityState.isCurrentSite(buildSite({ site_id: 'running-1' }))).toBe(true);
    expect(identityState.isCurrentSite(buildSite({ site_id: 'other-site' }))).toBe(false);
  });

  it('刷新失败时应设置 error', async () => {
    getCurrentSiteIdentityMock.mockRejectedValueOnce(new Error('identity failed'));
    const { useCurrentSiteIdentity } = await import('./useCurrentSiteIdentity');

    const identityState = useCurrentSiteIdentity();
    await flushPromises();

    expect(identityState.error.value).toContain('identity failed');
    expect(identityState.loading.value).toBe(false);
  });
});
