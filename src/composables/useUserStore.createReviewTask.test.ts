import { beforeEach, describe, expect, it, vi } from 'vitest';

const reviewTaskCreateMock = vi.fn();
const reviewTaskUpdateMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  reviewTaskCreate: reviewTaskCreateMock,
  reviewTaskGetList: vi.fn(async () => ({ success: true, tasks: [], total: 0 })),
  reviewTaskGetById: vi.fn(),
  reviewTaskUpdate: reviewTaskUpdateMock,
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

function createSessionStorageMock() {
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
    reviewTaskUpdateMock.mockReset();
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage =
      createSessionStorageMock() as unknown as Storage;
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
        checkerId: 'proofreader_001',
        approverId: 'reviewer_001',
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
        checkerId: 'proofreader_001',
        approverId: 'reviewer_001',
        reviewerId: 'reviewer_001',
        priority: 'medium',
        components: [{ id: 'c1', name: 'Comp', refNo: '100_1' }],
      })
    ).rejects.toThrow('network broken');

    expect(store.reviewTasks.value).toHaveLength(0);
  });

  it('创建请求保留显式角色字段并兼容 reviewerId', async () => {
    reviewTaskCreateMock.mockResolvedValue({
      success: true,
      task: {
        id: 'task-3',
        formId: 'FORM-3',
        title: 'task-3',
      },
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    await store.createReviewTask({
      title: 'task-3',
      description: 'desc',
      modelName: 'model',
      checkerId: 'proofreader_001',
      approverId: 'reviewer_001',
      priority: 'high',
      formId: 'FORM-3',
      components: [
        { id: 'c1', name: 'Comp A', refNo: '100_1', type: 'Valve' },
        { id: 'c2', name: 'Comp B', refNo: '100_2' },
      ],
      dueDate: 1700000000000,
    });

    expect(reviewTaskCreateMock).toHaveBeenCalledWith({
      title: 'task-3',
      description: 'desc',
      modelName: 'model',
      checkerId: 'proofreader_001',
      approverId: 'reviewer_001',
      reviewerId: 'proofreader_001',
      formId: 'FORM-3',
      priority: 'high',
      components: [
        { id: 'c1', name: 'Comp A', refNo: '100_1', type: 'Valve' },
        { id: 'c2', name: 'Comp B', refNo: '100_2' },
      ],
      dueDate: 1700000000000,
      attachments: undefined,
    });
  });

  it('创建结果保留 reviewer handoff 所需的 shared context', async () => {
    reviewTaskCreateMock.mockResolvedValue({
      success: true,
      task: {
        id: 'task-handoff-1',
        formId: 'FORM-HANDOFF-1',
        title: 'task-handoff-1',
        requesterId: 'designer_001',
        requesterName: '王设计师',
        checkerId: 'proofreader_001',
        checkerName: '张校对员',
        approverId: 'reviewer_001',
        approverName: '李审核员',
        reviewerId: 'proofreader_001',
        reviewerName: '张校对员',
        currentNode: 'jd',
        status: 'submitted',
        modelName: 'Hull',
        components: [
          { id: 'c1', name: 'Comp A', refNo: '100_1', type: 'Valve' },
        ],
        workflowHistory: [
          {
            node: 'sj',
            action: 'submit',
            operatorId: 'designer_001',
            operatorName: '王设计师',
            timestamp: 1700000000000,
          },
        ],
        createdAt: 1700000000000,
        updatedAt: 1700000005000,
      },
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    const task = await store.createReviewTask({
      title: 'task-handoff-1',
      description: 'desc',
      modelName: 'Hull',
      checkerId: 'proofreader_001',
      approverId: 'reviewer_001',
      priority: 'high',
      formId: 'FORM-HANDOFF-1',
      components: [
        { id: 'c1', name: 'Comp A', refNo: '100_1', type: 'Valve' },
      ],
    });

    expect(task.id).toBe('task-handoff-1');
    expect(task.formId).toBe('FORM-HANDOFF-1');
    expect(task.requesterId).toBe('designer_001');
    expect(task.checkerId).toBe('proofreader_001');
    expect(task.approverId).toBe('reviewer_001');
    expect(task.currentNode).toBe('jd');
    expect(task.status).toBe('submitted');
    expect(task.workflowHistory).toEqual([
      {
        node: 'sj',
        action: 'submit',
        operatorId: 'designer_001',
        operatorName: '王设计师',
        timestamp: 1700000000000,
      },
    ]);
    expect(store.reviewTasks.value).toContainEqual(task);
  });

  it('updateTaskAttachments 仅持久化成功上传的附件元数据', async () => {
    reviewTaskCreateMock.mockResolvedValue({
      success: true,
      task: {
        id: 'task-attachment-1',
        title: 'task-with-attachments',
        attachments: [],
      },
    });
    reviewTaskUpdateMock.mockResolvedValue({
      success: true,
      task: {
        id: 'task-attachment-1',
        title: 'task-with-attachments',
        attachments: [
          {
            id: 'att-1',
            name: 'drawing.pdf',
            url: '/files/review_attachments/att-1.pdf',
            size: 128,
            mimeType: 'application/pdf',
          },
        ],
      },
    });

    const { useUserStore } = await import('./useUserStore');
    const store = useUserStore();

    const task = await store.createReviewTask({
      title: 'task-with-attachments',
      description: 'desc',
      modelName: 'model',
      checkerId: 'proofreader_001',
      approverId: 'reviewer_001',
      priority: 'medium',
      components: [{ id: 'c1', name: 'Comp', refNo: '100_1' }],
    });

    await store.updateTaskAttachments(task.id, [
      {
        id: 'att-1',
        name: 'drawing.pdf',
        url: '/files/review_attachments/att-1.pdf',
        size: 128,
        mimeType: 'application/pdf',
      },
    ]);

    expect(reviewTaskUpdateMock).toHaveBeenCalledWith('task-attachment-1', {
      attachments: [
        {
          id: 'att-1',
          name: 'drawing.pdf',
          url: '/files/review_attachments/att-1.pdf',
          size: 128,
          mimeType: 'application/pdf',
        },
      ],
    });
  });

  it('resolveReviewProjectIdFromSession 优先读取 embed projectId', async () => {
    sessionStorage.setItem('embed_mode_params', JSON.stringify({ projectId: 'project-embed-1' }));

    const { resolveReviewProjectIdFromSession } = await import('./useUserStore');

    expect(resolveReviewProjectIdFromSession()).toBe('project-embed-1');
  });

  it('resolveReviewProjectIdFromSession 在缺省时回退到默认项目', async () => {
    const { resolveReviewProjectIdFromSession } = await import('./useUserStore');

    expect(resolveReviewProjectIdFromSession()).toBe('debug-project');
  });
});
