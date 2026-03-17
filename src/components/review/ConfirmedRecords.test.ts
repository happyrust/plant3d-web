import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ReviewPanel from './ReviewPanel.vue';

import type { ReviewTask } from '@/types/auth';

const currentTask = { value: null as ReviewTask | null };
const reviewMode = { value: false };
const confirmedRecordCount = { value: 0 };
const totalConfirmedAnnotations = { value: 0 };
const totalConfirmedMeasurements = { value: 0 };
const sortedConfirmedRecords = { value: [] as {
  id: string;
  confirmedAt: number;
  note: string;
  annotations: unknown[];
  cloudAnnotations: unknown[];
  rectAnnotations: unknown[];
  obbAnnotations: unknown[];
  measurements: unknown[];
}[] };

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
const removeConfirmedRecordMock = vi.fn();

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
    removeConfirmedRecord: removeConfirmedRecordMock,
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
  waitForViewerReady: vi.fn(async () => true),
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

async function settlePanel() {
  await vi.dynamicImportSettled();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

describe('ConfirmedRecords', () => {
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
        getItem: vi.fn((key: string) => {
          if (key === 'review_panel_active_modules') {
            return JSON.stringify(['confirmedRecords', 'confirmedStats']);
          }
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
    currentTask.value = createTask();
    confirmedRecordCount.value = 0;
    totalConfirmedAnnotations.value = 0;
    totalConfirmedMeasurements.value = 0;
    sortedConfirmedRecords.value = [];
    workflowResponseState.value = {
      success: true,
      currentNode: 'jd',
      currentNodeName: '校核',
      history: [],
    };
    loadReviewTasksMock.mockClear();
    setCurrentTaskMock.mockClear();
    loadWorkflowMock.mockClear();
    removeConfirmedRecordMock.mockClear();
  });

  it('renders confirmation time, annotation count and note for each confirmed record', async () => {
    sortedConfirmedRecords.value = [
      {
        id: 'record-1',
        confirmedAt: new Date('2026-03-16T09:30:00+08:00').getTime(),
        note: '已核对支吊架位置',
        annotations: [{ id: 'a-1' }],
        cloudAnnotations: [{ id: 'c-1' }],
        rectAnnotations: [],
        obbAnnotations: [{ id: 'o-1' }],
        measurements: [{ id: 'm-1' }],
      },
    ];
    confirmedRecordCount.value = 1;
    totalConfirmedAnnotations.value = 3;
    totalConfirmedMeasurements.value = 1;

    mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('确认记录');
    expect(document.body.textContent).toContain('确认时间');
    expect(document.body.textContent).toContain('批注数量');
    expect(document.body.textContent).toContain('3');
    expect(document.body.textContent).toContain('测量数量');
    expect(document.body.textContent).toContain('1');
    expect(document.body.textContent).toContain('备注');
    expect(document.body.textContent).toContain('已核对支吊架位置');
  });

  it('shows the expected empty state when no confirmed records are available', async () => {
    sortedConfirmedRecords.value = [];
    confirmedRecordCount.value = 0;

    mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('暂无确认记录');
  });
});
