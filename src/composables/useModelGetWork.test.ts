/**
 * 「取最新」的接线（`useModelGetWork`）：引擎接到真实模块上的那一层。后台、已加载节点表、数据源换成假的；
 * 选中、加载会话、登记表用真的。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TreeRefreshReport } from '@/composables/pdmsTreeRefresh';

const mocks = vi.hoisted(() => ({
  health: vi.fn(async (): Promise<{ generation: number }> => ({ generation: 0 })),
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
  // 服务代次从 0 起（页面打开以来没见过后端换）
  mocks.health.mockResolvedValue({ generation: 0 });
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
    // 不在后端更新范围的库：库文件到了 1146，模型还停在本页装的那一版 1143
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

  it('节点落后（后台的模型没跟上库文件）、但库里的模型已经比本页装的新：重载换上后台现有的那一版，并说明还落后', async () => {
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
    expect(report.models.kept).toEqual([{ refno: SITE, reason: '这个节点落后（模型生成之后又有会话改到了它）：这次换上的是后台现有的那一版；行上的「更新」可让后端追上' }]);
  });

  it('节点落后、库里的模型并不比本页装的新（没有可换的新版）：不重载，照实说没有可换的', async () => {
    const { getWork } = await load();
    mocks.dbnums.mockResolvedValue({ dbnums: [{ ...ROW_8000, file_latest_sesno: 1149, excluded: true, excluded_reason: 'watch_dbnums' }] });
    // 本页装的就是库里现有的那一版（1146）；装的时候库文件在 1146，现在到了 1149
    mocks.entries.mockReturnValue([tableEntry(SITE, { loadedModelSesno: 1146, loadedFileLatestSesno: 1146 })]);
    mocks.facts.mockResolvedValue(facts('lagging'));
    const scene = scenePort({ [SITE]: ['24384_26549'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(mocks.facts).toHaveBeenCalledTimes(1);
    expect(scene.reload).not.toHaveBeenCalled();
    expect(report.models.reloaded).toEqual([]);
    expect(report.models.kept).toEqual([{ refno: SITE, reason: '这个节点落后（模型生成之后又有会话改到了它），屏幕上的没有可换的新版；行上的「更新」可让后端追上' }]);
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
    // 不在后端更新范围的库：模型还在本页装的 1146，库文件到了 1149
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
    // 不在后端更新范围的库：模型在 1146，库文件又前进到了 1149
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

  // 不在后端更新范围的库：库一级的模型停在 1146，库文件到了 1149；节点的模型是后端按需生成的、已在 1149 上（做过节点一级的更新），后端说最新
  const GAP_ROW = { ...ROW_8000, file_latest_sesno: 1149, excluded: true, excluded_reason: 'watch_dbnums' };
  const ownLatest = {
    ...facts('latest'),
    generatedAt: { sesnoMin: 1149, sesnoMax: 1149, timeMin: null, timeMax: null, basis: 'own_generation' },
    library: { fileLatestSesno: 1149, modelSesno: 1146, modelSesnoTime: null, inWatchScope: false },
  };

  it('已加载节点表记下的「装上时后端那一版」带给引擎：和后端现在的是同一版，才说页面上装着的节点已是最新', async () => {
    const { getWork } = await load();
    mocks.dbnums.mockResolvedValue({ dbnums: [GAP_ROW] });
    mocks.facts.mockResolvedValue(ownLatest);
    mocks.entries.mockReturnValue([tableEntry(SITE, {
      loadedModelSesno: 1146, loadedFileLatestSesno: 1149, loadedGenerated: { sesnoMin: 1149, sesnoMax: 1149, laggingUnits: 0 },
    })]);
    const scene = scenePort({ [SITE]: ['a'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(scene.reload).not.toHaveBeenCalled();
    expect(report.libraries).toEqual([]);
    expect(report.libraryFacts).toEqual(['库 8000 不在后端更新范围里（库一级的模型停在会话 1146，库文件已到 1149）；页面上装着的 1 个节点已是最新']);
  });

  it.each<[string, Record<string, unknown>]>([
    ['表里还没记下（状态没问回来、旧后端）', {}],
    ['记的是「当时后端说不出」', { loadedGenerated: null }],
    ['记下的和后端现在的不是同一版（装上之后别的页面让后端重新生成过）', { loadedGenerated: { sesnoMin: 1146, sesnoMax: 1146, laggingUnits: 2 } }],
  ])('%s：核对不出屏幕上装的是不是后端现在的那一版，照库一级的原话说没跟到最新', async (_name, patch) => {
    const { getWork } = await load();
    mocks.dbnums.mockResolvedValue({ dbnums: [GAP_ROW] });
    mocks.facts.mockResolvedValue(ownLatest);
    mocks.entries.mockReturnValue([tableEntry(SITE, { loadedModelSesno: 1146, loadedFileLatestSesno: 1149, ...patch })]);
    const scene = scenePort({ [SITE]: ['a'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(scene.reload).not.toHaveBeenCalled();
    expect(report.libraryFacts).toEqual([]);
    expect(report.libraries).toEqual([
      { dbnum: 8000, kind: 'out_of_scope', text: '库 8000 不在后端更新范围里：模型停在会话 1146，库文件已到 1149（树已是最新，模型不会自动跟上）' },
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

describe('loadedModelDbnums：页面上装着节点的库（状态栏「数据已更新」的提示拿它判断一个批次和本页有没有关系）', () => {
  it('已加载节点表里装着的节点、取最新登记的直装根、整库显示过的库都算；同一个库只算一次', async () => {
    const { getWork, registry } = await load();
    mocks.entries.mockReturnValue([
      tableEntry('24384_47463'),
      tableEntry('24384_47500'),
      tableEntry('24382_1911', { dbnum: 7998 }),
    ]);
    registry.noteGetWorkRoot('24381_101405', 7997, { modelSesno: 738, fileLatestSesno: 748 }, 'show_refno');
    registry.noteGetWorkDbnumScope(1112, { sites: [], discover: true, fileLatestSesno: 12 });

    expect(getWork.loadedModelDbnums().sort((a, b) => a - b)).toEqual([1112, 7997, 7998, 8000]);
  });

  it('只是点过、没有模型可显示的节点（loaded = false）不算：它的库有变化不该为它提示', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry('24382_1911', { dbnum: 7998, loaded: false })]);

    expect(getWork.loadedModelDbnums()).toEqual([]);
  });

  it('每次问都是此刻的名单：节点撤掉之后它的库就不算了', async () => {
    const { getWork, registry } = await load();
    expect(getWork.loadedModelDbnums()).toEqual([]);
    mocks.entries.mockReturnValue([tableEntry('24384_47463')]);
    registry.noteGetWorkRoot('24382_1911', 7998, { modelSesno: 675, fileLatestSesno: 675 }, 'debug_refno');
    expect(getWork.loadedModelDbnums().sort((a, b) => a - b)).toEqual([7998, 8000]);

    mocks.entries.mockReturnValue([]);
    registry.forgetGetWorkRoot('24382_1911');
    expect(getWork.loadedModelDbnums()).toEqual([]);
  });

  it('只整库显示过（已加载节点表是空的、也没有直装的根）：这个库照样算', async () => {
    const { getWork, registry } = await load();
    registry.noteGetWorkDbnumScope(8000, { sites: [SITE], discover: true, fileLatestSesno: 1146 });

    expect(getWork.loadedModelDbnums()).toEqual([8000]);
  });

  it('只有地址栏直装的根（不在已加载节点表里）：它的库照样算', async () => {
    const { getWork, registry } = await load();
    registry.noteGetWorkRoot('24381_101405', 7997, { modelSesno: 738, fileLatestSesno: 748 }, 'show_refno');

    expect(getWork.loadedModelDbnums()).toEqual([7997]);
  });
});

describe('useModelGetWork：头一次点取最新就认得出「本页打开之后后端重启过」', () => {
  // 2026-11-12 真实后端上撞到的：装了 7998 的一个 ZONE（未初始化的库，模型按需生成、只在后端内存里）→ 后端重启 →
  // 头一次点取最新。原来没有可比的服务代次，说的是「已是最新」。
  const X_ZONE = '24382_1911';
  const ROW_7998 = {
    dbnum: 7998, db_type: 'DESI', initialized: false, file_latest_sesno: 675, applied_sesno: 0, model_sesno: 0,
    model_verdict: 'not_judged', excluded: true, excluded_reason: 'watch_dbnums',
  };
  const notGenerated = {
    ...facts('not_generated', 0), dbnum: 7998, noun: 'ZONE', generatedAt: null,
    units: { total: 1, generated: 0, missing: 1, failed: 0, lagging: 0, exact: true },
    // 缺的那个单元要生成：行上给的是「生成」，取最新的话跟着它说
    precheck: { unitsToGenerate: 1, needsConfirm: false, thresholdUnits: 20 },
    library: { fileLatestSesno: 675, modelSesno: 0, modelSesnoTime: null, inWatchScope: false },
  };

  it('页面打开时服务代次是 0、现在是 1：认出重启；后端说这个节点没生成——不重载、不撤，说它没有被当成已删除', async () => {
    const { getWork } = await load();
    mocks.dbnums.mockResolvedValue({ dbnums: [ROW_7998] });
    mocks.entries.mockReturnValue([tableEntry(X_ZONE, { dbnum: 7998, loadedModelSesno: 0, loadedFileLatestSesno: 675 })]);
    mocks.health.mockResolvedValue({ generation: 1 });
    mocks.facts.mockResolvedValue(notGenerated);
    const scene = scenePort({ [X_ZONE]: ['24382_1913'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(report.backendRestarted).toBe(true);
    expect(mocks.facts).toHaveBeenCalledWith(expect.objectContaining({ refno: X_ZONE }));
    expect(scene.reload).not.toHaveBeenCalled();
    expect(scene.withdraw).not.toHaveBeenCalled();
    expect(report.models.kept).toEqual([{
      refno: X_ZONE,
      reason: '后端重启过，后端现在没有这个节点的模型，屏幕上的保持原样（不当成已删除）；行上的「生成」可重新生成',
    }]);
    expect(report.summary).toBe('已取最新：1 个节点的模型没有动。');
    expect(report.detail).toContain('这次取最新之前后端重启过');
    expect(report.level).toBe('warning');
  });

  it('服务代次没变（还是 0）：不算重启，水位没变的节点不问，照说「已是最新」', async () => {
    const { getWork } = await load();
    mocks.dbnums.mockResolvedValue({ dbnums: [ROW_7998] });
    mocks.entries.mockReturnValue([tableEntry(X_ZONE, { dbnum: 7998, loadedModelSesno: 0, loadedFileLatestSesno: 675 })]);
    mocks.facts.mockResolvedValue(notGenerated);
    getWork.registerGetWorkScene(scenePort({ [X_ZONE]: ['24382_1913'] }));

    const report = await getWork.requestGetWork();

    expect(report.backendRestarted).toBe(false);
    expect(mocks.facts).not.toHaveBeenCalled();
    expect(report.summary).toBe('已是最新：模型树和已装的模型都没有变化（核对了 1 个已装的节点）。');
  });

  it('页面打开之后后端重启过不止一次（服务代次 0 → 2）：头一轮认出重启；再点一轮代次没再变，不再算重启', async () => {
    const { getWork } = await load();
    mocks.dbnums.mockResolvedValue({ dbnums: [ROW_7998] });
    mocks.entries.mockReturnValue([tableEntry(X_ZONE, { dbnum: 7998, loadedModelSesno: 0, loadedFileLatestSesno: 675 })]);
    mocks.health.mockResolvedValue({ generation: 2 });
    mocks.facts.mockResolvedValue(notGenerated);
    const scene = scenePort({ [X_ZONE]: ['24382_1913'] });
    getWork.registerGetWorkScene(scene);

    const first = await getWork.requestGetWork();
    expect(first.backendRestarted).toBe(true);
    expect(first.detail).toContain('这次取最新之前后端重启过');
    expect(scene.reload).not.toHaveBeenCalled();
    expect(scene.withdraw).not.toHaveBeenCalled();

    const second = await getWork.requestGetWork();
    expect(second.backendRestarted).toBe(false);
    expect(second.detail).not.toContain('这次取最新之前后端重启过');
    expect(scene.withdraw).not.toHaveBeenCalled();
  });

  it('withdrawnEmpty 的节点纳入取最新与 loadedModelDbnums，几何恢复时重新装回；单纯没装过的节点（loaded=false 且非 withdrawnEmpty）仍不纳入', async () => {
    const { getWork } = await load();
    const EQ_A = '24384_30010';
    const NEVER_LOADED = '24384_30099';
    mocks.entries.mockReturnValue([
      tableEntry(EQ_A, { loaded: false, withdrawnEmpty: true, loadedModelSesno: 1144, loadedFileLatestSesno: 1144 }),
      tableEntry(NEVER_LOADED, { loaded: false, loadedModelSesno: null, loadedFileLatestSesno: null }),
    ]);
    expect(getWork.loadedModelDbnums()).toEqual([8000]);

    mocks.dbnums.mockResolvedValue({ dbnums: [{ ...ROW_8000, model_sesno: 1146, applied_sesno: 1146, file_latest_sesno: 1146 }] });
    mocks.facts.mockResolvedValue(facts('latest', 1146));
    const scene = scenePort();
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();
    expect(report.models.rootsTotal).toBe(1);
    expect(scene.reload).toHaveBeenCalledTimes(1);
    expect(scene.reload).toHaveBeenCalledWith(EQ_A);
    expect(report.models.reloaded).toEqual([{ refno: EQ_A, added: 1, removed: 0, total: 1 }]);
  });
});