/**
 * 库里的模型换过之后，行上什么时候给「重载」（2026-11-17 隔离沙箱里量到：库一级的更新做完，被改到的那一行要等约 40 秒）。
 *
 * 行上判「有更新可重载」要问一次节点版本表（逐个会话核对其间改没改到本节点），会话多的库冷算一次十几秒到半分钟。
 * 这里验的是：已经知道被改到的行不等它；等的那些行上写「核对中」，不留着上一次的按钮。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import { changedSessionsOfNodeVersions, type NodeModelFacts } from './nodeModelStatus';

import type { DbnumRow } from '@/api/genModelV1Api';
import type { GenModelV1FinishedBatch } from '@/composables/useGenModelV1UpdateNotice';

const h = vi.hoisted(() => ({
  listNodeVersions: vi.fn(),
  refreshVerdict: vi.fn(async () => {}),
  batchListeners: new Set<(batch: unknown) => void>(),
  healthState: null as unknown as { verdict: { rows: Record<number, unknown>; lastCheckedAt: number | null; error: string | null } },
}));

vi.mock('@/composables/useGenModelV1Health', () => ({
  useGenModelV1Health: () => ({ state: h.healthState, refreshVerdict: h.refreshVerdict }),
}));
vi.mock('@/composables/useGenModelV1UpdateNotice', () => ({
  subscribeGenModelV1FinishedBatches: (listener: (batch: unknown) => void) => {
    h.batchListeners.add(listener);
    return () => { h.batchListeners.delete(listener); };
  },
}));

/** 库 8000：模型按会话 1660 生成，库文件已到 1663（有人保存过，后端还没追） */
const ROW_AT_1660: DbnumRow = {
  dbnum: 8000, db_type: 'DESI', initialized: true, file_latest_sesno: 1663, applied_sesno: 1660, model_sesno: 1660, model_verdict: 'in_sync',
};
/** 库一级的更新做完之后：三枚水位都到 1663 */
const ROW_AT_1663: DbnumRow = { ...ROW_AT_1660, applied_sesno: 1663, model_sesno: 1663 };
/** 还没有人保存时：三枚水位都在 1660 */
const ROW_QUIET_1660: DbnumRow = { ...ROW_AT_1660, file_latest_sesno: 1660 };

const ZONE = '24384_47463';
const ZONE_2 = '24384_47500';
/** ZONE 上面的 SITE（下面几条祖先链都经过它） */
const SITE = '24384_100';
/** ZONE 下面的两个生成单元，和一个不在任何已装节点下面的单元 */
const UNIT_A = '24384_47470';
const UNIT_B = '24384_47471';
const UNIT_ELSEWHERE = '24384_60001';
const CHAIN_OF_UNIT_A = [UNIT_A, ZONE, SITE, 'world'];
const CHAINS: Record<string, string[]> = {
  [UNIT_A]: CHAIN_OF_UNIT_A,
  [UNIT_B]: [UNIT_B, ZONE, SITE, 'world'],
  [UNIT_ELSEWHERE]: [UNIT_ELSEWHERE, '24384_60000', SITE, 'world'],
};

function setRows(...rows: DbnumRow[]): void {
  h.healthState.verdict = {
    rows: Object.fromEntries(rows.map((row) => [row.dbnum, row])),
    lastCheckedAt: (h.healthState.verdict.lastCheckedAt ?? 0) + 1,
    error: null,
  };
}

type Timeline = { versions: { sesno: number; sessionTime: null; impact: string; selfImpact: null; unitsChanged: number; unitsTouched: number }[] };

function timeline(versions: { sesno: number; impact: string; unitsChanged?: number }[]): Timeline {
  return {
    versions: versions.map((item) => ({
      sesno: item.sesno, sessionTime: null, impact: item.impact, selfImpact: null, unitsChanged: item.unitsChanged ?? 1, unitsTouched: 1,
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** 节点版本表那一问先挂着（冷算），由用例放行 */
function holdVersions() {
  const slow = deferred<Timeline>();
  h.listNodeVersions.mockImplementationOnce(() => slow.promise);
  return slow;
}

/** 等判定收口：这个节点不再「核对中」 */
async function settled(store: { view: (refno: string) => { checking: boolean } | null }, refno: string): Promise<void> {
  await vi.waitFor(() => {
    const view = store.view(refno);
    expect(view !== null && !view.checking).toBe(true);
  });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

/** 接口给的事实：缺省是 ZONE 在模型水位 1660 上「最新」、库文件到 1663、库在后端的更新范围里 */
function facts(patch: Partial<NodeModelFacts> = {}): NodeModelFacts {
  return {
    verdict: 'latest', verdictReason: null, dbnum: 8000, noun: 'ZONE', unitRoot: null,
    units: { total: 12, generated: 12, missing: 0, failed: 0, lagging: 0, exact: true },
    generatedAt: { sesnoMin: 1660, sesnoMax: 1660, timeMin: null, timeMax: null, basis: 'library_watermark' },
    changes: null,
    precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    library: { fileLatestSesno: 1663, modelSesno: 1660, modelSesnoTime: null, inWatchScope: true },
    ...patch,
  };
}

/** 生成之后（1660）到库文件最新（1663）之间有 2 个单元被改到：落后，行上给库一级的「更新」 */
const LAGGING_AT_1660 = facts({
  verdict: 'lagging', verdictReason: 'units_changed',
  units: { total: 12, generated: 12, missing: 0, failed: 0, lagging: 2, exact: true },
  changes: { fromSesno: 1660, toSesno: 1663, unitsChanged: 2, unitsAdded: 0, unitsRemoved: 0, unattributed: false },
});
/** 库文件到了 1665、模型还在 1660：这一次查到 1665 的改动 */
const LAGGING_AT_1660_TO_1665 = facts({
  ...LAGGING_AT_1660,
  units: { total: 12, generated: 12, missing: 0, failed: 0, lagging: 3, exact: true },
  changes: { fromSesno: 1660, toSesno: 1665, unitsChanged: 3, unitsAdded: 0, unitsRemoved: 0, unattributed: false },
  library: { fileLatestSesno: 1665, modelSesno: 1660, modelSesnoTime: null, inWatchScope: true },
});
/** 库的模型追到 1663、库文件已到 1665，1663 之后又改到了它：按 1663 的模型说它落后 */
const LAGGING_AT_1663_TO_1665 = facts({
  verdict: 'lagging', verdictReason: 'units_changed',
  units: { total: 12, generated: 12, missing: 0, failed: 0, lagging: 1, exact: true },
  generatedAt: { sesnoMin: 1663, sesnoMax: 1663, timeMin: null, timeMax: null, basis: 'library_watermark' },
  changes: { fromSesno: 1663, toSesno: 1665, unitsChanged: 1, unitsAdded: 0, unitsRemoved: 0, unattributed: false },
  library: { fileLatestSesno: 1665, modelSesno: 1663, modelSesnoTime: null, inWatchScope: true },
});
/** 库追到 1663 之后：后端说这个节点最新（它不知道本页装的是哪一版） */
const LATEST_AT_1663 = facts({
  generatedAt: { sesnoMin: 1663, sesnoMax: 1663, timeMin: null, timeMax: null, basis: 'library_watermark' },
  library: { fileLatestSesno: 1663, modelSesno: 1663, modelSesnoTime: null, inWatchScope: true },
});
const LATEST_QUIET_1660 = facts({ library: { fileLatestSesno: 1660, modelSesno: 1660, modelSesnoTime: null, inWatchScope: true } });

const LAGGING_TITLE = [
  '本节点：落后：生成之后有 2 个单元被改到',
  '模型按会话 1660 生成；库文件最新 1663。会话 1660 之后到 1663，改到 2 个交付单元。点「更新」让后端把这个库更新到最新',
].join('\n');
const RECHECKING_NOTE = '（这是上一次的结论，正在重新核对）';
const LOADED_VS_LIBRARY = '本页装的是会话 1660 的模型，库里已到 1663。点「重载」换上';
const STILL_CHECKING = '逐个会话的核对还在做，答复回来以它为准';

async function loadStore() {
  const mod = await import('./useLoadedNodeStatus');
  const store = mod.useLoadedNodeStatus();
  store.provideChangeQuery(async ({ dbnum, refno, sinceSesno, signal }) => changedSessionsOfNodeVersions(
    (await h.listNodeVersions(dbnum, refno, 'subtree', { sinceSesno, signal })).versions,
  ));
  return { store, mod };
}

async function loadStoreWithFacts() {
  const { store, mod } = await loadStore();
  const fetchFacts = vi.fn(async (_query: { refno: string; signal?: AbortSignal }): Promise<NodeModelFacts | null> => facts());
  store.provideFactsQuery(fetchFacts);
  return { store, mod, fetchFacts };
}

/** ZONE 装在会话 1660 的模型上，行上标着落后、给库一级的「更新」（点「更新」之前的样子） */
async function loadLaggingZone() {
  const loaded = await loadStoreWithFacts();
  setRows(ROW_AT_1660);
  loaded.fetchFacts.mockResolvedValue(LAGGING_AT_1660);
  loaded.store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1663 });
  await settled(loaded.store, ZONE);
  return loaded;
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

describe('标着落后的行，库的模型水位追上之后：不等逐会话的核对', () => {
  it('库的模型水位追上了当时查到的会话：立刻是「有更新可重载」，「重载」不用等；逐会话的核对回来之后照它说的写；重载做成了回到最新', async () => {
    const { store, fetchFacts } = await loadLaggingZone();
    const before = store.view(ZONE)!;
    expect(before).toEqual({ verdict: 'lagging', iconKind: 'stale', action: 'update', checking: false, title: LAGGING_TITLE });
    expect(h.listNodeVersions).not.toHaveBeenCalled();

    // 库一级的更新做完、`/dbnums` 重拉回来：模型水位 1660 → 1663。逐会话的核对（节点版本表）冷算要半分钟，先挂着
    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    // 水位一到就改口，连快的那一半（节点模型状态接口）都不用等
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', iconKind: 'reloadable', action: 'reload', actionHolds: true });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    expect(h.listNodeVersions).toHaveBeenCalledWith(8000, ZONE, 'subtree', expect.objectContaining({ sinceSesno: 1660 }));
    expect(store.view(ZONE)).toEqual({
      verdict: 'reloadable', iconKind: 'reloadable', action: 'reload', checking: true, actionHolds: true,
      title: [
        '本节点：有更新可重载：之前标着落后的改动库里已经生成了（会话 1660 之后到 1663，改到 2 个交付单元）',
        LOADED_VS_LIBRARY,
        STILL_CHECKING,
      ].join('\n'),
    });

    slow.resolve(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }]));
    await settled(store, ZONE);
    expect(store.view(ZONE)).toEqual({
      verdict: 'reloadable', iconKind: 'reloadable', action: 'reload', checking: false, actionHolds: true,
      title: `本节点：有更新可重载：会话 1662（2 个单元）改到了本节点\n${LOADED_VS_LIBRARY}`,
    });
    expect(store.entry(ZONE)!.reloadHint).toBeNull();

    // 点了「重载」：显示流程重新登记，回到最新
    store.noteLoaded(ZONE, 8000, { modelSesno: 1663, fileLatestSesno: 1663 });
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'latest', action: null });
  });

  it('逐会话的核对说其间没有会话改到它：照它说的回到「最新」；那条依据就此作废，之后答不上来也不再翻出来', async () => {
    const { store, fetchFacts } = await loadLaggingZone();
    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload' });
    slow.resolve(timeline([]));
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'latest', action: null, checking: false });

    // 库文件又多了一个会话，这一次逐会话的核对没答上来：说「新旧未知」，不拿作废了的依据说「重载」
    h.listNodeVersions.mockRejectedValueOnce(new Error('timeout: node/versions'));
    fetchFacts.mockResolvedValue(facts({ ...LATEST_AT_1663, library: { ...LATEST_AT_1663.library, fileLatestSesno: 1664 } }));
    setRows({ ...ROW_AT_1663, file_latest_sesno: 1664 });
    await nextTick();
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'unknown', action: null });
  });

  it('逐会话的核对没答上来（超时、失败）：依据还在，行上照样给「重载」，不说「新旧未知」', async () => {
    const { store, fetchFacts } = await loadLaggingZone();
    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    slow.reject(new Error('timeout: node/versions'));
    await settled(store, ZONE);
    expect(store.entry(ZONE)!.status).toMatchObject({ verdict: 'unknown' });
    expect(store.view(ZONE)).toEqual({
      verdict: 'reloadable', iconKind: 'reloadable', action: 'reload', checking: false, actionHolds: true,
      title: `本节点：有更新可重载：之前标着落后的改动库里已经生成了（会话 1660 之后到 1663，改到 2 个交付单元）\n${LOADED_VS_LIBRARY}`,
    });
  });

  it('库只追到一半（模型水位还没到当时查到的会话）：不提前给「重载」；等逐会话的核对的时候行上是「核对中」，不留着上一次的「更新」', async () => {
    const { store, fetchFacts } = await loadLaggingZone();
    const slow = holdVersions();
    fetchFacts.mockResolvedValue(facts({
      generatedAt: { sesnoMin: 1662, sesnoMax: 1662, timeMin: null, timeMax: null, basis: 'library_watermark' },
      library: { fileLatestSesno: 1663, modelSesno: 1662, modelSesnoTime: null, inWatchScope: true },
    }));
    setRows({ ...ROW_AT_1660, applied_sesno: 1662, model_sesno: 1662 });
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update' });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    expect(store.view(ZONE)).toEqual({
      verdict: 'lagging', iconKind: 'stale', action: null, checking: true, actionPending: true,
      title: `${LAGGING_TITLE}\n${RECHECKING_NOTE}`,
    });

    slow.resolve(timeline([{ sesno: 1661, impact: 'mesh', unitsChanged: 1 }]));
    await settled(store, ZONE);
    const after = store.view(ZONE)!;
    expect(after).toMatchObject({ verdict: 'reloadable', action: 'reload', checking: false });
    expect(after).not.toHaveProperty('actionPending');
    expect(after.title).not.toContain(RECHECKING_NOTE);
  });

  it('库正在被写的时候不据此给「重载」；写完、水位到了才给——中间那次「库正在更新」不把依据冲掉', async () => {
    const { store, fetchFacts } = await loadLaggingZone();
    fetchFacts.mockResolvedValue(facts({ ...LATEST_AT_1663, verdict: 'updating' }));
    setRows({ ...ROW_AT_1663, write_state: { status: 'writing', intent: 'apply_window' } });
    // 水位的数字到了，可库还在写
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update' });
    await nextTick();
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'updating', action: null });

    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload', actionHolds: true });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload', checking: true });
    slow.resolve(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }]));
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload', checking: false });
  });

  it.each([
    ['装的时候库状态没取到（本页装的是哪一版说不出）', null],
    ['装的时候这个库还没有模型水位', 0],
    ['本页装的那一版不比那些改动早', 1663],
  ])('%s：库的水位到了也不据此给「重载」', async (_name, loadedModelSesno) => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_AT_1660);
    fetchFacts.mockResolvedValue(LAGGING_AT_1660);
    store.noteLoaded(ZONE, 8000, { modelSesno: loadedModelSesno, fileLatestSesno: 1663 });
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update' });

    const fast = deferred<NodeModelFacts>();
    fetchFacts.mockImplementationOnce(() => fast.promise);
    setRows(ROW_AT_1663);
    await nextTick();
    const waiting = store.view(ZONE)!;
    expect(waiting).toMatchObject({ verdict: 'lagging', action: 'update', checking: true });
    expect(waiting).not.toHaveProperty('actionHolds');
    fast.resolve(LATEST_AT_1663);
    await settled(store, ZONE);
  });

  it('给的是节点一级的「更新」的行（库不在后端的更新范围里）：没有库一级的更新会来追，水位动了也不据此给「重载」', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_AT_1660);
    fetchFacts.mockResolvedValue(facts({ ...LAGGING_AT_1660, library: { ...LAGGING_AT_1660.library, inWatchScope: false } }));
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1663 });
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update-node' });

    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update-node' });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: null, actionPending: true, checking: true });
    slow.resolve(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }]));
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload' });
  });

  it('部分生成、缺的单元要靠库一级的更新补的行：不算依据（缺的单元补没补上要问了才知道）', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_AT_1660);
    fetchFacts.mockResolvedValue(facts({
      verdict: 'partial', units: { total: 12, generated: 10, missing: 2, failed: 0, lagging: 0, exact: true },
      precheck: { unitsToGenerate: 2, needsConfirm: false, thresholdUnits: 20 },
    }));
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1663 });
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'partial', action: 'update' });
    expect(store.entry(ZONE)!.reloadHint ?? null).toBeNull();

    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'partial', action: 'update' });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    expect(store.view(ZONE)).toMatchObject({ verdict: 'partial', action: null, actionPending: true });
    slow.resolve(timeline([{ sesno: 1662, impact: 'delivery', unitsChanged: 2 }]));
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload' });
  });

  it('落后是一次次看到的：记最早那一次查到的会话——库追到那里就该重载，后来库文件又多出来的会话不耽误；后端按追上之后的库说它还落后，就照它说的给「更新」', async () => {
    const { store, fetchFacts } = await loadLaggingZone();
    // 库文件又多了两个会话，也改到了它：还是落后，这一次查到 1665
    fetchFacts.mockResolvedValue(LAGGING_AT_1660_TO_1665);
    setRows({ ...ROW_AT_1660, file_latest_sesno: 1665 });
    await nextTick();
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update' });
    expect(store.entry(ZONE)!.reloadHint).toMatchObject({ modelSesno: 1663 });

    // 后端的这一批只追到 1663：头一次标落后时查到的改动已经生成了
    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LAGGING_AT_1663_TO_1665);
    setRows({ ...ROW_AT_1663, file_latest_sesno: 1665 });
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload', actionHolds: true });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload', checking: true });

    slow.resolve(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }, { sesno: 1664, impact: 'mesh', unitsChanged: 1 }]));
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update', checking: false });
    // 新的依据从这一次记起：库再追到 1665 才算
    expect(store.entry(ZONE)!.reloadHint).toMatchObject({ modelSesno: 1665 });
  });

  it.each([
    ['它查到的会话并不比库的模型水位新', { fileLatestSesno: 1663, modelSesno: 1663, modelSesnoTime: null, inWatchScope: true }],
    ['库的模型水位读不到', { fileLatestSesno: 1663, modelSesno: null, modelSesnoTime: null, inWatchScope: true }],
  ])('后端说落后、可%s（水位对不上）：不记依据，照它说的给「更新」', async (_name, library) => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_AT_1663);
    fetchFacts.mockResolvedValue(facts({ ...LAGGING_AT_1660, library }));
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1663 });
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update', checking: false });
    expect(store.entry(ZONE)!.reloadHint ?? null).toBeNull();
  });

  it('旧后端（没有节点模型状态接口，走过渡办法）一样：落后的行，库追上之后先给「重载」；说不出改了什么就不说', async () => {
    const { store } = await loadStore();
    setRows(ROW_AT_1660);
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }]));
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1663 });
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update' });

    const slow = holdVersions();
    setRows(ROW_AT_1663);
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(2));
    expect(store.view(ZONE)).toEqual({
      verdict: 'reloadable', iconKind: 'reloadable', action: 'reload', checking: true, actionHolds: true,
      title: ['本节点：有更新可重载：之前标着落后的改动库里已经生成了', LOADED_VS_LIBRARY, STILL_CHECKING].join('\n'),
    });
    slow.resolve(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }]));
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload', checking: false });
  });
});

describe('等逐会话的核对时行上写什么', () => {
  it('上一次的结论没有给动作（最新）的行：等的时候不出「核对中」，照旧画上一次的结论', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_QUIET_1660);
    fetchFacts.mockResolvedValue(LATEST_QUIET_1660);
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1660 });
    await settled(store, ZONE);

    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    const waiting = store.view(ZONE)!;
    expect(waiting).toMatchObject({ verdict: 'latest', action: null, checking: true });
    expect(waiting).not.toHaveProperty('actionPending');
    expect(waiting.title).not.toContain(RECHECKING_NOTE);
    slow.resolve(timeline([]));
    await settled(store, ZONE);
  });

  it('已经是「有更新可重载」的行，库又往前走了：重问的时候「重载」照样能点，不换成「核对中」；库的模型水位倒回去了就不算', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows(ROW_AT_1663);
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }]));
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1663 });
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload', actionHolds: true });

    // 库文件多了一个会话：节点版本表的缓存作废，又要冷算一次
    const slow = holdVersions();
    fetchFacts.mockResolvedValue(facts({ ...LATEST_AT_1663, library: { ...LATEST_AT_1663.library, fileLatestSesno: 1664 } }));
    setRows({ ...ROW_AT_1663, file_latest_sesno: 1664 });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(2));
    const waiting = store.view(ZONE)!;
    expect(waiting).toMatchObject({ verdict: 'reloadable', action: 'reload', checking: true, actionHolds: true });
    expect(waiting).not.toHaveProperty('actionPending');
    expect(waiting.title).not.toContain(RECHECKING_NOTE);

    // 库的模型水位倒回去了（库被重新初始化过）：上一次的「重载」不作数了，等答复
    fetchFacts.mockResolvedValue(facts({ library: { fileLatestSesno: 1664, modelSesno: 1660, modelSesnoTime: null, inWatchScope: true } }));
    setRows({ ...ROW_AT_1660, file_latest_sesno: 1664 });
    const rolledBack = store.view(ZONE)!;
    expect(rolledBack).toMatchObject({ verdict: 'reloadable', action: null, actionPending: true });
    expect(rolledBack).not.toHaveProperty('actionHolds');
    await nextTick();
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'latest', action: null });
    slow.resolve(timeline([]));
  });

  it('同样的库状态下重问（人点一下）、快的那一半还没回来：不换成「核对中」，上一次的动作照旧只是先禁用', async () => {
    const { store, fetchFacts } = await loadLaggingZone();
    const fast = deferred<NodeModelFacts>();
    fetchFacts.mockImplementationOnce(() => fast.promise);
    store.recheck(ZONE);
    const waiting = store.view(ZONE)!;
    expect(waiting).toEqual({ verdict: 'lagging', iconKind: 'stale', action: 'update', checking: true, title: LAGGING_TITLE });
    fast.resolve(LAGGING_AT_1660);
    await settled(store, ZONE);
    expect(store.view(ZONE)).toEqual({ verdict: 'lagging', iconKind: 'stale', action: 'update', checking: false, title: LAGGING_TITLE });
  });

  it('慢的那一问答完之后「核对中」就收起：下一次重问，快的那一半还没回来时不会又冒出来；慢的那一问发出去了才是', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    // 本页装的是 1660，库的模型已到 1663，库文件到 1665 又改到了它：落后（要问慢的那一问，因为库里的模型比本页装的新）
    setRows({ ...ROW_AT_1663, file_latest_sesno: 1665 });
    fetchFacts.mockResolvedValue(LAGGING_AT_1663_TO_1665);
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }]));
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1665 });
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update', checking: false });

    const fast = deferred<NodeModelFacts>();
    fetchFacts.mockImplementationOnce(() => fast.promise);
    store.recheck(ZONE);
    const waitingFast = store.view(ZONE)!;
    expect(waitingFast).toMatchObject({ verdict: 'lagging', action: 'update', checking: true });
    expect(waitingFast).not.toHaveProperty('actionPending');

    const slow = holdVersions();
    fast.resolve(LAGGING_AT_1663_TO_1665);
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(2));
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: null, checking: true, actionPending: true });
    slow.resolve(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }]));
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update', checking: false });
  });

  it('被新的一次顶掉的那次重问后来才走到慢的那一问：不算数，下一次重问（快的那一半还没回来）不会平白冒出「核对中」', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    setRows({ ...ROW_AT_1663, file_latest_sesno: 1665 });
    fetchFacts.mockResolvedValue(LAGGING_AT_1663_TO_1665);
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1665 });
    await settled(store, ZONE);

    // 连点两下：头一次被第二次顶掉，它的快的那一半先挂着
    const first = deferred<NodeModelFacts>();
    fetchFacts.mockImplementationOnce(() => first.promise);
    store.recheck(ZONE);
    store.recheck(ZONE);
    await settled(store, ZONE);
    const asked = h.listNodeVersions.mock.calls.length;

    // 被顶掉的那一次这时才回来，接着去问了慢的那一问
    first.resolve(LAGGING_AT_1663_TO_1665);
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(asked + 1));
    await flush();

    const fast = deferred<NodeModelFacts>();
    fetchFacts.mockImplementationOnce(() => fast.promise);
    store.recheck(ZONE);
    const waiting = store.view(ZONE)!;
    expect(waiting).toMatchObject({ verdict: 'lagging', action: 'update', checking: true });
    expect(waiting).not.toHaveProperty('actionPending');
    fast.resolve(LAGGING_AT_1663_TO_1665);
    await settled(store, ZONE);
  });
});

describe('后端跑完一批：被重新生成的单元在哪些已装节点下面', () => {
  function batchOf(patch: Partial<GenModelV1FinishedBatch> = {}): GenModelV1FinishedBatch {
    return {
      taskId: 'batch-1', state: 'succeeded', dbnum: 8000, dbType: 'DESI', startSesno: 1661, endSesno: 1663,
      changedElements: 5, roots: [UNIT_A], failedRoots: [], finishedAt: null, ...patch,
    };
  }

  function finishBatch(batch: GenModelV1FinishedBatch): void {
    for (const listener of [...h.batchListeners]) listener(batch);
  }

  function chainsQuery() {
    return vi.fn(async (refno: string): Promise<readonly string[]> => CHAINS[refno] ?? [refno, 'world']);
  }

  /** 接上祖先链查询；ZONE（和给的其它节点）装在会话 1660 的模型上，库没有新会话，行上是「最新」 */
  async function loadQuietZones(...others: string[]) {
    const loaded = await loadStoreWithFacts();
    const ancestors = chainsQuery();
    loaded.store.provideAncestorsQuery(ancestors);
    setRows(ROW_QUIET_1660);
    loaded.fetchFacts.mockResolvedValue(LATEST_QUIET_1660);
    for (const refno of [ZONE, ...others]) {
      loaded.store.noteLoaded(refno, 8000, { modelSesno: 1660, fileLatestSesno: 1660 });
      await settled(loaded.store, refno);
    }
    return { ...loaded, ancestors };
  }

  const BATCH_REASON = '后端跑完的一批（到会话 1663）重新生成了这个节点下的模型';

  it('这一批重新生成的单元在这一行的节点下面：库的模型水位一到那一批的末尾，这一行就给「重载」；同一个库里没被碰到的行不给', async () => {
    const { store, fetchFacts, ancestors } = await loadQuietZones(ZONE_2);
    finishBatch(batchOf({ roots: [UNIT_A, UNIT_ELSEWHERE] }));
    // ZONE_2 一直没找到：两个单元都问过
    await vi.waitFor(() => expect(ancestors).toHaveBeenCalledTimes(2));
    expect(ancestors.mock.calls.map(([refno]) => refno)).toEqual([UNIT_A, UNIT_ELSEWHERE]);
    await flush();
    // 批次到了、`/dbnums` 还没重拉回来：水位没到，先不改口
    expect(store.view(ZONE)).toMatchObject({ verdict: 'latest', action: null });

    const slowZone = deferred<Timeline>();
    const slowZone2 = deferred<Timeline>();
    h.listNodeVersions.mockImplementation((_dbnum: number, refno: string) => (refno === ZONE ? slowZone.promise : slowZone2.promise));
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload', actionHolds: true });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(2));
    expect(store.view(ZONE)).toEqual({
      verdict: 'reloadable', iconKind: 'reloadable', action: 'reload', checking: true, actionHolds: true,
      title: [`本节点：有更新可重载：${BATCH_REASON}`, LOADED_VS_LIBRARY, STILL_CHECKING].join('\n'),
    });
    expect(store.view(ZONE_2)).toMatchObject({ verdict: 'latest', action: null, checking: true });

    slowZone.resolve(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 1 }]));
    slowZone2.resolve(timeline([]));
    await settled(store, ZONE);
    await settled(store, ZONE_2);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload' });
    expect(store.view(ZONE_2)).toMatchObject({ verdict: 'latest', action: null });
  });

  it('要找的节点都找到了就不再往下问；`/dbnums` 先回来、批次后到也一样给', async () => {
    const { store, fetchFacts, ancestors } = await loadQuietZones();
    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    expect(store.view(ZONE)).toMatchObject({ verdict: 'latest', action: null, checking: true });

    finishBatch(batchOf({ roots: [UNIT_A, UNIT_B] }));
    await vi.waitFor(() => expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload', checking: true, actionHolds: true }));
    await flush();
    expect(ancestors).toHaveBeenCalledTimes(1);
    slow.resolve(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 1 }]));
    await settled(store, ZONE);
  });

  it('生成失败的单元不算；一批重新生成的单元超过上限就不查了（等逐会话的核对），正好在上限上的照查', async () => {
    const { mod, ancestors } = await loadQuietZones();
    const limit = mod.LOADED_NODE_BATCH_ROOTS_LIMIT;
    const many = (count: number) => Array.from({ length: count }, (_, index) => `24384_${90000 + index}`);
    finishBatch(batchOf({ state: 'partial', roots: [UNIT_A], failedRoots: [UNIT_A] }));
    finishBatch(batchOf({ taskId: 'batch-2', roots: many(limit + 1) }));
    await flush();
    expect(ancestors).not.toHaveBeenCalled();

    finishBatch(batchOf({ taskId: 'batch-3', roots: many(limit) }));
    await vi.waitFor(() => expect(ancestors).toHaveBeenCalledTimes(limit));
  });

  it('别的库的批次不理', async () => {
    const { ancestors } = await loadQuietZones();
    finishBatch(batchOf({ dbnum: 1112 }));
    await flush();
    expect(ancestors).not.toHaveBeenCalled();
  });

  it.each([
    ['本页装的那一版不比这一批早', 1663],
    ['装的时候库状态没取到', null],
    ['装的时候这个库还没有模型水位', 0],
  ])('%s的节点：不查', async (_name, loadedModelSesno) => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    const ancestors = chainsQuery();
    store.provideAncestorsQuery(ancestors);
    setRows(ROW_QUIET_1660);
    fetchFacts.mockResolvedValue(LATEST_QUIET_1660);
    store.noteLoaded(ZONE, 8000, { modelSesno: loadedModelSesno, fileLatestSesno: 1660 });
    await settled(store, ZONE);
    finishBatch(batchOf());
    await flush();
    expect(ancestors).not.toHaveBeenCalled();
  });

  it('查祖先链的这一会儿，后端按这一批之后的库给的结论已经回来了：不再补这条依据，以后端的为准；已经有这样的结论的节点根本不查', async () => {
    const { store, fetchFacts, ancestors } = await loadQuietZones();
    const chain = deferred<readonly string[]>();
    ancestors.mockImplementationOnce(() => chain.promise);
    finishBatch(batchOf());
    await vi.waitFor(() => expect(ancestors).toHaveBeenCalledTimes(1));

    // 逐会话的核对（缺省应答）：其间没有会话改到它
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    await nextTick();
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'latest', action: null });

    chain.resolve(CHAIN_OF_UNIT_A);
    await flush();
    expect(store.view(ZONE)).toMatchObject({ verdict: 'latest', action: null });
    expect(store.entry(ZONE)!.reloadHint ?? null).toBeNull();

    // 同一批再到一次（断线补账）：这个节点已经有按 1663 的库判的结论，不用查
    finishBatch(batchOf());
    await flush();
    expect(ancestors).toHaveBeenCalledTimes(1);
  });

  it('查祖先链的这一会儿节点从场景撤下了：不把它记回来；同一条链上别的已装节点（它上面的 SITE）照记', async () => {
    const { store, ancestors } = await loadQuietZones(SITE);
    const chain = deferred<readonly string[]>();
    ancestors.mockImplementationOnce(() => chain.promise);
    finishBatch(batchOf());
    await vi.waitFor(() => expect(ancestors).toHaveBeenCalledTimes(1));
    store.forget(ZONE);
    chain.resolve(CHAIN_OF_UNIT_A);
    await flush();
    expect(store.view(ZONE)).toBeNull();
    expect(store.entries().map((entry) => entry.refno)).toEqual([SITE]);
    expect(store.entry(SITE)!.reloadHint).toEqual({ modelSesno: 1663, reason: BATCH_REASON });
  });

  it('某个单元的祖先链没查到：接着问下一个', async () => {
    const { store, fetchFacts, ancestors } = await loadQuietZones();
    ancestors.mockRejectedValueOnce(new Error('tree down'));
    finishBatch(batchOf({ roots: [UNIT_A, UNIT_B] }));
    await vi.waitFor(() => expect(ancestors).toHaveBeenCalledTimes(2));
    await flush();
    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'reloadable', action: 'reload' });
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(1));
    slow.resolve(timeline([]));
    await settled(store, ZONE);
  });

  it('行上已经记着一条门槛更晚的依据（落后时查到 1665），这一批到 1663 就重新生成了它下面的单元：按早的算，库到 1663 就给「重载」；后端接着说它还落后，照它说的给「更新」', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    store.provideAncestorsQuery(chainsQuery());
    setRows({ ...ROW_AT_1660, file_latest_sesno: 1665 });
    fetchFacts.mockResolvedValue(LAGGING_AT_1660_TO_1665);
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1665 });
    await settled(store, ZONE);
    expect(store.entry(ZONE)!.reloadHint).toMatchObject({ modelSesno: 1665 });

    finishBatch(batchOf());
    await vi.waitFor(() => expect(store.entry(ZONE)!.reloadHint).toMatchObject({ modelSesno: 1663 }));
    // 库追到 1663（库文件 1664、1665 那两个会话还没追）
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 1662, impact: 'mesh', unitsChanged: 2 }]));
    fetchFacts.mockResolvedValue(LAGGING_AT_1663_TO_1665);
    setRows({ ...ROW_AT_1663, file_latest_sesno: 1665 });
    const view = store.view(ZONE)!;
    expect(view).toMatchObject({ verdict: 'reloadable', action: 'reload', actionHolds: true });
    expect(view.title).toContain(BATCH_REASON);

    await nextTick();
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'lagging', action: 'update', checking: false });
    expect(store.entry(ZONE)!.reloadHint).toMatchObject({ modelSesno: 1665 });
  });

  it('后端上一次说的「有更新可重载」是按更早的库判的（1662），又一批（到 1663）重新生成了它下面的单元：库的模型水位一到，行上按这一批写（库里已到 1663），「重载」一直能点', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    store.provideAncestorsQuery(chainsQuery());
    // 本页装的是 1660，库的模型已到 1662：后端说最新，逐会话的核对点出 1661 改到了它
    setRows({ ...ROW_AT_1660, file_latest_sesno: 1662, applied_sesno: 1662, model_sesno: 1662 });
    fetchFacts.mockResolvedValue(facts({
      generatedAt: { sesnoMin: 1662, sesnoMax: 1662, timeMin: null, timeMax: null, basis: 'library_watermark' },
      library: { fileLatestSesno: 1662, modelSesno: 1662, modelSesnoTime: null, inWatchScope: true },
    }));
    h.listNodeVersions.mockResolvedValueOnce(timeline([{ sesno: 1661, impact: 'mesh', unitsChanged: 1 }]));
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1662 });
    await settled(store, ZONE);
    const before = store.view(ZONE)!;
    expect(before).toMatchObject({ verdict: 'reloadable', action: 'reload', actionHolds: true });
    expect(before.title).toContain('库里已到 1662');

    finishBatch(batchOf());
    await vi.waitFor(() => expect(store.entry(ZONE)!.reloadHint).toEqual({ modelSesno: 1663, reason: BATCH_REASON }));
    // 库的模型水位还没到 1663：照旧是后端上一次的说法
    expect(store.view(ZONE)).toEqual(before);

    const slow = holdVersions();
    fetchFacts.mockResolvedValue(LATEST_AT_1663);
    setRows(ROW_AT_1663);
    await vi.waitFor(() => expect(h.listNodeVersions).toHaveBeenCalledTimes(2));
    expect(store.view(ZONE)).toEqual({
      verdict: 'reloadable', iconKind: 'reloadable', action: 'reload', checking: true, actionHolds: true,
      title: [`本节点：有更新可重载：${BATCH_REASON}`, LOADED_VS_LIBRARY, STILL_CHECKING].join('\n'),
    });
    slow.resolve(timeline([{ sesno: 1661, impact: 'mesh', unitsChanged: 1 }, { sesno: 1663, impact: 'mesh', unitsChanged: 1 }]));
    await settled(store, ZONE);
    const after = store.view(ZONE)!;
    expect(after).toMatchObject({ verdict: 'reloadable', action: 'reload', checking: false, actionHolds: true });
    expect(after.title).not.toContain(BATCH_REASON);
    expect(store.entry(ZONE)!.reloadHint).toBeNull();
  });

  it('后端上一次说它「部分生成」的行，这一批重新生成了它下面的单元：水位到了也照旧画部分生成、给「生成」（要紧的是把缺的补上），不换成「重载」；后端按新的库重新判过，那条依据作废', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    store.provideAncestorsQuery(chainsQuery());
    const partial = {
      verdict: 'partial' as const,
      units: { total: 12, generated: 10, missing: 2, failed: 0, lagging: 0, exact: true },
      precheck: { unitsToGenerate: 2, needsConfirm: false, thresholdUnits: 20 },
    };
    setRows(ROW_QUIET_1660);
    fetchFacts.mockResolvedValue(facts({ ...LATEST_QUIET_1660, ...partial }));
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1660 });
    await settled(store, ZONE);
    const before = store.view(ZONE)!;
    expect(before).toMatchObject({ verdict: 'partial', action: 'generate', checking: false });

    finishBatch(batchOf());
    await vi.waitFor(() => expect(store.entry(ZONE)!.reloadHint).toEqual({ modelSesno: 1663, reason: BATCH_REASON }));

    // 库的模型水位到了 1663，重问：快的那一半先挂着
    const fast = deferred<NodeModelFacts>();
    fetchFacts.mockImplementationOnce(() => fast.promise);
    setRows(ROW_AT_1663);
    await nextTick();
    expect(store.view(ZONE)).toEqual({ ...before, checking: true });

    // 缺的还缺着：快的那一半就答了，不用问慢的
    fast.resolve(facts({ ...LATEST_AT_1663, ...partial }));
    await settled(store, ZONE);
    expect(store.view(ZONE)).toMatchObject({ verdict: 'partial', action: 'generate', checking: false });
    expect(store.entry(ZONE)!.reloadHint).toBeNull();
    expect(h.listNodeVersions).not.toHaveBeenCalled();
  });

  it('接上祖先链查询才看批次；再接一次换成新的，给 null 就停', async () => {
    const { store, fetchFacts } = await loadStoreWithFacts();
    expect(h.batchListeners.size).toBe(0);
    const first = vi.fn(async (): Promise<readonly string[]> => []);
    const second = vi.fn(async (): Promise<readonly string[]> => []);
    store.provideAncestorsQuery(first);
    expect(h.batchListeners.size).toBe(1);
    store.provideAncestorsQuery(second);
    expect(h.batchListeners.size).toBe(1);

    setRows(ROW_QUIET_1660);
    fetchFacts.mockResolvedValue(LATEST_QUIET_1660);
    store.noteLoaded(ZONE, 8000, { modelSesno: 1660, fileLatestSesno: 1660 });
    await settled(store, ZONE);
    finishBatch(batchOf());
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();

    // 表自己还订着一份（批次来了重拉 `/dbnums`），那一份不归这里管
    const own = h.batchListeners.size - 1;
    store.provideAncestorsQuery(null);
    expect(h.batchListeners.size).toBe(own);
    finishBatch(batchOf({ taskId: 'batch-2' }));
    await flush();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
