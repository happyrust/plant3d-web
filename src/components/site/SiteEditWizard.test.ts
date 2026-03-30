import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import SiteEditWizard from './SiteEditWizard.vue';

import type { DeploymentSite } from '@/types/site';

const updateSiteMock = vi.fn();

vi.mock('@/composables/useDeploymentSites', () => ({
  useDeploymentSites: () => ({
    updateSite: updateSiteMock,
    error: { value: null },
  }),
}));

const editingSite: DeploymentSite = {
  site_id: 'site-current',
  name: '当前站点',
  region: 'cn-east',
  owner: 'alice',
  env: 'prod',
  description: '原始描述',
  project_name: 'CurrentProject',
  project_path: '/data/current',
  project_code: '1001' as unknown as number,
  frontend_url: 'http://current.example.com',
  backend_url: 'http://current.example.com/api',
  bind_host: '0.0.0.0',
  bind_port: 3100,
  status: 'Running',
  last_seen_at: '2026-03-28 18:00:00',
  config: {
    name: '当前站点',
    manual_db_nums: [],
    manual_refnos: [],
    project_name: 'CurrentProject',
    project_path: '/data/current',
    project_code: 1001,
    mdb_name: 'ALL',
    module: 'DESI',
    db_type: 'surrealdb',
    surreal_ns: 1001,
    db_ip: '127.0.0.1',
    db_port: '8000',
    db_user: 'root',
    db_password: 'root',
    gen_model: true,
    gen_mesh: true,
    gen_spatial_tree: true,
    apply_boolean_operation: true,
    mesh_tol_ratio: 0.01,
    room_keyword: '-RM',
    export_json: false,
    export_parquet: false,
  },
};

function mountWizard(props?: Record<string, unknown>) {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const app = createApp({
    render: () => h(SiteEditWizard, {
      open: true,
      site: editingSite,
      ...props,
    }),
  });

  app.mount(host);
  return { app, host };
}

function queryInBody<T extends Element>(selector: string) {
  return document.body.querySelector(selector) as T | null;
}

function input(selector: string, value: string) {
  const el = queryInBody<HTMLInputElement | HTMLTextAreaElement>(selector);
  expect(el, `missing input: ${selector}`).toBeTruthy();
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function click(selector: string) {
  const el = queryInBody<HTMLButtonElement>(selector);
  expect(el, `missing button: ${selector}`).toBeTruthy();
  el?.click();
}

beforeEach(() => {
  updateSiteMock.mockReset();
  updateSiteMock.mockResolvedValue({
    ...editingSite,
    name: '更新后的站点',
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SiteEditWizard', () => {
  it('prefills form fields from existing site', async () => {
    mountWizard();
    await nextTick();

    expect(queryInBody<HTMLInputElement>('[data-testid="site-edit-field-name"]')?.value).toBe('当前站点');
    expect(queryInBody<HTMLInputElement>('[data-testid="site-edit-field-project-name"]')?.value).toBe('CurrentProject');
    expect(queryInBody<HTMLInputElement>('[data-testid="site-edit-field-backend-url"]')?.value).toBe('http://current.example.com/api');
  });

  it('submits updated payload and emits saved', async () => {
    const onSaved = vi.fn();
    const onUpdateOpen = vi.fn();

    mountWizard({
      onSaved,
      'onUpdate:open': onUpdateOpen,
    });
    await nextTick();

    input('[data-testid="site-edit-field-name"]', '更新后的站点');
    input('[data-testid="site-edit-field-project-name"]', 'UpdatedProject');
    input('[data-testid="site-edit-field-project-code"]', '2002');
    input('[data-testid="site-edit-field-project-path"]', '/data/updated');
    input('[data-testid="site-edit-field-frontend-url"]', 'http://updated.example.com');
    input('[data-testid="site-edit-field-backend-url"]', 'http://updated.example.com/api');

    click('[data-testid="site-edit-submit"]');
    await nextTick();

    expect(updateSiteMock).toHaveBeenCalledWith('site-current', expect.objectContaining({
      name: '更新后的站点',
      project_name: 'UpdatedProject',
      project_code: 2002,
      project_path: '/data/updated',
      frontend_url: 'http://updated.example.com',
      backend_url: 'http://updated.example.com/api',
      config: expect.objectContaining({
        project_name: 'UpdatedProject',
        project_code: 2002,
        project_path: '/data/updated',
      }),
    }));
    expect(onSaved).toHaveBeenCalledWith('site-current');
    expect(onUpdateOpen).toHaveBeenCalledWith(false);
  });
});
