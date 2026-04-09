import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ReviewConfirmation from './ReviewConfirmation.vue';

const addConfirmedRecordMock = vi.fn();
const emitToastMock = vi.fn();

const reviewStoreMock = {
  reviewMode: { value: true },
  currentTask: { value: { id: 'task-1' } },
  sortedConfirmedRecords: { value: [] as Record<string, unknown>[] },
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
    toolStoreMock.xeokitDistanceMeasurements.value = [];
    toolStoreMock.xeokitAngleMeasurements.value = [];
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
});
