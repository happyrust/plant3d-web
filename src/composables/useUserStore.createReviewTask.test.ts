import { beforeEach, describe, expect, it, vi } from 'vitest';

const reviewTaskCreateMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  reviewTaskCreate: reviewTaskCreateMock,
  reviewTaskGetList: vi.fn(async () => ({ success: true, tasks: [], total: 0 })),
  reviewTaskGetById: vi.fn(),
  reviewTaskUpdate: vi.fn(),
  reviewTaskDelete: vi.fn(),
  reviewTaskStartReview: vi.fn(),
  reviewTaskApprove: vi.fn(),
  reviewTaskReject: vi.fn(),
  reviewTaskCancel: vi.fn(),
  reviewTaskSubmitToNext: vi.fn(),
  reviewTaskReturn: vi.fn(),
  reviewTaskGetWorkflow: vi.fn(),
  userGetList: vi.fn(),
  userGetCurrent: vi.fn(),
  userGetReviewers: vi.fn(),
  getReviewWebSocketUrl: vi.fn(() => 'ws://localhost/ws/review'),
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

describe('useUserStore.createReviewTask', () => {
  beforeEach(() => {
    reviewTaskCreateMock.mockReset();
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('后端返回失败时应抛错，不回退本地任务', async () => {
    reviewTaskCreateMock.mockResolvedValue({
      success: false,
      error_message: 'backend failed',
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await expect(
      store.createReviewTask({
        title: 'task-1',
        description: 'desc',
        modelName: 'model',
        reviewerId: 'reviewer_001',
        priority: 'medium',
        components: [{ id: 'c1', name: 'Comp', refNo: '100_1' }],
      })
    ).rejects.toThrow('backend failed');

    expect(store.reviewTasks.value).toHaveLength(0);
  });

  it('后端请求异常时应抛错，不回退本地任务', async () => {
    reviewTaskCreateMock.mockRejectedValue(new Error('network broken'));

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await expect(
      store.createReviewTask({
        title: 'task-2',
        description: 'desc',
        modelName: 'model',
        reviewerId: 'reviewer_001',
        priority: 'medium',
        components: [{ id: 'c1', name: 'Comp', refNo: '100_1' }],
      })
    ).rejects.toThrow('network broken');

    expect(store.reviewTasks.value).toHaveLength(0);
  });
});
