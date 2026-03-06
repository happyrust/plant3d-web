import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/reviewApi', () => ({
  reviewTaskCreate: vi.fn(),
  reviewTaskGetList: vi.fn(),
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

describe('useUserStore persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('应从持久化恢复 useBackend 配置', async () => {
    localStorage.setItem(
      'plant3d-web-user-v3',
      JSON.stringify({
        version: 3,
        currentUserId: 'designer_001',
        useBackend: false,
        reviewTasks: [],
      })
    );

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    expect(store.useBackend.value).toBe(false);
  });
});
