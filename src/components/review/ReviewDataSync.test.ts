import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ReviewDataSync from './ReviewDataSync.vue';

import type { ReviewTask } from '@/types/auth';

const {
  currentTask,
  reviewTasks,
  loadReviewTasksMock,
  setCurrentTaskMock,
  reviewSyncExportMock,
  reviewSyncImportMock,
  emitToastMock,
} = vi.hoisted(() => ({
  currentTask: { value: null as ReviewTask | null },
  reviewTasks: { value: [] as ReviewTask[] },
  loadReviewTasksMock: vi.fn(async () => {}),
  setCurrentTaskMock: vi.fn(async (task: ReviewTask | null) => {
    currentTask.value = task;
  }),
  reviewSyncExportMock: vi.fn(async () => ({ success: true, tasks: [] })),
  reviewSyncImportMock: vi.fn(async () => ({
    success: true,
    importedCount: 1,
    skippedCount: 0,
  })),
  emitToastMock: vi.fn(),
}));

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    currentTask,
    setCurrentTask: setCurrentTaskMock,
  }),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    reviewTasks,
    loadReviewTasks: loadReviewTasksMock,
  }),
}));

vi.mock('@/api/reviewApi', () => ({
  reviewSyncExport: reviewSyncExportMock,
  reviewSyncImport: reviewSyncImportMock,
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: emitToastMock,
}));

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: 'task-1',
    formId: 'FORM-001',
    title: '同步任务',
    description: 'desc',
    modelName: 'Model A',
    status: 'in_review',
    priority: 'medium',
    requesterId: 'designer-1',
    requesterName: '设计人',
    reviewerId: 'checker-1',
    reviewerName: '校核人',
    checkerId: 'checker-1',
    checkerName: '校核人',
    approverId: 'approver-1',
    approverName: '审核人',
    components: [],
    createdAt: 1710000000000,
    updatedAt: 1710000000000,
    currentNode: 'sh',
    ...overrides,
  };
}

function createLocalStorageMock() {
  return {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
}

async function settle() {
  await vi.dynamicImportSettled();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

function mountComponent() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(ReviewDataSync) });
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('ReviewDataSync', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', createLocalStorageMock());
    currentTask.value = createTask();
    reviewTasks.value = [createTask()];
    loadReviewTasksMock.mockImplementation(async () => {});
    setCurrentTaskMock.mockImplementation(async (task: ReviewTask | null) => {
      currentTask.value = task;
    });
    reviewSyncImportMock.mockResolvedValue({
      success: true,
      importedCount: 1,
      skippedCount: 0,
    });
  });

  it('renders overwrite semantics and current task sync context', async () => {
    const mounted = mountComponent();
    await settle();

    expect(document.body.textContent).toContain('导入覆盖');
    expect(document.body.textContent).toContain('未勾选时保留现有数据并跳过重复项');
    expect(document.body.textContent).toContain('导入成功后会刷新当前工作台任务');
    expect(document.body.textContent).toContain('当前同步上下文：');
    expect(document.body.textContent).toContain('同步任务');
    expect(document.body.textContent).toContain('Form ID FORM-001');

    mounted.unmount();
  });

  it('refreshes the selected workbench task by id after a successful import', async () => {
    const refreshedTask = createTask({ title: '同步任务-刷新后', currentNode: 'pz' });
    reviewTasks.value = [refreshedTask];

    const mounted = mountComponent();
    await settle();

    const fileInput = mounted.host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify({ tasks: [createTask()] })], 'sync.json', {
      type: 'application/json',
    });

    await Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });

    fileInput.dispatchEvent(new Event('change'));
    await settle();

    expect(reviewSyncImportMock).toHaveBeenCalledWith({
      tasks: [expect.objectContaining({ id: 'task-1' })],
      overwrite: false,
    });
    expect(loadReviewTasksMock).toHaveBeenCalledTimes(1);
    expect(setCurrentTaskMock).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'task-1',
      title: '同步任务-刷新后',
      currentNode: 'pz',
    }));
    expect(emitToastMock).toHaveBeenCalledWith({ message: '导入完成：1 条已导入，0 条已跳过' });

    mounted.unmount();
  });

  it('falls back to formId matching when the imported task gets a new id', async () => {
    currentTask.value = createTask({ id: 'task-old', formId: 'FORM-KEEP' });
    reviewTasks.value = [createTask({ id: 'task-new', formId: 'FORM-KEEP', title: '替换后的任务' })];

    const mounted = mountComponent();
    await settle();

    const fileInput = mounted.host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([
      JSON.stringify({ tasks: [createTask({ id: 'task-imported', formId: 'FORM-KEEP' })] }),
    ], 'sync.json', { type: 'application/json' });

    await Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });

    fileInput.dispatchEvent(new Event('change'));
    await settle();

    expect(setCurrentTaskMock).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'task-new',
      formId: 'FORM-KEEP',
      title: '替换后的任务',
    }));

    mounted.unmount();
  });

  it('preserves formId rematch even if current task is cleared during task reload', async () => {
    const selectedTask = createTask({ id: 'task-old', formId: 'FORM-STABLE', title: '导入前任务' });
    const rematchedTask = createTask({ id: 'task-rematched', formId: 'FORM-STABLE', title: '导入后任务' });
    currentTask.value = selectedTask;
    reviewTasks.value = [selectedTask];
    loadReviewTasksMock.mockImplementation(async () => {
      currentTask.value = null;
      reviewTasks.value = [rematchedTask];
    });

    const mounted = mountComponent();
    await settle();

    const fileInput = mounted.host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([
      JSON.stringify({ tasks: [createTask({ id: 'task-imported', formId: 'FORM-STABLE' })] }),
    ], 'sync.json', { type: 'application/json' });

    await Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });

    fileInput.dispatchEvent(new Event('change'));
    await settle();

    expect(loadReviewTasksMock).toHaveBeenCalledTimes(1);
    expect(setCurrentTaskMock).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'task-rematched',
      formId: 'FORM-STABLE',
      title: '导入后任务',
    }));

    mounted.unmount();
  });
});
