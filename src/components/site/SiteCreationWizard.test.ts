import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, h, nextTick } from 'vue';

import SiteCreationWizard from './SiteCreationWizard.vue';

const createSiteMock = vi.fn();
const importSiteMock = vi.fn();

vi.mock('@/composables/useDeploymentSites', () => ({
  useDeploymentSites: () => ({
    createSite: createSiteMock,
    importSite: importSiteMock,
    error: computed(() => null),
  }),
}));

function mountWizard(props?: Record<string, unknown>) {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const app = createApp({
    render: () => h(SiteCreationWizard, {
      open: true,
      ...props,
    }),
  });

  app.mount(host);
  return { app, host };
}

function click(host: HTMLElement, selector: string) {
  const scope = host.ownerDocument?.body ?? document.body;
  const el = scope.querySelector(selector) as HTMLButtonElement | null;
  expect(el, `missing element: ${selector}`).toBeTruthy();
  el?.click();
}

function input(host: HTMLElement, selector: string, value: string) {
  const scope = host.ownerDocument?.body ?? document.body;
  const el = scope.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(el, `missing input: ${selector}`).toBeTruthy();
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  createSiteMock.mockReset();
  importSiteMock.mockReset();
  createSiteMock.mockResolvedValue({
    site_id: 'site-new',
    name: '新站点',
  });
  importSiteMock.mockResolvedValue({
    site_id: 'site-imported',
    name: '导入站点',
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SiteCreationWizard', () => {
  it('blocks next step when manual mode required fields are missing', async () => {
    const { host } = mountWizard();

    click(host, '[data-testid="site-creation-next"]');
    await nextTick();
    click(host, '[data-testid="site-creation-next"]');
    await nextTick();

    expect(document.body.textContent).toContain('请填写站点名称');
    expect(document.body.textContent).toContain('请填写 site_id');
  });

  it('submits manual mode payload with default config values', async () => {
    const onCreated = vi.fn();
    const onUpdateOpen = vi.fn();
    const { host } = mountWizard({
      onCreated,
      'onUpdate:open': onUpdateOpen,
    });

    click(host, '[data-testid="site-mode-manual"]');
    await nextTick();
    click(host, '[data-testid="site-creation-next"]');
    await nextTick();

    input(host, '[data-testid="site-field-name"]', '新站点');
    input(host, '[data-testid="site-field-site-id"]', 'site-new');
    input(host, '[data-testid="site-field-region"]', 'cn-east');
    input(host, '[data-testid="site-field-owner"]', 'alice');
    click(host, '[data-testid="site-creation-next"]');
    await nextTick();

    input(host, '[data-testid="site-field-project-name"]', 'ProjectAlpha');
    input(host, '[data-testid="site-field-project-code"]', '1001');
    input(host, '[data-testid="site-field-project-path"]', '/data/project-alpha');
    input(host, '[data-testid="site-field-frontend-url"]', 'http://alpha.example.com');
    input(host, '[data-testid="site-field-backend-url"]', 'http://alpha.example.com/api');
    click(host, '[data-testid="site-creation-next"]');
    await nextTick();

    click(host, '[data-testid="site-creation-submit"]');
    await nextTick();

    expect(createSiteMock).toHaveBeenCalledTimes(1);
    expect(createSiteMock).toHaveBeenCalledWith(expect.objectContaining({
      site_id: 'site-new',
      name: '新站点',
      region: 'cn-east',
      owner: 'alice',
      project_name: 'ProjectAlpha',
      project_code: 1001,
      project_path: '/data/project-alpha',
      frontend_url: 'http://alpha.example.com',
      backend_url: 'http://alpha.example.com/api',
      bind_host: '0.0.0.0',
      bind_port: 3100,
      config: expect.objectContaining({
        project_name: 'ProjectAlpha',
        project_code: 1001,
        project_path: '/data/project-alpha',
        module: 'DESI',
        mdb_name: 'ALL',
        db_type: 'surrealdb',
        gen_model: true,
        gen_mesh: true,
        gen_spatial_tree: true,
        apply_boolean_operation: true,
      }),
    }));
    expect(onCreated).toHaveBeenCalledWith('site-new');
    expect(onUpdateOpen).toHaveBeenCalledWith(false);
  });

  it('submits import mode payload through import api', async () => {
    const onCreated = vi.fn();
    const { host } = mountWizard({ onCreated });

    click(host, '[data-testid="site-mode-import"]');
    await nextTick();
    click(host, '[data-testid="site-creation-next"]');
    await nextTick();

    input(host, '[data-testid="site-field-name"]', '导入站点');
    input(host, '[data-testid="site-field-site-id"]', 'site-imported');
    click(host, '[data-testid="site-creation-next"]');
    await nextTick();

    input(host, '[data-testid="site-field-import-path"]', '/tmp/DbOption-zsy');
    input(host, '[data-testid="site-field-frontend-url"]', 'http://import.example.com');
    input(host, '[data-testid="site-field-backend-url"]', 'http://import.example.com/api');
    click(host, '[data-testid="site-creation-next"]');
    await nextTick();

    click(host, '[data-testid="site-creation-submit"]');
    await nextTick();

    expect(importSiteMock).toHaveBeenCalledTimes(1);
    expect(importSiteMock).toHaveBeenCalledWith(expect.objectContaining({
      path: '/tmp/DbOption-zsy',
      name: '导入站点',
      site_id: 'site-imported',
      frontend_url: 'http://import.example.com',
      backend_url: 'http://import.example.com/api',
      bind_host: '0.0.0.0',
      bind_port: 3100,
    }));
    expect(onCreated).toHaveBeenCalledWith('site-imported');
  });
});
