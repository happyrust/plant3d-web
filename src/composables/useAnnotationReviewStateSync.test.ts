import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { annotationReviewStatesQuery } from '@/api/reviewApi';

vi.mock('@/api/reviewApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/reviewApi')>();
  return {
    ...actual,
    annotationReviewStatesQuery: vi.fn(),
  };
});

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

async function loadStore() {
  const mod = await import('@/composables/useToolStore');
  return mod.useToolStore();
}

async function syncStates(options: {
  formId: string;
  taskId?: string;
  shouldApply?: () => boolean;
  force?: boolean;
  freshWindowMs?: number;
}) {
  const mod = await import('@/composables/useAnnotationReviewStateSync');
  return mod.syncAnnotationReviewStates(options);
}

function okResponse(formId: string, taskId: string, note = 'x') {
  return {
    success: true,
    states: [{
      formId,
      taskId,
      annotationId: 'ann-shared',
      annotationType: 'text' as const,
      workflowNode: 'sj' as const,
      reviewRound: 1,
      resolutionStatus: 'fixed' as const,
      decisionStatus: 'pending' as const,
      note,
      updatedById: 'SJ',
      updatedByName: 'SJ',
      updatedByRole: 'sj' as const,
      updatedAt: 100,
      history: [],
    }],
  };
}

describe('syncAnnotationReviewStates', () => {
  beforeEach(async () => {
    vi.mocked(annotationReviewStatesQuery).mockReset();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
    localStorage.clear();
    window.history.replaceState({}, '', '?output_project=AvevaMarineSample&show_dbnum=7997');
    const mod = await import('@/composables/useAnnotationReviewStateSync');
    mod.invalidateAnnotationReviewStatesCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('同参在飞合并：两处并发调用只发一次请求，各自都拿到回包并按自己的守卫写 store', async () => {
    const store = await loadStore();
    store.clearAll();
    store.addAnnotation({
      id: 'ann-shared',
      entityId: 'entity-shared',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: 'Shared annotation',
      description: '',
      createdAt: 1,
    });
    let resolveQuery: (value: ReturnType<typeof okResponse>) => void = () => undefined;
    vi.mocked(annotationReviewStatesQuery).mockImplementation(() => new Promise((resolve) => {
      resolveQuery = resolve as typeof resolveQuery;
    }));

    const guardA = vi.fn(() => true);
    const guardB = vi.fn(() => false);
    // 直接拿模块函数并发调（不经过带 await import 的包装），请求在第一个 await 之前就已发出
    const mod = await import('@/composables/useAnnotationReviewStateSync');
    const pendingA = mod.syncAnnotationReviewStates({ formId: 'FORM-S', taskId: 'task-s', shouldApply: guardA });
    const pendingB = mod.syncAnnotationReviewStates({ formId: 'FORM-S', taskId: 'task-s', shouldApply: guardB });
    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(1);

    resolveQuery(okResponse('FORM-S', 'task-s', '在飞合并'));
    const [resultA, resultB] = await Promise.all([pendingA, pendingB]);

    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(1);
    expect(resultA).toMatchObject({ ok: true, appliedCount: 1, totalCount: 1 });
    expect(resultB).toEqual({ ok: true, appliedCount: 0, totalCount: 1, skipped: true });
    expect(store.getAnnotationReviewState('text', 'ann-shared').note).toBe('在飞合并');
  });

  it('短窗复用：回包后窗内同参再调不发请求，窗外、换 taskId、force 都重新发', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-22T08:00:00Z'));
    vi.mocked(annotationReviewStatesQuery).mockResolvedValue(okResponse('FORM-W', 'task-w'));

    await syncStates({ formId: 'FORM-W', taskId: 'task-w', freshWindowMs: 1000 });
    await syncStates({ formId: 'FORM-W', taskId: 'task-w', freshWindowMs: 1000 });
    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-09-22T08:00:00.900Z'));
    await syncStates({ formId: 'FORM-W', taskId: 'task-w', freshWindowMs: 1000 });
    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(1);

    // 换 taskId 是另一把 key
    await syncStates({ formId: 'FORM-W', freshWindowMs: 1000 });
    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(2);
    expect(vi.mocked(annotationReviewStatesQuery).mock.calls[1]?.[0]).toEqual({ formId: 'FORM-W', taskId: undefined });

    // force 绕开
    await syncStates({ formId: 'FORM-W', taskId: 'task-w', freshWindowMs: 1000, force: true });
    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(3);

    // 窗外
    vi.setSystemTime(new Date('2026-09-22T08:00:02Z'));
    await syncStates({ formId: 'FORM-W', taskId: 'task-w', freshWindowMs: 1000 });
    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(4);
  });

  it('失败的回包不进窗：success=false 或抛错后下一次照常重发；invalidate 后也重发', async () => {
    vi.mocked(annotationReviewStatesQuery)
      .mockResolvedValueOnce({ success: false, errorMessage: 'boom', states: [] })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(okResponse('FORM-F', 'task-f'));

    expect(await syncStates({ formId: 'FORM-F', taskId: 'task-f' })).toMatchObject({ ok: false, errorMessage: 'boom' });
    expect(await syncStates({ formId: 'FORM-F', taskId: 'task-f' })).toMatchObject({ ok: false, errorMessage: 'network' });
    expect(await syncStates({ formId: 'FORM-F', taskId: 'task-f' })).toMatchObject({ ok: true });
    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(3);

    // 成功回包在窗内：复用
    await syncStates({ formId: 'FORM-F', taskId: 'task-f' });
    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(3);

    // 本地刚提交过处理动作 → 作废该单据的窗 → 重发
    const mod = await import('@/composables/useAnnotationReviewStateSync');
    mod.invalidateAnnotationReviewStatesCache('FORM-F');
    await syncStates({ formId: 'FORM-F', taskId: 'task-f' });
    expect(annotationReviewStatesQuery).toHaveBeenCalledTimes(4);
  });

  it('同一批注存在多轮状态时只应用最新轮次，避免旧驳回状态覆盖 SJ 二次处理结果', async () => {
    const store = await loadStore();
    store.clearAll();
    store.addAnnotation({
      id: 'ann-round',
      entityId: 'entity-round',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: 'Round annotation',
      description: '',
      createdAt: 1,
    });

    vi.mocked(annotationReviewStatesQuery).mockResolvedValue({
      success: true,
      states: [
        {
          formId: 'FORM-ROUND',
          taskId: 'task-round',
          annotationId: 'ann-round',
          annotationType: 'text',
          workflowNode: 'sj',
          reviewRound: 2,
          resolutionStatus: 'fixed',
          decisionStatus: 'pending',
          note: 'SJ 二次修改完成',
          updatedById: 'SJ',
          updatedByName: 'SJ',
          updatedByRole: 'sj',
          updatedAt: 200,
          history: [{
            action: 'fixed',
            resolutionStatus: 'fixed',
            decisionStatus: 'pending',
            operatorId: 'SJ',
            operatorName: 'SJ',
            operatorRole: 'sj',
            timestamp: 200,
          }],
        },
        {
          formId: 'FORM-ROUND',
          taskId: 'task-round',
          annotationId: 'ann-round',
          annotationType: 'text',
          workflowNode: 'jd',
          reviewRound: 1,
          resolutionStatus: 'open',
          decisionStatus: 'rejected',
          note: 'JH 上一轮驳回',
          updatedById: 'JH',
          updatedByName: 'JH',
          updatedByRole: 'jd',
          updatedAt: 300,
          history: [{
            action: 'reject',
            resolutionStatus: 'open',
            decisionStatus: 'rejected',
            operatorId: 'JH',
            operatorName: 'JH',
            operatorRole: 'jd',
            timestamp: 300,
          }],
        },
      ],
    });

    const result = await syncStates({ formId: 'FORM-ROUND', taskId: 'task-round' });
    const state = store.getAnnotationReviewState('text', 'ann-round');

    expect(result).toMatchObject({ ok: true, appliedCount: 1, totalCount: 2 });
    expect(state.resolutionStatus).toBe('fixed');
    expect(state.decisionStatus).toBe('pending');
    expect(state.note).toBe('SJ 二次修改完成');
  });

  it('U0 回执守卫：请求回来后 shouldApply 说不该写，就一条都不写、结果标 skipped', async () => {
    const store = await loadStore();
    store.clearAll();
    store.addAnnotation({
      id: 'ann-guarded',
      entityId: 'entity-guarded',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: 'Guarded annotation',
      description: '',
      createdAt: 1,
    });
    const before = store.getAnnotationReviewState('text', 'ann-guarded');

    vi.mocked(annotationReviewStatesQuery).mockResolvedValue({
      success: true,
      states: [{
        formId: 'FORM-G',
        taskId: 'task-g',
        annotationId: 'ann-guarded',
        annotationType: 'text',
        workflowNode: 'sj',
        reviewRound: 1,
        resolutionStatus: 'fixed',
        decisionStatus: 'pending',
        note: '迟到的状态',
        updatedById: 'SJ',
        updatedByName: 'SJ',
        updatedByRole: 'sj',
        updatedAt: 200,
        history: [],
      }],
    });

    const shouldApply = vi.fn(() => false);
    const result = await syncStates({ formId: 'FORM-G', taskId: 'task-g', shouldApply });

    expect(shouldApply).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, appliedCount: 0, totalCount: 1, skipped: true });
    expect(store.getAnnotationReviewState('text', 'ann-guarded')).toEqual(before);
  });
});
