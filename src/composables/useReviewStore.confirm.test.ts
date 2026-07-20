import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/api/reviewApi', () => ({
  reviewRecordCreate: vi.fn(async (record) => ({
    success: true,
    record: {
      ...record,
      id: 'record-mocked-1',
      confirmedAt: 1700000000000,
      dimensionDocumentVersion: record.dimensionDocument
        ? record.dimensionDocumentBaseVersion + 1
        : undefined,
    },
  })),
  reviewRecordDelete: vi.fn(async () => ({ success: true })),
  reviewRecordGetByTaskId: vi.fn(async () => ({ success: true, records: [] })),
  reviewRecordClearByTaskId: vi.fn(async () => ({ success: true })),
  reviewTaskGetById: vi.fn(async () => ({ success: false })),
  reviewTaskGetHistory: vi.fn(async () => ({ success: true, history: [] })),
  getReviewUserWebSocketUrl: vi.fn(() => null),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: { value: { id: 'reviewer-1' } },
  }),
}));

import { useReviewStore } from './useReviewStore';
import { useToolStore } from './useToolStore';

import { reviewRecordCreate } from '@/api/reviewApi';
import { dimensionDocumentToSnapshot } from '@/dimension/adapters/reviewSnapshotAdapter';
import { emptyDimensionDocument, linearRecord } from '@/dimension/domain/testFixtures';
import { DimensionDocumentSession } from '@/dimension/services/dimensionDocumentSession';

const memoryJournal = {
  load: () => null,
  append: vi.fn(),
  replace: vi.fn(),
  clear: vi.fn(),
};

describe('useReviewStore - confirm without OBB', () => {
  beforeEach(async () => {
    const reviewStore = useReviewStore();
    const toolStore = useToolStore();
    await reviewStore.clearConfirmedRecords();
    reviewStore.bindDimensionDocumentSession(null);
    toolStore.clearAll();
    vi.mocked(reviewRecordCreate).mockClear();
    memoryJournal.append.mockClear();
    memoryJournal.clear.mockClear();
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

  it('should save and accept a versioned dimension document with the review record', async () => {
    const reviewStore = useReviewStore();
    await reviewStore.setCurrentTask({
      id: 'task-dimension-1',
      formId: 'FORM-DIMENSION-1',
      title: 'Dimension task',
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
    const state = emptyDimensionDocument(
      [linearRecord({ id: 'dimension-confirm-1' })],
      {
        documentId: 'dimension-document:form:FORM-DIMENSION-1',
        taskId: 'task-dimension-1',
        formId: 'FORM-DIMENSION-1',
        baseVersion: 4,
      },
    );
    const session = new DimensionDocumentSession({
      initialState: state,
      journal: memoryJournal,
    });
    reviewStore.bindDimensionDocumentSession(session);

    await reviewStore.addConfirmedRecord({
      type: 'batch',
      annotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      measurements: [],
      dimensionDocument: dimensionDocumentToSnapshot(state),
      dimensionDocumentVersion: state.baseVersion,
      note: 'Dimension snapshot',
    });

    expect(reviewRecordCreate).toHaveBeenCalledWith(expect.objectContaining({
      dimensionDocument: dimensionDocumentToSnapshot(state),
      dimensionDocumentBaseVersion: 4,
    }));
    expect(reviewStore.confirmedRecords.value[0]).toMatchObject({
      dimensionDocumentVersion: 5,
      dimensionDocument: dimensionDocumentToSnapshot(state),
    });
    expect(session.state.baseVersion).toBe(5);
    expect(memoryJournal.clear).toHaveBeenCalledWith(state.documentId);
  });

  it('should expose a replay preview instead of overwriting a dimension conflict', async () => {
    const reviewStore = useReviewStore();
    await reviewStore.setCurrentTask({
      id: 'task-conflict-1',
      formId: 'FORM-CONFLICT-1',
      title: 'Dimension conflict',
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
    const documentId = 'dimension-document:form:FORM-CONFLICT-1';
    const pendingRecord = linearRecord({ id: 'dimension-local-conflict' });
    const pendingCommand = {
      type: 'create' as const,
      commandId: 'command-local-conflict',
      actorId: pendingRecord.authorId,
      actorRole: pendingRecord.authorRole,
      at: 10,
      record: pendingRecord,
    };
    const journal = {
      load: () => ({
        version: 1 as const,
        documentId,
        baseVersion: 4,
        commands: [pendingCommand],
        updatedAt: 10,
      }),
      append: vi.fn(),
      replace: vi.fn(),
      clear: vi.fn(),
    };
    const local = emptyDimensionDocument([pendingRecord], {
      documentId,
      taskId: 'task-conflict-1',
      formId: 'FORM-CONFLICT-1',
      baseVersion: 4,
    });
    const session = new DimensionDocumentSession({
      initialState: local,
      journal,
    });
    reviewStore.bindDimensionDocumentSession(session);
    const latest = emptyDimensionDocument([], {
      documentId,
      taskId: 'task-conflict-1',
      formId: 'FORM-CONFLICT-1',
      baseVersion: 5,
    });
    vi.mocked(reviewRecordCreate).mockRejectedValueOnce(Object.assign(
      new Error('dimension version conflict'),
      {
        status: 409,
        statusText: 'Conflict',
        responseBody: {
          record: {
            dimensionDocument: dimensionDocumentToSnapshot(latest),
            dimensionDocumentVersion: 5,
            taskId: 'task-conflict-1',
            formId: 'FORM-CONFLICT-1',
          },
        },
      },
    ));

    await expect(reviewStore.addConfirmedRecord({
      type: 'batch',
      annotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      measurements: [],
      dimensionDocument: dimensionDocumentToSnapshot(local),
      dimensionDocumentVersion: 4,
      note: 'conflict',
    })).rejects.toThrow('请选择重放本地修改或放弃本地修改');

    expect(reviewStore.dimensionDocumentConflict.value?.latest.baseVersion).toBe(5);
    expect(reviewStore.dimensionDocumentConflict.value?.preview.applied)
      .toEqual([pendingCommand]);
    expect(reviewStore.resolveDimensionDocumentConflict('replay')).toBe(true);
    expect(session.state.baseVersion).toBe(5);
    expect(session.state.records.map(record => record.id))
      .toEqual(['dimension-local-conflict']);
    expect(session.dirty).toBe(true);
  });

  it('should preserve annotation severity across confirm snapshot and exportReviewData', async () => {
    const reviewStore = useReviewStore();
    const toolStore = useToolStore();

    await reviewStore.setCurrentTask({
      id: 'task-sev-1',
      formId: 'FORM-SEV-1',
      title: 'Severity task',
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
      id: 'text-sev', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: '1', title: 'critical text', description: '', createdAt: 1,
    });
    toolStore.addCloudAnnotation({
      id: 'cloud-sev', objectIds: ['o1'], anchorWorldPos: [0, 0, 0],
      visible: true, title: 'severe cloud', description: '', createdAt: 2, refnos: ['o1'],
    });
    toolStore.updateAnnotationSeverity('text', 'text-sev', 'principle');
    toolStore.updateAnnotationSeverity('cloud', 'cloud-sev', 'general');

    await reviewStore.addConfirmedRecord({
      type: 'batch',
      annotations: [...toolStore.annotations.value],
      cloudAnnotations: [...toolStore.cloudAnnotations.value],
      rectAnnotations: [],
      measurements: [],
      note: 'Severity snapshot',
    });

    const confirmed = reviewStore.confirmedRecords.value[0];
    expect((confirmed?.annotations[0] as any).severity).toBe('principle');
    expect((confirmed?.cloudAnnotations[0] as any).severity).toBe('general');

    const exported = JSON.parse(reviewStore.exportReviewData());
    expect(exported.records[0].annotations[0].severity).toBe('principle');
    expect(exported.records[0].cloudAnnotations[0].severity).toBe('general');
  });
});
