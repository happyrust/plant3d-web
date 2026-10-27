/**
 * 增量更新案例集合 K 组的 L0 部分（gen-model `docs/plans/2026-10-27-plant3d-web-incremental-linkage-test-cases.md`）：
 * K01 信封解析、K02 相关性、K03 提示累积、K04 partial、K08 删掉的根怎么进重载名单、K10 文案、K11 场景探针、K12（todo）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  feedListeners: new Set<(envelope: unknown) => void>(),
  changes: vi.fn(async (): Promise<{ items: unknown[]; next_cursor: string | null }> => ({ items: [], next_cursor: null })),
}));

vi.mock('@/composables/useGenModelV1TaskFeed', () => ({
  subscribeGenModelV1TaskEvents: vi.fn((listener: (envelope: unknown) => void) => {
    h.feedListeners.add(listener);
    return () => { h.feedListeners.delete(listener); };
  }),
}));

vi.mock('@/api/genModelV1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1Api')>()),
  genModelV1TaskChanges: h.changes,
}));

import {
  __resetGenModelV1UpdateNoticeForTests,
  createGenModelV1LoadedProbe,
  dismissGenModelV1UpdateNotice,
  evaluateGenModelV1UpdateNotice,
  formatGenModelV1UpdateNoticeText,
  formatGenModelV1UpdateNoticeTitle,
  handleGenModelV1TaskEnvelopeForNotice,
  lookupGenModelV1DeletedRootsInScene,
  mergeGenModelV1DeletedRoots,
  mergeGenModelV1UpdateNotice,
  parseGenModelV1FinishedBatch,
  reloadGenModelV1UpdateNotice,
  setGenModelV1LoadedProbe,
  startGenModelV1UpdateNotice,
  subscribeGenModelV1FinishedBatches,
  useGenModelV1UpdateNotice,
  type GenModelV1FinishedBatch,
  type GenModelV1LoadedProbe,
} from './useGenModelV1UpdateNotice';

/** 2026-10-26 联动验证里录到的真实 task_finished 信封（截掉了 warnings） */
function finished(
  overrides: Record<string, unknown> = {},
  units: unknown[] = [{ root_refno: '24384/24776', kind: 'transform', status: 'generated' }],
  extra: { taskId?: string; state?: string } = {},
) {
  const taskId = extra.taskId ?? 'db-20261026-220357-000053';
  return {
    type: 'task_finished',
    seq: 14,
    ts: '2026-10-26T22:03:58.282715800+08:00',
    task_id: taskId,
    payload: {
      task_id: taskId,
      state: extra.state ?? 'succeeded',
      result: {
        project: 'AvevaMarineSample',
        status: 'success',
        batch: {
          dbnum: 8000,
          db_type: 'DESI',
          start_sesno: 734,
          end_sesno: 734,
          status: 'applied',
          changed_elements: 2,
          added_elements: 0,
          modified_elements: 2,
          deleted_elements: 0,
          ...overrides,
        },
        units,
      },
    },
  };
}

function probeOf(dbnums: number[], loaded: string[]): GenModelV1LoadedProbe {
  return { dbnums: () => dbnums, isRootLoaded: (refno) => loaded.includes(refno) };
}

function batchOf(overrides: Partial<GenModelV1FinishedBatch> = {}): GenModelV1FinishedBatch {
  return { ...parseGenModelV1FinishedBatch(finished())!, ...overrides };
}

beforeEach(() => {
  __resetGenModelV1UpdateNoticeForTests();
  h.feedListeners.clear();
  h.changes.mockReset();
  h.changes.mockResolvedValue({ items: [], next_cursor: null });
});
afterEach(() => {
  __resetGenModelV1UpdateNoticeForTests();
});

describe('K01 parseGenModelV1FinishedBatch', () => {
  it('只认带 result.batch 的 succeeded / partial task_finished', () => {
    expect(parseGenModelV1FinishedBatch({ type: 'task_started', payload: {} })).toBeNull();
    expect(parseGenModelV1FinishedBatch(finished({}, [], { state: 'failed' }))).toBeNull();
    expect(parseGenModelV1FinishedBatch(finished({}, [], { state: 'yielded' }))).toBeNull();
    expect(parseGenModelV1FinishedBatch({ type: 'task_finished', payload: { state: 'succeeded', result: {} } })).toBeNull();
    expect(parseGenModelV1FinishedBatch({ type: 'task_finished', payload: { state: 'succeeded', result: { batch: { dbnum: '8000', end_sesno: 1 } } } })).toBeNull();
    expect(parseGenModelV1FinishedBatch(finished({}, [], { state: 'partial' }))?.state).toBe('partial');
  });

  it('摘出库 / 会话 / 变化数，根统一成 a_b，生成失败的根另记', () => {
    const batch = parseGenModelV1FinishedBatch(finished({}, [
      { root_refno: '24384/24776', kind: 'transform', status: 'generated' },
      { root_refno: '24384_24776', kind: 'transform', status: 'generated' },
      { root_refno: '24384/23257', kind: 'regen', status: 'failed' },
      { kind: 'regen' },
      null,
    ], { state: 'partial' }));
    expect(batch).toEqual({
      taskId: 'db-20261026-220357-000053',
      state: 'partial',
      dbnum: 8000,
      dbType: 'DESI',
      startSesno: 734,
      endSesno: 734,
      changedElements: 2,
      roots: ['24384_24776', '24384_23257'],
      failedRoots: ['24384_23257'],
      finishedAt: '2026-10-26T22:03:58.282715800+08:00',
    });
  });

  it('信封没带 task_id 时从 payload 里取', () => {
    const envelope = { ...finished(), task_id: null };
    expect(parseGenModelV1FinishedBatch(envelope)?.taskId).toBe('db-20261026-220357-000053');
  });
});

describe('K02 evaluateGenModelV1UpdateNotice', () => {
  const base = batchOf();

  it('非 DESI 库不提示', () => {
    expect(evaluateGenModelV1UpdateNotice({ ...base, dbType: 'SYST', dbnum: 8191 }, probeOf([8191], []))).toBeNull();
  });

  it('只登录不改（无变化、无单元）不提示', () => {
    expect(evaluateGenModelV1UpdateNotice({ ...base, changedElements: 0, roots: [] }, probeOf([8000], []))).toBeNull();
  });

  it('库已装入就提示，并标出批次里哪些根已在场景', () => {
    const impact = evaluateGenModelV1UpdateNotice(base, probeOf([8000], ['24384_24776']), 1000);
    expect(impact).toMatchObject({ dbnum: 8000, endSesno: 734, loadedRoots: ['24384_24776'], receivedAt: 1000 });
    expect(evaluateGenModelV1UpdateNotice(base, probeOf([8000], []), 1000)?.loadedRoots).toEqual([]);
  });

  it('库没按整库装、但批次里的根在场景里，也提示', () => {
    expect(evaluateGenModelV1UpdateNotice(base, probeOf([7997], ['24384_24776']))?.loadedRoots).toEqual(['24384_24776']);
    expect(evaluateGenModelV1UpdateNotice(base, probeOf([7997], []))).toBeNull();
  });

  it('探针按批次的库号问根', () => {
    const isRootLoaded = vi.fn(() => true);
    evaluateGenModelV1UpdateNotice(base, { dbnums: () => [], isRootLoaded });
    expect(isRootLoaded).toHaveBeenCalledWith('24384_24776', 8000);
  });
});

describe('K03 提示累积', () => {
  const probe = probeOf([8000, 7997], ['24384_24776', '24384_23257', '24381_109449']);

  it('同库连着几批：根取并集、会话从最早起点到最新终点、改动项累加，前一批的根不会被顶掉', () => {
    const first = evaluateGenModelV1UpdateNotice(batchOf({ taskId: 't1', startSesno: 726, endSesno: 727, changedElements: 2, roots: ['24384_24776'] }), probe, 1)!;
    const second = evaluateGenModelV1UpdateNotice(batchOf({ taskId: 't2', startSesno: 728, endSesno: 730, changedElements: 3, roots: ['24384_23257'] }), probe, 2)!;
    const notice = mergeGenModelV1UpdateNotice(mergeGenModelV1UpdateNotice(null, first), second);
    expect(notice).toMatchObject({
      taskIds: ['t1', 't2'],
      spans: [{ dbnum: 8000, startSesno: 726, endSesno: 730 }],
      changedElements: 5,
      roots: ['24384_24776', '24384_23257'],
      loadedRoots: ['24384_24776', '24384_23257'],
      receivedAt: 2,
    });
  });

  it('跨库也并进同一条，每个库一段会话范围', () => {
    const a = evaluateGenModelV1UpdateNotice(batchOf({ taskId: 't1', startSesno: 726, endSesno: 727 }), probe)!;
    const b = evaluateGenModelV1UpdateNotice(
      batchOf({ taskId: 't2', dbnum: 7997, startSesno: 364, endSesno: 365, roots: ['24381_109449'] }),
      probe,
    )!;
    const notice = mergeGenModelV1UpdateNotice(mergeGenModelV1UpdateNotice(null, a), b);
    expect(notice.spans).toEqual([
      { dbnum: 8000, startSesno: 726, endSesno: 727 },
      { dbnum: 7997, startSesno: 364, endSesno: 365 },
    ]);
    expect(notice.loadedRoots).toEqual(['24384_24776', '24381_109449']);
  });

  it('同一个任务重复到达不重复计数', () => {
    const impact = evaluateGenModelV1UpdateNotice(batchOf({ taskId: 't1' }), probe)!;
    const once = mergeGenModelV1UpdateNotice(null, impact);
    expect(mergeGenModelV1UpdateNotice(once, impact)).toMatchObject({ taskIds: ['t1'], changedElements: 2 });
  });

  it('经信封进来：后来的批次并进提示，每一批都通知批次订阅者；忽略后清空', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24776']));
    const seen: number[] = [];
    const unsubscribe = subscribeGenModelV1FinishedBatches((batch) => seen.push(batch.endSesno));
    const { notice, hasNotice } = useGenModelV1UpdateNotice();

    await handleGenModelV1TaskEnvelopeForNotice(finished({ start_sesno: 733, end_sesno: 733, changed_elements: 0 }, [], { taskId: 't733' }));
    expect(hasNotice.value).toBe(false);
    await handleGenModelV1TaskEnvelopeForNotice(finished({ start_sesno: 734, end_sesno: 734 }, undefined, { taskId: 't734' }));
    await handleGenModelV1TaskEnvelopeForNotice(finished({ start_sesno: 735, end_sesno: 736 }, undefined, { taskId: 't736' }));
    expect(notice.value?.spans).toEqual([{ dbnum: 8000, startSesno: 734, endSesno: 736 }]);
    expect(notice.value?.taskIds).toEqual(['t734', 't736']);
    expect(notice.value?.changedElements).toBe(4);
    expect(seen).toEqual([733, 734, 736]);

    dismissGenModelV1UpdateNotice();
    expect(notice.value).toBeNull();
    unsubscribe();
    await handleGenModelV1TaskEnvelopeForNotice(finished({ end_sesno: 737 }, undefined, { taskId: 't737' }));
    expect(seen).toEqual([733, 734, 736]);
  });

  it('重载派发的是并集，带 refreshModel 且不飞相机；派发后清掉提示', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24776', '24384_23257']));
    await handleGenModelV1TaskEnvelopeForNotice(finished({}, [{ root_refno: '24384/24776', status: 'generated' }], { taskId: 't1' }));
    await handleGenModelV1TaskEnvelopeForNotice(finished({}, [{ root_refno: '24384/23257', status: 'generated' }], { taskId: 't2' }));
    const dispatch = vi.fn();
    expect(reloadGenModelV1UpdateNotice(dispatch)).toEqual(['24384_24776', '24384_23257']);
    expect(dispatch).toHaveBeenCalledWith({ refnos: ['24384_24776', '24384_23257'], refreshModel: true, flyTo: false });
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
  });

  it('受影响的根都没装进场景时，重载什么也不派发', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], []));
    await handleGenModelV1TaskEnvelopeForNotice(finished());
    expect(useGenModelV1UpdateNotice().notice.value?.loadedRoots).toEqual([]);
    const dispatch = vi.fn();
    expect(reloadGenModelV1UpdateNotice(dispatch)).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
  });

  it('没有探针（查看器还没就绪）时不提示、不查删除，但批次订阅者照样收到', async () => {
    const seen: string[] = [];
    subscribeGenModelV1FinishedBatches((batch) => seen.push(batch.taskId));
    await handleGenModelV1TaskEnvelopeForNotice(finished());
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
    expect(seen).toEqual(['db-20261026-220357-000053']);
    expect(h.changes).not.toHaveBeenCalled();
  });

  it('start 只订阅一次任务流，信封从任务流进来', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], []));
    startGenModelV1UpdateNotice();
    startGenModelV1UpdateNotice();
    expect(h.feedListeners.size).toBe(1);
    for (const listener of h.feedListeners) listener(finished());
    expect(useGenModelV1UpdateNotice().notice.value?.spans[0]?.dbnum).toBe(8000);
  });
});

describe('K04 partial', () => {
  it('partial 照样提示；生成失败的根不进重载名单，单列出来', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24776', '24384_23257']));
    await handleGenModelV1TaskEnvelopeForNotice(finished({}, [
      { root_refno: '24384/24776', status: 'generated' },
      { root_refno: '24384/23257', status: 'failed' },
    ], { state: 'partial' }));
    const notice = useGenModelV1UpdateNotice().notice.value!;
    expect(notice.loadedRoots).toEqual(['24384_24776']);
    expect(notice.failedRoots).toEqual(['24384_23257']);
    const dispatch = vi.fn();
    expect(reloadGenModelV1UpdateNotice(dispatch)).toEqual(['24384_24776']);
  });

  it('前一批失败、后一批生成成功的根：从失败名单移走，进重载名单', () => {
    const probe = probeOf([8000], ['24384_23257']);
    const failed = evaluateGenModelV1UpdateNotice(batchOf({ taskId: 't1', state: 'partial', roots: ['24384_23257'], failedRoots: ['24384_23257'] }), probe)!;
    const retried = evaluateGenModelV1UpdateNotice(batchOf({ taskId: 't2', roots: ['24384_23257'], failedRoots: [] }), probe)!;
    const afterFirst = mergeGenModelV1UpdateNotice(null, failed);
    expect(afterFirst).toMatchObject({ failedRoots: ['24384_23257'], loadedRoots: [] });
    expect(mergeGenModelV1UpdateNotice(afterFirst, retried)).toMatchObject({ failedRoots: [], loadedRoots: ['24384_23257'] });
  });

  it('只有失败的根在场景里也算相关（库没整库装），但没有可重载的', () => {
    const impact = evaluateGenModelV1UpdateNotice(
      batchOf({ state: 'partial', roots: ['24384_23257'], failedRoots: ['24384_23257'] }),
      probeOf([7997], ['24384_23257']),
    );
    expect(impact?.loadedRoots).toEqual([]);
  });
});

describe('K08 批次里整根删掉的单元', () => {
  const probe = probeOf([8000], ['24384_24778', '24384_24779']);

  it('只收 op=deleted、就是自己生成根（或根不在单元回执里）、且在场景里的', async () => {
    const page = vi.fn(async () => ({
      items: [
        { refno: '24384/24778', op: 'deleted', root_refno: '24384/24778' },
        { refno: '24384/24779', op: 'deleted', root_refno: '24384/24776' },
        { refno: '24384/24780', op: 'deleted', root_refno: null },
        { refno: '24384/24781', op: 'modified', root_refno: '24384/24781' },
      ],
      next_cursor: null,
    }));
    const batch = batchOf({ roots: ['24384_24776'] });
    expect(await lookupGenModelV1DeletedRootsInScene(batch, probe, page)).toEqual({
      roots: ['24384_24778'],
      incomplete: false,
    });
    expect(page).toHaveBeenCalledWith('db-20261026-220357-000053', null);
  });

  it('翻页直到没有 next_cursor；查不到就当没有删除', async () => {
    const page = vi.fn()
      .mockResolvedValueOnce({ items: [], next_cursor: 'c2' })
      .mockResolvedValueOnce({ items: [{ refno: '24384/24778', op: 'deleted' }], next_cursor: null });
    expect(await lookupGenModelV1DeletedRootsInScene(batchOf(), probe, page)).toEqual({
      roots: ['24384_24778'],
      incomplete: false,
    });
    expect(page).toHaveBeenNthCalledWith(2, 'db-20261026-220357-000053', 'c2');

    const failing = vi.fn(async () => { throw new Error('404 清单不存在'); });
    // 查询失败不能再当成「没有删除」：标不完整，让提示里说明清单没查全
    expect(await lookupGenModelV1DeletedRootsInScene(batchOf(), probe, failing)).toEqual({
      roots: [],
      incomplete: true,
    });
    expect(await lookupGenModelV1DeletedRootsInScene(batchOf({ taskId: '' }), probe, page)).toEqual({
      roots: [],
      incomplete: false,
    });
  });

  it('服务端标 truncated，或翻满上限仍有游标，都算清单不完整', async () => {
    const truncated = vi.fn(async () => ({
      items: [{ refno: '24384/24778', op: 'deleted', root_refno: '24384/24778' }],
      next_cursor: null,
      truncated: true,
    }));
    expect(await lookupGenModelV1DeletedRootsInScene(batchOf(), probe, truncated)).toEqual({
      roots: ['24384_24778'],
      incomplete: true,
    });

    // 每页都还有游标：翻满 5 页就停，但必须标不完整
    const endless = vi.fn(async () => ({ items: [], next_cursor: 'more' }));
    expect(await lookupGenModelV1DeletedRootsInScene(batchOf(), probe, endless)).toEqual({
      roots: [],
      incomplete: true,
    });
    expect(endless).toHaveBeenCalledTimes(5);
  });

  it('删掉的根并进提示、进重载名单；库没整库装、单元回执为空时也能出提示', async () => {
    setGenModelV1LoadedProbe(probeOf([], ['24384_24778']));
    h.changes.mockResolvedValueOnce({ items: [{ refno: '24384/24778', op: 'deleted', root_refno: '24384/24778' }], next_cursor: null });
    await handleGenModelV1TaskEnvelopeForNotice(finished({ start_sesno: 26, end_sesno: 26, changed_elements: 3 }, [], { taskId: 't26' }));
    const notice = useGenModelV1UpdateNotice().notice.value!;
    expect(notice).toMatchObject({
      taskIds: ['t26'],
      spans: [{ dbnum: 8000, startSesno: 26, endSesno: 26 }],
      changedElements: 3,
      deletedRoots: ['24384_24778'],
      loadedRoots: ['24384_24778'],
    });
    expect(h.changes).toHaveBeenCalledWith('t26', { cursor: null, limit: 1000 });
    const dispatch = vi.fn();
    expect(reloadGenModelV1UpdateNotice(dispatch)).toEqual(['24384_24778']);
  });

  it('同一批已经并过时只补删除，不重复计数', () => {
    const batch = batchOf({ taskId: 't1' });
    const notice = mergeGenModelV1UpdateNotice(null, evaluateGenModelV1UpdateNotice(batch, probeOf([8000], ['24384_24776']))!);
    expect(mergeGenModelV1DeletedRoots(notice, batch, ['24384_24778'])).toMatchObject({
      taskIds: ['t1'],
      changedElements: 2,
      deletedRoots: ['24384_24778'],
      loadedRoots: ['24384_24776', '24384_24778'],
      deletionsIncomplete: false,
    });
    expect(mergeGenModelV1DeletedRoots(notice, batch, [])).toBe(notice);
  });

  it('清单不完整时即使没查到删除根也要留痕，并在文案里说明', () => {
    const batch = batchOf({ taskId: 't1' });
    const notice = mergeGenModelV1UpdateNotice(null, evaluateGenModelV1UpdateNotice(batch, probeOf([8000], ['24384_24776']))!);
    const merged = mergeGenModelV1DeletedRoots(notice, batch, [], Date.now(), true)!;
    expect(merged).not.toBe(notice);
    expect(merged.deletionsIncomplete).toBe(true);
    expect(formatGenModelV1UpdateNoticeText(merged)).toContain('删除清单不完整');
    expect(formatGenModelV1UpdateNoticeTitle(merged)).toContain('删除清单没查全');
    // 已经标过不完整，再来一批完整的也不能把它抹掉
    expect(mergeGenModelV1DeletedRoots(merged, batch, [], Date.now(), false)?.deletionsIncomplete).toBe(true);
  });
});

describe('K10 文案', () => {
  const probe = probeOf([8000, 7997], ['24384_24776', '24381_109449']);

  it('单库：写会话范围与受影响根数，和 10-26 复验时的提示条一字不差', () => {
    const notice = mergeGenModelV1UpdateNotice(null, evaluateGenModelV1UpdateNotice(batchOf({ startSesno: 726, endSesno: 727 }), probe)!);
    expect(formatGenModelV1UpdateNoticeText(notice)).toBe('库 8000 已更新到会话 726→727（改 2 项，场景内 1 根受影响）');
    expect(formatGenModelV1UpdateNoticeText({ ...notice, spans: [{ dbnum: 8000, startSesno: 734, endSesno: 734 }], loadedRoots: [] }))
      .toBe('库 8000 已更新到会话 734（改 2 项）');
  });

  it('跨库只列库号；生成失败与删除在文案 / 悬停里都点名', () => {
    const a = evaluateGenModelV1UpdateNotice(batchOf({ taskId: 't1', startSesno: 726, endSesno: 727 }), probe)!;
    const b = evaluateGenModelV1UpdateNotice(batchOf({
      taskId: 't2', state: 'partial', dbnum: 7997, startSesno: 364, endSesno: 365,
      roots: ['24381_109449', '24381_109450'], failedRoots: ['24381_109450'],
    }), probe)!;
    const notice = mergeGenModelV1DeletedRoots(mergeGenModelV1UpdateNotice(mergeGenModelV1UpdateNotice(null, a), b), batchOf({ taskId: 't1' }), ['24384_24778'])!;
    expect(formatGenModelV1UpdateNoticeText(notice)).toBe('库 8000、7997 已更新（改 4 项，场景内 3 根受影响，1 根生成失败）');
    const title = formatGenModelV1UpdateNoticeTitle(notice);
    expect(title).toContain('gen-model 任务 t1, t2');
    expect(title).toContain('库 7997：会话 364→365');
    expect(title).toContain('批次里删掉、场景里还在的：24384_24778（重载时撤下）');
    expect(title).toContain('生成失败、重载不换（场景里保留旧几何）：24381_109450');
    expect(title).toContain('点「重载」按最新记录替换场景里的 24384_24776, 24381_109449, 24384_24778');
  });
});

describe('K11 createGenModelV1LoadedProbe', () => {
  it('库是否装入看当前激活的库；没有激活库就是空', () => {
    let active: number | null = 8000;
    const probe = createGenModelV1LoadedProbe({ activeDbnum: () => active, isModelActuallyLoaded: () => false, resolveUnitObjectIds: () => [] });
    expect([...probe.dbnums()]).toEqual([8000]);
    active = null;
    expect([...probe.dbnums()]).toEqual([]);
  });

  it('根在不在场景：加载器记账命中即是；否则沿属主链问 DTX（EQUI 自己没对象、show_refno 直装不记账）', () => {
    const resolveUnitObjectIds = vi.fn((_dbnum: number, refno: string) => (refno === '24384_24776' ? ['o:24384_24777:0'] : []));
    const probe = createGenModelV1LoadedProbe({
      activeDbnum: () => 8000,
      isModelActuallyLoaded: (refno) => refno === '24381_145018',
      resolveUnitObjectIds,
    });
    expect(probe.isRootLoaded('24381_145018', 7997)).toBe(true);
    expect(resolveUnitObjectIds).not.toHaveBeenCalled();
    expect(probe.isRootLoaded('24384_24776', 8000)).toBe(true);
    expect(resolveUnitObjectIds).toHaveBeenCalledWith(8000, '24384_24776');
    expect(probe.isRootLoaded('24384_23257', 8000)).toBe(false);
  });
});

describe('K13 删除查询在途期间提示被忽略 / 重载 / 换探针', () => {
  /** 一条挂起的 /changes 响应，由用例决定什么时候落定 */
  function deferredChanges() {
    let resolve!: (value: { items: unknown[]; next_cursor: null }) => void;
    const promise = new Promise<{ items: unknown[]; next_cursor: null }>((res) => { resolve = res; });
    h.changes.mockReturnValueOnce(promise);
    return { resolve };
  }

  const deletedPage = { items: [{ refno: '24384/24778', op: 'deleted', root_refno: '24384/24778' }], next_cursor: null };

  it('查询在途时点「忽略」：结果回来不得让提示重新出现', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24778']));
    const { resolve } = deferredChanges();
    const pending = handleGenModelV1TaskEnvelopeForNotice(finished({ changed_elements: 3 }, [], { taskId: 't-ignore' }));
    dismissGenModelV1UpdateNotice();
    resolve(deletedPage);
    await pending;
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
  });

  it('查询在途时点「重载」：结果回来不得把提示写回去', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24778']));
    const { resolve } = deferredChanges();
    const pending = handleGenModelV1TaskEnvelopeForNotice(finished({ changed_elements: 3 }, [], { taskId: 't-reload' }));
    const dispatch = vi.fn();
    reloadGenModelV1UpdateNotice(dispatch);
    resolve(deletedPage);
    await pending;
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
  });

  it('查询在途时换探针（查看器卸载）：结果回来不得用旧探针写全局提示', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24778']));
    const { resolve } = deferredChanges();
    const pending = handleGenModelV1TaskEnvelopeForNotice(finished({ changed_elements: 3 }, [], { taskId: 't-probe' }));
    setGenModelV1LoadedProbe(null);
    resolve(deletedPage);
    await pending;
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
  });

  it('查询在途时整体复位：结果回来不得复活提示', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24778']));
    const { resolve } = deferredChanges();
    const pending = handleGenModelV1TaskEnvelopeForNotice(finished({ changed_elements: 3 }, [], { taskId: 't-reset' }));
    __resetGenModelV1UpdateNoticeForTests();
    resolve(deletedPage);
    await pending;
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
  });

  it('没被打断时删除根照旧并进提示', async () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24778']));
    h.changes.mockResolvedValueOnce(deletedPage);
    await handleGenModelV1TaskEnvelopeForNotice(finished({ changed_elements: 3 }, [], { taskId: 't-ok' }));
    expect(useGenModelV1UpdateNotice().notice.value?.deletedRoots).toEqual(['24384_24778']);
  });

  it('跟场景无关的批次：changes 查询失败也不得冒出「删除清单不完整」的提示', async () => {
    // 库没装、批次里的根也不在场景：evaluate 返回 null
    setGenModelV1LoadedProbe(probeOf([7997], []));
    h.changes.mockRejectedValueOnce(new Error('changes 500'));
    await handleGenModelV1TaskEnvelopeForNotice(finished({ changed_elements: 3 }, [], { taskId: 't-unrelated' }));
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
  });

  it('探针同步抛错时不产生未处理的 rejection', async () => {
    setGenModelV1LoadedProbe({
      dbnums: () => [8000],
      isRootLoaded: () => { throw new Error('探针炸了'); },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startGenModelV1UpdateNotice();
    // units 默认带一个根，evaluate 才会真的去问探针
    h.feedListeners.forEach((listener) => listener(finished({ changed_elements: 3 }, undefined, { taskId: 't-throw' })));
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});

describe('K12 断线 / 丢帧后的补救', () => {
  it.todo('WS 重连或发现 seq 空洞时，按已装入库的 /dbnums 模型水位与装入时记下的会话比对，前移了就出一条通用更新提示');
});
