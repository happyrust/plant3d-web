import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import type { ReviewTask } from '@/types/auth';

const currentTask = { value: null as ReviewTask | null };
const reviewMode = { value: false };
const reviewError = { value: null as string | null };
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
const clearConfirmedRecordsMock = vi.fn(async () => true);
const clearCurrentTaskMock = vi.fn(() => {
  currentTask.value = null;
});
const restoreEmbedFormSnapshotContextMock = vi.fn(async () => ({
  modelRefnos: [],
  recordCount: 0,
  attachmentCount: 0,
  attachments: [],
  task: null,
}));
const reviewAnnotationCheckMock = vi.hoisted(() => vi.fn(async () => ({
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
})));
const submitTaskToNextNodeMock = vi.hoisted(() => vi.fn(async () => {}));
const returnTaskToNodeMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    currentTask,
    error: reviewError,
    reviewMode,
    confirmedRecordCount,
    totalConfirmedAnnotations,
    totalConfirmedMeasurements,
    sortedConfirmedRecords,
    toggleReviewMode: vi.fn(),
    clearCurrentTask: clearCurrentTaskMock,
    addConfirmedRecord: vi.fn(),
    clearConfirmedRecords: clearConfirmedRecordsMock,
    removeConfirmedRecord: vi.fn(),
    exportReviewData: vi.fn(() => '{}'),
    setCurrentTask: setCurrentTaskMock,
  }),
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => toolStoreMock,
  getAnnotationRefnos: (annotation: { refnos?: string[]; refno?: string }) => annotation.refnos ?? (annotation.refno ? [annotation.refno] : []),
}));

vi.mock('@/api/reviewApi', () => ({
  reviewSyncExport: vi.fn(async () => ({ success: true })),
  reviewSyncImport: vi.fn(async () => ({ success: true })),
  reviewAnnotationCheck: (...args: unknown[]) => reviewAnnotationCheckMock(...args),
}));

const viewerWaitForReadyMock = vi.hoisted(() => vi.fn(async () => false));
const showModelByRefnosWithAckMock = vi.hoisted(() => vi.fn(async () => ({ ok: [], fail: [], error: null })));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    viewerRef: { value: null },
    tools: { value: null },
  }),
  waitForViewerReady: (...args: unknown[]) => viewerWaitForReadyMock(...args),
  showModelByRefnosWithAck: (...args: unknown[]) => showModelByRefnosWithAckMock(...args),
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
  activeAnnotationId: { value: null },
  activeCloudAnnotationId: { value: null },
  activeRectAnnotationId: { value: null },
  activeObbAnnotationId: { value: null },
  xeokitDistanceMeasurements: { value: [] },
  xeokitAngleMeasurements: { value: [] },
  addAnnotation: vi.fn(),
  addMeasurement: vi.fn(),
  clearAll: vi.fn(),
  getAnnotationComments: vi.fn(() => []),
  importJSON: vi.fn(),
  setToolMode: vi.fn(),
  updateAnnotationSeverity: vi.fn(),
}));

const dockApiMock = vi.hoisted(() => ({
  ensurePanelAndActivate: vi.fn(),
}));

const commandBusMock = vi.hoisted(() => ({
  emitCommand: vi.fn(),
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: dockApiMock.ensurePanelAndActivate,
}));

vi.mock('@/ribbon/commandBus', () => ({
  emitCommand: commandBusMock.emitCommand,
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: { value: null },
    setSelectedRefno: vi.fn(),
  }),
}));

const emitToastMock = vi.hoisted(() => vi.fn());

vi.mock('@/ribbon/toastBus', () => ({ emitToast: emitToastMock }));

const persistenceState = new Map<string, unknown>();
const persistenceStorageKeys: string[] = [];

vi.mock('@/composables/useNavigationStatePersistence', () => ({
  useNavigationStatePersistence: (storageKey: string) => {
    persistenceStorageKeys.push(storageKey);
    return {
      bindRef: (key: string, target: { value: unknown }, defaultValue: unknown) => {
        target.value = persistenceState.has(key) ? persistenceState.get(key) : defaultValue;
      },
      saveValue: (key: string, value: unknown) => {
        persistenceState.set(key, value);
      },
      getValue: (key: string, defaultValue: unknown) => persistenceState.get(key) ?? defaultValue,
    };
  },
}));

vi.mock('./embedFormSnapshotRestore', () => ({
  restoreEmbedFormSnapshotContext: (...args: unknown[]) => restoreEmbedFormSnapshotContextMock(...args),
}));

vi.mock('./CollisionResultList.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./ReviewCommentsTimeline.vue', () => ({
  default: {
    name: 'ReviewCommentsTimelineStub',
    props: {
      designerOnly: { type: Boolean, default: false },
      composerSubmitLabel: { type: String, default: '' },
      annotationLabel: { type: String, default: '' },
    },
    template: '<div data-testid="timeline-stub">{{ designerOnly ? "designerOnly" : "review" }}|{{ composerSubmitLabel }}|{{ annotationLabel }}</div>',
  },
}));
vi.mock('./ReviewAuxData.vue', () => ({ default: { template: '<div data-testid="review-aux-data-stub">辅助校审数据</div>' } }));
vi.mock('./ReviewDataSync.vue', () => ({ default: { template: '<div data-testid="review-data-sync-stub">数据同步（后端）</div>' } }));
vi.mock('./WorkflowSubmitDialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: {
        visible: { type: Boolean, default: false },
      },
      emits: ['confirm', 'update:visible'],
      setup(props, { emit }) {
        return () => props.visible
          ? h('div', { 'data-testid': 'workflow-submit-dialog-stub' }, [
            h('button', {
              type: 'button',
              'data-testid': 'workflow-submit-confirm',
              onClick: () => emit('confirm', 'mock submit comment'),
            }, '确认提交'),
          ])
          : null;
      },
    }),
  };
});
vi.mock('./WorkflowReturnDialog.vue', () => ({ default: { template: '<div />' } }));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: { value: { id: 'reviewer-1' } },
    reviewTasks: { value: [] as ReviewTask[] },
    loadReviewTasks: loadReviewTasksMock,
    getTaskWorkflowHistory: loadWorkflowMock,
    submitTaskToNextNode: submitTaskToNextNodeMock,
    returnTaskToNode: returnTaskToNodeMock,
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
    persistenceState.clear();
    persistenceStorageKeys.length = 0;
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
    reviewError.value = null;
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
    clearConfirmedRecordsMock.mockReset();
    clearConfirmedRecordsMock.mockResolvedValue(true);
    clearCurrentTaskMock.mockClear();
    restoreEmbedFormSnapshotContextMock.mockReset();
    restoreEmbedFormSnapshotContextMock.mockResolvedValue({
      modelRefnos: [],
      recordCount: 0,
      attachmentCount: 0,
      attachments: [],
      task: null,
    });
    toolStoreMock.addAnnotation.mockClear();
    toolStoreMock.addMeasurement.mockClear();
    toolStoreMock.importJSON.mockClear();
    toolStoreMock.setToolMode.mockClear();
    toolStoreMock.annotations.value = [];
    toolStoreMock.cloudAnnotations.value = [];
    toolStoreMock.rectAnnotations.value = [];
    toolStoreMock.obbAnnotations.value = [];
    toolStoreMock.measurements.value = [];
    toolStoreMock.xeokitDistanceMeasurements.value = [];
    toolStoreMock.xeokitAngleMeasurements.value = [];
    viewerWaitForReadyMock.mockClear();
    viewerWaitForReadyMock.mockResolvedValue(false);
    showModelByRefnosWithAckMock.mockClear();
    showModelByRefnosWithAckMock.mockResolvedValue({ ok: [], fail: [], error: null });
    dockApiMock.ensurePanelAndActivate.mockClear();
    commandBusMock.emitCommand.mockClear();
    emitToastMock.mockClear();
    reviewAnnotationCheckMock.mockReset();
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
    submitTaskToNextNodeMock.mockReset();
    submitTaskToNextNodeMock.mockResolvedValue(undefined);
    returnTaskToNodeMock.mockReset();
    returnTaskToNodeMock.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', vi.fn(() => true));
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
    expect(document.querySelector('[data-testid="annotation-workspace-root"]')).not.toBeNull();
    expect(document.body.textContent).toContain('历史流转');
    expect(document.body.textContent).toContain('审核记录');
    expect(document.body.textContent).toContain('当前批注');
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

  it('在 passive 模式下点击刷新会重新拉取可信快照并刷新模型显示', async () => {
    sessionStorage.setItem('plant3d_workflow_mode', 'external');
    sessionStorage.setItem('embed_mode_params', JSON.stringify({
      formId: 'FORM-EMBED-REFRESH',
      userToken: 'jwt-refresh',
      isEmbedMode: true,
      verifiedClaims: {
        projectId: 'PROJECT-1',
        userId: 'checker-1',
        formId: 'FORM-EMBED-REFRESH',
        role: 'jd',
        workflowMode: 'external',
        exp: 1999999999,
        iat: 1700000000,
      },
    }));

    const refreshedTask = createTask({
      attachments: [
        {
          id: 'attachment-1',
          name: 'snapshot.png',
          url: '/files/review_attachments/snapshot.png',
          uploadedAt: 1710000001000,
        },
      ],
    });
    restoreEmbedFormSnapshotContextMock.mockImplementationOnce(async (options: {
      updateTask?: (task: ReviewTask) => Promise<void>;
    }) => {
      await options.updateTask?.(refreshedTask);
      return {
        modelRefnos: ['24381_145018'],
        recordCount: 2,
        attachmentCount: 1,
        attachments: refreshedTask.attachments || [],
        task: refreshedTask,
      };
    });

    const mounted = await mountReviewPanel();
    await settlePanel();
    loadReviewTasksMock.mockClear();
    loadWorkflowMock.mockClear();
    setCurrentTaskMock.mockClear();
    showModelByRefnosWithAckMock.mockClear();

    const refreshButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('刷新')) as HTMLButtonElement | undefined;
    refreshButton?.click();
    await settlePanel();

    expect(restoreEmbedFormSnapshotContextMock).toHaveBeenCalledWith(expect.objectContaining({
      formId: 'FORM-EMBED-REFRESH',
      token: 'jwt-refresh',
      actor: expect.objectContaining({
        id: 'checker-1',
        roles: 'jd',
      }),
      task: expect.objectContaining({
        id: 'task-1',
        formId: 'FORM-001',
      }),
    }));
    expect(setCurrentTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [
        expect.objectContaining({
          id: 'attachment-1',
          name: 'snapshot.png',
        }),
      ],
    }));
    expect(loadReviewTasksMock).toHaveBeenCalledTimes(1);
    expect(loadWorkflowMock).toHaveBeenCalledWith('task-1');
    expect(showModelByRefnosWithAckMock).toHaveBeenCalledWith(expect.objectContaining({
      refnos: ['24381/145018'],
    }));

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

  it('renders SJ task submit action as the initial handoff to proofreader', async () => {
    currentTask.value = createTask({
      id: 'task-sj',
      title: 'SJ 发起任务',
      formId: 'FORM-SJ',
      currentNode: 'sj',
      status: 'draft',
    });

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('确认流转至校对');
    expect(document.body.textContent).not.toContain('确认流转至审核');

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
    expect(document.body.textContent).toContain('确认流转至审核');

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
    expect(document.body.textContent).toContain('确认流转至批准');
    expect(document.body.textContent).not.toContain('FORM-A');
    expect(document.body.textContent).not.toContain('确认流转至审核');
    mounted.unmount();
  });

  it('清空确认记录失败时保留列表并提示错误', async () => {
    sortedConfirmedRecords.value = [
      {
        id: 'record-1',
        confirmedAt: new Date('2026-03-16T09:30:00+08:00').getTime(),
        note: '失败后仍保留',
        annotations: [{ id: 'a-1' }],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [],
      },
    ] as never[];
    confirmedRecordCount.value = 1;
    totalConfirmedAnnotations.value = 1;
    totalConfirmedMeasurements.value = 0;
    reviewError.value = '后端清空失败';
    clearConfirmedRecordsMock.mockResolvedValue(false);

    const mounted = await mountReviewPanel();
    await settlePanel();

    const clearButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('清空')) as HTMLButtonElement | undefined;
    clearButton?.click();
    await settlePanel();

    expect(clearConfirmedRecordsMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('失败后仍保留');
    expect(emitToastMock).toHaveBeenCalledWith({
      message: '后端清空失败',
      level: 'error',
    });

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
    expect(toolStoreMock.setToolMode).toHaveBeenCalledWith('annotation');

    findButton('云线批注')?.click();
    await nextTick();
    expect(toolStoreMock.setToolMode).toHaveBeenCalledWith('annotation_cloud');

    findButton('矩形批注')?.click();
    await nextTick();
    expect(toolStoreMock.setToolMode).toHaveBeenCalledWith('annotation_rect');

    findButton('创建测量')?.click();
    await nextTick();
    const distanceButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('距离测量')) as HTMLButtonElement | undefined;
    const angleButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('角度测量')) as HTMLButtonElement | undefined;
    distanceButton?.click();
    await nextTick();
    expect(commandBusMock.emitCommand).toHaveBeenCalledWith('measurement.distance');

    findButton('创建测量')?.click();
    await nextTick();
    angleButton?.click();
    await nextTick();
    expect(commandBusMock.emitCommand).toHaveBeenCalledWith('measurement.angle');

    mounted.unmount();
  });

  it('exposes automation hook to create mock measurements for reviewer e2e', async () => {
    window.history.replaceState({}, '', '/?automation_review=1');

    const mounted = await mountReviewPanel();
    await settlePanel();

    const hook = (window as Window & {
      __plant3dReviewerE2E?: {
        addMockMeasurement?: (kind?: 'distance' | 'angle') => string;
      };
    }).__plant3dReviewerE2E;

    expect(typeof hook?.addMockMeasurement).toBe('function');
    const measurementId = hook?.addMockMeasurement?.();
    expect(measurementId).toBeTruthy();
    expect(toolStoreMock.addMeasurement).toHaveBeenCalledWith(expect.objectContaining({
      id: measurementId,
      kind: 'distance',
      origin: expect.objectContaining({
        entityId: expect.stringContaining('24381_145018'),
        worldPos: [0, 0, 0],
      }),
      target: expect.objectContaining({
        entityId: expect.stringContaining('24381_145018'),
        worldPos: [1, 0, 0],
      }),
      visible: true,
      createdAt: expect.any(Number),
    }));

    mounted.unmount();
  });

  it('shows explicit missing-task embed empty state for reviewer landing', async () => {
    currentTask.value = null;
    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'reviewer',
      formId: 'FORM-EMBED-EMPTY',
      restoreStatus: 'missing',
      primaryPanelId: 'review',
      visiblePanelIds: ['review'],
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
      visiblePanelIds: ['review'],
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
      visiblePanelIds: ['review'],
    }));

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.body.textContent).toContain('已识别 form_id，但尚未绑定内部任务，当前不可审核');

    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'reviewer',
      formId: null,
      restoreStatus: 'no_form',
      primaryPanelId: 'review',
      visiblePanelIds: ['review'],
    }));
    window.dispatchEvent(new CustomEvent('plant3d:embed-landing-state-updated'));
    await settlePanel();

    expect(document.body.textContent).toContain('当前打开的嵌入链接未提供有效 form_id');

    mounted.unmount();
  });

  it('有未确认数据时，提交流转会直接被拦住', async () => {
    toolStoreMock.annotations.value = [
      {
        id: 'draft-annotation-1',
        entityId: 'entity-1',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: '待确认批注',
        description: '尚未确认',
        createdAt: 1710000000000,
      },
    ];

    const mounted = await mountReviewPanel();
    await settlePanel();

    const openDialogButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('确认流转至审核')) as HTMLButtonElement | undefined;
    openDialogButton?.click();
    await settlePanel();

    const confirmButton = document.querySelector('[data-testid="workflow-submit-confirm"]') as HTMLButtonElement | null;
    confirmButton?.click();
    await settlePanel();

    expect(reviewAnnotationCheckMock).not.toHaveBeenCalled();
    expect(submitTaskToNextNodeMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('请先确认数据，再执行流转');

    mounted.unmount();
  });

  it('只有 OBB 改动时，不会因为未确认数据阻塞提交流转', async () => {
    toolStoreMock.obbAnnotations.value = [
      {
        id: 'draft-obb-1',
        entityId: 'entity-obb-1',
        worldPos: [0, 0, 0],
        width: 1,
        height: 1,
        depth: 1,
        visible: true,
        title: '仅 OBB 变化',
        createdAt: 1710000000000,
      },
    ];

    const mounted = await mountReviewPanel();
    await settlePanel();

    const openDialogButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('确认流转至审核')) as HTMLButtonElement | undefined;
    openDialogButton?.click();
    await settlePanel();

    const confirmButton = document.querySelector('[data-testid="workflow-submit-confirm"]') as HTMLButtonElement | null;
    confirmButton?.click();
    await settlePanel();

    expect(reviewAnnotationCheckMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      currentNode: 'jd',
      includedTypes: ['text', 'cloud', 'rect'],
    }));
    expect(submitTaskToNextNodeMock).toHaveBeenCalledWith('task-1', 'mock submit comment');
    expect(document.body.textContent).not.toContain('请先确认数据，再执行流转');

    mounted.unmount();
  });

  it('批注检查返回 block 时，会阻止继续提交', async () => {
    reviewAnnotationCheckMock.mockResolvedValue({
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

    const mounted = await mountReviewPanel();
    await settlePanel();

    const openDialogButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('确认流转至审核')) as HTMLButtonElement | undefined;
    openDialogButton?.click();
    await settlePanel();

    const confirmButton = document.querySelector('[data-testid="workflow-submit-confirm"]') as HTMLButtonElement | null;
    confirmButton?.click();
    await settlePanel();

    expect(reviewAnnotationCheckMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      currentNode: 'jd',
      includedTypes: ['text', 'cloud', 'rect'],
    }));
    expect(submitTaskToNextNodeMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('存在待确认批注，请逐条确认后再继续');

    mounted.unmount();
  });

  it('批注检查返回 return 时，会提示当前应驳回', async () => {
    reviewAnnotationCheckMock.mockResolvedValue({
      success: true,
      data: {
        passed: false,
        recommendedAction: 'return',
        currentNode: 'sh',
        summary: {
          total: 1,
          open: 0,
          pendingReview: 0,
          approved: 0,
          rejected: 1,
        },
        blockers: [],
        message: '存在未通过批注，应先驳回或重新处理',
      },
    });
    currentTask.value = createTask({
      id: 'task-sh',
      formId: 'FORM-SH',
      currentNode: 'sh',
      status: 'in_review',
    });

    const mounted = await mountReviewPanel();
    await settlePanel();

    const openDialogButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('确认流转至批准')) as HTMLButtonElement | undefined;
    openDialogButton?.click();
    await settlePanel();

    const confirmButton = document.querySelector('[data-testid="workflow-submit-confirm"]') as HTMLButtonElement | null;
    confirmButton?.click();
    await settlePanel();

    expect(submitTaskToNextNodeMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('存在未通过批注，应先驳回或重新处理');

    mounted.unmount();
  });

  it('批注检查通过时，保持原有提交流转链路', async () => {
    const mounted = await mountReviewPanel();
    await settlePanel();

    const openDialogButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('确认流转至审核')) as HTMLButtonElement | undefined;
    openDialogButton?.click();
    await settlePanel();

    const confirmButton = document.querySelector('[data-testid="workflow-submit-confirm"]') as HTMLButtonElement | null;
    confirmButton?.click();
    await settlePanel();

    expect(reviewAnnotationCheckMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      formId: 'FORM-001',
      currentNode: 'jd',
    }));
    expect(submitTaskToNextNodeMock).toHaveBeenCalledWith('task-1', 'mock submit comment');
    expect(loadReviewTasksMock).toHaveBeenCalled();
    expect(loadWorkflowMock).toHaveBeenCalledWith('task-1');

    mounted.unmount();
  });

  it('Reviewer 工作台默认显示卡片列表，tab 切换到批注表格后渲染 AnnotationTableView · PR 8', async () => {
    toolStoreMock.annotations.value = [
      {
        id: 'ann-reviewer-1',
        formId: 'FORM-001',
        entityId: 'entity-1',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: 'reviewer 批注',
        description: 'description',
        severity: 'medium',
        refnos: ['comp-1'],
        createdAt: 1710000000000,
      },
    ];

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.querySelector('[data-testid="reviewer-annotation-list-view-mode-tabs"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="annotation-workspace-root"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeNull();

    const tableTabButton = document.querySelector('[data-testid="reviewer-annotation-list-view-mode-table"]') as HTMLButtonElement | null;
    expect(tableTabButton).not.toBeNull();
    tableTabButton?.click();
    await settlePanel();

    expect(document.querySelector('[data-testid="annotation-table-view"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="annotation-workspace-root"]')).toBeNull();

    mounted.unmount();
  });

  it('Reviewer 表格行双击 → 飞到 3D + 自动切回卡片列表 · PR 8', async () => {
    toolStoreMock.annotations.value = [
      {
        id: 'ann-reviewer-2',
        formId: 'FORM-001',
        entityId: 'entity-2',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: '需双击的批注',
        description: 'dbl click',
        severity: 'medium',
        refnos: ['comp-2'],
        createdAt: 1710000000000,
      },
    ];
    showModelByRefnosWithAckMock.mockResolvedValue({ ok: ['comp-2'], fail: [], error: null });

    const mounted = await mountReviewPanel();
    await settlePanel();

    const tableTabButton = document.querySelector('[data-testid="reviewer-annotation-list-view-mode-table"]') as HTMLButtonElement | null;
    tableTabButton?.click();
    await settlePanel();

    const row = document.querySelector('[data-testid="annotation-table-row-ann-reviewer-2"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settlePanel();

    expect(showModelByRefnosWithAckMock).toHaveBeenCalled();
    expect(dockApiMock.ensurePanelAndActivate).toHaveBeenCalledWith('viewer');
    expect(document.querySelector('[data-testid="annotation-workspace-root"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeNull();

    mounted.unmount();
  });

  it('Reviewer 表格持久化 viewMode：预置 table 后首屏即表格视图 · PR 8', async () => {
    persistenceState.set('annotationListViewMode', 'table');
    toolStoreMock.annotations.value = [
      {
        id: 'ann-reviewer-3',
        formId: 'FORM-001',
        entityId: 'entity-3',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: '持久化恢复测试',
        description: 'persist restore',
        severity: 'low',
        refnos: ['comp-3'],
        createdAt: 1710000000000,
      },
    ];

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.querySelector('[data-testid="annotation-table-view"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="annotation-workspace-root"]')).toBeNull();
    expect(persistenceStorageKeys).toContain('plant3d-web-nav-state-reviewer-workbench-v1');

    mounted.unmount();
  });

  it('Reviewer 响应 reviewerWorkbenchViewModeBus.request("table") · PR 9', async () => {
    toolStoreMock.annotations.value = [
      {
        id: 'ann-bus-1',
        formId: 'FORM-001',
        entityId: 'entity-bus-1',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: 'bus test',
        description: 'bus test',
        severity: 'medium',
        refnos: ['comp-bus-1'],
        createdAt: 1710000000000,
      },
    ];

    const mounted = await mountReviewPanel();
    await settlePanel();
    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeNull();

    const { requestReviewerWorkbenchViewMode, clearReviewerWorkbenchViewModeRequest } = await import('./reviewerWorkbenchViewModeBus');
    requestReviewerWorkbenchViewMode('table');
    await settlePanel();

    expect(document.querySelector('[data-testid="annotation-table-view"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="annotation-workspace-root"]')).toBeNull();

    clearReviewerWorkbenchViewModeRequest();
    mounted.unmount();
  });

  it('Reviewer 表格 copy-feedback 事件正确分发 toast · PR 8', async () => {
    toolStoreMock.annotations.value = [
      {
        id: 'ann-reviewer-4',
        formId: 'FORM-001',
        entityId: 'entity-4',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: 'copy feedback',
        description: 'copy feedback',
        severity: 'high',
        refnos: ['comp-4'],
        createdAt: 1710000000000,
      },
    ];
    persistenceState.set('annotationListViewMode', 'table');

    const mounted = await mountReviewPanel();
    await settlePanel();

    const tableEl = document.querySelector('[data-testid="annotation-table-view"]');
    expect(tableEl).not.toBeNull();

    const vueInternals = (tableEl as unknown as { __vueParentComponent?: { emit: (event: string, payload: unknown) => void } }).__vueParentComponent;
    vueInternals?.emit('copy-feedback', {
      kind: 'refno',
      result: 'copied',
      item: { id: 'ann-reviewer-4' },
    });
    await settlePanel();

    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      message: '已复制RefNo',
      level: 'success',
    }));

    mounted.unmount();
  });
});
