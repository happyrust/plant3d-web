import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ReviewConfirmation from './ReviewConfirmation.vue';

const addConfirmedRecordMock = vi.fn();
const emitToastMock = vi.fn();

const reviewStoreMock = {
  reviewMode: { value: true },
  currentTask: { value: { id: 'task-1' } },
  sortedConfirmedRecords: { value: [] as Array<Record<string, unknown>> },
  addConfirmedRecord: (...args: unknown[]) => addConfirmedRecordMock(...args),
  setReviewMode: vi.fn(),
};

const toolStoreMock = {
  annotations: { value: [] as Array<Record<string, unknown>> },
  cloudAnnotations: { value: [] as Array<Record<string, unknown>> },
  rectAnnotations: { value: [] as Array<Record<string, unknown>> },
  obbAnnotations: { value: [] as Array<Record<string, unknown>> },
  measurements: { value: [] as Array<Record<string, unknown>> },
  annotationCount: { value: 0 },
  cloudAnnotationCount: { value: 0 },
  rectAnnotationCount: { value: 0 },
  obbAnnotationCount: { value: 0 },
  measurementCount: { value: 0 },
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
    toolStoreMock.annotations.value = [];
    toolStoreMock.cloudAnnotations.value = [];
    toolStoreMock.rectAnnotations.value = [];
    toolStoreMock.obbAnnotations.value = [];
    toolStoreMock.measurements.value = [];
    toolStoreMock.annotationCount.value = 0;
    toolStoreMock.cloudAnnotationCount.value = 0;
    toolStoreMock.rectAnnotationCount.value = 0;
    toolStoreMock.obbAnnotationCount.value = 0;
    toolStoreMock.measurementCount.value = 0;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mountComponent() {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(ReviewConfirmation),
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
    expect(emitToastMock).toHaveBeenCalledWith({ message: '确认数据已保存', level: 'success' });
  });
});
