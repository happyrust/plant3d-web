import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, h, nextTick, reactive, ref } from 'vue';

import SiteDashboardPanel from './SiteDashboardPanel.vue';

import type { DeploymentSite } from '@/types/site';

const ensurePanelAndActivateMock = vi.fn();
const setPresetTypeMock = vi.fn();
const setPresetContextMock = vi.fn();
const confirmOpenMock = vi.fn();

const currentSite: DeploymentSite = {
  site_id: 'site-current',
  name: '当前站点',
  region: 'cn-east',
  owner: 'alice',
  env: 'prod',
  project_name: 'CurrentProject',
  project_path: '/data/current',
  project_code: 'CUR',
  frontend_url: 'http://current.example.com',
  backend_url: 'http://current.example.com/api',
  bind_host: '0.0.0.0',
  bind_port: 3100,
  status: 'Running',
  last_seen_at: '2026-03-28 18:00:00',
  config: {
    db_type: 'surrealdb',
    project_name: 'CurrentProject',
    project_code: 'CUR',
    project_path: '/data/current',
  },
};

const remoteSite: DeploymentSite = {
  site_id: 'site-remote',
  name: '远端站点',
  region: 'cn-west',
  owner: 'bob',
  env: 'staging',
  project_name: 'RemoteProject',
  project_path: '/data/remote',
  project_code: 'REM',
  frontend_url: 'http://remote.example.com',
  backend_url: 'http://remote.example.com/api',
  bind_host: '10.0.0.8',
  bind_port: 3200,
  status: 'Offline',
  last_seen_at: '2026-03-28 17:30:00',
  config: {
    db_type: 'surrealdb',
    project_name: 'RemoteProject',
    project_code: 'REM',
    project_path: '/data/remote',
  },
};

const deployingSite: DeploymentSite = {
  site_id: 'site-deploying',
  name: '部署中站点',
  region: 'cn-south',
  owner: 'carol',
  env: 'dev',
  project_name: 'DeployProject',
  project_path: '/data/deploy',
  project_code: 'DEP',
  frontend_url: 'http://deploy.example.com',
  backend_url: 'http://deploy.example.com/api',
  bind_host: '10.0.0.9',
  bind_port: 3300,
  status: 'Deploying',
  last_seen_at: '2026-03-28 16:30:00',
  config: {
    db_type: 'surrealdb',
    project_name: 'DeployProject',
    project_code: 'DEP',
    project_path: '/data/deploy',
  },
};

const sitesRef = ref<DeploymentSite[]>([]);
const selectedSiteRef = ref<DeploymentSite | null>(null);
const filtersState = reactive({
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
const paginationState = reactive({
  total: 42,
  page: 1,
  per_page: 20,
  pages: 3,
});
const identityRef = ref({
  site_id: 'site-current',
  site_name: '当前站点',
});

const loadSitesMock = vi.fn(async () => {});
const openSiteDetailMock = vi.fn(async (siteId: string) => {
  const detail = sitesRef.value.find((site) => site.site_id === siteId) ?? null;
  selectedSiteRef.value = detail;
  return detail;
});
const healthcheckSiteMock = vi.fn(async (siteId: string) => {
  const detail = sitesRef.value.find((site) => site.site_id === siteId) ?? null;
  if (detail) {
    selectedSiteRef.value = {
      ...detail,
      status: 'Running',
    };
  }
  return selectedSiteRef.value;
});
const deleteSiteMock = vi.fn(async () => true);
const createSiteMock = vi.fn(async () => null);
const importSiteMock = vi.fn(async () => null);
const updateSiteMock = vi.fn(async () => null);
const emitToastMock = vi.fn();

vi.mock('@/composables/useDeploymentSites', () => ({
  useDeploymentSites: () => ({
    sites: computed(() => sitesRef.value),
    loading: computed(() => false),
    error: computed(() => null),
    filters: filtersState,
    pagination: computed(() => paginationState),
    stats: computed(() => ({
      total: sitesRef.value.length,
      running: sitesRef.value.filter((site) => site.status === 'Running').length,
      failed: sitesRef.value.filter((site) => site.status === 'Failed').length,
      offline: sitesRef.value.filter((site) => site.status === 'Offline').length,
      deploying: 0,
      configuring: 0,
    })),
    selectedSite: computed(() => selectedSiteRef.value),
    loadSites: loadSitesMock,
    openSiteDetail: openSiteDetailMock,
    healthcheckSite: healthcheckSiteMock,
    deleteSite: deleteSiteMock,
    createSite: createSiteMock,
    importSite: importSiteMock,
    updateSite: updateSiteMock,
  }),
}));

vi.mock('@/composables/useCurrentSiteIdentity', () => ({
  useCurrentSiteIdentity: () => ({
    identity: computed(() => identityRef.value),
    refresh: vi.fn(async () => {}),
    isCurrentSite: (site: DeploymentSite | null | undefined) => site?.site_id === identityRef.value.site_id,
  }),
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: (payload: unknown) => emitToastMock(payload),
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: (panelId: string) => ensurePanelAndActivateMock(panelId),
}));

vi.mock('@/composables/useTaskCreationStore', () => ({
  useTaskCreationStore: () => ({
    setPresetType: (type: string | null) => setPresetTypeMock(type),
    setPresetContext: (payload: unknown) => setPresetContextMock(payload),
  }),
}));

vi.mock('@/composables/useConfirmDialogStore', () => ({
  useConfirmDialogStore: () => ({
    open: (options: unknown) => confirmOpenMock(options),
  }),
}));

function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const app = createApp({
    render: () => h(SiteDashboardPanel),
  });

  app.mount(host);

  return { app, host };
}

function click(host: HTMLElement, selector: string) {
  const el = host.querySelector(selector) as HTMLButtonElement | null;
  expect(el, `missing element: ${selector}`).toBeTruthy();
  el?.click();
}

function input(host: HTMLElement, selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLInputElement | null;
  expect(el, `missing input: ${selector}`).toBeTruthy();
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function select(host: HTMLElement, selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLSelectElement | null;
  expect(el, `missing select: ${selector}`).toBeTruthy();
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  sitesRef.value = [currentSite, remoteSite];
  selectedSiteRef.value = null;
  filtersState.q = '';
  filtersState.status = '';
  filtersState.owner = '';
  filtersState.env = '';
  filtersState.region = '';
  filtersState.project_name = '';
  filtersState.page = 1;
  filtersState.per_page = 20;
  filtersState.sort = 'updated_at:desc';
  paginationState.total = 42;
  paginationState.page = 1;
  paginationState.per_page = 20;
  paginationState.pages = 3;
  loadSitesMock.mockClear();
  openSiteDetailMock.mockClear();
  healthcheckSiteMock.mockClear();
  deleteSiteMock.mockClear();
  createSiteMock.mockClear();
  importSiteMock.mockClear();
  updateSiteMock.mockClear();
  emitToastMock.mockClear();
  ensurePanelAndActivateMock.mockClear();
  setPresetTypeMock.mockClear();
  setPresetContextMock.mockClear();
  confirmOpenMock.mockClear();
  confirmOpenMock.mockResolvedValue(true);

  vi.stubGlobal('open', vi.fn());
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: {
      writeText: vi.fn(async () => {}),
    },
    configurable: true,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('SiteDashboardPanel', () => {
  it('applies quick status filters from stats cards', async () => {
    const { host } = mountPanel();

    click(host, '[data-testid="site-stat-card-running"]');
    await nextTick();

    expect(loadSitesMock).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'Running',
      page: 1,
    }));
    expect(host.textContent).toContain('当前通过“运行中”快捷筛选查看站点');
    expect(host.querySelector('[data-testid="site-quick-filter-feedback"]')).toBeTruthy();

    click(host, '[data-testid="site-stat-card-total"]');
    await nextTick();

    expect(loadSitesMock).toHaveBeenLastCalledWith(expect.objectContaining({
      status: '',
      page: 1,
    }));
    expect(host.textContent).not.toContain('当前通过“运行中”快捷筛选查看站点');
  });

  it('toggles advanced filters panel', async () => {
    const { host } = mountPanel();

    expect(host.querySelector('[data-testid="site-filter-advanced-panel"]')).toBeNull();

    click(host, '[data-testid="site-filter-advanced-toggle"]');
    await nextTick();

    expect(host.querySelector('[data-testid="site-filter-advanced-panel"]')).toBeTruthy();
    expect(host.textContent).toContain('收起高级筛选');
  });

  it('renders status badges with differentiated styles', async () => {
    sitesRef.value = [currentSite, remoteSite, deployingSite];
    const { host } = mountPanel();

    const runningBadge = host.querySelector('[data-testid="site-status-badge-site-current"]');
    const offlineBadge = host.querySelector('[data-testid="site-status-badge-site-remote"]');
    const deployingBadge = host.querySelector('[data-testid="site-status-badge-site-deploying"]');

    expect(runningBadge?.className).toContain('bg-emerald-100');
    expect(offlineBadge?.className).toContain('bg-amber-100');
    expect(deployingBadge?.className).toContain('bg-sky-100');
  });

  it('distinguishes empty state from filtered no-results state', async () => {
    sitesRef.value = [];
    const { host } = mountPanel();

    expect(host.textContent).toContain('还没有已注册站点，请先新建或导入站点');

    filtersState.region = 'cn-west';
    await nextTick();

    expect(host.textContent).toContain('当前筛选条件下没有匹配站点');
    expect(host.querySelector('[data-testid="site-empty-clear-filters"]')).toBeTruthy();
  });

  it('shows active filter chips and removes a single filter', async () => {
    const { host } = mountPanel();

    click(host, '[data-testid="site-filter-advanced-toggle"]');
    await nextTick();

    select(host, '[data-testid="site-filter-region"]', 'cn-west');
    input(host, '[data-testid="site-filter-owner"]', 'bob');
    click(host, '[data-testid="site-filter-apply"]');
    await nextTick();

    expect(host.textContent).toContain('地域: cn-west');
    expect(host.textContent).toContain('负责人: bob');

    click(host, '[data-testid="site-filter-chip-remove-region"]');
    await nextTick();

    expect(loadSitesMock).toHaveBeenLastCalledWith(expect.objectContaining({
      region: '',
      owner: 'bob',
      page: 1,
    }));
  });

  it('changes page and per-page size via pagination controls', async () => {
    const { host } = mountPanel();

    expect(host.textContent).toContain('第 1 / 3 页');

    click(host, '[data-testid="site-pagination-next"]');
    await nextTick();

    expect(loadSitesMock).toHaveBeenCalledWith(expect.objectContaining({
      page: 2,
      per_page: 20,
    }));

    select(host, '[data-testid="site-pagination-per-page"]', '50');
    await nextTick();

    expect(loadSitesMock).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      per_page: 50,
    }));
  });

  it('applies region, owner, env and project filters and shows summary', async () => {
    const { host } = mountPanel();

    click(host, '[data-testid="site-filter-advanced-toggle"]');
    await nextTick();

    select(host, '[data-testid="site-filter-region"]', 'cn-west');
    input(host, '[data-testid="site-filter-owner"]', 'bob');
    select(host, '[data-testid="site-filter-env"]', 'staging');
    input(host, '[data-testid="site-filter-project"]', 'RemoteProject');
    click(host, '[data-testid="site-filter-apply"]');
    await nextTick();

    expect(loadSitesMock).toHaveBeenCalledWith(expect.objectContaining({
      region: 'cn-west',
      owner: 'bob',
      env: 'staging',
      project_name: 'RemoteProject',
      page: 1,
    }));
    expect(host.textContent).toContain('当前共 2 个站点');
    expect(host.textContent).toContain('已应用 4 项筛选');
  });

  it('applies search, status and sort filters via loadSites', async () => {
    const { host } = mountPanel();

    input(host, '[data-testid="site-filter-search"]', '远端');
    select(host, '[data-testid="site-filter-status"]', 'Offline');
    select(host, '[data-testid="site-filter-sort"]', 'name:asc');
    click(host, '[data-testid="site-filter-apply"]');
    await nextTick();

    expect(loadSitesMock).toHaveBeenCalledWith(expect.objectContaining({
      q: '远端',
      status: 'Offline',
      sort: 'name:asc',
      page: 1,
    }));
  });

  it('opens creation wizard from header action', async () => {
    const { host } = mountPanel();

    click(host, '[data-testid="site-create-open"]');
    await nextTick();

    expect(document.body.textContent).toContain('新建站点');
  });

  it('opens current site detail drawer and runs healthcheck', async () => {
    const { host } = mountPanel();

    (host.querySelector('[data-testid="site-row-site-current"] button') as HTMLButtonElement).click();
    await nextTick();

    expect(openSiteDetailMock).toHaveBeenCalledWith('site-current');
    expect(host.querySelector('[data-testid="site-detail-drawer"]')).toBeTruthy();
    expect(host.textContent).toContain('创建解析任务');
    expect(host.textContent).toContain('创建建模任务');
    expect(host.textContent).toContain('打开任务监控');
    expect(host.textContent).toContain('将基于当前站点配置打开任务创建面板');

    (host.querySelector('[data-testid="site-healthcheck-action"]') as HTMLButtonElement).click();
    await nextTick();

    expect(healthcheckSiteMock).toHaveBeenCalledWith('site-current');
  });

  it('opens task creation and monitor panels for current site shortcuts', async () => {
    const { host } = mountPanel();

    (host.querySelector('[data-testid="site-row-site-current"] button') as HTMLButtonElement).click();
    await nextTick();

    (host.querySelector('[data-testid="site-create-parsing-task-action"]') as HTMLButtonElement).click();
    await nextTick();

    expect(setPresetTypeMock).toHaveBeenCalledWith('DataParsingWizard');
    expect(setPresetContextMock).toHaveBeenCalledWith(expect.objectContaining({
      initialConfig: currentSite.config,
      siteContext: {
        siteId: 'site-current',
        siteName: '当前站点',
        isCurrentSite: true,
      },
    }));
    expect(ensurePanelAndActivateMock).toHaveBeenCalledWith('taskCreation');

    (host.querySelector('[data-testid="site-open-task-monitor-action"]') as HTMLButtonElement).click();
    await nextTick();

    expect(ensurePanelAndActivateMock).toHaveBeenCalledWith('taskMonitor');
  });

  it('opens edit wizard and confirms deletion before removing site', async () => {
    const { host } = mountPanel();

    (host.querySelector('[data-testid="site-row-site-current"] button') as HTMLButtonElement).click();
    await nextTick();

    (host.querySelector('[data-testid="site-edit-action"]') as HTMLButtonElement).click();
    await nextTick();

    expect(document.body.textContent).toContain('编辑站点');
    expect(document.body.textContent).toContain('当前站点');

    (host.querySelector('[data-testid="site-delete-action"]') as HTMLButtonElement).click();
    await nextTick();

    expect(confirmOpenMock).toHaveBeenCalled();
    expect(deleteSiteMock).toHaveBeenCalledWith('site-current');
  });

  it('opens remote site detail drawer and supports open/copy actions', async () => {
    const { host } = mountPanel();

    const detailButtons = host.querySelectorAll('[data-testid^="site-row-"] button');
    (detailButtons[1] as HTMLButtonElement).click();
    await nextTick();

    expect(openSiteDetailMock).toHaveBeenCalledWith('site-remote');
    expect(host.textContent).toContain('打开站点');
    expect(host.textContent).toContain('复制后端地址');
    expect(host.textContent).toContain('主站点暂不支持跨站直接发任务');

    (host.querySelector('[data-testid="site-open-frontend-action"]') as HTMLButtonElement).click();
    await nextTick();

    expect(window.open).toHaveBeenCalledWith('http://remote.example.com', '_blank', 'noopener');

    (host.querySelector('[data-testid="site-copy-backend-action"]') as HTMLButtonElement).click();
    await nextTick();

    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith('http://remote.example.com/api');
    expect(emitToastMock).toHaveBeenCalled();
  });
});
