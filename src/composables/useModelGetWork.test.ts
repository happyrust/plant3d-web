/**
 * 「取最新」的接线（`useModelGetWork`）：引擎接到真实模块上的那一层。后台、已加载节点表、数据源换成假的；
 * 选中、加载会话、登记表用真的。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TreeRefreshReport } from '@/composables/pdmsTreeRefresh';

const mocks = vi.hoisted(() => ({
  health: vi.fn(async (): Promise<{ generation: number }> => ({ generation: 1 })),
  refreshVerdict: vi.fn(async () => undefined),
  dbnums: vi.fn(async (_options?: unknown): Promise<{ dbnums: Record<string, unknown>[] }> => ({ dbnums: [] })),
  peekDbnums: vi.fn((): { fetchedAt: number; response: { dbnums: Record<string, unknown>[] } } | null => null),
  entries: vi.fn((): Record<string, unknown>[] => []),
  facts: vi.fn(async (_query: { refno: string }): Promise<Record<string, unknown> | null> => null),
  ancestors: vi.fn(async (_refno: string): Promise<{ success: boolean; refnos: string[]; error_message?: string }> => ({ success: true, refnos: [] })),
  invalidateTree: vi.fn(),
  listNodeVersions: vi.fn(async (_dbnum: number, _refno: string, _scope?: string, _options?: unknown) => (
    { versions: [] as { sesno: number; sessionTime: string | null; impact: string; unitsChanged: number }[] }
  )),
  dismissNotice: vi.fn(),
  toast: vi.fn(),
  addLog: vi.fn(),
  /** 用例要用到的树数据源别的方法（根名单） */
  treeExtras: {} as Record<string, unknown>,
}));

vi.mock('@/composables/useGenModelV1Health', () => ({
  ensureGenModelV1Freshness: () => mocks.health(),
  useGenModelV1Health: () => ({ refreshVerdict: mocks.refreshVerdict, state: { capabilities: null } }),
}));
vi.mock('@/composables/useGenModelV1Dbnums', () => ({
  getGenModelV1Dbnums: (options: unknown) => mocks.dbnums(options),
  peekGenModelV1Dbnums: () => mocks.peekDbnums(),
}));
vi.mock('@/composables/useLoadedNodeStatus', () => ({ useLoadedNodeStatus: () => ({ entries: () => mocks.entries() }) }));
vi.mock('@/composables/nodeModelFacts', () => ({ fetchNodeModelFacts: (query: { refno: string }) => mocks.facts(query) }));
vi.mock('@/composables/useGenModelV1UpdateNotice', () => ({ dismissGenModelV1UpdateNotice: () => mocks.dismissNotice() }));
vi.mock('@/ribbon/toastBus', () => ({ emitToast: (payload: unknown) => mocks.toast(payload) }));
vi.mock('@/composables/useConsoleStore', () => ({ useConsoleStore: () => ({ addLog: mocks.addLog }) }));
vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    tree: { ancestors: mocks.ancestors, invalidate: mocks.invalidateTree, ...mocks.treeExtras },
    versions: { listNodeVersions: mocks.listNodeVersions },
  }),
}));

const ROW_8000 = { dbnum: 8000, db_type: 'DESI', initialized: true, file_latest_sesno: 1146, applied_sesno: 1146, model_sesno: 1146, model_verdict: 'in_sync', excluded: false };
const SITE = '24384_26547';

/** 后端节点模型状态接口的事实（`nodeModelFactsOf` 之后的形状） */
function facts(verdict: string, modelSesno = 1146) {
  return {
    verdict, verdictReason: null, dbnum: 8000, noun: 'SITE', unitRoot: null,
    units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
    generatedAt: { sesnoMin: modelSesno, sesnoMax: modelSesno, timeMin: null, timeMax: null, basis: 'library_watermark' },
    changes: null,
    precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    library: { fileLatestSesno: modelSesno, modelSesno, modelSesnoTime: null, inWatchScope: true },
  };
}

function tableEntry(refno: string, patch: Record<string, unknown> = {}) {
  return { refno, dbnum: 8000, loaded: true, loadedAt: 0, loadedModelSesno: 1143, loadedFileLatestSesno: 1143, status: null, checking: false, staleReason: null, ...patch };
}

function treeReport(patch: Partial<TreeRefreshReport> = {}): TreeRefreshReport {
  return {
    layersRequested: 2, layersRefreshed: 2, layersFailed: [], added: [], removed: [], removedNodeCount: 0, removedUnder: {},
    renamed: [], moved: [], droppedSelection: [], changed: false,
    ...patch,
  };
}

function scenePort(loaded: Record<string, string[]> = {}) {
  return {
    reload: vi.fn(async (refno: string) => {
      loaded[refno] = [...(loaded[refno] ?? []), `${refno}:new`];
      return true;
    }),
    withdraw: vi.fn((refno: string) => {
      const count = loaded[refno]?.length ?? 0;
      delete loaded[refno];
      return count;
    }),
    loadedRefnos: vi.fn((refno: string) => loaded[refno] ?? null),
    rootInScene: vi.fn(() => true),
  };
}

async function load() {
  vi.resetModules();
  const getWork = await import('./useModelGetWork');
  const registry = await import('./modelGetWorkRegistry');
  const selection = await import('./useSelectionStore');
  const sessions = await import('./modelLoadSession');
  registry.resetGetWorkRegistry();
  selection.setGlobalSelectedRefno(null);
  sessions.__resetModelLoadSessionsForTests();
  return { getWork, registry, selection, sessions };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (typeof mock === 'function') mock.mockReset();
  }
  mocks.treeExtras = {};
  mocks.health.mockResolvedValue({ generation: 1 });
  mocks.refreshVerdict.mockResolvedValue(undefined);
  mocks.dbnums.mockResolvedValue({ dbnums: [ROW_8000] });
  mocks.peekDbnums.mockReturnValue(null);
  mocks.entries.mockReturnValue([]);
  mocks.facts.mockResolvedValue(null);
  mocks.ancestors.mockResolvedValue({ success: true, refnos: [] });
  mocks.listNodeVersions.mockResolvedValue({ versions: [] });
});

describe('useModelGetWork：一轮走下来', () => {
  it('已加载节点表里的节点、库里的模型比本页装的新：经场景重载，给一句交代，收起状态栏的更新提示，库状态一起换新', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry(SITE)]);
    // 本页装的是 1143、库里的模型已到 1146
    mocks.facts.mockResolvedValue(facts('latest'));
    // 节点版本表就算说「其间没人改到它」也不看——根本不问
    mocks.listNodeVersions.mockResolvedValue({ versions: [] });
    const scene = scenePort({ [SITE]: ['24384_26549'] });
    getWork.registerGetWorkScene(scene);
    const tree = { touchedDbnums: () => [8000], refresh: vi.fn(async () => treeReport()), nameOf: () => '/AIOS-INC-SITE' };
    getWork.registerGetWorkTree(tree);

    const report = await getWork.requestGetWork();

    expect(mocks.dbnums).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect(mocks.refreshVerdict).toHaveBeenCalledTimes(1);
    // 不问节点版本表：真实库上那条查询一次十几到几十秒（见 `assumeChangedSince` 的说明）
    expect(mocks.listNodeVersions).not.toHaveBeenCalled();
    expect(tree.refresh).toHaveBeenCalledTimes(1);
    expect(scene.reload).toHaveBeenCalledWith(SITE);
    expect(report.models.reloaded).toEqual([{ refno: SITE, added: 1, removed: 0, total: 2 }]);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith({ message: '已取最新：模型重载 1 个节点（新增 1 个构件）。', level: 'success' });
    expect(mocks.addLog).toHaveBeenCalledWith('info', '[取最新] 已取最新：模型重载 1 个节点（新增 1 个构件）。');
    expect(mocks.addLog).toHaveBeenCalledWith('info', '[取最新] 重载 /AIOS-INC-SITE（24384_26547）：现有 2 个构件，新增 1');
    expect(mocks.dismissNotice).toHaveBeenCalledTimes(1);
    const state = getWork.useModelGetWork().state;
    expect(state.running).toBe(false);
    expect(state.progress).toBe('');
    expect(state.last?.summary).toBe(report.summary);
  });

  it('库的模型水位没动、只有库文件前进了（后台不会去追的库）：没有可换的新版，不重载，也不问节点版本表', async () => {
    const { getWork } = await load();
    // 不在监听范围的库：库文件到了 1146，模型还停在本页装的那一版 1143
    mocks.dbnums.mockResolvedValue({ dbnums: [{ ...ROW_8000, applied_sesno: 1143, model_sesno: 1143, excluded: true, excluded_reason: 'watch_dbnums' }] });
    mocks.entries.mockReturnValue([tableEntry(SITE)]);
    mocks.facts.mockResolvedValue(facts('latest', 1143));
    const scene = scenePort({ [SITE]: ['24384_26549'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(mocks.facts).toHaveBeenCalledTimes(1);
    expect(mocks.listNodeVersions).not.toHaveBeenCalled();
    expect(scene.reload).not.toHaveBeenCalled();
    expect(report.models).toMatchObject({ checked: 1, reloaded: [], kept: [], failed: [] });
  });

  it('后台的模型落后于库文件、但已经比本页装的新：重载换上后台现有的那一版，并说明还落后', async () => {
    const { getWork } = await load();
    mocks.dbnums.mockResolvedValue({ dbnums: [{ ...ROW_8000, file_latest_sesno: 1149, excluded: true, excluded_reason: 'watch_dbnums' }] });
    mocks.entries.mockReturnValue([tableEntry(SITE)]);
    mocks.facts.mockResolvedValue(facts('lagging'));
    const scene = scenePort({ [SITE]: ['24384_26549'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(mocks.listNodeVersions).not.toHaveBeenCalled();
    expect(scene.reload).toHaveBeenCalledWith(SITE);
    expect(report.models.reloaded.map((item) => item.refno)).toEqual([SITE]);
    expect(report.models.kept).toEqual([{ refno: SITE, reason: expect.stringContaining('落后于库文件') }]);
  });

  it('旧后端没有节点模型状态接口（过渡办法）：同样只看库的模型水位——比本页装的新就重载，没动就不重载', async () => {
    const { getWork } = await load();
    // `fetchNodeModelFacts` 回 null = 服务端没有那条路由
    mocks.facts.mockResolvedValue(null);
    mocks.entries.mockReturnValue([tableEntry(SITE), tableEntry('24384_26548', { loadedModelSesno: 1146, loadedFileLatestSesno: 1143 })]);
    const scene = scenePort({ [SITE]: ['a'], '24384_26548': ['b'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(mocks.listNodeVersions).not.toHaveBeenCalled();
    // SITE 装的是 1143、库的模型到了 1146：重载；另一个装的时候模型已经是 1146（只是库文件那一格不一样）：不重载
    expect(scene.reload).toHaveBeenCalledTimes(1);
    expect(scene.reload).toHaveBeenCalledWith(SITE);
    expect(report.models.checked).toBe(2);
    expect(report.models.kept).toEqual([]);
  });

  it('旧后端（过渡办法）、库的模型水位没动而库文件前进了：不重载，也不凭空说它「落后」', async () => {
    const { getWork } = await load();
    mocks.facts.mockResolvedValue(null);
    // 不在监听范围的库：模型还在本页装的 1146，库文件到了 1149
    mocks.dbnums.mockResolvedValue({ dbnums: [{ ...ROW_8000, file_latest_sesno: 1149, excluded: true, excluded_reason: 'watch_dbnums' }] });
    mocks.entries.mockReturnValue([tableEntry(SITE, { loadedModelSesno: 1146, loadedFileLatestSesno: 1146 })]);
    const scene = scenePort({ [SITE]: ['a'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(mocks.listNodeVersions).not.toHaveBeenCalled();
    expect(scene.reload).not.toHaveBeenCalled();
    // 没问节点版本表，说不出它落后没落后：不记「没动、要说明」；库一级那句照旧点名
    expect(report.models).toMatchObject({ checked: 1, reloaded: [], kept: [], failed: [] });
    expect(report.libraries.map((item) => item.kind)).toEqual(['out_of_scope']);
  });

  it('库状态里没有这个库的那一行，但后端答得出节点的状态、库里的模型比本页装的新：照样重载', async () => {
    const { getWork } = await load();
    mocks.dbnums.mockResolvedValue({ dbnums: [] });
    mocks.entries.mockReturnValue([tableEntry(SITE)]);
    mocks.facts.mockResolvedValue(facts('latest'));
    const scene = scenePort({ [SITE]: ['a'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(scene.reload).toHaveBeenCalledWith(SITE);
    expect(report.models.reloaded.map((item) => item.refno)).toEqual([SITE]);
    expect(report.libraries.map((item) => item.kind)).toEqual(['unknown']);
  });

  it('后端说库里没有这个节点（REFNO_NOT_FOUND）：从场景撤下，不重载', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry('24384_26716')]);
    mocks.facts.mockRejectedValue(Object.assign(new Error('最新会话 1155 的索引里没有它'), { code: 'REFNO_NOT_FOUND' }));
    const scene = scenePort({ '24384_26716': ['24384_26717'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(scene.withdraw).toHaveBeenCalledWith('24384_26716', 8000);
    expect(scene.reload).not.toHaveBeenCalled();
    expect(report.models.withdrawn).toEqual([{ refno: '24384_26716', refnos: 1, why: 'deleted' }]);
  });

  it('别的失败（库文件打不开）不当成已删除：屏幕上的不动', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry(SITE)]);
    mocks.facts.mockRejectedValue(Object.assign(new Error('库文件打不开'), { code: 'SOURCE_NOT_FOUND' }));
    const scene = scenePort({ [SITE]: ['a'] });
    getWork.registerGetWorkScene(scene);
    const report = await getWork.requestGetWork();
    expect(scene.withdraw).not.toHaveBeenCalled();
    expect(scene.reload).not.toHaveBeenCalled();
    expect(report.models.kept).toEqual([{ refno: SITE, reason: expect.stringContaining('新旧判不了') }]);
  });

  it('后台连不上：报错的那一句，不收起更新提示，页面不动', async () => {
    const { getWork } = await load();
    mocks.health.mockRejectedValue(new Error('Failed to fetch'));
    const scene = scenePort();
    getWork.registerGetWorkScene(scene);
    const report = await getWork.requestGetWork();
    expect(report.ok).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith({ message: '取最新没有完成：后台连不上（Failed to fetch），页面没有动', level: 'error' });
    expect(mocks.addLog).toHaveBeenCalledWith('error', expect.stringContaining('取最新没有完成'));
    expect(mocks.dismissNotice).not.toHaveBeenCalled();
    expect(mocks.dbnums).not.toHaveBeenCalled();
  });

  it('有节点重载没成：更新提示留着', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry(SITE, { staleReason: '后端已经重新生成，屏幕上还没换上' })]);
    mocks.facts.mockResolvedValue(facts('latest'));
    const scene = scenePort({ [SITE]: ['a'] });
    scene.reload.mockResolvedValue(false);
    getWork.registerGetWorkScene(scene);
    const report = await getWork.requestGetWork();
    expect(report.models.failed).toHaveLength(1);
    expect(mocks.dismissNotice).not.toHaveBeenCalled();
  });
});

describe('useModelGetWork：在册的节点从哪来', () => {
  it('已加载节点表里装着的 + 登记表里的；同一个节点以已加载节点表为准；只是点过没装的不算', async () => {
    const { getWork, registry } = await load();
    mocks.dbnums.mockResolvedValue({ dbnums: [{ ...ROW_8000, file_latest_sesno: 1143, applied_sesno: 1143, model_sesno: 1143 }] });
    mocks.entries.mockReturnValue([
      tableEntry(SITE),
      tableEntry('24384_9', { loaded: false, loadedModelSesno: null, loadedFileLatestSesno: null }),
    ]);
    registry.noteGetWorkRoot(SITE, 8000, { modelSesno: 1000, fileLatestSesno: 1000 }, 'show_dbnum');
    registry.noteGetWorkRoot('24384_26548', 8000, { modelSesno: 1143, fileLatestSesno: 1143 }, 'show_refno');
    const scene = scenePort();
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    // 三个在册节点里：没装的不算；SITE 按已加载节点表的水位（1143，和库一样）不用问
    expect(report.models.rootsTotal).toBe(2);
    expect(report.models.checked).toBe(0);
    expect(mocks.facts).not.toHaveBeenCalled();
  });

  it('登记表里的节点别处已经撤了：从登记表拿掉', async () => {
    const { getWork, registry } = await load();
    registry.noteGetWorkRoot('24381_145018', 8000, { modelSesno: 1143, fileLatestSesno: 1143 }, 'show_refno');
    const scene = scenePort();
    scene.rootInScene.mockReturnValue(false);
    getWork.registerGetWorkScene(scene);
    await getWork.requestGetWork();
    expect(registry.getWorkRegisteredRoots()).toEqual([]);
    expect(scene.reload).not.toHaveBeenCalled();
  });

  it('登记表里的节点核对过不用动：水位推进到现在；重载做成了就从登记表拿掉', async () => {
    const { getWork, registry } = await load();
    // 不在监听范围的库：模型在 1146，库文件又前进到了 1149
    mocks.dbnums.mockResolvedValue({ dbnums: [{ ...ROW_8000, file_latest_sesno: 1149, excluded: true, excluded_reason: 'watch_dbnums' }] });
    // SITE 装的时候模型就是 1146（只有库文件那一格变了）：核对过不用动；另一个装的是 1143：库里的模型比它新，重载
    registry.noteGetWorkRoot(SITE, 8000, { modelSesno: 1146, fileLatestSesno: 1146 }, 'show_dbnum');
    registry.noteGetWorkRoot('24384_26548', 8000, { modelSesno: 1143, fileLatestSesno: 1143 }, 'show_dbnum');
    mocks.facts.mockResolvedValue(facts('latest'));
    const scene = scenePort({ '24384_26548': ['a'] });
    getWork.registerGetWorkScene(scene);

    await getWork.requestGetWork();

    expect(mocks.listNodeVersions).not.toHaveBeenCalled();
    expect(scene.reload).toHaveBeenCalledTimes(1);
    expect(scene.reload).toHaveBeenCalledWith('24384_26548');
    expect(registry.getWorkRegisteredRoots()).toEqual([
      { refno: SITE, dbnum: 8000, loadedModelSesno: 1146, loadedFileLatestSesno: 1149, origin: 'show_dbnum' },
    ]);
  });
});

describe('useModelGetWork：选中的构件', () => {
  it('库里没有它了（祖先链 404）：登记成「已删除」，选中的写法原样不变', async () => {
    const { getWork, selection } = await load();
    selection.setGlobalSelectedRefno('24384/26717');
    mocks.ancestors.mockResolvedValue({ success: false, refnos: [], error_message: 'not_found (404): dbnum 8000 会话 Some(1155) 的索引里没有 24384/26717' });

    const report = await getWork.requestGetWork();

    expect(mocks.ancestors).toHaveBeenCalledWith('24384_26717');
    expect(selection.getGlobalSelectedIsDeleted()).toBe(true);
    expect(selection.getGlobalSelectedRefno()).toBe('24384/26717');
    expect(report.selectionDeleted).toBe('24384_26717');
  });

  it('还在、或没问到（网络错）：不动选中', async () => {
    const { getWork, selection } = await load();
    selection.setGlobalSelectedRefno('24384_26549');
    await getWork.requestGetWork();
    expect(selection.getGlobalSelectedIsDeleted()).toBe(false);

    mocks.ancestors.mockResolvedValue({ success: false, refnos: [], error_message: 'network: Failed to fetch' });
    await getWork.requestGetWork();
    expect(selection.getGlobalSelectedIsDeleted()).toBe(false);
  });

  it('钉在历史版本上的选中（版本对比里点的）、不是 PDMS refno 的选中：不碰、不问', async () => {
    const { getWork, selection } = await load();
    selection.setGlobalSelectedRefnoAtVersion('24384_26717', { sesno: 1146, label: 'A', load: async () => ({}) as never });
    mocks.ancestors.mockResolvedValue({ success: false, refnos: [], error_message: 'not_found (404): 没有' });
    await getWork.requestGetWork();
    expect(mocks.ancestors).not.toHaveBeenCalled();
    expect(selection.getGlobalSelectedIsDeleted()).toBe(false);

    selection.setGlobalSelectedRefno('gm-root:P:ALL');
    await getWork.requestGetWork();
    expect(mocks.ancestors).not.toHaveBeenCalled();
  });
});

describe('useModelGetWork：登记与状态', () => {
  it('树、场景、派生物：登记了才用；撤掉之后不用；后登记的顶掉先登记的，先登记的再撤不影响后登记的', async () => {
    const { getWork } = await load();
    const firstTree = { touchedDbnums: () => [], refresh: vi.fn(async () => treeReport()), nameOf: () => null };
    const secondTree = { touchedDbnums: () => [], refresh: vi.fn(async () => treeReport()), nameOf: () => null };
    const offFirst = getWork.registerGetWorkTree(firstTree);
    const offSecond = getWork.registerGetWorkTree(secondTree);
    offFirst();
    const ran: string[] = [];
    const offDerived = getWork.registerGetWorkDerived({ name: '属性', run: () => { ran.push('旧'); } });
    getWork.registerGetWorkDerived({ name: '属性', run: () => { ran.push('新'); } });
    offDerived();
    const firstScene = scenePort();
    const offScene = getWork.registerGetWorkScene(firstScene);

    await getWork.requestGetWork();
    expect(firstTree.refresh).not.toHaveBeenCalled();
    expect(secondTree.refresh).toHaveBeenCalledTimes(1);
    expect(ran).toEqual(['新']);

    offSecond();
    offScene();
    mocks.entries.mockReturnValue([tableEntry(SITE)]);
    const report = await getWork.requestGetWork();
    expect(secondTree.refresh).toHaveBeenCalledTimes(1);
    expect(report.tree).toBeNull();
    expect(firstScene.loadedRefnos).not.toHaveBeenCalled();
  });

  it('运行中再点：排成下一轮；每一轮只给一句交代（不是每个等的人一句）', async () => {
    const { getWork } = await load();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let refreshes = 0;
    getWork.registerGetWorkTree({
      touchedDbnums: () => [],
      refresh: async () => {
        refreshes += 1;
        if (refreshes === 1) await gate;
        return treeReport();
      },
      nameOf: () => null,
    });
    const state = getWork.useModelGetWork().state;

    const first = getWork.requestGetWork();
    expect(state.running).toBe(true);
    expect(state.queued).toBe(false);
    const second = getWork.requestGetWork();
    const third = getWork.requestGetWork();
    expect(state.queued).toBe(true);
    await vi.waitFor(() => expect(state.progress).toBe('刷新模型树…'));

    release();
    const reports = await Promise.all([first, second, third]);
    expect(reports[1]).toBe(reports[2]);
    expect(reports[0]).not.toBe(reports[1]);
    expect(refreshes).toBe(2);
    expect(mocks.toast).toHaveBeenCalledTimes(2);
    expect(state.running).toBe(false);
    expect(state.queued).toBe(false);
  });

  it('有装载在跑：等它结束才开始（用真的加载会话）', async () => {
    const { getWork, sessions } = await load();
    const session = sessions.beginModelLoadSession(SITE);
    const pending = getWork.requestGetWork();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mocks.health).not.toHaveBeenCalled();
    expect(getWork.useModelGetWork().state.progress).toBe('等正在进行的装载结束…');
    session.end();
    const report = await pending;
    expect(report.ok).toBe(true);
    expect(mocks.health).toHaveBeenCalledTimes(1);
  });

  it('captureGetWorkWatermarks：读的是调用那一刻 /dbnums 缓存里的水位，之后缓存变了不跟着变；没有的库回空', async () => {
    const { getWork } = await load();
    mocks.peekDbnums.mockReturnValue({ fetchedAt: 0, response: { dbnums: [{ dbnum: 8000, model_sesno: 1143, file_latest_sesno: 1146 }, { dbnum: 7009, model_sesno: 0 }] } });
    const markOf = getWork.captureGetWorkWatermarks();
    mocks.peekDbnums.mockReturnValue({ fetchedAt: 1, response: { dbnums: [{ dbnum: 8000, model_sesno: 1149, file_latest_sesno: 1149 }] } });
    expect(markOf(8000)).toEqual({ modelSesno: 1143, fileLatestSesno: 1146 });
    expect(markOf(7009)).toEqual({ modelSesno: 0, fileLatestSesno: null });
    expect(markOf(1)).toEqual({ modelSesno: null, fileLatestSesno: null });

    mocks.peekDbnums.mockReturnValue(null);
    expect(getWork.captureGetWorkWatermarks()(8000)).toEqual({ modelSesno: null, fileLatestSesno: null });
  });
});

describe('useModelGetWork：补几处边角', () => {
  it('场景换了一个（查看器重挂）：旧的那个再撤，不影响新的', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry(SITE, { staleReason: '后端已经重新生成，屏幕上还没换上' })]);
    mocks.facts.mockResolvedValue(facts('latest'));
    const oldScene = scenePort({ [SITE]: ['a'] });
    const newScene = scenePort({ [SITE]: ['a'] });
    const offOld = getWork.registerGetWorkScene(oldScene);
    getWork.registerGetWorkScene(newScene);
    offOld();
    await getWork.requestGetWork();
    expect(oldScene.reload).not.toHaveBeenCalled();
    expect(newScene.reload).toHaveBeenCalledWith(SITE);
  });

  it('整库显示过的库：库文件前进后查一次 SITE 名单（先清根名单的缓存），后端有模型的新 SITE 装进来、记成已在管', async () => {
    const { getWork, registry } = await load();
    registry.noteGetWorkDbnumScope(8000, { sites: [SITE], discover: true, fileLatestSesno: 1143 });
    const worldRoot = vi.fn(async () => ({ success: true, node: { refno: 'gm-root:P:ALL', name: 'P / ALL', noun: 'WORL', owner: null, children_count: 2, dbnum: null } }));
    const children = vi.fn(async () => ({
      success: true, parent_refno: 'gm-root:P:ALL', truncated: false,
      children: [
        { refno: SITE, name: '/AIOS-INC-SITE', noun: 'SITE', owner: 'gm-root:P:ALL', children_count: 1, dbnum: 8000 },
        { refno: '24384_30000', name: '/NEW-SITE', noun: 'SITE', owner: 'gm-root:P:ALL', children_count: 1, dbnum: 8000 },
        { refno: '24381_2', name: '/OTHER-LIB', noun: 'SITE', owner: 'gm-root:P:ALL', children_count: 1, dbnum: 7997 },
      ],
    }));
    mocks.treeExtras = { worldRoot, children };
    mocks.facts.mockResolvedValue(facts('latest'));
    const scene = scenePort();
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(mocks.invalidateTree).toHaveBeenCalled();
    expect(worldRoot).toHaveBeenCalledTimes(1);
    expect(mocks.facts).toHaveBeenCalledWith(expect.objectContaining({ refno: '24384_30000' }));
    expect(scene.reload).toHaveBeenCalledTimes(1);
    expect(scene.reload).toHaveBeenCalledWith('24384_30000');
    expect(report.models.loadedNew).toEqual([{ refno: '24384_30000', name: '/NEW-SITE', total: 1 }]);
    const [scope] = registry.getWorkRegisteredScopes();
    expect([...scope!.knownSites].sort()).toEqual(['24384_30000', SITE].sort());
    expect(scope!.checkedFileLatestSesno).toBe(1146);
  });
});