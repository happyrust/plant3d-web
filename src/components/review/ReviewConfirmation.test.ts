import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import ReviewConfirmation from './ReviewConfirmation.vue';

import { ReviewApiHttpError } from '@/api/reviewApi';

const addConfirmedRecordMock = vi.fn();
const emitToastMock = vi.fn();

const reviewStoreMock = {
  reviewMode: { value: true },
  currentTask: { value: { id: 'task-1' } },
  sortedConfirmedRecords: { value: [] as Record<string, unknown>[] },
  dimensionDocumentDirty: { value: false },
  dimensionDocumentRecordCount: { value: 0 },
  dimensionDocumentConflict: { value: null as Record<string, unknown> | null },
  getBoundDimensionConfirmPayload: vi.fn(() => ({})),
  resolveDimensionDocumentConflict: vi.fn(() => true),
  addConfirmedRecord: (...args: unknown[]) => addConfirmedRecordMock(...args),
  setReviewMode: vi.fn(),
};

const toolStoreMock = {
  annotations: { value: [] as Record<string, unknown>[] },
  cloudAnnotations: { value: [] as Record<string, unknown>[] },
  rectAnnotations: { value: [] as Record<string, unknown>[] },
  obbAnnotations: { value: [] as Record<string, unknown>[] },
  measurements: { value: [] as Record<string, unknown>[] },
  xeokitDistanceMeasurements: { value: [] as Record<string, unknown>[] },
  xeokitAngleMeasurements: { value: [] as Record<string, unknown>[] },
  annotationCount: { value: 0 },
  cloudAnnotationCount: { value: 0 },
  rectAnnotationCount: { value: 0 },
  obbAnnotationCount: { value: 0 },
  measurementCount: { value: 0 },
  toolMode: ref<string>('none'),
};

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => reviewStoreMock,
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => toolStoreMock,
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: (...args: unknown[]) => emitToastMock(...args),
}));

describe('ReviewConfirmation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    addConfirmedRecordMock.mockReset();
    emitToastMock.mockReset();
    reviewStoreMock.reviewMode.value = true;
    reviewStoreMock.currentTask.value = { id: 'task-1' };
    reviewStoreMock.sortedConfirmedRecords.value = [];
    reviewStoreMock.dimensionDocumentDirty.value = false;
    reviewStoreMock.dimensionDocumentRecordCount.value = 0;
    reviewStoreMock.dimensionDocumentConflict.value = null;
    reviewStoreMock.getBoundDimensionConfirmPayload.mockReset();
    reviewStoreMock.getBoundDimensionConfirmPayload.mockReturnValue({});
    reviewStoreMock.resolveDimensionDocumentConflict.mockReset();
    reviewStoreMock.resolveDimensionDocumentConflict.mockReturnValue(true);
    toolStoreMock.annotations.value = [];
    toolStoreMock.cloudAnnotations.value = [];
    toolStoreMock.rectAnnotations.value = [];
    toolStoreMock.obbAnnotations.value = [];
    toolStoreMock.measurements.value = [];
    toolStoreMock.xeokitDistanceMeasurements.value = [];
    toolStoreMock.xeokitAngleMeasurements.value = [];
    toolStoreMock.annotationCount.value = 0;
    toolStoreMock.cloudAnnotationCount.value = 0;
    toolStoreMock.rectAnnotationCount.value = 0;
    toolStoreMock.obbAnnotationCount.value = 0;
    toolStoreMock.measurementCount.value = 0;
    toolStoreMock.toolMode.value = 'none';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mountComponent(props: Record<string, unknown> = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(ReviewConfirmation, props),
    }).mount(host);

    await vi.dynamicImportSettled();
    await nextTick();
    await Promise.resolve();
    await nextTick();
  }

  it('二次确认时只提交本次新增的数据', async () => {
    reviewStoreMock.sortedConfirmedRecords.value = [
      {
        id: 'record-1',
        taskId: 'task-1',
        confirmedAt: 1,
        annotations: [{ id: 'anno-old', title: '旧批注' }],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [],
      },
    ];
    toolStoreMock.annotations.value = [
      { id: 'anno-old', title: '旧批注' },
      { id: 'anno-new', title: '新批注' },
    ];
    toolStoreMock.annotationCount.value = 2;
    addConfirmedRecordMock.mockResolvedValue('record-2');

    await mountComponent();

    const confirmButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('确认完成'));
    expect(confirmButton).toBeTruthy();

    confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await nextTick();

    expect(addConfirmedRecordMock).toHaveBeenCalledTimes(1);
    expect(addConfirmedRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      annotations: [{ id: 'anno-new', title: '新批注' }],
      cloudAnnotations: [],
      rectAnnotations: [],
      obbAnnotations: [],
      measurements: [],
    }));
    expect(emitToastMock).toHaveBeenCalledWith({ message: '新增证据已保存', level: 'success' });
  });

  it('xeokit 已完成测量会进入保存，草稿不会进入', async () => {
    toolStoreMock.xeokitDistanceMeasurements.value = [
      {
        id: 'xeokit-draft',
        kind: 'distance',
        origin: { entityId: 'pipe-a', worldPos: [0, 0, 0] },
        target: { entityId: 'pipe-b', worldPos: [1, 0, 0] },
        visible: true,
        approximate: true,
        createdAt: 1,
      },
      {
        id: 'xeokit-final',
        kind: 'distance',
        origin: { entityId: 'pipe-c', worldPos: [0, 0, 0] },
        target: { entityId: 'pipe-d', worldPos: [2, 0, 0] },
        visible: true,
        approximate: false,
        createdAt: 2,
      },
    ];
    addConfirmedRecordMock.mockResolvedValue('record-2');

    await mountComponent();

    const confirmButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('确认完成'));
    expect(confirmButton).toBeTruthy();

    confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await nextTick();

    expect(addConfirmedRecordMock).toHaveBeenCalledTimes(1);
    expect(addConfirmedRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      measurements: [
        expect.objectContaining({
          id: 'xeokit-final',
          kind: 'distance',
        }),
      ],
    }));
    expect(addConfirmedRecordMock).not.toHaveBeenCalledWith(expect.objectContaining({
      measurements: expect.arrayContaining([
        expect.objectContaining({ id: 'xeokit-draft' }),
      ]),
    }));
  });

  it('尺寸文档 dirty 时展示并提交完整尺寸快照', async () => {
    const dimensionDocument = {
      schemaVersion: 1 as const,
      documentId: 'dimension-document:task:task-1',
      records: [],
    };
    reviewStoreMock.dimensionDocumentDirty.value = true;
    reviewStoreMock.dimensionDocumentRecordCount.value = 2;
    reviewStoreMock.getBoundDimensionConfirmPayload.mockReturnValue({
      dimensionDocument,
      dimensionDocumentVersion: 6,
    });
    addConfirmedRecordMock.mockResolvedValue('record-dimension');

    await mountComponent();

    expect(document.body.textContent).toContain('尺寸');
    expect(document.body.textContent).toContain('2');
    const confirmButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('确认完成'));
    expect(confirmButton).toBeTruthy();

    confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await nextTick();

    expect(addConfirmedRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      dimensionDocument,
      dimensionDocumentVersion: 6,
    }));
  });

  it('画布等拖拽时让路：放行 pointer 事件、降级显示并给出说明，结束后恢复可点', async () => {
    toolStoreMock.cloudAnnotationCount.value = 1;
    toolStoreMock.cloudAnnotations.value = [{ id: 'cloud-1', title: '云线' }];

    // 停靠在批注浮层里：由浮层经 props 告知（云线锚点已就绪）
    const armed = ref(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({
      render: () => h(ReviewConfirmation, { variant: 'docked', canvasDragArmed: armed.value }),
    }).mount(host);
    await nextTick();

    const card = () => document.querySelector('[data-testid="review-confirmation"]') as HTMLElement;
    expect(card().className).toContain('pointer-events-auto');
    expect(card().hasAttribute('data-canvas-drag-armed')).toBe(false);
    expect(document.querySelector('[data-testid="review-confirmation-drag-armed-hint"]')).toBeNull();

    armed.value = true;
    await nextTick();
    expect(card().className).toContain('pointer-events-none');
    expect(card().className).toContain('select-none');
    expect(card().getAttribute('data-canvas-drag-armed')).toBe('true');
    expect(card().getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('[data-testid="review-confirmation-drag-armed-hint"]')?.textContent)
      .toContain('正在绘制');

    armed.value = false;
    await nextTick();
    expect(card().className).toContain('pointer-events-auto');
    expect(document.querySelector('[data-testid="review-confirmation-drag-armed-hint"]')).toBeNull();
    document.body.innerHTML = '';

    // 浮在右下角（批注浮层不在）：矩形 OBB 框画 / 框选目标从按下起就是拖拽，自己看工具模式兜底
    await mountComponent();
    expect(card().className).toContain('pointer-events-auto');
    toolStoreMock.toolMode.value = 'annotation_obb';
    await nextTick();
    expect(card().getAttribute('data-canvas-drag-armed')).toBe('true');
    toolStoreMock.toolMode.value = 'pick_refno_box';
    await nextTick();
    expect(card().getAttribute('data-canvas-drag-armed')).toBe('true');
    // 云线模式本身不算：锚点未就绪前下一步是单击，锚点状态由批注浮层经 props 传
    toolStoreMock.toolMode.value = 'annotation_cloud';
    await nextTick();
    expect(card().hasAttribute('data-canvas-drag-armed')).toBe(false);
    toolStoreMock.toolMode.value = 'none';
    await nextTick();
    expect(card().className).toContain('pointer-events-auto');
  });

  it('保存返回 504 时保留批注并允许原按钮直接重试', async () => {
    toolStoreMock.cloudAnnotations.value = [
      { id: 'cloud-retry', title: '待重试云线', refnos: ['24381_145018'] },
    ];
    toolStoreMock.cloudAnnotationCount.value = 1;
    addConfirmedRecordMock
      .mockRejectedValueOnce(new ReviewApiHttpError({
        status: 504,
        statusText: 'Gateway Timeout',
        message: 'HTTP 504 Gateway Timeout',
      }))
      .mockResolvedValueOnce('record-retry');

    await mountComponent();

    const confirmButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('确认完成')) as HTMLButtonElement;
    confirmButton.click();

    await vi.waitFor(() => {
      expect(document.body.textContent)
        .toContain('校审服务暂时不可用，未保存证据仍已保留，请稍后重试');
    });
    expect(toolStoreMock.cloudAnnotations.value).toHaveLength(1);
    expect(confirmButton.disabled).toBe(false);
    expect(confirmButton.textContent).toContain('确认完成');

    confirmButton.click();

    await vi.waitFor(() => expect(addConfirmedRecordMock).toHaveBeenCalledTimes(2));
    expect(addConfirmedRecordMock).toHaveBeenLastCalledWith(expect.objectContaining({
      cloudAnnotations: [
        expect.objectContaining({ id: 'cloud-retry' }),
      ],
    }));
    await vi.waitFor(() => {
      expect(emitToastMock).toHaveBeenCalledWith({ message: '新增证据已保存', level: 'success' });
    });
  });
});
