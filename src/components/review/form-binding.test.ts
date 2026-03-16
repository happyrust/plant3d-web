import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

const createTaskMock = vi.fn();
const updateTaskAttachmentsMock = vi.fn();

vi.mock('@/api/genModelPdmsAttrApi', () => ({
  pdmsGetUiAttr: vi.fn(async (refno: string) => ({
    full_name: `Hull/${refno}`,
    attrs: {
      NAME: `Component ${refno}`,
      NOUN: '管道',
    },
  })),
}));

vi.mock('@/components/review/AssociatedFilesList.vue', () => ({
  default: {
    name: 'AssociatedFilesListStub',
    template: '<div data-testid="associated-files-list-stub" />',
  },
}));

vi.mock('@/components/review/ExternalReviewViewer.vue', () => ({
  default: {
    name: 'ExternalReviewViewerStub',
    props: ['modelValue', 'projectId'],
    template: '<div data-testid="external-review-viewer-stub" />',
  },
}));

vi.mock('@/components/review/FileUploadSection.vue', () => ({
  default: {
    name: 'FileUploadSectionStub',
    props: ['modelValue'],
    emits: ['update:modelValue', 'upload-complete'],
    template: '<div data-testid="file-upload-section-stub" />',
  },
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: { value: 'REF-001' },
    propertiesData: { value: { NAME: 'Fallback component', NOUN: '构件' } },
  }),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    availableCheckers: {
      value: [
        { id: 'checker-1', name: '张校对员', role: 'proofreader' },
      ],
    },
    availableApprovers: {
      value: [
        { id: 'approver-1', name: '李审核员', role: 'reviewer' },
      ],
    },
    availableReviewers: {
      value: [
        { id: 'checker-1', name: '张校对员', role: 'proofreader' },
        { id: 'approver-1', name: '李审核员', role: 'reviewer' },
      ],
    },
    createReviewTask: createTaskMock,
    updateTaskAttachments: updateTaskAttachmentsMock,
  }),
}));

describe('InitiateReviewPanel form binding', () => {
  beforeEach(() => {
    createTaskMock.mockReset();
    updateTaskAttachmentsMock.mockReset();
    createTaskMock.mockResolvedValue({
      id: 'task-1',
      formId: 'FORM-1',
      title: '综合校审数据包',
    });
    sessionStorage.clear();
  });

  it('binds all fields and submits collected reactive form data', async () => {
    const { default: InitiateReviewPanel } = await import('./InitiateReviewPanel.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      render: () => h(InitiateReviewPanel),
    });
    app.mount(host);

    const click = (selector: string) => {
      const element = host.querySelector(selector) as HTMLButtonElement | null;
      expect(element).not.toBeNull();
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    click('button[title="将选中的构件添加到列表"]');
    await nextTick();
    await nextTick();

    const textInput = host.querySelector('input[placeholder="输入提资数据包名称..."]') as HTMLInputElement | null;
    expect(textInput).not.toBeNull();
    textInput!.value = '综合校审数据包';
    textInput!.dispatchEvent(new Event('input', { bubbles: true }));

    const descriptionInput = host.querySelector('textarea[placeholder="添加补充说明或设计注意事项..."]') as HTMLTextAreaElement | null;
    expect(descriptionInput).not.toBeNull();
    descriptionInput!.value = '需要在本周完成校审';
    descriptionInput!.dispatchEvent(new Event('input', { bubbles: true }));

    const checkerSelect = host.querySelector('[data-testid="initiate-checker-select"]') as HTMLSelectElement | null;
    expect(checkerSelect).not.toBeNull();
    checkerSelect!.value = 'checker-1';
    checkerSelect!.dispatchEvent(new Event('change', { bubbles: true }));

    const prioritySelect = host.querySelector('[data-testid="initiate-priority-select"]') as HTMLSelectElement | null;
    expect(prioritySelect).not.toBeNull();
    expect(Array.from(prioritySelect!.options).map((option) => option.textContent?.trim())).toEqual(['高', '中', '低']);
    prioritySelect!.value = 'high';
    prioritySelect!.dispatchEvent(new Event('change', { bubbles: true }));

    const approverSelect = host.querySelector('[data-testid="initiate-approver-select"]') as HTMLSelectElement | null;
    expect(approverSelect).not.toBeNull();
    approverSelect!.value = 'approver-1';
    approverSelect!.dispatchEvent(new Event('change', { bubbles: true }));

    const dueDateInput = host.querySelector('[data-testid="initiate-due-date"]') as HTMLInputElement | null;
    expect(dueDateInput).not.toBeNull();
    dueDateInput!.value = '2026-03-20';
    dueDateInput!.dispatchEvent(new Event('input', { bubbles: true }));
    dueDateInput!.dispatchEvent(new Event('change', { bubbles: true }));

    await nextTick();

    expect((host.querySelector('[data-testid="initiate-checker-value"]') as HTMLElement | null)?.textContent).toContain('张校对员');
    expect((host.querySelector('[data-testid="initiate-approver-value"]') as HTMLElement | null)?.textContent).toContain('李审核员');
    expect((host.querySelector('[data-testid="initiate-due-date-value"]') as HTMLElement | null)?.textContent).toContain('2026-03-20');

    click('[data-testid="initiate-submit-trigger"]');
    await nextTick();

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '综合校审数据包',
      description: '需要在本周完成校审',
      modelName: '综合校审数据包',
      checkerId: 'checker-1',
      approverId: 'approver-1',
      priority: 'high',
      dueDate: new Date('2026-03-20').getTime(),
      components: [
        expect.objectContaining({
          refNo: 'REF-001',
        }),
      ],
    }));

    app.unmount();
    host.remove();
  });
});
