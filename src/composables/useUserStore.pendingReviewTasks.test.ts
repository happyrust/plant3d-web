import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/reviewApi', () => ({
  authGetToken: vi.fn(async () => ({ success: true, token: 'token-proofreader' })),
  reviewTaskCreate: vi.fn(),
  reviewTaskGetList: vi.fn(),
  reviewTaskGetById: vi.fn(),
  reviewTaskUpdate: vi.fn(),
  reviewTaskDelete: vi.fn(),
  reviewTaskStartReview: vi.fn(),
  reviewTaskApprove: vi.fn(),
  reviewTaskCancel: vi.fn(),
  reviewTaskSubmitToNext: vi.fn(),
  reviewTaskReturn: vi.fn(),
  reviewTaskGetWorkflow: vi.fn(),
  userGetList: vi.fn(),
  userGetCurrent: vi.fn(async () => ({ success: false })),
  userGetReviewers: vi.fn(),
  getReviewWebSocketUrl: vi.fn(() => null),
  getReviewUserWebSocketUrl: vi.fn(() => null),
}));

let authGetTokenMock: ReturnType<typeof vi.fn>;
let userGetCurrentMock: ReturnType<typeof vi.fn>;

function createStorageMock() {
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

describe('useUserStore pendingReviewTasks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createStorageMock());
    vi.stubGlobal('sessionStorage', createStorageMock());
    return vi.importMock<typeof import('@/api/reviewApi')>('@/api/reviewApi').then((api) => {
      authGetTokenMock = api.authGetToken as ReturnType<typeof vi.fn>;
      userGetCurrentMock = api.userGetCurrent as ReturnType<typeof vi.fn>;
      authGetTokenMock.mockReset();
      userGetCurrentMock.mockReset();
      authGetTokenMock.mockResolvedValue({ success: true, token: 'token-proofreader' });
      userGetCurrentMock.mockResolvedValue({ success: false });
    });
  });

  it('保留已驳回任务在原校对人列表中，即使 currentNode 已回到 sj', async () => {
    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.switchUser('proofreader_001');
    store.reviewTasks.value = [
      {
        id: 'task-rejected-at-sj',
        title: 'Rejected back to designer',
        description: 'desc',
        modelName: 'Hull',
        status: 'rejected',
        priority: 'medium',
        requesterId: 'designer_001',
        requesterName: '王设计师',
        checkerId: 'proofreader_001',
        checkerName: '张校对员',
        approverId: 'reviewer_001',
        approverName: '李审核员',
        reviewerId: 'proofreader_001',
        reviewerName: '张校对员',
        currentNode: 'sj',
        components: [],
        createdAt: 1700000020000,
        updatedAt: 1700000021000,
      },
    ];

    expect(store.pendingReviewTasks.value.map((task) => task.id)).toEqual([
      'task-rejected-at-sj',
    ]);
  });
});
