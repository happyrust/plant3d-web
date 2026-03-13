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
});
