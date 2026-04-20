import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ResubmissionTaskList from './ResubmissionTaskList.vue';

import type { ReviewTask } from '@/types/auth';

const loadReviewTasksMock = vi.fn(() => Promise.resolve());

const mockStore = {
  returnedInitiatedTasks: { value: [] as ReviewTask[] },
  currentUser: { value: { id: 'designer-1', name: '王设计师' } },
  loadReviewTasks: (...args: unknown[]) => loadReviewTasksMock(...args),
};

const persistenceState = new Map<string, unknown>();
const persistenceStorageKeys: string[] = [];

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => mockStore,
}));

vi.mock('@/composables/useNavigationStatePersistence', () => ({
  useNavigationStatePersistence: (storageKey: string) => {
    persistenceStorageKeys.push(storageKey);
    return {
      bindRef: (_key: string, target: { value: unknown }, defaultValue: unknown) => {
        if (target.value === undefined) {
          target.value = defaultValue;
        }
      },
      saveValue: (key: string, value: unknown) => {
        persistenceState.set(key, value);
      },
      getValue: (key: string, defaultValue: unknown) => persistenceState.get(key) ?? defaultValue,
    };
  },
}));

vi.mock('./TaskReviewDetail.vue', () => ({
  default: {
    name: 'TaskReviewDetailStub',
    props: ['task'],
    template: '<div data-testid="task-review-detail-stub">{{ task?.title }}</div>',
  },
}));

describe('ResubmissionTaskList', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    persistenceState.clear();
    persistenceStorageKeys.length = 0;
    loadReviewTasksMock.mockClear();
    mockStore.returnedInitiatedTasks.value = [];
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
    return {
      id: `task-${Math.random().toString(36).slice(2)}`,
      title: '退回任务',
      description: '需要补充资料。',
      modelName: '主装置模型',
      status: 'draft',
      priority: 'medium',
      requesterId: 'designer-1',
      requesterName: '王设计师',
      checkerId: 'checker-1',
      checkerName: '李校核',
      approverId: 'approver-1',
      approverName: '周审核',
      reviewerId: 'checker-1',
      reviewerName: '李校核',
      components: [],
      createdAt: new Date('2026-03-15T08:00:00+08:00').getTime(),
      updatedAt: new Date('2026-03-16T08:00:00+08:00').getTime(),
      currentNode: 'sj',
      workflowHistory: [],
      ...overrides,
    };
  }

  async function mountComponent(tasks: ReviewTask[]) {
    mockStore.returnedInitiatedTasks.value = tasks;

    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(ResubmissionTaskList),
    }).mount(host);

    await vi.dynamicImportSettled();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    return host;
  }

  it('keeps canonical returned draft tasks visible in the returned list', async () => {
    await mountComponent([
      createTask({
        id: 'returned-task',
        title: '仍可再次提交的任务',
        status: 'draft',
        currentNode: 'sj',
        returnReason: '请补充净高说明',
      }),
    ]);

    expect(document.body.textContent).toContain('仍可再次提交的任务');
    expect(document.body.textContent).toContain('已退回');
    expect(document.body.textContent).toContain('退回原因: 请补充净高说明');
    expect(document.body.textContent).toContain('进入模型修改');
  });

  it('uses the latest workflow return reason and node semantics in returned list cards', async () => {
    await mountComponent([
      createTask({
        id: 'returned-task-latest',
        title: '显示最新退回信息的任务',
        status: 'draft',
        currentNode: 'sj',
        returnReason: '旧退回原因',
        workflowHistory: [
          {
            node: 'jd',
            action: 'return',
            operatorId: 'checker-1',
            operatorName: '李校核',
            comment: '第一次退回原因',
            timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
          },
          {
            node: 'sh',
            action: 'return',
            operatorId: 'approver-1',
            operatorName: '周审核',
            comment: '最新退回原因',
            timestamp: new Date('2026-03-16T18:00:00+08:00').getTime(),
          },
        ],
      }),
    ]);

    expect(document.body.textContent).toContain('显示最新退回信息的任务');
    expect(document.body.textContent).toContain('退回原因: 最新退回原因');
    expect(document.body.textContent).toContain('退回节点: 审核');
    expect(document.body.textContent).not.toContain('退回原因: 旧退回原因');
  });

  it('opens task detail from returned list for the same task id', async () => {
    await mountComponent([
      createTask({
        id: 'same-task-id',
        title: '同一任务详情',
        status: 'draft',
        currentNode: 'sj',
        returnReason: '请补充审核意见',
      }),
    ]);

    const detailButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('流转历史')
    );
    expect(detailButton).toBeTruthy();

    detailButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    const detail = document.querySelector('[data-testid="task-review-detail-stub"]');
    expect(detail?.textContent).toContain('同一任务详情');
  });

  it('uses an isolated persistence key for the returned list surface', async () => {
    await mountComponent([
      createTask({
        id: 'returned-task',
        status: 'draft',
        currentNode: 'sj',
        returnReason: '请补充净高说明',
      }),
    ]);

    expect(persistenceStorageKeys).toContain('plant3d-web-nav-state-resubmission-tasks-v1');
    expect(persistenceStorageKeys).not.toContain('plant3d-web-nav-state-designer-tasks-v1');
    expect(persistenceStorageKeys).not.toContain('plant3d-web-nav-state-reviewer-tasks-v1');
  });
});
