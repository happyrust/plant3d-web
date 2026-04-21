import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, h, nextTick, ref } from 'vue';

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
const persistenceState = new Map<string, unknown>();
const persistenceStorageKeys: string[] = [];

vi.mock('./confirmedRecordsRestore', () => ({
  createConfirmedRecordsRestorer: () => ({
    currentTaskRecords: computed(() => confirmedRecordsRef.value as any[]),
    lastRestoredSceneKey: ref<string | null>(null),
    restoreConfirmedRecordsIntoScene: restoreConfirmedRecordsIntoSceneMock,
  }),
}));

vi.mock('./ResubmissionTaskList.vue', () => ({
  default: {
    name: 'ResubmissionTaskListStub',
    template: '<div data-testid="resubmission-task-list-stub"></div>',
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
    clearAll: vi.fn(),
  }),
  getAnnotationRefnos: (annotation: { refnos?: string[]; refno?: string }) => annotation.refnos ?? (annotation.refno ? [annotation.refno] : []),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: ref({ id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER }),
    returnedInitiatedTasks: returnedTasksRef,
    loadReviewTasks: loadReviewTasksMock,
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
    persistenceState.clear();
    persistenceStorageKeys.length = 0;
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
        reviewState: undefined,
      },
      {
        id: 'annot-rejected',
        title: '已驳回批注',
        description: '这条批注被驳回过',
        createdAt: 20,
        visible: true,
        refnos: ['24381_145018'],
        reviewState: {
          resolutionStatus: 'fixed',
          decisionStatus: 'rejected',
          updatedAt: 40,
          updatedByName: '校核甲',
          history: [],
        },
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
      },
      {
        id: 'measure-other',
        kind: 'distance',
        origin: { entityId: 'pipe-c', worldPos: [0, 0, 0] },
        target: { entityId: 'pipe-d', worldPos: [1, 0, 0] },
        visible: true,
        createdAt: 90,
        sourceAnnotationId: 'annot-rejected',
        sourceAnnotationType: 'text',
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
    restoreConfirmedRecordsIntoSceneMock.mockClear();
    ensurePanelAndActivateMock.mockClear();
    emitCommandMock.mockClear();
    emitToastMock.mockClear();
    showModelByRefnosWithAckMock.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('从驳回单据进入后默认显示返回批注列表，并优先选中待处理批注', async () => {
    const mounted = await mountPanel();

    expect(loadReviewTasksMock).toHaveBeenCalled();
    expect(document.body.textContent).toContain('返回批注列表');
    expect(document.body.textContent).toContain('待处理批注');
    expect(document.body.textContent).toContain('designerOnly|发送回复|待处理批注');
    expect(document.body.textContent).toContain('距离 · pipe-a → pipe-b');
    expect(document.body.textContent).not.toContain('距离 · pipe-c → pipe-d');

    mounted.unmount();
  });

  it('点击查看发起单后，会以右侧抽屉展示原始发起数据', async () => {
    const mounted = await mountPanel();

    const openDrawerButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('查看发起单')
    );
    expect(openDrawerButton).toBeTruthy();

    openDrawerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    expect(document.body.textContent).toContain('我发起的校审单');
    expect(document.body.textContent).toContain('发起单填写内容');
    expect(document.body.textContent).toContain('BOX1 审核单');
    expect(document.body.textContent).toContain('我发起的校审单说明');
    expect(document.body.textContent).toContain('校核甲');
    expect(document.body.textContent).toContain('审核甲');
    expect(document.body.textContent).toContain('BRAN 管道构件');

    mounted.unmount();
  });
});
