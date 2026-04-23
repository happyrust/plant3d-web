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

const mocks = vi.hoisted(() => ({
  setSelectedRefno: vi.fn(),
  ensurePanelAndActivate: vi.fn(),
  emitCommand: vi.fn(),
  showModelByRefnosWithAck: vi.fn(async () => ({
    ok: ['24381/145018'],
    fail: [],
    error: null,
  })),
  waitForViewerReady: vi.fn(async () => false),
  loadReviewTasks: vi.fn(async () => {}),
  loadWorkflow: vi.fn(async () => ({
    success: true,
    currentNode: 'jd',
    currentNodeName: '校核',
    history: [],
  })),
}));

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
    setCurrentTask: vi.fn(async () => {}),
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
    xeokitDistanceMeasurements: { value: [] },
    xeokitAngleMeasurements: { value: [] },
    clearAll: vi.fn(),
    setToolMode: vi.fn(),
    getAnnotationComments: vi.fn(() => []),
    activeAnnotationId: { value: null },
    activeCloudAnnotationId: { value: null },
    activeRectAnnotationId: { value: null },
    activeObbAnnotationId: { value: null },
  }),
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    setSelectedRefno: mocks.setSelectedRefno,
  }),
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    viewerRef: { value: null },
    tools: { value: null },
  }),
  waitForViewerReady: mocks.waitForViewerReady,
  showModelByRefnosWithAck: mocks.showModelByRefnosWithAck,
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: mocks.ensurePanelAndActivate,
}));

vi.mock('@/ribbon/commandBus', () => ({
  emitCommand: mocks.emitCommand,
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
    loadReviewTasks: mocks.loadReviewTasks,
    getTaskWorkflowHistory: mocks.loadWorkflow,
    submitTaskToNextNode: vi.fn(),
    returnTaskToNode: vi.fn(),
  }),
}));

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: 'task-1',
    title: '构件联动任务',
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
    components: [
      {
        id: 'comp-1',
        name: 'BRAN-24381',
        refNo: '24381_145018',
        type: 'BRAN',
      },
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

describe('ReviewPanel 构件明细联动', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => {
          if (key === 'review_panel_active_modules') {
            return JSON.stringify(['workflowHistory', 'confirmedRecords']);
          }
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });

    currentTask.value = createTask();
    mocks.setSelectedRefno.mockClear();
    mocks.ensurePanelAndActivate.mockClear();
    mocks.emitCommand.mockClear();
    mocks.showModelByRefnosWithAck.mockClear();
    mocks.waitForViewerReady.mockClear();
    mocks.loadReviewTasks.mockClear();
    mocks.loadWorkflow.mockClear();
  });

  it('点击构件后会触发模型树定位和 show-by-refno 加载', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({ render: () => h(ReviewPanel) }).mount(host);
    await settlePanel();

    const detailToggle = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('任务详情'));
    detailToggle?.click();
    await nextTick();

    const componentRow = Array.from(document.body.querySelectorAll('div.cursor-pointer'))
      .find((node) => node.textContent?.includes('BRAN-24381') && node.textContent?.includes('24381_145018')) as HTMLDivElement | undefined;
    expect(componentRow).toBeTruthy();

    const autoLocateListener = vi.fn();
    window.addEventListener('autoLocateRefno', autoLocateListener as EventListener);
    componentRow?.click();
    await nextTick();
    window.removeEventListener('autoLocateRefno', autoLocateListener as EventListener);

    expect(mocks.ensurePanelAndActivate).toHaveBeenCalledWith('modelTree');
    expect(mocks.setSelectedRefno).toHaveBeenCalledWith('24381_145018');
    expect(mocks.showModelByRefnosWithAck).toHaveBeenCalledWith(expect.objectContaining({
      refnos: ['24381/145018'],
      flyTo: true,
    }));
    expect(autoLocateListener).toHaveBeenCalledTimes(1);
    const autoLocateEvent = autoLocateListener.mock.calls[0]?.[0] as CustomEvent<{ refno: string }>;
    expect(autoLocateEvent.detail.refno).toBe('24381/145018');
  });

  it('再次点击同一构件时会取消列表选中态', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({ render: () => h(ReviewPanel) }).mount(host);
    await settlePanel();

    const detailToggle = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('任务详情'));
    detailToggle?.click();
    await nextTick();

    const componentRow = Array.from(document.body.querySelectorAll('div.cursor-pointer'))
      .find((node) => node.textContent?.includes('BRAN-24381') && node.textContent?.includes('24381_145018')) as HTMLDivElement | undefined;
    expect(componentRow).toBeTruthy();

    componentRow?.click();
    await nextTick();
    expect(componentRow?.className).toContain('border-primary/40');

    componentRow?.click();
    await nextTick();
    expect(componentRow?.className).not.toContain('border-primary/40');
    expect(mocks.showModelByRefnosWithAck).toHaveBeenCalledTimes(1);
  });
});
