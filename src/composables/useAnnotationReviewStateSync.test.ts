import { beforeEach, describe, expect, it, vi } from 'vitest';

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

async function syncStates(options: { formId: string; taskId?: string }) {
  const mod = await import('@/composables/useAnnotationReviewStateSync');
  return mod.syncAnnotationReviewStates(options);
}

describe('syncAnnotationReviewStates', () => {
  beforeEach(() => {
    vi.mocked(annotationReviewStatesQuery).mockReset();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
    localStorage.clear();
    window.history.replaceState({}, '', '?output_project=AvevaMarineSample&show_dbnum=7997');
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
});
