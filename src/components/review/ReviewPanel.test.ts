import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ReviewPanel from './ReviewPanel.vue';

import type { ReviewTask } from '@/types/auth';

const currentTask = { value: null as ReviewTask | null };
const reviewMode = { value: false };
const confirmedRecordCount = { value: 0 };
const totalConfirmedAnnotations = { value: 0 };
const totalConfirmedMeasurements = { value: 0 };
const sortedConfirmedRecords = { value: [] as never[] };

const workflowResponseState = {
  value: {
    success: true,
    currentNode: 'jd',
    currentNodeName: '校核',
    history: [] as {
      node?: string;
      action: string;
      operatorId: string;
      operatorName: string;
      comment?: string;
      timestamp: number;
    }[],
  },
};

const loadWorkflowMock = vi.fn(async () => workflowResponseState.value);
const loadReviewTasksMock = vi.fn(async () => {});
const setCurrentTaskMock = vi.fn(async (task: ReviewTask | null) => {
  currentTask.value = task;
});
const clearCurrentTaskMock = vi.fn(() => {
  currentTask.value = null;
});

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    currentTask,
    reviewMode,
    confirmedRecordCount,
    totalConfirmedAnnotations,
    totalConfirmedMeasurements,
    sortedConfirmedRecords,
    toggleReviewMode: vi.fn(),
    clearCurrentTask: clearCurrentTaskMock,
    addConfirmedRecord: vi.fn(),
    clearConfirmedRecords: vi.fn(),
    removeConfirmedRecord: vi.fn(),
    exportReviewData: vi.fn(() => '{}'),
    setCurrentTask: setCurrentTaskMock,
  }),
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    annotationCount: { value: 0 },
    cloudAnnotationCount: { value: 0 },
    rectAnnotationCount: { value: 0 },
    obbAnnotationCount: { value: 0 },
    measurementCount: { value: 0 },
    annotations: { value: [] },
    cloudAnnotations: { value: [] },
    rectAnnotations: { value: [] },
    obbAnnotations: { value: [] },
    measurements: { value: [] },
    clearAll: vi.fn(),
    setToolMode: vi.fn(),
  }),
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ viewerRef: { value: null } }),
  waitForViewerReady: vi.fn(async () => false),
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: vi.fn(),
}));

vi.mock('@/ribbon/toastBus', () => ({ emitToast: vi.fn() }));

vi.mock('./CollisionResultList.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./ReviewAuxData.vue', () => ({ default: { template: '<div data-testid="review-aux-data-stub">辅助校审数据</div>' } }));
vi.mock('./ReviewDataSync.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./WorkflowSubmitDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./WorkflowReturnDialog.vue', () => ({ default: { template: '<div />' } }));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: { value: { id: 'reviewer-1' } },
    reviewTasks: { value: [] as ReviewTask[] },
    loadReviewTasks: loadReviewTasksMock,
    getTaskWorkflowHistory: loadWorkflowMock,
    submitTaskToNextNode: vi.fn(),
    returnTaskToNode: vi.fn(),
  }),
}));

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: 'task-1',
    formId: 'FORM-001',
    title: '流程任务',
    description: 'desc',
    modelName: 'Demo Model',
    status: 'in_review',
    priority: 'medium',
    requesterId: 'designer-1',
    requesterName: '设计人',
    reviewerId: 'checker-1',
    reviewerName: '旧审核字段',
    checkerId: 'checker-1',
    checkerName: '校核人',
    approverId: 'approver-1',
    approverName: '审核人',
    components: [
      { id: 'comp-1', name: '阀门', refNo: 'V-01' },
      { id: 'comp-2', name: '管段', refNo: 'P-02' },
    ],
    createdAt: 1710000000000,
    updatedAt: 1710000000000,
    currentNode: 'jd',
    ...overrides,
  };
}

async function settlePanel() {
  await vi.dynamicImportSettled();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

function mountReviewPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(ReviewPanel) });
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('ReviewPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => {
          if (key === 'review_panel_active_modules') {
            return JSON.stringify(['confirmedRecords', 'confirmedStats', 'workflowHistory']);
          }
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
    currentTask.value = createTask();
    workflowResponseState.value = {
      success: true,
      currentNode: 'jd',
      currentNodeName: '校核',
      history: [],
    };
    loadWorkflowMock.mockClear();
    loadReviewTasksMock.mockClear();
    setCurrentTaskMock.mockClear();
    clearCurrentTaskMock.mockClear();
  });

  it('renders the stable M4 workbench sections and normalized context fields', async () => {
    const mounted = mountReviewPanel();
    await settlePanel();

    expect(document.querySelector('[data-testid="review-workbench-context-zone"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="review-workbench-workflow-zone"]')).not.toBeNull();
    expect(document.body.textContent).toContain('任务上下文');
    expect(document.body.textContent).toContain('流转区');
    expect(document.body.textContent).toContain('确认记录');
    expect(document.body.textContent).toContain('校核人');
    expect(document.body.textContent).toContain('审核人');
    expect(document.body.textContent).toContain('Form ID');
    expect(document.body.textContent).toContain('FORM-001');
    expect(document.body.textContent).toContain('2 个构件');
    expect(document.body.textContent).toContain('校核人');
    expect(document.body.textContent).toContain('审核人');
    expect(document.body.textContent).not.toContain('旧审核字段');
    mounted.unmount();
  });

  it('shows an explicit degraded state when the active task lacks a formal formId', async () => {
    currentTask.value = createTask({ formId: undefined });

    const mounted = mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('未绑定 formId');
    expect(document.body.textContent).toContain('不再回落到 task.id');
    mounted.unmount();
  });

  it('refreshes workflow surfaces and clears task-scoped state when switching tasks', async () => {
    currentTask.value = createTask({
      id: 'task-a',
      title: '任务 A',
      formId: 'FORM-A',
      currentNode: 'jd',
    });
    workflowResponseState.value = {
      success: true,
      currentNode: 'jd',
      currentNodeName: '校核',
      history: [
        {
          node: 'jd',
          action: 'submitted',
          operatorId: 'checker-a',
          operatorName: '校核甲',
          timestamp: 1710000000000,
        },
      ],
    };

    let mounted = mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('FORM-A');
    expect(document.body.textContent).toContain('提交');

    mounted.unmount();

    currentTask.value = createTask({
      id: 'task-b',
      title: '任务 B',
      formId: 'FORM-B',
      currentNode: 'sh',
      checkerName: '校核乙',
      approverName: '审核乙',
    });
    mounted = mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('FORM-B');
    expect(document.body.textContent).toContain('审核乙');
    expect(document.body.textContent).toContain('提交到批准');
    expect(document.body.textContent).not.toContain('FORM-A');
    expect(document.body.textContent).not.toContain('提交到审核');
    mounted.unmount();
  });
});
