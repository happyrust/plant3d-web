import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import InitiateReviewPanel from './InitiateReviewPanel.vue';

const mocks = vi.hoisted(() => ({
  pdmsGetTypeInfo: vi.fn(),
  pdmsGetUiAttr: vi.fn(),
  e3dGetAncestors: vi.fn(),
  e3dGetSubtreeRefnos: vi.fn(),
  ensurePanelAndActivate: vi.fn(),
  showModelByRefnosWithAck: vi.fn(async () => ({
    ok: ['24381/145018'],
    fail: [],
    error: null,
  })),
}));

vi.mock('@/api/genModelPdmsAttrApi', () => ({
  pdmsGetTypeInfo: mocks.pdmsGetTypeInfo,
  pdmsGetUiAttr: mocks.pdmsGetUiAttr,
}));

vi.mock('@/api/genModelE3dApi', () => ({
  e3dGetAncestors: mocks.e3dGetAncestors,
  e3dGetSubtreeRefnos: mocks.e3dGetSubtreeRefnos,
}));

const selectionState = {
  selectedRefno: { value: null as string | null },
  propertiesData: { value: null as Record<string, unknown> | null },
};

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    ...selectionState,
    setSelectedRefno: (refno: string | null) => {
      selectionState.selectedRefno.value = refno;
    },
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
  currentUser: { value: { id: 'designer-1', name: '王设计师' } },
  currentUserId: { value: 'designer-1' },
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
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}));

function setWindowStorage(key: string, value: string | null) {
  const storage = {
    getItem: vi.fn((currentKey: string) => (currentKey === key ? value : null)),
    setItem: vi.fn(),
    removeItem: vi.fn(),
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

async function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createApp({ render: () => h(InitiateReviewPanel) }).mount(host);
  await flushUi();
  return host;
}

function findAddButton(): HTMLButtonElement {
  const button = document.querySelector('[data-guide="add-component-btn"]') as HTMLButtonElement | null;
  expect(button).toBeTruthy();
  return button!;
}

function getComponentListText(): string {
  return document.body.textContent || '';
}

function enableAutomationReviewHook() {
  window.history.replaceState({}, '', '/?automation_review=1');
}

describe('InitiateReviewPanel 最小交付单元约束', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    selectionState.selectedRefno.value = null;
    selectionState.propertiesData.value = null;
    setWindowStorage('plant3d_workflow_mode', 'manual');
    window.history.replaceState({}, '', '/');
    mocks.pdmsGetTypeInfo.mockReset();
    mocks.pdmsGetUiAttr.mockReset();
    mocks.e3dGetAncestors.mockReset();
    mocks.e3dGetSubtreeRefnos.mockReset();
    mocks.ensurePanelAndActivate.mockReset();
    mocks.showModelByRefnosWithAck.mockClear();
    userStoreMock.createReviewTask.mockReset();
    userStoreMock.updateTaskAttachments.mockReset();
    userStoreMock.submitTaskToNextNode.mockReset();
  });

  it('直接选中最小交付单元时按原 refno 加入', async () => {
    selectionState.selectedRefno.value = '24381_145018';
    mocks.pdmsGetTypeInfo.mockResolvedValue({
      success: true,
      refno: '24381_145018',
      noun: 'BRAN',
      owner_noun: 'PIPE',
      owner_refno: null,
    });
    mocks.pdmsGetUiAttr.mockResolvedValue({
      full_name: 'BRAN/24381_145018',
      attrs: { NAME: 'BRAN/24381_145018', NOUN: 'BRAN' },
    });

    await mountPanel();
    findAddButton().click();
    await flushUi();

    expect(mocks.pdmsGetUiAttr).toHaveBeenCalledWith('24381_145018');
    expect(getComponentListText()).toContain('24381_145018');
  });

  it('选中子构件时向上归并到最小交付单元', async () => {
    selectionState.selectedRefno.value = '24381_145999';
    mocks.pdmsGetTypeInfo.mockImplementation(async (refno: string) => {
      if (refno === '24381_145999') {
        return {
          success: true,
          refno,
          noun: 'ELBO',
          owner_noun: 'BRAN',
          owner_refno: '24381_145018',
        };
      }
      return {
        success: true,
        refno,
        noun: 'BRAN',
        owner_noun: 'PIPE',
        owner_refno: null,
      };
    });
    mocks.pdmsGetUiAttr.mockResolvedValue({
      full_name: 'BRAN/24381_145018',
      attrs: { NAME: 'BRAN/24381_145018', NOUN: 'BRAN' },
    });

    await mountPanel();
    findAddButton().click();
    await flushUi();

    expect(mocks.pdmsGetUiAttr).toHaveBeenCalledWith('24381_145018');
    expect(getComponentListText()).toContain('24381_145018');
    expect(getComponentListText()).not.toContain('24381_145999');
  });

  it('选中父级容器时向下找到唯一最小交付单元', async () => {
    selectionState.selectedRefno.value = '24381_140000';
    mocks.pdmsGetTypeInfo.mockImplementation(async (refno: string) => {
      if (refno === '24381_140000') {
        return {
          success: true,
          refno,
          noun: 'PIPE',
          owner_noun: 'ZONE',
          owner_refno: '24381_100000',
        };
      }
      if (refno === '24381_100000') {
        return {
          success: true,
          refno,
          noun: 'ZONE',
          owner_noun: 'SITE',
          owner_refno: null,
        };
      }
      return {
        success: true,
        refno,
        noun: refno === '24381_145018' ? 'BRAN' : 'ELBO',
        owner_noun: refno === '24381_145018' ? 'PIPE' : 'BRAN',
        owner_refno: refno === '24381_145018' ? '24381_140000' : '24381_145018',
      };
    });
    mocks.e3dGetAncestors.mockResolvedValue({
      success: true,
      refnos: ['24381_100000'],
    });
    mocks.e3dGetSubtreeRefnos.mockResolvedValue({
      success: true,
      refnos: ['24381_140000', '24381_145018', '24381_145999'],
      truncated: false,
    });
    mocks.pdmsGetUiAttr.mockResolvedValue({
      full_name: 'BRAN/24381_145018',
      attrs: { NAME: 'BRAN/24381_145018', NOUN: 'BRAN' },
    });

    await mountPanel();
    findAddButton().click();
    await flushUi();

    expect(mocks.e3dGetSubtreeRefnos).toHaveBeenCalled();
    expect(mocks.pdmsGetUiAttr).toHaveBeenCalledWith('24381_145018');
  });

  it('向下命中多个最小交付单元时阻止添加并报错', async () => {
    selectionState.selectedRefno.value = '24381_140000';
    mocks.pdmsGetTypeInfo.mockImplementation(async (refno: string) => ({
      success: true,
      refno,
      noun: refno === '24381_145018' || refno === '24381_145019' ? 'BRAN' : 'PIPE',
      owner_noun: 'ZONE',
      owner_refno: '24381_100000',
    }));
    mocks.e3dGetAncestors.mockResolvedValue({
      success: true,
      refnos: ['24381_100000'],
    });
    mocks.e3dGetSubtreeRefnos.mockResolvedValue({
      success: true,
      refnos: ['24381_145018', '24381_145019'],
      truncated: false,
    });

    await mountPanel();
    findAddButton().click();
    await flushUi();

    expect(mocks.pdmsGetUiAttr).not.toHaveBeenCalled();
    expect(getComponentListText()).toContain('添加构件失败');
    expect(getComponentListText()).toContain('跨多个最小交付单元');
  });

  it('向上向下都找不到最小交付单元时阻止添加并报错', async () => {
    selectionState.selectedRefno.value = '24381_140000';
    mocks.pdmsGetTypeInfo.mockResolvedValue({
      success: true,
      refno: '24381_140000',
      noun: 'PIPE',
      owner_noun: 'ZONE',
      owner_refno: '24381_100000',
    });
    mocks.e3dGetAncestors.mockResolvedValue({
      success: true,
      refnos: ['24381_100000'],
    });
    mocks.e3dGetSubtreeRefnos.mockResolvedValue({
      success: true,
      refnos: ['24381_140000', '24381_140001'],
      truncated: false,
    });

    await mountPanel();
    findAddButton().click();
    await flushUi();

    expect(mocks.pdmsGetUiAttr).not.toHaveBeenCalled();
    expect(getComponentListText()).toContain('添加构件失败');
    expect(getComponentListText()).toContain('无法归并到最小交付单元');
  });

  it('automation addMockComponent 也走最小交付单元归一化', async () => {
    enableAutomationReviewHook();
    mocks.pdmsGetTypeInfo.mockResolvedValue({
      success: true,
      refno: '24381_145999',
      noun: 'ELBO',
      owner_noun: 'BRAN',
      owner_refno: '24381_145018',
    });
    mocks.pdmsGetUiAttr.mockResolvedValue({
      full_name: 'BRAN/24381_145018',
      attrs: { NAME: 'BRAN/24381_145018', NOUN: 'BRAN' },
    });

    await mountPanel();
    const hook = (window as Window & {
      __plant3dInitiateReviewE2E?: { addMockComponent: (refNo?: string, name?: string) => Promise<void> };
    }).__plant3dInitiateReviewE2E;

    expect(hook).toBeTruthy();
    await hook?.addMockComponent('24381_145999');
    await flushUi();

    expect(mocks.pdmsGetUiAttr).toHaveBeenCalledWith('24381_145018');
    expect(getComponentListText()).toContain('24381_145018');
    expect(getComponentListText()).not.toContain('24381_145999');
  });

  it('点击已添加构件后会高亮并联动三维定位，再次点击会取消高亮', async () => {
    selectionState.selectedRefno.value = '24381_145018';
    mocks.pdmsGetTypeInfo.mockResolvedValue({
      success: true,
      refno: '24381_145018',
      noun: 'BRAN',
      owner_noun: 'PIPE',
      owner_refno: null,
    });
    mocks.pdmsGetUiAttr.mockResolvedValue({
      full_name: 'BRAN/24381_145018',
      attrs: { NAME: 'BRAN/24381_145018', NOUN: 'BRAN' },
    });

    await mountPanel();
    findAddButton().click();
    await flushUi();

    const componentButton = Array.from(document.body.querySelectorAll('button'))
      .find((node) => node.textContent?.includes('24381_145018')) as HTMLButtonElement | undefined;
    expect(componentButton).toBeTruthy();
    const componentRow = componentButton?.closest('div.rounded-\\[8px\\]') as HTMLDivElement | null;
    expect(componentRow).toBeTruthy();

    const autoLocateListener = vi.fn();
    window.addEventListener('autoLocateRefno', autoLocateListener as EventListener);

    componentButton?.click();
    await flushUi();

    expect(componentRow?.className).toContain('border-[#3B82F6]');
    expect(mocks.ensurePanelAndActivate).toHaveBeenCalledWith('modelTree');
    expect(mocks.showModelByRefnosWithAck).toHaveBeenCalledWith(expect.objectContaining({
      refnos: ['24381/145018'],
      flyTo: true,
    }));
    expect(autoLocateListener).toHaveBeenCalledTimes(1);

    componentButton?.click();
    await flushUi();
    window.removeEventListener('autoLocateRefno', autoLocateListener as EventListener);

    expect(componentRow?.className).not.toContain('border-[#3B82F6]');
    expect(mocks.showModelByRefnosWithAck).toHaveBeenCalledTimes(1);
  });
});
