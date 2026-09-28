import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import DesignerTaskList from './DesignerTaskList.vue';

import type { ReviewTask } from '@/types/auth';

const loadReviewTasksMock = vi.fn(() => Promise.resolve());

const mockStore = {
  myInitiatedTasks: { value: [] as ReviewTask[] },
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

vi.mock('./workflowMode', () => ({
  resolvePassiveWorkflowMode: vi.fn(() => false),
}));

describe('DesignerTaskList', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    persistenceState.clear();
    persistenceStorageKeys.length = 0;
    loadReviewTasksMock.mockClear();
    mockStore.myInitiatedTasks.value = [];
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
    return {
      id: `task-${Math.random().toString(36).slice(2)}`,
      title: '设计任务',
      description: '校审描述',
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
      ...overrides,
    };
  }

  async function mountComponent(tasks: ReviewTask[]) {
    mockStore.myInitiatedTasks.value = tasks;

    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(DesignerTaskList),
    }).mount(host);

    await vi.dynamicImportSettled();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    return host;
  }

  it('renders filter chips for all designer-visible statuses including cancelled', async () => {
    await mountComponent([
      createTask({ id: 'draft-task', status: 'draft' }),
      createTask({ id: 'submitted-task', status: 'submitted', currentNode: 'jd' }),
      createTask({ id: 'review-task', status: 'in_review', currentNode: 'sh' }),
      createTask({ id: 'approved-task', status: 'approved', currentNode: 'pz' }),
      createTask({ id: 'returned-task', status: 'draft', currentNode: 'sj', returnReason: '补充材料' }),
      createTask({ id: 'cancelled-task', status: 'cancelled', currentNode: 'sj' }),
    ]);

    const labels = Array.from(document.querySelectorAll('button')).map((button) => button.textContent ?? '');
    expect(labels.some((text) => text.includes('全部'))).toBe(true);
    expect(labels.some((text) => text.includes('草稿'))).toBe(true);
    expect(labels.some((text) => text.includes('待审核'))).toBe(true);
    expect(labels.some((text) => text.includes('审核中'))).toBe(true);
    expect(labels.some((text) => text.includes('已通过'))).toBe(true);
    expect(labels.some((text) => text.includes('已驳回'))).toBe(true);
    expect(labels.some((text) => text.includes('已取消'))).toBe(true);
  });

  it('shows canonical returned semantics consistently in main list cards', async () => {
    await mountComponent([
      createTask({
        id: 'returned-task',
        title: '被退回任务',
        status: 'draft',
        currentNode: 'sj',
        returnReason: '缺少净高说明',
      }),
    ]);

    expect(document.body.textContent).toContain('被退回任务');
    expect(document.body.textContent).toContain('校审描述');
    expect(document.body.textContent).toContain('已退回');
    expect(document.body.textContent).toContain('退回原因');
    expect(document.body.textContent).toContain('缺少净高说明');
  });

  it('filters cancelled tasks through the dedicated cancelled status option', async () => {
    await mountComponent([
      createTask({ id: 'cancelled-task', title: '已取消任务', status: 'cancelled', currentNode: 'sj' }),
      createTask({ id: 'submitted-task', title: '待审核任务', status: 'submitted', currentNode: 'jd' }),
    ]);

    const cancelledButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('取消')
    );

    expect(cancelledButton).toBeTruthy();
    cancelledButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(document.body.textContent).toContain('已取消任务');
    expect(document.body.textContent).not.toContain('待审核任务');
  });

  it('uses an isolated persistence key for the designer main list surface', async () => {
    await mountComponent([createTask({ id: 'designer-task', status: 'submitted', currentNode: 'jd' })]);

    expect(persistenceStorageKeys).toContain('plant3d-web-nav-state-designer-tasks-v1');
    expect(persistenceStorageKeys).not.toContain('plant3d-web-nav-state-resubmission-tasks-v1');
    expect(persistenceStorageKeys).not.toContain('plant3d-web-nav-state-reviewer-tasks-v1');
  });
});
