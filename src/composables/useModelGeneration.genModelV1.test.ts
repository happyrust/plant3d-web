/**
 * gen-model-v1 下的显示流程（plan 2026-09-06 P3-c）：容器显示的逐根进度弹窗、整库 `showModelByDbnum` 的分批装入与进度。
 * 数据源整个 mock 掉：这里只测 useModelGeneration 怎么驱动进度状态与加载器，不测适配器本身。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGenModelV1ModelRecordSource } from '@/model-source/genModelV1/modelRecordSource';
import { __resetGenModelV1ServiceLifecycleForTests } from '@/model-source/genModelV1/serviceLifecycle';
import { createGenModelV1TreeSource } from '@/model-source/genModelV1/treeSource';

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
    generateThenCollect: vi.fn(async (refno: string) => ({
      refno,
      generationRoots: [refno],
      items: [{ refno }],
      pending: [] as string[],
      empty: [],
      truncatedRoots: [],
      errors: {},
      statuses: {} as Record<string, string>,
    })),
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

  it('显示只按祖先查 records，不调用 generate；查空是提示、不装载', async () => {
    __resetGenModelV1ServiceLifecycleForTests();
    const generate = vi.fn();
    const records = vi.fn(async () => ({ source: 'model-database', items: [], total: 0, truncated: false, next_cursor: null }));
    const recordSource = createGenModelV1ModelRecordSource({
      api: { generate: generate as never, records: records as never, children: vi.fn() as never },
    });
    const tree = createGenModelV1TreeSource({
      api: { roots: vi.fn(), children: vi.fn(), ancestors: vi.fn(), search: vi.fn() } as never,
      collectByAncestor: (refno, options) => recordSource.collectByAncestor(refno, options),
    });
    visibleInstsMock.mockImplementation((refno: string) => tree.visibleInsts(refno));
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    expect(await gen.showModelByRefno('1_2')).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(records).toHaveBeenCalledTimes(1);
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(gen.isModelActuallyLoaded('1_2')).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      message: expect.stringContaining('范围内没有已生成的模型；右键「重新生成模型」可生成'),
    }));
  });

  it('#84 第二个实例对已画好的 BRAN：成员被 loader 跳过、只剩根自己没几何 → 按已加载收口、记 loadedRoots、不报「没有几何记录」', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    // 场景里 BEND / STRT 已由 ViewerPanel 那份实例装好，BRAN 键只有 ensureRefnos 建的占位（getAABB 只并自己 → null）
    const viewer = makeViewer();
    viewer.scene.objects = { '24384_24935': { id: '24384_24935', visible: true, selected: false, xrayed: false } };
    viewer.scene.getAABB = vi.fn(() => null);
    viewer.scene.getSubtreeAABB = vi.fn(() => [32934, -26599, 21000, 34934, -24246, 22100]);
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24384_24935', noun: 'BRAN' });
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24384_24935', refnos: ['24384_24936', '24384_24939'] });
    loadInstancesMock.mockResolvedValue({
      ...loaderResult(1, 0),
      skippedRefnos: 2,
      missingRefnos: ['24384_24935'],
      missingBreakdown: { noGeoRowsRefnos: ['24384_24935'], mesh404Refnos: [], mesh404GeoHashes: [] },
    });

    expect(gen.checkRefnoExists('24384/24935')).toBe(true); // 斜杠写法也认占位
    expect(await gen.showModelByRefno('24384/24935', { flyTo: true })).toBe(true);

    // 「已存在」分支：自己的盒为空 → 用成员并集盒飞
    expect(viewer.scene.getSubtreeAABB).toHaveBeenCalledWith(['24384_24935']);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledWith(expect.objectContaining({ aabb: [32934, -26599, 21000, 34934, -24246, 22100] }));
    // 加载范围仍是根 + 成员；成员早在场景里、根自身无几何 = 已加载
    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 8000, ['24384_24935', '24384_24936', '24384_24939'], expect.anything());
    expect(gen.statusMessage.value).toBe('已加载 (gen-model)');
    expect(gen.isModelActuallyLoaded('24384_24935')).toBe(true);
    const messages = emitToastMock.mock.calls.map(([toast]) => String(toast.message));
    expect(messages.join('\n')).not.toMatch(/没有几何记录|未绘制实例/);
    expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining('成员已在场景中，根自身无几何'));

    // 再显示一次：已记 loadedRoots，短路，不再问 visibleInsts / loader
    expect(await gen.showModelByRefno('24384_24935')).toBe(true);
    expect(visibleInstsMock).toHaveBeenCalledTimes(1);
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
  });

  it('an_empty_scope_is_a_hint_not_an_error：visibleInsts 查空不退到子树、不装载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24384_24935', noun: 'BRAN' });
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24384_24935', refnos: [] });
    v1Source.tree.subtreeRefnos.mockResolvedValue({ success: true, refnos: ['24384_24935'], truncated: false });

    expect(await gen.showModelByRefno('24384_24935')).toBe(false);
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(v1Source.tree.subtreeRefnos).not.toHaveBeenCalled();
    expect(gen.isModelActuallyLoaded('24384_24935')).toBe(false);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('范围内没有已生成的模型；右键「重新生成模型」可生成'),
    }));
  });

  it('收集未完成且一个构件都没取到：提示稍后再显示，不装载、不记已加载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: '1_2', refnos: [], incomplete: { pending: ['1_1', '1_3'], truncated_roots: [], errors: {} } });

    expect(await gen.showModelByRefno('1_2')).toBe(false);
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(gen.checkRefnoExists('1_2')).toBe(false);
    expect(gen.statusMessage.value).toBe('refno=1_2 模型尚未就绪（稍后再显示 2 处）');
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('尚未取得可见实例（稍后再显示 2 处）'),
    }));
  });

  it('regenerate_generates_once_then_displays_the_targets：先 generateThenCollect，再整批替换，不再把 forceRegenerate 交给装载器', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    viewer.__dtxLayer.hasObject = vi.fn(() => true);
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    const refnos = Array.from({ length: 1500 }, (_, i) => `24381_${i + 1}`);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_101410', refnos });

    await gen.showModelByRefno('24381_101410', { regenerate: true });

    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith('24381_101410');
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 7997, refnos, expect.objectContaining({
      dataSource: 'gen-model-v1', replaceExistingObjects: true, forceRefreshGeometries: true, forceReloadRefnos: refnos,
    }));
    expect(loadInstancesMock.mock.calls[0]![3]).not.toHaveProperty('forceRegenerate');
  });

  it('a_timed_out_generate_does_not_display：pending 回执不查可见实例、不装载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '1_2',
      generationRoots: [],
      items: [],
      pending: ['1_2'],
      empty: [],
      truncatedRoots: [],
      errors: {},
      statuses: { '1_2': 'generation_pending' },
    } as never);

    expect(await gen.showModelByRefno('1_2', { regenerate: true })).toBe(false);
    expect(visibleInstsMock).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('服务端后台继续生成，完成后再点眼睛'),
    }));
  });

  it('auto_generate_on_empty_records：BRAN 类型 records 为空时自动生成并装载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    // 第一次查询 records：为空（触发自动生成）
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: '24381_145018', refnos: [] });
    // 节点类型是 BRAN（有几何类型）
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_145018', noun: 'BRAN', owner_refno: null, owner_noun: null });
    // generateThenCollect 返回 items（生成成功）
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24381_145018',
      generationRoots: ['24381_145018'],
      items: [{ refno: '24381_145018' }],
      pending: [],
      empty: [],
      truncatedRoots: [],
      errors: {},
      statuses: {},
    } as never);
    // 生成后重新查询 records：返回构件
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: '24381_145018', refnos: ['24381_145018'] });

    const ok = await gen.showModelByRefno('24381_145018');

    expect(ok).toBe(true);
    expect(typeInfoMock).toHaveBeenCalledWith('24381_145018');
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith('24381_145018');
    expect(loadInstancesMock).toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'success', message: expect.stringContaining('已自动生成并加载'),
    }));
  });

  it('no_auto_generate_for_non_geometry_type：SITE 类型 records 为空时不自动生成', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    // records 为空
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_2', refnos: [] });
    // 节点类型是 SITE（非几何类型）
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_2', noun: 'SITE', owner_refno: null, owner_noun: null });

    const ok = await gen.showModelByRefno('24381_2');

    expect(ok).toBe(false);
    expect(typeInfoMock).toHaveBeenCalledWith('24381_2');
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('右键「重新生成模型」可生成'),
    }));
  });

  it('auto_generate_only_once：同一 refno 第二次显示不重复自动生成', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    // 第一次：records 为空，BRAN 类型，自动生成失败（items 为空）
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_145018', refnos: [] });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_145018', noun: 'BRAN', owner_refno: null, owner_noun: null });
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24381_145018',
      generationRoots: [],
      items: [],
      pending: ['24381_145018'],
      empty: [],
      truncatedRoots: [],
      errors: {},
      statuses: { '24381_145018': 'generation_pending' },
    } as never);

    const first = await gen.showModelByRefno('24381_145018');
    expect(first).toBe(false);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);

    // 第二次：records 仍为空，但已尝试过自动生成，不再自动生成
    v1Source.records.generateThenCollect.mockClear();
    const second = await gen.showModelByRefno('24381_145018');
    expect(second).toBe(false);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('右键「重新生成模型」可生成'),
    }));
  });
});

describe('queryLoadScopeRefnos（gen-model-v1）', () => {
  it('visibleInsts 的 incomplete 归一成 a_b 后透传；构件为空退到 subtree-refnos 时照样带着；三项全空 = null', async () => {
    const { queryLoadScopeRefnos } = await import('./useModelGeneration');

    visibleInstsMock.mockResolvedValueOnce({
      success: true, refno: '1_2', refnos: ['1/10'], incomplete: { pending: ['1/3'], truncated_roots: [], errors: {} },
    });
    expect(await queryLoadScopeRefnos('1_2')).toEqual({
      refnos: ['1_10'], source: 'visible-insts', truncated: false, incomplete: { pending: ['1_3'], truncated_roots: [], errors: {} },
    });

    visibleInstsMock.mockResolvedValueOnce({
      success: true, refno: '1_2', refnos: [], incomplete: { pending: [], truncated_roots: ['1/4'], errors: { '1/3': 'boom' } },
    });
    v1Source.tree.subtreeRefnos.mockResolvedValueOnce({ success: true, refnos: ['1_2', '1_3'], truncated: false });
    expect(await queryLoadScopeRefnos('1_2')).toEqual({
      refnos: [], source: 'visible-insts', truncated: false,
      incomplete: { pending: [], truncated_roots: ['1_4'], errors: { '1_3': 'boom' } },
    });
    expect(v1Source.tree.subtreeRefnos).not.toHaveBeenCalled();

    visibleInstsMock.mockResolvedValueOnce({
      success: true, refno: '1_2', refnos: ['1_10'], incomplete: { pending: [], truncated_roots: [], errors: {} },
    });
    expect((await queryLoadScopeRefnos('1_2')).incomplete).toBeNull();
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
      'true 1/2 /1PTU-INST23 | gen-model：SITE 1/2 /1PTU-INST23，正在查询已生成的记录... | 5',
      'true 1/2 /1PTU-INST23 › 24381_101410 | gen-model：SITE 1/2 /1PTU-INST23，已查 1/4 | 11',
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
      level: 'warning', message: expect.stringMatching(/^\[提示\] dbnum=7997：2 个 SITE \/ 2 个生成根，已加载 2400 个实例（1200 个 refno），稍后再显示 1 处$/),
    }));
  });

  it('服务端整库入口 · 实时：每批就绪根的构件立刻装入 DTX（不等 collectDbnum 结束），收尾只补装没进视口的，进度只往前走', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    const seen: string[] = [];
    let loadsDuringCollect = 0;
    collectDbnumMock.mockImplementation(async (
      dbnum: number,
      options: { onProgress?: (p: any) => void; onRefnosReady?: (b: any) => Promise<void> | void },
    ) => {
      const base = { siteIndex: 1, siteCount: 1, site: null, root: null };
      options.onProgress?.({ phase: 'generate', ...base, rootsDone: 0, rootsTotal: 4 });
      options.onProgress?.({ phase: 'generate', ...base, rootsDone: 2, rootsTotal: 4 });
      seen.push(`${gen.statusMessage.value} | ${gen.progress.value}`);
      options.onProgress?.({ phase: 'roots', ...base, rootsDone: 2, rootsTotal: 4, root: '24381_101412' });
      await options.onRefnosReady?.({ roots: ['24381_101410', '24381_101412'], refnos: ['24381_1', '24381_2'], rootsDone: 2, rootsTotal: 4 });
      loadsDuringCollect = loadInstancesMock.mock.calls.length;
      seen.push(`${gen.statusMessage.value} | ${gen.progress.value}`);
      // 服务端进度倒着报也不能让进度条回退
      options.onProgress?.({ phase: 'generate', ...base, rootsDone: 3, rootsTotal: 4 });
      seen.push(`${gen.statusMessage.value} | ${gen.progress.value}`);
      await options.onRefnosReady?.({ roots: ['24381_101414'], refnos: ['24381_3'], rootsDone: 3, rootsTotal: 4 });
      // 第四根没有构件：回调只更新计数
      await options.onRefnosReady?.({ roots: ['24381_101416'], refnos: [], rootsDone: 4, rootsTotal: 4 });
      return {
        dbnum, sites: [{ refno: '24381_101405', name: '/1PTU-INST23' }], refnos: ['24381_1', '24381_2', '24381_3', '24381_9'],
        generationRoots: ['24381_101410', '24381_101412', '24381_101414', '24381_101416'], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [],
      };
    });

    const result = await gen.showModelByDbnum(7997);

    expect(collectDbnumMock).toHaveBeenCalledWith(7997, expect.objectContaining({ onRefnosReady: expect.any(Function) }));
    // 两批实时装入在 collectDbnum 返回之前就发生了；收尾只补装 collectDbnum 结果里多出来的那一个构件
    expect(loadsDuringCollect).toBe(1);
    expect(loadInstancesMock).toHaveBeenCalledTimes(3);
    expect(loadInstancesMock.mock.calls.map((c) => c[2])).toEqual([['24381_1', '24381_2'], ['24381_3'], ['24381_9']]);
    expect(seen).toEqual([
      'gen-model：SITE 1/1 dbnum=7997，正在查询已生成的记录... | 30',
      'gen-model：dbnum=7997 已进视口 2/4 根（4 个实例） | 50',
      'gen-model：SITE 1/1 dbnum=7997，正在查询已生成的记录... | 50',
    ]);
    expect(result).toEqual({ loaded: true, instanceCount: 8, refnoCount: 4, refnos: ['24381_1', '24381_2', '24381_3', '24381_9'] });
    expect(gen.progress.value).toBe(100);
    expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining('live_batches=2'));
  });

  it('服务端整库记录已就绪但 SITE 摘要读取失败时仍装入 DTX，不误判为空库', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    collectDbnumMock.mockResolvedValue({
      dbnum: 7997,
      sites: [],
      siteSummaryAvailable: false,
      refnos: ['24381_1'],
      generationRoots: ['24381_101410'],
      pending: [],
      empty: [],
      truncatedRoots: [],
      errors: {},
      skippedSites: [],
      budgetLimited: false,
    });

    const result = await gen.showModelByDbnum(7997);

    expect(loadInstancesMock).toHaveBeenCalledWith(
      expect.anything(),
      7997,
      ['24381_1'],
      expect.objectContaining({ dataSource: 'gen-model-v1' }),
    );
    expect(result).toMatchObject({ loaded: true, instanceCount: 2, refnoCount: 1 });
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('没有 SITE'),
    }));
  });

  it('整库构件已全部在场景中时显示“本次未新增”，不误报 Model is empty', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    loadInstancesMock.mockResolvedValue({
      ...loaderResult(0, 0),
      skippedRefnos: 1,
    });
    collectDbnumMock.mockResolvedValue({
      dbnum: 7997,
      sites: [{ refno: '24381_2', name: '/1WCC-PIPE' }],
      refnos: ['24381_1'],
      generationRoots: ['24381_145018'],
      pending: [],
      empty: [],
      truncatedRoots: [],
      errors: {},
      skippedSites: [],
      budgetLimited: false,
    });

    const result = await gen.showModelByDbnum(7997);

    expect(result).toMatchObject({ loaded: true, instanceCount: 0, refnoCount: 1 });
    expect(gen.statusMessage.value).toBe('已加载 (gen-model，本次未新增)');
    expect(emitToastMock).toHaveBeenCalledWith({
      level: 'info',
      message: expect.stringContaining('全部 1 个 refno 已在场景中，本次未新增实例'),
    });
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Model is empty'),
    }));
  });

  it.each([
    {
      label: 'SITE 摘要正常',
      sites: [{ refno: '24381_2', name: '/1WCC-PIPE' }],
      siteSummaryAvailable: true,
      expectedScope: '1 个 SITE',
    },
    {
      label: 'SITE 摘要不可用',
      sites: [],
      siteSummaryAvailable: false,
      expectedScope: 'SITE 摘要不可用',
    },
  ])('$label 且整库根仍 pending 时显示尚未就绪，不宣告空模型', async ({
    sites,
    siteSummaryAvailable,
    expectedScope,
  }) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    collectDbnumMock.mockResolvedValue({
      dbnum: 7997,
      sites,
      siteSummaryAvailable,
      refnos: [],
      generationRoots: [],
      pending: ['24381_145018'],
      empty: [],
      truncatedRoots: [],
      errors: {},
      skippedSites: [],
      budgetLimited: false,
    });

    const result = await gen.showModelByDbnum(7997);

    expect(result).toEqual({ loaded: false, instanceCount: 0, refnoCount: 0, refnos: [] });
    expect(gen.statusMessage.value).toBe('模型尚未就绪 (gen-model)');
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning',
      message: expect.stringContaining(`${expectedScope}）尚未取得可加载几何，稍后再显示 1 处`),
    }));
    const messages = emitToastMock.mock.calls.map(([toast]) => String(toast.message));
    expect(messages.join('\n')).not.toMatch(/Model is empty|没有任何几何记录|没有 SITE/);
  });

  it.each(
    ['pending', 'errors', 'truncated', 'budget'].flatMap((reason) => [
      { reason, siteSummaryAvailable: true, sites: [{ refno: '1_1', name: '/SITE' }] },
      { reason, siteSummaryAvailable: false, sites: [] },
    ]),
  )(
    'refnos 非空但 $reason 未完成、SITE 摘要可用=$siteSummaryAvailable 且零实例时不宣告空模型',
    async ({ reason, siteSummaryAvailable, sites }) => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      loadInstancesMock.mockResolvedValue({
        ...loaderResult(1, 0),
        missingRefnos: ['1_10'],
        missingBreakdown: {
          noGeoRowsRefnos: ['1_10'],
          mesh404Refnos: [],
          mesh404GeoHashes: [],
        },
      });
      const incomplete = {
        pending: reason === 'pending' ? ['1_2'] : [],
        errors: reason === 'errors' ? { '1_2': 'boom' } : {},
        truncatedRoots: reason === 'truncated' ? ['1_2'] : [],
        budgetLimited: reason === 'budget',
      };
      collectDbnumMock.mockResolvedValue({
        dbnum: 7997,
        sites,
        siteSummaryAvailable,
        refnos: ['1_10'],
        generationRoots: ['1_1'],
        empty: [],
        skippedSites: [],
        ...incomplete,
      });

      const result = await gen.showModelByDbnum(7997);

      expect(result).toMatchObject({ loaded: false, instanceCount: 0, refnoCount: 1 });
      expect(gen.statusMessage.value).toBe(
        reason === 'errors' ? '模型加载未完成 (gen-model)' : '模型尚未就绪 (gen-model)',
      );
      expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('本次尚未绘制实例'),
      }));
      expect(gen.statusMessage.value).not.toContain('Model is empty');
    },
  );

  it('records 收齐、构件非空，但网格全部 404 而零实例：报「模型加载未完成」、回 loaded:false，不宣告空模型', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    loadInstancesMock.mockResolvedValue({
      ...loaderResult(0, 0),
      missingRefnos: ['1_10'],
      missingBreakdown: { noGeoRowsRefnos: [], mesh404Refnos: ['1_10'], mesh404GeoHashes: ['deadbeef'] },
    });
    collectDbnumMock.mockResolvedValue({
      dbnum: 7997,
      sites: [{ refno: '1_1', name: '/SITE' }],
      siteSummaryAvailable: true,
      refnos: ['1_10'],
      generationRoots: ['1_1'],
      pending: [],
      empty: [],
      truncatedRoots: [],
      errors: {},
      skippedSites: [],
      budgetLimited: false,
    });

    const result = await gen.showModelByDbnum(7997);

    expect(result).toEqual({ loaded: false, instanceCount: 0, refnoCount: 1, refnos: ['1_10'], budgetLimited: false });
    expect(gen.statusMessage.value).toBe('模型加载未完成 (gen-model)');
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning',
      message: expect.stringMatching(/^\[提示\] dbnum=7997：1 个 SITE \/ 1 个生成根，已取得 1 个 refno，本次尚未绘制实例，网格缺失 1 个 refno$/),
    }));
    const messages = emitToastMock.mock.calls.map(([toast]) => String(toast.message));
    expect(messages.join('\n')).not.toMatch(/Model is empty|没有任何几何记录|没有 SITE/);
    expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining('mesh404=1'));
  });

  it('部分网格 404 但已画出实例：仍算加载成功，汇总以警告级别注明网格缺失', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    loadInstancesMock.mockResolvedValue({
      ...loaderResult(1, 2),
      missingRefnos: ['1_11'],
      missingBreakdown: { noGeoRowsRefnos: [], mesh404Refnos: ['1_11'], mesh404GeoHashes: ['deadbeef'] },
    });
    collectDbnumMock.mockResolvedValue({
      dbnum: 7997, sites: [{ refno: '1_1', name: '/SITE' }], siteSummaryAvailable: true,
      refnos: ['1_10', '1_11'], generationRoots: ['1_1'], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [], budgetLimited: false,
    });

    const result = await gen.showModelByDbnum(7997);

    expect(result).toMatchObject({ loaded: true, instanceCount: 2, refnoCount: 2 });
    expect(gen.statusMessage.value).toBe('Model loaded (gen-model)');
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning',
      message: expect.stringMatching(/^\[提示\] dbnum=7997：1 个 SITE \/ 1 个生成根，已加载 2 个实例（1 个 refno），网格缺失 1 个 refno$/),
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
      dbnum: 4242, sites: [], siteSummaryAvailable: true,
      refnos: [], generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [],
    });
    const result = await gen.showModelByDbnum(4242);
    expect(result).toEqual({ loaded: true, instanceCount: 0, refnoCount: 0, refnos: [] });
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning', message: expect.stringContaining('没有 SITE') }));
  });

  it('整库模型已干净收口为空但 SITE 摘要失败时报告摘要不可用，不声称没有 SITE', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    collectDbnumMock.mockResolvedValue({
      dbnum: 7997,
      sites: [],
      siteSummaryAvailable: false,
      refnos: [],
      generationRoots: ['1_1'],
      pending: [],
      empty: ['1_1'],
      truncatedRoots: [],
      errors: {},
      skippedSites: [],
      budgetLimited: false,
    });

    const result = await gen.showModelByDbnum(7997);

    expect(result).toEqual({ loaded: true, instanceCount: 0, refnoCount: 0, refnos: [] });
    expect(gen.statusMessage.value).toBe('Model is empty (0 instances)');
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('模型结果没有任何几何记录（SITE 摘要不可用）'),
    }));
    const messages = emitToastMock.mock.calls.map(([toast]) => String(toast.message));
    expect(messages.join('\n')).not.toMatch(/没有 SITE|无法整库加载/);
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
