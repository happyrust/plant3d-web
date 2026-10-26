import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const feedListeners = new Set<(envelope: unknown) => void>();
vi.mock('@/composables/useGenModelV1TaskFeed', () => ({
  subscribeGenModelV1TaskEvents: vi.fn((listener: (envelope: unknown) => void) => {
    feedListeners.add(listener);
    return () => { feedListeners.delete(listener); };
  }),
}));

import {
  __resetGenModelV1UpdateNoticeForTests,
  dismissGenModelV1UpdateNotice,
  evaluateGenModelV1UpdateNotice,
  handleGenModelV1TaskEnvelopeForNotice,
  parseGenModelV1FinishedBatch,
  reloadGenModelV1UpdateNotice,
  setGenModelV1LoadedProbe,
  startGenModelV1UpdateNotice,
  subscribeGenModelV1FinishedBatches,
  useGenModelV1UpdateNotice,
  type GenModelV1LoadedProbe,
} from './useGenModelV1UpdateNotice';

/** 2026-10-26 联动验证里录到的真实 task_finished 信封（截掉了 warnings） */
function finished(overrides: Record<string, unknown> = {}, units: unknown[] = [{ root_refno: '24384/24776', kind: 'transform' }]) {
  return {
    type: 'task_finished',
    seq: 14,
    ts: '2026-10-26T22:03:58.282715800+08:00',
    task_id: 'db-20261026-220357-000053',
    payload: {
      task_id: 'db-20261026-220357-000053',
      state: 'succeeded',
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

beforeEach(() => {
  __resetGenModelV1UpdateNoticeForTests();
  feedListeners.clear();
});
afterEach(() => {
  __resetGenModelV1UpdateNoticeForTests();
});

describe('parseGenModelV1FinishedBatch', () => {
  it('只认 succeeded 且带 result.batch 的 task_finished', () => {
    expect(parseGenModelV1FinishedBatch({ type: 'task_started', payload: {} })).toBeNull();
    expect(parseGenModelV1FinishedBatch({ ...finished(), payload: { state: 'failed', result: { batch: { dbnum: 8000, end_sesno: 1 } } } })).toBeNull();
    expect(parseGenModelV1FinishedBatch({ type: 'task_finished', payload: { state: 'succeeded', result: {} } })).toBeNull();
    expect(parseGenModelV1FinishedBatch({ type: 'task_finished', payload: { state: 'succeeded', result: { batch: { dbnum: '8000', end_sesno: 1 } } } })).toBeNull();
  });

  it('摘出库 / 会话 / 变化数，根统一成 a_b', () => {
    const batch = parseGenModelV1FinishedBatch(finished({}, [
      { root_refno: '24384/24776', kind: 'transform' },
      { root_refno: '24384_24776', kind: 'transform' },
      { root_refno: '24384/23257', kind: 'regen' },
      { kind: 'regen' },
    ]));
    expect(batch).toEqual({
      taskId: 'db-20261026-220357-000053',
      dbnum: 8000,
      dbType: 'DESI',
      startSesno: 734,
      endSesno: 734,
      changedElements: 2,
      roots: ['24384_24776', '24384_23257'],
      finishedAt: '2026-10-26T22:03:58.282715800+08:00',
    });
  });
});

describe('evaluateGenModelV1UpdateNotice', () => {
  const base = parseGenModelV1FinishedBatch(finished())!;

  it('非 DESI 库不提示', () => {
    expect(evaluateGenModelV1UpdateNotice({ ...base, dbType: 'SYST', dbnum: 8191 }, probeOf([8191], []))).toBeNull();
  });

  it('只登录不改（无变化、无单元）不提示', () => {
    expect(evaluateGenModelV1UpdateNotice({ ...base, changedElements: 0, roots: [] }, probeOf([8000], []))).toBeNull();
  });

  it('库已装入就提示，并标出批次里哪些根已在场景', () => {
    const notice = evaluateGenModelV1UpdateNotice(base, probeOf([8000], ['24384_24776']), 1000);
    expect(notice).toMatchObject({ dbnum: 8000, endSesno: 734, loadedRoots: ['24384_24776'], receivedAt: 1000 });
    expect(evaluateGenModelV1UpdateNotice(base, probeOf([8000], []), 1000)?.loadedRoots).toEqual([]);
  });

  it('库没按整库装、但批次里的根在场景里，也提示', () => {
    expect(evaluateGenModelV1UpdateNotice(base, probeOf([7997], ['24384_24776']))?.loadedRoots).toEqual(['24384_24776']);
    expect(evaluateGenModelV1UpdateNotice(base, probeOf([7997], []))).toBeNull();
  });
});

describe('通知状态', () => {
  it('相关批次写进 notice，后来的同库批次顶掉前一条；每一批都通知批次订阅者', () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24776']));
    const seen: number[] = [];
    const unsubscribe = subscribeGenModelV1FinishedBatches((batch) => seen.push(batch.endSesno));
    const { notice, hasNotice } = useGenModelV1UpdateNotice();

    handleGenModelV1TaskEnvelopeForNotice(finished({ end_sesno: 733, changed_elements: 0 }, []));
    expect(hasNotice.value).toBe(false);
    handleGenModelV1TaskEnvelopeForNotice(finished({ end_sesno: 734 }));
    expect(notice.value?.endSesno).toBe(734);
    handleGenModelV1TaskEnvelopeForNotice(finished({ end_sesno: 736 }));
    expect(notice.value?.endSesno).toBe(736);
    expect(seen).toEqual([733, 734, 736]);

    dismissGenModelV1UpdateNotice();
    expect(notice.value).toBeNull();
    unsubscribe();
    handleGenModelV1TaskEnvelopeForNotice(finished({ end_sesno: 737 }));
    expect(seen).toEqual([733, 734, 736]);
  });

  it('没有探针（查看器还没就绪）时不提示，但批次订阅者照样收到', () => {
    const seen: string[] = [];
    subscribeGenModelV1FinishedBatches((batch) => seen.push(batch.taskId));
    handleGenModelV1TaskEnvelopeForNotice(finished());
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
    expect(seen).toEqual(['db-20261026-220357-000053']);
  });

  it('重载只派发已在场景里的根，带 refreshModel 且不飞相机；派发后清掉提示', () => {
    setGenModelV1LoadedProbe(probeOf([8000], ['24384_24776']));
    handleGenModelV1TaskEnvelopeForNotice(finished({}, [
      { root_refno: '24384/24776', kind: 'transform' },
      { root_refno: '24384/23257', kind: 'regen' },
    ]));
    const dispatch = vi.fn();
    expect(reloadGenModelV1UpdateNotice(dispatch)).toEqual(['24384_24776']);
    expect(dispatch).toHaveBeenCalledWith({ refnos: ['24384_24776'], refreshModel: true, flyTo: false });
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
  });

  it('受影响的根都没装进场景时，重载什么也不派发', () => {
    setGenModelV1LoadedProbe(probeOf([8000], []));
    handleGenModelV1TaskEnvelopeForNotice(finished());
    expect(useGenModelV1UpdateNotice().notice.value?.loadedRoots).toEqual([]);
    const dispatch = vi.fn();
    expect(reloadGenModelV1UpdateNotice(dispatch)).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(useGenModelV1UpdateNotice().notice.value).toBeNull();
  });

  it('start 只订阅一次任务流，信封从任务流进来', () => {
    setGenModelV1LoadedProbe(probeOf([8000], []));
    startGenModelV1UpdateNotice();
    startGenModelV1UpdateNotice();
    expect(feedListeners.size).toBe(1);
    for (const listener of feedListeners) listener(finished());
    expect(useGenModelV1UpdateNotice().notice.value?.dbnum).toBe(8000);
  });
});