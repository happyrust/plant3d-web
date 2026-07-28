import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onMounted, ref } from 'vue';

import type { ReviewTask } from '@/types/auth';

const {
  authVerifyTokenMock,
  clearAuthTokenMock,
  setAuthTokenMock,
  restoreEmbedWorkbenchContextMock,
  restoreEmbedFormSnapshotContextMock,
  switchProjectByIdMock,
  setCurrentTaskMock,
  importJsonMock,
  syncFromStoreMock,
  initializeMock,
  setEmbedUserMock,
  loadReviewTasksMock,
  clearCurrentUserSelectionMock,
  setDockApiMock,
  notifyDockLayoutChangeMock,
  setGlobalSelectedRefnoMock,
  waitForViewerReadyMock,
  showModelByRefnosWithAckMock,
  onCommandMock,
} = vi.hoisted(() => ({
  authVerifyTokenMock: vi.fn(),
  clearAuthTokenMock: vi.fn(),
  setAuthTokenMock: vi.fn(),
  restoreEmbedWorkbenchContextMock: vi.fn(),
  restoreEmbedFormSnapshotContextMock: vi.fn(),
  switchProjectByIdMock: vi.fn(() => true),
  setCurrentTaskMock: vi.fn(async () => undefined),
  importJsonMock: vi.fn(),
  syncFromStoreMock: vi.fn(),
  initializeMock: vi.fn(async () => undefined),
  setEmbedUserMock: vi.fn(),
  loadReviewTasksMock: vi.fn(async () => undefined),
  clearCurrentUserSelectionMock: vi.fn(),
  setDockApiMock: vi.fn(),
  notifyDockLayoutChangeMock: vi.fn(),
  setGlobalSelectedRefnoMock: vi.fn(),
  waitForViewerReadyMock: vi.fn(async () => true),
  showModelByRefnosWithAckMock: vi.fn(async () => ({ ok: [], fail: [], error: null })),
  onCommandMock: vi.fn(() => () => undefined),
}));

type PanelStub = {
  id: string;
  api: {
    close: () => void;
    setActive: () => void;
  };
  group: {
    id: string;
    api: { setSize: (size: { width?: number; height?: number }) => void };
    panels: PanelStub[];
  };
};

const dockPanels = new Map<string, PanelStub>();
const addPanelFailures = new Map<string, Error>();
const activatedPanels: string[] = [];
let lastDockApi: ReturnType<typeof createDockApi> | null = null;

function createPanel(id: string): PanelStub {
  const panel = {
    id,
    api: {
      close: vi.fn(),
      setActive: vi.fn(() => {
        activatedPanels.push(id);
      }),
    },
    group: {
      id: `${id}-group`,
      api: { setSize: vi.fn() },
      panels: [] as PanelStub[],
    },
  };
  panel.group.panels.push(panel);
  return panel;
}

function createDockApi() {
  const dockApi = {
    addPanel: vi.fn((options: {
      id: string;
      component?: string;
      position?: { referencePanel?: PanelStub; direction?: string };
    }) => {
      const failure = addPanelFailures.get(options.id);
      if (failure) throw failure;
      const panel = createPanel(options.id);
      dockPanels.set(options.id, panel);
      return panel;
    }),
    getPanel: vi.fn((id: string) => dockPanels.get(id)),
    getGroup: vi.fn((id: string) => {
      for (const panel of dockPanels.values()) {
        if (panel.group.id === id) return panel.group;
      }
      return undefined;
    }),
    toJSON: vi.fn(() => ({
      grid: {},
      panels: Object.fromEntries(Array.from(dockPanels.keys()).map((id) => [id, {}])),
    })),
    fromJSON: vi.fn(),
    onDidLayoutChange: vi.fn(),
    addPopoutGroup: vi.fn(),
    activeGroup: undefined,
  };
  lastDockApi = dockApi;
  return dockApi;
}

vi.mock('dockview-vue', () => ({
  DockviewVue: defineComponent({
    name: 'DockviewVueStub',
    emits: ['ready'],
    setup(_, { emit, attrs }) {
      onMounted(() => {
        emit('ready', { api: createDockApi() });
      });
      return () => h('div', { class: attrs.class });
    },
  }),
  themeLight: {},
}));

vi.mock('@/api/reviewApi', () => ({
  authVerifyToken: (...args: unknown[]) => authVerifyTokenMock(...args),
  clearAuthToken: (...args: unknown[]) => clearAuthTokenMock(...args),
  setAuthToken: (...args: unknown[]) => setAuthTokenMock(...args),
}));

vi.mock('@/components/review/embedContextRestore', () => ({
  restoreEmbedWorkbenchContext: (...args: unknown[]) => restoreEmbedWorkbenchContextMock(...args),
}));

vi.mock('@/components/review/embedFormSnapshotRestore', () => ({
  restoreEmbedFormSnapshotContext: (...args: unknown[]) => restoreEmbedFormSnapshotContextMock(...args),
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: vi.fn(),
  setDockApi: (...args: unknown[]) => setDockApiMock(...args),
  notifyDockLayoutChange: (...args: unknown[]) => notifyDockLayoutChangeMock(...args),
}));

vi.mock('@/composables/useModelProjects', () => ({
  useModelProjects: () => ({
    switchProjectById: switchProjectByIdMock,
  }),
}));

vi.mock('@/composables/usePanelZones', () => ({
  initPanelZones: vi.fn(),
  disposePanelZones: vi.fn(),
  toggleZone: vi.fn(),
  onPanelOpened: vi.fn(),
  resetZoneState: vi.fn(),
}));

const currentTaskRef = ref<ReviewTask | null>(null);
const pendingReviewTasksRef = ref<ReviewTask[]>([]);
const myInitiatedTasksRef = ref<ReviewTask[]>([]);
const returnedInitiatedTasksRef = ref<ReviewTask[]>([]);
const reviewTasksRef = ref<ReviewTask[]>([]);

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    // 注：DockLayout.vue 的 isExternalSjReturnedFormFocused 读 reviewStore.currentTask.value，
    // mock 必须暴露 currentTask ref，否则触发 TypeError: Cannot read properties of undefined (reading 'value')。
    currentTask: currentTaskRef,
    setCurrentTask: (...args: unknown[]) => setCurrentTaskMock(...args),
    addConfirmedRecord: vi.fn(),
    clearConfirmedRecords: vi.fn(),
    exportReviewData: vi.fn(() => '{}'),
  }),
}));

vi.mock('@/composables/useSelectionStore', () => ({
  setGlobalSelectedRefno: (...args: unknown[]) => setGlobalSelectedRefnoMock(...args),
}));

vi.mock('@/composables/useTaskCreationStore', () => ({
  useTaskCreationStore: () => ({
    setPresetType: vi.fn(),
  }),
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    importJSON: (...args: unknown[]) => importJsonMock(...args),
    tools: ref({ syncFromStore: (...args: unknown[]) => syncFromStoreMock(...args) }),
    annotationCount: ref(0),
    cloudAnnotationCount: ref(0),
    rectAnnotationCount: ref(0),
    obbAnnotationCount: ref(0),
    measurementCount: ref(0),
    annotations: ref([]),
    cloudAnnotations: ref([]),
    rectAnnotations: ref([]),
    obbAnnotations: ref([]),
    measurements: ref([]),
    clearAll: vi.fn(),
  }),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    initialize: (...args: unknown[]) => initializeMock(...args),
    setEmbedUser: (...args: unknown[]) => setEmbedUserMock(...args),
    loadReviewTasks: (...args: unknown[]) => loadReviewTasksMock(...args),
    clearCurrentUserSelection: (...args: unknown[]) => clearCurrentUserSelectionMock(...args),
    pendingReviewTasks: pendingReviewTasksRef,
    myInitiatedTasks: myInitiatedTasksRef,
    returnedInitiatedTasks: returnedInitiatedTasksRef,
    reviewTasks: reviewTasksRef,
    currentUser: ref({ id: 'local-user', role: 'designer' }),
    currentUserId: ref('local-user'),
  }),
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    tools: ref({ syncFromStore: (...args: unknown[]) => syncFromStoreMock(...args) }),
  }),
  showModelByRefnosWithAck: (...args: unknown[]) => showModelByRefnosWithAckMock(...args),
  waitForViewerReady: (...args: unknown[]) => waitForViewerReadyMock(...args),
}));

vi.mock('@/ribbon/commandBus', () => ({
  onCommand: (...args: unknown[]) => onCommandMock(...args),
}));

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: 'task-claims-1',
    formId: 'FORM-CLAIMS-1',
    title: '审核任务',
    description: 'desc',
    modelName: 'Hull',
    status: 'submitted',
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
    workflowHistory: [],
    ...overrides,
  };
}

async function flushAsyncWork() {
  await vi.dynamicImportSettled();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

async function mountDockLayout() {
  const { default: DockLayout } = await import('./DockLayout.vue');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(DockLayout),
  });
  app.mount(host);
  await flushAsyncWork();
  return {
    host,
    app,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('DockLayout embed bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    dockPanels.clear();
    addPanelFailures.clear();
    activatedPanels.length = 0;
    lastDockApi = null;
    document.body.innerHTML = '';
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorageMock(),
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: createStorageMock(),
      configurable: true,
    });
    authVerifyTokenMock.mockReset();
    clearAuthTokenMock.mockReset();
    setAuthTokenMock.mockReset();
    restoreEmbedWorkbenchContextMock.mockReset();
    restoreEmbedFormSnapshotContextMock.mockReset();
    switchProjectByIdMock.mockReset();
    setCurrentTaskMock.mockReset();
    importJsonMock.mockReset();
    syncFromStoreMock.mockReset();
    initializeMock.mockReset();
    setEmbedUserMock.mockReset();
    loadReviewTasksMock.mockReset();
    clearCurrentUserSelectionMock.mockReset();
    setDockApiMock.mockReset();
    notifyDockLayoutChangeMock.mockReset();
    setGlobalSelectedRefnoMock.mockReset();
    waitForViewerReadyMock.mockReset();
    showModelByRefnosWithAckMock.mockReset();
    onCommandMock.mockReset();

    pendingReviewTasksRef.value = [createTask()];
    myInitiatedTasksRef.value = [];
    returnedInitiatedTasksRef.value = [];
    reviewTasksRef.value = [createTask()];

    switchProjectByIdMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
    loadReviewTasksMock.mockResolvedValue(undefined);
    restoreEmbedWorkbenchContextMock.mockResolvedValue({
      target: 'reviewer',
      restoreStatus: 'matched',
      restoredTaskId: 'task-claims-1',
      restoredTaskSummary: null,
      restoredTaskDraft: null,
      restoredTask: createTask(),
    });
    restoreEmbedFormSnapshotContextMock.mockResolvedValue({
      modelRefnos: [],
      recordCount: 0,
      attachmentCount: 0,
      attachments: [],
      task: createTask(),
    });
    waitForViewerReadyMock.mockResolvedValue(true);
    showModelByRefnosWithAckMock.mockResolvedValue({ ok: [], fail: [], error: null });
    onCommandMock.mockReturnValue(() => undefined);
    window.history.replaceState({}, '', '/');
  });

  it('在 token-only 模式下按 verified claims 初始化 reviewer 上下文并忽略冲突 query', async () => {
    window.history.replaceState(
      {},
      '',
      '/?user_token=jwt-reviewer&project_id=WRONG-PROJECT&form_id=WRONG-FORM&user_id=WRONG-USER&user_role=sj&workflow_mode=external',
    );

    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: true,
        claims: {
          projectId: 'PROJECT-CLAIMS',
          userId: 'checker-1',
          formId: 'FORM-CLAIMS-1',
          role: 'jd',
          workflowMode: 'manual',
          exp: 1999999999,
          iat: 1700000000,
        },
      },
    });

    const mounted = await mountDockLayout();

    expect(setAuthTokenMock).toHaveBeenCalledWith('jwt-reviewer');
    expect(authVerifyTokenMock).toHaveBeenCalledWith('jwt-reviewer');
    expect(setEmbedUserMock).toHaveBeenCalledWith('checker-1', 'jd', { verified: true });
    expect(switchProjectByIdMock).toHaveBeenCalledWith('PROJECT-CLAIMS');
    expect(restoreEmbedWorkbenchContextMock).toHaveBeenCalledWith(expect.objectContaining({
      target: 'reviewer',
      formId: 'FORM-CLAIMS-1',
      passiveWorkflowMode: true,
    }));

    const persisted = JSON.parse(sessionStorage.getItem('embed_mode_params') || '{}');
    expect(persisted.projectId).toBe('PROJECT-CLAIMS');
    expect(persisted.formId).toBe('FORM-CLAIMS-1');
    expect(persisted.userId).toBe('checker-1');
    expect(persisted.workflowRole).toBe('jd');
    expect(persisted.workflowMode).toBe('manual');
    expect(persisted.verifiedClaims).toEqual(expect.objectContaining({
      projectId: 'PROJECT-CLAIMS',
      formId: 'FORM-CLAIMS-1',
      userId: 'checker-1',
      role: 'jd',
      workflowMode: 'manual',
    }));

    mounted.unmount();
  });

  it('SJ 外部 form_id 被动恢复时只打开校审面板并使用 returnedInitiatedTasks 匹配任务', async () => {
    const returnedTask = createTask({
      id: 'task-returned-1',
      formId: 'FORM-RETURNED-1',
      status: 'draft',
      currentNode: 'sj',
    });
    returnedInitiatedTasksRef.value = [returnedTask];
    reviewTasksRef.value = [createTask({
      id: 'task-reviewing-1',
      formId: 'FORM-RETURNED-1',
      status: 'submitted',
      currentNode: 'jd',
    })];
    restoreEmbedWorkbenchContextMock.mockResolvedValue({
      target: 'reviewer',
      restoreStatus: 'matched',
      restoredTaskId: returnedTask.id,
      restoredTaskSummary: {
        title: returnedTask.title,
        status: returnedTask.status,
        currentNode: returnedTask.currentNode,
      },
      restoredTaskDraft: null,
      restoredTask: returnedTask,
    });

    window.history.replaceState({}, '', '/?user_token=jwt-designer&workflow_mode=external&form_id=FORM-RETURNED-1');
    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: true,
        claims: {
          projectId: 'PROJECT-CLAIMS',
          userId: 'designer-1',
          formId: 'FORM-RETURNED-1',
          role: 'sj',
          workflowMode: 'external',
          exp: 1999999999,
          iat: 1700000000,
        },
      },
    });

    const mounted = await mountDockLayout();

    expect(restoreEmbedWorkbenchContextMock).toHaveBeenCalledWith(expect.objectContaining({
      target: 'reviewer',
      formId: 'FORM-RETURNED-1',
      passiveWorkflowMode: true,
    }));
    const restoreArgs = restoreEmbedWorkbenchContextMock.mock.calls.at(-1)?.[0] as {
      reviewerTasks: () => ReviewTask[];
    };
    expect(restoreArgs.reviewerTasks()).toEqual([returnedTask]);
    expect(JSON.parse(sessionStorage.getItem('embed_landing_state') || '{}')).toMatchObject({
      target: 'reviewer',
      formId: 'FORM-RETURNED-1',
      primaryPanelId: 'review',
      visiblePanelIds: ['review'],
    });

    mounted.unmount();
  });

  it('SJ 外部 form_id 被动恢复未匹配内部任务但 workflow/sync 有批注记录时，仍统一落到 review 面板，不再单独开 DCH', async () => {
    // 2026-05-18 产品策略更新：SJ 经 PMS 外部流程打开带 form_id 单据时，
    // 所有批注处理统一在 review 面板内完成，不再单独开「批注处理」（DCH）面板。
    // 详见 .plannotator/plan-sj-reject-ui.md §2 / §5 与
    // 开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md §13。
    returnedInitiatedTasksRef.value = [];
    reviewTasksRef.value = [];
    restoreEmbedWorkbenchContextMock.mockResolvedValue({
      target: 'reviewer',
      restoreStatus: 'missing',
      restoredTaskId: null,
      restoredTaskSummary: null,
      restoredTaskDraft: null,
      restoredTask: null,
    });
    restoreEmbedFormSnapshotContextMock.mockResolvedValue({
      modelRefnos: ['24381_141703'],
      recordCount: 2,
      attachmentCount: 0,
      attachments: [],
      task: null,
    });

    window.history.replaceState({}, '', '/?user_token=jwt-designer&workflow_mode=external&form_id=FORM-FB4EF9F13DF1');
    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: true,
        claims: {
          projectId: 'PROJECT-CLAIMS',
          userId: 'U020',
          formId: 'FORM-FB4EF9F13DF1',
          role: 'sj',
          workflowMode: 'external',
          exp: 1999999999,
          iat: 1700000000,
        },
      },
    });

    const mounted = await mountDockLayout();

    expect(restoreEmbedWorkbenchContextMock).toHaveBeenCalledWith(expect.objectContaining({
      target: 'reviewer',
      formId: 'FORM-FB4EF9F13DF1',
      passiveWorkflowMode: true,
    }));
    expect(dockPanels.has('designerCommentHandling')).toBe(false);
    expect(activatedPanels).not.toContain('designerCommentHandling');
    expect(JSON.parse(sessionStorage.getItem('embed_landing_state') || '{}')).toMatchObject({
      target: 'reviewer',
      formId: 'FORM-FB4EF9F13DF1',
      primaryPanelId: 'review',
      visiblePanelIds: ['review'],
    });

    mounted.unmount();
  });

  it('嵌入模式忽略普通布局缓存并重建 reviewer 精简布局', async () => {
    localStorage.setItem('plant3d-web-dock-layout-v3', JSON.stringify({
      grid: {},
      panels: {
        viewer: {},
        console: {},
        mbdPipe: {},
        initiateReview: {},
        reviewerTasks: {},
      },
    }));
    window.history.replaceState({}, '', '/?user_token=jwt-reviewer');

    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: true,
        claims: {
          projectId: 'PROJECT-CLAIMS',
          userId: 'checker-1',
          formId: 'FORM-CLAIMS-1',
          role: 'jd',
          workflowMode: 'manual',
          exp: 1999999999,
          iat: 1700000000,
        },
      },
    });

    const mounted = await mountDockLayout();

    expect(lastDockApi?.fromJSON).not.toHaveBeenCalled();
    expect(Array.from(dockPanels.keys())).toEqual(expect.arrayContaining([
      'viewer',
      'modelTree',
    ]));
    expect(dockPanels.has('console')).toBe(false);
    expect(dockPanels.has('mbdPipe')).toBe(false);
    expect(dockPanels.has('reviewerTasks')).toBe(false);
    expect(dockPanels.has('measurement')).toBe(false);
    expect(dockPanels.has('initiateReview')).toBe(false);

    mounted.unmount();
  });

  it('嵌入模式下主面板遇到无效 grid 不阻断基础布局', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    addPanelFailures.set('initiateReview', new Error('Invalid grid element'));
    window.history.replaceState({}, '', '/?user_token=jwt-designer&workflow_mode=external');
    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: true,
        claims: {
          projectId: 'PROJECT-CLAIMS',
          userId: 'designer-1',
          formId: 'FORM-CLAIMS-1',
          role: 'sj',
          workflowMode: 'external',
          exp: 1999999999,
          iat: 1700000000,
        },
      },
    });

    const mounted = await mountDockLayout();

    expect(lastDockApi?.fromJSON).not.toHaveBeenCalled();
    expect(Array.from(dockPanels.keys())).toEqual(expect.arrayContaining([
      'viewer',
      'modelTree',
    ]));
    expect(dockPanels.has('initiateReview')).toBe(false);
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Failed to open panel'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Failed to create panel'));

    errorSpy.mockRestore();
    mounted.unmount();
  });

  it('默认布局不创建尺寸面板', async () => {
    const mounted = await mountDockLayout();

    expect(dockPanels.has('dimension')).toBe(false);
    expect(lastDockApi?.addPanel).not.toHaveBeenCalledWith(expect.objectContaining({
      component: 'DimensionPanel',
    }));

    mounted.unmount();
  });

  it('非嵌入模式仍优先恢复普通布局缓存', async () => {
    const savedLayout = {
      grid: {},
      panels: {
        viewer: {},
        console: {},
        measurement: {},
      },
    };
    localStorage.setItem('plant3d-web-dock-layout-v3', JSON.stringify(savedLayout));

    const mounted = await mountDockLayout();

    expect(lastDockApi?.fromJSON).toHaveBeenCalledWith(savedLayout);

    mounted.unmount();
  });

  it('按需在三维查看器右侧创建单例文档预览面板', async () => {
    const mounted = await mountDockLayout();
    expect(ribbonCommandHandler).toBeTypeOf('function');

    ribbonCommandHandler?.('panel.reviewAttachmentPreview');

    const previewCalls = lastDockApi?.addPanel.mock.calls
      .map(([options]) => options)
      .filter((options) => options.id === 'reviewAttachmentPreview') ?? [];
    expect(previewCalls).toHaveLength(1);
    expect(previewCalls[0]).toEqual(expect.objectContaining({
      component: 'ReviewAttachmentPreviewPanel',
      position: expect.objectContaining({
        referencePanel: expect.objectContaining({ id: 'viewer' }),
        direction: 'right',
      }),
    }));

    ribbonCommandHandler?.('panel.reviewAttachmentPreview');
    const repeatedCalls = lastDockApi?.addPanel.mock.calls
      .map(([options]) => options)
      .filter((options) => options.id === 'reviewAttachmentPreview') ?? [];
    expect(repeatedCalls).toHaveLength(1);
    expect(activatedPanels).toContain('reviewAttachmentPreview');

    mounted.unmount();
  });

  it('token 校验失败时进入错误态并清理 embed 持久化', async () => {
    sessionStorage.setItem('embed_mode_params', JSON.stringify({ formId: 'LEGACY-FORM' }));
    sessionStorage.setItem('embed_landing_state', JSON.stringify({ target: 'reviewer' }));
    window.history.replaceState({}, '', '/?user_token=expired-token');

    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: false,
        error: 'ExpiredSignature',
      },
    });

    const mounted = await mountDockLayout();

    expect(clearAuthTokenMock).toHaveBeenCalledTimes(1);
    expect(clearCurrentUserSelectionMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('embed_mode_params')).toBeNull();
    expect(sessionStorage.getItem('embed_landing_state')).toBeNull();
    expect(mounted.host.textContent).toContain('嵌入链接校验失败');
    expect(mounted.host.textContent).toContain('ExpiredSignature');

    mounted.unmount();
  });
});
