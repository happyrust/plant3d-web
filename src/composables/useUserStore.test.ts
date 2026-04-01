import { beforeEach, describe, it, expect, vi } from 'vitest';

import {
  buildSwitchUserTokenRequest,
  isCheckerRole,
  isApproverRole,
  getNextWorkflowNode,
  normalizeReviewTask,
  resolveEffectiveUserId,
  resolveReviewProjectIdFromSession,
  statusFromNode,
  normalizeBackendUser,
} from './useUserStore';

import { UserRole, UserStatus } from '@/types/auth';

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

let authGetTokenMock: ReturnType<typeof vi.fn>;
let reviewTaskGetListMock: ReturnType<typeof vi.fn>;
let userGetCurrentMock: ReturnType<typeof vi.fn>;
let reviewTaskCreateMock: ReturnType<typeof vi.fn>;
let reviewTaskSubmitToNextMock: ReturnType<typeof vi.fn>;
let getReviewUserWebSocketUrlMock: ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('localStorage', createStorageMock());
  vi.stubGlobal('sessionStorage', createStorageMock());

  const reviewApi = vi.mocked(vi.importMock<typeof import('@/api/reviewApi')>('@/api/reviewApi'));
  return reviewApi.then((api) => {
    authGetTokenMock = api.authGetToken as ReturnType<typeof vi.fn>;
    reviewTaskGetListMock = api.reviewTaskGetList as ReturnType<typeof vi.fn>;
    userGetCurrentMock = api.userGetCurrent as ReturnType<typeof vi.fn>;
    reviewTaskCreateMock = api.reviewTaskCreate as ReturnType<typeof vi.fn>;
    reviewTaskSubmitToNextMock = api.reviewTaskSubmitToNext as ReturnType<typeof vi.fn>;
    getReviewUserWebSocketUrlMock = api.getReviewUserWebSocketUrl as ReturnType<typeof vi.fn>;
    authGetTokenMock.mockReset();
    reviewTaskGetListMock.mockReset();
    userGetCurrentMock.mockReset();
    reviewTaskCreateMock.mockReset();
    reviewTaskSubmitToNextMock.mockReset();
    getReviewUserWebSocketUrlMock.mockReset();
    getReviewUserWebSocketUrlMock.mockReturnValue(null);
  });
});

describe('isCheckerRole', () => {
  it('returns true for PROOFREADER', () => {
    expect(isCheckerRole(UserRole.PROOFREADER)).toBe(true);
  });

  it('treats REVIEWER as checker-compatible for aliased jd-stage sessions', () => {
    expect(isCheckerRole(UserRole.REVIEWER)).toBe(true);
  });

  it('returns false for non-checker roles', () => {
    expect(isCheckerRole(UserRole.DESIGNER)).toBe(false);
    expect(isCheckerRole(UserRole.MANAGER)).toBe(false);
    expect(isCheckerRole(UserRole.ADMIN)).toBe(false);
    expect(isCheckerRole(undefined)).toBe(false);
  });
});

describe('isApproverRole', () => {
  it('returns true for MANAGER, ADMIN', () => {
    expect(isApproverRole(UserRole.MANAGER)).toBe(true);
    expect(isApproverRole(UserRole.ADMIN)).toBe(true);
  });

  it('returns false for non-approver roles', () => {
    expect(isApproverRole(UserRole.DESIGNER)).toBe(false);
    expect(isApproverRole(UserRole.PROOFREADER)).toBe(false);
    expect(isApproverRole(UserRole.REVIEWER)).toBe(false);
    expect(isApproverRole(undefined)).toBe(false);
  });
});

describe('loadReviewTasks', () => {
  it('queries checker inbox tasks with checkerId when switched into reviewer alias', async () => {
    userGetCurrentMock.mockResolvedValue({ success: false });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [],
      total: 0,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.switchUser('reviewer_001');

    expect(reviewTaskGetListMock).toHaveBeenCalledWith({ checkerId: 'user-002' });
  });

  it('queries approver inbox tasks with approverId for manager roles', async () => {
    userGetCurrentMock.mockResolvedValue({
      success: true,
      user: {
        id: 'manager_001',
        username: 'manager',
        email: 'manager@example.com',
        name: '陈经理',
        role: 'pz',
      },
    });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [],
      total: 0,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.switchUser('manager_001');

    expect(reviewTaskGetListMock).toHaveBeenCalledWith({ approverId: 'manager_001' });
  });

  it('queries designer initiated tasks by requesterId and keeps seeded loop tasks discoverable for designer surfaces', async () => {
    userGetCurrentMock.mockResolvedValue({ success: false });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [
        {
          id: 'seed-loop-task',
          title: 'M6 loop task',
          description: 'seeded return/resubmit/reopen loop',
          modelName: 'Loop Model',
          status: 'submitted',
          priority: 'urgent',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          currentNode: 'jd',
          formId: 'FORM-M6M7-LOOP-001',
          components: [],
          createdAt: 1700000000000,
          updatedAt: 1700000001000,
        },
      ],
      total: 1,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.loadReviewTasks();

    expect(reviewTaskGetListMock).toHaveBeenCalledWith({ requesterId: 'designer_001' });
    expect(store.myInitiatedTasks.value.map((task) => task.id)).toContain('seed-loop-task');
    expect(store.myInitiatedTasks.value[0]).toEqual(
      expect.objectContaining({
        id: 'seed-loop-task',
        formId: 'FORM-M6M7-LOOP-001',
        currentNode: 'jd',
        status: 'submitted',
      })
    );
  });

  it('keeps approved and rejected tasks visible in reviewer inbox collections', async () => {
    userGetCurrentMock.mockResolvedValue({ success: false });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [
        {
          id: 'task-submitted',
          title: 'Submitted reviewer task',
          description: 'desc',
          modelName: 'Hull',
          status: 'submitted',
          priority: 'high',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          currentNode: 'jd',
          components: [],
          createdAt: 1700000000000,
          updatedAt: 1700000001000,
        },
        {
          id: 'task-approved',
          title: 'Approved reviewer task',
          description: 'desc',
          modelName: 'Hull',
          status: 'approved',
          priority: 'medium',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          currentNode: 'jd',
          components: [],
          createdAt: 1700000002000,
          updatedAt: 1700000003000,
        },
        {
          id: 'task-rejected',
          title: 'Rejected reviewer task',
          description: 'desc',
          modelName: 'Hull',
          status: 'rejected',
          priority: 'low',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          currentNode: 'jd',
          components: [],
          createdAt: 1700000004000,
          updatedAt: 1700000005000,
        },
        {
          id: 'task-draft',
          title: 'Draft task',
          description: 'desc',
          modelName: 'Hull',
          status: 'draft',
          priority: 'low',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          currentNode: 'jd',
          components: [],
          createdAt: 1700000006000,
          updatedAt: 1700000007000,
        },
      ],
      total: 4,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.switchUser('reviewer_001');

    expect(store.pendingReviewTasks.value.map((task) => task.id)).toEqual([
      'task-submitted',
      'task-approved',
      'task-rejected',
    ]);
  });

  it('keeps pz-stage tasks visible for approver inbox collections', async () => {
    userGetCurrentMock.mockResolvedValue({
      success: true,
      user: {
        id: 'manager_001',
        username: 'manager',
        email: 'manager@example.com',
        name: '陈经理',
        role: 'pz',
      },
    });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [
        {
          id: 'task-pz-approved',
          title: 'Approved at pz node',
          description: 'desc',
          modelName: 'Hull',
          status: 'approved',
          priority: 'medium',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          currentNode: 'pz',
          components: [],
          createdAt: 1700000010000,
          updatedAt: 1700000011000,
        },
        {
          id: 'task-pz-rejected',
          title: 'Rejected at pz node',
          description: 'desc',
          modelName: 'Hull',
          status: 'rejected',
          priority: 'high',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          currentNode: 'pz',
          components: [],
          createdAt: 1700000012000,
          updatedAt: 1700000013000,
        },
      ],
      total: 2,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.switchUser('manager_001');

    expect(store.pendingReviewTasks.value.map((task) => task.id)).toEqual([
      'task-pz-approved',
      'task-pz-rejected',
    ]);
  });

  it('keeps backend canonical reviewer identity when embed user id is an external actor code', async () => {
    authGetTokenMock.mockResolvedValue({ success: true, token: 'token-reviewer' });
    userGetCurrentMock.mockResolvedValue({
      success: true,
      user: {
        id: 'user-002',
        username: 'reviewer',
        email: 'reviewer@example.com',
        name: '李审核员',
        role: 'jd',
      },
    });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [
        {
          id: 'task-form-match',
          title: '外部单据恢复',
          description: 'desc',
          modelName: 'Hull',
          status: 'submitted',
          priority: 'medium',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          currentNode: 'jd',
          formId: 'FORM-EMBED-1',
          components: [],
          createdAt: 1700000000000,
          updatedAt: 1700000001000,
        },
      ],
      total: 1,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.switchUser('reviewer_001');
    store.setEmbedUser('JH', 'jd');
    await store.loadReviewTasks();

    expect(store.currentUserId.value).toBe('reviewer_001');
    expect(store.currentUser.value?.name).toBe('李审核员');
    expect(reviewTaskGetListMock).toHaveBeenLastCalledWith({ checkerId: 'user-002' });
    expect(store.pendingReviewTasks.value.map((task) => task.formId)).toContain('FORM-EMBED-1');
  });

  it('prefers verified embed actor over backend debug user when claims are trusted', async () => {
    userGetCurrentMock.mockResolvedValue({
      success: true,
      user: {
        id: 'debug-user',
        username: 'debug-user',
        email: 'debug-user@example.com',
        name: 'debug-user',
        role: 'sj',
      },
    });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [],
      total: 0,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.initialize();
    store.setEmbedUser('JH', 'jd', { verified: true });

    expect(store.currentUser.value?.id).toBe('JH');
    expect(store.currentUser.value?.role).toBe(UserRole.PROOFREADER);
  });

  it('clears backend debug identity when an embed session is invalidated', async () => {
    userGetCurrentMock.mockResolvedValue({
      success: true,
      user: {
        id: 'debug-user',
        username: 'debug-user',
        email: 'debug-user@example.com',
        name: 'debug-user',
        role: 'sj',
      },
    });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [],
      total: 0,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.initialize();
    expect(store.currentUser.value?.id).toBe('debug-user');

    store.clearCurrentUserSelection();

    expect(store.currentUser.value).toBeNull();
    expect(store.currentUserId.value).toBeNull();
    expect(store.reviewTasks.value).toEqual([]);
  });
});

describe('cross-role task visibility after task creation and submit', () => {
  it('keeps a newly submitted backend task visible to the initiator after submit refresh returns reviewer-scoped data', async () => {
    userGetCurrentMock.mockResolvedValue({ success: false });

    const createdTask = {
      id: 'task-cross-1',
      title: '跨角色联调任务',
      description: '用于验证发起后完整流转',
      modelName: '主装置模型',
      status: 'draft',
      priority: 'medium',
      requesterId: 'designer_001',
      requesterName: '王设计师',
      checkerId: 'proofreader_001',
      checkerName: '张校对员',
      approverId: 'reviewer_001',
      approverName: '李审核员',
      reviewerId: 'proofreader_001',
      reviewerName: '张校对员',
      components: [{ id: 'comp-1', name: 'BRAN-001', refNo: 'BRAN-001', type: 'pipe' }],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      currentNode: 'sj',
      workflowHistory: [],
    };

    reviewTaskCreateMock.mockResolvedValue({
      success: true,
      task: createdTask,
    });
    reviewTaskSubmitToNextMock.mockResolvedValue({ success: true });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [
        {
          ...createdTask,
          status: 'submitted',
          currentNode: 'jd',
          updatedAt: 1700000005000,
        },
      ],
      total: 1,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    const task = await store.createReviewTask({
      title: '跨角色联调任务',
      description: '用于验证发起后完整流转',
      modelName: '主装置模型',
      checkerId: 'proofreader_001',
      approverId: 'reviewer_001',
      priority: 'medium',
      components: [{ id: 'comp-1', name: 'BRAN-001', refNo: 'BRAN-001', type: 'pipe' }],
    });

    await store.submitTaskToNextNode(task.id, '发起提资');

    expect(reviewTaskGetListMock).toHaveBeenCalledWith({ requesterId: 'designer_001' });
    expect(store.myInitiatedTasks.value.map((item) => item.id)).toContain('task-cross-1');
    expect(store.myInitiatedTasks.value[0]?.status).toBe('submitted');
    expect(store.myInitiatedTasks.value[0]?.currentNode).toBe('jd');
  });
});

describe('review task websocket notifications', () => {
  it('prefers the user-scoped websocket endpoint for the active user', async () => {
    const onOpenHandlers: (() => void)[] = [];
    function MockWebSocket(this: any, url: string) {
      this.url = url;
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.close = vi.fn();
      this.send = vi.fn();
      onOpenHandlers.push(() => this.onopen?.());
    }
    const webSocketCtor = vi.fn(MockWebSocket as any);

    vi.stubGlobal('WebSocket', webSocketCtor as unknown as typeof WebSocket);
    getReviewUserWebSocketUrlMock.mockReturnValue('ws://localhost/ws/review/user/designer_001');
    userGetCurrentMock.mockResolvedValue({ success: false });
    reviewTaskGetListMock.mockResolvedValue({ success: true, tasks: [], total: 0 });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    store.connectWebSocket();
    onOpenHandlers.forEach((handler) => handler());

    expect(getReviewUserWebSocketUrlMock).toHaveBeenCalledWith('designer_001');
    expect(webSocketCtor).toHaveBeenCalledWith('ws://localhost/ws/review/user/designer_001');
    expect(store.wsConnected.value).toBe(true);
  });

  it('refreshes task list when receiving task_created events', async () => {
    const sockets: {
      onopen: null | (() => void);
      onmessage: null | ((event: { data: string }) => void);
      onclose: null | (() => void);
      close: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    }[] = [];
    function MockWebSocket(this: any) {
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.close = vi.fn();
      this.send = vi.fn();
      sockets.push(this);
    }
    const webSocketCtor = vi.fn(MockWebSocket as any);

    vi.stubGlobal('WebSocket', webSocketCtor as unknown as typeof WebSocket);
    getReviewUserWebSocketUrlMock.mockReturnValue('ws://localhost/ws/review/user/designer_001');
    reviewTaskGetListMock
      .mockResolvedValueOnce({ success: true, tasks: [], total: 0 })
      .mockResolvedValueOnce({
        success: true,
        tasks: [
          {
            id: 'task-created-1',
            title: '新建任务',
            description: 'from ws',
            modelName: 'Model-A',
            status: 'submitted',
            priority: 'medium',
            requesterId: 'designer_001',
            requesterName: '王设计师',
            checkerId: 'user-002',
            checkerName: '李校核员',
            approverId: 'manager_001',
            approverName: '陈经理',
            reviewerId: 'user-002',
            reviewerName: '李校核员',
            components: [],
            createdAt: 1700000000000,
            updatedAt: 1700000001000,
            currentNode: 'jd',
          },
        ],
        total: 1,
      });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.loadReviewTasks();
    store.connectWebSocket();
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: 'task_created',
        data: { id: 'task-created-1' },
        timestamp: new Date().toISOString(),
      }),
    });

    await Promise.resolve();

    expect(reviewTaskGetListMock).toHaveBeenCalledTimes(2);
    expect(store.myInitiatedTasks.value.map((task) => task.id)).toContain('task-created-1');
  });

  it('deduplicates concurrent task_created refreshes so the new task appears after one reload', async () => {
    const sockets: {
      onmessage: null | ((event: { data: string }) => void);
      close: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    }[] = [];
    function MockWebSocket(this: any) {
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.close = vi.fn();
      this.send = vi.fn();
      sockets.push(this);
    }

    vi.stubGlobal('WebSocket', vi.fn(MockWebSocket as any) as unknown as typeof WebSocket);
    getReviewUserWebSocketUrlMock.mockReturnValue('ws://localhost/ws/review/user/designer_001');

    let resolveRefresh: ((value: { success: true; tasks: any[]; total: number }) => void) | null = null;
    reviewTaskGetListMock
      .mockResolvedValueOnce({ success: true, tasks: [], total: 0 })
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveRefresh = resolve;
        })
      );

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.loadReviewTasks();
    store.connectWebSocket();

    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: 'task_created',
        data: { id: 'task-created-dedupe' },
        timestamp: new Date().toISOString(),
      }),
    });
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: 'task_created',
        data: { id: 'task-created-dedupe' },
        timestamp: new Date().toISOString(),
      }),
    });

    expect(reviewTaskGetListMock).toHaveBeenCalledTimes(2);

    resolveRefresh?.({
      success: true,
      tasks: [
        {
          id: 'task-created-dedupe',
          title: '并发创建任务',
          description: 'from deduped refresh',
          modelName: 'Model-Dedupe',
          status: 'submitted',
          priority: 'medium',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          components: [],
          createdAt: 1700000000000,
          updatedAt: 1700000002000,
          currentNode: 'jd',
        },
      ],
      total: 1,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(store.myInitiatedTasks.value.map((task) => task.id)).toContain('task-created-dedupe');
  });

  it('updates existing task status in place when receiving task_updated events with payload', async () => {
    const sockets: {
      onmessage: null | ((event: { data: string }) => void);
      close: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    }[] = [];
    function MockWebSocket(this: any) {
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.close = vi.fn();
      this.send = vi.fn();
      sockets.push(this);
    }
    const webSocketCtor = vi.fn(MockWebSocket as any);

    vi.stubGlobal('WebSocket', webSocketCtor as unknown as typeof WebSocket);
    getReviewUserWebSocketUrlMock.mockReturnValue('ws://localhost/ws/review/user/designer_001');
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [
        {
          id: 'task-update-1',
          title: '状态待更新任务',
          description: 'before ws update',
          modelName: 'Model-B',
          status: 'submitted',
          priority: 'high',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '陈经理',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          components: [],
          createdAt: 1700000000000,
          updatedAt: 1700000001000,
          currentNode: 'jd',
        },
      ],
      total: 1,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.loadReviewTasks();
    store.connectWebSocket();
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: 'task_updated',
        data: {
          task: {
            id: 'task-update-1',
            title: '状态待更新任务',
            description: 'after ws update',
            modelName: 'Model-B',
            status: 'in_review',
            priority: 'high',
            requesterId: 'designer_001',
            requesterName: '王设计师',
            checkerId: 'user-002',
            checkerName: '李校核员',
            approverId: 'manager_001',
            approverName: '陈经理',
            reviewerId: 'user-002',
            reviewerName: '李校核员',
            components: [],
            createdAt: 1700000000000,
            updatedAt: 1700000009000,
            currentNode: 'sh',
          },
        },
        timestamp: new Date().toISOString(),
      }),
    });

    expect(reviewTaskGetListMock).toHaveBeenCalledTimes(1);
    expect(store.reviewTasks.value.find((task) => task.id === 'task-update-1')).toEqual(
      expect.objectContaining({
        status: 'in_review',
        currentNode: 'sh',
        description: 'after ws update',
      })
    );
  });

  it('keeps a resubmitted task converged to one reviewer inbox record across refresh and websocket paths', async () => {
    const sockets: {
      onmessage: null | ((event: { data: string }) => void);
      close: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    }[] = [];
    function MockWebSocket(this: any) {
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.close = vi.fn();
      this.send = vi.fn();
      sockets.push(this);
    }

    vi.stubGlobal('WebSocket', vi.fn(MockWebSocket as any) as unknown as typeof WebSocket);
    getReviewUserWebSocketUrlMock.mockReturnValue('ws://localhost/ws/review/user/reviewer_001');
    userGetCurrentMock.mockResolvedValue({ success: false });
    reviewTaskGetListMock
      .mockResolvedValueOnce({ success: true, tasks: [], total: 0 })
      .mockResolvedValueOnce({
        success: true,
        tasks: [
          {
            id: 'task-resubmit-1',
            title: '重新提交流转任务',
            description: 'after refresh',
            modelName: 'Model-Resubmit',
            status: 'submitted',
            priority: 'high',
            requesterId: 'designer_001',
            requesterName: '王设计师',
            checkerId: 'user-002',
            checkerName: '李校核员',
            approverId: 'manager_001',
            approverName: '陈经理',
            reviewerId: 'user-002',
            reviewerName: '李校核员',
            currentNode: 'jd',
            createdAt: 1700000000000,
            updatedAt: 1700000010000,
            workflowHistory: [
              {
                node: 'jd',
                action: 'return',
                operatorId: 'user-002',
                operatorName: '李校核员',
                comment: '请补充材料',
                timestamp: 1700000005000,
              },
              {
                node: 'sj',
                action: 'submit',
                operatorId: 'designer_001',
                operatorName: '王设计师',
                comment: '已补充后重新提交',
                timestamp: 1700000009000,
              },
            ],
            components: [],
          },
        ],
        total: 1,
      });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.switchUser('reviewer_001');
    store.connectWebSocket();

    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: 'task_updated',
        data: {
          task: {
            id: 'task-resubmit-1',
            title: '重新提交流转任务',
            description: 'after websocket',
            model_name: 'Model-Resubmit',
            status: 'submitted',
            priority: 'high',
            requester_id: 'designer_001',
            requester_name: '王设计师',
            checker_id: 'user-002',
            checker_name: '李校核员',
            approver_id: 'manager_001',
            approver_name: '陈经理',
            reviewer_id: 'user-002',
            reviewer_name: '李校核员',
            current_node: 'jd',
            created_at: 1700000000000,
            updated_at: 1700000009500,
            workflow_history: [
              {
                node: 'jd',
                action: 'return',
                operator_id: 'user-002',
                operator_name: '李校核员',
                comment: '请补充材料',
                timestamp: 1700000005000,
              },
              {
                node: 'sj',
                action: 'submit',
                operator_id: 'designer_001',
                operator_name: '王设计师',
                comment: '已补充后重新提交',
                timestamp: 1700000009000,
              },
            ],
            components: [],
          },
        },
        timestamp: new Date().toISOString(),
      }),
    });

    expect(store.pendingReviewTasks.value.map((task) => task.id)).toEqual(['task-resubmit-1']);
    expect(store.pendingReviewTasks.value[0]).toEqual(
      expect.objectContaining({
        id: 'task-resubmit-1',
        currentNode: 'jd',
        status: 'submitted',
        description: 'after websocket',
      })
    );

    await store.loadReviewTasks();

    expect(store.pendingReviewTasks.value.map((task) => task.id)).toEqual(['task-resubmit-1']);
    expect(store.pendingReviewTasks.value[0]).toEqual(
      expect.objectContaining({
        id: 'task-resubmit-1',
        currentNode: 'jd',
        status: 'submitted',
        description: 'after refresh',
      })
    );
    expect(store.reviewTasks.value.filter((task) => task.id === 'task-resubmit-1')).toHaveLength(1);
  });

  it('normalizes snake_case returned websocket payloads before membership and returned-state checks', async () => {
    const sockets: {
      onmessage: null | ((event: { data: string }) => void);
      close: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    }[] = [];
    function MockWebSocket(this: any) {
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.close = vi.fn();
      this.send = vi.fn();
      sockets.push(this);
    }

    vi.stubGlobal('WebSocket', vi.fn(MockWebSocket as any) as unknown as typeof WebSocket);
    getReviewUserWebSocketUrlMock.mockReturnValue('ws://localhost/ws/review/user/designer_001');
    reviewTaskGetListMock.mockResolvedValue({ success: true, tasks: [], total: 0 });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.loadReviewTasks();
    store.connectWebSocket();
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: 'task_updated',
        data: {
          task: {
            id: 'task-returned-1',
            title: '退回任务',
            description: 'after ws update',
            model_name: 'Model-C',
            status: 'draft',
            priority: 'medium',
            requester_id: 'designer_001',
            requester_name: '王设计师',
            checker_id: 'user-002',
            checker_name: '李校核员',
            approver_id: 'manager_001',
            approver_name: '陈经理',
            reviewer_id: 'user-002',
            reviewer_name: '李校核员',
            current_node: 'sj',
            return_reason: '请补充尺寸',
            review_comment: '请补充尺寸',
            created_at: 1700000000000,
            updated_at: 1700000009000,
            workflow_history: [
              {
                node: 'jd',
                action: 'return',
                operator_id: 'user-002',
                operator_name: '李校核员',
                comment: '请补充尺寸',
                timestamp: 1700000008000,
              },
            ],
            components: [],
          },
        },
        timestamp: new Date().toISOString(),
      }),
    });

    expect(store.myInitiatedTasks.value.find((task) => task.id === 'task-returned-1')).toEqual(
      expect.objectContaining({
        modelName: 'Model-C',
        requesterId: 'designer_001',
        currentNode: 'sj',
        returnReason: '请补充尺寸',
        status: 'draft',
      })
    );
    expect(store.returnedInitiatedTasks.value.map((task) => task.id)).toContain('task-returned-1');
  });

  it('normalizes rejected websocket payloads before reviewer membership checks', async () => {
    const sockets: {
      onmessage: null | ((event: { data: string }) => void);
      close: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    }[] = [];
    function MockWebSocket(this: any) {
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.close = vi.fn();
      this.send = vi.fn();
      sockets.push(this);
    }

    vi.stubGlobal('WebSocket', vi.fn(MockWebSocket as any) as unknown as typeof WebSocket);
    getReviewUserWebSocketUrlMock.mockReturnValue('ws://localhost/ws/review/user/reviewer_001');
    userGetCurrentMock.mockResolvedValue({ success: false });
    reviewTaskGetListMock.mockResolvedValue({ success: true, tasks: [], total: 0 });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.switchUser('reviewer_001');
    store.connectWebSocket();
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: 'task_rejected',
        data: {
          task: {
            id: 'task-reviewer-returned-1',
            title: '审核端退回任务',
            description: 'reviewer scoped from ws',
            model_name: 'Model-D',
            status: 'rejected',
            priority: 'high',
            requester_id: 'designer_001',
            requester_name: '王设计师',
            checker_id: 'user-002',
            checker_name: '李校核员',
            reviewer_id: 'user-002',
            reviewer_name: '李校核员',
            approver_id: 'manager_001',
            approver_name: '陈经理',
            current_node: 'jd',
            created_at: 1700000000000,
            updated_at: 1700000009000,
            return_reason: '校核退回',
            components: [],
          },
        },
        timestamp: new Date().toISOString(),
      }),
    });

    expect(store.pendingReviewTasks.value.find((task) => task.id === 'task-reviewer-returned-1')).toEqual(
      expect.objectContaining({
        currentNode: 'jd',
        checkerId: 'user-002',
        status: 'rejected',
      })
    );
  });
});

describe('normalizeReviewTask', () => {
  it('maps snake_case payloads into ReviewTask shape', () => {
    const task = normalizeReviewTask({
      id: 'task-normalized-1',
      title: '规范化任务',
      description: 'desc',
      model_name: 'Model-N',
      status: 'draft',
      priority: 'medium',
      requester_id: 'designer_001',
      requester_name: '王设计师',
      reviewer_id: 'user-002',
      reviewer_name: '李校核员',
      checker_id: 'user-002',
      checker_name: '李校核员',
      approver_id: 'manager_001',
      approver_name: '陈经理',
      current_node: 'sj',
      return_reason: '请修改',
      review_comment: '请修改',
      created_at: 1700000000000,
      updated_at: 1700000001000,
      components: [],
      workflow_history: [
        {
          node: 'jd',
          action: 'return',
          operator_id: 'user-002',
          operator_name: '李校核员',
          comment: '请修改',
          timestamp: 1700000000500,
        },
      ],
    });

    expect(task).toEqual(expect.objectContaining({
      modelName: 'Model-N',
      requesterId: 'designer_001',
      reviewerId: 'user-002',
      checkerId: 'user-002',
      approverId: 'manager_001',
      currentNode: 'sj',
      returnReason: '请修改',
      reviewComment: '请修改',
    }));
    expect(task.workflowHistory?.[0]).toEqual(expect.objectContaining({
      operatorId: 'user-002',
      operatorName: '李校核员',
    }));
  });
});

describe('getNextWorkflowNode', () => {
  it('returns jd for sj', () => {
    expect(getNextWorkflowNode('sj')).toBe('jd');
  });

  it('returns sh for jd', () => {
    expect(getNextWorkflowNode('jd')).toBe('sh');
  });

  it('returns pz for sh', () => {
    expect(getNextWorkflowNode('sh')).toBe('pz');
  });

  it('returns null for pz (last node in WORKFLOW_NODE_ORDER)', () => {
    expect(getNextWorkflowNode('pz')).toBeNull();
  });

  it('defaults to sj -> jd when no node provided', () => {
    expect(getNextWorkflowNode()).toBe('jd');
    expect(getNextWorkflowNode(undefined)).toBe('jd');
  });

  it('returns jd for unknown node', () => {
    expect(getNextWorkflowNode('unknown' as any)).toBe('jd');
  });
});

describe('statusFromNode', () => {
  it('returns rejected for sj', () => {
    expect(statusFromNode('sj')).toBe('rejected');
  });

  it('returns submitted for jd', () => {
    expect(statusFromNode('jd')).toBe('submitted');
  });

  it('returns in_review for sh', () => {
    expect(statusFromNode('sh')).toBe('in_review');
  });

  it('returns in_review for pz', () => {
    expect(statusFromNode('pz')).toBe('in_review');
  });
});

describe('normalizeBackendUser', () => {
  it('maps backend workflow role codes to frontend roles', () => {
    const user = normalizeBackendUser({
      id: 'u-1',
      username: 'checker',
      email: 'checker@example.com',
      name: '校核员',
      role: 'jd',
    });

    expect(user.role).toBe(UserRole.PROOFREADER);
    expect(user.id).toBe('u-1');
    expect(user.name).toBe('校核员');
  });

  it('preserves existing frontend roles', () => {
    const user = normalizeBackendUser({
      id: 'u-2',
      username: 'reviewer',
      email: 'reviewer@example.com',
      name: '审核员',
      role: 'reviewer',
    });

    expect(user.role).toBe(UserRole.REVIEWER);
  });
});

describe('switch user auth helpers', () => {
  it('resolves aliased local reviewer ids to backend-visible ids for task matching', () => {
    expect(resolveEffectiveUserId({ id: 'reviewer_001' })).toBe('user-002');
    expect(resolveEffectiveUserId({ id: 'user-002' })).toBe('user-002');
    expect(resolveEffectiveUserId(null)).toBeNull();
  });

  it('maps the local reviewer identity to the seeded backend reviewer user id', () => {
    const request = buildSwitchUserTokenRequest(
      {
        id: 'reviewer_001',
        username: 'reviewer',
        email: 'reviewer@example.com',
        name: '审核员',
        role: UserRole.REVIEWER,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      'project-123',
    );

    expect(request.userId).toBe('user-002');
    expect(request.role).toBe('sh');
  });

  it('builds a token request using backend workflow role codes', () => {
    const request = buildSwitchUserTokenRequest(
      {
        id: 'reviewer_001',
        username: 'reviewer',
        email: 'reviewer@example.com',
        name: '审核员',
        role: UserRole.REVIEWER,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      'project-123',
    );

    expect(request).toEqual({
      projectId: 'project-123',
      userId: 'user-002',
      role: 'sh',
    });
  });

  it('prefers embed project id from session storage when present', () => {
    const projectId = resolveReviewProjectIdFromSession({
      getItem: (key: string) => key === 'embed_mode_params'
        ? JSON.stringify({ projectId: 'embed-project-1' })
        : null,
    });

    expect(projectId).toBe('embed-project-1');
  });

  it('falls back to debug-project when session storage is empty', () => {
    const projectId = resolveReviewProjectIdFromSession({
      getItem: () => null,
    });

    expect(projectId).toBe('debug-project');
  });

  it('keeps the aliased reviewer identity after backend reload so jd-stage inbox tasks still materialize', async () => {
    authGetTokenMock.mockResolvedValue({ success: true, token: 'token-reviewer' });
    userGetCurrentMock.mockResolvedValue({
      success: true,
      user: {
        id: 'user-002',
        username: 'reviewer',
        email: 'reviewer@example.com',
        name: '李审核员',
        role: 'sh',
      },
    });
    reviewTaskGetListMock.mockResolvedValue({
      success: true,
      tasks: [
        {
          id: 'task-review-1',
          title: 'Reviewer inbox task',
          description: 'desc',
          modelName: 'Hull',
          status: 'submitted',
          priority: 'high',
          requesterId: 'designer_001',
          requesterName: '王设计师',
          checkerId: 'user-002',
          checkerName: '李校核员',
          approverId: 'manager_001',
          approverName: '李审核员',
          reviewerId: 'user-002',
          reviewerName: '李校核员',
          currentNode: 'jd',
          components: [],
          createdAt: 1700000000000,
          updatedAt: 1700000001000,
        },
      ],
      total: 1,
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.switchUser('reviewer_001');

    expect(store.currentUserId.value).toBe('reviewer_001');
    expect(store.currentUser.value?.role).toBe(UserRole.REVIEWER);
    expect(store.isChecker.value).toBe(true);
    expect(store.isApprover.value).toBe(false);
    expect(reviewTaskGetListMock).toHaveBeenCalledTimes(1);
    expect(store.pendingReviewTasks.value).toHaveLength(1);
    expect(store.pendingReviewTasks.value[0]?.id).toBe('task-review-1');
  });
});
