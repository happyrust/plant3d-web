import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/api/reviewApi', () => ({
  reviewRecordCreate: vi.fn(async (record) => ({
    success: true,
    record: {
      ...record,
      id: 'record-mocked-1',
      confirmedAt: 1700000000000,
    },
  })),
  reviewRecordDelete: vi.fn(async () => ({ success: true })),
  reviewRecordGetByTaskId: vi.fn(async () => ({ success: true, records: [] })),
  reviewRecordClearByTaskId: vi.fn(async () => ({ success: true })),
  reviewTaskGetHistory: vi.fn(async () => ({ success: true, history: [] })),
  getReviewUserWebSocketUrl: vi.fn(() => null),
}));

import { useReviewStore } from './useReviewStore';
import { useToolStore } from './useToolStore';

describe('useReviewStore - confirm without OBB', () => {
  beforeEach(() => {
    const reviewStore = useReviewStore();
    const toolStore = useToolStore();
    reviewStore.clearConfirmedRecords();
    toolStore.clearAll();
  });

  it('should preserve empty obbAnnotations in confirmed records', async () => {
    const reviewStore = useReviewStore();
    const toolStore = useToolStore();

    await reviewStore.setCurrentTask({
      id: 'task-confirm-1',
      formId: 'FORM-CONFIRM-1',
      title: 'Confirm task',
      description: '',
      modelName: 'Demo',
      status: 'in_review',
      priority: 'medium',
      requesterId: 'designer-1',
      requesterName: 'Designer',
      checkerId: 'checker-1',
      checkerName: 'Checker',
      approverId: 'approver-1',
      approverName: 'Approver',
      reviewerId: 'checker-1',
      reviewerName: 'Checker',
      components: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentNode: 'jd',
    });

    toolStore.addAnnotation({
      id: 'text-1',
      entityId: 'entity-1',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: 'Text annotation',
      createdAt: Date.now(),
    });

    toolStore.addCloudAnnotation({
      id: 'cloud-1',
      anchorWorldPos: [1, 1, 1],
      screenSpacePoints: [[100, 100], [200, 200]],
      visible: true,
      title: 'Cloud annotation',
      description: '',
      createdAt: Date.now(),
    });

    toolStore.addRectAnnotation({
      id: 'rect-1',
      obb: {
        center: [2, 2, 2],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [0.5, 0.5, 0.5],
        corners: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
      },
      anchorWorldPos: [2, 2, 2],
      visible: true,
      title: 'Rect annotation',
      description: '',
      createdAt: Date.now(),
    });

    await reviewStore.addConfirmedRecord({
      type: 'batch',
      annotations: [...toolStore.annotations.value],
      cloudAnnotations: [...toolStore.cloudAnnotations.value],
      rectAnnotations: [...toolStore.rectAnnotations.value],
      measurements: [],
      note: 'Test batch',
    });

    const confirmed = reviewStore.confirmedRecords.value;
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].annotations).toHaveLength(1);
    expect(confirmed[0].cloudAnnotations).toHaveLength(1);
    expect(confirmed[0].rectAnnotations).toHaveLength(1);
    expect(confirmed[0].obbAnnotations).toEqual([]);
  });

  it('should preserve stable task and form lineage on confirmed records', async () => {
    const reviewStore = useReviewStore();
    const toolStore = useToolStore();

    await reviewStore.setCurrentTask({
      id: 'task-lineage-1',
      formId: 'FORM-LINEAGE-1',
      title: 'Lineage task',
      description: '',
      modelName: 'Demo',
      status: 'in_review',
      priority: 'medium',
      requesterId: 'designer-1',
      requesterName: 'Designer',
      checkerId: 'checker-1',
      checkerName: 'Checker',
      approverId: 'approver-1',
      approverName: 'Approver',
      reviewerId: 'checker-1',
      reviewerName: 'Checker',
      components: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentNode: 'jd',
    });

    toolStore.addAnnotation({
      id: 'text-lineage-1',
      entityId: 'entity-lineage-1',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: 'Lineage text',
      description: '',
      createdAt: Date.now(),
    });

    await reviewStore.addConfirmedRecord({
      type: 'batch',
      annotations: [...toolStore.annotations.value],
      cloudAnnotations: [],
      rectAnnotations: [],
      measurements: [],
      note: 'Preserve lineage',
      formId: undefined,
    });

    const confirmed = reviewStore.confirmedRecords.value[0];
    expect(confirmed?.taskId).toBe('task-lineage-1');
    expect(confirmed?.formId).toBe('FORM-LINEAGE-1');
  });
});
