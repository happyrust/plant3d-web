import { beforeEach, describe, expect, it, vi } from 'vitest';

const webSocketCtor = vi.fn(() => {
  throw new Error('WebSocket should stay disabled in this test');
});

vi.mock('@/api/reviewApi', () => ({
  reviewRecordCreate: vi.fn(),
  reviewRecordDelete: vi.fn(),
  reviewRecordGetByTaskId: vi.fn(),
  reviewRecordClearByTaskId: vi.fn(),
  reviewTaskGetHistory: vi.fn(),
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
});
