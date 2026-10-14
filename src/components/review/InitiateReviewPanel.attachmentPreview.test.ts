import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import {
  EMBED_LANDING_STATE_STORAGE_KEY,
  EMBED_MODE_PARAMS_STORAGE_KEY,
  type EmbedLandingState,
  type EmbedModeParams,
} from './embedRoleLanding';
import InitiateReviewPanel from './InitiateReviewPanel.vue';

const uploadedDocx = {
  id: 'local-1',
  name: 'workflow-verify-api.docx',
  size: 2048,
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  status: 'success',
  progress: 100,
  serverAttachmentId: 'att-docx',
  serverUrl: '/files/review_attachments/att-docx.docx',
  uploadedAt: 1700000000000,
};

const mocks = vi.hoisted(() => ({
  openReviewAttachmentPreview: vi.fn(() => true),
  emitToast: vi.fn(),
  ensurePanelAndActivate: vi.fn(),
  showModelByRefnosWithAck: vi.fn(async () => ({ ok: [], fail: [], error: null })),
}));

vi.mock('@/composables/useReviewAttachmentPreview', () => ({
  openReviewAttachmentPreview: mocks.openReviewAttachmentPreview,
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: (...args: unknown[]) => mocks.emitToast(...args),
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    kind: 'gen-model-v1',
    attributes: {
      typeInfo: vi.fn(),
      uiAttr: vi.fn(),
    },
    tree: {
      ancestors: vi.fn(),
      subtreeRefnos: vi.fn(),
      search: vi.fn(),
    },
  }),
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: { value: null },
    propertiesData: { value: null },
    setSelectedRefno: vi.fn(),
  }),
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: mocks.ensurePanelAndActivate,
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    viewerRef: { value: null },
    tools: { value: { syncFromStore: vi.fn() } },
  }),
  waitForViewerReady: vi.fn(async () => true),
  showModelByRefnosWithAck: mocks.showModelByRefnosWithAck,
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: { value: { id: 'SJ', name: 'SJ' } },
    currentUserId: { value: 'SJ' },
    availableCheckers: { value: [] },
    availableApprovers: { value: [] },
    availableReviewers: { value: [] },
    createReviewTask: vi.fn(),
    updateTaskAttachments: vi.fn(),
    submitTaskToNextNode: vi.fn(),
  }),
}));

vi.mock('./AssociatedFilesList.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./ExternalReviewViewer.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./FileUploadSection.vue', () => ({
  default: {
    props: ['previewable'],
    emits: ['preview'],
    methods: {
      emitPreview(this: { $emit: (event: string, payload: unknown) => void }) {
        this.$emit('preview', {
          id: 'local-1',
          name: 'workflow-verify-api.docx',
          size: 2048,
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          status: 'success',
          progress: 100,
          serverAttachmentId: 'att-docx',
          serverUrl: '/files/review_attachments/att-docx.docx',
          uploadedAt: 1700000000000,
        });
      },
    },
    template: '<button v-if="previewable" type="button" data-testid="stub-upload-preview" @click="emitPreview">查看</button>',
  },
}));
vi.mock('@/components/ui/Button.vue', () => ({
  default: {
    emits: ['click'],
    template: '<button @click="$emit(\'click\', $event)"><slot /></button>',
  },
}));
vi.mock('@/components/ui/Card.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/components/ui/Input.vue', () => ({
  default: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}));

const embedParams: EmbedModeParams = {
  formId: 'FORM-PREVIEW-1',
  userToken: 'token',
  userId: 'SJ',
  workflowRole: 'sj',
  projectId: 'P-1',
  workflowMode: 'external',
  externalWorkflowMode: true,
  isEmbedMode: true,
};

function landingState(taskId: string | null): EmbedLandingState {
  return {
    target: 'designer',
    formId: 'FORM-PREVIEW-1',
    primaryPanelId: 'initiateReview',
    visiblePanelIds: ['initiateReview'],
    restoreStatus: taskId ? 'matched' : 'missing',
    restoredTaskId: taskId,
    restoredTaskSummary: null,
    restoredTaskDraft: taskId
      ? {
        title: '包A',
        description: '',
        checkerId: 'JH',
        approverId: 'SH',
        priority: 'medium',
        dueDate: '',
        components: [],
        draftComponents: [],
        attachments: [],
        taskId,
        formId: 'FORM-PREVIEW-1',
      }
      : null,
  };
}

function installStorage(taskId: string | null) {
  const entries: Record<string, string> = {
    plant3d_workflow_mode: 'external',
    [EMBED_MODE_PARAMS_STORAGE_KEY]: JSON.stringify(embedParams),
    [EMBED_LANDING_STATE_STORAGE_KEY]: JSON.stringify(landingState(taskId)),
  };
  const store = new Map(Object.entries(entries));
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: storage, configurable: true });
}

async function flushUi() {
  await vi.dynamicImportSettled();
  await nextTick();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

let app: ReturnType<typeof createApp> | null = null;
let host: HTMLDivElement | null = null;

async function mountPanel() {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = createApp({ render: () => h(InitiateReviewPanel) });
  app.mount(host);
  await flushUi();
}

describe('InitiateReviewPanel 已上传附件预览', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    mocks.openReviewAttachmentPreview.mockReset();
    mocks.openReviewAttachmentPreview.mockReturnValue(true);
    mocks.emitToast.mockReset();
  });

  afterEach(() => {
    app?.unmount();
    host?.remove();
    app = null;
    host = null;
  });

  it('没有任务号时，查看把单据号传进预览', async () => {
    installStorage(null);
    await mountPanel();

    const button = document.querySelector('[data-testid="stub-upload-preview"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
    await nextTick();

    expect(mocks.openReviewAttachmentPreview).toHaveBeenCalledWith('FORM-PREVIEW-1', expect.objectContaining({
      id: uploadedDocx.serverAttachmentId,
      name: uploadedDocx.name,
      url: uploadedDocx.serverUrl,
      size: uploadedDocx.size,
      mimeType: uploadedDocx.type,
      uploadedAt: uploadedDocx.uploadedAt,
    }));
    expect(mocks.emitToast).not.toHaveBeenCalled();
  });

  it('已有任务号时，查看优先用任务号', async () => {
    installStorage('task-preview-1');
    await mountPanel();

    (document.querySelector('[data-testid="stub-upload-preview"]') as HTMLButtonElement).click();
    await nextTick();

    expect(mocks.openReviewAttachmentPreview).toHaveBeenCalledWith(
      'task-preview-1',
      expect.objectContaining({ id: 'att-docx', url: uploadedDocx.serverUrl }),
    );
  });

  it('预览打不开时提示附件地址无效', async () => {
    installStorage(null);
    mocks.openReviewAttachmentPreview.mockReturnValue(false);
    await mountPanel();

    (document.querySelector('[data-testid="stub-upload-preview"]') as HTMLButtonElement).click();
    await nextTick();

    expect(mocks.emitToast).toHaveBeenCalledWith({
      message: '附件地址无效，无法预览',
      level: 'warning',
    });
  });
});
