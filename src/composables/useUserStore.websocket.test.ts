import { beforeEach, describe, expect, it, vi } from 'vitest';

const webSocketCtor = vi.fn(() => {
  throw new Error('WebSocket should stay disabled in this test');
});

vi.mock('@/api/reviewApi', () => ({
  authGetToken: vi.fn(),
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
  getReviewWebSocketUrl: vi.fn(() => null),
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

describe('useUserStore websocket fallback', () => {
  beforeEach(() => {
    webSocketCtor.mockClear();
    vi.resetModules();
    vi.stubGlobal('localStorage', createLocalStorageMock());
    vi.stubGlobal('WebSocket', webSocketCtor);
  });

  it('skips websocket connection when review websocket url is unavailable', async () => {
    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    store.connectWebSocket();

    expect(webSocketCtor).not.toHaveBeenCalled();
    expect(store.wsConnected.value).toBe(false);
    expect(store.wsError.value).toBeNull();
  });
});
