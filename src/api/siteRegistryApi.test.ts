import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SiteRegistryApiError,
  createDeploymentSite,
  getCurrentSiteIdentity,
  getDeploymentSites,
} from './siteRegistryApi';

describe('siteRegistryApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('MODE', 'test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('应请求 deployment sites 列表并附带查询参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [{
          site_id: 'ams-3100',
          name: 'AMS',
          project_name: 'AvevaMarineSample',
          bind_host: '127.0.0.1',
          bind_port: 3100,
          status: 'Running',
          config: { project_name: 'AvevaMarineSample', project_code: 1516 },
        }],
        total: 1,
        page: 1,
        per_page: 20,
        pages: 1,
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDeploymentSites({ q: 'AMS', status: 'Running', page: 1, per_page: 20 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/deployment-sites');
    expect(url.searchParams.get('q')).toBe('AMS');
    expect(url.searchParams.get('status')).toBe('Running');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('per_page')).toBe('20');

    expect(result.total).toBe(1);
    expect(result.items[0]?.site_id).toBe('ams-3100');
  });

  it('应请求当前站点身份', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        site_id: 'ams-3100',
        site_name: 'AMS',
        backend_url: 'http://127.0.0.1:3100',
        registration_status: 'registered',
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCurrentSiteIdentity();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/site/identity');
    expect(result.site_id).toBe('ams-3100');
    expect(result.registration_status).toBe('registered');
  });

  it('创建站点失败时应抛出带后端错误文案的异常', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: '站点名称不能为空' }), { status: 400, statusText: 'Bad Request' })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createDeploymentSite({
      site_id: '',
      name: '',
      config: {
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
    })).rejects.toMatchObject<Partial<SiteRegistryApiError>>({
      status: 400,
      message: '站点名称不能为空',
    });
  });
});
