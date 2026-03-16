import { beforeEach, describe, it, expect, vi } from 'vitest';

import {
  buildSwitchUserTokenRequest,
  isCheckerRole,
  isApproverRole,
  getNextWorkflowNode,
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
}));

let authGetTokenMock: ReturnType<typeof vi.fn>;
let reviewTaskGetListMock: ReturnType<typeof vi.fn>;
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

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('localStorage', createStorageMock());
  vi.stubGlobal('sessionStorage', createStorageMock());

  const reviewApi = vi.mocked(vi.importMock<typeof import('@/api/reviewApi')>('@/api/reviewApi'));
  return reviewApi.then((api) => {
    authGetTokenMock = api.authGetToken as ReturnType<typeof vi.fn>;
    reviewTaskGetListMock = api.reviewTaskGetList as ReturnType<typeof vi.fn>;
    userGetCurrentMock = api.userGetCurrent as ReturnType<typeof vi.fn>;
    authGetTokenMock.mockReset();
    reviewTaskGetListMock.mockReset();
    userGetCurrentMock.mockReset();
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
  it('returns draft for sj', () => {
    expect(statusFromNode('sj')).toBe('draft');
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
