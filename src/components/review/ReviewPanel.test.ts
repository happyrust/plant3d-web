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
const saveAnnotationSeverityMock = vi.hoisted(() => vi.fn(async () => true));
const saveAnnotationBasicFieldsMock = vi.hoisted(() => vi.fn(async () => true));
const refreshCommentThreadMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/composables/useAnnotationSeveritySync', () => ({
  saveAnnotationSeverity: (...args: unknown[]) => saveAnnotationSeverityMock(...args),
  saveAnnotationBasicFields: (...args: unknown[]) => saveAnnotationBasicFieldsMock(...args),
}));

vi.mock('@/composables/useCommentThread', () => ({
  refreshCommentThread: (...args: unknown[]) => refreshCommentThreadMock(...args),
}));

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
  reviewAnnotationCheck: (...args: any[]) => (reviewAnnotationCheckMock as any)(...args),
}));

const viewerWaitForReadyMock = vi.hoisted(() => vi.fn(async () => false));
const showModelByRefnosWithAckMock = vi.hoisted(() => vi.fn(async () => ({ ok: [], fail: [], error: null })));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    viewerRef: { value: null },
    tools: { value: null },
  }),
  waitForViewerReady: (...args: any[]) => (viewerWaitForReadyMock as any)(...args),
  showModelByRefnosWithAck: (...args: any[]) => (showModelByRefnosWithAckMock as any)(...args),
}));

const toolStoreMock = vi.hoisted(() => ({
  annotationCount: { value: 0 },
  cloudAnnotationCount: { value: 0 },
  rectAnnotationCount: { value: 0 },
  obbAnnotationCount: { value: 0 },
  measurementCount: { value: 0 },
  annotations: { value: [] as any[] },
  cloudAnnotations: { value: [] as any[] },
  rectAnnotations: { value: [] as any[] },
  obbAnnotations: { value: [] as any[] },
  measurements: { value: [] as any[] },
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
  setTextAnnotationsCollapsed: vi.fn(),
  updateAnnotationSeverity: vi.fn(),
}));

const dockApiMock = vi.hoisted(() => ({
  ensurePanelAndActivate: vi.fn(),
}));

const reviewAttachmentPreviewMock = vi.hoisted(() => ({
  getKind: vi.fn((attachment: { name?: string; mimeType?: string }) => {
    const name = attachment.name?.toLowerCase() ?? '';
    if (attachment.mimeType === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (attachment.mimeType?.startsWith('image/') || /\.(png|jpe?g)$/.test(name)) return 'image';
    return null;
  }),
  open: vi.fn(() => true),
}));

const commandBusMock = vi.hoisted(() => ({
  emitCommand: vi.fn(),
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: dockApiMock.ensurePanelAndActivate,
}));

vi.mock('@/composables/useReviewAttachmentPreview', () => ({
  getReviewAttachmentPreviewKind: reviewAttachmentPreviewMock.getKind,
  openReviewAttachmentPreview: reviewAttachmentPreviewMock.open,
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
  restoreEmbedFormSnapshotContext: (...args: any[]) => (restoreEmbedFormSnapshotContextMock as any)(...args),
}));

vi.mock('./CollisionResultList.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./ReviewCommentsTimeline.vue', () => ({
  default: {
    name: 'ReviewCommentsTimelineStub',
    props: {
      designerOnly: { type: Boolean, default: false },
      composerSubmitLabel: { type: String, default: '' },
      annotationLabel: { type: String, default: '' },
      density: { type: String, default: 'normal' },
    },
    template: '<div data-testid="timeline-stub" :data-density="density">{{ designerOnly ? "designerOnly" : "review" }}|{{ composerSubmitLabel }}|{{ annotationLabel }}</div>',
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

async function settleVue() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function expandWorkflowTransfer() {
  const toggle = document.querySelector('[data-testid="review-workflow-toggle"]') as HTMLButtonElement | null;
  toggle?.click();
  await settleVue();
}

async function mountReviewPanel(props: Record<string, unknown> = {}) {
  vi.resetModules();
  const { default: ReviewPanel } = await import('./ReviewPanel.vue');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(ReviewPanel, props) });
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
    toolStoreMock.setTextAnnotationsCollapsed.mockClear();
    toolStoreMock.annotationCount.value = 0;
    toolStoreMock.cloudAnnotationCount.value = 0;
    toolStoreMock.rectAnnotationCount.value = 0;
    toolStoreMock.obbAnnotationCount.value = 0;
    toolStoreMock.measurementCount.value = 0;
    toolStoreMock.annotations.value = [];
    toolStoreMock.cloudAnnotations.value = [];
    toolStoreMock.rectAnnotations.value = [];
    toolStoreMock.obbAnnotations.value = [];
    toolStoreMock.measurements.value = [];
    toolStoreMock.xeokitDistanceMeasurements.value = [];
    toolStoreMock.xeokitAngleMeasurements.value = [];
    toolStoreMock.activeAnnotationId.value = null;
    toolStoreMock.activeCloudAnnotationId.value = null;
    toolStoreMock.activeRectAnnotationId.value = null;
    toolStoreMock.activeObbAnnotationId.value = null;
    toolStoreMock.getAnnotationComments.mockReset();
    toolStoreMock.getAnnotationComments.mockReturnValue([]);
    viewerWaitForReadyMock.mockClear();
    viewerWaitForReadyMock.mockResolvedValue(false);
    reviewAttachmentPreviewMock.getKind.mockClear();
    reviewAttachmentPreviewMock.open.mockClear();
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
    saveAnnotationSeverityMock.mockReset();
    saveAnnotationSeverityMock.mockResolvedValue(true);
    saveAnnotationBasicFieldsMock.mockReset();
    saveAnnotationBasicFieldsMock.mockResolvedValue(true);
    refreshCommentThreadMock.mockReset();
    refreshCommentThreadMock.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('confirmed record counts only canonical reviewer annotations', { timeout: 10_000 }, async () => {
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
    expect(document.querySelector('[data-testid="review-workbench-workflow-zone"]')).toBeNull();
    expect(document.querySelector('[data-testid="annotation-workspace-root"]')).not.toBeNull();
    expect(document.body.textContent).toContain('历史流转');
    expect(document.body.textContent).toContain('审核记录');
    expect(document.body.textContent).toContain('当前批注');
    expect(document.body.textContent).not.toContain('旧审核字段');
    mounted.unmount();
  });

  it('Dock 紧凑模式保留批注、详情、处理区和确认记录紧凑行', async () => {
    sortedConfirmedRecords.value = [
      {
        id: 'record-dock-1',
        taskId: 'task-1',
        formId: 'FORM-001',
        confirmedAt: 1710000000000,
        note: 'Dock 紧凑备注摘要',
        annotations: [{
          id: 'anno-dock-1',
          title: 'Dock 批注标题',
          severity: 'high',
        }],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [],
      },
    ] as never[];
    confirmedRecordCount.value = 1;
    totalConfirmedAnnotations.value = 1;
    totalConfirmedMeasurements.value = 0;
    toolStoreMock.annotations.value = [
      {
        id: 'anno-dock-1',
        formId: 'FORM-001',
        entityId: '24381/145018',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: 'Dock 批注标题',
        description: 'Dock 批注详情说明',
        severity: 'high',
        refno: '24381/145018',
        refnos: ['24381/145018'],
        createdAt: 1710000000000,
      },
    ];

    const mounted = await mountReviewPanel({ density: 'dock' });
    await settlePanel();

    expect(document.querySelector('[data-panel="review"]')?.getAttribute('data-density')).toBe('dock');
    expect(document.querySelector('[data-testid="annotation-workspace-root"]')?.getAttribute('data-density')).toBe('dock');
    expect(document.querySelector('[data-testid="confirmed-record-compact-row"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="timeline-stub"]')?.getAttribute('data-density')).toBe('dock');
    expect(document.body.textContent).toContain('Dock 批注标题');
    expect(document.body.textContent).toContain('批注 1 · 待处理');
    expect(document.body.textContent).toContain('错误类型设置');
    expect(document.body.textContent).toContain('保存新增证据');
    expect(document.body.textContent).toContain('1 批次 · 批注 1 · 测量 0');

    mounted.unmount();
  });

  it('Dock 批注列表批量收起只下发当前文字批注', async () => {
    toolStoreMock.annotations.value = [
      {
        id: 'anno-text-1',
        formId: 'FORM-001',
        entityId: '24381/145018',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: '文字批注 1',
        description: 'text 1',
        refnos: ['24381/145018'],
        createdAt: 1710000000000,
      },
      {
        id: 'anno-text-2',
        formId: 'FORM-001',
        entityId: '24381/145012',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '2',
        title: '文字批注 2',
        description: 'text 2',
        refnos: ['24381/145012'],
        createdAt: 1710000001000,
      },
    ];
    toolStoreMock.cloudAnnotations.value = [
      {
        id: 'cloud-1',
        formId: 'FORM-001',
        objectIds: ['24381/145018'],
        anchorWorldPos: [0, 0, 0],
        visible: true,
        title: '云线批注',
        description: 'cloud',
        refnos: ['24381/145018'],
        createdAt: 1710000002000,
      },
    ];

    const mounted = await mountReviewPanel({ density: 'dock' });
    await settlePanel();

    const collapseButton = document.querySelector('[data-testid="annotation-collapse-all-text"]') as HTMLButtonElement | null;
    expect(collapseButton).not.toBeNull();
    collapseButton?.click();
    await settlePanel();

    expect(toolStoreMock.setTextAnnotationsCollapsed).toHaveBeenCalledWith(['anno-text-2', 'anno-text-1'], true);
    expect(toolStoreMock.setTextAnnotationsCollapsed).not.toHaveBeenCalledWith(expect.arrayContaining(['cloud-1']), true);

    mounted.unmount();
  });

  it('后端有确认记录但批注列表为空时显示恢复诊断信息', async () => {
    sortedConfirmedRecords.value = [
      {
        id: 'record-diagnostic-1',
        taskId: 'task-1',
        formId: 'FORM-001',
        confirmedAt: 1710000000000,
        note: '诊断记录',
        annotations: [{ id: 'anno-diagnostic-1', title: '后端批注' }],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [],
      },
    ] as never[];
    confirmedRecordCount.value = 1;
    totalConfirmedAnnotations.value = 1;
    totalConfirmedMeasurements.value = 0;

    const mounted = await mountReviewPanel();
    await settlePanel();

    const diagnostic = document.querySelector('[data-testid="annotation-restore-diagnostic"]');
    expect(diagnostic).not.toBeNull();
    expect(diagnostic?.textContent).toContain('formId=FORM-001');
    expect(diagnostic?.textContent).toContain('taskId=task-1');
    expect(diagnostic?.textContent).toContain('recordCount=1');
    expect(diagnostic?.textContent).toContain('annotationCount=1');

    mounted.unmount();
  });

  it('后端有 1 条确认记录和 1 条批注时，详情页批注列表显示 1 条', async () => {
    sortedConfirmedRecords.value = [
      {
        id: 'record-visible-1',
        taskId: 'task-1',
        formId: 'FORM-001',
        confirmedAt: 1710000000000,
        note: '可见记录',
        annotations: [{ id: 'anno-visible-1', title: 'BRAN 详情批注' }],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [],
      },
    ] as never[];
    confirmedRecordCount.value = 1;
    totalConfirmedAnnotations.value = 1;
    totalConfirmedMeasurements.value = 0;
    toolStoreMock.annotations.value = [
      {
        id: 'anno-visible-1',
        formId: 'FORM-001',
        entityId: '24381/145018',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: 'BRAN 详情批注',
        description: '评论详情页批注',
        refno: '24381/145018',
        refnos: ['24381/145018'],
        createdAt: 1710000000000,
      },
    ];

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.querySelector('[data-testid="annotation-restore-diagnostic"]')).toBeNull();
    expect(document.body.textContent).toContain('当前批注');
    expect(document.body.textContent).toContain('BRAN 详情批注');

    mounted.unmount();
  });

  it('hides internal workflow actions in passive workflow mode', async () => {
    sessionStorage.setItem('plant3d_workflow_mode', 'external');

    const mounted = await mountReviewPanel();
    await settlePanel();

    const toggle = document.querySelector('[data-testid="review-workflow-toggle"]') as HTMLButtonElement | null;
    toggle?.click();
    await settlePanel();

    const zone = document.querySelector('[data-testid="review-workbench-workflow-zone"]');
    expect(zone).not.toBeNull();
    expect(zone?.textContent).toContain('外部流程');
    expect(zone?.textContent).toContain('刷新');
    expect(zone?.textContent).not.toContain('提交到');
    expect(zone?.textContent).not.toContain('驳回到设计');

    mounted.unmount();
  });

  it('external sj form-focused mode only shows existing scoped annotations', async () => {
    sessionStorage.setItem('plant3d_workflow_mode', 'external');
    sessionStorage.setItem('embed_mode_params', JSON.stringify({
      formId: 'FORM-001',
      userToken: null,
      userId: 'designer-1',
      workflowRole: 'sj',
      projectId: 'project-1',
      workflowMode: 'external',
      isEmbedMode: true,
    }));
    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'reviewer',
      formId: 'FORM-001',
      restoreStatus: 'matched',
      restoredTaskId: 'task-sj-returned',
      primaryPanelId: 'review',
      visiblePanelIds: ['review'],
    }));
    currentTask.value = createTask({
      id: 'task-sj-returned',
      formId: 'FORM-001',
      currentNode: 'sj',
      status: 'draft',
    });
    toolStoreMock.annotationCount.value = 2;
    toolStoreMock.annotations.value = [
      {
        id: 'anno-current-form',
        formId: 'FORM-001',
        refno: 'V-01',
        title: '当前单据批注',
        description: '只显示这一条',
        visible: true,
        createdAt: 1710000000000,
      },
      {
        id: 'anno-other-form',
        formId: 'FORM-OTHER',
        refno: 'P-02',
        title: '其他单据批注',
        description: '不应显示',
        visible: true,
        createdAt: 1710000001000,
      },
    ];

    const mounted = await mountReviewPanel();
    await settlePanel();

    expect(document.querySelector('[data-testid="external-sj-existing-annotations-only"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="reviewer-direct-launch-annotation-zone"]')).toBeNull();
    expect(document.querySelector('[data-testid="reviewer-direct-launch-measurement-zone"]')).toBeNull();
    expect(document.body.textContent).toContain('当前单据批注');
    expect(document.body.textContent).not.toContain('其他单据批注');
    expect(document.body.textContent).not.toContain('确认当前数据');

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
    (restoreEmbedFormSnapshotContextMock.mockImplementationOnce as any)(async (options: {
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

    await expandWorkflowTransfer();
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

  it('opens previewable attachments in the dock and keeps downloads explicit', async () => {
    currentTask.value = createTask({
      attachments: [
        {
          id: 'attachment-pdf',
          name: 'drawing.pdf',
          url: '/files/review_attachments/drawing.pdf',
          mimeType: 'application/pdf',
          uploadedAt: 1710000001000,
        },
        {
          id: 'attachment-docx',
          name: 'notes.docx',
          url: '/files/review_attachments/notes.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          uploadedAt: 1710000002000,
        },
      ],
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const mounted = await mountReviewPanel();
    await settleVue();

    const previewButton = document.querySelector(
      '[data-testid="review-attachment-preview-attachment-pdf"]',
    ) as HTMLButtonElement | null;
    expect(previewButton).not.toBeNull();
    expect(document.querySelector(
      '[data-testid="review-attachment-preview-attachment-docx"]',
    )).toBeNull();

    previewButton?.click();
    expect(reviewAttachmentPreviewMock.open).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ id: 'attachment-pdf' }),
    );
    expect(anchorClick).not.toHaveBeenCalled();

    const downloadButton = document.querySelector(
      '[data-testid="review-attachment-download-attachment-pdf"]',
    ) as HTMLButtonElement | null;
    downloadButton?.click();
    expect(anchorClick).toHaveBeenCalledTimes(1);

    anchorClick.mockRestore();
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
    await expandWorkflowTransfer();

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
    await expandWorkflowTransfer();

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
    await expandWorkflowTransfer();

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

  it('exposes automation hook to create new-shape text annotations for reviewer e2e', async () => {
    window.history.replaceState({}, '', '/?automation_review=1');

    const mounted = await mountReviewPanel();
    await settlePanel();

    const hook = (window as Window & {
      __plant3dReviewerE2E?: {
        addMockAnnotation?: (title?: string, description?: string) => string;
      };
    }).__plant3dReviewerE2E;

    expect(typeof hook?.addMockAnnotation).toBe('function');
    const annotationId = hook?.addMockAnnotation?.('新结构批注', '评论线程回归批注');
    expect(annotationId).toBeTruthy();
    expect(toolStoreMock.addAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      id: annotationId,
      entityId: '24381/145018',
      worldPos: [0, 0, 0],
      glyph: '1',
      refno: '24381/145018',
      refnos: ['24381/145018'],
      title: '新结构批注',
      description: '评论线程回归批注',
      visible: true,
      createdAt: expect.any(Number),
    }));

    mounted.unmount();
  });

  it('automation hook refreshes a persisted comment thread with formal review context', async () => {
    window.history.replaceState({}, '', '/?automation_review=1');
    toolStoreMock.annotations.value = [
      {
        id: 'restore-annot-1',
        entityId: '24381/145018',
        formId: 'FORM-001',
        taskId: 'task-1',
        worldPos: [0, 0, 0],
        glyph: '1',
        refno: '24381/145018',
        refnos: ['24381/145018'],
        title: 'restore 自动化批注 24381_145018',
        description: '刷新恢复自动化持久化批注',
        visible: true,
        createdAt: 1710000000000,
      },
    ];
    toolStoreMock.getAnnotationComments.mockReturnValue([
      {
        id: 'comment-1',
        annotationId: 'restore-annot-1',
        annotationType: 'text',
        authorId: 'proofreader_001',
        authorName: 'JH',
        authorRole: 'proofreader',
        content: '评论线程回归',
        createdAt: 1710000000100,
      },
    ]);

    const mounted = await mountReviewPanel();
    await settlePanel();

    const hook = (window as Window & {
      __plant3dReviewerE2E?: {
        refreshAnnotationCommentThread?: (type?: string, id?: string) => Promise<number>;
      };
    }).__plant3dReviewerE2E;

    expect(typeof hook?.refreshAnnotationCommentThread).toBe('function');
    await expect(hook?.refreshAnnotationCommentThread?.('text', 'restore-annot-1')).resolves.toBe(1);
    expect(refreshCommentThreadMock).toHaveBeenCalledWith({
      annotationType: 'text',
      annotationId: 'restore-annot-1',
      formId: 'FORM-001',
      taskId: 'task-1',
    });
    expect(toolStoreMock.activeAnnotationId.value).toBe('restore-annot-1');
    expect(toolStoreMock.getAnnotationComments).toHaveBeenCalledWith(
      'text',
      'restore-annot-1',
      'FORM-001',
      'task-1',
    );

    mounted.unmount();
  }, 10_000);

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
    await expandWorkflowTransfer();

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
    await expandWorkflowTransfer();

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
    await expandWorkflowTransfer();

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
    await expandWorkflowTransfer();

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
    await expandWorkflowTransfer();

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

  it('Reviewer 卡片筛选为待处理时，表格打开已修改批注仍定位该批注', async () => {
    toolStoreMock.annotations.value = [
      {
        id: 'ann-reviewer-pending',
        formId: 'FORM-001',
        entityId: 'entity-pending',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: '待处理 reviewer 批注',
        description: 'pending',
        severity: 'medium',
        refnos: ['comp-pending'],
        createdAt: 1710000000000,
      },
      {
        id: 'ann-reviewer-fixed',
        formId: 'FORM-001',
        entityId: 'entity-fixed',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '2',
        title: '已修改 reviewer 批注',
        description: 'fixed',
        severity: 'medium',
        refnos: ['comp-fixed'],
        createdAt: 1710000000100,
        reviewState: {
          resolutionStatus: 'fixed',
          decisionStatus: 'pending',
          updatedAt: 1710000000200,
          history: [],
        },
      },
    ];
    showModelByRefnosWithAckMock.mockResolvedValue({ ok: ['comp-fixed'], fail: [], error: null });

    const mounted = await mountReviewPanel();
    await settlePanel();

    const pendingFilter = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('待处理'));
    pendingFilter?.click();
    await settlePanel();

    const tableTabButton = document.querySelector('[data-testid="reviewer-annotation-list-view-mode-table"]') as HTMLButtonElement | null;
    tableTabButton?.click();
    await settlePanel();

    const fixedRow = document.querySelector('[data-testid="annotation-table-row-ann-reviewer-fixed"]') as HTMLElement | null;
    expect(fixedRow).not.toBeNull();
    fixedRow?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settlePanel();

    expect(document.querySelector('[data-testid="annotation-workspace-root"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeNull();
    expect(document.body.textContent).toContain('已修改 reviewer 批注');
    expect(toolStoreMock.activeAnnotationId.value).toBe('ann-reviewer-fixed');

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

  it('Reviewer 表格内修改错误标记时，保存会带当前 formId 和 taskId', async () => {
    toolStoreMock.annotations.value = [
      {
        id: 'ann-inline-severity',
        formId: 'FORM-001',
        authorId: 'reviewer-1',
        entityId: 'entity-inline-1',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: '表格错误标记',
        description: 'inline severity',
        severity: undefined,
        refnos: ['comp-inline-1'],
        createdAt: 1710000000000,
      },
    ];
    persistenceState.set('annotationListViewMode', 'table');

    const mounted = await mountReviewPanel();
    await settlePanel();

    const select = document.querySelector<HTMLSelectElement>('[data-testid="annotation-table-severity-editor-ann-inline-severity"]');
    expect(select).not.toBeNull();
    select!.value = 'drawing';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    await settlePanel();

    expect(saveAnnotationSeverityMock).toHaveBeenCalledWith('text', 'ann-inline-severity', 'drawing', {
      formId: 'FORM-001',
      taskId: 'task-1',
    });

    mounted.unmount();
  });

  it('Reviewer 表格内修改标题时，保存会带当前 formId 和 taskId', async () => {
    toolStoreMock.annotations.value = [
      {
        id: 'ann-inline-title',
        formId: 'FORM-001',
        authorId: 'reviewer-1',
        entityId: 'entity-inline-2',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '1',
        title: '旧标题',
        description: 'inline title',
        severity: 'general',
        refnos: ['comp-inline-2'],
        createdAt: 1710000000000,
      },
    ];
    persistenceState.set('annotationListViewMode', 'table');

    const mounted = await mountReviewPanel();
    await settlePanel();

    const titleButton = document.querySelector<HTMLButtonElement>('[data-testid="annotation-table-title-ann-inline-title"]');
    expect(titleButton).not.toBeNull();
    titleButton!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settlePanel();

    const input = document.querySelector<HTMLInputElement>('[data-testid="annotation-table-title-input-ann-inline-title"]');
    expect(input).not.toBeNull();
    input!.value = '新标题';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settlePanel();

    expect(saveAnnotationBasicFieldsMock).toHaveBeenCalledWith('text', 'ann-inline-title', { title: '新标题' }, {
      formId: 'FORM-001',
      taskId: 'task-1',
    });

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

  describe('批注表格视图 form_id scope（2026-05-18 补丁）', () => {
    // 与同文件的 `external sj form-focused mode only shows existing scoped annotations` 镜像，
    // 但聚焦在「批注表格」分支：annotationWorkspaceItems 应当和 allAnnotationItems
    // 一样按 isExternalSjFormFocused + activeReviewFormId 过滤，否则切到表格视图
    // 会泄露其它 form_id 的批注（违反 .plannotator/plan-sj-reject-ui.md §6）。

    function seedTwoFormAnnotations() {
      toolStoreMock.annotationCount.value = 2;
      toolStoreMock.annotations.value = [
        {
          id: 'ann-current-form',
          formId: 'FORM-001',
          entityId: 'entity-current',
          worldPos: [0, 0, 0],
          visible: true,
          glyph: '1',
          title: '当前单据批注_scope',
          description: '只在当前单据可见',
          severity: 'medium',
          refnos: ['V-01'],
          createdAt: 1710000000000,
        },
        {
          id: 'ann-other-form',
          formId: 'FORM-OTHER',
          entityId: 'entity-other',
          worldPos: [0, 0, 0],
          visible: true,
          glyph: '2',
          title: '其他单据批注_scope',
          description: '不应在 SJ 外部聚焦模式出现',
          severity: 'medium',
          refnos: ['P-02'],
          createdAt: 1710000001000,
        },
      ];
    }

    it('SJ 外部 form_id 聚焦模式下，批注表格视图只显示当前 form_id 的批注', async () => {
      sessionStorage.setItem('plant3d_workflow_mode', 'external');
      sessionStorage.setItem('embed_mode_params', JSON.stringify({
        formId: 'FORM-001',
        userToken: null,
        userId: 'designer-1',
        workflowRole: 'sj',
        projectId: 'project-1',
        workflowMode: 'external',
        isEmbedMode: true,
      }));
      sessionStorage.setItem('embed_landing_state', JSON.stringify({
        target: 'reviewer',
        formId: 'FORM-001',
        restoreStatus: 'matched',
        restoredTaskId: 'task-sj-returned',
        primaryPanelId: 'review',
        visiblePanelIds: ['review'],
      }));
      currentTask.value = createTask({
        id: 'task-sj-returned',
        formId: 'FORM-001',
        currentNode: 'sj',
        status: 'draft',
      });
      seedTwoFormAnnotations();
      persistenceState.set('annotationListViewMode', 'table');

      const mounted = await mountReviewPanel();
      await settlePanel();

      expect(document.querySelector('[data-testid="annotation-table-view"]')).not.toBeNull();
      expect(document.body.textContent).toContain('当前单据批注_scope');
      expect(document.body.textContent).not.toContain('其他单据批注_scope');

      mounted.unmount();
    });

    it('activeReviewFormId 为空时（任何 reviewer 角色）批注表格视图不收敛，仍显示全部批注', async () => {
      // 没有 currentTask.formId / embed_landing_state.formId / embed_mode_params.formId 时，
      // activeReviewFormId 为 null → isExternalFormFocused=false → 不过滤。
      // 沿用 2026-05-18 §14 推广后的判断；旧版本要求 role==='sj'，新版本只看 form_id。
      currentTask.value = createTask({ formId: undefined as unknown as string });
      seedTwoFormAnnotations();
      persistenceState.set('annotationListViewMode', 'table');

      const mounted = await mountReviewPanel();
      await settlePanel();

      expect(document.querySelector('[data-testid="annotation-table-view"]')).not.toBeNull();
      expect(document.body.textContent).toContain('当前单据批注_scope');
      expect(document.body.textContent).toContain('其他单据批注_scope');

      mounted.unmount();
    });

    it('passive workflow + 非 SJ 角色（如 jd 校核）且带 form_id 时，批注表格视图按当前 form_id 收敛 · 2026-05-18 \u00a714 推广', async () => {
      // 产品规约：「不能跨 form_id 批注，看的就是对应单据的数据」。
      // 升级后的 isExternalFormFocusedMode 不再要求 role==='sj'，
      // 任意 reviewer 角色 + passive workflow + form_id 均启用 form_id scope。
      // 详见 .plannotator/plan-sj-reject-ui.md §6 与
      // 开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md §14。
      sessionStorage.setItem('plant3d_workflow_mode', 'external');
      sessionStorage.setItem('embed_mode_params', JSON.stringify({
        formId: 'FORM-001',
        userToken: null,
        userId: 'checker-1',
        workflowRole: 'jd',
        projectId: 'project-1',
        workflowMode: 'external',
        isEmbedMode: true,
      }));
      currentTask.value = createTask({ formId: 'FORM-001', currentNode: 'jd' });
      seedTwoFormAnnotations();
      persistenceState.set('annotationListViewMode', 'table');

      const mounted = await mountReviewPanel();
      await settlePanel();

      expect(document.querySelector('[data-testid="annotation-table-view"]')).not.toBeNull();
      expect(document.body.textContent).toContain('当前单据批注_scope');
      expect(document.body.textContent).not.toContain('其他单据批注_scope');

      mounted.unmount();
    });

    it('passive workflow + sh 角色 + form_id 时，批注表格视图同样按当前 form_id 收敛 · 2026-05-18 \u00a714 推广', async () => {
      sessionStorage.setItem('plant3d_workflow_mode', 'external');
      sessionStorage.setItem('embed_mode_params', JSON.stringify({
        formId: 'FORM-001',
        userToken: null,
        userId: 'reviewer-1',
        workflowRole: 'sh',
        projectId: 'project-1',
        workflowMode: 'external',
        isEmbedMode: true,
      }));
      currentTask.value = createTask({ formId: 'FORM-001', currentNode: 'sh' });
      seedTwoFormAnnotations();
      persistenceState.set('annotationListViewMode', 'table');

      const mounted = await mountReviewPanel();
      await settlePanel();

      expect(document.querySelector('[data-testid="annotation-table-view"]')).not.toBeNull();
      expect(document.body.textContent).toContain('当前单据批注_scope');
      expect(document.body.textContent).not.toContain('其他单据批注_scope');

      mounted.unmount();
    });
  });
});
