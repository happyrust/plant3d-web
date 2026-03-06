import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/reviewApi', () => ({
  reviewRecordCreate: vi.fn(),
  reviewRecordDelete: vi.fn(),
  reviewRecordGetByTaskId: vi.fn(),
  reviewRecordClearByTaskId: vi.fn(),
  reviewTaskGetHistory: vi.fn(),
  getReviewUserWebSocketUrl: vi.fn(() => 'ws://localhost/ws/review/user/tester'),
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

describe('useReviewStore persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('应从持久化恢复 useBackend 配置', async () => {
    localStorage.setItem(
      'plant3d-web-review-v2',
      JSON.stringify({
        version: 2,
        reviewMode: false,
        confirmedRecords: [],
        useBackend: false,
      })
    );

    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();

    expect(store.useBackend.value).toBe(false);
  });
});
