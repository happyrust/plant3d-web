import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ReviewerTaskList from './ReviewerTaskList.vue';

import { UserRole, type ReviewTask } from '@/types/auth';

const loadReviewTasksMock = vi.fn(() => Promise.resolve());
const setCurrentTaskMock = vi.fn();
const reviewTaskGetByIdMock = vi.fn(async () => ({ success: false }));
const persistenceState = new Map<string, unknown>();
const persistenceStorageKeys: string[] = [];

const mockUserStore = {
  pendingReviewTasks: { value: [] as ReviewTask[] },
  currentUser: { value: { id: 'checker-1', name: '张校对员', role: UserRole.PROOFREADER } },
  isChecker: { value: true },
  isApprover: { value: false },
  loadReviewTasks: (...args: unknown[]) => loadReviewTasksMock(...args),
  submitTaskToNextNode: vi.fn(() => Promise.resolve()),
  returnTaskToNode: vi.fn(() => Promise.resolve()),
};

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => mockUserStore,
}));

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    setCurrentTask: setCurrentTaskMock,
  }),
}));

vi.mock('@/api/reviewApi', () => ({
  reviewTaskGetById: (...args: unknown[]) => reviewTaskGetByIdMock(...args),
}));

vi.mock('@/composables/useNavigationStatePersistence', () => ({
  useNavigationStatePersistence: (storageKey: string) => {
    persistenceStorageKeys.push(storageKey);
    return ({
      bindRef: (_key: string, target: { value: unknown }, defaultValue: unknown) => {
        if (target.value === undefined) {
          target.value = defaultValue;
        }
      },
      saveValue: (key: string, value: unknown) => {
        persistenceState.set(key, value);
      },
      getValue: (key: string, defaultValue: unknown) => persistenceState.get(key) ?? defaultValue,
    });
  },
}));

vi.mock('./reviewerTaskListActions', () => ({
  refreshReviewerTasksSafely: async ({ loadReviewTasks, setLoading }: { loadReviewTasks: () => Promise<void>; setLoading: (loading: boolean) => void }) => {
    setLoading(true);
    try {
      await loadReviewTasks();
    } finally {
      setLoading(false);
    }
  },
  startReviewerTask: vi.fn(async ({ task, onTaskSelected }: { task: ReviewTask; onTaskSelected: (task: ReviewTask) => void }) => {
    onTaskSelected(task);
  }),
}));

vi.mock('@/ribbon/commandBus', () => ({
  emitCommand: vi.fn(),
}));

describe('ReviewerTaskList', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    persistenceState.clear();
    persistenceStorageKeys.length = 0;
    loadReviewTasksMock.mockClear();
    setCurrentTaskMock.mockClear();
    reviewTaskGetByIdMock.mockClear();
    mockUserStore.pendingReviewTasks.value = [];
    mockUserStore.submitTaskToNextNode.mockClear();
    mockUserStore.returnTaskToNode.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
    return {
      id: `task-${Math.random().toString(36).slice(2)}`,
      title: '审核任务',
      description: '等待校核',
      modelName: '主装置模型',
      status: 'submitted',
      priority: 'high',
      requesterId: 'designer-1',
      requesterName: '王设计师',
      checkerId: 'checker-1',
      checkerName: '李审核员',
      approverId: 'approver-1',
      approverName: '周审核',
      reviewerId: 'checker-1',
      reviewerName: '李审核员',
      components: [],
      createdAt: new Date('2026-03-15T08:00:00+08:00').getTime(),
      updatedAt: new Date('2026-03-16T08:00:00+08:00').getTime(),
      currentNode: 'jd',
      ...overrides,
    };
  }

  async function mountComponent(tasks: ReviewTask[]) {
    mockUserStore.pendingReviewTasks.value = tasks;

    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(ReviewerTaskList),
    }).mount(host);

    await vi.dynamicImportSettled();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    return host;
  }

  it('renders reviewer inbox filters and tasks', async () => {
    await mountComponent([
      createTask({ id: 'submitted-task', title: '待审核任务', status: 'submitted', priority: 'urgent' }),
    ]);

    expect(document.body.textContent).toContain('待校对任务');
    expect(document.body.textContent).toContain('待审核任务');
    expect(document.body.textContent).toContain('全部状态');
    expect(document.body.textContent).toContain('全部优先级');
  });

  it('uses an isolated persistence key for the reviewer inbox surface', async () => {
    await mountComponent([
      createTask({ id: 'review-task', title: '审核列表任务', status: 'submitted', currentNode: 'jd' }),
    ]);

    expect(persistenceStorageKeys).toContain('plant3d-web-nav-state-reviewer-tasks-v1');
    expect(persistenceStorageKeys).not.toContain('plant3d-web-nav-state-designer-tasks-v1');
    expect(persistenceStorageKeys).not.toContain('plant3d-web-nav-state-resubmission-tasks-v1');
  });

  it('hydrates reviewer task detail modal with formId and attachments from single-task detail api', async () => {
    const task = createTask({
      id: 'review-task-detail',
      title: '审核详情任务',
      description: '列表摘要',
      components: [
        { id: 'comp-1', name: 'BRAN-001', refNo: '24381_145018', type: 'BRAN' },
      ],
      attachments: [],
    });
    reviewTaskGetByIdMock.mockResolvedValueOnce({
      success: true,
      task: {
        ...task,
        description: '完整的设计提资包说明',
        formId: 'FORM-REVIEW-226',
        attachments: [
          {
            id: 'att-1',
            name: '设计提资说明.pdf',
            url: '/files/review_attachments/att-1.pdf',
            mimeType: 'application/pdf',
            uploadedAt: new Date('2026-04-09T10:00:00+08:00').getTime(),
          },
        ],
      },
    });

    await mountComponent([task]);

    const taskCard = Array.from(document.querySelectorAll('div.cursor-pointer')).find((node) =>
      node.textContent?.includes('审核详情任务')
    ) as HTMLDivElement | undefined;
    expect(taskCard).toBeTruthy();

    taskCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(reviewTaskGetByIdMock).toHaveBeenCalledWith('review-task-detail');
    expect(document.body.textContent).toContain('FORM-REVIEW-226');
    expect(document.body.textContent).toContain('设计提资说明.pdf');
    expect(document.body.textContent).toContain('完整的设计提资包说明');
  });
});
