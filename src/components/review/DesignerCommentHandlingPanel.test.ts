import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, h, nextTick, ref } from 'vue';

import {
  clearDesignerCommentViewModeRequest,
  requestDesignerCommentViewMode,
} from './designerCommentViewModeBus';

import { UserRole, type ReviewTask } from '@/types/auth';

const currentTaskRef = ref<ReviewTask | null>(null);
const returnedTasksRef = ref<ReviewTask[]>([]);
const confirmedRecordsRef = ref<unknown[]>([]);
const annotationsRef = ref<any[]>([]);
const cloudAnnotationsRef = ref<any[]>([]);
const rectAnnotationsRef = ref<any[]>([]);
const obbAnnotationsRef = ref<any[]>([]);
const measurementsRef = ref<any[]>([]);
const xeokitDistanceMeasurementsRef = ref<any[]>([]);
const xeokitAngleMeasurementsRef = ref<any[]>([]);
const activeAnnotationIdRef = ref<string | null>(null);
const activeCloudAnnotationIdRef = ref<string | null>(null);
const activeRectAnnotationIdRef = ref<string | null>(null);
const activeObbAnnotationIdRef = ref<string | null>(null);
const annotationProcessingEntryTargetRef = ref<any>(null);

const loadReviewTasksMock = vi.fn(async () => undefined);
const setCurrentTaskMock = vi.fn(async (task: ReviewTask | null) => {
  currentTaskRef.value = task;
});
const addConfirmedRecordMock = vi.fn(async () => 'record-1');
const restoreConfirmedRecordsIntoSceneMock = vi.fn(async () => undefined);
const ensurePanelAndActivateMock = vi.fn();
const emitCommandMock = vi.fn();
const emitToastMock = vi.fn();
const showModelByRefnosWithAckMock = vi.fn(async () => ({ ok: [], fail: [], error: null }));
const flyToClassicMeasurementMock = vi.fn();
const flyToXeokitMeasurementMock = vi.fn();
const syncFromStoreMock = vi.fn();
const clearDraftDataByPayloadMock = vi.fn();
const submitTaskToNextNodeMock = vi.fn(async () => undefined);
const notifyParentWorkflowActionMock = vi.fn(() => false);
const reviewAnnotationCheckMock = vi.fn(async () => ({
  success: true,
  data: {
    passed: true,
    recommendedAction: 'submit',
    currentNode: 'sj',
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
const persistenceState = new Map<string, unknown>();
const persistenceStorageKeys: string[] = [];

function setExternalEntryTarget(target: {
  annotationId: string;
  annotationType: 'text' | 'cloud' | 'rect' | 'obb';
  formId?: string | null;
}) {
  annotationProcessingEntryTargetRef.value = {
    ...target,
    requestedAt: Date.now(),
  };
}

vi.mock('./confirmedRecordsRestore', () => ({
  createConfirmedRecordsRestorer: () => ({
    currentTaskRecords: computed(() => confirmedRecordsRef.value as any[]),
    lastRestoredSceneKey: ref<string | null>(null),
    restoreConfirmedRecordsIntoScene: restoreConfirmedRecordsIntoSceneMock,
  }),
}));

vi.mock('./annotationProcessingEntry', () => ({
  useAnnotationProcessingEntryTarget: () => computed(() => annotationProcessingEntryTargetRef.value),
  clearAnnotationProcessingEntryTarget: () => {
    annotationProcessingEntryTargetRef.value = null;
  },
}));

vi.mock('./ResubmissionTaskList.vue', () => ({
  default: {
    name: 'ResubmissionTaskListStub',
    props: {
      selectedTaskId: { type: String, default: null },
    },
    template: '<div data-testid="resubmission-task-list-stub">{{ selectedTaskId || "none" }}</div>',
  },
}));

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

vi.mock('./TaskReviewDetail.vue', () => ({
  default: {
    name: 'TaskReviewDetailStub',
    template: '<div data-testid="task-review-detail-stub"></div>',
  },
}));

vi.mock('./workflowBridge', () => ({
  notifyParentWorkflowAction: (...args: unknown[]) => notifyParentWorkflowActionMock(...args),
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: ensurePanelAndActivateMock,
}));

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

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    currentTask: currentTaskRef,
    sortedConfirmedRecords: computed(() => confirmedRecordsRef.value as any[]),
    setCurrentTask: setCurrentTaskMock,
    addConfirmedRecord: addConfirmedRecordMock,
  }),
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    annotations: annotationsRef,
    cloudAnnotations: cloudAnnotationsRef,
    rectAnnotations: rectAnnotationsRef,
    obbAnnotations: obbAnnotationsRef,
    measurements: measurementsRef,
    xeokitDistanceMeasurements: xeokitDistanceMeasurementsRef,
    xeokitAngleMeasurements: xeokitAngleMeasurementsRef,
    allXeokitMeasurements: computed(() => [
      ...xeokitDistanceMeasurementsRef.value,
      ...xeokitAngleMeasurementsRef.value,
    ]),
    activeAnnotationId: activeAnnotationIdRef,
    activeCloudAnnotationId: activeCloudAnnotationIdRef,
    activeRectAnnotationId: activeRectAnnotationIdRef,
    activeObbAnnotationId: activeObbAnnotationIdRef,
    activeMeasurementId: ref<string | null>(null),
    activeXeokitMeasurementId: ref<string | null>(null),
    getAnnotationComments: vi.fn(() => []),
    clearAll: vi.fn(),
    clearDraftDataByPayload: clearDraftDataByPayloadMock,
    updateAnnotationSeverity: vi.fn(),
  }),
  getAnnotationRefnos: (annotation: { refnos?: string[]; refno?: string }) => annotation.refnos ?? (annotation.refno ? [annotation.refno] : []),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: ref({ id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER }),
    returnedInitiatedTasks: returnedTasksRef,
    loadReviewTasks: loadReviewTasksMock,
    submitTaskToNextNode: submitTaskToNextNodeMock,
  }),
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    viewerRef: ref({}),
    tools: ref({
      flyToMeasurement: flyToClassicMeasurementMock,
      syncFromStore: syncFromStoreMock,
    }),
    xeokitMeasurementTools: ref({
      flyToMeasurement: flyToXeokitMeasurementMock,
    }),
  }),
  showModelByRefnosWithAck: showModelByRefnosWithAckMock,
  waitForViewerReady: vi.fn(async () => true),
}));

vi.mock('@/api/reviewApi', () => ({
  reviewAnnotationCheck: (...args: unknown[]) => reviewAnnotationCheckMock(...args),
  getReviewAnnotationCheckFromError: vi.fn(() => undefined),
}));

vi.mock('@/ribbon/commandBus', () => ({
  emitCommand: emitCommandMock,
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: emitToastMock,
}));

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: 'task-designer-1',
    formId: 'FORM-1001',
    title: 'BOX1 审核单',
    description: '我发起的校审单说明',
    modelName: '主装置模型',
    status: 'draft',
    priority: 'high',
    requesterId: 'designer-1',
    requesterName: '设计甲',
    checkerId: 'checker-1',
    checkerName: '校核甲',
    approverId: 'approver-1',
    approverName: '审核甲',
    reviewerId: 'checker-1',
    reviewerName: '校核甲',
    components: [
      { id: 'comp-1', name: 'BRAN 管道构件', refNo: '24381_145018', type: 'BRAN' },
    ],
    attachments: [
      {
        id: 'att-1',
        name: '设计说明.pdf',
        url: 'https://example.com/design.pdf',
        uploadedAt: new Date('2026-04-21T09:30:00+08:00').getTime(),
      },
    ],
    createdAt: new Date('2026-04-20T09:00:00+08:00').getTime(),
    updatedAt: new Date('2026-04-21T09:00:00+08:00').getTime(),
    dueDate: new Date('2026-04-25T00:00:00+08:00').getTime(),
    currentNode: 'sj',
    returnReason: '请先处理批注',
    workflowHistory: [
      {
        node: 'jd',
        action: 'return',
        operatorId: 'checker-1',
        operatorName: '校核甲',
        comment: '请先处理批注',
        timestamp: new Date('2026-04-21T08:30:00+08:00').getTime(),
      },
    ],
    ...overrides,
  };
}

async function flushUi() {
  await vi.dynamicImportSettled();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function mountPanel() {
  const { default: DesignerCommentHandlingPanel } = await import('./DesignerCommentHandlingPanel.vue');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(DesignerCommentHandlingPanel),
  });
  app.mount(host);
  await flushUi();
  return {
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('DesignerCommentHandlingPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    persistenceState.clear();
    persistenceStorageKeys.length = 0;
    annotationProcessingEntryTargetRef.value = null;
    currentTaskRef.value = null;
    returnedTasksRef.value = [createTask()];
    confirmedRecordsRef.value = [];
    annotationsRef.value = [
      {
        id: 'annot-open',
        title: '待处理批注',
        description: '先处理这条返回批注',
        createdAt: 10,
        visible: true,
        refnos: ['24381_145018'],
        formId: 'FORM-1001',
        reviewState: undefined,
      },
      {
        id: 'annot-other-form',
        title: '其他单据批注',
        description: '这条批注属于别的单据',
        createdAt: 20,
        visible: true,
        refnos: ['24381_145019'],
        formId: 'FORM-2002',
        reviewState: undefined,
      },
    ];
    cloudAnnotationsRef.value = [];
    rectAnnotationsRef.value = [];
    obbAnnotationsRef.value = [];
    measurementsRef.value = [
      {
        id: 'measure-open',
        kind: 'distance',
        origin: { entityId: 'pipe-a', worldPos: [0, 0, 0] },
        target: { entityId: 'pipe-b', worldPos: [1, 0, 0] },
        visible: true,
        createdAt: 100,
        sourceAnnotationId: 'annot-open',
        sourceAnnotationType: 'text',
        formId: 'FORM-1001',
      },
    ];
    xeokitDistanceMeasurementsRef.value = [];
    xeokitAngleMeasurementsRef.value = [];
    activeAnnotationIdRef.value = null;
    activeCloudAnnotationIdRef.value = null;
    activeRectAnnotationIdRef.value = null;
    activeObbAnnotationIdRef.value = null;
    loadReviewTasksMock.mockClear();
    setCurrentTaskMock.mockClear();
    addConfirmedRecordMock.mockClear();
    restoreConfirmedRecordsIntoSceneMock.mockClear();
    ensurePanelAndActivateMock.mockClear();
    emitCommandMock.mockClear();
    emitToastMock.mockClear();
    showModelByRefnosWithAckMock.mockClear();
    clearDraftDataByPayloadMock.mockClear();
    submitTaskToNextNodeMock.mockClear();
    notifyParentWorkflowActionMock.mockClear();
    notifyParentWorkflowActionMock.mockReturnValue(false);
    reviewAnnotationCheckMock.mockClear();
    reviewAnnotationCheckMock.mockResolvedValue({
      success: true,
      data: {
        passed: true,
        recommendedAction: 'submit',
        currentNode: 'sj',
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
    clearDesignerCommentViewModeRequest();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    clearDesignerCommentViewModeRequest();
  });

  it('驳回任务恢复后默认进入批注列表页', async () => {
    currentTaskRef.value = createTask();

    const mounted = await mountPanel();

    expect(loadReviewTasksMock).toHaveBeenCalled();
    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeNull();
    expect(document.querySelector('[data-testid="designer-comment-task-entry"]')).toBeNull();
    expect(document.body.textContent).toContain('批注列表');
    expect(document.body.textContent).toContain('待处理批注');
    expect(document.body.textContent).not.toContain('其他单据批注');

    mounted.unmount();
  });

  it('被动恢复到同 form_id 的任务时，即使任务尚未回到 sj 也默认显示批注列表', async () => {
    returnedTasksRef.value = [];
    currentTaskRef.value = createTask({
      status: 'submitted',
      currentNode: 'jd',
      returnReason: undefined,
      workflowHistory: [],
    });
    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'designer',
      formId: 'FORM-1001',
      primaryPanelId: 'designerCommentHandling',
      visiblePanelIds: ['designerCommentHandling'],
    }));

    const mounted = await mountPanel();

    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-task-entry"]')).toBeNull();
    expect(document.body.textContent).toContain('待处理批注');
    expect(document.body.textContent).not.toContain('其他单据批注');

    mounted.unmount();
  });

  it('双击批注后进入详情页', async () => {
    currentTaskRef.value = createTask();

    const mounted = await mountPanel();
    const row = document.querySelector('[data-testid="annotation-row-text-annot-open"]') as HTMLElement;

    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flushUi();

    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeNull();
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeTruthy();
    expect(document.body.textContent).toContain('designerOnly|发送回复|待处理批注');
    expect(document.body.textContent).toContain('测量证据');
    expect(document.body.textContent).toContain('保存新增证据');

    mounted.unmount();
  });

  it('详情返回列表后保留当前选中批注', async () => {
    currentTaskRef.value = createTask();

    const mounted = await mountPanel();
    const row = document.querySelector('[data-testid="annotation-row-text-annot-open"]') as HTMLElement;

    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flushUi();

    const backBtn = document.querySelector('[data-testid="annotation-workspace-back"]') as HTMLElement;
    backBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    const returnedRow = document.querySelector('[data-testid="annotation-row-text-annot-open"]') as HTMLElement;
    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeNull();
    expect(returnedRow.className).toContain('border-orange-200');

    mounted.unmount();
  });

  it('当前任务切换后自动回到新任务的批注列表页', async () => {
    const task1 = createTask();
    const task2 = createTask({
      id: 'task-designer-2',
      formId: 'FORM-2002',
      title: 'BOX2 审核单',
    });
    returnedTasksRef.value = [task1, task2];
    currentTaskRef.value = task1;

    const mounted = await mountPanel();
    const row = document.querySelector('[data-testid="annotation-row-text-annot-open"]') as HTMLElement;

    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flushUi();

    annotationsRef.value = [
      {
        id: 'annot-task-2',
        title: 'BOX2 批注',
        description: '任务二的批注',
        createdAt: 30,
        visible: true,
        refnos: ['24381_145099'],
        formId: 'FORM-2002',
        reviewState: undefined,
      },
    ];
    currentTaskRef.value = task2;
    await flushUi();

    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeNull();
    expect(document.body.textContent).toContain('BOX2 审核单');
    expect(document.body.textContent).toContain('BOX2 批注');

    mounted.unmount();
  });

  it('没有匹配驳回任务时显示任务页兜底', async () => {
    const mounted = await mountPanel();

    expect(document.querySelector('[data-testid="designer-comment-task-entry"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeNull();
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeNull();
    expect(document.querySelector('[data-testid="resubmission-task-list-stub"]')).toBeTruthy();

    mounted.unmount();
  });

  it('未匹配到 form_id 时仍保留目标批注的详情页', async () => {
    annotationsRef.value = [
      {
        id: 'annot-orphan',
        title: '孤立批注',
        description: '找不到对应任务',
        createdAt: 30,
        visible: true,
        refnos: ['24381_149999'],
        formId: 'FORM-9999',
      },
      {
        id: 'annot-task-1',
        title: '当前任务批注',
        description: '不应被自动带入',
        createdAt: 10,
        visible: true,
        refnos: ['24381_145018'],
        formId: 'FORM-1001',
      },
    ];
    setExternalEntryTarget({
      annotationId: 'annot-orphan',
      annotationType: 'text',
      formId: 'FORM-9999',
    });

    const mounted = await mountPanel();

    expect(currentTaskRef.value).toBeNull();
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="external-entry-unmatched-task"]')).toBeTruthy();
    expect(document.body.textContent).toContain('孤立批注');
    expect(document.body.textContent).toContain('designerOnly|发送回复|孤立批注');
    expect(document.body.textContent).not.toContain('当前任务批注');

    mounted.unmount();
  });

  it('点击"批注表格" tab 后切换到 AnnotationTableView · PR 3', async () => {
    currentTaskRef.value = createTask();

    const mounted = await mountPanel();

    // 默认卡片模式
    expect(document.querySelector('[data-testid="annotation-workspace-list"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-annotation-table"]')).toBeNull();
    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeNull();

    const tableTab = document.querySelector<HTMLElement>('[data-testid="annotation-list-view-mode-table"]');
    expect(tableTab).toBeTruthy();
    tableTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    // 切换后表格视图出现、卡片列表隐藏，但仍在 annotation_list 顶层视图
    expect(document.querySelector('[data-testid="designer-comment-annotation-table"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="annotation-workspace-list"]')).toBeNull();
    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeNull();

    mounted.unmount();
  });

  it('表格行单击选中批注后保持在批注列表 · PR 3', async () => {
    currentTaskRef.value = createTask();

    const mounted = await mountPanel();
    const tableTab = document.querySelector<HTMLElement>('[data-testid="annotation-list-view-mode-table"]');
    tableTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    const row = document.querySelector<HTMLElement>('[data-testid="annotation-table-view"] [role="row"]');
    expect(row).toBeTruthy();

    vi.useFakeTimers();
    try {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(240);
    } finally {
      vi.useRealTimers();
    }
    await flushUi();

    // 列表视图保持 · 未进入详情页
    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeNull();
    // 表格视图保持 · 选中批注被激活
    expect(document.querySelector('[data-testid="designer-comment-annotation-table"]')).toBeTruthy();
    expect(activeAnnotationIdRef.value).toBe('annot-open');

    mounted.unmount();
  });

  it('表格行双击进入批注详情并自动切回卡片布局 · PR 3', async () => {
    currentTaskRef.value = createTask();

    const mounted = await mountPanel();
    const tableTab = document.querySelector<HTMLElement>('[data-testid="annotation-list-view-mode-table"]');
    tableTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    const row = document.querySelector<HTMLElement>('[data-testid="annotation-table-view"] [role="row"]');
    expect(row).toBeTruthy();

    row!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flushUi();
    await flushUi();

    // 进入详情页 · AnnotationWorkspace detail 布局（因为 annotationListViewMode 被重置为 split）
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeNull();
    // locateAnnotation 副作用：调用 showModelByRefnosWithAck + ensurePanelAndActivate('viewer')
    expect(showModelByRefnosWithAckMock).toHaveBeenCalled();
    expect(ensurePanelAndActivateMock).toHaveBeenCalledWith('viewer');

    mounted.unmount();
  });

  it('卡片筛选为待处理时，表格打开已修改批注仍进入该批注详情', async () => {
    currentTaskRef.value = createTask();
    annotationsRef.value = [
      {
        id: 'annot-pending',
        title: '待处理批注',
        description: '先处理这条返回批注',
        createdAt: 10,
        visible: true,
        refnos: ['24381_145018'],
        formId: 'FORM-1001',
        reviewState: undefined,
      },
      {
        id: 'annot-fixed',
        title: '已修改批注',
        description: '这条批注已经修改过',
        createdAt: 20,
        visible: true,
        refnos: ['24381_145020'],
        formId: 'FORM-1001',
        reviewState: {
          resolutionStatus: 'fixed',
          decisionStatus: 'pending',
          updatedAt: 1710000000000,
          history: [],
        },
      },
    ];

    const mounted = await mountPanel();
    const pendingFilter = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('待处理'));
    pendingFilter?.click();
    await flushUi();

    const tableTab = document.querySelector<HTMLElement>('[data-testid="annotation-list-view-mode-table"]');
    tableTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    const fixedRow = document.querySelector<HTMLElement>('[data-testid="annotation-table-row-annot-fixed"]');
    expect(fixedRow).toBeTruthy();
    fixedRow!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flushUi();

    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeTruthy();
    expect(document.body.textContent).toContain('已修改批注');
    expect(document.body.textContent).toContain('designerOnly|发送回复|已修改批注');

    mounted.unmount();
  });

  it('设计侧再次提交前执行批注检查，通过后才提交任务', async () => {
    currentTaskRef.value = createTask();
    confirmedRecordsRef.value = [{
      annotations: [...annotationsRef.value],
      measurements: [...measurementsRef.value],
    }];

    const mounted = await mountPanel();
    const row = document.querySelector('[data-testid="annotation-row-text-annot-open"]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flushUi();

    const resubmitButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('流转回校对'));
    expect(resubmitButton).toBeTruthy();
    expect(resubmitButton?.disabled).toBe(false);

    resubmitButton?.click();
    await flushUi();

    expect(reviewAnnotationCheckMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-designer-1',
      formId: 'FORM-1001',
      currentNode: 'sj',
      intent: 'submit_next',
      includedTypes: ['text', 'cloud', 'rect'],
    }));
    expect(submitTaskToNextNodeMock).toHaveBeenCalledWith('task-designer-1');

    mounted.unmount();
  });

  it('外部流程嵌入模式下再次提交改为通知父窗口 workflow/sync active', async () => {
    notifyParentWorkflowActionMock.mockReturnValue(true);
    currentTaskRef.value = createTask();
    confirmedRecordsRef.value = [{
      annotations: [...annotationsRef.value],
      measurements: [...measurementsRef.value],
    }];

    const mounted = await mountPanel();
    const row = document.querySelector('[data-testid="annotation-row-text-annot-open"]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flushUi();

    const resubmitButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('流转回校对'));
    resubmitButton?.click();
    await flushUi();

    expect(reviewAnnotationCheckMock).toHaveBeenCalled();
    expect(notifyParentWorkflowActionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'active',
      taskId: 'task-designer-1',
      formId: 'FORM-1001',
      source: 'designer-comment-handling-panel',
    }));
    expect(submitTaskToNextNodeMock).not.toHaveBeenCalled();

    mounted.unmount();
  });

  it('Ribbon 请求切到 table 视图时面板响应并清空请求 · PR 4', async () => {
    currentTaskRef.value = createTask();

    const mounted = await mountPanel();
    expect(document.querySelector('[data-testid="annotation-workspace-list"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeNull();

    requestDesignerCommentViewMode('table');
    await flushUi();

    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="annotation-workspace-list"]')).toBeNull();
    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeTruthy();

    mounted.unmount();
  });

  it('处于详情页时 Ribbon 请求 table 会回到列表并切到表格视图 · PR 4', async () => {
    currentTaskRef.value = createTask();

    const mounted = await mountPanel();
    const row = document.querySelector<HTMLElement>('[data-testid="annotation-row-text-annot-open"]');
    row!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flushUi();

    // 先到详情页
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeTruthy();

    // Ribbon 请求
    requestDesignerCommentViewMode('table');
    await flushUi();

    // 回到列表视图且是 table 形态
    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="designer-comment-annotation-detail"]')).toBeNull();
    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeTruthy();

    mounted.unmount();
  });

  it('刷新后恢复上次的 annotationListViewMode · PR 5', async () => {
    currentTaskRef.value = createTask();
    persistenceState.set('annotationListViewMode', 'table');

    const mounted = await mountPanel();

    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="annotation-workspace-list"]')).toBeNull();
    expect(document.querySelector('[data-testid="designer-comment-annotation-list"]')).toBeTruthy();

    mounted.unmount();
  });
});
