import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

const createTaskMock = vi.fn();
const updateTaskAttachmentsMock = vi.fn();
const submitTaskToNextNodeSpy = vi.fn();
const uploadStartMock = vi.fn(async () => undefined);

async function flushAsyncWork() {
  await nextTick();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

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
    expose: ['startUpload'],
    setup() {
      return {
        startUpload: uploadStartMock,
      };
    },
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
    submitTaskToNextNode: vi.fn(async (...args: unknown[]) => {
      submitTaskToNextNodeSpy(...args);
    }),
  }),
}));

describe('InitiateReviewPanel form binding', () => {
  beforeEach(() => {
    createTaskMock.mockReset();
    updateTaskAttachmentsMock.mockReset();
    submitTaskToNextNodeSpy.mockReset();
    uploadStartMock.mockClear();
    createTaskMock.mockResolvedValue({
      id: 'task-1',
      formId: 'FORM-1',
      title: '综合校审数据包',
    });
    sessionStorage.clear();
    // 让 InitiateReviewPanel 的 resolveExternalWorkflowMode 返回 false（手动模式）
    sessionStorage.setItem('plant3d_workflow_mode', 'manual');
  });

  it('binds all fields and submits collected reactive form data', async () => {
    const { default: InitiateReviewPanel } = await import('./InitiateReviewPanel.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      render: () => h(InitiateReviewPanel),
    });
    app.mount(host);
    await nextTick();

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
    await flushAsyncWork();

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
    expect(submitTaskToNextNodeSpy).toHaveBeenCalledWith('task-1', '发起提资');

    app.unmount();
    host.remove();
  }, 10000);

  it('allows adding components in external workflow mode', async () => {
    sessionStorage.setItem('plant3d_workflow_mode', 'external');

    const { default: InitiateReviewPanel } = await import('./InitiateReviewPanel.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      render: () => h(InitiateReviewPanel),
    });
    app.mount(host);
    await nextTick();

    const addButton = host.querySelector('button[title="将选中的构件添加到列表"]') as HTMLButtonElement | null;
    expect(addButton).not.toBeNull();
    addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(host.textContent).toContain('Hull/REF-001');
    expect(host.textContent).toContain('RefNo: REF-001');

    const packageInput = host.querySelector('input[placeholder="输入提资数据包名称..."]') as HTMLInputElement | null;
    expect(packageInput).not.toBeNull();
    packageInput!.value = '外部流程提资包';
    packageInput!.dispatchEvent(new Event('input', { bubbles: true }));

    const submitTrigger = host.querySelector('[data-testid="initiate-submit-trigger"]') as HTMLButtonElement | null;
    expect(submitTrigger).not.toBeNull();
    expect(submitTrigger?.textContent).toContain('保存提资单数据');
    submitTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '外部流程提资包',
      checkerId: undefined,
      approverId: undefined,
      priority: undefined,
      components: [
        expect.objectContaining({
          refNo: 'REF-001',
        }),
      ],
    }));
    expect(submitTaskToNextNodeSpy).not.toHaveBeenCalled();
    expect(host.textContent).toContain('提资单保存成功');
    expect(host.textContent).toContain('流程提示');
    expect(host.textContent).not.toContain('新建提资单');
    expect(host.textContent).not.toContain('任务监控');
    expect(host.textContent).not.toContain('审核工作台');

    app.unmount();
    host.remove();
  }, 10000);

  it('shows success feedback, closes the panel, and emits created/close after submit succeeds', async () => {
    const { default: InitiateReviewPanel } = await import('./InitiateReviewPanel.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const createdHandler = vi.fn();
    const closeHandler = vi.fn();

    const app = createApp({
      render: () => h(InitiateReviewPanel, {
        onCreated: (...args: unknown[]) => createdHandler(...args),
        onClose: () => closeHandler(),
      }),
    });
    app.mount(host);
    await nextTick();

    const click = (selector: string) => {
      const element = host.querySelector(selector) as HTMLButtonElement | null;
      expect(element).not.toBeNull();
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    click('button[title="将选中的构件添加到列表"]');
    await nextTick();
    await nextTick();

    const packageInput = host.querySelector('input[placeholder="输入提资数据包名称..."]') as HTMLInputElement;
    packageInput.value = '成功关闭校审包';
    packageInput.dispatchEvent(new Event('input', { bubbles: true }));

    const checkerSelect = host.querySelector('[data-testid="initiate-checker-select"]') as HTMLSelectElement;
    checkerSelect.value = 'checker-1';
    checkerSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const approverSelect = host.querySelector('[data-testid="initiate-approver-select"]') as HTMLSelectElement;
    approverSelect.value = 'approver-1';
    approverSelect.dispatchEvent(new Event('change', { bubbles: true }));

    await nextTick();

    click('[data-testid="initiate-submit-trigger"]');
    await flushAsyncWork();

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(submitTaskToNextNodeSpy).toHaveBeenCalledWith('task-1', '发起提资');
    expect(closeHandler).not.toHaveBeenCalled();
    expect(createdHandler).toHaveBeenCalledWith('task-1');

    app.unmount();
    host.remove();
  }, 10000);

  it('keeps the panel rendered until the dock wrapper handles close events', async () => {
    const { default: InitiateReviewPanel } = await import('./InitiateReviewPanel.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      render: () => h(InitiateReviewPanel),
    });
    app.mount(host);
    await nextTick();

    const click = (selector: string) => {
      const element = host.querySelector(selector) as HTMLButtonElement | null;
      expect(element).not.toBeNull();
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    click('button[title="将选中的构件添加到列表"]');
    await nextTick();
    await nextTick();

    const packageInput = host.querySelector('input[placeholder="输入提资数据包名称..."]') as HTMLInputElement;
    packageInput.value = '保持渲染的校审包';
    packageInput.dispatchEvent(new Event('input', { bubbles: true }));

    const checkerSelect = host.querySelector('[data-testid="initiate-checker-select"]') as HTMLSelectElement;
    checkerSelect.value = 'checker-1';
    checkerSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const approverSelect = host.querySelector('[data-testid="initiate-approver-select"]') as HTMLSelectElement;
    approverSelect.value = 'approver-1';
    approverSelect.dispatchEvent(new Event('change', { bubbles: true }));

    await nextTick();

    click('[data-testid="initiate-submit-trigger"]');
    await flushAsyncWork();

    expect(host.querySelector('[data-testid="designer-landing-workspace"]')).not.toBeNull();
    expect(submitTaskToNextNodeSpy).toHaveBeenCalledWith('task-1', '发起提资');
    expect(host.textContent).toContain('提资单创建成功');

    app.unmount();
    host.remove();
  });

  it('keeps form values and panel open when create task request fails', async () => {
    createTaskMock.mockRejectedValueOnce(new Error('network broken'));

    const { default: InitiateReviewPanel } = await import('./InitiateReviewPanel.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const createdHandler = vi.fn();
    const closeHandler = vi.fn();

    const app = createApp({
      render: () => h(InitiateReviewPanel, {
        onCreated: (...args: unknown[]) => createdHandler(...args),
        onClose: () => closeHandler(),
      }),
    });
    app.mount(host);
    await nextTick();

    const click = (selector: string) => {
      const element = host.querySelector(selector) as HTMLButtonElement | null;
      expect(element).not.toBeNull();
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    click('button[title="将选中的构件添加到列表"]');
    await nextTick();
    await nextTick();

    const packageInput = host.querySelector('input[placeholder="输入提资数据包名称..."]') as HTMLInputElement;
    packageInput.value = '失败保留内容';
    packageInput.dispatchEvent(new Event('input', { bubbles: true }));

    const descriptionInput = host.querySelector('textarea[placeholder="添加补充说明或设计注意事项..."]') as HTMLTextAreaElement;
    descriptionInput.value = '失败后应保留';
    descriptionInput.dispatchEvent(new Event('input', { bubbles: true }));

    const checkerSelect = host.querySelector('[data-testid="initiate-checker-select"]') as HTMLSelectElement;
    checkerSelect.value = 'checker-1';
    checkerSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const approverSelect = host.querySelector('[data-testid="initiate-approver-select"]') as HTMLSelectElement;
    approverSelect.value = 'approver-1';
    approverSelect.dispatchEvent(new Event('change', { bubbles: true }));

    await nextTick();

    click('[data-testid="initiate-submit-trigger"]');
    await nextTick();
    await nextTick();

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="designer-landing-workspace"]')).not.toBeNull();
    expect(host.textContent).toContain('提资单创建失败');
    expect(host.textContent).toContain('network broken');
    expect((host.querySelector('input[placeholder="输入提资数据包名称..."]') as HTMLInputElement).value).toBe('失败保留内容');
    expect((host.querySelector('textarea[placeholder="添加补充说明或设计注意事项..."]') as HTMLTextAreaElement).value).toBe('失败后应保留');

    app.unmount();
    host.remove();
  });

  it('shows embed form lineage and restored task summary for designer landing', async () => {
    sessionStorage.setItem('embed_mode_params', JSON.stringify({
      formId: 'FORM-DESIGNER-1',
      userToken: 'token-1',
      userId: 'SJ',
      projectId: 'AvevaMarineSample',
      isEmbedMode: true,
    }));
    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'designer',
      formId: 'FORM-DESIGNER-1',
      restoreStatus: 'matched',
      restoredTaskId: 'task-embed-1',
      restoredTaskSummary: {
        title: '外部单据已绑定任务',
        status: 'draft',
        currentNode: 'sj',
      },
      primaryPanelId: 'initiateReview',
      visiblePanelIds: ['initiateReview', 'myTasks'],
    }));

    const { default: InitiateReviewPanel } = await import('./InitiateReviewPanel.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      render: () => h(InitiateReviewPanel),
    });
    app.mount(host);
    await nextTick();

    expect(host.textContent).toContain('FORM-DESIGNER-1');
    expect(host.textContent).toContain('外部单据已绑定任务');
    expect(host.textContent).toContain('draft');
    expect(host.textContent).toContain('sj');

    app.unmount();
    host.remove();
  });

  it('hydrates restored designer draft data on embed reopen', async () => {
    sessionStorage.setItem('embed_mode_params', JSON.stringify({
      formId: 'FORM-DESIGNER-2',
      userToken: 'token-2',
      userId: 'SJ',
      projectId: 'AvevaMarineSample',
      isEmbedMode: true,
    }));
    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'designer',
      formId: 'FORM-DESIGNER-2',
      restoreStatus: 'matched',
      restoredTaskId: 'task-embed-2',
      restoredTaskSummary: {
        title: '已保存提资单',
        status: 'draft',
        currentNode: 'sj',
      },
      restoredTaskDraft: {
        title: '已保存提资单',
        description: '复开后应回填',
        checkerId: 'checker-1',
        approverId: 'approver-1',
        priority: 'high',
        dueDate: '2026-03-21',
        components: [
          {
            id: 'comp-1',
            refNo: 'REF-RESTORE-1',
            name: 'Hull/REF-RESTORE-1',
            type: '管道',
          },
        ],
        attachments: [
          {
            id: 'att-1',
            name: 'design-note.pdf',
            url: '/files/design-note.pdf',
            uploadedAt: 1700000000000,
          },
        ],
        taskId: 'task-embed-2',
        formId: 'FORM-DESIGNER-2',
      },
      primaryPanelId: 'initiateReview',
      visiblePanelIds: ['initiateReview', 'myTasks'],
    }));

    const { default: InitiateReviewPanel } = await import('./InitiateReviewPanel.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      render: () => h(InitiateReviewPanel),
    });
    app.mount(host);
    await nextTick();

    expect((host.querySelector('input[placeholder="输入提资数据包名称..."]') as HTMLInputElement | null)?.value)
      .toBe('已保存提资单');
    expect((host.querySelector('textarea[placeholder="添加补充说明或设计注意事项..."]') as HTMLTextAreaElement | null)?.value)
      .toBe('复开后应回填');
    expect((host.querySelector('[data-testid="initiate-checker-select"]') as HTMLSelectElement | null)?.value)
      .toBe('checker-1');
    expect((host.querySelector('[data-testid="initiate-approver-select"]') as HTMLSelectElement | null)?.value)
      .toBe('approver-1');
    expect((host.querySelector('[data-testid="initiate-priority-select"]') as HTMLSelectElement | null)?.value)
      .toBe('high');
    expect((host.querySelector('[data-testid="initiate-due-date"]') as HTMLInputElement | null)?.value)
      .toBe('2026-03-21');
    expect(host.textContent).toContain('Hull/REF-RESTORE-1');
    expect(host.textContent).toContain('RefNo: REF-RESTORE-1');

    app.unmount();
    host.remove();
  });

  it('syncs late-arriving restored designer draft data into an already mounted panel', async () => {
    sessionStorage.setItem('embed_mode_params', JSON.stringify({
      formId: 'FORM-LATE-1',
      userToken: 'token-late',
      userId: 'SJ',
      projectId: 'AvevaMarineSample',
      isEmbedMode: true,
    }));
    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'designer',
      formId: 'FORM-LATE-1',
      restoreStatus: 'missing',
      primaryPanelId: 'initiateReview',
      visiblePanelIds: ['initiateReview', 'myTasks'],
    }));

    const { default: InitiateReviewPanel } = await import('./InitiateReviewPanel.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      render: () => h(InitiateReviewPanel),
    });
    app.mount(host);
    await nextTick();

    expect((host.querySelector('input[placeholder="输入提资数据包名称..."]') as HTMLInputElement | null)?.value)
      .toBe('');

    sessionStorage.setItem('embed_landing_state', JSON.stringify({
      target: 'designer',
      formId: 'FORM-LATE-1',
      restoreStatus: 'matched',
      restoredTaskId: 'task-late-1',
      restoredTaskSummary: {
        title: '晚到草稿',
        status: 'draft',
        currentNode: 'sj',
      },
      restoredTaskDraft: {
        title: '晚到草稿',
        description: '挂载后补写入的恢复数据',
        checkerId: 'checker-1',
        approverId: 'approver-1',
        priority: 'high',
        dueDate: '2026-03-26',
        components: [
          {
            id: 'comp-late-1',
            refNo: 'REF-LATE-1',
            name: 'Hull/REF-LATE-1',
            type: '管道',
          },
        ],
        attachments: [],
        taskId: 'task-late-1',
        formId: 'FORM-LATE-1',
      },
      primaryPanelId: 'initiateReview',
      visiblePanelIds: ['initiateReview', 'myTasks'],
    }));
    window.dispatchEvent(new CustomEvent('plant3d:embed-landing-state-updated'));
    await flushAsyncWork();

    expect((host.querySelector('input[placeholder="输入提资数据包名称..."]') as HTMLInputElement | null)?.value)
      .toBe('晚到草稿');
    expect((host.querySelector('textarea[placeholder="添加补充说明或设计注意事项..."]') as HTMLTextAreaElement | null)?.value)
      .toBe('挂载后补写入的恢复数据');
    expect(host.textContent).toContain('Hull/REF-LATE-1');

    app.unmount();
    host.remove();
  });
});
