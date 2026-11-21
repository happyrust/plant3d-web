/**
 * 「取最新」按节点版本表精准重载（gen-model #325 + #323 能力协商）：
 * 后端同时声明 `node_versions_since_fastpath` 与 `node_versions_ancestor_placement` 时，
 * 同库未改节点、仅改名（K22）、原值重写（K23）不再多余重载；上级移位（K32）精准重载；
 * 缺任一能力时安全退回 `assumeChangedSince`。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  health: vi.fn(async (): Promise<{ generation: number }> => ({ generation: 0 })),
  refreshVerdict: vi.fn(async () => undefined),
  capabilities: null as Record<string, unknown> | null,
  dbnums: vi.fn(async (_options?: unknown): Promise<{ dbnums: Record<string, unknown>[] }> => ({ dbnums: [] })),
  peekDbnums: vi.fn((): { fetchedAt: number; response: { dbnums: Record<string, unknown>[] } } | null => null),
  entries: vi.fn((): Record<string, unknown>[] => []),
  facts: vi.fn(async (_query: { refno: string }): Promise<Record<string, unknown> | null> => null),
  ancestors: vi.fn(async (_refno: string): Promise<{ success: boolean; refnos: string[]; error_message?: string }> => ({ success: true, refnos: [] })),
  listNodeVersions: vi.fn(async (_dbnum: number, _refno: string, _scope?: string, _options?: unknown) => (
    { versions: [] as { sesno: number; sessionTime: string | null; impact: string; unitsChanged: number }[] }
  )),
  dismissNotice: vi.fn(),
  toast: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock('@/composables/useGenModelV1Health', () => ({
  ensureGenModelV1Freshness: () => mocks.health(),
  useGenModelV1Health: () => ({ refreshVerdict: mocks.refreshVerdict, state: { get capabilities() { return mocks.capabilities; } } }),
}));
vi.mock('@/composables/useGenModelV1Dbnums', () => ({
  getGenModelV1Dbnums: (options: unknown) => mocks.dbnums(options),
  peekGenModelV1Dbnums: () => mocks.peekDbnums(),
}));
vi.mock('@/composables/useLoadedNodeStatus', () => ({ useLoadedNodeStatus: () => ({ entries: () => mocks.entries() }) }));
vi.mock('@/composables/nodeModelFacts', async () => {
  const actual = await vi.importActual<typeof import('@/composables/nodeModelFacts')>('@/composables/nodeModelFacts');
  return {
    ...actual,
    fetchNodeModelFacts: (query: { refno: string }) => mocks.facts(query),
  };
});
vi.mock('@/composables/useGenModelV1UpdateNotice', () => ({ dismissGenModelV1UpdateNotice: () => mocks.dismissNotice() }));
vi.mock('@/ribbon/toastBus', () => ({ emitToast: (payload: unknown) => mocks.toast(payload) }));
vi.mock('@/composables/useConsoleStore', () => ({ useConsoleStore: () => ({ addLog: mocks.addLog }) }));
vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    tree: { ancestors: mocks.ancestors, invalidate: vi.fn() },
    versions: { listNodeVersions: mocks.listNodeVersions },
  }),
}));

const ROW_8000 = {
  dbnum: 8000, db_type: 'DESI', initialized: true, file_latest_sesno: 1146, applied_sesno: 1146, model_sesno: 1146, model_verdict: 'in_sync', excluded: false,
};
const EQ_A = '24384_47469';
const EQ_B = '24384_47470';
const EQ_C = '24384_47471';

function latestFacts(modelSesno = 1146) {
  return {
    verdict: 'latest', verdictReason: null, dbnum: 8000, noun: 'EQUI', unitRoot: null,
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

function scenePort(loaded: Record<string, string[]>) {
  return {
    reload: vi.fn(async (refno: string) => {
      loaded[refno] = [...(loaded[refno] ?? [])];
      return true;
    }),
    withdraw: vi.fn(() => 0),
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
  return { getWork };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (typeof mock === 'function') mock.mockReset();
  }
  mocks.capabilities = { node_versions_since_fastpath: true, node_versions_ancestor_placement: true };
  mocks.health.mockResolvedValue({ generation: 0 });
  mocks.refreshVerdict.mockResolvedValue(undefined);
  mocks.dbnums.mockResolvedValue({ dbnums: [ROW_8000] });
  mocks.peekDbnums.mockReturnValue(null);
  mocks.entries.mockReturnValue([]);
  mocks.facts.mockResolvedValue(latestFacts());
  mocks.ancestors.mockResolvedValue({ success: true, refnos: [] });
  mocks.listNodeVersions.mockResolvedValue({ versions: [] });
});

describe('useModelGetWork 精准节点版本表判定（#325）', () => {
  it('同库装载 3 个节点但只改了 EQ_A：只重载 EQ_A，未改动的 EQ_B / EQ_C 不跟着重载（消除 KG3）', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry(EQ_A), tableEntry(EQ_B), tableEntry(EQ_C)]);
    mocks.listNodeVersions.mockImplementation(async (_dbnum, refno) => ({
      versions: refno === EQ_A
        ? [{ sesno: 1146, sessionTime: null, impact: 'mesh', unitsChanged: 1 }]
        : [],
    }));
    const scene = scenePort({ [EQ_A]: ['b1'], [EQ_B]: ['b2'], [EQ_C]: ['b3'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(mocks.listNodeVersions).toHaveBeenCalledTimes(3);
    expect(mocks.listNodeVersions).toHaveBeenCalledWith(8000, EQ_A, 'subtree', expect.objectContaining({ sinceSesno: 1143 }));
    expect(scene.reload).toHaveBeenCalledTimes(1);
    expect(scene.reload).toHaveBeenCalledWith(EQ_A);
    expect(report.models.reloaded.map((item) => item.refno)).toEqual([EQ_A]);
  });

  it('K22 仅改名（impact=noop）与 K23 原值重写（versions=[]）：0 个节点重载，报告已是最新', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry(EQ_A), tableEntry(EQ_B)]);
    mocks.listNodeVersions.mockImplementation(async (_dbnum, refno) => ({
      versions: refno === EQ_A
        ? [{ sesno: 1146, sessionTime: null, impact: 'noop', unitsChanged: 0 }]
        : [],
    }));
    const scene = scenePort({ [EQ_A]: ['b1'], [EQ_B]: ['b2'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(scene.reload).not.toHaveBeenCalled();
    expect(report.models.reloaded).toEqual([]);
    expect(report.summary).toContain('已是最新');
  });

  it('K32 上级移位（#323 传播 impact=placement）：仅装下级节点也能精准重载', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry(EQ_A), tableEntry(EQ_B)]);
    mocks.listNodeVersions.mockImplementation(async (_dbnum, refno) => ({
      versions: refno === EQ_A
        ? [{ sesno: 1146, sessionTime: null, impact: 'placement', unitsChanged: 1 }]
        : [],
    }));
    const scene = scenePort({ [EQ_A]: ['b1'], [EQ_B]: ['b2'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(scene.reload).toHaveBeenCalledTimes(1);
    expect(scene.reload).toHaveBeenCalledWith(EQ_A);
    expect(report.models.reloaded.map((item) => item.refno)).toEqual([EQ_A]);
  });

  it.each<[string, Record<string, unknown> | null]>([
    ['缺少能力声明（旧后端）', null],
    ['只声明 since_fastpath、缺 #323 ancestor_placement（防 K32 漏重载）', { node_versions_since_fastpath: true }],
    ['只声明 ancestor_placement、缺 #325 since_fastpath（防长链超时）', { node_versions_ancestor_placement: true }],
  ])('%s：安全退回 assumeChangedSince，不发 listNodeVersions 请求', async (_label, caps) => {
    const { getWork } = await load();
    mocks.capabilities = caps;
    mocks.entries.mockReturnValue([tableEntry(EQ_A), tableEntry(EQ_B)]);
    const scene = scenePort({ [EQ_A]: ['b1'], [EQ_B]: ['b2'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(mocks.listNodeVersions).not.toHaveBeenCalled();
    expect(scene.reload).toHaveBeenCalledTimes(2);
    expect(report.models.reloaded.map((item) => item.refno)).toEqual([EQ_A, EQ_B]);
  });

  it('查询节点版本表遇瞬时 503 SOURCE_CHANGED（#321）：按短退避补试一次并成功完成精准重载', async () => {
    const { getWork } = await load();
    mocks.entries.mockReturnValue([tableEntry(EQ_A), tableEntry(EQ_B)]);
    let eqACalls = 0;
    mocks.listNodeVersions.mockImplementation(async (_dbnum, refno) => {
      if (refno === EQ_A) {
        eqACalls += 1;
        if (eqACalls === 1) {
          throw Object.assign(new Error('source changed while opening'), { status: 503, code: 'SOURCE_CHANGED', retryAfterMs: 10 });
        }
        return { versions: [{ sesno: 1146, sessionTime: null, impact: 'mesh', unitsChanged: 1 }] };
      }
      return { versions: [] };
    });
    const scene = scenePort({ [EQ_A]: ['b1'], [EQ_B]: ['b2'] });
    getWork.registerGetWorkScene(scene);

    const report = await getWork.requestGetWork();

    expect(eqACalls).toBe(2);
    expect(scene.reload).toHaveBeenCalledTimes(1);
    expect(scene.reload).toHaveBeenCalledWith(EQ_A);
    expect(report.models.reloaded.map((item) => item.refno)).toEqual([EQ_A]);
    expect(report.models.kept).toEqual([]);
  });
});
