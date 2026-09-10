/**
 * gen-model-v1 下的显示流程（plan 2026-09-06 P3-c）：容器显示的逐根进度弹窗、整库 `showModelByDbnum` 的分批装入与进度。
 * 数据源整个 mock 掉：这里只测 useModelGeneration 怎么驱动进度状态与加载器，不测适配器本身。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitToastMock = vi.fn();
const addLogMock = vi.fn();
const loadInstancesMock = vi.fn();
const collectDbnumMock = vi.fn();
const visibleInstsMock = vi.fn();
const typeInfoMock = vi.fn();

type ProgressListener = (progress: { refno: string; root: string; done: number; total: number }) => void;
const progressListeners = new Set<ProgressListener>();

const v1Source = {
  kind: 'gen-model-v1' as const,
  tree: { visibleInsts: visibleInstsMock, subtreeRefnos: vi.fn() },
  attributes: { typeInfo: typeInfoMock },
  records: {
    subscribeProgress: (listener: ProgressListener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
  },
  meshes: { meshUrl: vi.fn() },
  collectDbnum: collectDbnumMock,
};

vi.mock('@/model-source', () => ({
  getModelSource: () => v1Source,
  getGenModelV1ModelSource: () => v1Source,
  subscribeModelSourceProgress: (listener: ProgressListener) => v1Source.records.subscribeProgress(listener),
}));

vi.mock('@/api/genModelRealtimeApi', () => ({ enqueueParquetIncremental: vi.fn(), getParquetVersion: vi.fn() }));
vi.mock('@/api/genModelTaskApi', () => ({ modelRegenerateByRefno: vi.fn(), modelShowByRefno: vi.fn() }));
vi.mock('@/api/genModelStreamGenerateApi', () => ({ triggerBatchGenerateSse: vi.fn() }));
vi.mock('@/api/modelUnitVersionApi', () => ({ getModelUnitCommit: vi.fn() }));
vi.mock('@/composables/useConfirmDialogStore', () => ({ useConfirmDialogStore: () => ({ confirm: vi.fn() }) }));
vi.mock('@/composables/useConsoleStore', () => ({ useConsoleStore: () => ({ addLog: addLogMock }) }));
vi.mock('@/composables/useDbMetaInfo', () => ({
  ensureDbMetaInfoLoaded: vi.fn(async () => {}),
  getDbnumByRefno: vi.fn(() => 7997),
  tryGetDbnumByRefno: vi.fn(() => 7997),
}));
vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  isDtxRefnoLoaded: vi.fn(() => false),
  loadDbnoInstancesForVisibleRefnosDtx: loadInstancesMock,
}));
vi.mock('@/composables/useDbnoInstancesParquetLoader', () => ({
  useDbnoInstancesParquetLoader: () => ({ isParquetAvailable: vi.fn(), queryAllRefnosByDbno: vi.fn() }),
}));
vi.mock('@/composables/useModelLoadStatus', () => ({
  useModelLoadStatus: () => ({ begin: vi.fn(), update: vi.fn(), finish: vi.fn() }),
}));
vi.mock('@/ribbon/toastBus', () => ({ emitToast: emitToastMock }));

function loaderResult(loadedRefnos: number, loadedObjects: number) {
  return {
    loadedRefnos, skippedRefnos: 0, loadedObjects, missingRefnos: [],
    missingBreakdown: { noGeoRowsRefnos: [], mesh404Refnos: [], mesh404GeoHashes: [] },
    sceneBoundingBox: null,
  };
}

function makeViewer() {
  return {
    scene: { objects: {}, getAABB: vi.fn(() => ({ min: [0, 0, 0], max: [1, 1, 1] })), ensureRefnos: vi.fn() },
    __dtxLayer: { hasObject: vi.fn(() => false), getBoundingBox: vi.fn(() => null) },
    __dtxAfterInstancesLoaded: vi.fn(),
    cameraFlight: { flyTo: vi.fn() },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  progressListeners.clear();
  loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => loaderResult(refnos.length, refnos.length * 2));
  typeInfoMock.mockResolvedValue({ success: true, refno: '24381_101410', noun: 'ZONE' });
});

describe('showModelByRefno（gen-model-v1）', () => {
  it('容器展开出多根：visibleInsts 期间的逐根进度驱动 totalCount / currentIndex / currentRefno，并弹进度窗；结束后关掉、退订', async () => {
    const seen: { modal: boolean; total: number; index: number; refno: string; status: string }[] = [];
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    visibleInstsMock.mockImplementation(async () => {
      const roots = ['24381_145018', '24381_145019', '24381_145020'];
      roots.forEach((root, index) => {
        for (const listener of progressListeners) listener({ refno: '24381_101410', root, done: index + 1, total: roots.length });
        seen.push({
          modal: gen.showProgressModal.value, total: gen.totalCount.value, index: gen.currentIndex.value,
          refno: gen.currentRefno.value, status: gen.statusMessage.value,
        });
      });
      return { success: true, refno: '24381_101410', refnos: ['24381_1', '24381_2', '24381_3'] };
    });

    const ok = await gen.showModelByRefno('24381_101410', { flyTo: false });

    expect(ok).toBe(true);
    expect(seen.map((s) => `${s.modal ? 'modal' : 'no-modal'} ${s.index}/${s.total} ${s.refno}`)).toEqual([
      'modal 2/3 24381_145018',
      'modal 3/3 24381_145019',
      'modal 3/3 24381_145020',
    ]);
    expect(seen[0]!.status).toContain('1/3 个生成根');
    expect(gen.showProgressModal.value).toBe(false);
    expect(gen.isGenerating.value).toBe(false);
    expect(progressListeners.size).toBe(0);
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 7997, ['24381_1', '24381_2', '24381_3'], expect.objectContaining({ dataSource: 'gen-model-v1' }));
  });

  it('单根 BRAN：只有一个生成根，不弹进度窗', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_145018', noun: 'BRAN' });
    let modalDuringEnsure: boolean | null = null;
    visibleInstsMock.mockImplementation(async () => {
      for (const listener of progressListeners) listener({ refno: '24381_145018', root: '24381_145018', done: 1, total: 1 });
      modalDuringEnsure = gen.showProgressModal.value;
      return { success: true, refno: '24381_145018', refnos: ['24381_145019'] };
    });
    await gen.showModelByRefno('24381_145018');
    expect(modalDuringEnsure).toBe(false);
  });

  it('超过一页的构件分批装入（每批 1000），进度 30 → 95 递增，结果按批累加', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const refnos = Array.from({ length: 2500 }, (_, i) => `24381_${i + 1}`);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_101410', refnos });
    const progressAtBatch: number[] = [];
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, batch: string[]) => {
      progressAtBatch.push(gen.progress.value);
      return loaderResult(batch.length, batch.length);
    });

    const ok = await gen.showModelByRefno('24381_101410');

    expect(ok).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalledTimes(3);
    expect(loadInstancesMock.mock.calls.map((c) => (c[2] as string[]).length)).toEqual([1000, 1000, 500]);
    expect(progressAtBatch).toEqual([30, 51, 73]);
    expect(gen.lastLoadDebug.value?.result).toEqual({ loadedRefnos: 2500, skippedRefnos: 0, loadedObjects: 2500 });
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'success', message: expect.stringContaining('2500 个几何实例') }));
  });

  it('重生成 / 重载不分批：forceRefresh 分了批每批都会再 ensure 同一个根', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    viewer.__dtxLayer.hasObject = vi.fn(() => true);
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    const refnos = Array.from({ length: 1500 }, (_, i) => `24381_${i + 1}`);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_101410', refnos });

    await gen.showModelByRefno('24381_101410', { regenerate: true });

    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 7997, refnos, expect.objectContaining({
      dataSource: 'gen-model-v1', forceRegenerate: true, replaceExistingObjects: true, forceRefreshGeometries: true, forceReloadRefnos: refnos,
    }));
  });
});

describe('showModelByDbnum（gen-model-v1 整库）', () => {
  it('collectDbnum 的 SITE / 生成根两级进度进弹窗，构件分批装入，汇总 toast 带 pending / 跳过', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    const refnos = Array.from({ length: 1200 }, (_, i) => `24381_${i + 1}`);
    const seen: string[] = [];
    collectDbnumMock.mockImplementation(async (dbnum: number, options: { onProgress?: (p: any) => void }) => {
      const site = { refno: '24381_101405', name: '/1PTU-INST23' };
      options.onProgress?.({ phase: 'sites', siteIndex: 1, siteCount: 2, site, rootsDone: 0, rootsTotal: 0, root: null });
      seen.push(`${gen.showProgressModal.value} ${gen.currentIndex.value}/${gen.totalCount.value} ${gen.currentRefno.value} | ${gen.statusMessage.value} | ${gen.progress.value}`);
      options.onProgress?.({ phase: 'roots', siteIndex: 1, siteCount: 2, site, rootsDone: 1, rootsTotal: 4, root: '24381_101410' });
      seen.push(`${gen.showProgressModal.value} ${gen.currentIndex.value}/${gen.totalCount.value} ${gen.currentRefno.value} | ${gen.statusMessage.value} | ${gen.progress.value}`);
      options.onProgress?.({ phase: 'sites', siteIndex: 2, siteCount: 2, site: { refno: '24381_535', name: '/仪控ISO测试' }, rootsDone: 0, rootsTotal: 0, root: null });
      seen.push(`${gen.progress.value}`);
      return {
        dbnum, sites: [site, { refno: '24381_535', name: '/仪控ISO测试' }], refnos, generationRoots: ['24381_101410', '24381_101412'],
        pending: ['24381_9'], empty: [], truncatedRoots: [], errors: {}, skippedSites: [],
      };
    });

    const result = await gen.showModelByDbnum(7997, { flyTo: true });

    expect(collectDbnumMock).toHaveBeenCalledWith(7997, expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(seen).toEqual([
      'true 1/2 /1PTU-INST23 | gen-model：SITE 1/2 /1PTU-INST23，正在 ensure... | 5',
      'true 1/2 /1PTU-INST23 › 24381_101410 | gen-model：SITE 1/2 /1PTU-INST23，生成根 1/4 | 11',
      '30',
    ]);
    expect(loadInstancesMock).toHaveBeenCalledTimes(2);
    expect(loadInstancesMock.mock.calls.map((c) => (c[2] as string[]).length)).toEqual([1000, 200]);
    expect(loadInstancesMock.mock.calls[0]![3]).toMatchObject({ dataSource: 'gen-model-v1' });
    expect(loadInstancesMock.mock.calls[0]![3]).not.toHaveProperty('forceReloadRefnos', expect.anything());
    expect(viewer.__dtxAfterInstancesLoaded).toHaveBeenCalledTimes(2);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ loaded: true, instanceCount: 2400, refnoCount: 1200, refnos });
    expect(gen.progress.value).toBe(100);
    expect(gen.showProgressModal.value).toBe(false);
    expect(gen.isGenerating.value).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning', message: expect.stringMatching(/^\[提示\] dbnum=7997：2 个 SITE \/ 2 个生成根，已加载 2400 个实例（1200 个 refno），生成中 1 根$/),
    }));
  });

  it('撞到安全概览预算：toast 提示从模型树按需加载 + show_dbnum_full=1，回 budgetLimited；带了 ?show_dbnum_full=1 就不设预算', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    collectDbnumMock.mockResolvedValue({
      dbnum: 7997, sites: [{ refno: '24381_101405', name: '/1PTU-INST23' }, { refno: '24381_535', name: '/仪控ISO测试' }],
      refnos: ['24381_1'], generationRoots: ['24381_101410'], pending: [], empty: [], truncatedRoots: ['24381_101412'], errors: {},
      skippedSites: ['24381_535'], budgetLimited: true,
    });

    const limited = await gen.showModelByDbnum(7997);
    expect(limited.budgetLimited).toBe(true);
    // 缺省不传预算：生成根由 collectDbnum 缺省不限（P9-3），构件数守它缺省的 50 000
    expect(collectDbnumMock.mock.calls[0]![1]).toMatchObject({ maxTotalRoots: undefined, maxRefnos: undefined });
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning',
      message: expect.stringMatching(/^\[提示\] 安全概览 dbnum=7997：2 个 SITE \/ 1 个生成根，已加载 2 个实例（1 个 refno），预算外未取 1 根，未轮到 1 个 SITE。请从模型树按需加载；整库全量可加 show_dbnum_full=1。$/),
    }));

    window.history.replaceState({}, '', '?show_dbnum_full=1');
    try {
      await gen.showModelByDbnum(7997);
      // show_dbnum_full=1：根与构件两个预算都不设
      expect(collectDbnumMock.mock.calls[1]![1]).toMatchObject({ maxTotalRoots: Number.POSITIVE_INFINITY, maxRefnos: Number.POSITIVE_INFINITY });
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  it('该库在当前 MDB 里没有 SITE：不装任何东西，回 loaded:true / 0，给一条警告', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    collectDbnumMock.mockResolvedValue({
      dbnum: 4242, sites: [], refnos: [], generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [],
    });
    const result = await gen.showModelByDbnum(4242);
    expect(result).toEqual({ loaded: true, instanceCount: 0, refnoCount: 0, refnos: [] });
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning', message: expect.stringContaining('没有 SITE') }));
  });

  it('带 manifestUrl（版本对比）仍走 parquet 路，不碰 gen-model', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const result = await gen.showModelByDbnum(7997, { manifestUrl: '/m.json' });
    expect(collectDbnumMock).not.toHaveBeenCalled();
    // parquet loader 在这里是空 mock，走到它就会失败——只要没碰 gen-model 就是对的
    expect(result.loaded).toBe(false);
  });

  it('collectDbnum 抛错 → 错误 toast、loaded:false，弹窗关掉', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    collectDbnumMock.mockRejectedValue(new Error('network: down'));
    const result = await gen.showModelByDbnum(7997);
    expect(result.loaded).toBe(false);
    expect(gen.error.value).toBe('network: down');
    expect(gen.showProgressModal.value).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', message: expect.stringContaining('network: down') }));
  });
});
