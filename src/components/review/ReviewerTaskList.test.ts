import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ReviewerTaskList from './ReviewerTaskList.vue';

import { UserRole, type ReviewTask } from '@/types/auth';

const loadReviewTasksMock = vi.fn(() => Promise.resolve());
const setCurrentTaskMock = vi.fn();
const reviewTaskGetByIdMock = vi.fn(async () => ({ success: false }));
const reviewAnnotationCheckMock = vi.fn(async () => ({
  success: true,
  data: {
    passed: true,
    recommendedAction: 'submit',
    currentNode: 'jd',
    summary: {
      total: 0,
      open: 0,
      pendingReview: 0,
      approved: 0,
      rejected: 0,
    },
    blockers: [],
    message: 'ok',
  },
}));
const emitToastMock = vi.fn();
const persistenceState = new Map<string, unknown>();
const persistenceStorageKeys: string[] = [];
const currentWorkbenchTask = { value: null as ReviewTask | null };
const sortedConfirmedRecords = { value: [] as { taskId: string; annotations?: unknown[]; cloudAnnotations?: unknown[]; rectAnnotations?: unknown[]; obbAnnotations?: unknown[]; measurements?: unknown[] }[] };
const toolStoreMock = {
  annotations: { value: [] as unknown[] },
  cloudAnnotations: { value: [] as unknown[] },
  rectAnnotations: { value: [] as unknown[] },
  obbAnnotations: { value: [] as unknown[] },
  measurements: { value: [] as unknown[] },
  xeokitDistanceMeasurements: { value: [] as unknown[] },
  xeokitAngleMeasurements: { value: [] as unknown[] },
};

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
    currentTask: currentWorkbenchTask,
    sortedConfirmedRecords,
    setCurrentTask: setCurrentTaskMock,
  }),
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => toolStoreMock,
}));

vi.mock('@/api/reviewApi', () => ({
  reviewTaskGetById: (...args: unknown[]) => reviewTaskGetByIdMock(...args),
  reviewAnnotationCheck: (...args: unknown[]) => reviewAnnotationCheckMock(...args),
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

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: (...args: unknown[]) => emitToastMock(...args),
}));

describe('ReviewerTaskList', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    persistenceState.clear();
    persistenceStorageKeys.length = 0;
    loadReviewTasksMock.mockClear();
    setCurrentTaskMock.mockClear();
    reviewTaskGetByIdMock.mockClear();
    reviewAnnotationCheckMock.mockClear();
    reviewAnnotationCheckMock.mockResolvedValue({
      success: true,
      data: {
        passed: true,
        recommendedAction: 'submit',
        currentNode: 'jd',
        summary: {
          total: 0,
          open: 0,
          pendingReview: 0,
          approved: 0,
          rejected: 0,
        },
        blockers: [],
        message: 'ok',
      },
    });
    emitToastMock.mockClear();
    mockUserStore.pendingReviewTasks.value = [];
    mockUserStore.submitTaskToNextNode.mockClear();
    mockUserStore.returnTaskToNode.mockClear();
    currentWorkbenchTask.value = null;
    sortedConfirmedRecords.value = [];
    toolStoreMock.annotations.value = [];
    toolStoreMock.cloudAnnotations.value = [];
    toolStoreMock.rectAnnotations.value = [];
    toolStoreMock.obbAnnotations.value = [];
    toolStoreMock.measurements.value = [];
    toolStoreMock.xeokitDistanceMeasurements.value = [];
    toolStoreMock.xeokitAngleMeasurements.value = [];
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

  async function openTaskDetail(title: string) {
    const taskCard = Array.from(document.querySelectorAll('div.cursor-pointer')).find((node) =>
      node.textContent?.includes(title)
    ) as HTMLDivElement | undefined;
    expect(taskCard).toBeTruthy();
    taskCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await Promise.resolve();
    await nextTick();
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
        description: '完整的设计编校审包说明',
        formId: 'FORM-REVIEW-226',
        attachments: [
          {
            id: 'att-1',
            name: '设计编校审说明.pdf',
            url: '/files/review_attachments/att-1.pdf',
            mimeType: 'application/pdf',
            uploadedAt: new Date('2026-04-09T10:00:00+08:00').getTime(),
          },
        ],
      },
    });

    await mountComponent([task]);
    await openTaskDetail('审核详情任务');

    expect(reviewTaskGetByIdMock).toHaveBeenCalledWith('review-task-detail');
    expect(document.body.textContent).toContain('FORM-REVIEW-226');
    expect(document.body.textContent).toContain('设计编校审说明.pdf');
    expect(document.body.textContent).toContain('完整的设计编校审包说明');
  });

  it('同意入口会先执行批注检查，再继续提交流转', async () => {
    const task = createTask({
      id: 'review-task-submit',
      formId: 'FORM-SUBMIT-1',
      currentNode: 'jd',
    });

    await mountComponent([task]);
    await openTaskDetail('审核任务');

    const approveButton = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('确认流转至审核')
    ) as HTMLButtonElement | undefined;
    approveButton?.click();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(reviewAnnotationCheckMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'review-task-submit',
      formId: 'FORM-SUBMIT-1',
      currentNode: 'jd',
      includedTypes: ['text', 'cloud', 'rect'],
    }));
    expect(mockUserStore.submitTaskToNextNode).toHaveBeenCalledWith('review-task-submit', undefined);
  });

  it('同意入口在批注检查返回 block 时会拦住并显示明确提示', async () => {
    reviewAnnotationCheckMock.mockResolvedValueOnce({
      success: true,
      data: {
        passed: false,
        recommendedAction: 'block',
        currentNode: 'jd',
        summary: {
          total: 1,
          open: 0,
          pendingReview: 1,
          approved: 0,
          rejected: 0,
        },
        blockers: [],
        message: '存在待确认批注，请逐条确认后再继续',
      },
    });
    const task = createTask({
      id: 'review-task-block',
      formId: 'FORM-BLOCK-1',
      currentNode: 'jd',
    });

    await mountComponent([task]);
    await openTaskDetail('审核任务');

    const approveButton = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('确认流转至审核')
    ) as HTMLButtonElement | undefined;
    approveButton?.click();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(mockUserStore.submitTaskToNextNode).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('存在待确认批注，请逐条确认后再继续');
  });

  it('同意入口遇到仅 OBB 改动时，不会因为未确认数据被拦住', async () => {
    const task = createTask({
      id: 'review-task-obb',
      formId: 'FORM-OBB-1',
      currentNode: 'jd',
    });
    currentWorkbenchTask.value = task;
    toolStoreMock.obbAnnotations.value = [{ id: 'obb-1' }];

    await mountComponent([task]);
    await openTaskDetail('审核任务');

    const approveButton = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('确认流转至审核')
    ) as HTMLButtonElement | undefined;
    approveButton?.click();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(reviewAnnotationCheckMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'review-task-obb',
      currentNode: 'jd',
    }));
    expect(document.body.textContent).not.toContain('请先确认数据，再执行流转');
    expect(mockUserStore.submitTaskToNextNode).toHaveBeenCalledWith('review-task-obb', undefined);
  });

  it('驳回按钮在 jd 节点显示，在 sj 节点不显示', async () => {
    const jdTask = createTask({ id: 'jd-task', title: 'JD任务', currentNode: 'jd', status: 'in_review' });
    await mountComponent([jdTask]);
    await openTaskDetail('JD任务');

    const rejectBtn = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.trim() === '驳回'
    );
    expect(rejectBtn).toBeTruthy();
  });

  it('驳回按钮在 sh 和 pz 节点同样显示', async () => {
    const shTask = createTask({ id: 'sh-task', title: 'SH任务', currentNode: 'sh', status: 'in_review' });
    await mountComponent([shTask]);
    await openTaskDetail('SH任务');

    const rejectBtn = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.trim() === '驳回'
    );
    expect(rejectBtn).toBeTruthy();
  });

  it('sj 节点任务不显示驳回按钮', async () => {
    const sjTask = createTask({ id: 'sj-task', title: 'SJ任务', currentNode: 'sj', status: 'submitted' });
    await mountComponent([sjTask]);
    await openTaskDetail('SJ任务');

    const rejectBtn = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.trim() === '驳回'
    );
    expect(rejectBtn).toBeFalsy();
  });
});
