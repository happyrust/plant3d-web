/**
 * gen-model-v1 下的显示流程（plan 2026-09-06 P3-c）：容器显示的逐根进度弹窗、整库 `showModelByDbnum` 的分批装入与进度。
 * 数据源整个 mock 掉：这里只测 useModelGeneration 怎么驱动进度状态与加载器，不测适配器本身。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecordPageItem } from '@/model-source/ports';

import { generationResumeTiming } from '@/composables/generationFill';
import { __resetGenerationFillStateForTests, pendingGenerationFill } from '@/composables/generationFillState';
import {
  __resetModelLoadSessionsForTests,
  consumeModelLoadStopped,
  modelLoadSessionView,
  requestStopModelLoad,
} from '@/composables/modelLoadSession';
import { provideTreeHiddenScope, type TreeHiddenScope } from '@/composables/treeHiddenScope';
import { useModelLoadStatus } from '@/composables/useModelLoadStatus';
import { createGenModelV1ModelRecordSource } from '@/model-source/genModelV1/modelRecordSource';
import { __resetGenModelV1ServiceLifecycleForTests } from '@/model-source/genModelV1/serviceLifecycle';
import { createGenModelV1TreeSource } from '@/model-source/genModelV1/treeSource';

const emitToastMock = vi.fn();
const addLogMock = vi.fn();
const loadInstancesMock = vi.fn();
/** 记录翻页时先拉这一页的网格（`prefetchDtxGeometries`）：缺省当场拉完，不报进度 */
const prefetchMock = vi.fn();
const collectDbnumMock = vi.fn();
const visibleInstsMock = vi.fn();
const typeInfoMock = vi.fn();
const evictMock = vi.fn((_layer: unknown, _dbno: number, _refnos: string[], _options?: { release?: boolean }): string[] => []);
/** 装载器的「这个构件已经在场景里」：缺省都不在 */
const isDtxRefnoLoadedMock = vi.fn((_dbno: number, _refno: string): boolean => false);
/** 同一个问题不分库问（库号映射查不到时用）：缺省都不在 */
const isDtxRefnoLoadedAcrossAllDbnosMock = vi.fn((_refno: string): boolean => false);
const unitRefnosMock = vi.fn((_dbno: number, _root: string): string[] => []);
const { dbnumRootsMock, dbnumRowsMock, getDbnumsMock } = vi.hoisted(() => ({
  dbnumRootsMock: vi.fn(),
  dbnumRowsMock: vi.fn((): Record<string, unknown>[] => []),
  /** 整库显示开始时库状态还没取到，会要一份 `/dbnums`（共用缓存 / 在飞的那一发）：缺省回空表，绝不走到真的网络 */
  getDbnumsMock: vi.fn(async (): Promise<{ dbnums: Record<string, unknown>[] }> => ({ dbnums: [] })),
}));
const releaseLod1Mock = vi.fn();
const holdLod1Mock = vi.fn(() => releaseLod1Mock);
const noteLoadedNodeMock = vi.fn();
const forgetLoadedNodeMock = vi.fn();
/** 已加载节点表里现有的那一条（表是全页面共用的，别的 useModelGeneration 实例也往里登记）：缺省表里没有 */
const loadedNodeEntryMock = vi.fn((_refno: string): { loaded: boolean } | null => null);
/** 点过、但没有模型可显示的节点登记进表（行上说得出「未生成 / 部分生成」） */
const noteNodeWithoutModelMock = vi.fn();
/** 生成之后叫行上的状态重问一次 */
const recheckLoadedNodeMock = vi.fn();
/** 生成到一半被叫停：过一会儿再问（在飞的那一块后端照常算完） */
const recheckLoadedNodeLaterMock = vi.fn();
/** 节点一级的更新：后端已经重新生成、屏幕上还没换成时，在表里记的那一笔 */
const markLoadedNodeStaleMock = vi.fn();
/** 节点一级的更新动手之前问的节点模型状态（`node/model-status` 的整份事实）：缺省回 null = 没有那个接口 */
const nodeFactsMock = vi.fn(async (_query: { refno: string; signal?: AbortSignal }): Promise<Record<string, unknown> | null> => null);
/** 后端有没有声明清几何不再带走别人共用的东西（gen-model #142 已修）：缺省没声明 */
const purgeKeepsSharedMock = vi.fn((): boolean => false);
const listNodeVersionsMock = vi.fn();
const providedChangeQuery = vi.hoisted(() => ({ value: null as unknown }));
const providedFactsQuery = vi.hoisted(() => ({ value: null as unknown }));
const providedAncestorsQuery = vi.hoisted(() => ({ value: null as unknown }));
type GenerationFacts = {
  unitsTotal: number; unitsToGenerate: number; needsConfirm: boolean; thresholdUnits: number; exact: boolean; preferUpdate?: boolean;
};
/** 后端的生成预检（`node/model-status`）：缺省回 null = 没有那个接口 */
const generationFactsMock = vi.fn(async (_refno: string): Promise<GenerationFacts | null> => null);
/** 树的子节点（生成预检沿树数单元用）：缺省查不到 = 数不出来，按 1 个单元算 */
const treeChildrenMock = vi.fn();
/** 树的祖先链：服务端没有节点模型状态接口（旧构建）时，重载查空靠它确认「库里还有没有这个节点」。缺省问不到 */
const treeAncestorsMock = vi.fn();
/** 需确认生成的确认框：回 `'generate'` = 生成并显示，`null` = 取消 / 只显示已有的 */
const openChoiceMock = vi.hoisted(() => vi.fn());

type ProgressListener = (progress: { refno: string; root: string; done: number; total: number; stage?: string }) => void;
const progressListeners = new Set<ProgressListener>();
type MemberBatch = { refno: string; member: string; entries: Map<string, unknown[]>; done: number; total: number };
type MemberListener = (batch: MemberBatch) => void;
const memberListeners = new Set<MemberListener>();

/** 显示流程经查询选项交下来的分页回调：只收这次查询自己读到的记录页（#165） */
type PageListener = (items: readonly RecordPageItem[]) => void;
/** 显示流程自己发的记录读取（范围查询、补齐 / 重新生成之后的回查）都带着这次显示自己的分页回调（#165） */
const OWN_PAGES = { onRecordPage: expect.any(Function) };
/** 显示补齐发给记录源的请求：不带 force；带着加载会话的取消信号（加载中可以停，叫停时这一发当场取消）和分页回调 */
const FILL_REQUEST = { force: false, signal: expect.any(AbortSignal), ...OWN_PAGES };
/** 右键「重新生成模型」发给记录源的请求：唯一带 force 的入口；回查的记录页同样交给这次显示 */
const REGENERATE_REQUEST = { force: true, ...OWN_PAGES };
/** 节点一级的更新发给记录源的请求：不带 force、能取消；屏幕上的要等后面的重载才换，这一步不取网格，不带分页回调 */
const UPDATE_REQUEST = { force: false, signal: expect.any(AbortSignal) };

/** 记录源「一个成员收完」的那一批（边取边画）：给当前订阅方各送一份 */
function emitMember(refno: string, member: string, refnos: string[], done: number, total: number): void {
  const entries = new Map<string, unknown[]>(refnos.map((key) => [key, [{ geo_hash: 'g' }]]));
  for (const listener of [...memberListeners]) listener({ refno, member, entries, done, total });
}

/** 让出一轮：微任务与零延时定时器都跑完 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const v1Source = {
  kind: 'gen-model-v1' as const,
  tree: { visibleInsts: visibleInstsMock, subtreeRefnos: vi.fn(), children: treeChildrenMock, ancestors: treeAncestorsMock },
  attributes: { typeInfo: typeInfoMock },
  versions: { listNodeVersions: listNodeVersionsMock },
  records: {
    invalidateRoot: vi.fn((_root: string): string[] => []),
    /** 按构件取实例（整套替换时显示流程自己取了交给装载器）：每个构件回一条 */
    instanceEntriesByRefnos: vi.fn(async (_dbno: number, refnos: string[], _options?: { forceRefresh?: boolean }) => (
      new Map<string, unknown[]>(refnos.map((refno) => [refno, [{ geo_hash: `g:${refno}` }]]))
    )),
    /** 叫停正在进行的那次共用记录读取（加载中可以停） */
    cancelCollect: vi.fn((_refno: string): boolean => true),
    subscribeProgress: (listener: ProgressListener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    subscribeMemberRecords: (listener: MemberListener) => {
      memberListeners.add(listener);
      return () => memberListeners.delete(listener);
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

vi.mock('@/api/genModelV1Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/genModelV1Api')>();
  return {
    ...actual,
    // 整库根枚举（`dbnums/{n}/model/roots`）：显示流程不许再调它（方案 A1），留着这个 mock 只为断言「一次都没调」
    genModelV1DbnumModelRoots: (dbnum: number, options?: unknown) => dbnumRootsMock(dbnum, options),
  };
});
// 库级预检查读的是 `/dbnums` 共享缓存里现成的那一行：缺省回「已初始化、模型水位盖过」，用例按需覆盖
vi.mock('@/composables/useGenModelV1Dbnums', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useGenModelV1Dbnums')>()),
  peekGenModelV1Dbnums: () => ({ fetchedAt: 0, response: { dbnums: dbnumRowsMock() } }),
  getGenModelV1Dbnums: () => getDbnumsMock(),
}));
vi.mock('@/api/genModelRealtimeApi', () => ({ enqueueParquetIncremental: vi.fn(), getParquetVersion: vi.fn() }));
vi.mock('@/api/genModelTaskApi', () => ({ modelRegenerateByRefno: vi.fn(), modelShowByRefno: vi.fn() }));
vi.mock('@/api/genModelStreamGenerateApi', () => ({ triggerBatchGenerateSse: vi.fn() }));
vi.mock('@/composables/useConfirmDialogStore', () => ({
  useConfirmDialogStore: () => ({ confirm: vi.fn(), openChoice: openChoiceMock }),
}));
vi.mock('@/composables/useConsoleStore', () => ({ useConsoleStore: () => ({ addLog: addLogMock }) }));
vi.mock('@/composables/useDbMetaInfo', () => ({
  ensureDbMetaInfoLoaded: vi.fn(async () => {}),
  getDbnumByRefno: vi.fn(() => 7997),
  tryGetDbnumByRefno: vi.fn(() => 7997),
}));
vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  evictDtxRefnos: evictMock,
  holdDtxLod1Backfill: holdLod1Mock,
  isDtxRefnoLoaded: (dbno: number, refno: string) => isDtxRefnoLoadedMock(dbno, refno),
  isDtxRefnoLoadedAcrossAllDbnos: (refno: string) => isDtxRefnoLoadedAcrossAllDbnosMock(refno),
  loadDbnoInstancesForVisibleRefnosDtx: loadInstancesMock,
  prefetchDtxGeometries: (...args: unknown[]) => prefetchMock(...args),
  resolveDtxRefnosByUnitRefno: unitRefnosMock,
}));
vi.mock('@/composables/useDbnoInstancesParquetLoader', () => ({
  useDbnoInstancesParquetLoader: () => ({ isParquetAvailable: vi.fn(), queryAllRefnosByDbno: vi.fn() }),
}));
// 已加载节点表（C2）：这里只看显示流程在什么时候登记 / 撤表、带的是哪一版的水位
vi.mock('@/composables/useLoadedNodeStatus', () => ({
  noteLoadedNode: (...args: unknown[]) => noteLoadedNodeMock(...args),
  forgetLoadedNode: (...args: unknown[]) => forgetLoadedNodeMock(...args),
  loadedNodeEntry: (refno: string) => loadedNodeEntryMock(refno),
  noteNodeWithoutModel: (...args: unknown[]) => noteNodeWithoutModelMock(...args),
  recheckLoadedNode: (...args: unknown[]) => recheckLoadedNodeMock(...args),
  recheckLoadedNodeLater: (...args: unknown[]) => recheckLoadedNodeLaterMock(...args),
  markLoadedNodeStale: (...args: unknown[]) => markLoadedNodeStaleMock(...args),
  provideLoadedNodeChangeQuery: (query: unknown) => { providedChangeQuery.value = query; },
  provideLoadedNodeFactsQuery: (query: unknown) => { providedFactsQuery.value = query; },
  provideLoadedNodeAncestorsQuery: (query: unknown) => { providedAncestorsQuery.value = query; },
}));
// 后端的节点模型状态接口（生成预检问它）：缺省回 null = 服务端没有这条路由，走过渡办法（沿树数）；要验接口的用例自己给
vi.mock('@/composables/nodeModelFacts', () => ({
  fetchNodeModelFacts: (query: { refno: string; signal?: AbortSignal }) => nodeFactsMock(query),
  fetchGenerationFacts: (refno: string) => generationFactsMock(refno),
  backendMeshPurgeKeepsShared: () => purgeKeepsSharedMock(),
}));
vi.mock('@/ribbon/toastBus', () => ({ emitToast: emitToastMock }));

function loaderResult(loadedRefnos: number, loadedObjects: number) {
  return {
    loadedRefnos, skippedRefnos: 0, loadedObjects, missingRefnos: [],
    missingBreakdown: { noGeoRowsRefnos: [], mesh404Refnos: [], mesh404GeoHashes: [] },
    sceneBoundingBox: null,
  };
}

/** 装载器照常装完这一批：每个构件两个对象，这一批的构件都算新装的（`loadedRefnoKeys`，被叫停时据此收回去） */
function loadedAll(refnos: string[]) {
  return { ...loaderResult(refnos.length, refnos.length * 2), loadedRefnoKeys: [...refnos] };
}

/** 装载器被叫停：对象还没开始加就收手，什么都没装 */
function loaderCancelled() {
  return { ...loaderResult(0, 0), cancelled: true, loadedRefnoKeys: [] };
}

function makeViewer() {
  return {
    scene: { objects: {}, getAABB: vi.fn(() => ({ min: [0, 0, 0], max: [1, 1, 1] })), ensureRefnos: vi.fn(), setObjectsVisible: vi.fn() },
    __dtxLayer: { hasObject: vi.fn(() => false), getBoundingBox: vi.fn(() => null) },
    __dtxAfterInstancesLoaded: vi.fn(),
    cameraFlight: { flyTo: vi.fn() },
  } as any;
}

type ConfirmDialogModule = typeof import('@/composables/useConfirmDialogStore');

/**
 * 接上真的确认弹窗状态（别的用例里它是个一问就答的桩）：几个节点同时要确认时怎么排队，要用真的才看得出来。
 * 回弹窗的状态与按钮（`ConfirmDialog.vue` 用的就是这一份）。
 */
async function useRealConfirmDialog(): Promise<ReturnType<ConfirmDialogModule['useConfirmDialogStore']>> {
  const real = await vi.importActual<ConfirmDialogModule>('@/composables/useConfirmDialogStore');
  real.__resetConfirmDialogStoreForTests();
  const dialog = real.useConfirmDialogStore();
  openChoiceMock.mockImplementation((options: Parameters<typeof dialog.openChoice>[0]) => dialog.openChoice(options));
  return dialog;
}

/** `/dbnums` 行：已初始化、模型水位盖过 = 库里有成套模型 */
const DBNUM_ROWS_WITH_MODEL = [
  { dbnum: 7997, db_type: 'DESI', initialized: true, applied_sesno: 447, model_sesno: 447 },
  { dbnum: 8000, db_type: 'DESI', initialized: true, applied_sesno: 1143, model_sesno: 1143 },
];
/** `/dbnums` 行：有成套模型，但库文件比水位新（有人保存过、还没更新进来）——这种库里可能有水位之后才建的单元 */
const DBNUM_ROWS_FILE_AHEAD = [
  { dbnum: 7997, db_type: 'DESI', initialized: true, file_latest_sesno: 748, applied_sesno: 738, model_sesno: 738, model_verdict: 'in_sync' },
  { dbnum: 8000, db_type: 'DESI', initialized: true, file_latest_sesno: 1146, applied_sesno: 1143, model_sesno: 1143, model_verdict: 'in_sync' },
];
/** `/dbnums` 行：未初始化（数据水位没立，模型按需生成） */
const DBNUM_ROWS_UNINITIALIZED = [
  { dbnum: 7997, db_type: 'DESI', initialized: false, applied_sesno: 0, model_sesno: 0 },
];

beforeEach(async () => {
  vi.clearAllMocks();
  progressListeners.clear();
  memberListeners.clear();
  __resetGenerationFillStateForTests();
  __resetModelLoadSessionsForTests();
  // 状态条的状态是全页面一份（用真的：几个加载同时在跑时状态条显示谁、「停」认谁，要看它）：每个用例从空的开始
  useModelLoadStatus().reset();
  // 「每个节点上一次装了哪些构件」是模块级的（跨实例共用）：每个用例从空的开始
  (await import('./useModelGeneration')).__resetLoadedRefnosByRootForTests();
  // 缺省不自动接着问（一发定论）：要验「超时自动接续」的用例自己把预算放开、把间隔调成 0
  generationResumeTiming.delaysMs = [0];
  generationResumeTiming.budgetMs = -1;
  treeChildrenMock.mockReset();
  treeChildrenMock.mockRejectedValue(new Error('tree children not mocked'));
  treeAncestorsMock.mockReset();
  treeAncestorsMock.mockRejectedValue(new Error('tree ancestors not mocked'));
  openChoiceMock.mockReset();
  openChoiceMock.mockResolvedValue('generate');
  dbnumRowsMock.mockReturnValue(DBNUM_ROWS_WITH_MODEL);
  getDbnumsMock.mockReset();
  getDbnumsMock.mockResolvedValue({ dbnums: [] });
  loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => loadedAll(refnos));
  prefetchMock.mockReset();
  prefetchMock.mockResolvedValue([]);
  isDtxRefnoLoadedMock.mockReset();
  isDtxRefnoLoadedMock.mockReturnValue(false);
  isDtxRefnoLoadedAcrossAllDbnosMock.mockReset();
  isDtxRefnoLoadedAcrossAllDbnosMock.mockReturnValue(false);
  loadedNodeEntryMock.mockReset();
  loadedNodeEntryMock.mockReturnValue(null);
  evictMock.mockReset();
  evictMock.mockImplementation(() => []);
  generationFactsMock.mockReset();
  generationFactsMock.mockResolvedValue(null);
  nodeFactsMock.mockReset();
  nodeFactsMock.mockResolvedValue(null);
  purgeKeepsSharedMock.mockReset();
  purgeKeepsSharedMock.mockReturnValue(false);
  typeInfoMock.mockResolvedValue({ success: true, refno: '24381_101410', noun: 'ZONE' });
});

describe('showModelByRefno（gen-model-v1）', () => {
  it('容器展开出多根：visibleInsts 期间的逐根进度驱动 totalCount / currentIndex / currentRefno；读记录不弹遮罩；结束后退订', async () => {
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
    // 读记录（collect 阶段）只走查看器左下角的状态条：整屏遮罩会把边取边画出来的模型挡在后面（方案 A3）
    expect(seen.map((s) => `${s.modal ? 'modal' : 'no-modal'} ${s.index}/${s.total} ${s.refno}`)).toEqual([
      'no-modal 2/3 24381_145018',
      'no-modal 3/3 24381_145019',
      'no-modal 3/3 24381_145020',
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

  it('超过一页的构件分批装入（首批 1000、之后翻倍），进度 30 → 95 按已装 refno 递增，结果按批累加', async () => {
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
    expect(loadInstancesMock).toHaveBeenCalledTimes(2);
    expect(loadInstancesMock.mock.calls.map((c) => (c[2] as string[]).length)).toEqual([1000, 1500]);
    expect(progressAtBatch).toEqual([30, 56]);
    const { planLoadBatchSizes } = await import('./useModelGeneration');
    expect(planLoadBatchSizes(20_000)).toEqual([1000, 2000, 4000, 8000, 5000]);
    expect(planLoadBatchSizes(800)).toEqual([800]);
    expect(planLoadBatchSizes(0)).toEqual([]);
    expect(gen.lastLoadDebug.value?.result).toEqual({ loadedRefnos: 2500, skippedRefnos: 0, loadedObjects: 2500 });
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'success', message: expect.stringContaining('2500 个几何实例') }));
  });

  it('显示先按祖先查 records；查空走一次默认重新生成，未产出仍是提示、不装载', async () => {
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
    // 「节点查询一个模型都没有 → 默认重新生成」：generateThenCollect 被调一发（这里是源级 mock）。
    // api 层 records 仍只发一次：生成后的重查命中 collectByAncestor 按请求记的备忘（mock 没真去清它）。
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    // 显示补齐不带 force（后端规范 §4.5：带了会先把范围内已有的模型清掉再算）
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith('1_2', FILL_REQUEST);
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

  it('已装进场景但被「隐藏」的 refno：恢复可见、跳过重复加载、不再查记录（房间「加载模型」对隐藏成员回归）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    // 「隐藏」留下的现场：objects 状态表里 visible=false，几何仍在 DTX 层
    viewer.scene.objects = { '24381_5542': { id: '24381_5542', visible: false, selected: false, xrayed: false } };
    viewer.__dtxLayer.hasObject.mockReturnValue(true);
    const gen = useModelGeneration({ viewer, db_num: 7997 });

    expect(await gen.showModelByRefno('24381_5542')).toBe(true);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['24381_5542'], true);
    expect(visibleInstsMock).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining('恢复可见'));
  });

  it('已加载的 SITE 再显示并定位：包围盒用显示时查到的那份记录定范围，不去逐节点问子树（原来要发 512 个 tree 请求）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_535', noun: 'SITE' });
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_535', refnos: ['24381_573', '24381_574'] });
    expect(await gen.showModelByRefno('24381_535')).toBe(true);
    expect(gen.isModelActuallyLoaded('24381_535')).toBe(true);

    // SITE 自己没有对象：按它自己问包围盒是空的，要按名下的构件问
    viewer.scene.getAABB = vi.fn((ids: string[]) => (ids.includes('24381_573') ? { min: [0, 0, 0], max: [5, 5, 5] } : null));
    visibleInstsMock.mockClear();
    viewer.cameraFlight.flyTo.mockClear();

    expect(await gen.showModelByRefno('24381_535', { flyTo: true })).toBe(true);
    expect(visibleInstsMock).toHaveBeenCalledTimes(1);
    expect(v1Source.tree.subtreeRefnos).not.toHaveBeenCalled();
    expect(viewer.scene.getAABB).toHaveBeenLastCalledWith(['24381_573', '24381_574']);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledWith(expect.objectContaining({ aabb: { min: [0, 0, 0], max: [5, 5, 5] } }));
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
  });

  it('已加载节点再显示并定位时记录查不通：照旧退到子树查询定范围', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: '24381_535', refnos: ['24381_573'] });
    expect(await gen.showModelByRefno('24381_535')).toBe(true);

    viewer.scene.getAABB = vi.fn((ids: string[]) => (ids.includes('24381_573') ? { min: [0, 0, 0], max: [5, 5, 5] } : null));
    visibleInstsMock.mockResolvedValue({ success: false, refno: '24381_535', refnos: [], error_message: 'network(0): fetch failed' });
    v1Source.tree.subtreeRefnos.mockResolvedValue({ success: true, refnos: ['24381_535', '24381_573'], truncated: false });

    expect(await gen.showModelByRefno('24381_535', { flyTo: true })).toBe(true);
    expect(v1Source.tree.subtreeRefnos).toHaveBeenCalledTimes(1);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledWith(expect.objectContaining({ aabb: { min: [0, 0, 0], max: [5, 5, 5] } }));
  });

  it('装载前把范围内的 refno 级可见态拉回 true：先前隐藏的构件不会被加载后回放再藏掉', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_101410', refnos: ['24381_5542'] });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_101410', noun: 'STRU', owner_refno: null, owner_noun: null });
    const gen = useModelGeneration({ viewer, db_num: 7997 });

    expect(await gen.showModelByRefno('24381_101410')).toBe(true);
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['24381_101410', '24381_5542'], true);
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
  });

  it('an_empty_scope_is_a_hint_not_an_error：visibleInsts 查空不退到子树、不装载（自动重新生成未产出）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24384_24935', noun: 'BRAN' });
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24384_24935', refnos: [] });
    v1Source.tree.subtreeRefnos.mockResolvedValue({ success: true, refnos: ['24384_24935'], truncated: false });
    // 默认重新生成一发：生成未产出（pending），重查仍为空 → 按提示收口
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24384_24935',
      generationRoots: [],
      items: [],
      pending: ['24384_24935'],
      empty: [],
      truncatedRoots: [],
      errors: {},
      statuses: { '24384_24935': 'generation_pending' },
    } as never);

    expect(await gen.showModelByRefno('24384_24935')).toBe(false);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(v1Source.tree.subtreeRefnos).not.toHaveBeenCalled();
    expect(gen.isModelActuallyLoaded('24384_24935')).toBe(false);
    // 2026-11-11（方案 B3）起：后端还在后台算时最后那句不再说「范围内没有已生成的模型；右键可生成」（那会让人去强制重算），
    // 改说稍后再点眼睛会接着问
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('后端还在后台生成，稍后再点眼睛会接着问'),
    }));
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('右键「重新生成模型」可生成'),
    }));
  });

  it('收集未完成且一个构件都没取到：提示稍后再显示，不装载、不记已加载、不触发自动生成', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: '1_2', refnos: [], incomplete: { pending: ['1_1', '1_3'], truncated_roots: [], errors: {} } });

    expect(await gen.showModelByRefno('1_2')).toBe(false);
    // pending（409，库正被整库任务占用）不自动重新生成：generate 同样撞锁，「稍后再显示」才是对的
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
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
    // 右键「重新生成模型」是唯一带 force 的入口
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith('24381_101410', REGENERATE_REQUEST);
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
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith('24381_145018', FILL_REQUEST);
    // 生成前的范围查询和生成后的重查都带着这次显示自己的分页回调（#165）
    expect(visibleInstsMock.mock.calls).toEqual([['24381_145018', OWN_PAGES], ['24381_145018', OWN_PAGES]]);
    expect(loadInstancesMock).toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'success', message: expect.stringContaining('已自动生成并加载'),
    }));
  });

  it('auto_generate_on_empty_records_any_noun：非几何单元（SITE）records 为空同样默认重新生成', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    // 首次查空 → 默认重新生成 → 重查拿到构件 → 正常装载（不再按 BRAN/HANG/SUPPO/EQUI 白名单过滤）
    visibleInstsMock
      .mockResolvedValueOnce({ success: true, refno: '24381_2', refnos: [] })
      .mockResolvedValue({ success: true, refno: '24381_2', refnos: ['24381_2'] });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_2', noun: 'SITE', owner_refno: null, owner_noun: null });
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24381_2',
      generationRoots: ['24381_2'],
      items: [{ refno: '24381_2' }],
      pending: [],
      empty: [],
      truncatedRoots: [],
      errors: {},
      statuses: {},
    } as never);

    const ok = await gen.showModelByRefno('24381_2');

    expect(ok).toBe(true);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith('24381_2', FILL_REQUEST);
    expect(loadInstancesMock).toHaveBeenCalled();
  });

  it.each([
    ['生成跑过了、没有可显示的东西（NoRenderableGeometry）', { empty: ['24381_145018'], statuses: { '24381_145018': 'NoRenderableGeometry' } }],
    ['确定性的生成失败', { errors: { '24381_145018': 'generation_failed: 数据损坏' } }],
  ])('auto_generate_only_once：%s——同一 refno 第二次显示不重复自动生成', async (_name, outcome) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    // 第一次：records 为空，BRAN 类型，自动生成有了定论、没有产出
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_145018', refnos: [] });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_145018', noun: 'BRAN', owner_refno: null, owner_noun: null });
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24381_145018', generationRoots: [], items: [], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {},
      ...outcome,
    } as never);

    const first = await gen.showModelByRefno('24381_145018');
    expect(first).toBe(false);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);

    // 第二次：records 仍为空，但已经有定论，不再自动生成（再发只会把同样的生成再跑一遍）
    v1Source.records.generateThenCollect.mockClear();
    const second = await gen.showModelByRefno('24381_145018');
    expect(second).toBe(false);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('右键「重新生成模型」可生成'),
    }));
  });

  it('上一次后端没做完（超时）的：再点眼睛接着问，不算「试过了」——不带 force 的生成对已有的根只是确认一下', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_145018', noun: 'BRAN', owner_refno: null, owner_noun: null });
    visibleInstsMock
      .mockResolvedValueOnce({ success: true, refno: '24381_145018', refnos: [] })
      .mockResolvedValueOnce({ success: true, refno: '24381_145018', refnos: [] })
      .mockResolvedValue({ success: true, refno: '24381_145018', refnos: ['24381_145018'] });
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24381_145018', generationRoots: [], items: [], pending: ['24381_145018'], empty: [], truncatedRoots: [], errors: {},
      statuses: { '24381_145018': 'timeout' },
    } as never);

    expect(await gen.showModelByRefno('24381_145018')).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('服务端后台继续生成，完成后再点眼睛') }));

    // 第二次点眼睛：还是查空 → 接着问（这回后端做完了）→ 装载
    expect(await gen.showModelByRefno('24381_145018')).toBe(true);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(2);
    expect(v1Source.records.generateThenCollect).toHaveBeenLastCalledWith('24381_145018', FILL_REQUEST);
    expect(loadInstancesMock).toHaveBeenCalled();
  });

  it('空分组：自动生成回了「分组为空或成员不可解析」——两次显示都提示它，不指向分组没有的「右键重新生成」', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_145900', refnos: [] });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_145900', noun: 'GPSET', owner_refno: null, owner_noun: null });
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24381_145900',
      generationRoots: [],
      items: [],
      pending: [],
      empty: ['24381_145900'],
      truncatedRoots: [],
      errors: {},
      statuses: { '24381_145900': 'NoRenderableGeometry' },
      hints: { '24381_145900': '分组为空或成员不可解析' },
    } as never);

    expect(await gen.showModelByRefno('24381_145900')).toBe(false);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('自动生成未完成：分组为空或成员不可解析'),
    }));

    emitToastMock.mockClear();
    expect(await gen.showModelByRefno('24381_145900')).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('24381_145900：分组为空或成员不可解析'),
    }));
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('右键「重新生成模型」可生成'),
    }));
  });

  it('空分组的规则零命中文案走同一条 toast / statusMessage 通道（M4 原因码分流）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_145901', refnos: [] });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_145901', noun: 'GPSET', owner_refno: null, owner_noun: null });
    // modelRecords 已按后端 `scosel_no_match` 定稿成这句；这里只验它照旧经 autoGenerateHints → toast / statusMessage 出去
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24381_145901',
      generationRoots: [],
      items: [],
      pending: [],
      empty: ['24381_145901'],
      truncatedRoots: [],
      errors: {},
      statuses: { '24381_145901': 'NoRenderableGeometry' },
      hints: { '24381_145901': '规则没有命中任何构件' },
    } as never);

    expect(await gen.showModelByRefno('24381_145901')).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('自动生成未完成：规则没有命中任何构件'),
    }));

    emitToastMock.mockClear();
    expect(await gen.showModelByRefno('24381_145901')).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('24381_145901：规则没有命中任何构件'),
    }));
    // 不再回落到含糊的兜底文案，也不指向分组没有的「右键重新生成」
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('分组为空或成员不可解析'),
    }));
  });

  it('库未初始化（/dbnums 那一行）且节点查空：默认重新生成当前节点，生成出构件后正常装载；不做整库根枚举', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    // 库级：`/dbnums` 说这个库没初始化 → 库里没有成套模型
    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
    visibleInstsMock
      .mockResolvedValueOnce({ success: true, refno: '24381_101410', refnos: [] })
      .mockResolvedValue({ success: true, refno: '24381_101410', refnos: ['24381_101410'] });
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24381_101410',
      generationRoots: ['24381_101410'],
      items: [{ refno: '24381_101410' }],
      pending: [],
      empty: [],
      truncatedRoots: [],
      errors: {},
      statuses: {},
    } as never);

    const ok = await gen.showModelByRefno('24381_101410');

    expect(ok).toBe(true);
    expect(dbnumRootsMock).not.toHaveBeenCalled();
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith('24381_101410', FILL_REQUEST);
    expect(loadInstancesMock).toHaveBeenCalled();
    expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining('dbnum=7997 库里没有成套模型'));
  });

  it('display_fill_is_never_forced：记录查询失败（退到子树也没查通）时不生成，哪怕库里没有成套模型', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    // 2026-11-10 之前：查询失败 + 库级预检查说「没有就绪模型」→ 自动发 force 的生成，一次瞬时读失败就可能把库里的模型清掉重算
    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
    visibleInstsMock.mockResolvedValue({ success: false, refno: '24381_101410', refnos: [], error_message: 'internal(500): boom' });
    v1Source.tree.subtreeRefnos.mockResolvedValue({ success: false, refnos: [], truncated: true, error_message: 'internal(500): boom' });

    await gen.showModelByRefno('24381_101410');

    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning', message: expect.stringContaining('查询加载范围失败'),
    }));
  });

  it('记录查询失败、退到子树查询拿到空表：那不是「查空」，不生成', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
    visibleInstsMock.mockResolvedValue({ success: false, refno: '24381_101410', refnos: [], error_message: 'network(0): fetch failed' });
    v1Source.tree.subtreeRefnos.mockResolvedValue({ success: true, refnos: [], truncated: false });

    expect(await gen.showModelByRefno('24381_101410')).toBe(false);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning', message: expect.stringContaining('记录查询没有应答'),
    }));
  });

  it('查询成功但没收齐（部分 ZONE 出错）且一个构件都没有：不知道是不是真空，不生成', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
    visibleInstsMock.mockResolvedValue({
      success: true, refno: '24381_535', refnos: [],
      incomplete: { pending: [], truncated_roots: [], errors: { '24381_571': 'internal(500): boom' } },
    });

    expect(await gen.showModelByRefno('24381_535')).toBe(false);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('尚未取得可见实例（出错 1 根）'),
    }));
  });

  it.each([
    ['model_lagging', '模型正在追平已入库的数据'],
    ['initialization_publishing', '这个库正在更新'],
  ])('库的读源理由是 %s 且节点查空：查空不代表没生成过，不自动生成，给提示', async (reason, hint) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    dbnumRowsMock.mockReturnValue([
      { dbnum: 7997, db_type: 'DESI', initialized: true, applied_sesno: 46, model_sesno: 41, model_source: 'memory', model_source_reason: reason },
    ]);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '23714_997', refnos: [] });

    expect(await gen.showModelByRefno('23714_997')).toBe(false);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining(hint),
    }));
  });

  it('库未初始化但节点查到了记录：照查照装，不生成；显示流程一次整库根枚举都不发', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    // `/dbnums` 说库里没有成套模型；但 records 实际查得到（按需生成过）→ 记录赢，直接装载
    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_101410', refnos: ['24381_101410'] });

    expect(await gen.showModelByRefno('24381_101410')).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalled();
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();

    expect(await gen.showModelByRefno('24381_101411')).toBe(true);
    expect(dbnumRootsMock).not.toHaveBeenCalled();
  });

  it('/dbnums 缓存里没有这个库（不知道）：不挡显示，也不拿它当「没有模型」', async () => {
    const { useModelGeneration, dbnumRowLacksModel } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    dbnumRowsMock.mockReturnValue([]);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_101410', refnos: ['24381_101410'] });

    expect(await gen.showModelByRefno('24381_101410')).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalled();
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();

    // 判据本身：未初始化 / 模型水位没盖过 = 没有；有水位 = 有；行不在或老服务端不带这两格 = 不知道
    expect(dbnumRowLacksModel({ dbnum: 7997, initialized: false })).toBe(true);
    expect(dbnumRowLacksModel({ dbnum: 7997, initialized: true, model_sesno: 0 })).toBe(true);
    expect(dbnumRowLacksModel({ dbnum: 1112, initialized: true, model_sesno: 738 })).toBe(false);
    expect(dbnumRowLacksModel({ dbnum: 1112 })).toBeNull();
    expect(dbnumRowLacksModel(null)).toBeNull();
  });

  it('查空之后不等任何库级请求：记录回空就直接进自动生成（预检查是同步读缓存）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
    // 假如还有人去枚举整库根，这个请求永远不回——显示流程不许被它挂住
    dbnumRootsMock.mockImplementation(() => new Promise(() => {}));
    visibleInstsMock
      .mockResolvedValueOnce({ success: true, refno: '24381_571', refnos: [] })
      .mockResolvedValue({ success: true, refno: '24381_571', refnos: ['24381_573'] });

    expect(await gen.showModelByRefno('24381_571')).toBe(true);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(dbnumRootsMock).not.toHaveBeenCalled();

    // 源码钉：显示流程不引用整库根枚举接口
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, 'useModelGeneration.ts'), 'utf8');
    expect(source).not.toMatch(/genModelV1DbnumModelRoots/);
  });

  it('库里没有成套模型且自动生成未产出：提示、不装载、不记已加载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_101410', refnos: [] });
    v1Source.records.generateThenCollect.mockResolvedValueOnce({
      refno: '24381_101410',
      generationRoots: [],
      items: [],
      pending: ['24381_101410'],
      empty: [],
      truncatedRoots: [],
      errors: {},
      statuses: { '24381_101410': 'generation_pending' },
    } as never);

    expect(await gen.showModelByRefno('24381_101410')).toBe(false);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(gen.isModelActuallyLoaded('24381_101410')).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('服务端后台继续生成'),
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
      emptyScopes: [],
    });

    visibleInstsMock.mockResolvedValueOnce({
      success: true, refno: '1_2', refnos: [], incomplete: { pending: [], truncated_roots: ['1/4'], errors: { '1/3': 'boom' } },
      // 查过、一条记录都没有的范围（模型资产补齐按它分块）：同样归一成 a_b
      empty_scopes: ['1/5', '1_6', '1/5'],
    });
    v1Source.tree.subtreeRefnos.mockResolvedValueOnce({ success: true, refnos: ['1_2', '1_3'], truncated: false });
    expect(await queryLoadScopeRefnos('1_2')).toEqual({
      refnos: [], source: 'visible-insts', truncated: false,
      incomplete: { pending: [], truncated_roots: ['1_4'], errors: { '1_3': 'boom' } },
      emptyScopes: ['1_5', '1_6'],
    });
    expect(v1Source.tree.subtreeRefnos).not.toHaveBeenCalled();

    visibleInstsMock.mockResolvedValueOnce({
      success: true, refno: '1_2', refnos: ['1_10'], incomplete: { pending: [], truncated_roots: [], errors: {} },
    });
    expect((await queryLoadScopeRefnos('1_2')).incomplete).toBeNull();
  });
});

describe('showModelByRefno 与已加载节点表（方案 2026-11-10 C2）', () => {
  beforeEach(() => {
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_535', noun: 'SITE' });
  });

  it('节点装完登记进表，带的是开始取数之前读到的库水位（装的过程中水位变了也不跟着变）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    dbnumRowsMock.mockReturnValue([{ dbnum: 8000, db_type: 'DESI', initialized: true, applied_sesno: 1140, model_sesno: 1140, file_latest_sesno: 1143 }]);
    visibleInstsMock.mockImplementation(async () => {
      // 取数期间后端跑完了一个批次
      dbnumRowsMock.mockReturnValue([{ dbnum: 8000, db_type: 'DESI', initialized: true, applied_sesno: 1143, model_sesno: 1143, file_latest_sesno: 1143 }]);
      return { success: true, refno: '24381_535', refnos: ['24381_1'] };
    });

    expect(await gen.showModelByRefno('24381/535')).toBe(true);
    expect(noteLoadedNodeMock).toHaveBeenCalledTimes(1);
    expect(noteLoadedNodeMock).toHaveBeenCalledWith('24381_535', 8000, { modelSesno: 1140, fileLatestSesno: 1143 });
  });

  it('库状态当时没取到：照样登记，水位记空', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    dbnumRowsMock.mockReturnValue([]);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_535', refnos: ['24381_1'] });
    expect(await gen.showModelByRefno('24381_535')).toBe(true);
    expect(noteLoadedNodeMock).toHaveBeenCalledWith('24381_535', 8000, { modelSesno: null, fileLatestSesno: null });
  });

  it('没收齐（有成员 409）或没装出东西：不登记', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockResolvedValue({
      success: true, refno: '24381_535', refnos: ['24381_1'],
      incomplete: { pending: ['24381_571'], truncated_roots: [], errors: {} },
    });
    expect(await gen.showModelByRefno('24381_535')).toBe(true);
    expect(noteLoadedNodeMock).not.toHaveBeenCalled();

    loadInstancesMock.mockResolvedValue(loaderResult(0, 0));
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_776', refnos: ['24381_2'] });
    expect(await gen.showModelByRefno('24381_776')).toBe(false);
    expect(noteLoadedNodeMock).not.toHaveBeenCalled();
  });

  it('先点亮过它下面的节点、名下的构件已经全在场景里（装载器一个也不用装）：照样记为已加载、登记进表；再点不重查', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    const ZONE = '24381_536';
    const SITE = '24381_535';
    const MEMBERS = ['24381_601', '24381_602'];
    typeInfoMock.mockImplementation(async (refno: string) => ({ success: true, refno, noun: refno === ZONE ? 'ZONE' : 'SITE' }));
    // SITE 名下就这一个 ZONE：两个节点查到的是同一批构件
    visibleInstsMock.mockImplementation(async (refno: string) => ({ success: true, refno, refnos: MEMBERS }));
    // 装载器照真的那样：已经在场景里的跳过
    const inScene = new Set<string>();
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
      const fresh = refnos.filter((refno) => !inScene.has(refno));
      for (const refno of fresh) inScene.add(refno);
      return { ...loaderResult(fresh.length, fresh.length * 2), skippedRefnos: refnos.length - fresh.length, loadedRefnoKeys: fresh };
    });
    dbnumRowsMock.mockReturnValue([{ dbnum: 8000, db_type: 'DESI', initialized: true, applied_sesno: 1140, model_sesno: 1140, file_latest_sesno: 1143 }]);

    expect(await gen.showModelByRefno(ZONE)).toBe(true);
    expect(noteLoadedNodeMock).toHaveBeenCalledTimes(1);
    expect(gen.isModelActuallyLoaded(SITE)).toBe(false);
    emitToastMock.mockClear();

    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(gen.lastLoadDebug.value?.result).toEqual({ loadedRefnos: 0, skippedRefnos: 2, loadedObjects: 0 });
    expect(gen.statusMessage.value).toBe('已加载 (gen-model)');
    // 模型树的眼睛认的是前一处，取最新认的是后一处（已加载节点表，带的是这次开始取数之前读到的库水位）
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
    expect(noteLoadedNodeMock).toHaveBeenCalledTimes(2);
    expect(noteLoadedNodeMock).toHaveBeenLastCalledWith(SITE, 8000, { modelSesno: 1140, fileLatestSesno: 1143 });
    expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining(`refno=${SITE} 构件都已在场景中，按已加载收口`));
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));

    // 已经记成已加载：再点只是恢复可见，不再查记录、不再过装载器
    visibleInstsMock.mockClear();
    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(visibleInstsMock).not.toHaveBeenCalled();
    expect(loadInstancesMock).toHaveBeenCalledTimes(2);
  });

  it('没收齐（有成员 409）而已取得的构件都在场景里：照旧不记为已加载、不登记（下次再点还要重查）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockResolvedValue({
      success: true, refno: '24381_535', refnos: ['24381_1'],
      incomplete: { pending: ['24381_571'], truncated_roots: [], errors: {} },
    });
    loadInstancesMock.mockResolvedValue({ ...loaderResult(0, 0), skippedRefnos: 1 });

    expect(await gen.showModelByRefno('24381_535')).toBe(true);
    expect(gen.statusMessage.value).toMatch(/^部分加载 \(gen-model，/);
    expect(gen.isModelActuallyLoaded('24381_535')).toBe(false);
    expect(noteLoadedNodeMock).not.toHaveBeenCalled();

    expect(await gen.showModelByRefno('24381_535')).toBe(true);
    expect(visibleInstsMock).toHaveBeenCalledTimes(2);
  });

  it('已加载的节点在行上点「生成」、构件都在场景里（什么都没换）：不重新登记，装的时候记的那一版不动', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    dbnumRowsMock.mockReturnValue([{ dbnum: 8000, db_type: 'DESI', initialized: true, applied_sesno: 1140, model_sesno: 1140, file_latest_sesno: 1143 }]);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_535', refnos: ['24381_1'] });
    expect(await gen.showModelByRefno('24381_535')).toBe(true);
    expect(noteLoadedNodeMock).toHaveBeenCalledTimes(1);

    // 库往前走了一版；这时点行上的「生成」：构件都在场景里，装载器一个也不装
    dbnumRowsMock.mockReturnValue([{ dbnum: 8000, db_type: 'DESI', initialized: true, applied_sesno: 1143, model_sesno: 1143, file_latest_sesno: 1143 }]);
    loadInstancesMock.mockResolvedValue({ ...loaderResult(0, 0), skippedRefnos: 1 });
    expect(await gen.showModelByRefno('24381_535', { flyTo: false, fill: true })).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalledTimes(2);
    expect(gen.isModelActuallyLoaded('24381_535')).toBe(true);
    // 表里还是装的时候那一版（1140）：屏幕上的没换过，取最新要认得出它比库旧
    expect(noteLoadedNodeMock).toHaveBeenCalledTimes(1);
    expect(noteLoadedNodeMock).toHaveBeenLastCalledWith('24381_535', 8000, { modelSesno: 1140, fileLatestSesno: 1143 });
    expect(forgetLoadedNodeMock).not.toHaveBeenCalled();
  });

  it('构件都在场景里、已加载节点表里也已经有这个节点（别的实例登记的）：只在这个实例里记成已加载，不拿此刻的水位盖掉那一条', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    const REGISTERED = '24381_535';
    const ONLY_CLICKED = '24381_776';
    // 前一个已经装着、在表里；后一个表里只有「点过、没有模型可显示」的一条（不算登记过）
    loadedNodeEntryMock.mockImplementation((refno: string) => (
      refno === REGISTERED ? { loaded: true } : refno === ONLY_CLICKED ? { loaded: false } : null
    ));
    visibleInstsMock.mockImplementation(async (refno: string) => ({ success: true, refno, refnos: ['24381_1'] }));
    loadInstancesMock.mockResolvedValue({ ...loaderResult(0, 0), skippedRefnos: 1 });

    expect(await gen.showModelByRefno(REGISTERED)).toBe(true);
    expect(gen.isModelActuallyLoaded(REGISTERED)).toBe(true);
    expect(noteLoadedNodeMock).not.toHaveBeenCalled();

    expect(await gen.showModelByRefno(ONLY_CLICKED)).toBe(true);
    expect(gen.isModelActuallyLoaded(ONLY_CLICKED)).toBe(true);
    expect(noteLoadedNodeMock).toHaveBeenCalledTimes(1);
    expect(noteLoadedNodeMock).toHaveBeenCalledWith(ONLY_CLICKED, 8000, expect.anything());
    expect(forgetLoadedNodeMock).not.toHaveBeenCalled();
  });

  it('重载：装完重新登记（换成新的水位）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    dbnumRowsMock.mockReturnValue([{ dbnum: 8000, initialized: true, model_sesno: 1140, file_latest_sesno: 1143 }]);
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_535', refnos: ['24381_1'] });
    await gen.showModelByRefno('24381_535');
    dbnumRowsMock.mockReturnValue([{ dbnum: 8000, initialized: true, model_sesno: 1143, file_latest_sesno: 1143 }]);
    expect(await gen.showModelByRefno('24381_535', { refresh: true })).toBe(true);
    expect(noteLoadedNodeMock).toHaveBeenLastCalledWith('24381_535', 8000, { modelSesno: 1143, fileLatestSesno: 1143 });
  });

  it('给节点表接上的变化查询：问节点版本表（子树范围、从给定会话之后），不影响模型的会话不算', async () => {
    await import('./useModelGeneration');
    const query = providedChangeQuery.value as (input: { dbnum: number; refno: string; sinceSesno: number; signal?: AbortSignal }) => Promise<unknown>;
    expect(typeof query).toBe('function');
    listNodeVersionsMock.mockResolvedValue({
      versions: [
        { sesno: 740, sessionTime: null, impact: 'noop', selfImpact: null, unitsChanged: 0, unitsTouched: 1 },
        { sesno: 742, sessionTime: 't742', impact: 'mesh', selfImpact: null, unitsChanged: 3, unitsTouched: 3 },
        { sesno: 745, sessionTime: null, impact: 'tombstone', selfImpact: null, unitsChanged: 1, unitsTouched: 1 },
      ],
    });
    const signal = new AbortController().signal;
    expect(await query({ dbnum: 1112, refno: '9304_2', sinceSesno: 738, signal })).toEqual([
      { sesno: 742, time: 't742', unitsChanged: 3 },
      { sesno: 745, time: null, unitsChanged: 1 },
    ]);
    expect(listNodeVersionsMock).toHaveBeenCalledWith(1112, '9304_2', 'subtree', { sinceSesno: 738, signal });
  });

  it('给节点表接上的祖先链查询（后端跑完一批时，找被重新生成的单元在哪些已装节点下面）：问树的祖先链，回自己到根的那一串；没查到回空的', async () => {
    await import('./useModelGeneration');
    const query = providedAncestorsQuery.value as (refno: string) => Promise<readonly string[]>;
    expect(typeof query).toBe('function');
    treeAncestorsMock.mockResolvedValue({ success: true, refnos: ['24384_47470', '24384_47463', '24384_100'] });
    expect(await query('24384_47470')).toEqual(['24384_47470', '24384_47463', '24384_100']);
    expect(treeAncestorsMock).toHaveBeenCalledWith('24384_47470');

    treeAncestorsMock.mockResolvedValue({ success: false, refnos: [], error_message: 'not_found (404)' });
    expect(await query('24384_47470')).toEqual([]);
  });

  it('重载时发现这根已经没有几何（被删了，后端也这么说）：从场景撤下，同时撤表', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_535', refnos: ['24381_1'] });
    await gen.showModelByRefno('24381_535');
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_535', refnos: [] });
    // 记录查空不等于已删除：后端明说库里没有这个节点了才撤
    nodeFactsMock.mockRejectedValue(Object.assign(new Error('最新会话的索引里没有它'), { code: 'REFNO_NOT_FOUND' }));
    expect(await gen.showModelByRefno('24381_535', { refresh: true })).toBe(true);
    expect(forgetLoadedNodeMock).toHaveBeenCalledWith('24381_535');
  });
});

describe('showModelByRefno 边取边画（方案 2026-11-10 A3）', () => {
  const SITE = '24381_535';
  const ALL = ['24381_1', '24381_2', '24381_3', '24381_4', '24381_5', '24381_6'];

  beforeEach(() => {
    typeInfoMock.mockResolvedValue({ success: true, refno: SITE, noun: 'SITE' });
  });

  /** 三个成员先后到：第一个立刻装；第二个攒不够翻倍先留着；第三个到了一起装；`24381_6` 没经批次，收齐后兜底 */
  function threeMembersThenAll(after?: () => void | Promise<void>) {
    visibleInstsMock.mockImplementation(async () => {
      emitMember(SITE, '24381_536', ['24381_1', '24381_2'], 1, 3);
      await tick();
      await after?.();
      emitMember(SITE, '24381_571', ['24381_3'], 2, 3);
      emitMember(SITE, '24381_621', ['24381_4', '24381_5'], 3, 3);
      await tick();
      return { success: true, refno: SITE, refnos: ALL };
    });
  }

  it('成员一到就装第一批，不等全部记录；之后按翻倍攒批；收齐后只装剩下的；合计照算、记为已加载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    let loadsBeforeAllRecordsArrived = -1;
    threeMembersThenAll(() => { loadsBeforeAllRecordsArrived = loadInstancesMock.mock.calls.length; });

    const ok = await gen.showModelByRefno(SITE, { flyTo: false });

    expect(ok).toBe(true);
    expect(loadsBeforeAllRecordsArrived).toBe(1);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([
      ['24381_1', '24381_2'],
      ['24381_3', '24381_4', '24381_5'],
      ['24381_6'],
    ]);
    // 边取边画的批：实例表直接带过去（不回头查缓存）、每批都重建，装完照样走回放钩子
    const firstOptions = loadInstancesMock.mock.calls[0]![3] as { instanceEntriesByRefno?: Map<string, unknown>; recompile?: boolean };
    expect([...firstOptions.instanceEntriesByRefno!.keys()]).toEqual(['24381_1', '24381_2']);
    expect(firstOptions.recompile).toBe(true);
    expect(loadInstancesMock.mock.calls[2]![3]).not.toHaveProperty('instanceEntriesByRefno');
    expect(viewer.__dtxAfterInstancesLoaded.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      ['24381_1', '24381_2'],
      ['24381_3', '24381_4', '24381_5'],
      ['24381_6'],
    ]);
    // 每个构件只在装它的那一批之前被置为可见一次（根在第一批）
    expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([
      [[SITE, '24381_1', '24381_2'], true],
      [['24381_3', '24381_4', '24381_5'], true],
      [[SITE, '24381_6'], true],
    ]);
    expect(gen.lastLoadDebug.value?.result).toEqual({ loadedRefnos: 6, skippedRefnos: 0, loadedObjects: 12 });
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'success', message: expect.stringContaining('12 个几何实例') }));
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
    expect(memberListeners.size).toBe(0);
  });

  it('全部构件都经批次装完时，收齐后不再空跑一遍装载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock.mockImplementation(async () => {
      emitMember(SITE, '24381_536', ['24381_1', '24381_2'], 1, 2);
      await tick();
      emitMember(SITE, '24381_571', ['24381_3', '24381_4'], 2, 2);
      await tick();
      return { success: true, refno: SITE, refnos: ['24381_1', '24381_2', '24381_3', '24381_4'] };
    });

    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalledTimes(2);
    expect(viewer.__dtxAfterInstancesLoaded).toHaveBeenCalledTimes(2);
    expect(gen.lastLoadDebug.value?.result).toEqual({ loadedRefnos: 4, skippedRefnos: 0, loadedObjects: 8 });
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
  });

  it('记录还没收齐时，最后到的那些攒着不装也不丢：收齐后由收尾装', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockImplementation(async () => {
      emitMember(SITE, '24381_536', ['24381_1', '24381_2', '24381_3'], 1, 2);
      await tick();
      // 只来了 1 个，不够翻倍、离上一批也不到 0.5 秒：攒着
      emitMember(SITE, '24381_571', ['24381_4'], 2, 2);
      await tick();
      return { success: true, refno: SITE, refnos: ['24381_1', '24381_2', '24381_3', '24381_4'] };
    });

    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([['24381_1', '24381_2', '24381_3'], ['24381_4']]);
  });

  it('边取边画之后的收尾一批装完，不再按「首批 1000、之后翻倍」分批（场景里已经有东西了）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    const rest = Array.from({ length: 2500 }, (_, i) => `24381_${i + 100}`);
    visibleInstsMock.mockImplementation(async () => {
      emitMember(SITE, '24381_536', ['24381_1', '24381_2'], 1, 2);
      await tick();
      return { success: true, refno: SITE, refnos: ['24381_1', '24381_2', ...rest] };
    });

    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(loadInstancesMock.mock.calls.map((call) => (call[2] as string[]).length)).toEqual([2, 2500]);
    expect(loadInstancesMock.mock.calls[1]![3]).toMatchObject({ recompile: true });
    expect(viewer.__dtxAfterInstancesLoaded).toHaveBeenCalledTimes(2);
  });

  it('同一个节点已有一路在边取边画时，第二路（别的实例 / 别的入口）不再开，免得两路同时装同一批构件', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const treeSide = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const viewerSide = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    visibleInstsMock.mockImplementation(async () => {
      await gate;
      return { success: true, refno: SITE, refnos: ['24381_1'] };
    });

    const first = treeSide.showModelByRefno(SITE);
    await tick();
    expect(memberListeners.size).toBe(1);
    const second = viewerSide.showModelByRefno(SITE);
    await tick();
    expect(memberListeners.size).toBe(1);

    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(memberListeners.size).toBe(0);

    // 两路都收尾之后占位已撤：再显示时又可以边取边画
    let releaseAgain!: () => void;
    const gateAgain = new Promise<void>((resolve) => { releaseAgain = resolve; });
    visibleInstsMock.mockImplementation(async () => {
      await gateAgain;
      return { success: true, refno: SITE, refnos: ['24381_2'] };
    });
    // 换一份没装过这个节点的实例（装过的那两份会按「已在场景中」直接返回，走不到查询）
    const again = useModelGeneration({ viewer: makeViewer(), db_num: 7997 }).showModelByRefno(SITE);
    await tick();
    expect(memberListeners.size).toBe(1);
    releaseAgain();
    await again;
    expect(memberListeners.size).toBe(0);
  });

  it('相机：第一批到就飞一次，收齐后再对整体对一次焦', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    viewer.__dtxViewer = { canvas: new EventTarget() };
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    let fliesBeforeAllRecordsArrived = -1;
    threeMembersThenAll(() => { fliesBeforeAllRecordsArrived = viewer.cameraFlight.flyTo.mock.calls.length; });

    expect(await gen.showModelByRefno(SITE, { flyTo: true })).toBe(true);
    expect(fliesBeforeAllRecordsArrived).toBe(1);
    expect(viewer.scene.getAABB.mock.calls[0]![0]).toEqual(['24381_1', '24381_2']);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledTimes(2);
    expect(viewer.scene.getAABB.mock.calls.at(-1)![0]).toEqual(ALL);
  });

  it.each(['pointerdown', 'wheel', 'touchstart'])('相机：第一批飞过之后用户在视口里动过（%s），收齐后不再把相机拽走', async (eventName) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const canvas = new EventTarget();
    viewer.__dtxViewer = { canvas };
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    threeMembersThenAll(() => { canvas.dispatchEvent(new Event(eventName)); });

    expect(await gen.showModelByRefno(SITE, { flyTo: true })).toBe(true);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledTimes(1);

    // 监听只挂在这一次装载期间：结束后再动视口不影响下一次显示
    canvas.dispatchEvent(new Event(eventName));
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_776', refnos: ['24381_900'] });
    expect(await gen.showModelByRefno('24381_776', { flyTo: true })).toBe(true);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledTimes(2);
  });

  it('没经过边取边画的显示（一发查完的节点）：相机照旧只在装完后飞一次，用户动过视口也飞', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const canvas = new EventTarget();
    viewer.__dtxViewer = { canvas };
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock.mockImplementation(async () => {
      canvas.dispatchEvent(new Event('pointerdown'));
      return { success: true, refno: SITE, refnos: ['24381_1'] };
    });
    expect(await gen.showModelByRefno(SITE, { flyTo: true })).toBe(true);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledTimes(1);
  });

  it('收集没完成（有成员 409）：到了的照画，但不记为已加载，下次还要再查', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockImplementation(async () => {
      emitMember(SITE, '24381_536', ['24381_1', '24381_2'], 1, 2);
      await tick();
      return {
        success: true, refno: SITE, refnos: ['24381_1', '24381_2'],
        incomplete: { pending: ['24381_571'], truncated_roots: [], errors: {} },
      };
    });

    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
    expect(gen.isModelActuallyLoaded(SITE)).toBe(false);
    expect(gen.statusMessage.value).toContain('部分加载');
  });

  it('别的节点的批次不理会', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockImplementation(async () => {
      emitMember('24381_776', '24381_777', ['24381_900', '24381_901'], 1, 1);
      await tick();
      return { success: true, refno: SITE, refnos: ['24381_1'] };
    });

    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([['24381_1']]);
  });

  it('某一批装载出错：停止边取边画，那一批连同后面的都由收尾兜底，不丢构件', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    loadInstancesMock
      .mockRejectedValueOnce(new Error('texture upload failed'))
      .mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => loaderResult(refnos.length, refnos.length * 2));
    threeMembersThenAll();

    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([['24381_1', '24381_2'], ALL]);
    expect(gen.lastLoadDebug.value?.result).toEqual({ loadedRefnos: 6, skippedRefnos: 0, loadedObjects: 12 });
    expect(addLogMock).toHaveBeenCalledWith('warning', expect.stringContaining('texture upload failed'));
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
  });

  it.each([
    ['右键重新生成', { regenerate: true }],
    ['重载', { refresh: true }],
  ])('%s 不走边取边画：整套替换，一次装完', async (_name, loadOptions) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    threeMembersThenAll();

    expect(await gen.showModelByRefno(SITE, loadOptions)).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
    expect(loadInstancesMock.mock.calls[0]![2]).toEqual(ALL);
    expect(loadInstancesMock.mock.calls[0]![3]).toMatchObject({ replaceExistingObjects: true });
    // 交给装载器的实例是整个范围的（刚查回来的那一份），不是边取边画那样的一批成员
    const entries = (loadInstancesMock.mock.calls[0]![3] as { instanceEntriesByRefno?: Map<string, unknown[]> }).instanceEntriesByRefno;
    expect([...entries!.keys()]).toEqual(ALL);
  });

  it('遮罩只在生成阶段弹：边取边画期间读记录的进度不弹，自动补齐 / 重新生成的逐根进度照旧弹', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const seen: string[] = [];
    visibleInstsMock.mockImplementation(async () => {
      for (const listener of progressListeners) listener({ refno: SITE, root: '24381_536', done: 1, total: 3, stage: 'collect' });
      seen.push(`collect:${gen.showProgressModal.value}`);
      for (const listener of progressListeners) listener({ refno: SITE, root: '24381_536', done: 1, total: 3, stage: 'generate-start' });
      seen.push(`generate-start:${gen.showProgressModal.value}`);
      return { success: true, refno: SITE, refnos: ['24381_1'] };
    });
    await gen.showModelByRefno(SITE);
    expect(seen).toEqual(['collect:false', 'generate-start:true']);
    expect(gen.showProgressModal.value).toBe(false);
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

  it('整库装载期间持有粗网格补拉（成功、抛错都在收尾解除）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    let heldDuringCollect = 0;
    collectDbnumMock.mockImplementation(async (dbnum: number) => {
      heldDuringCollect = holdLod1Mock.mock.calls.length - releaseLod1Mock.mock.calls.length;
      return {
        dbnum, sites: [{ refno: '24381_1', name: '/S' }], refnos: ['24381_2'], generationRoots: ['24381_2'],
        pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [],
      };
    });
    await gen.showModelByDbnum(7997);
    expect(heldDuringCollect).toBe(1);
    expect(holdLod1Mock).toHaveBeenCalledTimes(1);
    expect(releaseLod1Mock).toHaveBeenCalledTimes(1);

    collectDbnumMock.mockRejectedValue(new Error('network: down'));
    await gen.showModelByDbnum(7997);
    expect(holdLod1Mock).toHaveBeenCalledTimes(2);
    expect(releaseLod1Mock).toHaveBeenCalledTimes(2);
  });
});

/**
 * 更新提示上的「重载」（`refresh`）：增量更新案例集合 K07–K09（gen-model
 * `docs/plans/2026-10-27-plant3d-web-incremental-linkage-test-cases.md`）。重载只换记录，永远不生成。
 */
describe('showModelByRefno 重载（refresh）', () => {
  const EQUI = '24384_24776';

  beforeEach(() => {
    // 前面的用例会留下没消费的 mockResolvedValueOnce（clearAllMocks 不清队列），这里的用例每次都自己给返回值
    visibleInstsMock.mockReset();
    v1Source.tree.subtreeRefnos.mockReset();
    typeInfoMock.mockResolvedValue({ success: true, refno: EQUI, noun: 'EQUI', owner_refno: null, owner_noun: null });
  });

  it('K07 已在场景也不短路：清这根的记录缓存、按 replace 重装，不生成、不飞相机、没少构件就不撤', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    viewer.scene.objects[EQUI] = {};
    viewer.__dtxLayer.hasObject = vi.fn(() => true);
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    v1Source.records.invalidateRoot.mockReturnValueOnce([EQUI, '24384_24777']);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: EQUI, refnos: ['24384_24777'] });

    expect(await gen.showModelByRefno(EQUI, { refresh: true, flyTo: false })).toBe(true);

    expect(v1Source.records.invalidateRoot).toHaveBeenCalledWith(EQUI);
    expect(visibleInstsMock).toHaveBeenCalledWith(EQUI, OWN_PAGES);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 8000, ['24384_24777'], expect.objectContaining({
      dataSource: 'gen-model-v1', replaceExistingObjects: true, forceRefreshGeometries: true, forceReloadRefnos: ['24384_24777'],
    }));
    expect(viewer.cameraFlight.flyTo).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
  });

  it('重载：范围查询刚查回来的构件，实例直接从记录缓存拿了交给装载器，不让它逐个构件清掉重问', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    viewer.scene.objects[EQUI] = {};
    viewer.__dtxLayer.hasObject = vi.fn(() => true);
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: EQUI, refnos: ['24384_24777', '24384_24776'] });

    expect(await gen.showModelByRefno(EQUI, { refresh: true, flyTo: false })).toBe(true);

    // 只按缓存取了一次（不带 forceRefresh）：这些构件的记录是范围查询刚查的那一份
    expect(v1Source.records.instanceEntriesByRefnos).toHaveBeenCalledTimes(1);
    expect(v1Source.records.instanceEntriesByRefnos).toHaveBeenCalledWith(8000, ['24384_24777', '24384_24776']);
    const options = loadInstancesMock.mock.calls[0]![3] as { instanceEntriesByRefno?: Map<string, unknown[]>; forceReloadRefnos?: string[] };
    expect([...options.instanceEntriesByRefno!.keys()]).toEqual(['24384_24777', '24384_24776']);
    // 旧对象照样整套换掉、网格照样重新取
    expect(options.forceReloadRefnos).toEqual(['24384_24777', '24384_24776']);
  });

  it('重载叶子构件：并进来的属主 BRAN 不在刚查的那一批里，它的记录清掉重问', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    const elbow = '24384_30001';
    const bran = '24384_30000';
    typeInfoMock.mockResolvedValue({ success: true, refno: elbow, noun: 'ELBO', owner_refno: bran, owner_noun: 'BRAN' });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: elbow, refnos: [elbow] });

    expect(await gen.showModelByRefno(elbow, { refresh: true, flyTo: false })).toBe(true);

    expect(v1Source.records.instanceEntriesByRefnos.mock.calls).toEqual([
      [8000, [elbow]],
      [8000, [bran], { forceRefresh: true }],
    ]);
    const options = loadInstancesMock.mock.calls[0]![3] as { instanceEntriesByRefno?: Map<string, unknown[]> };
    expect([...options.instanceEntriesByRefno!.keys()].sort()).toEqual([bran, elbow]);
  });

  it('K07 普通显示不碰记录缓存、不撤任何东西', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: EQUI, refnos: ['24384_24777'] });
    expect(await gen.showModelByRefno(EQUI)).toBe(true);
    expect(v1Source.records.invalidateRoot).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
    expect(loadInstancesMock.mock.calls[0]![3]).toMatchObject({ replaceExistingObjects: false });
    // 普通显示不自己取实例：装载器照旧向记录源要（缓存里有就不发请求）
    expect(v1Source.records.instanceEntriesByRefnos).not.toHaveBeenCalled();
    expect(loadInstancesMock.mock.calls[0]![3]).not.toHaveProperty('instanceEntriesByRefno');
  });

  it('K08 记录查空且收齐、后端也确认它名下没有几何了（这根被删、或名下带几何的成员删光）：不生成，撤下根与名下旧构件，不再算已加载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    const root = '24384_24778';
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: root, refnos: ['24384_24779', '24384_24780'] });
    expect(await gen.showModelByRefno(root)).toBe(true);
    expect(gen.isModelActuallyLoaded(root)).toBe(true);
    loadInstancesMock.mockClear();
    // 单元都生成过、它名下没有几何：成员删光了（根被删时后端回的是 REFNO_NOT_FOUND，见「重载查空的护栏」那一组）
    nodeFactsMock.mockResolvedValue({ verdict: 'latest' });

    v1Source.records.invalidateRoot.mockReturnValueOnce([root, '24384_24779', '24384_24780']);
    unitRefnosMock.mockReturnValueOnce(['24384_24779', '24384_24781']);
    evictMock.mockImplementationOnce((_layer, _dbno, refnos) => [...refnos]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: root, refnos: [] });

    expect(await gen.showModelByRefno(root, { refresh: true })).toBe(true);

    const targets = [root, '24384_24779', '24384_24780', '24384_24781'];
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(unitRefnosMock).toHaveBeenCalledWith(8000, root);
    // 撤下的对象真的从图层里拿掉（release），不只是隐藏
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, targets, { release: true });
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(targets, false);
    expect(gen.isModelActuallyLoaded(root)).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('已没有几何'),
    }));
  });

  it('K08 记录查空但没收齐（409 在生成）：场景保持原样、不生成、不撤', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    visibleInstsMock.mockResolvedValueOnce({
      success: true, refno: EQUI, refnos: [], incomplete: { pending: [EQUI], truncated_roots: [], errors: {} },
    });

    expect(await gen.showModelByRefno(EQUI, { refresh: true })).toBe(false);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
    expect(gen.statusMessage.value).toContain('场景保持原样');
  });

  it('K08 记录查询失败：退到子树查询即使也是空，也不当作删除；两边都失败同样不生成', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    visibleInstsMock.mockRejectedValueOnce(new Error('records 超时'));
    v1Source.tree.subtreeRefnos.mockResolvedValueOnce({ success: true, refnos: [], truncated: false });
    expect(await gen.showModelByRefno(EQUI, { refresh: true })).toBe(false);

    visibleInstsMock.mockRejectedValueOnce(new Error('records 超时'));
    v1Source.tree.subtreeRefnos.mockRejectedValueOnce(new Error('subtree 超时'));
    expect(await gen.showModelByRefno(EQUI, { refresh: true })).toBe(false);

    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
  });

  it('K09 重载后最新记录里没有的成员（数据批次删掉的）从场景撤下，根自己不撤', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    const root = '24384_24778';
    v1Source.records.invalidateRoot.mockReturnValueOnce([root, '24384_24779', '24384_24780']);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: root, refnos: ['24384_24779'] });

    expect(await gen.showModelByRefno(root, { refresh: true })).toBe(true);

    expect(evictMock).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, ['24384_24780'], { release: true });
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['24384_24780'], false);
  });

  it('重载容器节点（SITE / ZONE）：上一次装过、最新记录里已经没有的构件从场景撤下——记录缓存和场景索引的属主链都认不到容器，靠「这个节点上一次装了什么」来比', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    // 2026-11-11 真机：8000 的测试 SITE 下删掉一台设备（数据批次跑完）再重载，那台设备还留在屏幕上
    const site = '24384_26547';
    typeInfoMock.mockResolvedValue({ success: true, refno: site, noun: 'SITE', owner_refno: null, owner_noun: null });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: site, refnos: ['24384_26549', '24384_26716'] });
    expect(await gen.showModelByRefno(site)).toBe(true);
    expect(evictMock).not.toHaveBeenCalled();

    // 记录缓存按生成根归档、场景索引的属主链只到生成根：两边对「SITE 下面有谁」都答空
    v1Source.records.invalidateRoot.mockReturnValue([site]);
    unitRefnosMock.mockReturnValue([]);
    evictMock.mockImplementation((_layer, _dbno, refnos) => [...refnos]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: site, refnos: ['24384_26549'] });
    expect(await gen.showModelByRefno(site, { refresh: true, flyTo: false })).toBe(true);

    expect(evictMock).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, ['24384_26716'], { release: true });
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['24384_26716'], false);
    expect(gen.isModelActuallyLoaded(site)).toBe(true);

    // 再重载一次（记录没变）：没有要撤的了
    evictMock.mockClear();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: site, refnos: ['24384_26549'] });
    expect(await gen.showModelByRefno(site, { refresh: true, flyTo: false })).toBe(true);
    expect(evictMock).not.toHaveBeenCalled();
  });

  it('节点在一份 useModelGeneration 里装、在另一份里重载（模型树装的，更新提示从查看器那一份重载）：照样撤下被删的构件', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const tree = useModelGeneration({ viewer, db_num: 8000 });
    const viewerSide = useModelGeneration({ viewer, db_num: 8000 });
    const zone = '24384_26548';
    typeInfoMock.mockResolvedValue({ success: true, refno: zone, noun: 'ZONE', owner_refno: null, owner_noun: null });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: zone, refnos: ['24384_26549', '24384_26716'] });
    expect(await tree.showModelByRefno(zone)).toBe(true);

    v1Source.records.invalidateRoot.mockReturnValue([zone]);
    evictMock.mockImplementation((_layer, _dbno, refnos) => [...refnos]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: zone, refnos: ['24384_26549'] });
    expect(await viewerSide.showModelByRefno(zone, { refresh: true, flyTo: false })).toBe(true);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, ['24384_26716'], { release: true });
  });

  it('K09 收集没收齐时不对差集下结论，一个成员也不撤', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    const root = '24384_24778';
    v1Source.records.invalidateRoot.mockReturnValueOnce([root, '24384_24779', '24384_24780']);
    visibleInstsMock.mockResolvedValueOnce({
      success: true, refno: root, refnos: ['24384_24779'], incomplete: { pending: ['24384_24790'], truncated_roots: [], errors: {} },
    });

    await gen.showModelByRefno(root, { refresh: true });

    expect(loadInstancesMock).toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
  });

  it('K09 记录缓存被清空时仍能算出被删成员：基线并上场景索引', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    const root = '24384_24778';
    // 上一次重载没收齐、或服务换代清了缓存：invalidateRoot 这次返回空
    v1Source.records.invalidateRoot.mockReturnValueOnce([]);
    // 场景索引是独立事实：还挂着两个成员
    unitRefnosMock.mockReturnValueOnce(['24384_24779', '24384_24780']);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: root, refnos: ['24384_24779'] });

    expect(await gen.showModelByRefno(root, { refresh: true })).toBe(true);

    expect(unitRefnosMock).toHaveBeenCalledWith(8000, root);
    // 只撤最新记录里已经没有的那个
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, ['24384_24780'], { release: true });
  });

  it('K08 退到子树查询（visible-insts 没查通）：重载不下结论，不替换也不撤', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    v1Source.records.invalidateRoot.mockReturnValueOnce([EQUI, '24384_24777']);
    visibleInstsMock.mockRejectedValueOnce(new Error('records 500'));
    // 子树查询成功返回了一串 refno：过去会被当成收齐的最新记录去 replace 并撤差集
    v1Source.tree.subtreeRefnos.mockResolvedValueOnce({ success: true, refnos: [EQUI, '24384_24777'], truncated: false });

    expect(await gen.showModelByRefno(EQUI, { refresh: true })).toBe(false);

    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
    expect(gen.statusMessage.value).toContain('场景保持原样');
  });

  it('K08 查询抛出的 Error 没有 message 时也不能 fail-open', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    v1Source.records.invalidateRoot.mockReturnValueOnce([EQUI, '24384_24777']);
    visibleInstsMock.mockRejectedValueOnce(new Error(''));
    v1Source.tree.subtreeRefnos.mockRejectedValueOnce(new Error(''));

    expect(await gen.showModelByRefno(EQUI, { refresh: true })).toBe(false);

    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
  });
});

describe('重载不是「显示」：藏着的构件换完还藏着，新增的构件跟节点走（取最新 / 行上的「重载」，2026-11-17）', () => {
  const ROOT = '24384_24778';
  const M1 = '24384_24779';
  const M2 = '24384_24780';
  const M3 = '24384_24781';
  const NEW = '24384_24790';
  const RELOAD = { refresh: true, flyTo: false, quiet: true };

  /** 状态表真的会被写的查看器：`setObjectsVisible` 照场景的口径改 `objects[refno].visible`（别的用例里它只是个记调用的桩） */
  function statefulViewer() {
    const viewer = makeViewer();
    viewer.scene.setObjectsVisible.mockImplementation((ids: string[], visible: boolean) => {
      for (const id of ids) viewer.scene.objects[id] = { ...viewer.scene.objects[id], visible };
    });
    return viewer;
  }

  /** 这些构件算「装在场景里」（装载器的运行时索引）；回的集合改了就跟着变 */
  function inScene(...refnos: string[]): Set<string> {
    const loaded = new Set(refnos);
    isDtxRefnoLoadedMock.mockImplementation((_dbno, refno) => loaded.has(refno));
    return loaded;
  }

  beforeEach(() => {
    visibleInstsMock.mockReset();
    v1Source.tree.subtreeRefnos.mockReset();
    v1Source.records.invalidateRoot.mockReset();
    v1Source.records.invalidateRoot.mockReturnValue([]);
    unitRefnosMock.mockReset();
    unitRefnosMock.mockReturnValue([]);
    typeInfoMock.mockResolvedValue({ success: true, refno: ROOT, noun: 'EQUI', owner_refno: null, owner_noun: null });
  });

  it('节点里单独藏起来的成员：照样换成最新的，但不拉回可见；别的成员照旧置为可见', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = statefulViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    viewer.scene.objects[M1] = { visible: true };
    viewer.scene.objects[M2] = { visible: false };
    inScene(M1, M2);
    v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, M2]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, M2] });

    expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

    expect(loadInstancesMock).toHaveBeenCalledWith(
      expect.anything(), 8000, [M1, M2], expect.objectContaining({ replaceExistingObjects: true }),
    );
    // 藏着的那个没有被拉回可见：换上去的新对象由装完的回放（applyStateToRefnos）照状态表藏回去
    expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1], true]]);
    expect(viewer.scene.objects[M2]).toEqual({ visible: false });
    expect(viewer.__dtxAfterInstancesLoaded).toHaveBeenCalledWith(8000, [M1, M2], { autoFit: false });
  });

  it('整个节点藏着（树上点了节点的眼睛）：重载后一个也不拉回可见，这一次新增的成员跟着藏', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = statefulViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    // 树上隐藏节点：节点自己和名下带几何的构件都记成不可见
    for (const refno of [ROOT, M1, M2]) viewer.scene.objects[refno] = { visible: false };
    inScene(M1, M2);
    v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, M2]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, M2, NEW] });

    expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

    expect(loadInstancesMock).toHaveBeenCalledWith(
      expect.anything(), 8000, [M1, M2, NEW], expect.objectContaining({ replaceExistingObjects: true }),
    );
    // 没有任何「置为可见」；新增的那个预先记成不可见，装完由回放藏起来
    expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[NEW], false]]);
  });

  it('成员是一个个藏起来的（节点自己的眼睛没点过）、全都藏着：新增的成员同样跟着藏', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = statefulViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    for (const refno of [M1, M2]) viewer.scene.objects[refno] = { visible: false };
    inScene(M1, M2);
    v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, M2]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, M2, NEW] });

    expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

    expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, NEW], false]]);
  });

  it('节点里只有个别成员藏着（树上没有藏着的子节点可问）：新增的成员照常显示，藏着的那个还藏着', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = statefulViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    viewer.scene.objects[M1] = { visible: true };
    viewer.scene.objects[M2] = { visible: false };
    inScene(M1, M2);
    v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, M2]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, M2, NEW] });

    expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

    expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1, NEW], true]]);
    expect(viewer.scene.objects[M2]).toEqual({ visible: false });
  });

  it('树上已经按父节点的勾选态记成不可见的新构件（那一层在树里取进来过）：还没装进场景也不拉回可见', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = statefulViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    viewer.scene.objects[M1] = { visible: true };
    // 取最新先刷树：新行挂在一个藏着的子节点下面，树按父节点的勾选态先记进状态表
    viewer.scene.objects[NEW] = { visible: false };
    inScene(M1);
    v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, NEW] });

    expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

    expect(loadInstancesMock).toHaveBeenCalledWith(
      expect.anything(), 8000, [M1, NEW], expect.objectContaining({ replaceExistingObjects: true }),
    );
    expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1], true]]);
    expect(viewer.scene.objects[NEW]).toEqual({ visible: false });
  });

  describe('节点只藏了一部分、这一次又带来新构件：先问模型树「藏着的那部分名下现在有哪些构件」（`treeHiddenScope`）', () => {
    /** 树上藏着的子节点（它自己没有几何，只出现在树的回答里） */
    const HIDDEN_NODE = '24384_24785';
    const NEW2 = '24384_24791';
    let offProvider: (() => void) | null = null;

    /** 模型树这一头：给一份现成的回答，或给一个自己决定怎么答的函数（抛错、一直不答） */
    function treeAnswers(answer: TreeHiddenScope | null | (() => Promise<TreeHiddenScope | null>)) {
      offProvider?.();
      const provider = vi.fn((_root: string, _signal?: AbortSignal): Promise<TreeHiddenScope | null> => (
        typeof answer === 'function' ? answer() : Promise.resolve(answer)
      ));
      offProvider = provideTreeHiddenScope(provider);
      return provider;
    }

    /** 控制台里「藏着的节点没查到」的那条说明 */
    function scopeWarnings(): string[] {
      return addLogMock.mock.calls
        .filter((call) => call[0] === 'warning' && String(call[1]).includes('树上藏着的节点'))
        .map((call) => String(call[1]));
    }

    afterEach(() => {
      offProvider?.();
      offProvider = null;
    });

    it('新构件落在藏着的子节点下面（那一层没在树里取进来过，状态表里没有它）：预先记成不可见；别的新构件照常显示', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = statefulViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      viewer.scene.objects[M1] = { visible: true };
      // M2 在藏着的子节点下面：人在树上点了那个子节点的眼睛
      viewer.scene.objects[M2] = { visible: false };
      inScene(M1, M2);
      v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, M2]);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, M2, NEW, NEW2] });
      const provider = treeAnswers({ refnos: new Set([HIDDEN_NODE, M2, NEW]), failed: [] });

      expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

      expect(provider).toHaveBeenCalledTimes(1);
      expect(provider.mock.calls[0]![0]).toBe(ROOT);
      expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1, NEW2], true], [[NEW], false]]);
      // 显隐在装载之前就定好：新对象装上去之后，由装完的回放（applyStateToRefnos）照状态表藏起来
      expect(Math.max(...viewer.scene.setObjectsVisible.mock.invocationCallOrder))
        .toBeLessThan(loadInstancesMock.mock.invocationCallOrder[0]!);
      expect(loadInstancesMock).toHaveBeenCalledWith(
        expect.anything(), 8000, [M1, M2, NEW, NEW2], expect.objectContaining({ replaceExistingObjects: true }),
      );
      expect(viewer.scene.objects[NEW]).toEqual({ visible: false });
      expect(viewer.scene.objects[NEW2]).toEqual({ visible: true });
      expect(viewer.scene.objects[M2]).toEqual({ visible: false });
      expect(scopeWarnings()).toEqual([]);
    });

    it('场景里一个藏着的都没有、藏着的子节点这一次才第一次有构件：新构件照样跟着藏', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = statefulViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      viewer.scene.objects[M1] = { visible: true };
      inScene(M1);
      v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1]);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, NEW] });
      treeAnswers({ refnos: new Set([HIDDEN_NODE, NEW]), failed: [] });

      expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

      expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1], true], [[NEW], false]]);
      expect(viewer.scene.objects[NEW]).toEqual({ visible: false });
    });

    it('这一次没有新构件：不问树（不多发请求），照原来的规则走', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = statefulViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      viewer.scene.objects[M1] = { visible: true };
      viewer.scene.objects[M2] = { visible: false };
      inScene(M1, M2);
      v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, M2]);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, M2] });
      const provider = treeAnswers({ refnos: new Set([HIDDEN_NODE, M2]), failed: [] });

      expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

      expect(provider).not.toHaveBeenCalled();
      expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1], true]]);
      expect(viewer.scene.objects[M2]).toEqual({ visible: false });
    });

    it('树说藏着、场景里却显示着的构件（人单独把它点出来过）：不动它，只藏新增的', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = statefulViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      viewer.scene.objects[M1] = { visible: true };
      inScene(M1);
      v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1]);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, NEW] });
      treeAnswers({ refnos: new Set([HIDDEN_NODE, M1, NEW]), failed: [] });

      expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

      expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1], true], [[NEW], false]]);
      expect(viewer.scene.objects[M1]).toEqual({ visible: true });
    });

    it('树答不上来（查询抛错）：重载照常做完，新构件照原来的规则显示出来', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { useModelGeneration } = await import('./useModelGeneration');
        const viewer = statefulViewer();
        const gen = useModelGeneration({ viewer, db_num: 8000 });
        viewer.scene.objects[M1] = { visible: true };
        viewer.scene.objects[M2] = { visible: false };
        inScene(M1, M2);
        v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, M2]);
        visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, M2, NEW] });
        const provider = treeAnswers(() => Promise.reject(new Error('tree offline')));

        expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

        expect(provider).toHaveBeenCalledTimes(1);
        expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1, NEW], true]]);
        expect(viewer.scene.objects[M2]).toEqual({ visible: false });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('[tree-hidden-scope]'), expect.any(Error));
      } finally {
        warn.mockRestore();
      }
    });

    it('藏着的节点里有没查到的（请求失败）：查到的那部分照样藏，定不了的照常显示，控制台留一条说明', async () => {
      const FAILED_NODE = '24384_24786';
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = statefulViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      viewer.scene.objects[M1] = { visible: true };
      inScene(M1);
      v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1]);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, NEW, NEW2] });
      treeAnswers({ refnos: new Set([HIDDEN_NODE, NEW]), failed: [FAILED_NODE] });

      expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

      // NEW2 也许就在没查到的那个节点下面：定不了，照常显示
      expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1, NEW2], true], [[NEW], false]]);
      expect(scopeWarnings()).toEqual([
        expect.stringContaining(`重载 ${ROOT}：树上藏着的节点有 1 个没查到名下的构件（${FAILED_NODE}）`),
      ]);
    });

    it('藏着的节点一个都没查到：新构件照原来的规则显示出来，控制台留一条说明', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = statefulViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      viewer.scene.objects[M1] = { visible: true };
      inScene(M1);
      v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1]);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, NEW] });
      treeAnswers({ refnos: new Set<string>(), failed: [HIDDEN_NODE] });

      expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

      expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1, NEW], true]]);
      expect(scopeWarnings()).toHaveLength(1);
    });

    it('问树的时候被叫停：不等树答完，当场收手，一个显隐动作都没有', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = statefulViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      viewer.scene.objects[M1] = { visible: true };
      viewer.scene.objects[M2] = { visible: false };
      inScene(M1, M2);
      v1Source.records.invalidateRoot.mockReturnValue([ROOT, M1, M2]);
      visibleInstsMock.mockResolvedValue({ success: true, refno: ROOT, refnos: [M1, M2, NEW] });
      // 树一直不答
      let noteAsked!: () => void;
      const treeAsked = new Promise<void>((resolve) => { noteAsked = resolve; });
      const provider = treeAnswers(() => {
        noteAsked();
        return new Promise<TreeHiddenScope | null>(() => {});
      });

      const pending = gen.showModelByRefno(ROOT, { refresh: true, flyTo: false });
      expect(await Promise.race([treeAsked.then(() => '问到树了'), pending.then(() => '没问树就结束了')])).toBe('问到树了');
      expect(requestStopModelLoad(ROOT)).toBe(true);

      const outcome = await Promise.race([
        pending,
        new Promise<string>((resolve) => { setTimeout(() => resolve('还在等树'), 300); }),
      ]);
      expect(outcome).toBe(false);
      expect(provider.mock.calls[0]![1]?.aborted).toBe(true);
      expect(viewer.scene.setObjectsVisible).not.toHaveBeenCalled();
      expect(loadInstancesMock).not.toHaveBeenCalled();
      expect(evictMock).not.toHaveBeenCalled();
      expect(viewer.scene.objects[M2]).toEqual({ visible: false });
      expect(consumeModelLoadStopped(ROOT)).toBe(true);
    });

    it('右键重新生成不问树：做完是要把节点显示出来的', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = statefulViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      viewer.scene.objects[M1] = { visible: true };
      inScene(M1);
      v1Source.records.generateThenCollect.mockImplementationOnce(async (refno: string) => (
        { refno, generationRoots: [refno], items: [{ refno }], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {} } as never
      ));
      visibleInstsMock.mockResolvedValue({ success: true, refno: ROOT, refnos: [M1, NEW] });
      const provider = treeAnswers({ refnos: new Set([HIDDEN_NODE, NEW]), failed: [] });

      expect(await gen.showModelByRefno(ROOT, { regenerate: true, flyTo: false })).toBe(true);

      expect(provider).not.toHaveBeenCalled();
      expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith([ROOT, M1, NEW], true);
      expect(viewer.scene.objects[NEW]).toEqual({ visible: true });
    });

    it('预先记的不可见是装载流程记的、不是人藏的：构件没装上（被叫停），那个子节点后来又显示了，下一次重载照常显示它', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = statefulViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      viewer.scene.objects[M1] = { visible: true };
      viewer.scene.objects[M2] = { visible: false };
      inScene(M1, M2);
      v1Source.records.invalidateRoot.mockReturnValue([ROOT, M1, M2]);
      visibleInstsMock.mockResolvedValue({ success: true, refno: ROOT, refnos: [M1, M2, NEW] });
      treeAnswers({ refnos: new Set([HIDDEN_NODE, M2, NEW]), failed: [] });
      // 第一次：新构件预先记成不可见，随后装载被叫停，新构件没有装进场景
      loadInstancesMock.mockImplementationOnce(async () => {
        requestStopModelLoad(ROOT);
        return loaderCancelled();
      });
      expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);
      consumeModelLoadStopped(ROOT);
      expect(viewer.scene.objects[NEW]).toEqual({ visible: false });

      // 人在树上把那个子节点重新显示出来：树照它手上的名单改场景（名单里还没有新构件），树上不再有藏着的节点
      viewer.scene.objects[M2] = { visible: true };
      treeAnswers(null);
      viewer.scene.setObjectsVisible.mockClear();

      expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);

      expect(viewer.scene.setObjectsVisible.mock.calls).toEqual([[[ROOT, M1, M2, NEW], true]]);
      expect(viewer.scene.objects[NEW]).toEqual({ visible: true });
    });
  });

  it('数据批次删掉、后来又回来的成员：撤下时顺手记的不可见不算人藏的，重载后照常显示（人藏的那个还藏着）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = statefulViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    const loaded = inScene(M1, M2, M3);
    for (const refno of [M2, M3]) viewer.scene.objects[refno] = { visible: true };
    viewer.scene.objects[M1] = { visible: false };
    evictMock.mockImplementation((_layer, _dbno, refnos) => {
      for (const refno of refnos) loaded.delete(refno);
      return [...refnos];
    });

    // 这一批里 M2 被删了：重载把它从场景撤下，状态表里顺手记成不可见
    v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, M2, M3]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, M3] });
    expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [M2], { release: true });
    expect(viewer.scene.objects[M2]).toEqual({ visible: false });

    // 下一批里 M2 又有了：重载把它装回来，照常显示
    v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, M3]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1, M2, M3] });
    expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);
    expect(viewer.scene.objects[M2]).toEqual({ visible: true });
    expect(viewer.scene.objects[M1]).toEqual({ visible: false });
  });

  it('构件从一个节点挪到另一个节点、两个节点先后各自重载：前一个撤下它时记的不可见，不带到后一个节点上', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = statefulViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    const OTHER = '24384_24800';
    const OTHER_MEMBER = '24384_24801';
    const MOVED = M2;
    const loaded = inScene(M1, MOVED, OTHER_MEMBER);
    for (const refno of [M1, MOVED, OTHER_MEMBER]) viewer.scene.objects[refno] = { visible: true };
    evictMock.mockImplementation((_layer, _dbno, refnos) => {
      for (const refno of refnos) loaded.delete(refno);
      return [...refnos];
    });

    // 原来的节点重载：构件已经不在它名下，撤下
    v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, M1, MOVED]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [M1] });
    expect(await gen.showModelByRefno(ROOT, RELOAD)).toBe(true);
    expect(viewer.scene.objects[MOVED]).toEqual({ visible: false });

    // 另一个节点重载：构件到了它名下，装上并显示
    typeInfoMock.mockResolvedValue({ success: true, refno: OTHER, noun: 'EQUI', owner_refno: null, owner_noun: null });
    v1Source.records.invalidateRoot.mockReturnValueOnce([OTHER, OTHER_MEMBER]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: OTHER, refnos: [OTHER_MEMBER, MOVED] });
    expect(await gen.showModelByRefno(OTHER, RELOAD)).toBe(true);
    expect(viewer.scene.objects[MOVED]).toEqual({ visible: true });
  });

  it('右键重新生成做完是要显示出来的：藏着的成员照旧拉回可见', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = statefulViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    viewer.scene.objects[M1] = { visible: false };
    inScene(M1);
    v1Source.records.generateThenCollect.mockImplementationOnce(async (refno: string) => (
      { refno, generationRoots: [refno], items: [{ refno }], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {} } as never
    ));
    visibleInstsMock.mockResolvedValue({ success: true, refno: ROOT, refnos: [M1] });

    expect(await gen.showModelByRefno(ROOT, { regenerate: true, flyTo: false })).toBe(true);

    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith([ROOT, M1], true);
    expect(viewer.scene.objects[M1]).toEqual({ visible: true });
  });

  it('重载被叫停（还没开始换）：藏着的原样藏着，没有多出来的显隐动作', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = statefulViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    viewer.scene.objects[M1] = { visible: true };
    viewer.scene.objects[M2] = { visible: false };
    inScene(M1, M2);
    v1Source.records.invalidateRoot.mockReturnValue([ROOT, M1, M2]);
    visibleInstsMock.mockResolvedValue({ success: true, refno: ROOT, refnos: [M1, M2] });
    loadInstancesMock.mockImplementationOnce(async () => {
      requestStopModelLoad(ROOT);
      return loaderCancelled();
    });

    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);

    expect(viewer.scene.objects[M1]).toEqual({ visible: true });
    expect(viewer.scene.objects[M2]).toEqual({ visible: false });
    // 这一次没有把谁从隐藏改成显示，停下来也就没有要藏回去的
    expect(viewer.scene.setObjectsVisible.mock.calls.filter((call: unknown[]) => call[1] === false)).toHaveLength(0);
    expect(evictMock).not.toHaveBeenCalled();
    consumeModelLoadStopped(ROOT);
  });
});

describe('showModelByRefno 模型资产补齐：预检、确认、分块生成（方案 2026-11-10 B3）', () => {
  /** 7997 的 SITE 24381_535（2026-11-11 实查）：ZONE 179300、571 有模型；536、621 没有；179753 没有子节点 */
  const SITE = '24381_535';
  const EXISTING = ['24381_179302', '24381_573', '24381_574'];
  const child = (refno: string, noun: string, children_count: number, name = refno) => ({ refno, noun, name, children_count });
  const TREE: Record<string, ReturnType<typeof child>[]> = {
    [SITE]: [
      child('24381_179753', 'ZONE', 0, 'ZONE'),
      child('24381_179300', 'ZONE', 1, '/6ZBR-ITUB-NH'),
      child('24381_536', 'ZONE', 4, '/1RCV-SUPP-XX'),
      child('24381_571', 'ZONE', 1, '/1RCV-ITUB-XX'),
      child('24381_621', 'ZONE', 2, '/1RCV-RACK-XX'),
    ],
    '24381_536': [child('24381_537', 'STRU', 3), child('24381_549', 'REST', 1), child('24381_553', 'STRU', 3), child('24381_567', 'REST', 1)],
    '24381_621': [child('24381_622', 'REST', 4), child('24381_631', 'STRU', 3)],
    '24381_571': [child('24381_572', 'PIPE', 5)],
  };
  const NEW_536 = ['24381_538', '24381_550'];
  const NEW_621 = ['24381_623'];

  function useTree(tree: Record<string, ReturnType<typeof child>[]> = TREE) {
    treeChildrenMock.mockImplementation(async (refno: string) => {
      const children = tree[refno];
      if (!children) throw new Error(`no children for ${refno}`);
      return { success: true, parent_refno: refno, children, truncated: false };
    });
  }

  /** 生成成功：这一块名下出来这些构件 */
  function generated(refno: string, refnos: string[], extra: Record<string, unknown> = {}) {
    return {
      refno, generationRoots: refnos.map((item) => `${item}0`), items: refnos.map((item) => ({ refno: item })),
      pending: [] as string[], empty: [], truncatedRoots: [], errors: {}, statuses: {} as Record<string, string>, ...extra,
    };
  }
  const timedOut = (refno: string) => ({
    refno, generationRoots: [], items: [], pending: [refno], empty: [], truncatedRoots: [], errors: {}, statuses: { [refno]: 'timeout' },
  });

  /** SITE 已有一部分模型，三个 ZONE 没有记录 */
  function partialSite() {
    visibleInstsMock.mockResolvedValue({
      success: true, refno: SITE, refnos: EXISTING, empty_scopes: ['24381_179753', '24381_536', '24381_621'],
    });
  }

  beforeEach(() => {
    typeInfoMock.mockResolvedValue({ success: true, refno: SITE, noun: 'SITE' });
    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
    useTree();
    generationResumeTiming.delaysMs = [0];
    generationResumeTiming.budgetMs = 60_000;
  });

  it('未生成的小 ZONE（5 个单元）：不弹确认，直接生成并显示', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_571', noun: 'ZONE' });
    visibleInstsMock
      .mockResolvedValueOnce({ success: true, refno: '24381_571', refnos: [], empty_scopes: ['24381_571'] })
      .mockResolvedValue({ success: true, refno: '24381_571', refnos: ['24381_573', '24381_574'] });
    v1Source.records.generateThenCollect.mockResolvedValueOnce(generated('24381_571', ['24381_573', '24381_574']) as never);

    expect(await gen.showModelByRefno('24381_571')).toBe(true);
    expect(openChoiceMock).not.toHaveBeenCalled();
    expect(treeChildrenMock).toHaveBeenCalledWith('24381_571');
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith('24381_571', FILL_REQUEST);
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
    expect(gen.isModelActuallyLoaded('24381_571')).toBe(true);
  });

  it('查空的 ZONE 超过 20 个单元：先确认，写明约多少个单元；选「生成并显示」才生成', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_700', noun: 'ZONE' });
    useTree({ '24381_700': [child('24381_701', 'PIPE', 18), child('24381_720', 'PIPE', 9)] });
    visibleInstsMock
      .mockResolvedValueOnce({ success: true, refno: '24381_700', refnos: [], empty_scopes: ['24381_700'] })
      .mockResolvedValue({ success: true, refno: '24381_700', refnos: ['24381_702'] });
    v1Source.records.generateThenCollect.mockResolvedValueOnce(generated('24381_700', ['24381_702']) as never);
    let generatedBeforeAnswer = -1;
    openChoiceMock.mockImplementation(async () => {
      generatedBeforeAnswer = v1Source.records.generateThenCollect.mock.calls.length;
      return 'generate';
    });

    expect(await gen.showModelByRefno('24381_700')).toBe(true);
    expect(generatedBeforeAnswer).toBe(0);
    expect(openChoiceMock).toHaveBeenCalledTimes(1);
    expect(openChoiceMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '生成模型',
      message: expect.stringContaining('这个节点还没有模型，要生成约 27 个单元'),
      choices: [{ id: 'generate', text: '生成并显示' }],
      cancelText: '取消',
    }));
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
  });

  it('确认框里点了取消：不生成、不装载，提示里说明；行上留一个「生成」；再点眼睛会再问', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    typeInfoMock.mockResolvedValue({ success: true, refno: '24381_700', noun: 'ZONE' });
    useTree({ '24381_700': [child('24381_701', 'PIPE', 30)] });
    visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_700', refnos: [], empty_scopes: ['24381_700'] });
    openChoiceMock.mockResolvedValue(null);

    expect(await gen.showModelByRefno('24381_700')).toBe(false);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('还没有模型（约 30 个单元要生成），已取消'),
    }));
    expect(pendingGenerationFill('24381_700')).toMatchObject({ dbnum: 7997, chunks: 1, units: 30, reason: 'declined' });

    expect(await gen.showModelByRefno('24381_700')).toBe(false);
    expect(openChoiceMock).toHaveBeenCalledTimes(2);
  });

  it('SITE 有一部分模型、有两个 ZONE 没有（模型按需生成的库）：先显示已有的，再一块一块生成，做完一块显示一块', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    partialSite();
    const order: string[] = [];
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
      order.push(`load ${refnos.join(',')}`);
      return loaderResult(refnos.length, refnos.length * 2);
    });
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => {
      order.push(`generate ${refno}`);
      return generated(refno, refno === '24381_536' ? NEW_536 : NEW_621) as never;
    });

    expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);

    expect(order).toEqual([
      `load ${EXISTING.join(',')}`,
      'generate 24381_536', `load ${NEW_536.join(',')}`,
      'generate 24381_621', `load ${NEW_621.join(',')}`,
    ]);
    // 15 个单元（8 + 7），不到阈值：不问
    expect(openChoiceMock).not.toHaveBeenCalled();
    // 没有子节点的 ZONE 不发生成；每块都不带 force
    expect(v1Source.records.generateThenCollect.mock.calls).toEqual([['24381_536', FILL_REQUEST], ['24381_621', FILL_REQUEST]]);
    // 新生成的构件置为可见、不替换已有对象
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith([SITE, ...NEW_536], true);
    expect(loadInstancesMock.mock.calls[1]![3]).toMatchObject({ dataSource: 'gen-model-v1', replaceExistingObjects: false });
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'success', message: expect.stringContaining('已从 gen-model 加载 6 个几何实例') }));
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'success', message: `[成功] ${SITE}：已生成并显示 2 块（3 个构件）`,
    }));
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
    expect(pendingGenerationFill(SITE)).toBeNull();
    expect(gen.statusMessage.value).toBe('加载完成 (gen-model)');
  });

  it('进度写在状态栏：第几块、已生成几个单元；补齐期间不弹整屏遮罩（遮罩会挡住一块块出来的模型）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    partialSite();
    const seen: string[] = [];
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => {
      // 记录源在生成期间发的逐根进度：补齐时不理会
      for (const listener of progressListeners) listener({ refno, root: `${refno}_x`, done: 1, total: 3, stage: 'generate-start' });
      seen.push(`${gen.statusMessage.value} | ${gen.currentRefno.value} | modal=${gen.showProgressModal.value} | ${gen.currentIndex.value}/${gen.totalCount.value}`);
      return generated(refno, refno === '24381_536' ? NEW_536 : NEW_621, { generationRoots: Array.from({ length: refno === '24381_536' ? 8 : 7 }, (_, i) => `${refno}_${i}`) }) as never;
    });

    await gen.showModelByRefno(SITE, { flyTo: false });
    // 状态条一行会截断：第几块、已生成多少在前；块的名字在第二行
    expect(seen).toEqual([
      '正在生成第 1/2 块 · 已生成 0 / 约 15 个单元 | /1RCV-SUPP-XX · 24381_536 | modal=false | 1/2',
      '正在生成第 2/2 块 · 已生成 8 / 约 15 个单元 | /1RCV-RACK-XX · 24381_621 | modal=false | 2/2',
    ]);
  });

  it('SITE 没有模型的部分超过 20 个单元：已有的先显示出来再问；选「只显示已有的」不生成，行上留「生成」；点「生成」再问一次后补齐', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    useTree({
      ...TREE,
      '24381_536': [child('24381_537', 'STRU', 12), child('24381_549', 'REST', 3)],
      '24381_621': [child('24381_622', 'REST', 9), child('24381_631', 'STRU', 3)],
    });
    partialSite();
    let loadsBeforeAsking = -1;
    openChoiceMock.mockImplementationOnce(async () => {
      loadsBeforeAsking = loadInstancesMock.mock.calls.length;
      return null;
    });

    expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
    expect(loadsBeforeAsking).toBe(1);
    expect(openChoiceMock).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('还有约 27 个单元没有模型，分在 2 个 ZONE 里（已有的模型已经显示）'),
      choices: [{ id: 'generate', text: '生成并显示' }],
      cancelText: '只显示已有的',
    }));
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
    expect(pendingGenerationFill(SITE)).toMatchObject({ chunks: 2, units: 27, exact: false, reason: 'declined' });
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('只显示了已有的模型，还有约 27 个单元没有模型；行上点「生成」可以补齐'),
    }));

    // 已加载的节点再点眼睛只是恢复可见，不会再问
    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(openChoiceMock).toHaveBeenCalledTimes(1);

    // 行上的「生成」：显式补齐，不走「已在场景就跳过」的捷径；同样先确认
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => generated(refno, refno === '24381_536' ? NEW_536 : NEW_621) as never);
    expect(await gen.showModelByRefno(SITE, { flyTo: false, fill: true })).toBe(true);
    expect(openChoiceMock).toHaveBeenCalledTimes(2);
    expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual(['24381_536', '24381_621']);
    expect(pendingGenerationFill(SITE)).toBeNull();
  });

  it('过渡办法（服务端没有节点模型状态接口）：库里有成套模型时，SITE 下没有记录的 ZONE 不去生成——分不清是没生成还是本来没有几何', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_WITH_MODEL);
    partialSite();

    expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(openChoiceMock).not.toHaveBeenCalled();
    expect(treeChildrenMock).not.toHaveBeenCalled();
    expect(pendingGenerationFill(SITE)).toBeNull();
  });

  it('某一块先回 504 再成功：隔一会儿用同样的请求再问，不要人再点，最后装齐', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    partialSite();
    const waits: string[] = [];
    const { watch } = await import('vue');
    const stopWatching = watch(gen.statusMessage, (message) => { if (message.includes('自动再问')) waits.push(message); }, { flush: 'sync' });
    const answers: Record<string, unknown[]> = {
      '24381_536': [timedOut('24381_536'), timedOut('24381_536'), generated('24381_536', NEW_536)],
      '24381_621': [generated('24381_621', NEW_621)],
    };
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => answers[refno]!.shift() as never);

    expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
    stopWatching();
    expect(waits).toHaveLength(2);
    expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual(['24381_536', '24381_536', '24381_536', '24381_621']);
    expect(v1Source.records.generateThenCollect.mock.calls.every((call) => ((call as unknown[])[1] as { force: boolean }).force === false)).toBe(true);
    expect(waits[0]).toBe('第 1/2 块：后端还在后台生成，0 秒后自动再问（已问 1 次）· 已生成 0 / 约 15 个单元');
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([EXISTING, NEW_536, NEW_621]);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'success', message: expect.stringContaining('已生成并显示 2 块（3 个构件）') }));
    expect(pendingGenerationFill(SITE)).toBeNull();
  });

  it('等到预算用完后端还没做完：这一块留着，其余照常；行上留「生成」，点了接着问那一块', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    generationResumeTiming.budgetMs = -1;
    partialSite();
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => (
      refno === '24381_536' ? timedOut(refno) : generated(refno, NEW_621)
    ) as never);

    expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('已生成并显示 1 块（1 个构件）；1 块后端还没做完（/1RCV-SUPP-XX），稍后接着生成'),
    }));
    expect(pendingGenerationFill(SITE)).toMatchObject({ chunks: 1, units: 8, reason: 'pending' });

    v1Source.records.generateThenCollect.mockClear();
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => generated(refno, NEW_536) as never);
    // 上一次已经生成的 ZONE 这回有记录了，不在「没有记录的范围」里
    visibleInstsMock.mockResolvedValue({
      success: true, refno: SITE, refnos: [...EXISTING, ...NEW_621], empty_scopes: ['24381_179753', '24381_536'],
    });
    expect(await gen.showModelByRefno(SITE, { flyTo: false, fill: true })).toBe(true);
    expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual(['24381_536']);
    expect(pendingGenerationFill(SITE)).toBeNull();
  });

  it('一根失败：其余照常显示，失败的那根在结果里点名；这一块本页面里不再自动重发', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    partialSite();
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => (refno === '24381_536'
      ? generated(refno, ['24381_550'], { failedRoots: [{ root: '24381_537', error: 'generation_failed: 截面数据损坏', retryable: false }] })
      : generated(refno, NEW_621)) as never);

    expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([EXISTING, ['24381_550'], NEW_621]);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'warning',
      message: `[警告] ${SITE}：已生成并显示 2 块（2 个构件）；1 个生成根失败：24381_537（generation_failed: 截面数据损坏）`,
    }));
    expect(addLogMock).toHaveBeenCalledWith('warning', expect.stringContaining('补齐结束：已生成并显示 2 块（2 个构件）；1 个生成根失败：24381_537'));
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
    // 不可重试的失败不算「之后接着做」
    expect(pendingGenerationFill(SITE)).toBeNull();
  });

  it('SITE 一个模型都没有（每个 ZONE 都查空）：分块生成，第一块出来就飞一次，全部做完记为已加载并对整体再对一次焦', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock
      .mockResolvedValueOnce({ success: true, refno: SITE, refnos: [], empty_scopes: ['24381_179753', '24381_536', '24381_621', SITE] })
      .mockResolvedValue({ success: true, refno: SITE, refnos: [...NEW_536, ...NEW_621], empty_scopes: ['24381_179753'] });
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => generated(refno, refno === '24381_536' ? NEW_536 : NEW_621) as never);
    let flightsAfterFirstChunk = -1;
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
      if (refnos.join() === NEW_621.join()) flightsAfterFirstChunk = viewer.cameraFlight.flyTo.mock.calls.length;
      return loaderResult(refnos.length, refnos.length * 2);
    });

    expect(await gen.showModelByRefno(SITE, { flyTo: true })).toBe(true);
    // 节点自己不发生成：按 ZONE 分块
    expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual(['24381_536', '24381_621']);
    // 分块时已经装过的不再装第二遍
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([NEW_536, NEW_621]);
    expect(flightsAfterFirstChunk).toBe(1);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledTimes(2);
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
    expect(noteLoadedNodeMock).toHaveBeenCalledWith(SITE, 7997, expect.anything());
    expect(gen.lastLoadDebug.value?.result).toEqual({ loadedRefnos: 3, skippedRefnos: 0, loadedObjects: 6 });
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'success', message: `[成功] ${SITE}：已生成并显示 2 块（3 个构件）` }));
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'success', message: expect.stringContaining('已从 gen-model 加载 6 个几何实例') }));
  });

  it('生成到一半这个节点被隐藏了（人不要它了）：和叫停一样——不再发后面的块，这一次画出来的收回去；行上留「生成」', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    partialSite();
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => {
      // 第一块生成期间，人把这个节点隐藏了（refno 级可见态被改成 false）
      viewer.scene.objects[EXISTING[0]!] = { visible: false };
      return generated(refno, NEW_536) as never;
    });

    expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(false);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    // 这一次装进来的（已有的那部分 + 已经生成的第一块）从场景里拿掉
    expect(evictMock).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, [...EXISTING, ...NEW_536], { release: true });
    expect(gen.isModelActuallyLoaded(SITE)).toBe(false);
    expect(forgetLoadedNodeMock).toHaveBeenCalledWith(SITE);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('已停止加载') }));
    expect(pendingGenerationFill(SITE)).toMatchObject({ chunks: 1, units: 7, reason: 'stopped' });
    // 告诉发起显示的一方（模型树的眼睛）：这次显示被收回去了，别再把节点置回可见
    expect(consumeModelLoadStopped(SITE)).toBe(true);
  });

  it('点「生成」但已经没有可补的：说一声，撤掉行上的「生成」', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const { notePendingGenerationFill } = await import('@/composables/generationFillState');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    notePendingGenerationFill({ root: SITE, dbnum: 7997, chunks: 1, units: 8, exact: false, reason: 'pending' });
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: EXISTING, empty_scopes: ['24381_179753'] });

    expect(await gen.showModelByRefno(SITE, { flyTo: false, fill: true })).toBe(true);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: `[提示] ${SITE}：没有需要生成的部分` }));
    expect(pendingGenerationFill(SITE)).toBeNull();
  });

  it('重载 / 右键重新生成不走补齐', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    partialSite();
    v1Source.records.invalidateRoot.mockReturnValue([]);

    expect(await gen.showModelByRefno(SITE, { refresh: true })).toBe(true);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(treeChildrenMock).not.toHaveBeenCalled();
    expect(generationFactsMock).not.toHaveBeenCalled();
  });

  describe('后端的生成预检（接上节点模型状态接口，2026-11-11）：有多少要生成、要不要确认、阈值都用后端给的', () => {
    const facts = (unitsTotal: number, unitsToGenerate: number, extra: Partial<GenerationFacts> = {}): GenerationFacts => ({
      unitsTotal, unitsToGenerate, needsConfirm: unitsToGenerate > 20, thresholdUnits: 20, exact: true, ...extra,
    });
    /** 7997 的 SITE 24381_535（新后端实查）：五个 ZONE 是 0 / 3 / 7 / 5 / 6 个单元，合计 21，超过阈值 20 */
    const FACTS_535: Record<string, GenerationFacts> = {
      [SITE]: facts(21, 21),
      '24381_179753': facts(0, 0),
      '24381_179300': facts(3, 3),
      '24381_536': facts(7, 7),
      '24381_571': facts(5, 5),
      '24381_621': facts(6, 6),
    };
    const ZONES = ['24381_179753', '24381_179300', '24381_536', '24381_571', '24381_621'];
    function useFacts(table: Record<string, GenerationFacts>) {
      generationFactsMock.mockImplementation(async (refno: string) => {
        const found = table[refno];
        if (!found) throw new Error(`no facts for ${refno}`);
        return found;
      });
    }

    it('一个模型都没有的 SITE：确认框里是后端给的精确数（不写「约」）；没有生成单元的 ZONE 不发生成；不再沿树往下数', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      useFacts(FACTS_535);
      visibleInstsMock
        .mockResolvedValueOnce({ success: true, refno: SITE, refnos: [], empty_scopes: [...ZONES, SITE] })
        .mockResolvedValue({ success: true, refno: SITE, refnos: ['24381_a', '24381_b', '24381_c', '24381_d'], empty_scopes: ['24381_179753'] });
      v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => generated(refno, [`24381_${'abcd'[['24381_179300', '24381_536', '24381_571', '24381_621'].indexOf(refno)]}`]) as never);

      expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);

      expect(openChoiceMock).toHaveBeenCalledTimes(1);
      expect(openChoiceMock).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('这个节点还没有模型，要生成 21 个单元，分在 4 个 ZONE 里'),
        cancelText: '取消',
      }));
      expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual(['24381_179300', '24381_536', '24381_571', '24381_621']);
      // 只为块的名字问了一次树；没有逐个 ZONE 往下数
      expect(treeChildrenMock.mock.calls.map((call) => call[0])).toEqual([SITE]);
      expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
    });

    it('后端说不用确认（它的阈值更高）：30 个单元也直接生成', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      typeInfoMock.mockResolvedValue({ success: true, refno: '24381_700', noun: 'ZONE' });
      useFacts({ '24381_700': facts(30, 30, { needsConfirm: false, thresholdUnits: 50 }) });
      visibleInstsMock
        .mockResolvedValueOnce({ success: true, refno: '24381_700', refnos: [], empty_scopes: ['24381_700'] })
        .mockResolvedValue({ success: true, refno: '24381_700', refnos: ['24381_702'] });
      v1Source.records.generateThenCollect.mockResolvedValueOnce(generated('24381_700', ['24381_702']) as never);

      expect(await gen.showModelByRefno('24381_700')).toBe(true);
      expect(openChoiceMock).not.toHaveBeenCalled();
      expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
      expect(treeChildrenMock).not.toHaveBeenCalled();
    });

    it('没有生成单元的节点：不发生成，照实说「没有要生成的模型」；行上登记这个节点', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      typeInfoMock.mockResolvedValue({ success: true, refno: '24381_179753', noun: 'ZONE' });
      useFacts(FACTS_535);
      visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_179753', refnos: [], empty_scopes: ['24381_179753'] });

      expect(await gen.showModelByRefno('24381_179753')).toBe(false);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
      expect(openChoiceMock).not.toHaveBeenCalled();
      expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
        level: 'info', message: '[提示] 24381_179753：这个节点下没有要生成的模型（没有生成单元）',
      }));
      expect(noteNodeWithoutModelMock).toHaveBeenCalledWith('24381_179753', 7997);
    });

    it('单元都生成过、只是没有可显示的几何：不再发生成（重发只会把同样的生成再跑一遍），照实说', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      typeInfoMock.mockResolvedValue({ success: true, refno: '24381_101406', noun: 'ZONE' });
      useFacts({ '24381_101406': facts(2, 0) });
      visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_101406', refnos: [], empty_scopes: ['24381_101406'] });

      expect(await gen.showModelByRefno('24381_101406')).toBe(false);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
      expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
        message: '[提示] 24381_101406：这个节点下的 2 个单元都生成过了，没有可显示的几何',
      }));
    });

    it('库的三枚水位对齐、节点已有模型显示出来：显示不为预检多等一发（缺单元只可能是上次失败的，行上的状态会说）；人点「生成」时照问', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      dbnumRowsMock.mockReturnValue([
        { dbnum: 7997, db_type: 'DESI', initialized: true, file_latest_sesno: 447, applied_sesno: 447, model_sesno: 447, model_verdict: 'in_sync' },
      ]);
      useFacts({ [SITE]: facts(40, 2), '24381_179753': facts(0, 0), '24381_536': facts(7, 2), '24381_621': facts(6, 0) });
      partialSite();

      expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
      expect(generationFactsMock).not.toHaveBeenCalled();
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();

      // 行上的「生成」（显式补齐）：问预检，补上后端说缺的那一块
      v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => generated(refno, NEW_536) as never);
      expect(await gen.showModelByRefno(SITE, { flyTo: false, fill: true })).toBe(true);
      expect(generationFactsMock).toHaveBeenCalledWith(SITE);
      expect(v1Source.records.generateThenCollect.mock.calls).toEqual([['24381_536', FILL_REQUEST]]);
    });

    it('库里有成套模型、库文件比水位新的库：SITE 下没有记录的 ZONE 补不补听后端的——说没有要生成的单元就不补，只问节点自己一次', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      dbnumRowsMock.mockReturnValue(DBNUM_ROWS_FILE_AHEAD);
      useFacts({ [SITE]: facts(3362, 0) });
      partialSite();

      expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
      expect(generationFactsMock.mock.calls.map((call) => call[0])).toEqual([SITE]);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
      expect(treeChildrenMock).not.toHaveBeenCalled();
      expect(pendingGenerationFill(SITE)).toBeNull();
    });

    it('库里有成套模型、库文件比水位新的库：后端说某个没有记录的 ZONE 确有单元没生成——照样补（原来分不清，一律不补）', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      dbnumRowsMock.mockReturnValue(DBNUM_ROWS_FILE_AHEAD);
      useFacts({ [SITE]: facts(40, 7), '24381_179753': facts(0, 0), '24381_536': facts(7, 7), '24381_621': facts(6, 0) });
      partialSite();
      v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => generated(refno, NEW_536) as never);

      expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
      expect(v1Source.records.generateThenCollect.mock.calls).toEqual([['24381_536', FILL_REQUEST]]);
      expect(openChoiceMock).not.toHaveBeenCalled();
      // 生成不动库的水位：补完叫行上的状态重问一次
      expect(recheckLoadedNodeMock).toHaveBeenCalledWith(SITE);
    });

    it('上次停下留了「生成」，再显示时后端说已经没有要生成的单元（它在后台做完了）：那颗「生成」撤掉，不用人再点一次', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const { notePendingGenerationFill } = await import('@/composables/generationFillState');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      notePendingGenerationFill({ root: SITE, dbnum: 7997, chunks: 1, units: 6, exact: true, reason: 'stopped' });
      useFacts({ [SITE]: facts(21, 0) });
      visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: EXISTING, empty_scopes: ['24381_179753'] });

      expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
      expect(pendingGenerationFill(SITE)).toBeNull();
      // 不是人点的「生成」：不多说一句
      expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('没有需要生成的部分') }));
    });

    it('ZONE 只生成了一部分（有记录、但还缺单元）：先显示已有的，再对它自己补一块', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      typeInfoMock.mockResolvedValue({ success: true, refno: '24381_536', noun: 'ZONE' });
      useFacts({ '24381_536': facts(7, 2) });
      visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_536', refnos: ['24381_538'], empty_scopes: [] });
      v1Source.records.generateThenCollect.mockResolvedValueOnce(generated('24381_536', ['24381_538', '24381_550']) as never);
      const order: string[] = [];
      loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
        order.push(`load ${refnos.join(',')}`);
        return loadedAll(refnos);
      });

      expect(await gen.showModelByRefno('24381_536', { flyTo: false })).toBe(true);
      expect(v1Source.records.generateThenCollect.mock.calls).toEqual([['24381_536', FILL_REQUEST]]);
      // 已有的先装；补出来的只装新的那个
      expect(order[0]).toBe('load 24381_538');
      expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('24381_536 下还有 2 个单元没有模型'),
      }));
    });

    it('确认框里点了取消：行上登记这个节点（说得出「未生成」并给「生成」）', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      useFacts(FACTS_535);
      visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: [], empty_scopes: [...ZONES, SITE] });
      openChoiceMock.mockResolvedValue(null);

      expect(await gen.showModelByRefno(SITE)).toBe(false);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
      expect(pendingGenerationFill(SITE)).toMatchObject({ chunks: 4, units: 21, exact: true, reason: 'declined' });
      expect(noteNodeWithoutModelMock).toHaveBeenCalledWith(SITE, 7997);
    });

    it('生成到一半被叫停：这一次画出来的收回去，行上按「没有模型可显示的节点」登记（重问之后是部分生成）', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 7997 });
      useFacts({ ...FACTS_535, [SITE]: facts(21, 21, { needsConfirm: false }) });
      visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: [], empty_scopes: [...ZONES, SITE] });
      v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => {
        if (refno === '24381_536') requestStopModelLoad(SITE);
        return generated(refno, [`${refno}_x`]) as never;
      });

      expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(false);
      // 第一块做完、第二块在飞的时候叫停：第三、四块不发
      expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual(['24381_179300', '24381_536']);
      expect(noteNodeWithoutModelMock).toHaveBeenCalledWith(SITE, 7997);
      expect(pendingGenerationFill(SITE)).toMatchObject({ reason: 'stopped' });
      // 在飞的那一块后端照常算完：过 5 秒、20 秒各再问一次，行上的数跟上来
      expect(recheckLoadedNodeLaterMock).toHaveBeenCalledWith(SITE, [5_000, 20_000]);
    });

    it('缺的单元归「更新到最新」管（库有水位、在更新范围里、库文件比水位新）：已有的照常显示，不按需生成，说明点行上的「更新」', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
      dbnumRowsMock.mockReturnValue(DBNUM_ROWS_FILE_AHEAD);
      useFacts({ [SITE]: facts(2, 1, { preferUpdate: true }) });
      visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: EXISTING, empty_scopes: [] });

      expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
      expect(openChoiceMock).not.toHaveBeenCalled();
      expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
      expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
        level: 'info',
        message: `[提示] ${SITE}：已显示已有的模型；有 1 个单元还没有模型，是库的模型水位之后才有的：点行上的「更新」让后端把这个库更新到最新`,
      }));
      expect(pendingGenerationFill(SITE)).toBeNull();
    });

    it('一个模型都没有、缺的又归「更新到最新」管：不生成，照实说，行上登记这个节点（给的是「更新」）', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
      dbnumRowsMock.mockReturnValue(DBNUM_ROWS_FILE_AHEAD);
      typeInfoMock.mockResolvedValue({ success: true, refno: '24384_30000', noun: 'ZONE' });
      useFacts({ '24384_30000': facts(3, 3, { preferUpdate: true }) });
      visibleInstsMock.mockResolvedValue({ success: true, refno: '24384_30000', refnos: [], empty_scopes: ['24384_30000'] });

      expect(await gen.showModelByRefno('24384_30000')).toBe(false);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
      expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
        message: '[提示] 24384_30000：有 3 个单元还没有模型，是库的模型水位之后才有的：点行上的「更新」让后端把这个库更新到最新',
      }));
      expect(noteNodeWithoutModelMock).toHaveBeenCalledWith('24384_30000', 8000);
    });

    it('已有的模型画出来之后顺带问预检的那一会儿，行上的转圈不能点停（这时点停会把刚装好的收回去）；确有要补的、开始生成之后才又能停', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      partialSite();
      const seen: { phase: string; stoppable: boolean | undefined; stopAccepted?: boolean }[] = [];
      generationFactsMock.mockImplementation(async (refno: string) => {
        if (refno === SITE) {
          // 预检在路上：这时人去点行尾的转圈
          seen.push({ phase: 'precheck', stoppable: modelLoadSessionView(SITE)?.stoppable, stopAccepted: requestStopModelLoad(SITE) });
          return facts(21, 7);
        }
        return refno === '24381_536' ? facts(7, 7) : facts(0, 0);
      });
      v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => {
        seen.push({ phase: 'generate', stoppable: modelLoadSessionView(SITE)?.stoppable });
        return generated(refno, NEW_536) as never;
      });

      expect(await gen.showModelByRefno(SITE, { flyTo: false })).toBe(true);
      expect(seen).toEqual([
        { phase: 'precheck', stoppable: false, stopAccepted: false },
        { phase: 'generate', stoppable: true },
      ]);
      // 那一下没有被当成「停」：已有的照常留着，缺的那一块也补上了
      expect(evictMock).not.toHaveBeenCalled();
      expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
      expect(v1Source.records.generateThenCollect.mock.calls).toEqual([['24381_536', FILL_REQUEST]]);
    });

    it('预检迟迟不回来：已有的模型画出来之后最多等 3 秒就收口，不让显示一直挂着（这一次按过渡办法走）', async () => {
      vi.useFakeTimers();
      try {
        const { useModelGeneration } = await import('./useModelGeneration');
        const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
        dbnumRowsMock.mockReturnValue(DBNUM_ROWS_FILE_AHEAD);
        partialSite();
        generationFactsMock.mockImplementation(() => new Promise(() => {}));
        let settled: boolean | null = null;
        const showing = gen.showModelByRefno(SITE, { flyTo: false }).then((ok) => { settled = ok; });
        await vi.advanceTimersByTimeAsync(2_900);
        expect(settled).toBeNull();
        expect(loadInstancesMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(200);
        await showing;
        expect(settled).toBe(true);
        // 库里有成套模型：过渡办法不补没有记录的 ZONE
        expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
        expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('服务端没有那个接口（回 null）：照旧沿树数、数字写「约」，不登记没有模型的节点', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      typeInfoMock.mockResolvedValue({ success: true, refno: '24381_700', noun: 'ZONE' });
      useTree({ '24381_700': [child('24381_701', 'PIPE', 30)] });
      visibleInstsMock.mockResolvedValue({ success: true, refno: '24381_700', refnos: [], empty_scopes: ['24381_700'] });
      openChoiceMock.mockResolvedValue(null);

      expect(await gen.showModelByRefno('24381_700')).toBe(false);
      expect(openChoiceMock).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('要生成约 30 个单元') }));
      expect(noteNodeWithoutModelMock).not.toHaveBeenCalled();
    });
  });

  describe('确认生成的确认框：全页面一个，排队一个个问，后来的不盖掉先来的（#163）；连点的几个节点一个做完才轮到下一个问（#166）', () => {
    /** 两个都还没有模型、都超过确认阈值的 ZONE：约 30 个和约 25 个单元 */
    const ZONE_A = '24381_700';
    const ZONE_B = '24381_800';
    const FRESH: Record<string, string[]> = { [ZONE_A]: ['24381_702'], [ZONE_B]: ['24381_802'] };
    type Generation = Pick<ReturnType<typeof import('./useModelGeneration').useModelGeneration>, 'showModelByRefno'>;
    let dialog: Awaited<ReturnType<typeof useRealConfirmDialog>>;

    beforeEach(async () => {
      dialog = await useRealConfirmDialog();
      // 用例里要显示好几个节点：桩按节点回各自的东西
      const generatedZones = new Set<string>();
      typeInfoMock.mockImplementation(async (refno: string) => ({ success: true, refno, noun: refno === SITE ? 'SITE' : 'ZONE' }));
      useTree({
        ...TREE,
        // SITE 下没有模型的两个 ZONE 合计约 27 个单元，超过阈值
        '24381_536': [child('24381_537', 'STRU', 12), child('24381_549', 'REST', 3)],
        '24381_621': [child('24381_622', 'REST', 9), child('24381_631', 'STRU', 3)],
        [ZONE_A]: [child('24381_701', 'PIPE', 30)],
        [ZONE_B]: [child('24381_801', 'PIPE', 25)],
      });
      visibleInstsMock.mockImplementation(async (refno: string) => {
        // SITE：已有一部分模型，三个 ZONE 没有记录；两个 ZONE：生成之前查空，生成之后查得到新出来的构件
        if (refno === SITE) return { success: true, refno, refnos: EXISTING, empty_scopes: ['24381_179753', '24381_536', '24381_621'] };
        return generatedZones.has(refno)
          ? { success: true, refno, refnos: FRESH[refno] ?? [] }
          : { success: true, refno, refnos: [], empty_scopes: [refno] };
      });
      v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => {
        generatedZones.add(refno);
        return generated(refno, FRESH[refno] ?? []) as never;
      });
    });

    /** 页面上别处先弹着的那个确认框问的话（和节点的显示不相干的事） */
    const ELSEWHERE = '别处在问的事';

    /** 页面上别处先弹着一个确认框，再让节点走到它的确认：节点的排在后面 */
    async function askBehindAnother(gen: Generation, root: string) {
      const another = dialog.openChoice({ title: '别处的确认', message: ELSEWHERE, choices: [{ id: 'ok', text: '好' }] });
      await vi.waitFor(() => expect(dialog.visible.value).toBe(true));
      const showing = gen.showModelByRefno(root, { flyTo: false });
      await vi.waitFor(() => expect(openChoiceMock).toHaveBeenCalledTimes(1));
      return { another, showing };
    }

    /** 第一个节点先走到确认（它的确认框弹着），这时又点了第二个节点 */
    async function clickSecondWhileFirstAsks(gen: Generation, firstRoot: string, secondRoot: string) {
      const first = gen.showModelByRefno(firstRoot, { flyTo: false });
      await vi.waitFor(() => expect(dialog.visible.value).toBe(true));
      const second = gen.showModelByRefno(secondRoot, { flyTo: false });
      await tick();
      return { first, second };
    }

    it('别处的确认框还弹着，节点也走到确认：不盖掉别处的，答完别处的再弹节点的，各拿各的答复', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

      const { another, showing } = await askBehindAnother(gen, ZONE_B);
      // 弹着的还是别处的那个；节点在等它的确认，行上的加载态在、能停
      expect(dialog.message.value).toBe(ELSEWHERE);
      expect(modelLoadSessionView(ZONE_B)).toEqual({ stoppable: true, stopping: false, queued: false });

      // 别处的先答：拿到的是它自己的答复，节点没有跟着往下走
      dialog.choose('ok');
      expect(await another).toBe('ok');
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();

      // 接着弹出来的是节点的；选「生成并显示」
      await vi.waitFor(() => expect(dialog.message.value).toContain('约 25 个单元'));
      expect(dialog.visible.value).toBe(true);
      dialog.choose('generate');
      expect(await showing).toBe(true);
      expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual([ZONE_B]);
      expect(gen.isModelActuallyLoaded(ZONE_B)).toBe(true);
      expect(modelLoadSessionView(ZONE_B)).toBeNull();
      expect(dialog.visible.value).toBe(false);
    });

    it('排在别处的确认后面等着的节点被叫停：当场收口，不用等前面的确认框关；轮到它时不再弹，别处的不受影响', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

      const { another, showing } = await askBehindAnother(gen, ZONE_B);
      // 节点的确认还没轮到：行尾点停
      expect(requestStopModelLoad(ZONE_B)).toBe(true);
      expect(await showing).toBe(false);
      expect(modelLoadSessionView(ZONE_B)).toBeNull();
      expect(consumeModelLoadStopped(ZONE_B)).toBe(true);
      expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining(`${ZONE_B}：已停止加载`) }));
      // 停不是「取消」：不留「已取消」那一笔
      expect(pendingGenerationFill(ZONE_B)).toBeNull();
      // 别处的确认框原样弹着
      expect(dialog.visible.value).toBe(true);
      expect(dialog.message.value).toBe(ELSEWHERE);

      dialog.choose('ok');
      expect(await another).toBe('ok');
      await tick();
      // 节点的确认框没有再弹出来（弹过的只有别处的），也没有替它发生成
      expect(dialog.visible.value).toBe(false);
      expect(dialog.message.value).toBe(ELSEWHERE);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    });

    it('已有的模型显示出来之后才问的节点，等确认时被隐藏了：轮到它不弹，和叫停一样把这一次画出来的收回去', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 7997 });

      const { another, showing } = await askBehindAnother(gen, SITE);
      // SITE 已有的那部分已经装上了，它的确认（「生成并显示 / 只显示已有的」）排在后面
      expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([EXISTING]);
      expect(openChoiceMock.mock.calls[0]![0]).toMatchObject({ cancelText: '只显示已有的' });

      // 等的时候人把 SITE 隐藏了（refno 级可见态被改成 false），然后别处的那个才关
      viewer.scene.objects[SITE] = { visible: false };
      dialog.cancelChoice();
      expect(await another).toBeNull();
      expect(await showing).toBe(false);

      // SITE 的确认框没有弹：弹过的只有别处的
      expect(dialog.visible.value).toBe(false);
      expect(dialog.message.value).toBe(ELSEWHERE);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
      // 和叫停一样：这一次装进来的从场景里拿掉，告诉发起显示的一方别再把它置回可见
      expect(evictMock).toHaveBeenCalledTimes(1);
      expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, EXISTING, { release: true });
      expect(gen.isModelActuallyLoaded(SITE)).toBe(false);
      expect(consumeModelLoadStopped(SITE)).toBe(true);
      expect(modelLoadSessionView(SITE)).toBeNull();
    });

    it('一个模型都没有的节点等确认时被隐藏了：轮到它不弹，按已停止收口', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 7997 });

      const { another, showing } = await askBehindAnother(gen, ZONE_B);
      viewer.scene.objects[ZONE_B] = { visible: false };
      dialog.choose('ok');
      expect(await another).toBe('ok');
      expect(await showing).toBe(false);

      expect(dialog.visible.value).toBe(false);
      expect(dialog.message.value).toBe(ELSEWHERE);
      expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
      expect(consumeModelLoadStopped(ZONE_B)).toBe(true);
      expect(pendingGenerationFill(ZONE_B)).toBeNull();
      expect(modelLoadSessionView(ZONE_B)).toBeNull();
    });

    it('发问之前就藏着的节点（点眼睛就是要它显示）：不算等确认期间被隐藏，轮到它照常问；点取消按「已取消」记，不算被叫停', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 7997 });
      // 之前隐藏过，状态表里留着 visible=false；要到开始生成时才被立成可见
      viewer.scene.objects[ZONE_B] = { visible: false };

      const { another, showing } = await askBehindAnother(gen, ZONE_B);
      dialog.cancelChoice();
      expect(await another).toBeNull();

      await vi.waitFor(() => expect(dialog.message.value).toContain('约 25 个单元'));
      expect(dialog.visible.value).toBe(true);
      dialog.cancelChoice();
      expect(await showing).toBe(false);
      // 是人点的取消，不是被当成叫停
      expect(consumeModelLoadStopped(ZONE_B)).toBe(false);
      expect(pendingGenerationFill(ZONE_B)).toMatchObject({ units: 25, reason: 'declined' });
      expect(gen.isModelActuallyLoaded(ZONE_B)).toBe(false);
      expect(modelLoadSessionView(ZONE_B)).toBeNull();
      expect(dialog.visible.value).toBe(false);
    });

    it('第一个节点的确认框还弹着时又点了第二个节点（#166）：第二个排队，没轮到之前不查也不问；第一个答完、做完，第二个才开始、才弹它的确认框', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

      const { first, second } = await clickSecondWhileFirstAsks(gen, ZONE_A, ZONE_B);
      // 第二个在排队：还没去查它的记录，也没有走到确认；行上知道它在排队、能停
      expect(visibleInstsMock.mock.calls.map((call) => call[0])).toEqual([ZONE_A]);
      expect(openChoiceMock).toHaveBeenCalledTimes(1);
      expect(dialog.message.value).toContain('约 30 个单元');
      expect(modelLoadSessionView(ZONE_A)).toEqual({ stoppable: true, stopping: false, queued: false });
      expect(modelLoadSessionView(ZONE_B)).toEqual({ stoppable: true, stopping: false, queued: true });

      // 第一个选「生成并显示」：往下走的是它
      dialog.choose('generate');
      expect(await first).toBe(true);
      expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual([ZONE_A]);
      expect(gen.isModelActuallyLoaded(ZONE_A)).toBe(true);
      expect(modelLoadSessionView(ZONE_A)).toBeNull();

      // 轮到第二个：这时才查、才问；它点取消
      await vi.waitFor(() => expect(dialog.message.value).toContain('约 25 个单元'));
      expect(dialog.visible.value).toBe(true);
      expect(modelLoadSessionView(ZONE_B)).toEqual({ stoppable: true, stopping: false, queued: false });
      dialog.cancelChoice();
      expect(await second).toBe(false);
      expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
      expect(pendingGenerationFill(ZONE_B)).toMatchObject({ units: 25, reason: 'declined' });
      expect(gen.isModelActuallyLoaded(ZONE_B)).toBe(false);
      expect(modelLoadSessionView(ZONE_B)).toBeNull();
      expect(dialog.visible.value).toBe(false);
    });

    it('第一个节点的确认框还弹着、第二个节点在排队时把第二个叫停（#166）：当场从队里拿掉，不用等第一个；第一个不受影响，它做完之后也不会再去动第二个', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

      const { first, second } = await clickSecondWhileFirstAsks(gen, ZONE_A, ZONE_B);
      expect(requestStopModelLoad(ZONE_B)).toBe(true);
      expect(await second).toBe(false);
      expect(modelLoadSessionView(ZONE_B)).toBeNull();
      // 发起显示的一方问得到「这次显示收回去了」：不把节点同步成可见
      expect(consumeModelLoadStopped(ZONE_B)).toBe(true);
      // 还没开始就拿掉的：没有东西要收，不弹「已停止加载」，只在控制台留一句；也不留「已取消」那一笔
      expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(ZONE_B) }));
      expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining(`refno=${ZONE_B} 排队时被叫停`));
      expect(pendingGenerationFill(ZONE_B)).toBeNull();
      // 第一个的确认框原样弹着，它的加载也还在等
      expect(dialog.visible.value).toBe(true);
      expect(dialog.message.value).toContain('约 30 个单元');
      expect(modelLoadSessionView(ZONE_A)).toEqual({ stoppable: true, stopping: false, queued: false });

      dialog.choose('generate');
      expect(await first).toBe(true);
      await tick();
      // 第二个始终没有开始：没查过它的记录、没弹过它的确认框、没有替它发生成
      expect(visibleInstsMock.mock.calls.map((call) => call[0])).not.toContain(ZONE_B);
      expect(openChoiceMock).toHaveBeenCalledTimes(1);
      expect(dialog.visible.value).toBe(false);
      expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual([ZONE_A]);
    });
  });
});

describe('showModelByRefno 加载中可以停（用户 2026-11-11 定：停掉剩下的批次，这个节点画出来的收起来，回到没显示）', () => {
  const SITE = '24383_80211';
  const ALL = ['24383_1', '24383_2', '24383_3', '24383_4', '24383_5'];

  beforeEach(() => {
    typeInfoMock.mockResolvedValue({ success: true, refno: SITE, noun: 'SITE' });
    // 收回去的时候装载器说这些构件确实拿掉了
    evictMock.mockImplementation((_layer: unknown, _dbno: number, refnos: string[]) => [...refnos]);
  });

  it('加载期间行上知道它在加载、能停；结束之后撤掉', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    let during: unknown = 'unset';
    visibleInstsMock.mockImplementation(async () => {
      during = modelLoadSessionView(SITE);
      return { success: true, refno: SITE, refnos: ALL };
    });

    expect(modelLoadSessionView(SITE)).toBeNull();
    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(during).toEqual({ stoppable: true, stopping: false, queued: false });
    expect(modelLoadSessionView(SITE)).toBeNull();
    // 没被叫停：不记「被收回去」
    expect(consumeModelLoadStopped(SITE)).toBe(false);
  });

  it('读记录的时候叫停：取消那次记录读取，不退到逐节点的子树查询；已经画出来的那一批从场景里拿掉；节点不算已加载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock.mockImplementation(async () => {
      // 第一个成员到了、已经画出来；这时候点了停
      emitMember(SITE, '24383_100', ['24383_1', '24383_2'], 1, 3);
      await tick();
      expect(requestStopModelLoad(SITE)).toBe(true);
      // 记录读取被取消：树数据源把它报成查询失败
      return { success: false, refno: SITE, refnos: [], error_message: 'cancelled: gen-model 读取已被调用方取消' };
    });

    expect(await gen.showModelByRefno(SITE, { flyTo: true })).toBe(false);

    expect(v1Source.records.cancelCollect).toHaveBeenCalledWith(SITE);
    expect(v1Source.tree.subtreeRefnos).not.toHaveBeenCalled();
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, ['24383_1', '24383_2'], { release: true });
    // 对象表变了：拾取用的空间索引等跟着刷新（空清单的那一次）
    expect(viewer.__dtxAfterInstancesLoaded).toHaveBeenLastCalledWith(7997, []);
    expect(gen.isModelActuallyLoaded(SITE)).toBe(false);
    expect(noteLoadedNodeMock).not.toHaveBeenCalled();
    expect(gen.statusMessage.value).toBe('已停止加载');
    expect(gen.error.value).toBeNull();
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'info', message: expect.stringContaining('已停止加载，这次画出来的已收起；已取到的数据留着，再点眼睛会接着装'),
    }));
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    expect(consumeModelLoadStopped(SITE)).toBe(true);
    expect(modelLoadSessionView(SITE)).toBeNull();
  });

  it('装载带着取消信号；取网格的时候叫停（装载器收手、什么都没装）：没有东西可收，节点不算已加载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: ALL });
    let signalAtCall: AbortSignal | undefined;
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, _refnos: string[], options: { signal?: AbortSignal }) => {
      signalAtCall = options.signal;
      expect(options.signal?.aborted).toBe(false);
      requestStopModelLoad(SITE);
      return loaderCancelled();
    });

    expect(await gen.showModelByRefno(SITE)).toBe(false);
    expect(signalAtCall?.aborted).toBe(true);
    expect(evictMock).not.toHaveBeenCalled();
    expect(viewer.__dtxAfterInstancesLoaded).not.toHaveBeenCalled();
    expect(gen.isModelActuallyLoaded(SITE)).toBe(false);
    expect(gen.statusMessage.value).toBe('已停止加载');
    expect(consumeModelLoadStopped(SITE)).toBe(true);
  });

  it('分批装载装到一半叫停：后面的批不装，已经装进去的那一批拿掉', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    const refnos = Array.from({ length: 1500 }, (_, i) => `24383_${i + 1}`);
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos });
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, batch: string[]) => {
      requestStopModelLoad(SITE);
      return loadedAll(batch);
    });

    expect(await gen.showModelByRefno(SITE)).toBe(false);
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, refnos.slice(0, 1000), { release: true });
    expect(gen.isModelActuallyLoaded(SITE)).toBe(false);
  });

  it('点之前就在屏幕上的构件不动；原来装着但藏着、这一次改成显示的，叫停后藏回去', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    // 24383_1 先前显示着（它所在的 ZONE 单独显示过）；24383_2 装着但被隐藏了；其余没装
    viewer.scene.objects = { '24383_1': { visible: true }, '24383_2': { visible: false } };
    isDtxRefnoLoadedMock.mockImplementation((_dbno, refno) => refno === '24383_1' || refno === '24383_2');
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: ALL });
    loadInstancesMock.mockImplementation(async () => {
      requestStopModelLoad(SITE);
      // 装载器只装没装过的那三个
      return { ...loaderResult(3, 6), skippedRefnos: 2, loadedRefnoKeys: ['24383_3', '24383_4', '24383_5'] };
    });

    expect(await gen.showModelByRefno(SITE)).toBe(false);
    // 只拿掉这一次新装的三个
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, ['24383_3', '24383_4', '24383_5'], { release: true });
    // 这一次从隐藏改成显示的那一个藏回去；先前就显示着的 24383_1 没有被碰
    expect(viewer.scene.setObjectsVisible).toHaveBeenLastCalledWith(['24383_2'], false);
    expect(viewer.scene.setObjectsVisible.mock.calls.filter((call: unknown[]) => call[1] === false)).toHaveLength(1);
  });

  it('叫停之后再点眼睛：照常装完、记为已加载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: ALL });
    loadInstancesMock.mockImplementationOnce(async () => {
      requestStopModelLoad(SITE);
      return loaderCancelled();
    });
    expect(await gen.showModelByRefno(SITE)).toBe(false);
    consumeModelLoadStopped(SITE);

    expect(await gen.showModelByRefno(SITE)).toBe(true);
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
    expect(noteLoadedNodeMock).toHaveBeenCalledWith(SITE, 7997, expect.anything());
    expect(consumeModelLoadStopped(SITE)).toBe(false);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'success' }));
  });

  it('已经全部装完、马上要记成已加载的那一刻才叫停：照样收回去', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: ALL });
    // 回放钩子是装完之后才调的：这时候点停
    viewer.__dtxAfterInstancesLoaded.mockImplementation((_dbno: number, loaded: string[]) => {
      if (loaded.length > 0) requestStopModelLoad(SITE);
    });

    expect(await gen.showModelByRefno(SITE)).toBe(false);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, ALL, { release: true });
    expect(gen.isModelActuallyLoaded(SITE)).toBe(false);
    expect(noteLoadedNodeMock).not.toHaveBeenCalled();
  });

  describe('分块生成的时候叫停', () => {
    const FILL_SITE = '24381_535';
    const EXISTING = ['24381_179302', '24381_573'];
    const child = (refno: string, noun: string, children_count: number, name = refno) => ({ refno, noun, name, children_count });
    const TREE: Record<string, ReturnType<typeof child>[]> = {
      [FILL_SITE]: [child('24381_536', 'ZONE', 4, '/1RCV-SUPP-XX'), child('24381_621', 'ZONE', 2, '/1RCV-RACK-XX')],
      '24381_536': [child('24381_537', 'STRU', 3), child('24381_549', 'REST', 1), child('24381_553', 'STRU', 3), child('24381_567', 'REST', 1)],
      '24381_621': [child('24381_622', 'REST', 4), child('24381_631', 'STRU', 3)],
    };
    const generated = (refno: string, refnos: string[]) => ({
      refno, generationRoots: refnos.map((item) => `${item}0`), items: refnos.map((item) => ({ refno: item })),
      pending: [] as string[], empty: [], truncatedRoots: [], errors: {}, statuses: {} as Record<string, string>,
    });

    beforeEach(() => {
      typeInfoMock.mockResolvedValue({ success: true, refno: FILL_SITE, noun: 'SITE' });
      dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
      treeChildrenMock.mockImplementation(async (refno: string) => {
        const children = TREE[refno];
        if (!children) throw new Error(`no children for ${refno}`);
        return { success: true, parent_refno: refno, children, truncated: false };
      });
      generationResumeTiming.delaysMs = [0];
      generationResumeTiming.budgetMs = 60_000;
      visibleInstsMock.mockResolvedValue({ success: true, refno: FILL_SITE, refnos: EXISTING, empty_scopes: ['24381_536', '24381_621'] });
    });

    it('在飞的那一发请求当场取消（后端照常算完、留在后端），没发的块不再发；这一次画出来的全部收回去，行上留「生成」', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 7997 });
      let requestSignal: AbortSignal | undefined;
      v1Source.records.generateThenCollect.mockImplementation(async (_refno: string, options?: { signal?: AbortSignal }) => {
        requestSignal = options?.signal;
        requestStopModelLoad(FILL_SITE);
        // 真的记录源见到取消信号就以 cancelled 抛出来
        throw new Error('cancelled');
      });

      expect(await gen.showModelByRefno(FILL_SITE, { flyTo: false })).toBe(false);

      expect(requestSignal?.aborted).toBe(true);
      expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
      // 先显示出来的已有部分也收回去：停 = 回到点之前的样子，不留「一半在场景里」
      expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, EXISTING, { release: true });
      expect(gen.isModelActuallyLoaded(FILL_SITE)).toBe(false);
      expect(forgetLoadedNodeMock).toHaveBeenCalledWith(FILL_SITE);
      // 两块都还没做完（正在做的那一块后端算完之后，下次补齐时它已经有记录，不会再排进来）
      expect(pendingGenerationFill(FILL_SITE)).toMatchObject({ chunks: 2, units: 15, reason: 'stopped' });
      expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('已停止加载') }));
      expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('补齐没有完成') }));
      expect(consumeModelLoadStopped(FILL_SITE)).toBe(true);
    });

    it('一块刚做完、下一块还没发的时候叫停：下一块不发；已经生成并显示的那一块也收回去', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 7997 });
      v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => generated(refno, ['24381_538']) as never);
      loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
        // 第一块的构件装进场景的时候点了停
        if (refnos.includes('24381_538')) requestStopModelLoad(FILL_SITE);
        return loadedAll(refnos);
      });

      expect(await gen.showModelByRefno(FILL_SITE, { flyTo: false })).toBe(false);
      expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
      expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, [...EXISTING, '24381_538'], { release: true });
      expect(pendingGenerationFill(FILL_SITE)).toMatchObject({ chunks: 1, units: 7, reason: 'stopped' });
    });

    it('行上的「生成」（节点点之前就显示着）中途叫停：节点照旧算已加载，只把这一次新生成的收回去', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 7997 });
      // 先正常显示：确认框选「只显示已有的」（把阈值压到 0 个单元以上都要问太绕，这里直接让第一次不补齐）
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: FILL_SITE, refnos: EXISTING, empty_scopes: [] });
      expect(await gen.showModelByRefno(FILL_SITE, { flyTo: false })).toBe(true);
      expect(gen.isModelActuallyLoaded(FILL_SITE)).toBe(true);
      evictMock.mockClear();
      forgetLoadedNodeMock.mockClear();
      // 已有的构件已经在场景里：装载器跳过它们
      loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
        const fresh = refnos.filter((refno) => !EXISTING.includes(refno));
        if (fresh.includes('24381_538')) requestStopModelLoad(FILL_SITE);
        return { ...loaderResult(fresh.length, fresh.length * 2), skippedRefnos: refnos.length - fresh.length, loadedRefnoKeys: fresh };
      });
      v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => generated(refno, ['24381_538']) as never);

      expect(await gen.showModelByRefno(FILL_SITE, { flyTo: false, fill: true })).toBe(false);
      expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, ['24381_538'], { release: true });
      expect(gen.isModelActuallyLoaded(FILL_SITE)).toBe(true);
      expect(forgetLoadedNodeMock).not.toHaveBeenCalled();
      expect(pendingGenerationFill(FILL_SITE)).toMatchObject({ chunks: 1, reason: 'stopped' });
    });

    it('已有的构件都是先前别的节点装的（装载器全跳过）、这一次才记成已加载，补齐时叫停：这一次记的撤掉，先前装的构件不动', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 7997 });
      // 已有的两个构件早在场景里（先点亮过它下面的节点）：装载器跳过它们
      loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
        const fresh = refnos.filter((refno) => !EXISTING.includes(refno));
        return { ...loaderResult(fresh.length, fresh.length * 2), skippedRefnos: refnos.length - fresh.length, loadedRefnoKeys: fresh };
      });
      let loadedBeforeStop: boolean | null = null;
      v1Source.records.generateThenCollect.mockImplementation(async () => {
        loadedBeforeStop = gen.isModelActuallyLoaded(FILL_SITE);
        requestStopModelLoad(FILL_SITE);
        throw new Error('cancelled');
      });

      expect(await gen.showModelByRefno(FILL_SITE, { flyTo: false })).toBe(false);

      // 开始补齐之前它已经记成已加载、登记进表（构件都在场景里）
      expect(loadedBeforeStop).toBe(true);
      expect(noteLoadedNodeMock).toHaveBeenCalledWith(FILL_SITE, 7997, expect.anything());
      // 叫停 = 回到点之前的样子：这一次记的撤掉
      expect(gen.isModelActuallyLoaded(FILL_SITE)).toBe(false);
      expect(forgetLoadedNodeMock).toHaveBeenCalledWith(FILL_SITE);
      // 这一次什么都没装：没有东西可收，先前装的构件留在场景里
      expect(evictMock).not.toHaveBeenCalled();
      expect(pendingGenerationFill(FILL_SITE)).toMatchObject({ chunks: 2, units: 15, reason: 'stopped' });
      expect(consumeModelLoadStopped(FILL_SITE)).toBe(true);
    });
  });

  it('重载的时候叫停（还没开始换）：场景保持原样，节点照旧算已加载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: ALL });
    expect(await gen.showModelByRefno(SITE)).toBe(true);
    evictMock.mockClear();
    v1Source.records.invalidateRoot.mockReturnValue([]);
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, _refnos: string[], options: { replaceExistingObjects?: boolean }) => {
      expect(options.replaceExistingObjects).toBe(true);
      requestStopModelLoad(SITE);
      return loaderCancelled();
    });

    expect(await gen.showModelByRefno(SITE, { refresh: true })).toBe(false);
    expect(evictMock).not.toHaveBeenCalled();
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
    expect(gen.statusMessage.value).toBe('已停止重载，场景保持原样');
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('已停止重载') }));
  });

  it('重载已经换完之后才点停：来不及了，照常收口（换上去的不拿掉）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: ALL });
    expect(await gen.showModelByRefno(SITE)).toBe(true);
    evictMock.mockClear();
    v1Source.records.invalidateRoot.mockReturnValue([]);
    viewer.__dtxAfterInstancesLoaded.mockImplementation(() => { requestStopModelLoad(SITE); });

    expect(await gen.showModelByRefno(SITE, { refresh: true })).toBe(true);
    expect(evictMock).not.toHaveBeenCalled();
    expect(gen.isModelActuallyLoaded(SITE)).toBe(true);
  });

  it('右键重新生成不能停：后端已经在清旧模型、算新模型', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE, refnos: ALL });
    let during: unknown = 'unset';
    let stopAccepted: boolean | null = null;
    v1Source.records.generateThenCollect.mockImplementationOnce(async (refno: string) => {
      during = modelLoadSessionView(SITE);
      stopAccepted = requestStopModelLoad(SITE);
      return { refno, generationRoots: [refno], items: [{ refno }], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {} } as never;
    });

    expect(await gen.showModelByRefno(SITE, { regenerate: true })).toBe(true);
    expect(during).toEqual({ stoppable: false, stopping: false, queued: false });
    expect(stopAccepted).toBe(false);
    // 重新生成的请求不带取消信号
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith(SITE, REGENERATE_REQUEST);
    expect(evictMock).not.toHaveBeenCalled();
  });
});

describe('showModelByRefno 节点一级的更新到最新（方案第 12 节；按需生成的库 / 不在更新范围里的库里落后的节点）', () => {
  const UPDATE_ZONE = '24381_536';
  const MEMBERS = ['24381_538', '24381_550'];
  /** 后端此刻的节点模型状态：按需生成的库里一个落后的 ZONE——8 个单元都生成过（会话 445），之后有 1 个被改到 */
  const LAGGING = {
    verdict: 'lagging', verdictReason: 'units_changed', dbnum: 7997, noun: 'ZONE', unitRoot: null,
    units: { total: 8, generated: 8, missing: 0, failed: 0, lagging: 1, exact: true },
    generatedAt: { sesnoMin: 445, sesnoMax: 445, timeMin: null, timeMax: null, basis: 'own_generation' },
    changes: { fromSesno: 445, toSesno: 447, unitsChanged: 1, unitsAdded: 0, unitsRemoved: 0, unattributed: false },
    precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    library: { fileLatestSesno: 447, modelSesno: 0, modelSesnoTime: null, inWatchScope: true },
  };
  /** 同一个节点，但这段改动里有 2 个单元被删掉了 */
  const LAGGING_WITH_REMOVED = {
    ...LAGGING, verdictReason: 'other_changes',
    changes: { fromSesno: 445, toSesno: 447, unitsChanged: 2, unitsAdded: 0, unitsRemoved: 2, unattributed: false },
  };
  const generated = (refno: string) => ({
    refno, generationRoots: [`${refno}0`, `${refno}1`], items: [{ refno: `${refno}9` }],
    pending: [] as string[], empty: [], truncatedRoots: [], errors: {}, statuses: {} as Record<string, string>,
  });
  /** 节点已经装在场景里的查看器 */
  const loadedViewer = () => {
    const viewer = makeViewer();
    viewer.scene.objects[UPDATE_ZONE] = {};
    viewer.__dtxLayer.hasObject = vi.fn(() => true);
    return viewer;
  };

  beforeEach(() => {
    visibleInstsMock.mockReset();
    v1Source.tree.subtreeRefnos.mockReset();
    v1Source.records.generateThenCollect.mockReset();
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => generated(refno) as never);
    v1Source.records.invalidateRoot.mockReset();
    v1Source.records.invalidateRoot.mockReturnValue([]);
    typeInfoMock.mockResolvedValue({ success: true, refno: UPDATE_ZONE, noun: 'ZONE' });
    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_UNINITIALIZED);
    visibleInstsMock.mockResolvedValue({ success: true, refno: UPDATE_ZONE, refnos: MEMBERS });
    nodeFactsMock.mockResolvedValue(LAGGING);
    generationResumeTiming.delaysMs = [0];
    generationResumeTiming.budgetMs = 60_000;
  });

  it('更新做完是要把节点显示出来的：藏着的成员照旧拉回可见（和重载不一样——模型树随后把眼睛点亮）', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = loadedViewer();
    viewer.scene.objects[MEMBERS[0]!] = { visible: false };
    isDtxRefnoLoadedMock.mockImplementation((_dbno, refno) => MEMBERS.includes(refno));
    const gen = useModelGeneration({ viewer, db_num: 7997 });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(true);

    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith([UPDATE_ZONE, ...MEMBERS], true);
  });

  it('更新不问模型树「藏着的那部分」（那是重载才问的）：节点只藏了一部分、这一次又有新构件，做完照样全部显示出来', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = loadedViewer();
    viewer.scene.objects[MEMBERS[0]!] = { visible: false };
    // MEMBERS[1] 这一次才有（还不在场景里）；树上它落在藏着的子节点下面
    isDtxRefnoLoadedMock.mockImplementation((_dbno, refno) => refno === MEMBERS[0]);
    const tree = vi.fn(async (): Promise<TreeHiddenScope | null> => ({ refnos: new Set(MEMBERS), failed: [] }));
    const offTree = provideTreeHiddenScope(tree);
    try {
      const gen = useModelGeneration({ viewer, db_num: 7997 });

      expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(true);

      expect(tree).not.toHaveBeenCalled();
      expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith([UPDATE_ZONE, ...MEMBERS], true);
    } finally {
      offTree();
    }
  });

  it('没有单元被删：不问人，对节点发一发不带 force 的生成（后端只重算不是最新的单元，不清几何），做完照重载那条路整套替换', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = loadedViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(true);

    // 动手之前重新问了一次后端此刻的状态
    expect(nodeFactsMock).toHaveBeenCalledWith({ refno: UPDATE_ZONE, signal: expect.any(AbortSignal) });
    expect(openChoiceMock).not.toHaveBeenCalled();
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith(UPDATE_ZONE, UPDATE_REQUEST);
    // 先生成、后清本地记录缓存重查：换上去的是重新生成之后的记录
    expect(v1Source.records.generateThenCollect.mock.invocationCallOrder[0]!)
      .toBeLessThan(v1Source.records.invalidateRoot.mock.invocationCallOrder[0]!);
    expect(v1Source.records.invalidateRoot).toHaveBeenCalledWith(UPDATE_ZONE);
    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 7997, MEMBERS, expect.objectContaining({
      replaceExistingObjects: true, forceRefreshGeometries: true, forceReloadRefnos: MEMBERS,
    }));
    expect(viewer.cameraFlight.flyTo).not.toHaveBeenCalled();
    // 重新登记：行上的状态跟着重问（落后 → 最新），之前记的那一笔「屏幕上还没换上」随之清掉
    expect(markLoadedNodeStaleMock).toHaveBeenCalledWith(UPDATE_ZONE, expect.stringContaining('屏幕上还没换上'));
    expect(markLoadedNodeStaleMock.mock.invocationCallOrder[0]!).toBeLessThan(noteLoadedNodeMock.mock.invocationCallOrder[0]!);
    expect(noteLoadedNodeMock).toHaveBeenCalledWith(UPDATE_ZONE, 7997, expect.anything());
    expect(gen.statusMessage.value).toBe('更新完成 (gen-model)');
    expect(emitToastMock).toHaveBeenLastCalledWith({
      level: 'success',
      message: `[成功] ${UPDATE_ZONE}：后端已核对 2 个单元（落后的已重新生成）；屏幕上已换成最新的 4 个几何实例`,
    });
  });

  it('SITE：一个 ZONE 一块、一块一块发；没有子节点的 ZONE 不发；不对 SITE 自己发', async () => {
    const SITE_NODE = '24381_535';
    nodeFactsMock.mockResolvedValue({ ...LAGGING, noun: 'SITE', units: { ...LAGGING.units, total: 18 } });
    typeInfoMock.mockResolvedValue({ success: true, refno: SITE_NODE, noun: 'SITE' });
    treeChildrenMock.mockImplementation(async (refno: string) => ({
      success: true, parent_refno: refno, truncated: false,
      children: [
        { refno: '24381_536', noun: 'ZONE', name: '/1RCV-SUPP-XX', children_count: 4 },
        { refno: '24381_179753', noun: 'ZONE', name: '/EMPTY', children_count: 0 },
        { refno: '24381_621', noun: 'ZONE', name: '/1RCV-RACK-XX', children_count: 2 },
      ],
    }));
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE_NODE, refnos: MEMBERS });
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const statuses: string[] = [];
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => {
      statuses.push(gen.statusMessage.value);
      return generated(refno) as never;
    });

    expect(await gen.showModelByRefno(SITE_NODE, { update: true, flyTo: false })).toBe(true);

    expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual(['24381_536', '24381_621']);
    for (const call of v1Source.records.generateThenCollect.mock.calls) expect((call as unknown[])[1]).toEqual(UPDATE_REQUEST);
    expect(statuses[0]).toContain('正在更新 第 1/2 块');
    expect(statuses[1]).toContain('正在更新 第 2/2 块');
    // 更新期间不弹整屏遮罩
    expect(gen.showProgressModal.value).toBe(false);
  });

  it('单元多（超过后端给的阈值）：先说明要占用后端一段时间；取消就不做，屏幕上的不动', async () => {
    nodeFactsMock.mockResolvedValue({ ...LAGGING, units: { ...LAGGING.units, total: 30 } });
    openChoiceMock.mockResolvedValue(null);
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(false);

    expect(openChoiceMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '更新到最新', choices: [{ id: 'update', text: '更新' }], cancelText: '取消',
      message: expect.stringContaining('后端把这个节点下的 30 个单元逐个核对'),
    }));
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(v1Source.records.invalidateRoot).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('已取消更新') }));
  });

  it('有单元被删、后端没声明清几何不再带走别人共用的东西：先确认，话里说清楚可能连带删掉别的构件的模型数据；取消就什么都不发', async () => {
    nodeFactsMock.mockResolvedValue(LAGGING_WITH_REMOVED);
    openChoiceMock.mockResolvedValue(null);
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(false);

    expect(openChoiceMock).toHaveBeenCalledTimes(1);
    expect(openChoiceMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '更新到最新', choices: [{ id: 'update', text: '知道风险，继续' }], cancelText: '取消',
      message: expect.stringContaining('这个后端版本上，重新生成可能连带删掉别的构件、别的库共用的模型数据'),
    }));
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
  });

  it('有单元被删、确认之后：先清后生成（带 force，这一段不能停），再整套替换；被删单元的构件从场景撤下', async () => {
    nodeFactsMock.mockResolvedValue(LAGGING_WITH_REMOVED);
    openChoiceMock.mockResolvedValue('update');
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    // 这个节点上一次装了三个构件，其中一个属于后来被删掉的单元
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: UPDATE_ZONE, refnos: [...MEMBERS, '24381_560'] });
    expect(await gen.showModelByRefno(UPDATE_ZONE, { flyTo: false })).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 7997, [...MEMBERS, '24381_560'], expect.anything());
    loadInstancesMock.mockClear();
    emitToastMock.mockClear();
    evictMock.mockClear();
    evictMock.mockImplementation((_layer: unknown, _dbno: number, refnos: string[]) => refnos);
    let during: unknown = 'unset';
    let stopAccepted: boolean | null = null;
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => {
      during = modelLoadSessionView(UPDATE_ZONE);
      stopAccepted = requestStopModelLoad(UPDATE_ZONE);
      return generated(refno) as never;
    });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(true);

    // 和右键「重新生成模型」同一个请求：带 force、不带取消信号
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith(UPDATE_ZONE, { force: true });
    expect(during).toEqual({ stoppable: false, stopping: false, queued: false });
    expect(stopAccepted).toBe(false);
    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 7997, MEMBERS, expect.objectContaining({ replaceExistingObjects: true }));
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, ['24381_560'], { release: true });
    expect(emitToastMock).toHaveBeenLastCalledWith({
      level: 'success',
      message: `[成功] ${UPDATE_ZONE}：有 2 个单元被删，已先清后生成 8 个单元；屏幕上已换成最新的 4 个几何实例`,
    });
  });

  it('有单元被删、后端声明了清几何不再带走别人共用的东西：不问人，直接先清后生成', async () => {
    nodeFactsMock.mockResolvedValue(LAGGING_WITH_REMOVED);
    purgeKeepsSharedMock.mockReturnValue(true);
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(true);

    expect(openChoiceMock).not.toHaveBeenCalled();
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledWith(UPDATE_ZONE, { force: true });
  });

  it('先清后生成之后后端还在后台算（超时）：屏幕上的不动，记一笔「本页装的不是后端现在的那一版」，过一会儿再问行上的状态', async () => {
    nodeFactsMock.mockResolvedValue(LAGGING_WITH_REMOVED);
    purgeKeepsSharedMock.mockReturnValue(true);
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => ({
      refno, generationRoots: [], items: [], pending: [refno], empty: [], truncatedRoots: [], errors: {}, statuses: {},
    }) as never);
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(false);

    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(v1Source.records.invalidateRoot).not.toHaveBeenCalled();
    expect(markLoadedNodeStaleMock).toHaveBeenCalledWith(UPDATE_ZONE, expect.any(String));
    expect(recheckLoadedNodeLaterMock).toHaveBeenCalledWith(UPDATE_ZONE, expect.any(Array));
    expect(recheckLoadedNodeMock).toHaveBeenCalledWith(UPDATE_ZONE);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'warning', message: expect.stringContaining('后端还在后台重新生成') }));
  });

  it('后端此刻说这个节点已经是最新（别处更新过了）：不生成，直接按最新记录换上', async () => {
    nodeFactsMock.mockResolvedValue({ ...LAGGING, verdict: 'latest', verdictReason: null, changes: null });
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(true);

    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(openChoiceMock).not.toHaveBeenCalled();
    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 7997, MEMBERS, expect.objectContaining({ replaceExistingObjects: true }));
    // 后端没有被叫去重新生成：不用记「屏幕上还没换上」
    expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('后端说这个节点已经是最新') }));
  });

  it('不该动的时候不动：节点模型状态没问到、服务端没有那个接口、库正在更新——都不生成、不重载', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    nodeFactsMock.mockRejectedValueOnce(new Error('SOURCE_NOT_FOUND: 库文件打不开'));
    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(false);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'warning', message: expect.stringContaining('没有问到后端的节点模型状态') }));

    nodeFactsMock.mockResolvedValueOnce(null);
    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(false);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'warning', message: expect.stringContaining('后端没有节点模型状态接口') }));

    nodeFactsMock.mockResolvedValueOnce({ ...LAGGING, verdict: 'updating', verdictReason: 'data_batch_running' });
    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(false);
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('这个库正在更新') }));
    // 行上的状态和后端此刻说的对不上了：叫它重问
    expect(recheckLoadedNodeMock).toHaveBeenCalledWith(UPDATE_ZONE);

    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(v1Source.records.invalidateRoot).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
  });

  it('更新到一半被叫停（SITE 分块）：在飞的那一发当场取消，没发的块不再发；屏幕上的不动；记一笔「本页装的不是后端现在的那一版」', async () => {
    const SITE_NODE = '24381_535';
    nodeFactsMock.mockResolvedValue({ ...LAGGING, noun: 'SITE', units: { ...LAGGING.units, total: 18 } });
    typeInfoMock.mockResolvedValue({ success: true, refno: SITE_NODE, noun: 'SITE' });
    treeChildrenMock.mockImplementation(async (refno: string) => ({
      success: true, parent_refno: refno, truncated: false,
      children: ['24381_536', '24381_571', '24381_621'].map((child) => ({ refno: child, noun: 'ZONE', name: child, children_count: 3 })),
    }));
    visibleInstsMock.mockResolvedValue({ success: true, refno: SITE_NODE, refnos: MEMBERS });
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    expect(await gen.showModelByRefno(SITE_NODE, { flyTo: false })).toBe(true);
    loadInstancesMock.mockClear();
    evictMock.mockClear();
    v1Source.records.invalidateRoot.mockClear();
    let requestSignal: AbortSignal | undefined;
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string, options?: { signal?: AbortSignal }) => {
      if (refno === '24381_536') return generated(refno) as never;
      // 第二块在飞的时候点了停：真的记录源见到取消信号就以 cancelled 抛出来
      requestSignal = options?.signal;
      requestStopModelLoad(SITE_NODE);
      throw new Error('cancelled');
    });

    expect(await gen.showModelByRefno(SITE_NODE, { update: true, flyTo: false })).toBe(false);

    expect(requestSignal?.aborted).toBe(true);
    expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual(['24381_536', '24381_571']);
    // 屏幕上的一个都没动：不重查、不替换、不撤
    expect(v1Source.records.invalidateRoot).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
    expect(gen.isModelActuallyLoaded(SITE_NODE)).toBe(true);
    expect(forgetLoadedNodeMock).not.toHaveBeenCalled();
    // 后端已经重新生成了第一块：它自己看不出本页装的是哪一版，这里记一笔，并叫行上的状态现在、过一会儿各重问一次
    expect(markLoadedNodeStaleMock).toHaveBeenLastCalledWith(SITE_NODE, expect.stringContaining('更新到一半停了'));
    expect(recheckLoadedNodeMock).toHaveBeenCalledWith(SITE_NODE);
    expect(recheckLoadedNodeLaterMock).toHaveBeenCalledWith(SITE_NODE, expect.any(Array));
    expect(gen.statusMessage.value).toBe('已停止更新，场景保持原样');
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('已停止更新，屏幕上的没有动') }));
  });

  it('还没发出任何生成请求就被叫停（在问后端状态的时候）：什么都没动，也不用记那一笔', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });
    nodeFactsMock.mockImplementation(async () => {
      requestStopModelLoad(UPDATE_ZONE);
      return LAGGING;
    });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(false);

    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: `[提示] ${UPDATE_ZONE}：已停止更新，屏幕上的没有动` }));
  });

  it('生成做完了、重载的记录没查通：场景保持原样，那一笔「屏幕上还没换上」留着（后端说最新时行上给「重载」）', async () => {
    visibleInstsMock.mockReset();
    visibleInstsMock.mockRejectedValue(new Error('network: 断了'));
    v1Source.tree.subtreeRefnos.mockRejectedValue(new Error('network: 断了'));
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(false);

    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
    expect(loadInstancesMock).not.toHaveBeenCalled();
    expect(markLoadedNodeStaleMock).toHaveBeenCalledWith(UPDATE_ZONE, expect.stringContaining('屏幕上还没换上'));
    // 没有重新登记（那会把这一笔清掉）
    expect(noteLoadedNodeMock).not.toHaveBeenCalled();
  });

  it('有的生成根失败：其余照常，做完照样换到屏幕上，失败的点名', async () => {
    v1Source.records.generateThenCollect.mockImplementation(async (refno: string) => ({
      ...generated(refno),
      failedRoots: [{ root: '24381_549', error: 'generation_failed: 几何坏了', retryable: false }],
    }) as never);
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    expect(await gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false })).toBe(true);

    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 7997, MEMBERS, expect.objectContaining({ replaceExistingObjects: true }));
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'warning',
      message: expect.stringContaining('1 个生成根失败：24381_549（generation_failed: 几何坏了）'),
    }));
  });

  it('更新的确认排在别处的确认后面时被叫停：当场收口，轮到它不再弹；别处的不受影响（#163）', async () => {
    const dialog = await useRealConfirmDialog();
    // 单元多：更新要先确认
    nodeFactsMock.mockResolvedValue({ ...LAGGING, units: { ...LAGGING.units, total: 30 } });
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    // 页面上别处先弹着一个确认框（和节点的显示不相干的事）
    const another = dialog.openChoice({ title: '别处的确认', message: '别处在问的事', choices: [{ id: 'ok', text: '好' }] });
    await vi.waitFor(() => expect(dialog.visible.value).toBe(true));
    const updating = gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false });
    await vi.waitFor(() => expect(openChoiceMock).toHaveBeenCalledTimes(1));
    expect(modelLoadSessionView(UPDATE_ZONE)).toEqual({ stoppable: true, stopping: false, queued: false });

    // 更新的确认还没轮到：行尾点停
    expect(requestStopModelLoad(UPDATE_ZONE)).toBe(true);
    expect(await updating).toBe(false);
    expect(modelLoadSessionView(UPDATE_ZONE)).toBeNull();
    expect(emitToastMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', message: `[提示] ${UPDATE_ZONE}：已停止更新，屏幕上的没有动` }));
    // 别处的确认框原样弹着
    expect(dialog.visible.value).toBe(true);
    expect(dialog.message.value).toBe('别处在问的事');

    dialog.choose('ok');
    expect(await another).toBe('ok');
    await tick();
    // 更新的确认框没有再弹出来，后端什么请求都没收到
    expect(dialog.visible.value).toBe(false);
    expect(dialog.message.value).toBe('别处在问的事');
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
  });

  it('第一个节点的更新还在等确认时又点了第二个节点的更新（#166）：第二个排队，没轮到之前不问后端状态、不弹确认；排队时叫停当场拿掉，第一个不受影响', async () => {
    const dialog = await useRealConfirmDialog();
    const OTHER_ZONE = '24381_621';
    // 单元多：更新要先确认
    nodeFactsMock.mockResolvedValue({ ...LAGGING, units: { ...LAGGING.units, total: 30 } });
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: loadedViewer(), db_num: 7997 });

    const first = gen.showModelByRefno(UPDATE_ZONE, { update: true, flyTo: false });
    await vi.waitFor(() => expect(dialog.visible.value).toBe(true));
    const second = gen.showModelByRefno(OTHER_ZONE, { update: true, flyTo: false });
    await tick();
    // 第二个在排队：还没去问它的状态，也没有走到确认
    expect(nodeFactsMock.mock.calls.map((call) => call[0].refno)).not.toContain(OTHER_ZONE);
    expect(openChoiceMock).toHaveBeenCalledTimes(1);
    expect(modelLoadSessionView(OTHER_ZONE)).toEqual({ stoppable: true, stopping: false, queued: true });

    expect(requestStopModelLoad(OTHER_ZONE)).toBe(true);
    expect(await second).toBe(false);
    expect(modelLoadSessionView(OTHER_ZONE)).toBeNull();
    expect(consumeModelLoadStopped(OTHER_ZONE)).toBe(true);
    // 前一个的确认框原样弹着
    expect(dialog.visible.value).toBe(true);
    expect(modelLoadSessionView(UPDATE_ZONE)).toEqual({ stoppable: true, stopping: false, queued: false });

    dialog.choose('update');
    expect(await first).toBe(true);
    await tick();
    // 第二个始终没有开始：没问过状态、没弹过确认，后端只收到第一个节点的请求
    expect(nodeFactsMock.mock.calls.map((call) => call[0].refno)).not.toContain(OTHER_ZONE);
    expect(openChoiceMock).toHaveBeenCalledTimes(1);
    expect(dialog.visible.value).toBe(false);
    expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual([UPDATE_ZONE]);
  });
});

describe('状态条：几个加载同时在跑时各走各的进度，先结束的不把「停」带走；只有一批的装载进度也往前走（#164）', () => {
  const NODE = '24381_101410';
  const OTHER = '24381_202020';
  type MeshProgress = (done: number, total: number) => void;
  type ScopeAnswer = { success: boolean; refno: string; refnos: string[]; error_message?: string };

  /** 查看器左下角状态条此刻的内容（全页面一份，这里用的是真的） */
  const bar = () => useModelLoadStatus().state.value;
  const barLine = () => `${bar().progress}% ${bar().message}`;

  /** 记录源的进度广播（全页面都收得到）：`refno` 是发起那次查询的节点，`root` 是刚查完的生成根 */
  function emitRecordsProgress(refno: string, root: string, done: number, total: number): void {
    for (const listener of [...progressListeners]) listener({ refno, root, done, total });
  }

  it('不超过一页的节点（装载只有一批）：进了装载，文案从「查询记录」换成装载阶段的，进度跟着取到的网格往前走，不再停在 30%', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const seen: string[] = [];
    let instanceDuringLoad = '';
    visibleInstsMock.mockImplementation(async () => {
      emitRecordsProgress(NODE, '24381_145018', 3, 3);
      seen.push(barLine());
      return { success: true, refno: NODE, refnos: ['24381_1', '24381_2', '24381_3'] };
    });
    loadInstancesMock.mockImplementation(async (
      _layer: unknown, _dbno: number, refnos: string[], options: { onMeshProgress?: MeshProgress },
    ) => {
      seen.push(barLine());
      for (const done of [0, 10, 20]) {
        options.onMeshProgress?.(done, 20);
        seen.push(barLine());
      }
      instanceDuringLoad = `${gen.progress.value}% ${gen.statusMessage.value}`;
      return loadedAll(refnos);
    });

    expect(await gen.showModelByRefno(NODE)).toBe(true);

    expect(seen).toEqual([
      '30% gen-model 查询记录：3/3 个生成根',
      '30% 从 gen-model 加载 3 个 refno...',
      `30% 从 gen-model 加载 ${NODE}：取网格 0/20...`,
      `56% 从 gen-model 加载 ${NODE}：取网格 10/20...`,
      `82% 从 gen-model 加载 ${NODE}：网格已取齐，正在装入场景...`,
    ]);
    // 这个实例对外的那一份（整屏进度弹窗、调用方读的）和状态条是同一个内容
    expect(instanceDuringLoad).toBe(seen[4]);
    expect(bar()).toMatchObject({ visible: false, progress: 100, message: '加载完成 (gen-model)', stopKey: null });
  });

  it('分了批的装载：文案还是「装入第几批」，百分比在这一批占的那一段里跟着取到的网格走', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const refnos = Array.from({ length: 2500 }, (_, i) => `24381_${i + 1}`);
    visibleInstsMock.mockResolvedValue({ success: true, refno: NODE, refnos });
    const seen: string[] = [];
    loadInstancesMock.mockImplementation(async (
      _layer: unknown, _dbno: number, batch: string[], options: { onMeshProgress?: MeshProgress },
    ) => {
      seen.push(barLine());
      options.onMeshProgress?.(50, 100);
      seen.push(barLine());
      options.onMeshProgress?.(100, 100);
      seen.push(barLine());
      return loadedAll(batch);
    });

    expect(await gen.showModelByRefno(NODE)).toBe(true);

    const firstBatch = `从 gen-model 加载 ${NODE}：装入第 1/2 批（1000/2500 个 refno）...`;
    const secondBatch = `从 gen-model 加载 ${NODE}：装入第 2/2 批（2500/2500 个 refno）...`;
    expect(seen).toEqual([
      `30% ${firstBatch}`, `40% ${firstBatch}`, `50% ${firstBatch}`,
      `56% ${secondBatch}`, `71% ${secondBatch}`, `87% ${secondBatch}`,
    ]);
  });

  it('别的节点的记录查询进度（全页面广播）不动这个节点的进度：文案、节点号、百分比都还是自己的', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const own = () => ({
      bar: { message: bar().message, progress: bar().progress, currentRefno: bar().currentRefno, stopKey: bar().stopKey },
      instance: {
        message: gen.statusMessage.value, progress: gen.progress.value, currentRefno: gen.currentRefno.value,
        index: gen.currentIndex.value, total: gen.totalCount.value,
      },
    });
    let before: ReturnType<typeof own> | null = null;
    let after: ReturnType<typeof own> | null = null;
    visibleInstsMock.mockImplementation(async () => {
      emitRecordsProgress(NODE, '24381_145018', 1, 4);
      before = own();
      // 另一个正在显示的 SITE、模型树查可见性……各自的查询收完了
      emitRecordsProgress(OTHER, '24381_300001', 3, 3);
      emitRecordsProgress('24381_303030', '24381_300002', 6, 6);
      after = own();
      return { success: true, refno: NODE, refnos: ['24381_1'] };
    });

    expect(await gen.showModelByRefno(NODE)).toBe(true);

    expect(before).toEqual({
      bar: { message: 'gen-model 查询记录：1/4 个生成根', progress: 15, currentRefno: '24381_145018', stopKey: NODE },
      instance: { message: 'gen-model 查询记录：1/4 个生成根', progress: 15, currentRefno: '24381_145018', index: 2, total: 4 },
    });
    expect(after).toEqual(before);
  });

  it('进了装载之后这个节点再有记录查询的进度（装载器补查、模型树查可见性）：不把状态条拉回「查询记录」', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: NODE, refnos: ['24381_1', '24381_2'] });
    const line = () => `${barLine()} @${bar().currentRefno}`;
    let before = '';
    let after = '';
    loadInstancesMock.mockImplementation(async (
      _layer: unknown, _dbno: number, refnos: string[], options: { onMeshProgress?: MeshProgress },
    ) => {
      options.onMeshProgress?.(5, 10);
      before = line();
      emitRecordsProgress(NODE, '24381_145018', 1, 1);
      after = line();
      return loadedAll(refnos);
    });

    expect(await gen.showModelByRefno(NODE)).toBe(true);

    expect(before).toBe(`56% 从 gen-model 加载 ${NODE}：取网格 5/10... @${NODE}`);
    expect(after).toBe(before);
  });

  it.each<[string, boolean]>([
    ['同一份 useModelGeneration（模型树上连点两个节点）', true],
    ['两份 useModelGeneration（模型树点一个、查看器里点一个）', false],
  ])('连点两个节点 · %s：后点的排队，状态条一直是先点的；先点的收尾之后状态条不收，换成轮到的那个，「停」认它、点了真能停（#166）', async (_label, shared) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const firstGen = useModelGeneration({ viewer, db_num: 7997 });
    const secondGen = shared ? firstGen : useModelGeneration({ viewer, db_num: 7997 });
    // 范围查询都先挂着，由用例决定什么时候回
    const answer = new Map<string, (result: ScopeAnswer) => void>();
    visibleInstsMock.mockImplementation((refno: string) => new Promise<ScopeAnswer>((resolve) => { answer.set(refno, resolve); }));

    const first = firstGen.showModelByRefno(NODE);
    await vi.waitFor(() => expect(answer.has(NODE)).toBe(true));
    const second = secondGen.showModelByRefno(OTHER);
    await tick();

    // 后点的在排队：还没去查，状态条上没有它；显示的是先点的那个，「停」也认先点的
    expect(answer.has(OTHER)).toBe(false);
    expect(modelLoadSessionView(OTHER)).toEqual({ stoppable: true, stopping: false, queued: true });
    expect(bar()).toEqual({
      visible: true, message: '查询可见实例范围...', progress: 10, currentRefno: NODE, error: null, stopKey: NODE,
    });
    // 排队的那一次还没动它那份实例对外的进度
    if (!shared) expect(secondGen.isGenerating.value).toBe(false);

    // 先点的那个结束
    answer.get(NODE)!({ success: true, refno: NODE, refnos: ['24381_1'] });
    expect(await first).toBe(true);

    // 状态条没有跟着收起来：先点的一结束就换成轮到的那个，带着它自己的进度和「停」
    expect(bar()).toMatchObject({ visible: true, stopKey: OTHER });
    await vi.waitFor(() => expect(answer.has(OTHER)).toBe(true));
    expect(bar()).toEqual({
      visible: true, message: '查询可见实例范围...', progress: 10, currentRefno: OTHER, error: null, stopKey: OTHER,
    });
    expect(modelLoadSessionView(OTHER)).toEqual({ stoppable: true, stopping: false, queued: false });
    expect(secondGen.isGenerating.value).toBe(true);
    emitRecordsProgress(OTHER, '24381_300001', 3, 3);
    expect(bar()).toEqual({
      visible: true, message: 'gen-model 查询记录：3/3 个生成根', progress: 30, currentRefno: '24381_300001', error: null, stopKey: OTHER,
    });

    // 点状态条上的「停」（它拿 stopKey 去叫停）：停下来的是在跑的那个
    expect(requestStopModelLoad(bar().stopKey!)).toBe(true);
    expect(v1Source.records.cancelCollect).toHaveBeenCalledWith(OTHER);
    answer.get(OTHER)!({ success: false, refno: OTHER, refnos: [], error_message: 'cancelled: gen-model 读取已被调用方取消' });
    expect(await second).toBe(false);
    expect(secondGen.statusMessage.value).toBe('已停止加载');
    if (!shared) expect(firstGen.statusMessage.value).toBe('加载完成 (gen-model)');
    // 装进场景的只有先结束的那个节点的构件
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([['24381_1']]);
    expect(bar()).toMatchObject({ visible: false, message: '已停止加载', stopKey: null });
    expect(modelLoadSessionView(OTHER)).toBeNull();
    expect(consumeModelLoadStopped(OTHER)).toBe(true);
  });

  it('整库显示和节点的加载重叠（整库显示不进节点的排队）：状态条先显示先开始的整库，没有「停」；整库收尾之后状态条不收，换成还在跑的节点，「停」认它、点了真能停', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const dbGen = useModelGeneration({ viewer, db_num: 7997 });
    const nodeGen = useModelGeneration({ viewer, db_num: 7997 });
    let finishDbnum!: () => void;
    collectDbnumMock.mockImplementation((dbnum: number) => new Promise((resolve) => {
      finishDbnum = () => resolve({
        dbnum, sites: [{ refno: '24381_101405', name: '/1PTU-INST23' }], refnos: ['24381_1', '24381_2'],
        generationRoots: ['24381_101410'], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [],
      });
    }));
    let answerNode!: (result: ScopeAnswer) => void;
    visibleInstsMock.mockImplementation(() => new Promise<ScopeAnswer>((resolve) => { answerNode = resolve; }));

    const wholeDb = dbGen.showModelByDbnum(7997);
    await vi.waitFor(() => expect(collectDbnumMock).toHaveBeenCalledTimes(1));
    const node = nodeGen.showModelByRefno(OTHER);
    // 节点没有排在整库后面：它的查询这就发出去了
    await vi.waitFor(() => expect(visibleInstsMock).toHaveBeenCalledTimes(1));
    expect(modelLoadSessionView(OTHER)).toEqual({ stoppable: true, stopping: false, queued: false });
    // 状态条显示的还是先开始的整库：没有「停」
    expect(bar()).toMatchObject({ visible: true, message: 'gen-model：查找 dbnum=7997 的 SITE...', stopKey: null });

    finishDbnum();
    expect((await wholeDb).loaded).toBe(true);
    // 状态条没有跟着收起来：换成还在跑的节点，带着它自己的进度和「停」
    expect(bar()).toEqual({
      visible: true, message: '查询可见实例范围...', progress: 10, currentRefno: OTHER, error: null, stopKey: OTHER,
    });

    expect(requestStopModelLoad(bar().stopKey!)).toBe(true);
    answerNode({ success: false, refno: OTHER, refnos: [], error_message: 'cancelled: gen-model 读取已被调用方取消' });
    expect(await node).toBe(false);
    expect(bar()).toMatchObject({ visible: false, message: '已停止加载', stopKey: null });
    // 整库装进去的不受影响：装过的只有它那一批，没有东西被收回去
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([['24381_1', '24381_2']]);
    expect(evictMock).not.toHaveBeenCalled();
  });

  it('记录查完、翻页时先发出去的网格还没都回来：状态条说在取网格，进度跟着取到的走（30 → 70）；之后的装载从那里接着走', async () => {
    __resetGenModelV1ServiceLifecycleForTests();
    const { collectRecordsByAncestor } = await import('@/model-source/genModelV1/modelRecords');
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const record = (refno: string, hashes: string[]) => ({
      refno, old_refno: null, owner: '24381_145018', world_aabb: null,
      world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      insts: hashes.map((geo_hash) => ({ geo_hash })), has_neg: false, generic: 'ELBO', pts: null, date: null,
    });
    const recordsApi = {
      generate: vi.fn(),
      children: vi.fn(async (refno: string) => ({ source: 'direct', parent: refno, nodes: [] })),
      // 一页记录：两个构件，四个不同的网格
      records: vi.fn(async () => ({
        source: 'model-database', total: 2, truncated: false, next_cursor: null,
        items: [record('24381_1', ['h1', 'h2']), record('24381_2', ['h2', 'h3', 'h4'])],
      })),
    };
    visibleInstsMock.mockImplementation(async (_refno: string, options?: { onRecordPage?: PageListener }) => {
      // 真的按祖先读一页：这一页交给显示流程经查询选项带来的分页回调，它先去取这一页的网格
      await collectRecordsByAncestor(NODE, { onRecordPage: options?.onRecordPage }, recordsApi as never);
      return { success: true, refno: NODE, refnos: ['24381_1', '24381_2'] };
    });
    let report!: MeshProgress;
    let finishPrefetch!: () => void;
    prefetchMock.mockImplementation((
      _layer: unknown, _dbno: number, hashes: string[], _lod: string, _signal: AbortSignal, onProgress: MeshProgress,
    ) => {
      report = onProgress;
      onProgress(0, hashes.length);
      return new Promise<string[]>((resolve) => { finishPrefetch = () => resolve([]); });
    });
    let atLoad = '';
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
      atLoad = barLine();
      return loadedAll(refnos);
    });

    const shown = gen.showModelByRefno(NODE);
    await vi.waitFor(() => expect(bar().message).toBe('记录查询结束，正在取网格 0/4...'));
    expect(prefetchMock).toHaveBeenCalledWith(expect.anything(), 7997, ['h1', 'h2', 'h3', 'h4'], 'L1', expect.any(AbortSignal), expect.any(Function));
    expect(bar()).toMatchObject({ visible: true, progress: 30, stopKey: NODE });
    report(2, 4);
    expect(barLine()).toBe('50% 记录查询结束，正在取网格 2/4...');
    expect(loadInstancesMock).not.toHaveBeenCalled();
    report(4, 4);
    expect(barLine()).toBe('70% 记录查询结束，正在取网格 4/4...');

    finishPrefetch();
    expect(await shown).toBe(true);
    // 等网格那一段走到了 70：装载从 70 接着走，不退回 30
    expect(atLoad).toBe('70% 从 gen-model 加载 2 个 refno...');
  });

  it('记录查完时边取边画先到的一批还在装：状态条说在装先到的一批，不再是「查询记录 N/N」', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    let releaseFirstBatch!: () => void;
    loadInstancesMock.mockImplementationOnce((_layer: unknown, _dbno: number, refnos: string[]) => new Promise((resolve) => {
      releaseFirstBatch = () => resolve(loadedAll(refnos));
    }));
    visibleInstsMock.mockImplementation(async () => {
      emitRecordsProgress(NODE, '24381_100', 1, 2);
      // 第一个成员的记录到了：边取边画立刻开始装这一批
      emitMember(NODE, '24381_100', ['24381_1', '24381_2'], 1, 2);
      await tick();
      emitRecordsProgress(NODE, '24381_200', 2, 2);
      return { success: true, refno: NODE, refnos: ['24381_1', '24381_2', '24381_3'] };
    });

    const shown = gen.showModelByRefno(NODE);
    await vi.waitFor(() => expect(bar().message).toBe('记录查询结束，正在把先到的一批构件装入场景...'));
    expect(bar()).toMatchObject({ visible: true, progress: 30, stopKey: NODE });
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);

    releaseFirstBatch();
    expect(await shown).toBe(true);
    // 先到的一批装完，剩下的那一个由收尾装
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([['24381_1', '24381_2'], ['24381_3']]);
    expect(bar()).toMatchObject({ visible: false, message: '加载完成 (gen-model)' });
  });

  it('已有的显示出来之后问后端有没有还没生成的部分：这一会儿状态条说在核对，问完换回原来那一句', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    // 库文件比模型水位新：显示出来之后要问一次生成预检
    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_FILE_AHEAD);
    visibleInstsMock.mockResolvedValue({ success: true, refno: NODE, refnos: ['24381_1'] });
    let during = '';
    generationFactsMock.mockImplementation(async () => {
      during = `${bar().visible ? '开着' : '收起'} ${barLine()}`;
      return { unitsTotal: 3, unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20, exact: true };
    });

    expect(await gen.showModelByRefno(NODE)).toBe(true);

    expect(generationFactsMock).toHaveBeenCalledWith(NODE);
    expect(during).toBe('开着 100% 加载完成 (gen-model)；正在核对有没有还没生成的部分...');
    expect(gen.statusMessage.value).toBe('加载完成 (gen-model)');
    expect(bar()).toMatchObject({ visible: false, progress: 100, message: '加载完成 (gen-model)' });
  });

  it('整库显示：状态条上没有「停」；收尾装载只有一批时文案换成取网格、装入场景，百分比跟着走', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    collectDbnumMock.mockImplementation(async (dbnum: number) => ({
      dbnum, sites: [{ refno: '24381_101405', name: '/1PTU-INST23' }], refnos: ['24381_1', '24381_2'],
      generationRoots: ['24381_101410'], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [],
    }));
    const seen: string[] = [];
    loadInstancesMock.mockImplementation(async (
      _layer: unknown, _dbno: number, refnos: string[], options: { onMeshProgress?: MeshProgress },
    ) => {
      seen.push(`${bar().visible ? '开着' : '收起'} 停=${bar().stopKey} ${barLine()}`);
      options.onMeshProgress?.(2, 4);
      seen.push(barLine());
      options.onMeshProgress?.(4, 4);
      seen.push(barLine());
      return loadedAll(refnos);
    });

    const result = await gen.showModelByDbnum(7997);

    expect(result.loaded).toBe(true);
    expect(seen).toEqual([
      '开着 停=null 5% gen-model：查找 dbnum=7997 的 SITE...',
      '71% gen-model 整库 dbnum=7997：取网格 2/4...',
      '87% gen-model 整库 dbnum=7997：网格已取齐，正在装入场景...',
    ]);
    expect(bar()).toMatchObject({ visible: false, progress: 100, message: 'Model loaded (gen-model)' });
  });
});

describe('记录分页的网格预取跟着各自的查询走：别处同时在读记录时各取各的网格（#165）', () => {
  const FIRST = '24381_101410';
  type PrefetchCall = [layer: unknown, dbno: number, hashes: string[], lod: string, signal: AbortSignal, onProgress: unknown];
  const prefetchCalls = (): PrefetchCall[] => prefetchMock.mock.calls as PrefetchCall[];
  /** 一页记录：一个构件，用到这几个网格 */
  const pageOf = (...hashes: string[]) => [{ insts: hashes.map((geo_hash) => ({ geo_hash })) }];
  const collected = (refno: string) => ({
    refno, generationRoots: [refno], items: [{ refno }], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {},
  });

  afterEach(() => {
    // `vi.clearAllMocks()` 不清实现：接过真记录源的「叫停」换回缺省的桩
    v1Source.records.cancelCollect.mockImplementation(() => true);
  });

  /**
   * 接上真的记录源和树源，后面是个假后端：每个节点 `pages` 页、每页一条记录（构件 `<节点><页号>`，网格 `<节点>-g<页号>`）。
   * 每一发都停在闸上，`release(节点)` 放行一页；被取消的请求当场拒掉。
   */
  function wirePagedSources(pages: number) {
    __resetGenModelV1ServiceLifecycleForTests();
    const waiting: { root: string; open: () => void }[] = [];
    const records = vi.fn(async (req: { generationRoot?: string; cursor?: number }, requestOptions?: { signal?: AbortSignal }) => {
      const root = req.generationRoot!;
      const signal = requestOptions?.signal;
      await new Promise<void>((resolve) => {
        const entry = { root, open: resolve };
        waiting.push(entry);
        signal?.addEventListener('abort', () => {
          const index = waiting.indexOf(entry);
          if (index >= 0) waiting.splice(index, 1);
          resolve();
        }, { once: true });
      });
      if (signal?.aborted) throw signal.reason;
      const index = req.cursor ?? 0;
      return {
        source: 'model-database',
        items: [{
          refno: `${root}${index + 1}`, old_refno: null, owner: root, world_aabb: null,
          world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          insts: [{ geo_hash: `${root}-g${index + 1}` }], has_neg: false, generic: 'ELBO', pts: null, date: null,
        }],
        total: pages,
        truncated: index + 1 < pages,
        next_cursor: index + 1 < pages ? index + 1 : null,
      };
    });
    const recordSource = createGenModelV1ModelRecordSource({
      api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
    });
    const tree = createGenModelV1TreeSource({
      api: { roots: vi.fn(), children: vi.fn(), ancestors: vi.fn(), search: vi.fn() } as never,
      collectByAncestor: (refno, options) => recordSource.collectByAncestor(refno, options),
    });
    visibleInstsMock.mockImplementation((refno: string, options?: { onRecordPage?: PageListener }) => tree.visibleInsts(refno, options));
    v1Source.records.cancelCollect.mockImplementation((refno: string) => recordSource.cancelCollect(refno));
    /** 放行 `root` 等在闸上的那一页，并等它处理完 */
    const release = async (root: string): Promise<void> => {
      await vi.waitFor(() => expect(waiting.some((entry) => entry.root === root)).toBe(true));
      waiting.splice(waiting.findIndex((entry) => entry.root === root), 1)[0]!.open();
      await tick();
    };
    return { release, tree };
  }

  it.each<[string, number, number, string]>([
    ['两个库的节点', 7997, 8000, '9304_2'],
    ['同一个库的两个节点（同一份 useModelGeneration）', 7997, 7997, '24381_202020'],
  ])('连点%s（后点的排队，#166）：先点的读完、装完，后点的才开始读；各取各的网格（进自己的库、跟自己的会话），停掉后点的只中止它自己的', async (_label, firstDb, secondDb, SECOND) => {
    const { release } = wirePagedSources(2);
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const firstGen = useModelGeneration({ viewer, db_num: firstDb });
    const secondGen = secondDb === firstDb ? firstGen : useModelGeneration({ viewer, db_num: secondDb });

    const first = firstGen.showModelByRefno(FIRST);
    const second = secondGen.showModelByRefno(SECOND);
    await release(FIRST);
    await release(FIRST);
    expect(await first).toBe(true);
    // 先点的读完之前，后点的一页都没读：到这里取过的网格全是先点的那个节点的
    expect(prefetchCalls().map((call) => [call[1], call[2]])).toEqual([
      [firstDb, [`${FIRST}-g1`]],
      [firstDb, [`${FIRST}-g2`]],
    ]);
    const firstSignal = prefetchCalls()[0]![4];
    expect(prefetchCalls()[1]![4]).toBe(firstSignal);
    expect(loadInstancesMock.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [firstDb, [`${FIRST}1`, `${FIRST}2`]],
    ]);

    // 轮到后点的：它读到的页进它自己的库、跟它自己的会话
    await release(SECOND);
    expect(prefetchCalls().slice(2).map((call) => [call[1], call[2]])).toEqual([[secondDb, [`${SECOND}-g1`]]]);
    const secondSignal = prefetchCalls()[2]![4];
    expect(secondSignal).not.toBe(firstSignal);
    expect(secondSignal.aborted).toBe(false);

    // 停掉后点的那个：中止的是它自己的取消信号；先点的装好的不动
    expect(requestStopModelLoad(SECOND)).toBe(true);
    expect(await second).toBe(false);
    expect(secondSignal.aborted).toBe(true);
    expect(firstGen.isModelActuallyLoaded(FIRST)).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
  });

  it('节点在加载时别处也在读另一个节点的记录（不走显示排队的读者，带着自己的分页回调），两边的记录页交错着回来：这次显示只为自己读到的页取网格，别处读到的页只交给别处', async () => {
    const { release, tree } = wirePagedSources(2);
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const ELSEWHERE = '24381_202020';
    const elsewherePages: (string | null | undefined)[][] = [];

    const shown = gen.showModelByRefno(FIRST);
    const elsewhere = tree.visibleInsts(ELSEWHERE, {
      onRecordPage: (items) => { elsewherePages.push(items.flatMap((item) => (item.insts ?? []).map((inst) => inst.geo_hash))); },
    });
    // 页按「这次显示的、别处的、这次显示的、别处的」的顺序回来
    await release(FIRST);
    await release(ELSEWHERE);
    await release(FIRST);
    await release(ELSEWHERE);

    expect(await shown).toBe(true);
    expect(await elsewhere).toMatchObject({ success: true, refnos: [`${ELSEWHERE}1`, `${ELSEWHERE}2`] });
    expect(prefetchCalls().map((call) => [call[1], call[2]])).toEqual([
      [7997, [`${FIRST}-g1`]],
      [7997, [`${FIRST}-g2`]],
    ]);
    expect(elsewherePages).toEqual([[`${ELSEWHERE}-g1`], [`${ELSEWHERE}-g2`]]);
    expect(loadInstancesMock.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [7997, [`${FIRST}1`, `${FIRST}2`]],
    ]);
  });

  it('这次显示结束之后才到的记录页（和别处共用的那次读取还在翻）：不再引出取网格', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    let onPage: PageListener | undefined;
    visibleInstsMock.mockImplementation(async (_refno: string, options?: { onRecordPage?: PageListener }) => {
      onPage = options?.onRecordPage;
      onPage?.(pageOf('h1', 'h2', 'h1'));
      return { success: true, refno: FIRST, refnos: ['24381_1'] };
    });

    expect(await gen.showModelByRefno(FIRST)).toBe(true);
    // 一页里重复的网格只取一次
    expect(prefetchCalls().map((call) => [call[1], call[2]])).toEqual([[7997, ['h1', 'h2']]]);

    onPage!(pageOf('h3'));
    expect(prefetchMock).toHaveBeenCalledTimes(1);
  });

  it('被叫停之后才到的记录页：不再引出取网格', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    let onPage: PageListener | undefined;
    let answer!: (result: { success: boolean; refno: string; refnos: string[]; error_message?: string }) => void;
    visibleInstsMock.mockImplementation((_refno: string, options?: { onRecordPage?: PageListener }) => {
      onPage = options?.onRecordPage;
      return new Promise((resolve) => { answer = resolve; });
    });

    const shown = gen.showModelByRefno(FIRST);
    await vi.waitFor(() => expect(onPage).toBeTypeOf('function'));
    onPage!(pageOf('h1'));
    expect(prefetchMock).toHaveBeenCalledTimes(1);

    expect(requestStopModelLoad(FIRST)).toBe(true);
    // 响应赶在叫停之前到、叫停之后才轮到处理的那一页
    onPage!(pageOf('h2'));
    expect(prefetchMock).toHaveBeenCalledTimes(1);
    answer({ success: false, refno: FIRST, refnos: [], error_message: 'cancelled: gen-model 读取已被调用方取消' });
    expect(await shown).toBe(false);
    expect(prefetchMock).toHaveBeenCalledTimes(1);
  });

  it('按块补齐之后回查到的记录页、补齐后重查读到的记录页：都交给这次显示自己的回调，照样先取网格', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    typeInfoMock.mockResolvedValue({ success: true, refno: FIRST, noun: 'BRAN', owner_refno: null, owner_noun: null });
    // 第一次范围查询查空：触发补齐
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: FIRST, refnos: [] });
    v1Source.records.generateThenCollect.mockImplementationOnce((async (refno: string, options?: { onRecordPage?: PageListener }) => {
      options?.onRecordPage?.(pageOf('fill-h1'));
      return collected(refno);
    }) as never);
    // 补齐之后重查
    visibleInstsMock.mockImplementationOnce(async (_refno: string, options?: { onRecordPage?: PageListener }) => {
      options?.onRecordPage?.(pageOf('requery-h1', 'requery-h2'));
      return { success: true, refno: FIRST, refnos: ['24381_1'] };
    });

    expect(await gen.showModelByRefno(FIRST)).toBe(true);

    expect(prefetchCalls().map((call) => [call[1], call[2]])).toEqual([
      [7997, ['fill-h1']],
      [7997, ['requery-h1', 'requery-h2']],
    ]);
    expect(prefetchCalls()[1]![4]).toBe(prefetchCalls()[0]![4]);
  });

  it('右键重新生成之后回查到的记录页：也交给这次显示自己的回调', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    viewer.__dtxLayer.hasObject = vi.fn(() => true);
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    v1Source.records.generateThenCollect.mockImplementationOnce((async (refno: string, options?: { onRecordPage?: PageListener }) => {
      options?.onRecordPage?.(pageOf('regen-h1'));
      return collected(refno);
    }) as never);
    visibleInstsMock.mockResolvedValue({ success: true, refno: FIRST, refnos: ['24381_1'] });

    expect(await gen.showModelByRefno(FIRST, { regenerate: true })).toBe(true);

    expect(prefetchCalls().map((call) => [call[1], call[2]])).toEqual([[7997, ['regen-h1']]]);
  });

  it('查看器没有 DTX 层（没处放网格）：范围查询不带分页回调，也不预取', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    delete viewer.__dtxLayer;
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    visibleInstsMock.mockResolvedValue({ success: true, refno: FIRST, refnos: ['24381_1'] });

    await gen.showModelByRefno(FIRST);

    expect(visibleInstsMock.mock.calls[0]).toEqual([FIRST]);
    expect(prefetchMock).not.toHaveBeenCalled();
  });
});

describe('连续点亮几个节点：按点击的先后排队，一个一个加载；排队中的能直接取消，在跑的停了自动轮到下一个（#166）', () => {
  const A = '24381_101410';
  const B = '24381_202020';
  const C = '24381_303030';
  type ScopeAnswer = { success: boolean; refno: string; refnos: string[]; error_message?: string };

  /** 查看器左下角状态条此刻的内容（全页面一份，这里用的是真的） */
  const bar = () => useModelLoadStatus().state.value;
  /** 每个节点自己的两个构件 */
  const partsOf = (root: string) => [`${root}1`, `${root}2`];
  /** 生成请求照常做完：这个节点自己就是一个生成根 */
  const collected = (refno: string) => ({
    refno, generationRoots: [refno], items: [{ refno }], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {},
  });
  /** 模型树行尾此刻的样子：`排队` / `加载`（这两种都能点停）/ `不能停` / `正在停` / `-`（没有在加载） */
  const rowState = (root: string): string => {
    const view = modelLoadSessionView(root);
    if (!view) return '-';
    if (view.stopping) return '正在停';
    if (!view.stoppable) return '不能停';
    return view.queued ? '排队' : '加载';
  };

  /** 范围查询都先挂着，由用例决定什么时候回、回什么 */
  function holdQueries() {
    const pending = new Map<string, (result: ScopeAnswer) => void>();
    visibleInstsMock.mockImplementation((refno: string) => new Promise<ScopeAnswer>((resolve) => { pending.set(refno, resolve); }));
    /** 等 `root` 的查询发出来 */
    const asked = (root: string) => vi.waitFor(() => expect(pending.has(root)).toBe(true));
    const take = (root: string) => {
      const resolve = pending.get(root)!;
      pending.delete(root);
      return resolve;
    };
    return {
      asked,
      /** 发出过范围查询的节点，按发出的先后 */
      order: () => visibleInstsMock.mock.calls.map((call) => call[0] as string),
      /** 等 `root` 的查询发出来，让它查到自己的构件 */
      answer: async (root: string) => {
        await asked(root);
        take(root)({ success: true, refno: root, refnos: partsOf(root) });
      },
      /** 记录读取被取消了（叫停之后记录源回的那一句） */
      cancel: (root: string) => {
        take(root)({ success: false, refno: root, refnos: [], error_message: 'cancelled: gen-model 读取已被调用方取消' });
      },
    };
  }

  beforeEach(() => {
    // 收回去的时候装载器说这些构件确实拿掉了
    evictMock.mockImplementation((_layer: unknown, _dbno: number, refnos: string[]) => [...refnos]);
  });

  it('连点三个节点：点下去当场都进加载会话（行尾就是能点的「停」）；同一时刻只有一个在查、在装，前一个做完下一个才开始，按点击的先后来；状态条跟着换人', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const queries = holdQueries();
    const finished: string[] = [];
    const show = (root: string) => gen.showModelByRefno(root).then((ok) => {
      finished.push(root);
      return ok;
    });

    const shows = [show(A), show(B), show(C)];
    // 点下去的这一刻（还没让出过一拍）：三个都在会话里，后两个在排队
    expect([A, B, C].map(rowState)).toEqual(['加载', '排队', '排队']);

    await queries.asked(A);
    await tick();
    // 只有第一个在查；状态条是它的，「停」认它
    expect(queries.order()).toEqual([A]);
    expect(bar()).toMatchObject({ visible: true, currentRefno: A, stopKey: A });
    expect(gen.isGenerating.value).toBe(true);

    await queries.answer(A);
    await queries.asked(B);
    // 第一个装完了第二个才开始查；第三个还在排
    expect(finished).toEqual([A]);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([partsOf(A)]);
    expect(queries.order()).toEqual([A, B]);
    expect([A, B, C].map(rowState)).toEqual(['-', '加载', '排队']);
    expect(bar()).toMatchObject({ visible: true, currentRefno: B, stopKey: B });

    await queries.answer(B);
    await queries.answer(C);
    expect(await Promise.all(shows)).toEqual([true, true, true]);
    expect(finished).toEqual([A, B, C]);
    expect(queries.order()).toEqual([A, B, C]);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([partsOf(A), partsOf(B), partsOf(C)]);
    expect([A, B, C].map((root) => gen.isModelActuallyLoaded(root))).toEqual([true, true, true]);
    expect([A, B, C].map(rowState)).toEqual(['-', '-', '-']);
    expect(bar()).toMatchObject({ visible: false, stopKey: null });
    expect(gen.isGenerating.value).toBe(false);
  });

  it('连点三个节点，中间那个还没有模型、要先生成（混着已生成和未生成的）：严格一个接一个——前一个的查询、生成、装载都做完，后一个才开始', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const steps: string[] = [];
    // B 是一个还没有模型的生成单元：第一次查空，生成之后再查才有
    typeInfoMock.mockImplementation(async (refno: string) => (
      refno === B ? { success: true, refno, noun: 'BRAN', owner_refno: null, owner_noun: null } : { success: true, refno, noun: 'ZONE' }
    ));
    let hasModel = false;
    visibleInstsMock.mockImplementation(async (refno: string) => {
      steps.push(`查 ${refno}`);
      // 每一步都让出一拍：要是几个节点同时在走，这里记下的先后会交错
      await tick();
      return { success: true, refno, refnos: refno === B && !hasModel ? [] : partsOf(refno) };
    });
    v1Source.records.generateThenCollect.mockImplementationOnce((async (refno: string) => {
      steps.push(`生成 ${refno}`);
      await tick();
      hasModel = true;
      return collected(refno);
    }) as never);
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
      steps.push(`装 ${refnos.join(' ')}`);
      await tick();
      return loadedAll(refnos);
    });

    const results = await Promise.all([A, B, C].map((root) => gen.showModelByRefno(root)));

    expect(results).toEqual([true, true, true]);
    expect(steps).toEqual([
      `查 ${A}`, `装 ${partsOf(A).join(' ')}`,
      // 生成单元自己的键也一起装（它名下可能挂着隐含管子）
      `查 ${B}`, `生成 ${B}`, `查 ${B}`, `装 ${[B, ...partsOf(B)].join(' ')}`,
      `查 ${C}`, `装 ${partsOf(C).join(' ')}`,
    ]);
    expect([A, B, C].map((root) => gen.isModelActuallyLoaded(root))).toEqual([true, true, true]);
  });

  it('排队中的节点点行尾的「停」：当场从队里拿掉、回到没显示，不用等前面的；在跑的那个照常做完，后面的照常轮到，被拿掉的那个始终没有开始', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const queries = holdQueries();
    const first = gen.showModelByRefno(A);
    const second = gen.showModelByRefno(B);
    const third = gen.showModelByRefno(C);
    await queries.asked(A);

    expect(requestStopModelLoad(B)).toBe(true);
    // 不用等在跑的那个：这就回来了
    expect(await second).toBe(false);
    expect([A, B, C].map(rowState)).toEqual(['加载', '-', '排队']);
    // 发起显示的一方问得到「这次显示收回去了」：不把节点同步成可见
    expect(consumeModelLoadStopped(B)).toBe(true);
    expect(gen.isModelActuallyLoaded(B)).toBe(false);
    // 还没开始就拿掉的：没有东西要收，不弹「已停止加载」，只在控制台留一句
    expect(emitToastMock).not.toHaveBeenCalled();
    expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining(`refno=${B} 排队时被叫停`));
    // 在跑的那个没受影响：状态条还是它的，它的记录读取没有被取消
    expect(bar()).toMatchObject({ visible: true, currentRefno: A, stopKey: A });
    expect(v1Source.records.cancelCollect).not.toHaveBeenCalled();

    await queries.answer(A);
    expect(await first).toBe(true);
    await queries.answer(C);
    expect(await third).toBe(true);
    // 被拿掉的那个始终没有开始：没查过、没装过，也没有东西被收回去
    expect(queries.order()).toEqual([A, C]);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([partsOf(A), partsOf(C)]);
    expect(evictMock).not.toHaveBeenCalled();
    expect(bar()).toMatchObject({ visible: false, stopKey: null });
  });

  it('从队里拿掉之后再点一次：重新排到队尾，轮到了照常加载；上一次留下的「收回去了」不会算到这一次头上', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const queries = holdQueries();
    const first = gen.showModelByRefno(A);
    const second = gen.showModelByRefno(B);
    const third = gen.showModelByRefno(C);
    await queries.asked(A);
    expect(requestStopModelLoad(B)).toBe(true);
    expect(await second).toBe(false);
    // 这一位发起方没有来问（有的入口从来不问）：那一笔留着

    const secondAgain = gen.showModelByRefno(B);
    expect([A, B, C].map(rowState)).toEqual(['加载', '排队', '排队']);
    await queries.answer(A);
    await queries.answer(C);
    await queries.answer(B);
    expect(await Promise.all([first, third, secondAgain])).toEqual([true, true, true]);
    // 重新点的那一次排在了第三个后面
    expect(queries.order()).toEqual([A, C, B]);
    expect(gen.isModelActuallyLoaded(B)).toBe(true);
    expect(consumeModelLoadStopped(B)).toBe(false);
  });

  it('在跑的节点读记录时被叫停：它把这一次画出来的收回去、结束会话，排在后面的自动开始，不用再点；状态条换成下一个', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    const queries = holdQueries();
    const first = gen.showModelByRefno(A);
    const second = gen.showModelByRefno(B);
    await queries.asked(A);
    // 第一个成员的记录到了、已经画出来（边取边画）；这时候点了停
    emitMember(A, '24381_100', partsOf(A), 1, 3);
    await tick();
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([partsOf(A)]);

    expect(requestStopModelLoad(A)).toBe(true);
    expect(v1Source.records.cancelCollect).toHaveBeenCalledWith(A);
    queries.cancel(A);
    expect(await first).toBe(false);
    // 这一次画出来的那一批收回去了，节点不算已加载；发起显示的一方问得到
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 7997, partsOf(A), { release: true });
    expect(gen.isModelActuallyLoaded(A)).toBe(false);
    expect(consumeModelLoadStopped(A)).toBe(true);
    // 状态条没有收：已经换成排在后面的那个
    expect(bar()).toMatchObject({ visible: true, stopKey: B });

    await queries.asked(B);
    expect([A, B].map(rowState)).toEqual(['-', '加载']);
    expect(bar()).toMatchObject({ visible: true, currentRefno: B, stopKey: B });
    await queries.answer(B);
    expect(await second).toBe(true);
    expect(gen.isModelActuallyLoaded(B)).toBe(true);
    expect(consumeModelLoadStopped(B)).toBe(false);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([partsOf(A), partsOf(B)]);
    expect(evictMock).toHaveBeenCalledTimes(1);
  });

  it('同一个节点还在排队 / 在跑时又触发普通显示（同一份 useModelGeneration）：搭上已有的那一次，不重复入队、不另起一条；几位发起方都拿到结果', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const queries = holdQueries();
    const ahead = gen.showModelByRefno(A);
    // B 在排队时又点了一次
    const whileQueued = [gen.showModelByRefno(B), gen.showModelByRefno(B)];
    await queries.answer(A);
    expect(await ahead).toBe(true);
    // 轮到它、在跑的时候再点一次
    await queries.asked(B);
    const whileRunning = gen.showModelByRefno(B);
    await tick();
    expect(queries.order()).toEqual([A, B]);

    await queries.answer(B);
    expect(await Promise.all([...whileQueued, whileRunning])).toEqual([true, true, true]);
    // 从头到尾只查了一次、装了一次
    expect(queries.order()).toEqual([A, B]);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([partsOf(A), partsOf(B)]);
    expect(rowState(B)).toBe('-');
    expect(bar()).toMatchObject({ visible: false, stopKey: null });
  });

  it.each<[string, boolean]>([
    ['在跑的时候', true],
    ['还在排队的时候', false],
  ])('搭在同一次显示上的两位发起方，这一次%s被叫停：两边都回 false，各自都问得到一次「这次显示收回去了」', async (_label, running) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const queries = holdQueries();
    const ahead = running ? null : gen.showModelByRefno(A);
    const callers = [gen.showModelByRefno(B), gen.showModelByRefno(B)];
    await queries.asked(running ? B : A);
    expect(rowState(B)).toBe(running ? '加载' : '排队');

    expect(requestStopModelLoad(B)).toBe(true);
    if (running) queries.cancel(B);
    expect(await Promise.all(callers)).toEqual([false, false]);
    expect(rowState(B)).toBe('-');
    expect(consumeModelLoadStopped(B)).toBe(true);
    expect(consumeModelLoadStopped(B)).toBe(true);
    expect(consumeModelLoadStopped(B)).toBe(false);

    if (ahead) {
      await queries.answer(A);
      expect(await ahead).toBe(true);
    }
    expect(queries.order()).toEqual([running ? B : A]);
  });

  it.each<[string, boolean]>([
    ['先点的那一下也要飞', true],
    ['先点的那一下不飞', false],
  ])('搭上已有那一次的这一下要飞相机 · %s：装完照样飞一次，按后点的这一下算（先点那一下的相机意图已经被它顶掉）', async (_label, firstFlies) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 7997 });
    const queries = holdQueries();
    const once = gen.showModelByRefno(A, { flyTo: firstFlies });
    await queries.asked(A);
    const again = gen.showModelByRefno(A, { flyTo: true });
    await queries.answer(A);

    expect(await Promise.all([once, again])).toEqual([true, true]);
    expect(queries.order()).toEqual([A]);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledTimes(1);
    expect(viewer.scene.getAABB.mock.calls.at(-1)![0]).toEqual(partsOf(A));
  });

  it('同一个节点的普通显示在排队时又来了一次「生成」（显式补齐，不搭车）：各排各的；行尾点停，两次一起从队里拿掉', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const queries = holdQueries();
    const ahead = gen.showModelByRefno(A);
    const plain = gen.showModelByRefno(B);
    const fill = gen.showModelByRefno(B, { fill: true });
    await queries.asked(A);
    expect(rowState(B)).toBe('排队');

    expect(requestStopModelLoad(B)).toBe(true);
    expect(await Promise.all([plain, fill])).toEqual([false, false]);
    expect(rowState(B)).toBe('-');
    // 两位发起方各问得到一次
    expect(consumeModelLoadStopped(B)).toBe(true);
    expect(consumeModelLoadStopped(B)).toBe(true);
    expect(consumeModelLoadStopped(B)).toBe(false);

    await queries.answer(A);
    expect(await ahead).toBe(true);
    await tick();
    expect(queries.order()).toEqual([A]);
  });

  it('普通显示在跑时又来了同一个节点的重新生成：不搭那一次（要做的不是一回事），排在它后面；显示做完才轮到，生成请求这时才发', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const queries = holdQueries();
    v1Source.records.generateThenCollect.mockImplementationOnce((async (refno: string) => collected(refno)) as never);

    const plain = gen.showModelByRefno(A);
    await queries.asked(A);
    const regenerate = gen.showModelByRefno(A, { regenerate: true });
    await tick();
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();

    await queries.answer(A);
    expect(await plain).toBe(true);
    // 轮到重新生成：生成请求这时才发，之后照常重查、重装
    await queries.answer(A);
    expect(await regenerate).toBe(true);
    expect(v1Source.records.generateThenCollect.mock.calls).toEqual([[A, REGENERATE_REQUEST]]);
    expect(queries.order()).toEqual([A, A]);
  });

  it('重新生成在跑时又点了同一个节点的普通显示：不搭重新生成那一次，排在它后面；它做完之后轮到，自己照常显示一遍', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const queries = holdQueries();
    v1Source.records.generateThenCollect.mockImplementationOnce((async (refno: string) => collected(refno)) as never);

    const regenerate = gen.showModelByRefno(A, { regenerate: true });
    await queries.asked(A);
    const plain = gen.showModelByRefno(A);
    await tick();
    expect(queries.order()).toEqual([A]);

    await queries.answer(A);
    expect(await regenerate).toBe(true);
    await queries.answer(A);
    expect(await plain).toBe(true);
    expect(queries.order()).toEqual([A, A]);
    expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
  });

  it('两份 useModelGeneration 先后显示同一个节点：不搭车（各记各的「已加载」），后点的排队，先点的做完它才开始，不会两路同时装同一批构件', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const treeSide = useModelGeneration({ viewer, db_num: 7997 });
    const viewerSide = useModelGeneration({ viewer, db_num: 7997 });
    const queries = holdQueries();
    const first = treeSide.showModelByRefno(A);
    const second = viewerSide.showModelByRefno(A);
    await queries.asked(A);
    await tick();
    // 行上不算排队（先点的那一路在跑）；查询只发了一次
    expect(rowState(A)).toBe('加载');
    expect(queries.order()).toEqual([A]);

    await queries.answer(A);
    expect(await first).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalledTimes(1);
    await queries.answer(A);
    expect(await second).toBe(true);
    expect(queries.order()).toEqual([A, A]);
    expect([treeSide, viewerSide].map((gen) => gen.isModelActuallyLoaded(A))).toEqual([true, true]);
  });

  it('重新生成也排队：排队时能停——什么都还没发给后端，停了就是什么都没做；轮到之后照旧不能停', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const queries = holdQueries();
    let finishGenerate!: () => void;
    v1Source.records.generateThenCollect.mockImplementationOnce(((refno: string) => new Promise((resolve) => {
      finishGenerate = () => resolve(collected(refno));
    })) as never);

    const ahead = gen.showModelByRefno(A);
    const stoppedInQueue = gen.showModelByRefno(B, { regenerate: true });
    const reachesItsTurn = gen.showModelByRefno(C, { regenerate: true });
    expect([A, B, C].map(rowState)).toEqual(['加载', '排队', '排队']);

    expect(requestStopModelLoad(B)).toBe(true);
    expect(await stoppedInQueue).toBe(false);
    expect(consumeModelLoadStopped(B)).toBe(true);
    expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();

    await queries.answer(A);
    expect(await ahead).toBe(true);
    // 轮到 C 的重新生成：请求发出去了，从轮到的那一刻起不能停
    await vi.waitFor(() => expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1));
    expect(v1Source.records.generateThenCollect.mock.calls[0]).toEqual([C, REGENERATE_REQUEST]);
    expect(rowState(C)).toBe('不能停');
    expect(requestStopModelLoad(C)).toBe(false);

    finishGenerate();
    await queries.answer(C);
    expect(await reachesItsTurn).toBe(true);
    // 被停掉的那个始终没有发过生成，也没有查过
    expect(v1Source.records.generateThenCollect.mock.calls.map((call) => call[0])).toEqual([C]);
    expect(queries.order()).not.toContain(B);
  });

  it('在跑的那个出错收场（装载器抛错）：这一轮照样交出去，排在后面的不会被卡住', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    visibleInstsMock.mockImplementation(async (refno: string) => ({ success: true, refno, refnos: partsOf(refno) }));
    loadInstancesMock.mockImplementation(async (_layer: unknown, _dbno: number, refnos: string[]) => {
      if (refnos[0] === partsOf(A)[0]) throw new Error('装载器出错了');
      return loadedAll(refnos);
    });

    const first = gen.showModelByRefno(A);
    const second = gen.showModelByRefno(B);

    expect(await first).toBe(false);
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', message: expect.stringContaining('装载器出错了') }));
    expect(await second).toBe(true);
    expect(loadInstancesMock.mock.calls.map((call) => call[2])).toEqual([partsOf(A), partsOf(B)]);
    expect([A, B].map(rowState)).toEqual(['-', '-']);
    expect(bar()).toMatchObject({ visible: false, stopKey: null });
    expect(gen.isGenerating.value).toBe(false);
  });
});

describe('「取最新」用到的显示流程出口（2026-11-12）', () => {
  const ROOT = '24384_24778';
  const MEMBERS = ['24384_24779', '24384_24780'];

  beforeEach(async () => {
    visibleInstsMock.mockReset();
    v1Source.tree.subtreeRefnos.mockReset();
    v1Source.records.invalidateRoot.mockReset();
    v1Source.records.invalidateRoot.mockReturnValue([]);
    unitRefnosMock.mockReset();
    unitRefnosMock.mockReturnValue([]);
    typeInfoMock.mockResolvedValue({ success: true, refno: ROOT, noun: 'EQUI', owner_refno: null, owner_noun: null });
    (await import('./modelGetWorkRegistry')).resetGetWorkRegistry();
  });

  /** 先正常装一个节点（两个成员），再让下一次按祖先查记录「查空且收齐」 */
  async function loadedThenEmpty() {
    const { useModelGeneration } = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer, db_num: 8000 });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });
    expect(await gen.showModelByRefno(ROOT)).toBe(true);
    loadInstancesMock.mockClear();
    emitToastMock.mockClear();
    forgetLoadedNodeMock.mockClear();
    evictMock.mockImplementation((_layer, _dbno, refnos) => [...refnos]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [] });
    return { gen, viewer };
  }

  describe('重载查空的护栏：记录查空不等于已删除（所有的重载都过这一道）', () => {
    it.each([
      ['not_generated', '后端现在没有这个节点的完整模型（可能重启过，或还没生成）'],
      ['partial', '后端现在没有这个节点的完整模型（可能重启过，或还没生成）'],
      ['unknown', '后端判不了这个节点的模型状态'],
      ['updating', '所在的库正在更新'],
    ])(
      '后端说这个节点 %s（比如重启后按需生成的模型没了）：不撤、不算已删除，场景保持原样，并照实说',
      async (verdict, why) => {
        const { gen } = await loadedThenEmpty();
        nodeFactsMock.mockResolvedValue({ verdict });

        expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);

        expect(nodeFactsMock).toHaveBeenCalledWith(expect.objectContaining({ refno: ROOT }));
        expect(evictMock).not.toHaveBeenCalled();
        expect(forgetLoadedNodeMock).not.toHaveBeenCalled();
        expect(gen.isModelActuallyLoaded(ROOT)).toBe(true);
        expect(gen.loadedRefnosOf(ROOT)).toEqual(MEMBERS);
        expect(gen.statusMessage.value).toContain('没有当成已删除');
        expect(v1Source.records.generateThenCollect).not.toHaveBeenCalled();
        // 给人的只有一句：没当成已删除、为什么。没出「已从场景撤下」那句
        expect(emitToastMock).toHaveBeenCalledTimes(1);
        expect(emitToastMock).toHaveBeenCalledWith({
          message: `[警告] ${ROOT} 重载未完成：记录查空，但${why}——没有当成已删除，场景保持原样`,
          level: 'warning',
        });
        expect(addLogMock).toHaveBeenCalledWith('warning', `[model-load] 重载 ${ROOT}：记录查空，但${why}——不当成已删除，场景保持原样`);
        // 行上的状态重问一次（它多半还是重启之前问到的）
        expect(recheckLoadedNodeMock).toHaveBeenCalledWith(ROOT);
      },
    );

    it('取最新发起的（quiet）：同样不撤，但不弹那一句（它自己汇总）', async () => {
      const { gen } = await loadedThenEmpty();
      nodeFactsMock.mockResolvedValue({ verdict: 'not_generated' });

      expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false, quiet: true })).toBe(false);

      expect(evictMock).not.toHaveBeenCalled();
      expect(emitToastMock).not.toHaveBeenCalled();
      expect(addLogMock).toHaveBeenCalledWith('warning', expect.stringContaining('不当成已删除'));
    });

    it('这一问没问到（库文件打不开、超时）：保持原样，原因照实说', async () => {
      const { gen } = await loadedThenEmpty();
      nodeFactsMock.mockRejectedValue(Object.assign(new Error('库文件打不开'), { code: 'SOURCE_NOT_FOUND' }));

      expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);

      expect(evictMock).not.toHaveBeenCalled();
      expect(gen.isModelActuallyLoaded(ROOT)).toBe(true);
      expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('节点模型状态没问到（库文件打不开）——没有当成已删除') }));
      // 没有因此去问模型树（那是服务端没有这个接口时的过渡办法）
      expect(treeAncestorsMock).not.toHaveBeenCalled();
    });

    describe('服务端没有节点模型状态接口（旧构建回 null）：只认「库里已经没有这个节点」，问模型树', () => {
      it('树说库文件最新会话上没有这个节点：撤下', async () => {
        const { gen, viewer } = await loadedThenEmpty();
        nodeFactsMock.mockResolvedValue(null);
        treeAncestorsMock.mockResolvedValue({ success: false, refnos: [], error_message: 'not_found (404): dbnum 8000 会话 Some(1155) 的索引里没有 24384/24778' });

        expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(true);

        expect(treeAncestorsMock).toHaveBeenCalledWith(ROOT);
        expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [ROOT, ...MEMBERS], { release: true });
        expect(gen.isModelActuallyLoaded(ROOT)).toBe(false);
      });

      it('树说这个节点还在（分不清是成员删光了还是后端没有它的模型）：保持原样', async () => {
        const { gen } = await loadedThenEmpty();
        nodeFactsMock.mockResolvedValue(null);
        treeAncestorsMock.mockResolvedValue({ success: true, refnos: ['24384_24777'] });

        expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);

        expect(evictMock).not.toHaveBeenCalled();
        expect(gen.isModelActuallyLoaded(ROOT)).toBe(true);
        expect(emitToastMock).toHaveBeenCalledWith({
          message: `[警告] ${ROOT} 重载未完成：记录查空，但后端没有节点模型状态接口，确认不了它名下是不是真的没有几何了——没有当成已删除，场景保持原样`,
          level: 'warning',
        });
      });

      it.each([
        ['树回了别的失败（不是「没有这个节点」）', async () => ({ success: false, refnos: [], error_message: 'server (500): 后端出错' })],
        ['树回了失败、没说原因', async () => ({ success: false, refnos: [] })],
        ['树也没问到', async () => { throw new Error('network: 断了'); }],
      ])('%s：保持原样', async (_name, answer) => {
        const { gen } = await loadedThenEmpty();
        nodeFactsMock.mockResolvedValue(null);
        treeAncestorsMock.mockImplementation(answer);

        expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);

        expect(evictMock).not.toHaveBeenCalled();
        expect(gen.isModelActuallyLoaded(ROOT)).toBe(true);
      });

      it('取最新发起的（quiet）、树说没有这个节点：照样撤下，不弹「已从场景撤下」', async () => {
        const { gen, viewer } = await loadedThenEmpty();
        nodeFactsMock.mockResolvedValue(null);
        treeAncestorsMock.mockResolvedValue({ success: false, refnos: [], error_message: 'not_found (404): dbnum 8000 会话 Some(1698) 的索引里没有 24384/24778' });

        expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false, quiet: true })).toBe(true);

        expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [ROOT, ...MEMBERS], { release: true });
        expect(gen.isModelActuallyLoaded(ROOT)).toBe(false);
        expect(forgetLoadedNodeMock).toHaveBeenCalledWith(ROOT);
        expect(emitToastMock).not.toHaveBeenCalled();
      });

      it('问模型树的这一会儿被叫停：还没开始撤，场景保持原样', async () => {
        const { gen } = await loadedThenEmpty();
        nodeFactsMock.mockResolvedValue(null);
        treeAncestorsMock.mockImplementation(async () => {
          requestStopModelLoad(ROOT);
          return { success: false, refnos: [], error_message: 'not_found (404): 索引里没有 24384/24778' };
        });

        expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);

        expect(evictMock).not.toHaveBeenCalled();
        expect(forgetLoadedNodeMock).not.toHaveBeenCalled();
        expect(gen.isModelActuallyLoaded(ROOT)).toBe(true);
        expect(gen.statusMessage.value).toBe('已停止重载，场景保持原样');
      });
    });

    it.each([
      ['unknown', '后端判不了这个节点的模型状态'],
      ['updating', '所在的库正在更新'],
    ])('取最新发起的（quiet）、后端说 %s：不弹，但原因照实记进控制台（「%s」）', async (verdict, why) => {
      const { gen } = await loadedThenEmpty();
      nodeFactsMock.mockResolvedValue({ verdict });

      expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false, quiet: true })).toBe(false);

      expect(evictMock).not.toHaveBeenCalled();
      expect(emitToastMock).not.toHaveBeenCalled();
      expect(addLogMock).toHaveBeenCalledWith('warning', `[model-load] 重载 ${ROOT}：记录查空，但${why}——不当成已删除，场景保持原样`);
      expect(gen.isModelActuallyLoaded(ROOT)).toBe(true);
    });

    it.each(['latest', 'lagging', 'empty'])('后端说这个节点 %s（单元都生成过 / 没有生成单元）：它名下确实没有几何了，撤下', async (verdict) => {
      const { gen, viewer } = await loadedThenEmpty();
      nodeFactsMock.mockResolvedValue({ verdict });

      expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(true);

      expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [ROOT, ...MEMBERS], { release: true });
      expect(gen.isModelActuallyLoaded(ROOT)).toBe(false);
      expect(gen.loadedRefnosOf(ROOT)).toBeNull();
      expect(forgetLoadedNodeMock).toHaveBeenCalledWith(ROOT);
    });

    it('后端说库里没有这个节点（REFNO_NOT_FOUND）：撤下', async () => {
      const { gen } = await loadedThenEmpty();
      nodeFactsMock.mockRejectedValue(Object.assign(new Error('最新会话的索引里没有它'), { code: 'REFNO_NOT_FOUND' }));
      expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(true);
      expect(evictMock).toHaveBeenCalledTimes(1);
      expect(gen.isModelActuallyLoaded(ROOT)).toBe(false);
    });

    it('状态栏、行上的「重载」和重新部署后的重装（只带 refresh，不带别的）：一样先问，后端没有它的模型就不撤', async () => {
      const { gen } = await loadedThenEmpty();
      nodeFactsMock.mockResolvedValue({ verdict: 'not_generated' });
      // 模型树行上的「重载」带的是 { flyTo: false, refresh: true }；状态栏的重载、重新部署后的重装经查看器的事件带 { refresh: true }
      expect(await gen.showModelByRefno(ROOT, { refresh: true })).toBe(false);
      expect(nodeFactsMock).toHaveBeenCalledTimes(1);
      expect(evictMock).not.toHaveBeenCalled();
      expect(gen.isModelActuallyLoaded(ROOT)).toBe(true);
    });

    it('节点更新的后一半（重载）查空：同样先问，后端没有它的完整模型就不撤', async () => {
      const { gen } = await loadedThenEmpty();
      // 动手之前问的那一次说「落后、没有单元被删」→ 不带 force 重新生成；生成之后查记录是空的，再问一次：只有一部分
      nodeFactsMock
        .mockResolvedValueOnce({
          dbnum: 8000, refno: ROOT, noun: 'EQUI', verdict: 'lagging', verdictReason: 'own_generation_stale',
          units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 1, exact: true },
          precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
          generatedAt: { sesnoMin: 1, sesnoMax: 1, timeMin: null, basis: 'own_generation' },
          changes: { sinceSesno: 1, toSesno: 2, unitsChanged: 1, unitsAdded: 0, unitsRemoved: 0 },
          library: { fileLatestSesno: 2, appliedSesno: 0, modelSesno: 0, initialized: false, inWatchScope: false },
        })
        .mockResolvedValueOnce({ verdict: 'partial' });

      expect(await gen.showModelByRefno(ROOT, { update: true, flyTo: false })).toBe(false);

      expect(v1Source.records.generateThenCollect).toHaveBeenCalledTimes(1);
      expect(nodeFactsMock).toHaveBeenCalledTimes(2);
      expect(evictMock).not.toHaveBeenCalled();
      expect(gen.isModelActuallyLoaded(ROOT)).toBe(true);
    });

    it('确认的这一会儿被叫停：还没开始撤，场景保持原样', async () => {
      const { gen } = await loadedThenEmpty();
      nodeFactsMock.mockImplementation(async () => {
        requestStopModelLoad(ROOT);
        return { verdict: 'latest' };
      });

      expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);

      expect(evictMock).not.toHaveBeenCalled();
      expect(forgetLoadedNodeMock).not.toHaveBeenCalled();
      expect(gen.isModelActuallyLoaded(ROOT)).toBe(true);
      expect(gen.statusMessage.value).toBe('已停止重载，场景保持原样');
    });

    it('记录没收齐（409 在生成）时本来就不撤：不为它白问一次节点模型状态', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
      visibleInstsMock.mockResolvedValueOnce({
        success: true, refno: ROOT, refnos: [], incomplete: { pending: [ROOT], truncated_roots: [], errors: {} },
      });
      expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);
      expect(nodeFactsMock).not.toHaveBeenCalled();
      expect(evictMock).not.toHaveBeenCalled();
    });

    it('查到了记录（没查空）：护栏不介入，照常整套替换', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });
      expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(true);
      expect(nodeFactsMock).not.toHaveBeenCalled();
      expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 8000, MEMBERS, expect.objectContaining({ replaceExistingObjects: true }));
    });
  });

  describe('withdrawRemovedRoot：库里已经没有这个节点了', () => {
    it('它和它名下的构件（上次装的、记录缓存里的、场景索引认得的）从场景撤下、撤表；不发请求、不出提示', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });
      expect(await gen.showModelByRefno(ROOT)).toBe(true);
      emitToastMock.mockClear();
      visibleInstsMock.mockClear();
      v1Source.records.invalidateRoot.mockReturnValueOnce([ROOT, '24384_24781']);
      unitRefnosMock.mockReturnValueOnce(['24384_24779', '24384_24782']);
      // 四个构件里三个有对象
      evictMock.mockImplementationOnce((_layer, _dbno, refnos) => refnos.slice(1, 4));

      expect(gen.withdrawRemovedRoot(ROOT)).toBe(3);

      const targets = [ROOT, '24384_24781', '24384_24779', '24384_24782', '24384_24780'];
      expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, targets, { release: true });
      expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(targets, false);
      expect(viewer.__dtxAfterInstancesLoaded).toHaveBeenLastCalledWith(8000, []);
      expect(gen.isModelActuallyLoaded(ROOT)).toBe(false);
      expect(gen.loadedRefnosOf(ROOT)).toBeNull();
      expect(gen.listLoadedRoots()).not.toContain(ROOT);
      expect(forgetLoadedNodeMock).toHaveBeenCalledWith(ROOT);
      expect(emitToastMock).not.toHaveBeenCalled();
      expect(visibleInstsMock).not.toHaveBeenCalled();
      expect(nodeFactsMock).not.toHaveBeenCalled();
    });

    it('什么对象都没撤到时不去刷新派生索引', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const viewer = makeViewer();
      const gen = useModelGeneration({ viewer, db_num: 8000 });
      expect(gen.withdrawRemovedRoot(ROOT)).toBe(0);
      expect(viewer.__dtxAfterInstancesLoaded).not.toHaveBeenCalled();
    });
  });

  describe('loadedRefnosOf / isRootInScene', () => {
    it('loadedRefnosOf：经显示流程装的回它装的那些；没经显示流程装的看场景索引的属主链；都没有回 null', async () => {
      const { useModelGeneration, rememberLoadedRefnosOfRoot } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
      expect(gen.loadedRefnosOf(ROOT)).toBeNull();

      unitRefnosMock.mockReturnValue(['24384_24779', '24384_24779', '24384_24790']);
      expect(gen.loadedRefnosOf(ROOT)).toEqual(['24384_24779', '24384_24790']);

      // 地址栏直装的容器节点：查看器替它记下装了哪些
      rememberLoadedRefnosOfRoot('24384/26547', ['24384/26549', '24384_26716', '']);
      expect(gen.loadedRefnosOf('24384_26547')).toEqual(['24384_26549', '24384_26716']);
    });

    it('isRootInScene：自己有对象、名下按属主链有对象、或上次装的构件还有在场景里的，都算在', async () => {
      const { useModelGeneration, rememberLoadedRefnosOfRoot } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
      expect(gen.isRootInScene(ROOT)).toBe(false);
      expect(gen.isRootInScene('')).toBe(false);

      isDtxRefnoLoadedMock.mockImplementation((_dbno, refno) => refno === ROOT);
      expect(gen.isRootInScene(ROOT)).toBe(true);
      isDtxRefnoLoadedMock.mockReturnValue(false);

      unitRefnosMock.mockReturnValueOnce(['24384_24779']);
      expect(gen.isRootInScene(ROOT)).toBe(true);

      // 容器节点：属主链认不到它，靠「上次装了哪些」——那些构件已经被别处撤光了就不算在
      rememberLoadedRefnosOfRoot('24384_26547', ['24384_26549', '24384_26716']);
      expect(gen.isRootInScene('24384_26547')).toBe(false);
      isDtxRefnoLoadedMock.mockImplementation((_dbno, refno) => refno === '24384_26716');
      expect(gen.isRootInScene('24384_26547')).toBe(true);
    });

    it('isRootInScene：经显示流程装过的节点直接算在', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });
      expect(await gen.showModelByRefno(ROOT)).toBe(true);
      expect(gen.isRootInScene(ROOT)).toBe(true);
    });
  });

  describe('整库显示（showModelByDbnum）给「取最新」留的底', () => {
    const SITE_A = { refno: '24381_101405', name: '/1PTU-INST23' };
    const SITE_B = { refno: '24381_535', name: '/仪控ISO测试' };
    const SITE_EMPTY = { refno: '24381_600', name: '/EMPTY' };
    const SITE_PENDING = { refno: '24381_700', name: '/PENDING' };

    type Batch = { site?: { refno: string; name: string }; complete?: boolean; refnos: string[] };
    function collectWith(batches: Batch[], result: Record<string, unknown> = {}) {
      collectDbnumMock.mockImplementation(async (dbnum: number, options: { onRefnosReady?: (b: any) => Promise<void> | void }) => {
        let rootsDone = 0;
        for (const batch of batches) {
          rootsDone += 1;
          await options.onRefnosReady?.({ roots: [], rootsDone, rootsTotal: batches.length, ...batch });
        }
        return {
          dbnum, sites: batches.map((batch) => batch.site).filter(Boolean), refnos: batches.flatMap((batch) => batch.refnos),
          generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [], budgetLimited: false,
          siteSummaryAvailable: true,
          ...result,
        };
      });
    }

    it('收齐的 SITE 登记成取最新要核对的节点（带装之前读到的库水位），并记下各自装了哪些构件', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const registry = await import('./modelGetWorkRegistry');
      dbnumRowsMock.mockReturnValue(DBNUM_ROWS_FILE_AHEAD);
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      collectWith([
        { site: SITE_A, complete: true, refnos: ['24381_1', '24381_2'] },
        { site: SITE_B, complete: true, refnos: ['24381_3'] },
        { site: SITE_EMPTY, complete: true, refnos: [] },
        { site: SITE_PENDING, complete: false, refnos: ['24381_4'] },
      ]);

      expect((await gen.showModelByDbnum(7997)).loaded).toBe(true);

      expect(registry.getWorkRegisteredRoots()).toEqual([
        { refno: SITE_A.refno, dbnum: 7997, loadedModelSesno: 738, loadedFileLatestSesno: 748, origin: 'show_dbnum' },
        { refno: SITE_B.refno, dbnum: 7997, loadedModelSesno: 738, loadedFileLatestSesno: 748, origin: 'show_dbnum' },
      ]);
      expect(gen.loadedRefnosOf(SITE_A.refno)).toEqual(['24381_1', '24381_2']);
      expect(gen.loadedRefnosOf(SITE_B.refno)).toEqual(['24381_3']);
      // 没收齐的 SITE 不知道它完整的样子：不登记成节点、不记它装了什么，但算「已在管」（不会被当成新出现的）
      expect(gen.loadedRefnosOf(SITE_PENDING.refno)).toBeNull();
      const [scope] = registry.getWorkRegisteredScopes();
      expect(scope).toMatchObject({ dbnum: 7997, discover: true, checkedFileLatestSesno: 748 });
      // 收齐而没有几何的 SITE 不算已在管：以后它有了东西，取最新当成新出现的装进来
      expect([...scope!.knownSites].sort()).toEqual([SITE_A.refno, SITE_B.refno, SITE_PENDING.refno].sort());
    });

    it('按预算只显示了一部分：没轮到的 SITE 算已在管，以后不找新 SITE', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const registry = await import('./modelGetWorkRegistry');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      collectWith([{ site: SITE_A, complete: true, refnos: ['24381_1'] }], { skippedSites: ['24381/535'], budgetLimited: true });
      await gen.showModelByDbnum(7997);
      const [scope] = registry.getWorkRegisteredScopes();
      expect(scope!.discover).toBe(false);
      expect([...scope!.knownSites].sort()).toEqual([SITE_A.refno, SITE_B.refno].sort());
    });

    it('SITE 名单没取到（摘要不可用）：以后也不找新 SITE', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const registry = await import('./modelGetWorkRegistry');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      collectWith([{ site: SITE_A, complete: true, refnos: ['24381_1'] }], { siteSummaryAvailable: false });
      await gen.showModelByDbnum(7997);
      expect(registry.getWorkRegisteredScopes()[0]!.discover).toBe(false);
    });

    it('整库都是空的也登记这个库：以后有了模型，取最新能把新出现的 SITE 装进来', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const registry = await import('./modelGetWorkRegistry');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      collectWith([{ site: SITE_EMPTY, complete: true, refnos: [] }]);
      const result = await gen.showModelByDbnum(7997);
      expect(result).toMatchObject({ loaded: true, instanceCount: 0 });
      expect(registry.getWorkRegisteredRoots()).toEqual([]);
      expect(registry.getWorkRegisteredScopes()).toEqual([expect.objectContaining({ dbnum: 7997, discover: true })]);
      expect(registry.getWorkRegisteredScopes()[0]!.knownSites.size).toBe(0);
    });

    it('一个构件都没取到、收集又没完成：不登记（不知道这个库的样子）', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const registry = await import('./modelGetWorkRegistry');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      collectWith([{ site: SITE_PENDING, complete: false, refnos: [] }], { pending: [SITE_PENDING.refno] });
      expect((await gen.showModelByDbnum(7997)).loaded).toBe(false);
      expect(registry.getWorkRegisteredScopes()).toEqual([]);
    });

    it('整库显示进行中「取最新」看得到（等它结束再对账）；结束、出错之后都放开', async () => {
      const { useModelGeneration } = await import('./useModelGeneration');
      const { hasActiveModelLoad } = await import('./modelLoadSession');
      const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
      const during: boolean[] = [];
      collectDbnumMock.mockImplementation(async (dbnum: number) => {
        during.push(hasActiveModelLoad());
        return { dbnum, sites: [], refnos: [], generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [] };
      });
      expect(hasActiveModelLoad()).toBe(false);
      await gen.showModelByDbnum(7997);
      expect(during).toEqual([true]);
      expect(hasActiveModelLoad()).toBe(false);

      collectDbnumMock.mockRejectedValueOnce(new Error('炸了'));
      await gen.showModelByDbnum(7997);
      expect(hasActiveModelLoad()).toBe(false);
    });
  });
});
describe('「取最新」用到的显示流程出口：补几处边角', () => {
  const ROOT = '24384_24778';

  beforeEach(async () => {
    visibleInstsMock.mockReset();
    v1Source.records.invalidateRoot.mockReset();
    v1Source.records.invalidateRoot.mockReturnValue([]);
    unitRefnosMock.mockReset();
    unitRefnosMock.mockReturnValue([]);
    typeInfoMock.mockResolvedValue({ success: true, refno: ROOT, noun: 'EQUI', owner_refno: null, owner_noun: null });
    (await import('./modelGetWorkRegistry')).resetGetWorkRegistry();
  });

  it.each([
    ['有截断的根', { pending: [], truncated_roots: ['24384_24790'], errors: {} }],
    ['有出错的根', { pending: [], truncated_roots: [], errors: { '24384_24791': 'boom' } }],
  ])('重载查空而记录没收齐（%s）：本来就不撤，不为它白问一次节点模型状态', async (_name, incomplete) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [], incomplete });
    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);
    expect(nodeFactsMock).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
  });

  it.each([
    ['有截断的根', { pending: [], truncated_roots: ['24384_24790'], errors: {} }],
    ['有出错的根', { pending: [], truncated_roots: [], errors: { '24384_24791': 'boom' } }],
  ])('取最新发起的（quiet）重载查空而记录没收齐（%s）：同样不撤、不问，装着的构件原样，也不弹', async (_name, incomplete) => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    const members = ['24384_24779', '24384_24780'];
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: members });
    expect(await gen.showModelByRefno(ROOT)).toBe(true);
    emitToastMock.mockClear();
    evictMock.mockImplementation((_layer, _dbno, refnos) => [...refnos]);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [], incomplete });

    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false, quiet: true })).toBe(false);

    expect(nodeFactsMock).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
    expect(gen.loadedRefnosOf(ROOT)).toEqual(members);
    expect(emitToastMock).not.toHaveBeenCalled();
  });

  it('withdrawRemovedRoot：空 refno 什么都不做', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    expect(gen.withdrawRemovedRoot('')).toBe(0);
    expect(evictMock).not.toHaveBeenCalled();
    expect(forgetLoadedNodeMock).not.toHaveBeenCalled();
  });

  it('没钉库号时按 refno 查映射；映射里没有这个节点：不算在场景里、撤不到对象、也说不出它装着什么', async () => {
    const { useModelGeneration, rememberLoadedRefnosOfRoot } = await import('./useModelGeneration');
    const { tryGetDbnumByRefno } = await import('@/composables/useDbMetaInfo');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer });
    // 映射查得到：用映射给的库号
    unitRefnosMock.mockReturnValue(['24384_24779']);
    expect(gen.isRootInScene(ROOT)).toBe(true);
    expect(unitRefnosMock).toHaveBeenLastCalledWith(7997, ROOT);

    vi.mocked(tryGetDbnumByRefno).mockReturnValue(null as never);
    try {
      isDtxRefnoLoadedMock.mockReturnValue(true);
      expect(gen.isRootInScene(ROOT)).toBe(false);
      expect(gen.loadedRefnosOf(ROOT)).toBeNull();
      rememberLoadedRefnosOfRoot(ROOT, ['24384_24779']);
      expect(gen.withdrawRemovedRoot(ROOT)).toBe(0);
      expect(evictMock).not.toHaveBeenCalled();
      // 表还是撤掉的
      expect(gen.loadedRefnosOf(ROOT)).toBeNull();
      expect(forgetLoadedNodeMock).toHaveBeenCalledWith(ROOT);
    } finally {
      vi.mocked(tryGetDbnumByRefno).mockReturnValue(7997 as never);
    }
  });

  it('isModelActuallyLoaded：库号映射查不到（只带 show_dbnum 打开时没装它）时，装载器里记着的构件照样算装着', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const { tryGetDbnumByRefno } = await import('@/composables/useDbMetaInfo');
    const gen = useModelGeneration({ viewer: makeViewer() });
    const LEAF = '24384_24779';
    // 映射查得到：只问映射给的那个库，不去各库都问
    isDtxRefnoLoadedAcrossAllDbnosMock.mockReturnValue(true);
    expect(gen.isModelActuallyLoaded(LEAF)).toBe(false);
    expect(isDtxRefnoLoadedMock).toHaveBeenLastCalledWith(7997, LEAF);
    expect(isDtxRefnoLoadedAcrossAllDbnosMock).not.toHaveBeenCalled();

    vi.mocked(tryGetDbnumByRefno).mockReturnValue(null as never);
    try {
      // 映射查不到：整库显示装进来的构件在装载器里记着，各库都问一遍
      isDtxRefnoLoadedAcrossAllDbnosMock.mockImplementation((refno) => refno === LEAF);
      isDtxRefnoLoadedMock.mockClear();
      expect(gen.isModelActuallyLoaded(LEAF)).toBe(true);
      expect(gen.isModelActuallyLoaded('24384/24779')).toBe(true);
      expect(gen.isModelActuallyLoaded('24384_24780')).toBe(false);
      expect(isDtxRefnoLoadedMock).not.toHaveBeenCalled();
    } finally {
      vi.mocked(tryGetDbnumByRefno).mockReturnValue(7997 as never);
    }
  });

  it('整库显示：一批没说收没收齐的（旧形状）不当成收齐——不登记成节点', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const registry = await import('./modelGetWorkRegistry');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    const site = { refno: '24381_101405', name: '/1PTU-INST23' };
    collectDbnumMock.mockImplementation(async (dbnum: number, options: { onRefnosReady?: (b: any) => Promise<void> | void }) => {
      await options.onRefnosReady?.({ roots: [], rootsDone: 1, rootsTotal: 1, site, refnos: ['24381_1'] });
      return { dbnum, sites: [site], refnos: ['24381_1'], generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {}, skippedSites: [] };
    });
    await gen.showModelByDbnum(7997);
    expect(registry.getWorkRegisteredRoots()).toEqual([]);
    expect(gen.loadedRefnosOf(site.refno)).toBeNull();
    expect([...registry.getWorkRegisteredScopes()[0]!.knownSites]).toEqual([site.refno]);
  });
});
describe('「取最新」用到的显示流程出口：库号由登记的一方给（整库显示的页面里映射可能还没装）', () => {
  const SITE_REFNO = '24384_24932';
  const MEMBERS = ['24384_25590', '24384_25592'];

  beforeEach(async () => {
    v1Source.records.invalidateRoot.mockReset();
    v1Source.records.invalidateRoot.mockReturnValue([]);
    unitRefnosMock.mockReset();
    unitRefnosMock.mockReturnValue([]);
    (await import('./modelGetWorkRegistry')).resetGetWorkRegistry();
  });

  it('映射查不到库号（2026-11-12 真机：show_dbnum 页面里取最新把登记的 SITE 全丢了）：给了库号就按给的问', async () => {
    const { useModelGeneration, rememberLoadedRefnosOfRoot } = await import('./useModelGeneration');
    const { tryGetDbnumByRefno } = await import('@/composables/useDbMetaInfo');
    const viewer = makeViewer();
    const gen = useModelGeneration({ viewer });
    rememberLoadedRefnosOfRoot(SITE_REFNO, MEMBERS);
    isDtxRefnoLoadedMock.mockImplementation((dbno, refno) => dbno === 8000 && MEMBERS.includes(refno));
    vi.mocked(tryGetDbnumByRefno).mockReturnValue(null as never);
    try {
      // 不给库号：映射没装，说不出在不在
      expect(gen.isRootInScene(SITE_REFNO)).toBe(false);
      // 给了库号：它上次装的构件还在场景里
      expect(gen.isRootInScene(SITE_REFNO, 8000)).toBe(true);
      // 库号给错了就不在
      expect(gen.isRootInScene(SITE_REFNO, 7997)).toBe(false);

      unitRefnosMock.mockImplementation((dbno) => (dbno === 8000 ? ['24384_26000'] : []));
      expect(gen.loadedRefnosOf('24384_26205', 8000)).toEqual(['24384_26000']);
      expect(gen.loadedRefnosOf('24384_26205')).toBeNull();

      evictMock.mockImplementation((_layer, _dbno, refnos) => [...refnos]);
      unitRefnosMock.mockReturnValue([]);
      expect(gen.withdrawRemovedRoot(SITE_REFNO, 8000)).toBe(3);
      expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [SITE_REFNO, ...MEMBERS], { release: true });
    } finally {
      vi.mocked(tryGetDbnumByRefno).mockReturnValue(7997 as never);
    }
  });

  it('给的库号不像话（0、NaN）：当没给，退回原来的口径', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    unitRefnosMock.mockImplementation((dbno) => (dbno === 8000 ? ['24384_26000'] : []));
    expect(gen.loadedRefnosOf('24384_26205', 0)).toEqual(['24384_26000']);
    expect(gen.loadedRefnosOf('24384_26205', Number.NaN)).toEqual(['24384_26000']);
  });
});

describe('整库显示登记时的库水位：开始显示时库状态还没取到', () => {
  const SITE_A = { refno: '24381_101405', name: '/1PTU-INST23' };

  function collectOneSite() {
    collectDbnumMock.mockImplementation(async (dbnum: number, options: { onRefnosReady?: (b: any) => Promise<void> | void }) => {
      await options.onRefnosReady?.({ roots: [], rootsDone: 1, rootsTotal: 1, site: SITE_A, complete: true, refnos: ['24381_1'] });
      return {
        dbnum, sites: [SITE_A], refnos: ['24381_1'], generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {},
        skippedSites: [], budgetLimited: false, siteSummaryAvailable: true,
      };
    });
  }

  beforeEach(async () => {
    (await import('./modelGetWorkRegistry')).resetGetWorkRegistry();
    // 缓存里还没有这个库的那一行
    dbnumRowsMock.mockReturnValue([]);
  });

  it('要一份 /dbnums（不等它，装载照常开始），登记时用它回来的水位', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const registry = await import('./modelGetWorkRegistry');
    let release!: (value: { dbnums: Record<string, unknown>[] }) => void;
    getDbnumsMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    let collectStarted = false;
    collectOneSite();
    const collectImpl = collectDbnumMock.getMockImplementation()!;
    collectDbnumMock.mockImplementation(async (...args: unknown[]) => {
      collectStarted = true;
      // 装载开始之后库状态才回来
      release({ dbnums: [{ dbnum: 7997, model_sesno: 738, file_latest_sesno: 748 }, { dbnum: 8000, model_sesno: 1155, file_latest_sesno: 1155 }] });
      return collectImpl(...args);
    });
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });

    await gen.showModelByDbnum(7997);

    expect(collectStarted).toBe(true);
    expect(getDbnumsMock).toHaveBeenCalledTimes(1);
    expect(registry.getWorkRegisteredRoots()).toEqual([
      { refno: SITE_A.refno, dbnum: 7997, loadedModelSesno: 738, loadedFileLatestSesno: 748, origin: 'show_dbnum' },
    ]);
    expect(registry.getWorkRegisteredScopes()[0]!.checkedFileLatestSesno).toBe(748);
  });

  it('缓存里已经有这一行：不另要', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    dbnumRowsMock.mockReturnValue(DBNUM_ROWS_FILE_AHEAD);
    collectOneSite();
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    await gen.showModelByDbnum(7997);
    expect(getDbnumsMock).not.toHaveBeenCalled();
  });

  it('/dbnums 没取到、或回来的表里没有这个库：按「不知道」登记，整库显示照常做完', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const registry = await import('./modelGetWorkRegistry');
    collectOneSite();
    getDbnumsMock.mockRejectedValue(new Error('超时'));
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    expect((await gen.showModelByDbnum(7997)).loaded).toBe(true);
    expect(registry.getWorkRegisteredRoots()).toEqual([
      { refno: SITE_A.refno, dbnum: 7997, loadedModelSesno: null, loadedFileLatestSesno: null, origin: 'show_dbnum' },
    ]);

    registry.resetGetWorkRegistry();
    getDbnumsMock.mockResolvedValue({ dbnums: [{ dbnum: 8000, model_sesno: 1155, file_latest_sesno: 1155 }] });
    await gen.showModelByDbnum(7997);
    expect(registry.getWorkRegisteredRoots()[0]).toMatchObject({ loadedModelSesno: null, loadedFileLatestSesno: null });
  });

  it('整库都装完了库状态还没回来：最多再等 3 秒，等不到按「不知道」登记', async () => {
    const { useModelGeneration } = await import('./useModelGeneration');
    const registry = await import('./modelGetWorkRegistry');
    collectOneSite();
    getDbnumsMock.mockReturnValue(new Promise(() => undefined));
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 7997 });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const shown = gen.showModelByDbnum(7997);
      await vi.advanceTimersByTimeAsync(2_900);
      expect(registry.getWorkRegisteredRoots()).toEqual([]);
      await vi.advanceTimersByTimeAsync(200);
      expect((await shown).loaded).toBe(true);
      expect(registry.getWorkRegisteredRoots()[0]).toMatchObject({ refno: SITE_A.refno, loadedModelSesno: null, loadedFileLatestSesno: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('这一次显示不弹提示（quiet）：「取最新」一轮重载几个节点，只留它自己最后那句交代', () => {
  const ROOT = '24384_24778';
  const MEMBERS = ['24384_24779', '24384_24780'];

  beforeEach(() => {
    visibleInstsMock.mockReset();
    v1Source.tree.subtreeRefnos.mockReset();
    v1Source.records.invalidateRoot.mockReset();
    v1Source.records.invalidateRoot.mockReturnValue([]);
    unitRefnosMock.mockReset();
    unitRefnosMock.mockReturnValue([]);
    typeInfoMock.mockResolvedValue({ success: true, refno: ROOT, noun: 'EQUI', owner_refno: null, owner_noun: null });
  });

  async function loaded() {
    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({ viewer: makeViewer(), db_num: 8000 });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });
    expect(await gen.showModelByRefno(ROOT)).toBe(true);
    emitToastMock.mockClear();
    addLogMock.mockClear();
    return gen;
  }

  it('重载做成了：不弹「已从 gen-model 加载…」，控制台照记', async () => {
    const gen = await loaded();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });

    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false, quiet: true })).toBe(true);

    expect(emitToastMock).not.toHaveBeenCalled();
    expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining(`root=${ROOT} dbno=8000 loaded_refnos=2`));
  });

  it('同一件事不带 quiet：照旧弹一条', async () => {
    const gen = await loaded();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });

    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(true);

    expect(emitToastMock).toHaveBeenCalledTimes(1);
    expect(emitToastMock).toHaveBeenCalledWith({ message: '[成功] 已从 gen-model 加载 4 个几何实例', level: 'success' });
  });

  it('查空撤下：不弹「已从场景撤下」，控制台照记', async () => {
    const gen = await loaded();
    evictMock.mockImplementation((_layer, _dbno, refnos) => [...refnos]);
    nodeFactsMock.mockResolvedValue({ verdict: 'latest' });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [] });

    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false, quiet: true })).toBe(true);

    expect(evictMock).toHaveBeenCalledTimes(1);
    expect(emitToastMock).not.toHaveBeenCalled();
    expect(addLogMock).toHaveBeenCalledWith('info', expect.stringContaining('最新记录里这根名下没有几何'));
  });

  it('记录没查通：不弹「重载未完成」，控制台照记', async () => {
    const gen = await loaded();
    visibleInstsMock.mockRejectedValueOnce(new Error('records 超时'));
    v1Source.tree.subtreeRefnos.mockRejectedValueOnce(new Error('subtree 超时'));

    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false, quiet: true })).toBe(false);

    expect(emitToastMock).not.toHaveBeenCalled();
    expect(addLogMock).toHaveBeenCalledWith('warning', expect.stringContaining(`重载 ${ROOT} 未取得收齐的记录`));
  });

  it('装载出错：不弹「模型加载失败」；错在哪记进控制台和 error', async () => {
    const gen = await loaded();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });
    loadInstancesMock.mockRejectedValueOnce(new Error('网格解不开'));

    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false, quiet: true })).toBe(false);

    expect(emitToastMock).not.toHaveBeenCalled();
    expect(gen.error.value).toBe('网格解不开');
    expect(addLogMock).toHaveBeenCalledWith('error', `[model-load] refno=${ROOT} 加载失败：网格解不开`);
  });

  it('装载出错不带 quiet：弹「模型加载失败」，控制台也记', async () => {
    const gen = await loaded();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });
    loadInstancesMock.mockRejectedValueOnce(new Error('网格解不开'));

    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false })).toBe(false);

    expect(emitToastMock).toHaveBeenCalledWith({ message: '[错误] 模型加载失败：网格解不开', level: 'error' });
    expect(addLogMock).toHaveBeenCalledWith('error', `[model-load] refno=${ROOT} 加载失败：网格解不开`);
  });

  it('重载中被叫停：不弹「已停止重载」', async () => {
    const gen = await loaded();
    visibleInstsMock.mockImplementationOnce(async () => {
      requestStopModelLoad(ROOT);
      throw new Error('aborted');
    });

    expect(await gen.showModelByRefno(ROOT, { refresh: true, flyTo: false, quiet: true })).toBe(false);

    expect(gen.statusMessage.value).toBe('已停止重载，场景保持原样');
    expect(emitToastMock).not.toHaveBeenCalled();
  });

  /** 取最新一轮里会遇到的五种结局，对同一个节点挨个来一遍；查空撤下放最后（撤完它就不算装着了） */
  async function everyOutcome(gen: Awaited<ReturnType<typeof loaded>>, quiet: boolean) {
    const options = quiet ? { refresh: true, flyTo: false, quiet: true } : { refresh: true, flyTo: false };
    // 做成
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });
    expect(await gen.showModelByRefno(ROOT, options)).toBe(true);
    // 记录没查通
    visibleInstsMock.mockRejectedValueOnce(new Error('records 超时'));
    v1Source.tree.subtreeRefnos.mockRejectedValueOnce(new Error('subtree 超时'));
    expect(await gen.showModelByRefno(ROOT, options)).toBe(false);
    // 装载出错
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: MEMBERS });
    loadInstancesMock.mockRejectedValueOnce(new Error('网格解不开'));
    expect(await gen.showModelByRefno(ROOT, options)).toBe(false);
    // 被叫停
    visibleInstsMock.mockImplementationOnce(async () => {
      requestStopModelLoad(ROOT);
      throw new Error('aborted');
    });
    expect(await gen.showModelByRefno(ROOT, options)).toBe(false);
    // 查空撤下（后端确认它名下确实没有几何了）
    evictMock.mockImplementation((_layer, _dbno, refnos) => [...refnos]);
    nodeFactsMock.mockResolvedValue({ verdict: 'latest' });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: ROOT, refnos: [] });
    expect(await gen.showModelByRefno(ROOT, options)).toBe(true);
    expect(gen.isModelActuallyLoaded(ROOT)).toBe(false);
  }

  it('一轮里五种结局挨个来（做成、记录没查通、装载出错、被叫停、查空撤下），带 quiet：一条都不弹', async () => {
    const gen = await loaded();

    await everyOutcome(gen, true);

    expect(emitToastMock).not.toHaveBeenCalled();
  });

  it('同样五种结局不带 quiet：各弹各的那一句，一条不少', async () => {
    const gen = await loaded();

    await everyOutcome(gen, false);

    expect(emitToastMock.mock.calls.map(([payload]) => [payload.level, payload.message])).toEqual([
      ['success', '[成功] 已从 gen-model 加载 4 个几何实例'],
      ['warning', expect.stringContaining(`${ROOT} 重载未完成`)],
      ['error', '[错误] 模型加载失败：网格解不开'],
      ['info', `[提示] ${ROOT}：已停止重载，场景保持原样`],
      ['info', `[提示] ${ROOT} 在最新记录里已没有几何（已删除或成员已删光），已从场景撤下`],
    ]);
  });
});

describe('重载几个节点时的次序：场景里的对象按构件共用，先重载的节点刚装上的构件不能被后重载的撤掉', () => {
  // 2026-11-12 真实回放：管道从 ZONE Z 挪到 Z2，一次事件按 [Z2, Z] 重载——Z2 把管道的 9 个构件装上，
  // Z 接着按「我名下已经没有它们」把它们从场景撤掉，树上有、屏幕上没有。
  const A = '24384_47463';
  const B = '24384_47500';
  const X = '24384_47469';
  const Y = '24384_47595';
  const Z = '24384_47502';
  // 三个节点的用例里多出来的：第三个节点 C（装着 W）、A 名下的第三个构件 V
  const C = '24384_47520';
  const V = '24384_47596';
  const W = '24384_47521';

  beforeEach(() => {
    visibleInstsMock.mockReset();
    v1Source.records.invalidateRoot.mockReset();
    v1Source.records.invalidateRoot.mockReturnValue([]);
    unitRefnosMock.mockReset();
    unitRefnosMock.mockReturnValue([]);
    typeInfoMock.mockResolvedValue({ success: true, refno: A, noun: 'ZONE', owner_refno: null, owner_noun: null });
  });

  /** A 装着 [X, Y, V]、B 装着 [Z]、C 装着 [W]；别的同 twoRoots */
  async function threeRoots() {
    const mod = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = mod.useModelGeneration({ viewer, db_num: 8000 });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [X, Y, V] });
    expect(await gen.showModelByRefno(A)).toBe(true);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z] });
    expect(await gen.showModelByRefno(B)).toBe(true);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: C, refnos: [W] });
    expect(await gen.showModelByRefno(C)).toBe(true);
    evictMock.mockImplementation((_layer, _dbno, refnos) => [...refnos]);
    viewer.scene.setObjectsVisible.mockClear();
    markLoadedNodeStaleMock.mockClear();
    return { gen, viewer, round: mod.createModelReloadRound() };
  }

  /** A 装着 [X, Y]、B 装着 [Z]；撤对象的那个假装载器照实回「这些有对象」 */
  async function twoRoots() {
    const mod = await import('./useModelGeneration');
    const viewer = makeViewer();
    const gen = mod.useModelGeneration({ viewer, db_num: 8000 });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [X, Y] });
    expect(await gen.showModelByRefno(A)).toBe(true);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z] });
    expect(await gen.showModelByRefno(B)).toBe(true);
    evictMock.mockImplementation((_layer, _dbno, refnos) => [...refnos]);
    viewer.scene.setObjectsVisible.mockClear();
    markLoadedNodeStaleMock.mockClear();
    return { gen, viewer, round: mod.createModelReloadRound() };
  }

  it('同一轮里，构件从 A 挪到 B，先重载 B、再重载 A：A 不撤 B 刚装上的那个构件', async () => {
    const { gen, viewer, round } = await twoRoots();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, Y] });
    expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false, round })).toBe(true);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [X] });
    expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false, round })).toBe(true);

    expect(evictMock).not.toHaveBeenCalled();
    expect(viewer.scene.setObjectsVisible).not.toHaveBeenCalledWith(expect.arrayContaining([Y]), false);
    expect(gen.loadedRefnosOf(A)).toEqual([X]);
    expect(gen.loadedRefnosOf(B)).toEqual([Z, Y]);
    // 没有东西被误撤：不用给谁记账
    expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
  });

  it('同一轮里，A 名下唯一还在的构件挪到了 B，先重载 B、再重载 A（A 整个查空）：撤下 A 自己，不撤 B 刚装上的构件', async () => {
    const { gen, viewer, round } = await twoRoots();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, X, Y] });
    expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false, round })).toBe(true);
    nodeFactsMock.mockResolvedValue({ verdict: 'empty' });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [] });
    expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false, round })).toBe(true);

    expect(evictMock).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [A], { release: true });
    expect(viewer.scene.setObjectsVisible).toHaveBeenLastCalledWith([A], false);
    expect(gen.isModelActuallyLoaded(A)).toBe(false);
    expect(gen.loadedRefnosOf(B)).toEqual([Z, X, Y]);
  });

  it('同一轮里真被删掉的构件照常撤（它不是谁刚装上的）', async () => {
    const { gen, viewer, round } = await twoRoots();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z] });
    expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false, round })).toBe(true);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [X] });
    expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false, round })).toBe(true);

    expect(evictMock).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [Y], { release: true });
  });

  it('次序反过来（先重载失去构件的 A）本来就没事：A 撤掉它，B 再把它装上', async () => {
    const { gen, viewer, round } = await twoRoots();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [X] });
    expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false, round })).toBe(true);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [Y], { release: true });
    loadInstancesMock.mockClear();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, Y] });
    expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false, round })).toBe(true);

    expect(loadInstancesMock).toHaveBeenCalledWith(expect.anything(), 8000, [Z, Y], expect.objectContaining({ replaceExistingObjects: true }));
    expect(evictMock).toHaveBeenCalledTimes(1);
    // A 撤的时候 B 名下还没有它：没有哪个节点因此缺东西
    expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
  });

  it('两轮各管各的：上一轮装过的构件，下一轮照常可以被撤', async () => {
    const { gen, viewer, round } = await twoRoots();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, Y] });
    expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false, round })).toBe(true);
    const mod = await import('./useModelGeneration');
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [X] });
    expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false, round: mod.createModelReloadRound() })).toBe(true);

    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [Y], { release: true });
  });

  it('同一轮里三个节点：A 的两个构件分别挪到 B 和 C、A 还剩一个，先重载 B、C 再重载 A：A 一个都不撤', async () => {
    const { gen, round } = await threeRoots();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, X] });
    expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false, round })).toBe(true);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: C, refnos: [W, Y] });
    expect(await gen.showModelByRefno(C, { refresh: true, flyTo: false, round })).toBe(true);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [V] });
    expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false, round })).toBe(true);

    expect(evictMock).not.toHaveBeenCalled();
    expect(gen.loadedRefnosOf(A)).toEqual([V]);
    expect(gen.loadedRefnosOf(B)).toEqual([Z, X]);
    expect(gen.loadedRefnosOf(C)).toEqual([W, Y]);
    expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
  });

  it('同一轮里三个节点：A 名下的构件两个挪到了 B、C、一个真删了，A 整个查空：只撤 A 自己和真删的那个', async () => {
    const { gen, viewer, round } = await threeRoots();
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, X] });
    expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false, round })).toBe(true);
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: C, refnos: [W, Y] });
    expect(await gen.showModelByRefno(C, { refresh: true, flyTo: false, round })).toBe(true);
    nodeFactsMock.mockResolvedValue({ verdict: 'empty' });
    visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [] });
    expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false, round })).toBe(true);

    expect(evictMock).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [A, V], { release: true });
    expect(gen.isModelActuallyLoaded(A)).toBe(false);
    expect(gen.loadedRefnosOf(B)).toEqual([Z, X]);
    expect(gen.loadedRefnosOf(C)).toEqual([W, Y]);
    expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
  });

  describe('不在同一轮里（行上一个一个点「重载」）：撤掉的构件要是还登记在别的已装节点名下，给那个节点记一笔', () => {
    const REASON = '名下有构件被别的节点的重载撤下了，屏幕上可能缺构件';

    it('先点得到构件的 B、再点 A：A 照旧把它撤了（它不知道 B 刚装过），B 记一笔——行上会给「重载」，取最新也会重载它', async () => {
      const { gen, viewer } = await twoRoots();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, Y] });
      expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false })).toBe(true);
      expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [X] });
      expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false })).toBe(true);

      expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [Y], { release: true });
      expect(markLoadedNodeStaleMock).toHaveBeenCalledTimes(1);
      expect(markLoadedNodeStaleMock).toHaveBeenCalledWith(B, REASON);
    });

    it('A 整个查空撤下时同样：它带走的构件还登记在 B 名下，B 记一笔', async () => {
      const { gen } = await twoRoots();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, X, Y] });
      expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false })).toBe(true);
      nodeFactsMock.mockResolvedValue({ verdict: 'empty' });
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [] });
      expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false })).toBe(true);

      expect(markLoadedNodeStaleMock).toHaveBeenCalledTimes(1);
      expect(markLoadedNodeStaleMock).toHaveBeenCalledWith(B, REASON);
    });

    it('撤的构件在场景里本来就没有对象（别人已经撤过了）：没有谁因此缺东西，不记', async () => {
      const { gen } = await twoRoots();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, Y] });
      expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false })).toBe(true);
      evictMock.mockImplementation(() => []);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [X] });
      expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false })).toBe(true);

      expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
    });

    it('撤的构件没有登记在别的节点名下（真删了）：不记', async () => {
      const { gen } = await twoRoots();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [X] });
      expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false })).toBe(true);

      expect(evictMock).toHaveBeenCalledTimes(1);
      expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
    });

    it('只有一部分撤掉的构件有对象：只按真撤掉对象的那几个找', async () => {
      const { gen } = await twoRoots();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, Y] });
      expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false })).toBe(true);
      // A 这次要撤 X 和 Y，但只有 X 真有对象被撤（Y 的对象别处已经没了）；B 名下登记的是 Y，不是 X
      evictMock.mockImplementation(() => [X]);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [] });
      nodeFactsMock.mockResolvedValue({ verdict: 'empty' });
      expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false })).toBe(true);

      expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
    });

    it('A 没有整个查空、只是少了几个构件时也一样：只有一部分撤掉的构件真有对象，只按那几个找', async () => {
      const { gen } = await twoRoots();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, Y] });
      expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false })).toBe(true);
      // A 这次的记录里只有一个新构件：要撤 X 和 Y，但只有 X 真有对象被撤；B 名下登记的是 Y
      evictMock.mockImplementation(() => [X]);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [V] });
      expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false })).toBe(true);

      expect(evictMock).toHaveBeenCalledTimes(1);
      expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
    });

    it('A 整个查空撤下、它名下的构件在场景里本来就没有对象了：没有谁因此缺东西，不记', async () => {
      const { gen } = await twoRoots();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, X, Y] });
      expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false })).toBe(true);
      evictMock.mockImplementation(() => []);
      nodeFactsMock.mockResolvedValue({ verdict: 'empty' });
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [] });
      expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false })).toBe(true);

      expect(gen.isModelActuallyLoaded(A)).toBe(false);
      expect(markLoadedNodeStaleMock).not.toHaveBeenCalled();
    });

    it('A 一次撤掉了 B 名下的两个构件：B 只记一笔（不是丢几个记几笔）', async () => {
      const { gen, viewer } = await twoRoots();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, X, Y] });
      expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false })).toBe(true);
      // A 这次的记录里只有一个新构件（没有整个查空）：X、Y 都按「我名下已经没有」撤了
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [V] });
      expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false })).toBe(true);

      expect(evictMock).toHaveBeenCalledWith(viewer.__dtxLayer, 8000, [X, Y], { release: true });
      expect(markLoadedNodeStaleMock).toHaveBeenCalledTimes(1);
      expect(markLoadedNodeStaleMock).toHaveBeenCalledWith(B, REASON);
    });

    it('A 整个查空撤下，带走的构件分别登记在 B 和 C 名下：两个节点各记一笔', async () => {
      const { gen } = await threeRoots();
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: B, refnos: [Z, X] });
      expect(await gen.showModelByRefno(B, { refresh: true, flyTo: false })).toBe(true);
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: C, refnos: [W, Y] });
      expect(await gen.showModelByRefno(C, { refresh: true, flyTo: false })).toBe(true);
      nodeFactsMock.mockResolvedValue({ verdict: 'empty' });
      visibleInstsMock.mockResolvedValueOnce({ success: true, refno: A, refnos: [] });
      expect(await gen.showModelByRefno(A, { refresh: true, flyTo: false })).toBe(true);

      expect(markLoadedNodeStaleMock).toHaveBeenCalledTimes(2);
      expect(markLoadedNodeStaleMock).toHaveBeenCalledWith(B, REASON);
      expect(markLoadedNodeStaleMock).toHaveBeenCalledWith(C, REASON);
    });
  });
});