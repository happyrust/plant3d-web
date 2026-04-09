import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, nextTick } from 'vue';

import { useTaskCreation } from './useTaskCreation';

import type { DatabaseConfig } from '@/api/genModelTaskApi';

const getServerConfigMock = vi.fn();
const taskCreateMock = vi.fn();
const taskValidateNameMock = vi.fn();
const taskStartMock = vi.fn();

vi.mock('@/api/genModelTaskApi', () => ({
  getServerConfig: (...args: unknown[]) => getServerConfigMock(...args),
  taskCreate: (...args: unknown[]) => taskCreateMock(...args),
  taskValidateName: (...args: unknown[]) => taskValidateNameMock(...args),
  taskStart: (...args: unknown[]) => taskStartMock(...args),
}));

vi.mock('@/composables/useTaskCreationStore', () => ({
  useTaskCreationStore: () => ({
    consumePresetType: () => null,
    consumePresetContext: () => ({
      initialConfig: null,
      siteContext: null,
    }),
    setPresetType: vi.fn(),
    setPresetContext: vi.fn(),
    getPresetType: () => null,
    getPresetContext: () => null,
  }),
}));

const injectedConfig: DatabaseConfig = {
  name: 'site-current',
  manual_db_nums: [],
  manual_refnos: [],
  project_name: 'InjectedProject',
  project_path: '/data/injected',
  project_code: 9527,
  mdb_name: 'ALL',
  module: 'DESI',
  db_type: 'surrealdb',
  surreal_ns: 9527,
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
};

function mountComposable() {
  let exposed: ReturnType<typeof useTaskCreation> | null = null;
  const host = document.createElement('div');
  document.body.appendChild(host);

  const app = createApp(defineComponent({
    setup() {
      exposed = useTaskCreation({
        initialConfig: injectedConfig,
        siteContext: {
          siteId: 'site-current',
          siteName: '当前站点',
          isCurrentSite: true,
        },
      });
      return () => null;
    },
  }));

  app.mount(host);

  return {
    app,
    host,
    getApi() {
      if (!exposed) {
        throw new Error('useTaskCreation not mounted');
      }
      return exposed;
    },
  };
}

beforeEach(() => {
  getServerConfigMock.mockReset();
  taskCreateMock.mockReset();
  taskValidateNameMock.mockReset();
  taskStartMock.mockReset();

  getServerConfigMock.mockResolvedValue(injectedConfig);
  taskValidateNameMock.mockResolvedValue({ available: true });
  taskCreateMock.mockResolvedValue({
    success: true,
    taskId: 'task-001',
  });
  taskStartMock.mockResolvedValue({ success: true });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useTaskCreation', () => {
  it('uses injected config and site context without loading /api/config again', async () => {
    const mounted = mountComposable();
    await nextTick();

    const api = mounted.getApi();

    expect(getServerConfigMock).not.toHaveBeenCalled();
    expect(api.serverConfig.value).toEqual(injectedConfig);
    expect(api.siteContext.value).toEqual({
      siteId: 'site-current',
      siteName: '当前站点',
      isCurrentSite: true,
    });
  });

  it('builds task request from injected config on submit', async () => {
    const mounted = mountComposable();
    await nextTick();

    const api = mounted.getApi();
    api.formData.name = '解析任务';
    api.formData.type = 'DataParsingWizard';
    api.formData.parseMode = 'all';

    const ok = await api.submitTask();

    expect(ok).toBe(true);
    expect(taskCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      name: '解析任务',
      task_type: 'DataParsingWizard',
      config: expect.objectContaining({
        project_name: 'InjectedProject',
        project_path: '/data/injected',
        project_code: 9527,
        db_ip: '127.0.0.1',
        db_port: '8000',
      }),
    }));
  });

  it('submits refno model generation with noun filters', async () => {
    const mounted = mountComposable();
    await nextTick();

    const api = mounted.getApi();
    api.formData.name = 'Refno 模型生成';
    api.formData.type = 'DataGeneration';
    api.formData.refno = '24381_145018';
    api.formData.enabledNouns = ['BRAN', 'HANG'];
    api.formData.limitPerNounType = '8';

    const ok = await api.submitTask();

    expect(ok).toBe(true);
    expect(taskCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Refno 模型生成',
      task_type: 'DataGeneration',
      config: expect.objectContaining({
        manual_db_nums: [],
        manual_refnos: ['24381_145018'],
        enabled_nouns: ['BRAN', 'HANG'],
        debug_limit_per_noun_type: 8,
      }),
    }));
    expect(taskStartMock).toHaveBeenCalledWith('task-001');
  });
});
