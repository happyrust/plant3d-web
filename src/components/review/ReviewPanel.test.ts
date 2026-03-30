import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

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
  useToolStore: () => toolStoreMock,
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ viewerRef: { value: null } }),
  waitForViewerReady: vi.fn(async () => false),
}));

const toolStoreMock = vi.hoisted(() => ({
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
}));

const dockApiMock = vi.hoisted(() => ({
  ensurePanelAndActivate: vi.fn(),
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: dockApiMock.ensurePanelAndActivate,
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: { value: null },
    setSelectedRefno: vi.fn(),
  }),
}));

vi.mock('@/ribbon/toastBus', () => ({ emitToast: vi.fn() }));

vi.mock('./CollisionResultList.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./ReviewAuxData.vue', () => ({ default: { template: '<div data-testid="review-aux-data-stub">辅助校审数据</div>' } }));
vi.mock('./ReviewDataSync.vue', () => ({ default: { template: '<div data-testid="review-data-sync-stub">数据同步（后端）</div>' } }));
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
  await Promise.resolve();
  await nextTick();
}

async function mountReviewPanel() {
  vi.resetModules();
  const { default: ReviewPanel } = await import('./ReviewPanel.vue');
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
    sessionStorage.clear();
    sessionStorage.setItem('plant3d_workflow_mode', 'manual');
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => {
          if (key === 'review_panel_active_modules') {
            return JSON.stringify(['confirmedStats']);
          }
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
    currentTask.value = createTask();
    reviewMode.value = false;
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
    loadWorkflowMock.mockClear();
    loadReviewTasksMock.mockClear();
    setCurrentTaskMock.mockClear();
    clearCurrentTaskMock.mockClear();
    toolStoreMock.setToolMode.mockClear();
    dockApiMock.ensurePanelAndActivate.mockClear();
  });

  it('confirmed record counts only canonical reviewer annotations', async () => {
    sortedConfirmedRecords.value = [
      {
        id: 'record-canonical-1',
        confirmedAt: new Date('2026-03-16T09:30:00+08:00').getTime(),
        note: '只统计 reviewer 可见语义',
        annotations: [{ id: 'a-1' }],
        cloudAnnotations: [{ id: 'c-1' }],
        rectAnnotations: [{ id: 'r-1' }],
        measurements: [],
      },
    ] as never[];
    confirmedRecordCount.value = 1;
    totalConfirmedAnnotations.value = 3;
    totalConfirmedMeasurements.value = 0;

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('批注');
    expect(document.body.textContent).toContain('3');
    expect(document.body.textContent).not.toContain('OBB');

    mounted.unmount();
  });

  it('renders the workbench sections and normalized context fields', async () => {
    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.querySelector('[data-testid="review-workbench-context-zone"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="review-workbench-workflow-zone"]')).not.toBeNull();
    expect(document.body.textContent).toContain('历史流转');
    expect(document.body.textContent).toContain('审核记录');
    expect(document.body.textContent).toContain('批注与测量');
    expect(document.body.textContent).not.toContain('旧审核字段');
    mounted.unmount();
  });

  it('hides internal workflow actions in passive workflow mode', async () => {
    sessionStorage.setItem('plant3d_workflow_mode', 'external');

    const mounted = await mountReviewPanel();
    await settlePanel();

    const zone = document.querySelector('[data-testid="review-workbench-workflow-zone"]');
    expect(zone).not.toBeNull();
    expect(zone?.textContent).toContain('外部流程');
    expect(zone?.textContent).toContain('刷新');
    expect(zone?.textContent).not.toContain('提交到');
    expect(zone?.textContent).not.toContain('驳回到设计');

    mounted.unmount();
  });

  it('keeps the core zones visible even when optional module storage is empty', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('任务详情');
    expect(document.body.textContent).toContain('历史流转');
    expect(document.body.textContent).toContain('审核记录');
    expect(document.body.textContent).toContain('附件材料');
    mounted.unmount();
  });

  it('renders workflow history, confirmed records, aux-data, and sync as collapsible sections', async () => {
    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.querySelector('[data-testid="review-workbench-workflow-history-zone"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="review-workbench-confirmed-records-zone"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="review-workbench-aux-zone"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="review-workbench-sync-zone"]')).not.toBeNull();
    mounted.unmount();
  });

  it('shows an explicit degraded state when the active task lacks a formal formId', async () => {
    currentTask.value = createTask({ formId: undefined });

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('未绑定 formId');
    // formId 降级文案已简化
    mounted.unmount();
  });

  it('renders SJ task submit action as the initial handoff to checker', async () => {
    currentTask.value = createTask({
      id: 'task-sj',
      title: 'SJ 发起任务',
      formId: 'FORM-SJ',
      currentNode: 'sj',
      status: 'draft',
    });

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('提交到校核');
    expect(document.body.textContent).not.toContain('提交到审核');

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

    let mounted = await mountReviewPanel();
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
    mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('FORM-B');
    expect(document.body.textContent).toContain('审核乙');
    expect(document.body.textContent).toContain('提交到批准');
    expect(document.body.textContent).not.toContain('FORM-A');
    expect(document.body.textContent).not.toContain('提交到审核');
    mounted.unmount();
  });

  it('launches text, cloud, rectangle, and measurement tools directly from the workbench', async () => {
    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.querySelector('[data-testid="reviewer-direct-launch-annotation-zone"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="reviewer-direct-launch-measurement-zone"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="reviewer-direct-launch-annotation-text"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="reviewer-direct-launch-annotation-cloud"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="reviewer-direct-launch-annotation-rect"]')).not.toBeNull();

    const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
    const findButton = (title: string) => buttons.find((button) => button.title === title);

    findButton('文字批注')?.click();
    await nextTick();
    expect(dockApiMock.ensurePanelAndActivate).toHaveBeenCalledWith('annotation');
    expect(toolStoreMock.setToolMode).toHaveBeenCalledWith('annotation');

    findButton('云线批注')?.click();
    await nextTick();
    expect(dockApiMock.ensurePanelAndActivate).toHaveBeenCalledWith('annotation');
    expect(toolStoreMock.setToolMode).toHaveBeenCalledWith('annotation_cloud');

    findButton('矩形批注')?.click();
    await nextTick();
    expect(dockApiMock.ensurePanelAndActivate).toHaveBeenCalledWith('annotation');
    expect(toolStoreMock.setToolMode).toHaveBeenCalledWith('annotation_rect');

    findButton('创建测量')?.click();
    await nextTick();
    const distanceButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('距离测量')) as HTMLButtonElement | undefined;
    const angleButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('角度测量')) as HTMLButtonElement | undefined;
    distanceButton?.click();
    await nextTick();
    expect(toolStoreMock.setToolMode).toHaveBeenCalledWith('measure_distance');

    findButton('创建测量')?.click();
    await nextTick();
    angleButton?.click();
    await nextTick();
    expect(toolStoreMock.setToolMode).toHaveBeenCalledWith('measure_angle');

    mounted.unmount();
  });

  it('shows explicit missing-task embed empty state for reviewer landing', async () => {
    currentTask.value = null;
    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'reviewer',
      formId: 'FORM-EMBED-EMPTY',
      restoreStatus: 'missing',
      primaryPanelId: 'review',
      visiblePanelIds: ['review', 'reviewerTasks'],
    }));

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('已识别 form_id，但尚未绑定内部任务，当前不可审核');
    expect(document.body.textContent).toContain('FORM-EMBED-EMPTY');

    mounted.unmount();
  });

  it('shows explicit no-form embed empty state for reviewer landing', async () => {
    currentTask.value = null;
    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'reviewer',
      formId: null,
      restoreStatus: 'no_form',
      primaryPanelId: 'review',
      visiblePanelIds: ['review', 'reviewerTasks'],
    }));

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('当前打开的嵌入链接未提供有效 form_id');

    mounted.unmount();
  });

  it('syncs late-arriving reviewer landing state into an already mounted panel', async () => {
    currentTask.value = null;
    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'reviewer',
      formId: 'FORM-LATE-REVIEW',
      restoreStatus: 'missing',
      primaryPanelId: 'review',
      visiblePanelIds: ['review', 'reviewerTasks'],
    }));

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('已识别 form_id，但尚未绑定内部任务，当前不可审核');

    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'reviewer',
      formId: null,
      restoreStatus: 'no_form',
      primaryPanelId: 'review',
      visiblePanelIds: ['review', 'reviewerTasks'],
    }));
    window.dispatchEvent(new CustomEvent('plant3d:embed-landing-state-updated'));
    await settlePanel();

    expect(document.body.textContent).toContain('当前打开的嵌入链接未提供有效 form_id');

    mounted.unmount();
  });
});
