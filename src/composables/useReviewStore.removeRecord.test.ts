import { beforeEach, describe, expect, it, vi } from 'vitest';

const reviewRecordDeleteMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  reviewRecordCreate: vi.fn(),
  reviewRecordDelete: reviewRecordDeleteMock,
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

function makeRecord(id: string) {
  return {
    id,
    type: 'batch' as const,
    annotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    obbAnnotations: [],
    measurements: [],
    confirmedAt: Date.now(),
    note: '',
  };
}

describe('useReviewStore.removeConfirmedRecord', () => {
  beforeEach(() => {
    reviewRecordDeleteMock.mockReset();
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('后端删除失败时不应删除本地记录', async () => {
    reviewRecordDeleteMock.mockResolvedValue({
      success: false,
      error_message: 'delete failed',
    });

    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();
    store.confirmedRecords.value = [makeRecord('r-1')];

    await store.removeConfirmedRecord('r-1');

    expect(store.confirmedRecords.value).toHaveLength(1);
    expect(store.confirmedRecords.value[0]?.id).toBe('r-1');
  });

  it('后端删除成功时应删除本地记录', async () => {
    reviewRecordDeleteMock.mockResolvedValue({ success: true });

    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();
    store.confirmedRecords.value = [makeRecord('r-2')];

    await store.removeConfirmedRecord('r-2');

    expect(store.confirmedRecords.value).toHaveLength(0);
  });
});
