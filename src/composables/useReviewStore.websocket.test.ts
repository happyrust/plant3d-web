import { beforeEach, describe, expect, it, vi } from 'vitest';

const reviewTaskGetHistoryMock = vi.fn(async () => ({ success: true, history: [] }));
const reviewRecordGetByTaskIdMock = vi.fn(async () => ({ success: true, records: [] }));

const webSocketCtor = vi.fn(() => {
  throw new Error('WebSocket should stay disabled in this test');
});

vi.mock('@/api/reviewApi', () => ({
  reviewRecordCreate: vi.fn(),
  reviewRecordDelete: vi.fn(),
  reviewRecordGetByTaskId: reviewRecordGetByTaskIdMock,
  reviewRecordClearByTaskId: vi.fn(),
  reviewTaskGetHistory: reviewTaskGetHistoryMock,
  getReviewUserWebSocketUrl: vi.fn(() => null),
}));

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
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

describe('useReviewStore websocket fallback', () => {
  beforeEach(() => {
    webSocketCtor.mockClear();
    reviewTaskGetHistoryMock.mockClear();
    reviewRecordGetByTaskIdMock.mockClear();
    vi.resetModules();
    vi.stubGlobal('localStorage', createLocalStorageMock());
    vi.stubGlobal('WebSocket', webSocketCtor);
  });

  it('skips reviewer websocket connection when review websocket url is unavailable', async () => {
    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();

    store.connectWebSocket('reviewer_001');

    expect(webSocketCtor).not.toHaveBeenCalled();
    expect(store.wsConnected.value).toBe(false);
    expect(store.wsError.value).toBeNull();
  });

  it('rehydrates the same current task after a workflow mutation refresh', async () => {
    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();
    const task = {
      id: 'task-1',
      title: 'Task 1',
      description: 'desc',
      modelName: 'Model',
      status: 'submitted',
      priority: 'medium',
      requesterId: 'designer-1',
      requesterName: 'Designer',
      reviewerId: 'checker-1',
      reviewerName: 'Checker',
      components: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      currentNode: 'jd',
    };

    await store.setCurrentTask(task as never);

    expect(store.currentTask.value?.id).toBe('task-1');
    expect(store.currentTask.value?.currentNode).toBe('jd');

    await store.setCurrentTask({
      ...task,
      currentNode: 'sh',
      status: 'in_review',
      updatedAt: 1700000005000,
    } as never);

    expect(store.currentTask.value?.id).toBe('task-1');
    expect(store.currentTask.value?.currentNode).toBe('sh');
    expect(store.currentTask.value?.status).toBe('in_review');
    expect(reviewRecordGetByTaskIdMock).toHaveBeenCalledTimes(2);
    expect(reviewTaskGetHistoryMock).toHaveBeenCalledTimes(2);
  });

  it('hydrates reviewer workspace context when selecting an active reviewer task', async () => {
    reviewRecordGetByTaskIdMock.mockResolvedValueOnce({
      success: true,
      records: [
        {
          id: 'record-1',
          taskId: 'task-hydration',
          annotations: [],
          cloudAnnotations: [],
          rectAnnotations: [],
          obbAnnotations: [],
          measurements: [],
          confirmedAt: 1700000002000,
          note: 'already captured',
        },
      ],
    });
    reviewTaskGetHistoryMock.mockResolvedValueOnce({
      success: true,
      history: [
        {
          node: 'jd',
          action: 'submit',
          operatorId: 'checker-1',
          operatorName: 'Checker One',
          comment: 'handoff to reviewer workspace',
          timestamp: 1700000003000,
        },
      ],
    });

    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();

    await store.setCurrentTask({
      id: 'task-hydration',
      title: 'Hydrated Reviewer Task',
      description: 'desc',
      modelName: 'Hull-A',
      status: 'in_review',
      priority: 'high',
      requesterId: 'designer-1',
      requesterName: 'Designer One',
      checkerId: 'checker-1',
      checkerName: 'Checker One',
      approverId: 'approver-1',
      approverName: 'Approver One',
      reviewerId: 'checker-1',
      reviewerName: 'Checker One',
      components: [
        { id: 'component-1', name: 'Pipe-100', refNo: '100_1', type: 'Pipe' },
        { id: 'component-2', name: 'Valve-200', refNo: '200_1', type: 'Valve' },
      ],
      attachments: [
        {
          id: 'attachment-1',
          name: 'handoff.pdf',
          url: 'http://example.test/handoff.pdf',
          uploadedAt: 1700000001000,
        },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000005000,
      currentNode: 'sh',
      formId: 'FORM-REVIEW-1',
    } as never);

    expect(store.currentTask.value).toEqual(
      expect.objectContaining({
        id: 'task-hydration',
        title: 'Hydrated Reviewer Task',
        requesterName: 'Designer One',
        checkerName: 'Checker One',
        approverName: 'Approver One',
        currentNode: 'sh',
        formId: 'FORM-REVIEW-1',
      })
    );
    expect(store.currentTask.value?.components).toHaveLength(2);
    expect(store.currentTask.value?.attachments).toHaveLength(1);
    expect(store.confirmedRecordCount.value).toBe(1);
    expect(store.sortedConfirmedRecords.value[0]?.taskId).toBe('task-hydration');
    expect(store.reviewHistory.value).toEqual([
      expect.objectContaining({
        node: 'jd',
        action: 'submit',
        operatorName: 'Checker One',
        comment: 'handoff to reviewer workspace',
      }),
    ]);
  });

  it('keeps workflow history separate from confirmed records after hydration', async () => {
    reviewRecordGetByTaskIdMock.mockResolvedValueOnce({
      success: true,
      records: [],
    });
    reviewTaskGetHistoryMock.mockResolvedValueOnce({
      success: true,
      history: [
        {
          node: 'sj',
          action: 'submit',
          operatorId: 'designer-1',
          operatorName: 'Designer One',
          comment: 'submit to checker',
          timestamp: 1700000001000,
        },
        {
          node: 'jd',
          action: 'submit',
          operatorId: 'checker-1',
          operatorName: 'Checker One',
          comment: 'submit to reviewer',
          timestamp: 1700000002000,
        },
      ],
    });

    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();

    await store.setCurrentTask({
      id: 'task-history',
      title: 'Workflow history task',
      description: 'desc',
      modelName: 'Model-H',
      status: 'in_review',
      priority: 'medium',
      requesterId: 'designer-1',
      requesterName: 'Designer One',
      checkerId: 'checker-1',
      checkerName: 'Checker One',
      approverId: 'approver-1',
      approverName: 'Approver One',
      reviewerId: 'checker-1',
      reviewerName: 'Checker One',
      components: [],
      createdAt: 1700000000000,
      updatedAt: 1700000003000,
      currentNode: 'sh',
    } as never);

    expect(store.confirmedRecordCount.value).toBe(0);
    expect(store.sortedConfirmedRecords.value).toEqual([]);
    expect(store.reviewHistory.value).toEqual([
      expect.objectContaining({
        node: 'sj',
        action: 'submit',
        operatorName: 'Designer One',
      }),
      expect.objectContaining({
        node: 'jd',
        action: 'submit',
        operatorName: 'Checker One',
      }),
    ]);
  });
});
