import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import { changedSessionsOfNodeVersions, type NodeModelFacts } from './nodeModelStatus';

import type { DbnumRow } from '@/api/genModelV1Api';

const h = vi.hoisted(() => ({
  listNodeVersions: vi.fn(),
  refreshVerdict: vi.fn(async () => {}),
  batchListeners: new Set<(batch: { dbnum: number }) => void>(),
  healthState: null as unknown as { verdict: { rows: Record<number, unknown>; lastCheckedAt: number | null; error: string | null } },
}));

vi.mock('@/composables/useGenModelV1Health', () => ({
  useGenModelV1Health: () => ({ state: h.healthState, refreshVerdict: h.refreshVerdict }),
}));
vi.mock('@/composables/useGenModelV1UpdateNotice', () => ({
  subscribeGenModelV1FinishedBatches: (listener: (batch: { dbnum: number }) => void) => {
    h.batchListeners.add(listener);
    return () => { h.batchListeners.delete(listener); };
  },
}));

const ROW_1112: DbnumRow = {
  dbnum: 1112, db_type: 'DESI', initialized: true, file_latest_sesno: 748, applied_sesno: 738, model_sesno: 738,
  model_sesno_time: '2026-09-23T15:19:54', model_verdict: 'in_sync',
};
const ROW_8000: DbnumRow = {
  dbnum: 8000, db_type: 'DESI', initialized: true, file_latest_sesno: 1143, applied_sesno: 1143, model_sesno: 1143, model_verdict: 'in_sync',
};
const ROW_7997: DbnumRow = {
  dbnum: 7997, db_type: 'DESI', initialized: false, file_latest_sesno: 447, applied_sesno: 0, model_sesno: 0, model_verdict: 'not_judged',
};

function setRows(...rows: DbnumRow[]): void {
  h.healthState.verdict = {
    rows: Object.fromEntries(rows.map((row) => [row.dbnum, row])),
    lastCheckedAt: (h.healthState.verdict.lastCheckedAt ?? 0) + 1,
    error: null,
  };
}

function timeline(versions: { sesno: number; impact: string; unitsChanged?: number }[]) {
  return {
    dbnum: 1112, refno: '9304_2', noun: 'SITE', scope: 'subtree', unitRefno: null, unitNoun: null,
    versions: versions.map((item) => ({
      sesno: item.sesno, sessionTime: null, impact: item.impact, selfImpact: null, unitsChanged: item.unitsChanged ?? 1, unitsTouched: 1,
    })),
  };
}

/** 等判定收口：这个节点不再「核对中」 */
async function settled(store: { view: (refno: string) => { checking: boolean } | null }, refno: string): Promise<void> {
  await vi.waitFor(() => {
    const view = store.view(refno);
    expect(view !== null && !view.checking).toBe(true);
  });
}

/** 让在路上的异步步骤都走完（判定里有一次按需引入数据源） */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

async function loadStore() {
  const mod = await import('./useLoadedNodeStatus');
  const store = mod.useLoadedNodeStatus();
  // 与显示流程（useModelGeneration）接线的方式相同：问节点版本表，去掉不影响模型的会话
  store.provideChangeQuery(async ({ dbnum, refno, sinceSesno, signal }) => changedSessionsOfNodeVersions(
    (await h.listNodeVersions(dbnum, refno, 'subtree', { sinceSesno, signal })).versions,
  ));
  return store;
}

beforeEach(() => {
  vi.resetModules();
  h.healthState = reactive({ verdict: { rows: {}, lastCheckedAt: null, error: null } });
  h.listNodeVersions.mockReset();
  h.listNodeVersions.mockResolvedValue(timeline([]));
  h.refreshVerdict.mockClear();
  h.batchListeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLoadedNodeStatus（页面内的已加载节点表）', () => {
  it('节点装完登记进表，记下装的时候的水位；随后问一次「水位之后谁改到了它」，没人改就是最新', async () => {
    const store = await loadStore();
    setRows(ROW_1112);
    store.noteLoaded('9304/2', 1112, { modelSesno: 738, fileLatestSesno: 748 });

    expect(store.entry('9304_2')).toMatchObject({ refno: '9304_2', dbnum: 1112, loadedModelSesno: 738, loadedFileLatestSesno: 748 });
    expect(store.view('9304_2')).toMatchObject({ verdict: null, checking: true, title: '本节点：正在核对新旧…' });
    await settled(store, '9304_2');

    expect(h.listNodeVersions).toHaveBeenCalledTimes(1);
    expect(h.listNodeVersions).toHaveBeenCalledWith(1112, '9304_2', 'subtree', expect.objectContaining({ sinceSesno: 738 }));
    expect(store.view('9304_2')).toMatchObject({
      verdict: 'latest', iconKind: 'current', action: null, checking: false,
      title: '本节点：最新（库有 10 个新会话，未涉及本节点）\n模型按会话 738 生成（2026-09-23 15:19 保存）；库文件最新 748',
    });
  });

  it('水位之后有网格变化的会话：落后，给「更新到最新」；只有无几何变化（noop）的会话不算', async () => {
    const store = await loadStore();
    setRows(ROW_1112);
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 740, impact: 'noop' }, { sesno: 742, impact: 'mesh', unitsChanged: 3 }]));
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '9304_2');
    expect(store.view('9304_2')).toMatchObject({ verdict: 'lagging', iconKind: 'stale', action: 'update' });
    expect(store.view('9304_2')!.title).toContain('落后：会话 742（3 个单元）改到了本节点');

    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 740, impact: 'noop' }, { sesno: 741, impact: 'noop' }]));
    store.noteLoaded('9304_3', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '9304_3');
    expect(store.view('9304_3')).toMatchObject({ verdict: 'latest' });
  });

  it.each(['placement', 'delivery', 'tombstone'])('影响是 %s（位置变 / 新增 / 删除）也算改到了', async (impact) => {
    const store = await loadStore();
    setRows(ROW_1112);
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 745, impact }]));
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '9304_2');
    expect(store.view('9304_2')!.verdict).toBe('lagging');
  });

  it('接口失败：标成未知并带上原因，不抛错、不挡显示', async () => {
    const store = await loadStore();
    setRows(ROW_1112);
    h.listNodeVersions.mockRejectedValueOnce(new Error('timeout: node/versions'));
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '9304_2');
    expect(store.view('9304_2')).toMatchObject({ verdict: 'unknown', iconKind: null, action: null });
    expect(store.view('9304_2')!.title).toContain('新旧未知（timeout: node/versions）');
  });

  it('未初始化的库、三枚水位对齐的库：不发请求就有结论', async () => {
    const store = await loadStore();
    setRows(ROW_7997, ROW_8000);
    store.noteLoaded('24381_535', 7997, { modelSesno: 0, fileLatestSesno: 447 });
    store.noteLoaded('24384_26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 });
    await settled(store, '24381_535');
    await settled(store, '24384_26547');
    expect(store.view('24381_535')).toMatchObject({ verdict: 'untracked', iconKind: null });
    expect(store.view('24384_26547')).toMatchObject({ verdict: 'latest', title: '本节点：最新\n模型按会话 1143 生成；库文件最新 1143' });
    expect(h.listNodeVersions).not.toHaveBeenCalled();
  });

  it('同时在问的不超过 2 个节点（node/versions 冷算要一两秒的后端计算）', async () => {
    const store = await loadStore();
    setRows(ROW_1112);
    const releases: (() => void)[] = [];
    h.listNodeVersions.mockImplementation(() => new Promise((resolve) => { releases.push(() => resolve(timeline([]))); }));
    for (const refno of ['1_1', '1_2', '1_3', '1_4']) store.noteLoaded(refno, 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(2));
    await flush();
    expect(h.listNodeVersions).toHaveBeenCalledTimes(2);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach((release) => release());
    await settled(store, '1_4');
    expect(store.view('1_4')!.verdict).toBe('latest');
  });

  it('库的水位变了（/dbnums 重拉之后）：只对这个库里已加载的节点重问一次', async () => {
    const store = await loadStore();
    setRows(ROW_1112, ROW_8000);
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    store.noteLoaded('24384_26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 });
    await settled(store, '9304_2');
    expect(h.listNodeVersions).toHaveBeenCalledTimes(1);

    // 同样的水位再来一遍：不重问
    setRows(ROW_1112, ROW_8000);
    await nextTick();
    await settled(store, '9304_2');
    expect(h.listNodeVersions).toHaveBeenCalledTimes(1);

    // 1112 的库文件多了一个会话（有人保存了），这个会话改到了本节点
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 749, impact: 'mesh', unitsChanged: 2 }]));
    setRows({ ...ROW_1112, file_latest_sesno: 749 }, ROW_8000);
    await nextTick();
    await settled(store, '9304_2');
    expect(h.listNodeVersions).toHaveBeenCalledTimes(2);
    expect(store.view('9304_2')).toMatchObject({ verdict: 'lagging', action: 'update' });
    expect(store.view('24384_26547')!.verdict).toBe('latest');
  });

  it('库的模型水位前进、其间有会话改到了本节点：变成「有更新可重载」；重载完重新登记就回到最新', async () => {
    const store = await loadStore();
    setRows(ROW_1112);
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '9304_2');

    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 742, impact: 'mesh', unitsChanged: 2 }]));
    setRows({ ...ROW_1112, applied_sesno: 748, model_sesno: 748 });
    await nextTick();
    await settled(store, '9304_2');
    expect(h.listNodeVersions).toHaveBeenLastCalledWith(1112, '9304_2', 'subtree', expect.objectContaining({ sinceSesno: 738 }));
    expect(store.view('9304_2')).toMatchObject({ verdict: 'reloadable', iconKind: 'reloadable', action: 'reload' });

    store.noteLoaded('9304_2', 1112, { modelSesno: 748, fileLatestSesno: 748 });
    await settled(store, '9304_2');
    expect(store.view('9304_2')).toMatchObject({ verdict: 'latest', action: null });
  });

  it('库状态当时还没取到：先标未知；行到了再判', async () => {
    const store = await loadStore();
    store.noteLoaded('9304_2', 1112, { modelSesno: null, fileLatestSesno: null });
    await settled(store, '9304_2');
    expect(store.view('9304_2')!.verdict).toBe('unknown');
    setRows(ROW_1112);
    await nextTick();
    await settled(store, '9304_2');
    expect(store.view('9304_2')!.verdict).toBe('latest');
  });

  it('判定还在路上时库状态到了：这一次回来之后按新的水位再判一次，不用等下一分钟', async () => {
    const store = await loadStore();
    setRows(ROW_1112);
    let release!: () => void;
    h.listNodeVersions
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(timeline([])); }))
      .mockResolvedValueOnce(timeline([{ sesno: 749, impact: 'mesh', unitsChanged: 2 }]));
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));

    // 第一次还没回来，库文件多了一个会话
    setRows({ ...ROW_1112, file_latest_sesno: 749 });
    await nextTick();
    await flush();
    expect(h.listNodeVersions).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(2));
    await settled(store, '9304_2');
    expect(store.view('9304_2')!.verdict).toBe('lagging');
  });

  it('表里有节点时每分钟重拉一次 /dbnums；表空了就停', async () => {
    vi.useFakeTimers();
    const store = await loadStore();
    setRows(ROW_8000);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(h.refreshVerdict).not.toHaveBeenCalled();

    store.noteLoaded('24384_26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(h.refreshVerdict).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.refreshVerdict).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.refreshVerdict).toHaveBeenCalledTimes(2);

    store.forget('24384_26547');
    await vi.advanceTimersByTimeAsync(180_000);
    expect(h.refreshVerdict).toHaveBeenCalledTimes(2);
  });

  it('后端跑完一个数据批次（任务流）：这个库有已加载的节点就立刻重拉 /dbnums，别的库不理', async () => {
    const store = await loadStore();
    setRows(ROW_1112);
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '9304_2');
    for (const listener of h.batchListeners) listener({ dbnum: 8000 });
    expect(h.refreshVerdict).not.toHaveBeenCalled();
    for (const listener of h.batchListeners) listener({ dbnum: 1112 });
    expect(h.refreshVerdict).toHaveBeenCalledTimes(1);
  });

  it('forget / reset：撤表；还在路上的判定回来也不写回', async () => {
    const store = await loadStore();
    setRows(ROW_1112);
    let release!: () => void;
    h.listNodeVersions.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(timeline([{ sesno: 742, impact: 'mesh' }])); }));
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    store.forget('9304_2');
    release();
    await flush();
    expect(store.view('9304_2')).toBeNull();
    expect(store.entries().length).toBe(0);

    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    store.reset();
    expect(store.entries()).toEqual([]);
    expect(h.batchListeners.size).toBe(0);
  });

  it('recheck：人点一下就重问这个节点', async () => {
    const store = await loadStore();
    setRows(ROW_1112);
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '9304_2');
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 746, impact: 'mesh' }]));
    store.recheck('9304_2');
    await settled(store, '9304_2');
    expect(h.listNodeVersions).toHaveBeenCalledTimes(2);
    expect(store.view('9304_2')!.verdict).toBe('lagging');
  });
});

describe('useLoadedNodeStatus（接上后端的节点模型状态接口）', () => {
  /** 接口给的事实（已经翻成驼峰）：缺省是 7997 那个 21 个单元、一个都没生成的 SITE */
  function facts(patch: Partial<NodeModelFacts> = {}): NodeModelFacts {
    return {
      verdict: 'not_generated', verdictReason: null, dbnum: 7997, noun: 'SITE', unitRoot: null,
      units: { total: 21, generated: 0, missing: 21, failed: 0, lagging: 0, exact: true },
      generatedAt: null, changes: null,
      precheck: { unitsToGenerate: 21, needsConfirm: true, thresholdUnits: 20 },
      library: { fileLatestSesno: 447, modelSesno: null, modelSesnoTime: null, inWatchScope: true },
      ...patch,
    };
  }
  const OWN_447 = { sesnoMin: 447, sesnoMax: 447, timeMin: null, timeMax: null, basis: 'own_generation' as const };

  async function loadStoreWithFacts() {
    const store = await loadStore();
    const fetchFacts = vi.fn(async (_query: { refno: string; signal?: AbortSignal }): Promise<NodeModelFacts | null> => facts());
    store.provideFactsQuery(fetchFacts);
    return { store, fetchFacts };
  }

  it('点过、但没有模型可显示的节点也登记一行：行上说得出「未生成」并给「生成」；它不算已加载', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_7997);
    store.noteWithoutModel('24381/535', 7997);

    expect(store.entry('24381_535')).toMatchObject({ refno: '24381_535', dbnum: 7997, loaded: false, loadedModelSesno: null });
    await settled(store, '24381_535');
    expect(fetchFacts).toHaveBeenCalledWith(expect.objectContaining({ refno: '24381_535' }));
    expect(store.view('24381_535')).toMatchObject({
      verdict: 'not_generated', iconKind: 'empty', action: 'generate',
      title: '本节点：未生成：21 个单元都没有模型\n点眼睛或「生成」：生成并显示',
    });
    // 未初始化的库也答得出，节点版本表不用问
    expect(h.listNodeVersions).not.toHaveBeenCalled();
  });

  it('生成到一半（部分生成）→ 生成完（最新）：显示流程叫一次重问，行上跟着变；按需生成不动库的水位，不会自己重问', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_7997);
    fetchFacts.mockResolvedValueOnce(facts({
      verdict: 'partial', units: { total: 21, generated: 10, missing: 11, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 11, needsConfirm: false, thresholdUnits: 20 },
    }));
    store.noteWithoutModel('24381_535', 7997);
    await settled(store, '24381_535');
    expect(store.view('24381_535')).toMatchObject({ verdict: 'partial', iconKind: 'partial', action: 'generate' });
    expect(store.view('24381_535')!.title).toContain('部分生成：21 个单元里有 11 个没有模型');

    // 同样的库状态再来一遍：不重问
    setRows(ROW_7997);
    await nextTick();
    await flush();
    expect(fetchFacts).toHaveBeenCalledTimes(1);

    fetchFacts.mockResolvedValueOnce(facts({
      verdict: 'latest', units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    }));
    store.noteLoaded('24381_535', 7997, { modelSesno: 0, fileLatestSesno: 447 });
    await settled(store, '24381_535');
    expect(store.entry('24381_535')!.loaded).toBe(true);
    expect(store.view('24381_535')).toMatchObject({ verdict: 'latest', iconKind: 'current', action: null });
    expect(store.view('24381_535')!.title).toContain('模型是后端这次运行期间按需生成的，对应会话 447');
  });

  it('后端说已经没有要生成的单元：这一页里留着的那颗「生成」作废（上次停下之后它在后台做完了）；还缺的时候留着', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    const fill = await import('./generationFillState');
    fill.__resetGenerationFillStateForTests();
    setRows(ROW_7997);
    fill.notePendingGenerationFill({ root: '24381_147826', dbnum: 7997, chunks: 1, units: 13, exact: true, reason: 'stopped' });
    fetchFacts.mockResolvedValueOnce(facts({
      verdict: 'partial', units: { total: 13, generated: 1, missing: 12, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 12, needsConfirm: false, thresholdUnits: 20 },
    }));
    store.noteWithoutModel('24381_147826', 7997);
    await settled(store, '24381_147826');
    expect(fill.pendingGenerationFill('24381_147826')).not.toBeNull();

    fetchFacts.mockResolvedValueOnce(facts({
      verdict: 'latest', units: { total: 13, generated: 13, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    }));
    store.recheck('24381_147826');
    await settled(store, '24381_147826');
    expect(store.view('24381_147826')).toMatchObject({ verdict: 'latest', action: null });
    expect(fill.pendingGenerationFill('24381_147826')).toBeNull();
  });

  it('过一会儿再问（生成到一半被叫停，在飞的那一块后端照常算完）：到点各问一次；节点撤表了就不问；再排一次顶掉上一次', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_7997);
    fetchFacts.mockResolvedValue(facts({
      verdict: 'partial', units: { total: 21, generated: 3, missing: 18, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 18, needsConfirm: false, thresholdUnits: 20 },
    }));
    store.noteWithoutModel('24381_535', 7997);
    await settled(store, '24381_535');
    expect(fetchFacts).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    store.recheckLater('24381_535', [5_000, 20_000]);
    // 再排一次：上一次排的两次作废
    store.recheckLater('24381_535', [5_000, 20_000]);
    fetchFacts.mockResolvedValue(facts({
      verdict: 'partial', units: { total: 21, generated: 10, missing: 11, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 11, needsConfirm: false, thresholdUnits: 20 },
    }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchFacts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFacts).toHaveBeenCalledTimes(2);
    expect(store.view('24381_535')!.title).toContain('21 个单元里有 11 个没有模型');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchFacts).toHaveBeenCalledTimes(3);

    // 没登记的节点不排；撤表之后到点也不问
    store.recheckLater('24381_999', [1_000]);
    store.recheckLater('24381_535', [1_000]);
    store.forget('24381_535');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchFacts).toHaveBeenCalledTimes(3);
  });

  it('已经装在场景里的节点再报「还有没有模型的部分」：不改它那一行（本页装的那一版留着），只重问一次', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_1112);
    fetchFacts.mockResolvedValue(facts({
      verdict: 'partial', dbnum: 1112, units: { total: 6, generated: 5, missing: 1, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 738, sesnoMax: 738, timeMin: null, timeMax: null, basis: 'library_watermark' },
      precheck: { unitsToGenerate: 1, needsConfirm: false, thresholdUnits: 20 },
      library: { fileLatestSesno: 748, modelSesno: 738, modelSesnoTime: null, inWatchScope: false },
    }));
    store.noteLoaded('17496_8516', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '17496_8516');
    store.noteWithoutModel('17496_8516', 1112);
    await settled(store, '17496_8516');
    expect(store.entry('17496_8516')).toMatchObject({ loaded: true, loadedModelSesno: 738 });
    expect(fetchFacts).toHaveBeenCalledTimes(2);
    expect(store.view('17496_8516')).toMatchObject({ verdict: 'partial', action: 'generate' });
  });

  it('没有生成单元的节点：图标是短横，没有动作', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_7997);
    fetchFacts.mockResolvedValueOnce(facts({
      verdict: 'empty', noun: 'ZONE', units: { total: 0, generated: 0, missing: 0, failed: 0, lagging: 0, exact: true },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    }));
    store.noteWithoutModel('24381_179753', 7997);
    await settled(store, '24381_179753');
    expect(store.view('24381_179753')).toMatchObject({
      verdict: 'empty', iconKind: 'nothing', action: null, title: '本节点：没有要生成的模型（这个节点下没有生成单元）',
    });
  });

  it('库里的模型比本页装的新：接口说最新之后，再用节点版本表问一次其间改没改到本节点', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows({ ...ROW_1112, applied_sesno: 748, model_sesno: 748 });
    fetchFacts.mockResolvedValue(facts({
      verdict: 'latest', dbnum: 1112, units: { total: 18, generated: 18, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 748, sesnoMax: 748, timeMin: null, timeMax: null, basis: 'library_watermark' },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
      library: { fileLatestSesno: 748, modelSesno: 748, modelSesnoTime: null, inWatchScope: true },
    }));
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 742, impact: 'mesh', unitsChanged: 2 }]));
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '9304_2');
    expect(h.listNodeVersions).toHaveBeenCalledWith(1112, '9304_2', 'subtree', expect.objectContaining({ sinceSesno: 738 }));
    expect(store.view('9304_2')).toMatchObject({ verdict: 'reloadable', action: 'reload' });
  });

  it('按需生成的库里落后的节点：行上给节点一级的更新（update-node）；有模型水位、在更新范围里的库照旧是库一级的更新', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_7997, ROW_8000);
    const lagging = {
      verdict: 'lagging' as const, verdictReason: 'units_changed',
      units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 1, exact: true },
      changes: { fromSesno: 445, toSesno: 447, unitsChanged: 1, unitsAdded: 0, unitsRemoved: 0, unattributed: false },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    };
    fetchFacts.mockResolvedValueOnce(facts({ ...lagging, generatedAt: { ...OWN_447, sesnoMin: 445, sesnoMax: 445 } }));
    store.noteLoaded('24381_535', 7997, { modelSesno: 0, fileLatestSesno: 447 });
    await settled(store, '24381_535');
    expect(store.view('24381_535')).toMatchObject({ verdict: 'lagging', iconKind: 'stale', action: 'update-node' });
    expect(store.view('24381_535')!.title).toContain('这个库的模型按需生成：点「更新」让后端把这个节点下的单元按库文件最新会话重新生成');

    fetchFacts.mockResolvedValueOnce(facts({
      ...lagging, dbnum: 8000,
      generatedAt: { sesnoMin: 1143, sesnoMax: 1143, timeMin: null, timeMax: null, basis: 'library_watermark' },
      library: { fileLatestSesno: 1146, modelSesno: 1143, modelSesnoTime: null, inWatchScope: true },
    }));
    store.noteLoaded('24384_26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 });
    await settled(store, '24384_26547');
    expect(store.view('24384_26547')).toMatchObject({ verdict: 'lagging', action: 'update' });
  });

  it('记一笔「本页装的不是后端现在的那一版」（节点一级的更新做到一半停了）：后端说最新时行上给「重载」；重新登记之后这一笔清掉', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_7997);
    const latest = facts({
      verdict: 'latest', units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    });
    const lagging = facts({
      verdict: 'lagging', verdictReason: 'units_changed',
      units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 3, exact: true },
      generatedAt: { ...OWN_447, sesnoMin: 445 },
      changes: { fromSesno: 445, toSesno: 447, unitsChanged: 3, unitsAdded: 0, unitsRemoved: 0, unattributed: false },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    });
    fetchFacts.mockResolvedValue(lagging);
    store.noteLoaded('24381_535', 7997, { modelSesno: 0, fileLatestSesno: 447 });
    await settled(store, '24381_535');
    expect(store.entry('24381_535')!.staleReason).toBeNull();

    // 更新到一半停了：后端还说落后——行上照旧是「更新」（再点接着做，做完会把屏幕上的换掉）
    store.markStale('24381/535', '更新到一半停了：后端已经重新生成了一部分，屏幕上还是原来的');
    expect(store.entry('24381_535')!.staleReason).toContain('更新到一半停了');
    expect(store.view('24381_535')).toMatchObject({ verdict: 'lagging', action: 'update-node' });

    // 在飞的那一块后端做完了，现在说最新：可屏幕上还是原来的——给「重载」，不说「最新」
    fetchFacts.mockResolvedValue(latest);
    store.recheck('24381_535');
    await settled(store, '24381_535');
    expect(store.view('24381_535')).toEqual({
      verdict: 'reloadable', iconKind: 'reloadable', action: 'reload', checking: false,
      title: '本节点：有更新可重载：更新到一半停了：后端已经重新生成了一部分，屏幕上还是原来的\n点「重载」按后端现在的模型把屏幕上的换掉',
    });

    // 重载做成了：显示流程重新登记这个节点，这一笔随之清掉，行上回到「最新」
    store.noteLoaded('24381_535', 7997, { modelSesno: 0, fileLatestSesno: 447 });
    await settled(store, '24381_535');
    expect(store.entry('24381_535')!.staleReason).toBeNull();
    expect(store.view('24381_535')).toMatchObject({ verdict: 'latest', action: null });
  });

  it('那一笔只对装在场景里的节点记：不在表里的、只是点过没装进场景的不记', async () => {
    const { store } = await loadStoreWithFacts();
    setRows(ROW_7997);
    store.markStale('24381_999', '不在表里');
    expect(store.entry('24381_999')).toBeNull();
    store.noteWithoutModel('24381_535', 7997);
    await settled(store, '24381_535');
    store.markStale('24381_535', '只是点过');
    expect(store.entry('24381_535')!.staleReason).toBeNull();
  });

  it('装进场景的节点：登记之后头一次问到的后端那一版记下来（取最新拿它核对屏幕上装的是不是后端现在的那一版）；之后重问不覆盖；重新登记清掉重记', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_7997);
    const lagging = facts({
      verdict: 'lagging', verdictReason: 'units_changed',
      units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 3, exact: true },
      generatedAt: { ...OWN_447, sesnoMin: 443, sesnoMax: 445 },
      changes: { fromSesno: 443, toSesno: 447, unitsChanged: 3, unitsAdded: 0, unitsRemoved: 0, unattributed: false },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    });
    const latest = facts({
      verdict: 'latest', units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    });

    // 装上的时候它就落后（按需生成在会话 443–445 上，库文件已到 447）
    fetchFacts.mockResolvedValue(lagging);
    store.noteLoaded('24381_535', 7997, { modelSesno: 0, fileLatestSesno: 447 });
    // 还没问回来：没有这一格
    expect(store.entry('24381_535')!.loadedGenerated).toBeUndefined();
    await settled(store, '24381_535');
    expect(store.entry('24381_535')!.loadedGenerated).toEqual({ sesnoMin: 443, sesnoMax: 445, laggingUnits: 3 });

    // 别的页面让后端把它重新生成了，后端现在说最新：记下的还是装上时那一版（屏幕上的没换）
    fetchFacts.mockResolvedValue(latest);
    store.recheck('24381_535');
    await settled(store, '24381_535');
    expect(store.view('24381_535')!.verdict).toBe('latest');
    expect(store.entry('24381_535')!.loadedGenerated).toEqual({ sesnoMin: 443, sesnoMax: 445, laggingUnits: 3 });

    // 本页重载 / 更新做成了：显示流程重新登记，记的是这之后头一次问到的那一版
    store.noteLoaded('24381_535', 7997, { modelSesno: 0, fileLatestSesno: 447 });
    expect(store.entry('24381_535')!.loadedGenerated).toBeUndefined();
    await settled(store, '24381_535');
    expect(store.entry('24381_535')!.loadedGenerated).toEqual({ sesnoMin: 447, sesnoMax: 447, laggingUnits: 0 });
  });

  it('那一版只对装进场景的节点记、只记接口答的那一次：只是点过的不记；头一次没答上来记成「说不出」，之后答上来也不补；旧后端（过渡办法）不记', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_7997, ROW_1112);
    const latest = facts({
      verdict: 'latest', units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    });

    // 只是点过、没有模型可显示（生成到一半停了：后端有已生成的部分，可本页没装）
    fetchFacts.mockResolvedValueOnce(facts({
      verdict: 'partial', units: { total: 21, generated: 10, missing: 11, failed: 0, lagging: 0, exact: true },
      generatedAt: OWN_447, precheck: { unitsToGenerate: 11, needsConfirm: false, thresholdUnits: 20 },
    }));
    store.noteWithoutModel('24381_535', 7997);
    await settled(store, '24381_535');
    expect(store.entry('24381_535')!.status).toMatchObject({ source: 'model-status', verdict: 'partial' });
    expect(store.entry('24381_535')!.loadedGenerated).toBeUndefined();

    // 头一次没答上来：记成说不出；隔了一阵才答上来的那一版保不准还是装上时的，不补
    fetchFacts.mockRejectedValueOnce(Object.assign(new Error('库文件打不开'), { code: 'SOURCE_NOT_FOUND' }));
    store.noteLoaded('24381_600', 7997, { modelSesno: 0, fileLatestSesno: 447 });
    await settled(store, '24381_600');
    expect(store.entry('24381_600')!.status).toMatchObject({ source: 'model-status', verdict: 'unknown' });
    expect(store.entry('24381_600')!.loadedGenerated).toBeNull();
    fetchFacts.mockResolvedValueOnce(latest);
    store.recheck('24381_600');
    await settled(store, '24381_600');
    expect(store.view('24381_600')!.verdict).toBe('latest');
    expect(store.entry('24381_600')!.loadedGenerated).toBeNull();

    // 旧后端没有那个接口：走过渡办法，没有「后端那一版」可记
    fetchFacts.mockResolvedValue(null);
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    await settled(store, '9304_2');
    expect(store.entry('9304_2')!.status).toMatchObject({ source: 'versions', verdict: 'latest' });
    expect(store.entry('9304_2')!.loadedGenerated).toBeUndefined();
  });

  it('服务端没有那个接口（回 null）：照旧走过渡办法', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    fetchFacts.mockResolvedValue(null);
    setRows(ROW_1112, ROW_7997);
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 742, impact: 'mesh', unitsChanged: 3 }]));
    store.noteLoaded('9304_2', 1112, { modelSesno: 738, fileLatestSesno: 748 });
    store.noteWithoutModel('24381_535', 7997);
    await settled(store, '9304_2');
    await settled(store, '24381_535');
    expect(store.view('9304_2')).toMatchObject({ verdict: 'lagging', action: 'update' });
    expect(store.view('24381_535')).toMatchObject({ verdict: 'untracked', iconKind: null, action: null });
  });

  it('因名下暂时查空被撤下的节点（withdrawnEmpty，#322）：留在追踪表里，空着时显示 empty，几何恢复后行上出现可重载信号', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    const EQ_A = '24384_30010';
    setRows({ ...ROW_8000, file_latest_sesno: 1144, applied_sesno: 1144, model_sesno: 1144 });
    fetchFacts.mockResolvedValueOnce(facts({
      verdict: 'empty', dbnum: 8000, noun: 'EQUI',
      units: { total: 0, generated: 0, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: null,
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
      library: { fileLatestSesno: 1144, modelSesno: 1144, modelSesnoTime: null, inWatchScope: true },
    }));

    store.noteWithdrawnEmpty(EQ_A, 8000, { modelSesno: 1144, fileLatestSesno: 1144 });
    await settled(store, EQ_A);
    expect(store.entry(EQ_A)).toMatchObject({ loaded: false, withdrawnEmpty: true, loadedModelSesno: 1144 });
    expect(store.view(EQ_A)).toMatchObject({ verdict: 'empty', iconKind: 'nothing', action: null });

    // 几何恢复后库水位推进到 1145，后端返回 latest：直接给行上标 reloadable（不走慢的 node/versions）
    fetchFacts.mockResolvedValueOnce(facts({
      verdict: 'latest', dbnum: 8000, noun: 'EQUI',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1145, sesnoMax: 1145, timeMin: null, timeMax: null, basis: 'library_watermark' },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
      library: { fileLatestSesno: 1145, modelSesno: 1145, modelSesnoTime: null, inWatchScope: true },
    }));
    setRows({ ...ROW_8000, file_latest_sesno: 1145, applied_sesno: 1145, model_sesno: 1145 });
    await nextTick();
    await settled(store, EQ_A);

    expect(h.listNodeVersions).not.toHaveBeenCalled();
    expect(store.view(EQ_A)).toMatchObject({ verdict: 'reloadable', iconKind: 'reloadable', action: 'reload' });
  });

  it('503 SOURCE_CHANGED（#321）：首次返回 503 重试后 200 静默恢复正常判定，并写入 versionsChecked 供取最新复用', async () => {
    const mod = await import('./useLoadedNodeStatus');
    const delays: number[] = [];
    mod.__setLoadedNodeStatusRetryOptionsForTests({
      sleep: async (ms) => { delays.push(ms); },
      maxSourceChangedRetries: 2,
      followUpDelayMs: -1,
    });
    const store = mod.useLoadedNodeStatus();
    store.provideChangeQuery(async ({ dbnum, refno, sinceSesno, signal }) => changedSessionsOfNodeVersions(
      (await h.listNodeVersions(dbnum, refno, 'subtree', { sinceSesno, signal })).versions,
    ));
    const fetchFacts = vi.fn(async (): Promise<NodeModelFacts | null> => facts({
      verdict: 'latest', dbnum: 8000, noun: 'EQUI',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1146, sesnoMax: 1146, timeMin: null, timeMax: null, basis: 'library_watermark' },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
      library: { fileLatestSesno: 1146, modelSesno: 1146, modelSesnoTime: null, inWatchScope: true },
    }));
    store.provideFactsQuery(fetchFacts);
    setRows({ ...ROW_8000, file_latest_sesno: 1146, applied_sesno: 1146, model_sesno: 1146 });
    const transient = Object.assign(new Error('库文件正在写入'), { code: 'SOURCE_CHANGED', status: 503, retryAfterMs: 2_000 });
    h.listNodeVersions
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(timeline([{ sesno: 1145, impact: 'noop' }]));

    store.noteLoaded('24384_26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 });
    await settled(store, '24384_26547');

    expect(h.listNodeVersions).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2_000]);
    expect(store.view('24384_26547')).toMatchObject({ verdict: 'latest', iconKind: 'current', action: null });
    expect(store.entry('24384_26547')!.versionsChecked).toEqual({
      sinceSesno: 1143,
      throughModelSesno: 1146,
      changedSessions: [],
    });
  });

  it('503 SOURCE_CHANGED 重试耗尽（#321）：已有有效状态的行不翻成「新旧未知」；首次未知的行清晰区分瞬态写盘冲突', async () => {
    const mod = await import('./useLoadedNodeStatus');
    mod.__setLoadedNodeStatusRetryOptionsForTests({
      sleep: async () => {},
      maxSourceChangedRetries: 2,
      followUpDelayMs: -1,
    });
    const store = mod.useLoadedNodeStatus();
    store.provideChangeQuery(async ({ dbnum, refno, sinceSesno, signal }) => changedSessionsOfNodeVersions(
      (await h.listNodeVersions(dbnum, refno, 'subtree', { sinceSesno, signal })).versions,
    ));
    const fetchFacts = vi.fn(async (): Promise<NodeModelFacts | null> => facts({
      verdict: 'latest', dbnum: 8000, noun: 'EQUI',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1143, sesnoMax: 1143, timeMin: null, timeMax: null, basis: 'library_watermark' },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
      library: { fileLatestSesno: 1143, modelSesno: 1143, modelSesnoTime: null, inWatchScope: true },
    }));
    store.provideFactsQuery(fetchFacts);

    // 1. 已有有效状态（latest）的行：水位推进后遇持续 503 SOURCE_CHANGED → 保留既有 latest，不翻成 unknown
    setRows(ROW_8000);
    store.noteLoaded('24384_26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 });
    await settled(store, '24384_26547');
    expect(store.view('24384_26547')!.verdict).toBe('latest');

    const transient = () => Object.assign(new Error('库文件正在写入'), { code: 'SOURCE_CHANGED', status: 503, retryAfterMs: 2_000 });
    fetchFacts.mockResolvedValue(facts({
      verdict: 'latest', dbnum: 8000, noun: 'EQUI',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1146, sesnoMax: 1146, timeMin: null, timeMax: null, basis: 'library_watermark' },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
      library: { fileLatestSesno: 1146, modelSesno: 1146, modelSesnoTime: null, inWatchScope: true },
    }));
    h.listNodeVersions.mockImplementation(async () => { throw transient(); });
    setRows({ ...ROW_8000, file_latest_sesno: 1146, applied_sesno: 1146, model_sesno: 1146 });
    await nextTick();
    await settled(store, '24384_26547');

    // 共尝试 1 + 2 = 3 次后耗尽，但未改行仍保留 latest，不草率翻坏
    expect(h.listNodeVersions).toHaveBeenCalledTimes(3);
    expect(store.view('24384_26547')).toMatchObject({ verdict: 'latest', iconKind: 'current', action: null, checking: false });

    // 2. 首次核对尚无有效状态的行遇持续 503 SOURCE_CHANGED → 标 unknown 且携带 errorCode = SOURCE_CHANGED 清晰区分写盘冲突
    h.listNodeVersions.mockClear();
    store.noteLoaded('24384_26548', 8000, { modelSesno: 1143, fileLatestSesno: 1143 });
    await settled(store, '24384_26548');
    expect(h.listNodeVersions).toHaveBeenCalledTimes(3);
    expect(store.entry('24384_26548')!.status).toMatchObject({
      verdict: 'unknown',
      errorCode: 'SOURCE_CHANGED',
      reason: '库文件正在写入，版本核对暂不可用（请稍后重试）',
    });
    expect(store.view('24384_26548')!.title).toContain('库文件正在写入');
  });
});
