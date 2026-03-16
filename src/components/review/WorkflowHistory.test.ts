import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ReviewPanel from './ReviewPanel.vue';

import type { ReviewTask } from '@/types/auth';

const currentTask = { value: null as ReviewTask | null };
const reviewMode = { value: false };
const confirmedRecordCount = { value: 0 };
const totalConfirmedAnnotations = { value: 0 };
const totalConfirmedMeasurements = { value: 0 };
const sortedConfirmedRecords = { value: [] as unknown[] };

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

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    currentTask,
    reviewMode,
    confirmedRecordCount,
    totalConfirmedAnnotations,
    totalConfirmedMeasurements,
    sortedConfirmedRecords,
    toggleReviewMode: vi.fn(),
    clearCurrentTask: vi.fn(),
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
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: vi.fn(),
}));

vi.mock('@/ribbon/toastBus', () => ({ emitToast: vi.fn() }));

vi.mock('./CollisionResultList.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./ReviewAuxData.vue', () => ({ default: { template: '<div />' } }));
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
    title: '流程任务',
    description: 'desc',
    modelName: 'Demo Model',
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
    currentNode: 'jd',
    ...overrides,
  };
}

describe('WorkflowHistory', () => {
  function mountReviewPanel() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({ render: () => h(ReviewPanel) }).mount(host);
    return host;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
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
    loadReviewTasksMock.mockClear();
    setCurrentTaskMock.mockClear();
    loadWorkflowMock.mockClear();
  });

  it('renders workflow timeline entries with node, operator, action, time and comment', async () => {
    workflowResponseState.value = {
      success: true,
      currentNode: 'jd',
      currentNodeName: '校核',
      history: [
        {
          node: 'sj',
          action: 'submitted',
          operatorId: 'designer-1',
          operatorName: '张三',
          comment: '提交校核',
          timestamp: new Date('2026-03-16T09:30:00+08:00').getTime(),
        },
      ],
    };

    mountReviewPanel();
    await vi.dynamicImportSettled();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    expect(document.body.textContent).toContain('工作流历史');
    expect(document.body.textContent).toContain('编制');
    expect(document.body.textContent).toContain('动作：提交');
    expect(document.body.textContent).toContain('操作人: 张三');
    expect(document.body.textContent).toContain('备注: 提交校核');
  });

  it('shows the expected empty state when no workflow history is available', async () => {
    workflowResponseState.value = {
      success: true,
      currentNode: 'jd',
      currentNodeName: '校核',
      history: [],
    };

    mountReviewPanel();
    await vi.dynamicImportSettled();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    expect(document.body.textContent).toContain('暂无历史记录');
  });
});
