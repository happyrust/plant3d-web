import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetGenModelV1ServiceLifecycleForTests,
  observeGenModelV1Health,
} from './genModelV1/serviceLifecycle';

import {
  __resetModelSourceForTests,
  DEFAULT_MODEL_SOURCE_KIND,
  getGenModelV1ModelSource,
  getModelSource,
  getModelSourceKind,
  MODEL_SOURCE_KINDS,
  subscribeModelSourceProgress,
  type GenModelV1ModelSource,
} from './index';

vi.mock('@/composables/useGenModelV1Health', () => ({
  currentDbnumModelCapability: () => 'unknown',
  ensureGenModelV1Freshness: vi.fn(async () => ({ generation: 0 })),
  noteGenModelV1RequestFailure: vi.fn(),
  refreshGenModelV1AfterTaskNotFound: vi.fn(async () => ({ generation: 0 })),
  useGenModelV1Health: () => ({ activateDataSource: () => () => {} }),
}));

beforeEach(() => {
  __resetModelSourceForTests();
  __resetGenModelV1ServiceLifecycleForTests();
  vi.clearAllMocks();
});

describe('数据源种类（legacy 已于 2026-09-20 退役）', () => {
  it('只剩 gen-model-v1：缺省值、清单与 getModelSourceKind 三者一致，URL 参数不再参与', () => {
    expect(DEFAULT_MODEL_SOURCE_KIND).toBe('gen-model-v1');
    expect(MODEL_SOURCE_KINDS).toEqual(['gen-model-v1']);
    window.history.replaceState({}, '', '?model_source=legacy');
    try {
      expect(getModelSourceKind()).toBe('gen-model-v1');
      expect(getModelSource().kind).toBe('gen-model-v1');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });
});

describe('gen-model-v1 数据源', () => {
  it('树 / 几何记录 / 网格 / 属性 / 空间查询全部走 /api/v1；进程内只建一份', () => {
    const source = getModelSource();
    expect(source.kind).toBe('gen-model-v1');
    expect(getModelSource()).toBe(source);
    expect(source.meshes.meshUrl('12240963882128803248', 'L1')).toMatch(/\/api\/v1\/meshes\/12240963882128803248\.mesh$/);
    // 2026-09-20 起 v1 也有专业维度（服务端按 SITE 名派生，ADR 0067）并多房间过滤。
    expect(source.spatial.capabilities).toEqual({ specValues: true, branCenterline: true, keywordMatchesName: false, nameSortExact: false, rooms: true, tree: true });
  });

  it('树的 visibleInsts 与几何加载共用记录源缓存（一次显示只 ensure 一次）', async () => {
    const source = getModelSource();
    const records = source.records as { ensureAndCollect: (refno: string) => Promise<unknown>; peek: (refno: string) => unknown };
    const spy = vi.spyOn(records, 'ensureAndCollect').mockResolvedValue({
      refno: '24381_145018', generationRoots: ['24381_145018'], items: [], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {},
    });
    await source.tree.visibleInsts('24381_145018');
    expect(spy).toHaveBeenCalledWith('24381_145018', expect.anything());
    spy.mockRestore();
  });

  it('getGenModelV1ModelSource / subscribeModelSourceProgress：给带 collectDbnum 的那份源，订阅回退订函数', () => {
    const source = getGenModelV1ModelSource();
    expect(source).toBe(getModelSource());
    expect(typeof source.collectDbnum).toBe('function');
    expect(typeof source.records.subscribeProgress).toBe('function');
    const unsubscribe = subscribeModelSourceProgress(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('订阅服务代次：重启时清 records 与 tree 缓存，但不替换数据源实例', () => {
    const source = getModelSource() as GenModelV1ModelSource;
    const recordsInvalidate = vi.spyOn(source.records, 'invalidate');
    const treeInvalidate = vi.spyOn(
      source.tree as typeof source.tree & { invalidate(): void },
      'invalidate',
    );
    observeGenModelV1Health({ status: 'ok', started_at: 'old' }, '/gm');
    observeGenModelV1Health({ status: 'ok', started_at: 'new' }, '/gm');
    expect(recordsInvalidate).toHaveBeenCalledOnce();
    expect(treeInvalidate).toHaveBeenCalledOnce();
    expect(getModelSource()).toBe(source);
  });
});
