import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import { changedSessionsOfNodeVersions } from './nodeModelStatus';

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
