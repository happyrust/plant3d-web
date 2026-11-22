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

const EQUI = '24384_47469';

function row(modelSesno: number, fileLatestSesno = modelSesno): DbnumRow {
  return {
    dbnum: 8000,
    db_type: 'DESI',
    initialized: true,
    file_latest_sesno: fileLatestSesno,
    applied_sesno: modelSesno,
    model_sesno: modelSesno,
    model_verdict: 'in_sync',
  };
}

function setRows(...rows: DbnumRow[]): void {
  h.healthState.verdict = {
    rows: Object.fromEntries(rows.map((r) => [r.dbnum, r])),
    lastCheckedAt: (h.healthState.verdict.lastCheckedAt ?? 0) + 1,
    error: null,
  };
}

function makeFacts(patch: Partial<NodeModelFacts> = {}): NodeModelFacts {
  return {
    verdict: 'empty',
    verdictReason: null,
    dbnum: 8000,
    noun: 'EQUI',
    unitRoot: null,
    units: { total: 0, generated: 0, missing: 0, failed: 0, lagging: 0, exact: true },
    generatedAt: null,
    changes: null,
    precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
    library: { fileLatestSesno: 1144, modelSesno: 1144, modelSesnoTime: null, inWatchScope: true },
    ...patch,
  };
}

async function settled(store: { view: (refno: string) => { checking: boolean } | null }, refno: string): Promise<void> {
  await vi.waitFor(() => {
    const view = store.view(refno);
    expect(view !== null && !view.checking).toBe(true);
  });
}

async function loadStore() {
  const mod = await import('./useLoadedNodeStatus');
  const store = mod.useLoadedNodeStatus();
  const fetchFacts = vi.fn<(_: { refno: string; signal?: AbortSignal }) => Promise<NodeModelFacts | null>>();
  store.provideFactsQuery(fetchFacts);
  store.provideChangeQuery(async ({ dbnum, refno, sinceSesno, signal }) => changedSessionsOfNodeVersions(
    (await h.listNodeVersions(dbnum, refno, 'subtree', { sinceSesno, signal })).versions,
  ));
  return { store, fetchFacts };
}

beforeEach(() => {
  vi.resetModules();
  h.healthState = reactive({ verdict: { rows: {}, lastCheckedAt: null, error: null } });
  h.listNodeVersions.mockReset();
  h.listNodeVersions.mockResolvedValue({ versions: [] });
  h.refreshVerdict.mockClear();
  h.batchListeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLoadedNodeStatus 空节点持续跟踪（#322 方案 A）', () => {
  it('重载查空撤下旧构件后以 empty: true 留在表里：后端仍无几何时行上标 empty，几何回来立刻标「重载」，重载装回后恢复最新', async () => {
    const { store, fetchFacts } = await loadStore();
    setRows(row(1144));
    fetchFacts.mockResolvedValueOnce(makeFacts({ verdict: 'empty' }));

    store.noteLoaded(EQUI, 8000, { modelSesno: 1144, fileLatestSesno: 1144 }, { empty: true });
    await settled(store, EQUI);

    expect(store.entry(EQUI)).toMatchObject({ loaded: true, empty: true, loadedModelSesno: 1144 });
    expect(store.view(EQUI)).toMatchObject({ verdict: 'empty', iconKind: 'nothing', action: null });

    // K20 / K21 还原：几何回到 EQUI 名下、库水位推到 1145
    fetchFacts.mockResolvedValueOnce(makeFacts({
      verdict: 'latest',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1145, sesnoMax: 1145, timeMin: null, timeMax: null, basis: 'library_watermark' },
      library: { fileLatestSesno: 1145, modelSesno: 1145, modelSesnoTime: null, inWatchScope: true },
    }));
    h.listNodeVersions.mockResolvedValueOnce({
      versions: [{ sesno: 1145, sessionTime: null, impact: 'delivery', unitsChanged: 1 }],
    });
    setRows(row(1145));
    await nextTick();
    await settled(store, EQUI);

    expect(store.view(EQUI)).toMatchObject({ verdict: 'reloadable', iconKind: 'reloadable', action: 'reload' });

    // 点「取最新」或行上「重载」重新装回几何：重新登记不再带 empty
    fetchFacts.mockResolvedValueOnce(makeFacts({
      verdict: 'latest',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1145, sesnoMax: 1145, timeMin: null, timeMax: null, basis: 'library_watermark' },
      library: { fileLatestSesno: 1145, modelSesno: 1145, modelSesnoTime: null, inWatchScope: true },
    }));
    store.noteLoaded(EQUI, 8000, { modelSesno: 1145, fileLatestSesno: 1145 });
    await settled(store, EQUI);

    expect(store.entry(EQUI)?.empty).toBeUndefined();
    expect(store.view(EQUI)).toMatchObject({ verdict: 'latest', iconKind: 'current', action: null });
  });

  it('空生成单元（如删空/移空后的 EQUI）：后端仍答 latest（1/1 单元）且无新会话变动时保持 empty，不误亮「重载」，待几何真正回归才变 lagging → reloadable', async () => {
    const { store, fetchFacts } = await loadStore();
    setRows(row(1180));
    fetchFacts.mockResolvedValueOnce(makeFacts({
      verdict: 'latest',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1180, sesnoMax: 1180, timeMin: null, timeMax: null, basis: 'library_watermark' },
      library: { fileLatestSesno: 1180, modelSesno: 1180, modelSesnoTime: null, inWatchScope: true },
    }));

    store.noteLoaded(EQUI, 8000, { modelSesno: 1180, fileLatestSesno: 1180 }, { empty: true });
    await settled(store, EQUI);

    expect(store.entry(EQUI)).toMatchObject({ loaded: true, empty: true, loadedModelSesno: 1180 });
    expect(store.view(EQUI)).toMatchObject({ verdict: 'empty', iconKind: 'nothing', action: null });

    // 同库别的节点改动推进到 1181（本节点版本表返回空）：仍保持 empty，不误亮「重载」
    fetchFacts.mockResolvedValueOnce(makeFacts({
      verdict: 'latest',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1181, sesnoMax: 1181, timeMin: null, timeMax: null, basis: 'library_watermark' },
      library: { fileLatestSesno: 1181, modelSesno: 1181, modelSesnoTime: null, inWatchScope: true },
    }));
    h.listNodeVersions.mockResolvedValueOnce({ versions: [] });
    setRows(row(1181));
    await nextTick();
    await settled(store, EQUI);

    expect(store.view(EQUI)).toMatchObject({ verdict: 'empty', iconKind: 'nothing', action: null });

    // K20 / K21 还原：E3D 存盘 1182 后后端尚未追上 → lagging（更新）
    fetchFacts.mockResolvedValueOnce(makeFacts({
      verdict: 'lagging',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 1, exact: true },
      generatedAt: { sesnoMin: 1181, sesnoMax: 1181, timeMin: null, timeMax: null, basis: 'library_watermark' },
      library: { fileLatestSesno: 1182, modelSesno: 1181, modelSesnoTime: null, inWatchScope: true },
    }));
    h.listNodeVersions.mockResolvedValueOnce({ versions: [] });
    setRows(row(1181, 1182));
    await nextTick();
    await settled(store, EQUI);

    expect(store.view(EQUI)).toMatchObject({ verdict: 'lagging', action: 'update' });

    // 后端追上 1182 且版本表报 1182 改到本节点 → reloadable（重载）
    fetchFacts.mockResolvedValueOnce(makeFacts({
      verdict: 'latest',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1182, sesnoMax: 1182, timeMin: null, timeMax: null, basis: 'library_watermark' },
      library: { fileLatestSesno: 1182, modelSesno: 1182, modelSesnoTime: null, inWatchScope: true },
    }));
    h.listNodeVersions.mockResolvedValueOnce({
      versions: [{ sesno: 1182, sessionTime: null, impact: 'delivery', unitsChanged: 1 }],
    });
    setRows(row(1182));
    await nextTick();
    await settled(store, EQUI);

    expect(store.view(EQUI)).toMatchObject({ verdict: 'reloadable', iconKind: 'reloadable', action: 'reload' });
  });

  it('无单元空容器（loadedGenerated === null）在按需生成库恢复 latest（有生成单元）时立刻标「重载」', async () => {
    const { store, fetchFacts } = await loadStore();
    setRows(row(1144));
    fetchFacts.mockResolvedValueOnce(makeFacts({ verdict: 'empty' }));

    store.noteLoaded(EQUI, 8000, { modelSesno: 1144, fileLatestSesno: 1144 }, { empty: true });
    await settled(store, EQUI);
    expect(store.entry(EQUI)?.loadedGenerated).toBeNull();
    expect(store.view(EQUI)).toMatchObject({ verdict: 'empty', iconKind: 'nothing', action: null });

    fetchFacts.mockResolvedValueOnce(makeFacts({
      verdict: 'latest',
      units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 1145, sesnoMax: 1145, timeMin: null, timeMax: null, basis: 'own_generation' },
      library: { fileLatestSesno: 1145, modelSesno: 1144, modelSesnoTime: null, inWatchScope: false },
    }));
    setRows(row(1144, 1145));
    await nextTick();
    await settled(store, EQUI);

    expect(store.view(EQUI)).toMatchObject({ verdict: 'reloadable', iconKind: 'reloadable', action: 'reload' });
    expect(store.view(EQUI)?.title).toContain('名下重新有了可显示的模型');
  });
});
