import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import {
  EMBED_LANDING_STATE_STORAGE_KEY,
  EMBED_MODE_PARAMS_STORAGE_KEY,
  type EmbedLandingState,
  type EmbedModeParams,
} from './embedRoleLanding';
import InitiateReviewPanel from './InitiateReviewPanel.vue';

// 外部流程模式 + 落点恢复出「已保存的单据」（restoredTaskDraft.taskId 存在）时，面板要说清楚这是在改
// 已保存的编校审单：标题 / 提示 / 按钮文案都换（gen-model 修复计划 2026-09-28 T5-1）。
// 后端对同 form_id 的保存是 UPDATE（sj 节点）或 409（已送审），前端零契约改动，只改文案。

const mocks = vi.hoisted(() => ({
  pdmsGetTypeInfo: vi.fn(),
  pdmsGetUiAttr: vi.fn(),
  e3dGetAncestors: vi.fn(),
  e3dGetSubtreeRefnos: vi.fn(),
  e3dSearch: vi.fn(),
  ensurePanelAndActivate: vi.fn(),
  showModelByRefnosWithAck: vi.fn(async () => ({ ok: [], fail: [], error: null })),
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    kind: 'gen-model-v1',
    attributes: {
      typeInfo: (refno: string) => mocks.pdmsGetTypeInfo(refno),
      uiAttr: (refno: string) => mocks.pdmsGetUiAttr(refno),
    },
    tree: {
      ancestors: (refno: string) => mocks.e3dGetAncestors(refno),
      subtreeRefnos: (refno: string, params?: unknown) => mocks.e3dGetSubtreeRefnos(refno, params),
      search: (req: unknown) => mocks.e3dSearch(req),
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

const userStoreMock = {
  currentUser: { value: { id: 'SJ', name: 'SJ' } },
  currentUserId: { value: 'SJ' },
  availableCheckers: { value: [] as { id: string; name: string }[] },
  availableApprovers: { value: [] as { id: string; name: string }[] },
  availableReviewers: { value: [] as { id: string; name: string }[] },
  createReviewTask: vi.fn(),
  updateTaskAttachments: vi.fn(),
  submitTaskToNextNode: vi.fn(),
};

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => userStoreMock,
}));

vi.mock('./AssociatedFilesList.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./ExternalReviewViewer.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./FileUploadSection.vue', () => ({ default: { template: '<div />' } }));
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
    template: '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}));

function installStorage(entries: Record<string, string>) {
  const store = new Map(Object.entries(entries));
  const storage = {
    getItem: vi.fn((key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: storage, configurable: true });
}

const embedParams: EmbedModeParams = {
  formId: 'FORM-RESAVE-UI',
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
    formId: 'FORM-RESAVE-UI',
    primaryPanelId: 'initiateReview',
    visiblePanelIds: ['initiateReview'],
    restoreStatus: taskId ? 'restored' : 'missing',
    restoredTaskId: taskId,
    restoredTaskSummary: taskId
      ? { title: '包A', status: 'draft', currentNode: 'sj' }
      : null,
    restoredTaskDraft: taskId
      ? {
        title: '包A',
        description: '第一次保存',
        checkerId: 'JH',
        approverId: 'SH',
        priority: 'medium',
        dueDate: '',
        components: [],
        draftComponents: [{ id: 'c1', name: 'Comp', refNo: '24381_1', type: 'BRAN' }],
        attachments: [],
        taskId,
        formId: 'FORM-RESAVE-UI',
      }
      : null,
  } as EmbedLandingState;
}

async function flushUi() {
  await vi.dynamicImportSettled();
  await nextTick();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createApp({ render: () => h(InitiateReviewPanel) }).mount(host);
  await flushUi();
  return host;
}

function textOf(selector: string): string | null {
  return document.querySelector(selector)?.textContent?.trim() ?? null;
}

describe('InitiateReviewPanel 二次保存文案（外部流程 + 已保存单据）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    userStoreMock.createReviewTask.mockReset();
  });

  it('恢复出已保存的 task 时：标题「修改已保存的编校审单」、提示带 task id、按钮「保存修改」', async () => {
    installStorage({
      plant3d_workflow_mode: 'external',
      [EMBED_MODE_PARAMS_STORAGE_KEY]: JSON.stringify(embedParams),
      [EMBED_LANDING_STATE_STORAGE_KEY]: JSON.stringify(landingState('task-resave-ui-1')),
    });

    await mountPanel();

    expect(textOf('[data-testid="initiate-review-panel-title"]')).toBe('修改已保存的编校审单');
    const hint = textOf('[data-testid="initiate-review-editing-saved-task"]');
    expect(hint).toContain('正在修改已保存的编校审单');
    expect(hint).toContain('task-resave-ui-1');
    const submit = document.querySelector('[data-guide="submit-btn"]');
    expect(submit?.textContent).toContain('保存修改');
    expect(submit?.textContent).not.toContain('保存编校审单数据');
    // 草稿构件已回填到已选列表
    expect(document.body.textContent).toContain('24381_1');
  });

  it('未恢复出 task（首次建单）时：仍是「发起编校审单」+「保存编校审单数据」，不显示修改提示', async () => {
    installStorage({
      plant3d_workflow_mode: 'external',
      [EMBED_MODE_PARAMS_STORAGE_KEY]: JSON.stringify(embedParams),
      [EMBED_LANDING_STATE_STORAGE_KEY]: JSON.stringify(landingState(null)),
    });

    await mountPanel();

    expect(textOf('[data-testid="initiate-review-panel-title"]')).toBe('发起编校审单');
    expect(document.querySelector('[data-testid="initiate-review-editing-saved-task"]')).toBeNull();
    expect(document.querySelector('[data-guide="submit-btn"]')?.textContent).toContain('保存编校审单数据');
  });

  it('后端 409（单据已送审）的原文进 notification.details，不被「编校审单保存失败」盖掉', async () => {
    installStorage({
      plant3d_workflow_mode: 'external',
      [EMBED_MODE_PARAMS_STORAGE_KEY]: JSON.stringify(embedParams),
      [EMBED_LANDING_STATE_STORAGE_KEY]: JSON.stringify(landingState('task-resave-ui-2')),
    });
    const backendMessage = '单据已送审（当前节点 jd · 校对），不可修改；如需修改请由 PMS 驳回到编制节点';
    userStoreMock.createReviewTask.mockRejectedValue(new Error(backendMessage));

    await mountPanel();
    (document.querySelector('[data-testid="initiate-submit-trigger"]') as HTMLButtonElement).click();
    await flushUi();

    expect(userStoreMock.createReviewTask).toHaveBeenCalledTimes(1);
    expect(userStoreMock.createReviewTask.mock.calls[0]?.[0]).toMatchObject({
      formId: 'FORM-RESAVE-UI',
      title: '包A',
    });
    const text = document.body.textContent || '';
    expect(text).toContain('编校审单保存失败');
    expect(text).toContain(backendMessage);
  });
});
