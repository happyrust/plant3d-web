import { describe, expect, it, vi } from 'vitest';

import { dimensionDocumentToSnapshot } from '../adapters/reviewSnapshotAdapter';
import {
  emptyDimensionDocument,
  linearRecord,
} from '../domain/testFixtures';

import {
  ReviewDimensionRepository,
} from './reviewDimensionRepository';

import type { ReviewDimensionApi } from './reviewDimensionRepository';
import type {
  ConfirmedRecordData,
  ConfirmedRecordResponse,
} from '@/api/reviewApi';

import { ReviewApiHttpError } from '@/api/reviewApi';

function baseRecord(
  overrides: Partial<ConfirmedRecordData> = {},
): ConfirmedRecordData {
  return {
    taskId: 'task-1',
    formId: 'form-1',
    type: 'batch',
    annotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    obbAnnotations: [],
    measurements: [],
    note: 'base record',
    ...overrides,
  };
}

function responseRecord(
  state: ReturnType<typeof emptyDimensionDocument>,
  dimensionDocumentVersion: number,
): NonNullable<ConfirmedRecordResponse['record']> {
  return {
    ...baseRecord({
      taskId: state.taskId ?? 'task-1',
      formId: state.formId,
      dimensionDocument: dimensionDocumentToSnapshot(state),
      dimensionDocumentVersion,
    }),
    id: `record-${dimensionDocumentVersion}`,
    confirmedAt: dimensionDocumentVersion,
  };
}

function createApi(): {
  api: ReviewDimensionApi;
  loadRecords: ReturnType<typeof vi.fn<ReviewDimensionApi['loadRecords']>>;
  buildBaseRecord: ReturnType<typeof vi.fn<ReviewDimensionApi['buildBaseRecord']>>;
  saveRecord: ReturnType<typeof vi.fn<ReviewDimensionApi['saveRecord']>>;
  } {
  const loadRecords = vi.fn<ReviewDimensionApi['loadRecords']>();
  const buildBaseRecord = vi.fn<ReviewDimensionApi['buildBaseRecord']>();
  const saveRecord = vi.fn<ReviewDimensionApi['saveRecord']>();
  return {
    api: { loadRecords, buildBaseRecord, saveRecord },
    loadRecords,
    buildBaseRecord,
    saveRecord,
  };
}

describe('ReviewDimensionRepository', () => {
  it('loads an empty state when no review record contains a document', async () => {
    const harness = createApi();
    harness.loadRecords.mockResolvedValue([baseRecord()]);
    const repository = new ReviewDimensionRepository(harness.api);

    const state = await repository.load({
      taskId: 'task-empty',
      formId: 'form-empty',
    });

    expect(state).toMatchObject({
      schemaVersion: 1,
      taskId: 'task-empty',
      formId: 'form-empty',
      baseVersion: 0,
      records: [],
    });
    expect(state.documentId).toEqual(expect.any(String));
    expect(state.documentId.length).toBeGreaterThan(0);
  });

  it('loads the document with the highest outer version', async () => {
    const version1 = emptyDimensionDocument(
      [linearRecord({ id: 'older' })],
      { documentId: 'document-1', baseVersion: 1 },
    );
    const version3 = emptyDimensionDocument(
      [linearRecord({ id: 'latest' })],
      { documentId: 'document-1', baseVersion: 3 },
    );
    const harness = createApi();
    harness.loadRecords.mockResolvedValue([
      responseRecord(version3, 3),
      baseRecord(),
      responseRecord(version1, 1),
    ]);
    const repository = new ReviewDimensionRepository(harness.api);

    const state = await repository.load({
      taskId: 'task-1',
      formId: 'form-1',
    });

    expect(state.baseVersion).toBe(3);
    expect(state.records.map(record => record.id)).toEqual(['latest']);
  });

  it('saves one merged review record and returns the server version', async () => {
    const state = emptyDimensionDocument(
      [linearRecord({ id: 'saved' })],
      {
        documentId: 'document-save',
        taskId: 'task-1',
        formId: 'form-1',
        baseVersion: 4,
      },
    );
    const harness = createApi();
    harness.buildBaseRecord.mockResolvedValue(baseRecord({ note: 'keep me' }));
    harness.saveRecord.mockResolvedValue({
      success: true,
      record: responseRecord(state, 5),
    });
    const repository = new ReviewDimensionRepository(harness.api);

    const result = await repository.save(state);

    expect(harness.saveRecord).toHaveBeenCalledWith(expect.objectContaining({
      note: 'keep me',
      dimensionDocument: {
        schemaVersion: 1,
        documentId: 'document-save',
        records: state.records,
      },
      dimensionDocumentBaseVersion: 4,
    }));
    const payload = harness.saveRecord.mock.calls[0]?.[0];
    expect(payload?.dimensionDocument).not.toHaveProperty('baseVersion');
    expect(result).toEqual({
      ok: true,
      state: {
        ...state,
        baseVersion: 5,
      },
    });
  });

  it('maps HTTP 409 to a conflict with the validated latest document', async () => {
    const local = emptyDimensionDocument(
      [linearRecord({ id: 'local' })],
      {
        documentId: 'document-conflict',
        taskId: 'task-1',
        formId: 'form-1',
        baseVersion: 4,
      },
    );
    const latest = emptyDimensionDocument(
      [linearRecord({ id: 'remote' })],
      {
        documentId: 'document-conflict',
        taskId: 'task-1',
        formId: 'form-1',
        baseVersion: 6,
      },
    );
    const harness = createApi();
    harness.buildBaseRecord.mockResolvedValue(baseRecord());
    harness.saveRecord.mockRejectedValue(new ReviewApiHttpError({
      status: 409,
      statusText: 'Conflict',
      message: 'stale version',
      responseBody: {
        success: false,
        record: responseRecord(latest, 6),
      },
    }));
    const repository = new ReviewDimensionRepository(harness.api);

    const result = await repository.save(local);

    expect(result).toEqual({
      ok: false,
      reason: 'conflict',
      latest: {
        ...latest,
        taskId: 'task-1',
        formId: 'form-1',
      },
    });
  });

  it('maps HTTP 403 to a forbidden result', async () => {
    const harness = createApi();
    harness.buildBaseRecord.mockResolvedValue(baseRecord());
    harness.saveRecord.mockRejectedValue(new ReviewApiHttpError({
      status: 403,
      statusText: 'Forbidden',
      message: 'not allowed',
    }));
    const repository = new ReviewDimensionRepository(harness.api);

    await expect(repository.save(emptyDimensionDocument())).resolves.toEqual({
      ok: false,
      reason: 'forbidden',
      message: 'not allowed',
    });
  });

  it('maps transport failures to a network result', async () => {
    const harness = createApi();
    harness.buildBaseRecord.mockResolvedValue(baseRecord());
    harness.saveRecord.mockRejectedValue(new Error('offline'));
    const repository = new ReviewDimensionRepository(harness.api);

    await expect(repository.save(emptyDimensionDocument())).resolves.toEqual({
      ok: false,
      reason: 'network',
      message: 'offline',
    });
  });

  it('maps an invalid success response to an invalid result', async () => {
    const harness = createApi();
    harness.buildBaseRecord.mockResolvedValue(baseRecord());
    harness.saveRecord.mockResolvedValue({
      success: true,
      record: {
        ...baseRecord({
          dimensionDocument: {
            schemaVersion: 1,
            documentId: 'document-invalid',
            records: [{ arbitrary: true }],
          } as never,
          dimensionDocumentVersion: 1,
        }),
        id: 'record-invalid',
        confirmedAt: 1,
      },
    });
    const repository = new ReviewDimensionRepository(harness.api);

    const result = await repository.save(emptyDimensionDocument());

    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });
});
