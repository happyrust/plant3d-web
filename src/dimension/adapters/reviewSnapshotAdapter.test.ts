import { describe, expect, it } from 'vitest';

import {
  angularRecord,
  emptyDimensionDocument,
  linearRecord,
  projectedRecord,
  radialRecord,
} from '../domain/testFixtures';

import {
  DimensionSnapshotValidationError,
  dimensionDocumentFromSnapshot,
  dimensionDocumentToSnapshot,
  validateDimensionDocumentSnapshot,
} from './reviewSnapshotAdapter';

import type { SnapshotDimensionDocument } from './reviewSnapshotAdapter';

describe('review dimension snapshot adapter', () => {
  it('round-trips all record kinds while taking baseVersion from context', () => {
    const state = emptyDimensionDocument([
      linearRecord({ id: 'linear' }),
      projectedRecord({ id: 'projected' }),
      angularRecord({ id: 'angular' }),
      radialRecord({ id: 'radial' }),
    ], {
      documentId: 'document-round-trip',
      taskId: 'task-1',
      formId: 'form-1',
      baseVersion: 7,
    });

    const snapshot = dimensionDocumentToSnapshot(state);

    expect(snapshot).toEqual({
      schemaVersion: 2,
      documentId: 'document-round-trip',
      records: state.records,
    });
    expect(Object.prototype.hasOwnProperty.call(snapshot, 'baseVersion')).toBe(false);
    expect(dimensionDocumentFromSnapshot(snapshot, {
      taskId: 'task-1',
      formId: 'form-1',
      baseVersion: 7,
    })).toEqual(state);
  });

  it('round-trips the #68 direction fields and rejects a persisted view direction', () => {
    const state = emptyDimensionDocument([
      linearRecord({
        id: 'linear',
        directions: { schema: 1, source: 'explicit', measuredAxis: [1, 0, 0], dimensionDirection: [1, 0, 0] },
      }),
      projectedRecord({
        id: 'projected',
        directions: {
          schema: 1,
          source: 'legacy-derived',
          measuredAxis: [1, 0, 0],
          dimensionDirection: [1, 0, 0],
          projectionDirection: [0, 1, 0],
          dimensionPlane: { normal: [0, 0, 1] },
        },
      }),
    ], { documentId: 'document-directions', baseVersion: 1 });

    const snapshot = dimensionDocumentToSnapshot(state);
    const restored = dimensionDocumentFromSnapshot(
      JSON.parse(JSON.stringify(snapshot)),
      { baseVersion: 1 },
    );
    expect(restored.records).toEqual(state.records);

    expect(() => validateDimensionDocumentSnapshot({
      schemaVersion: 2,
      documentId: 'document-directions',
      records: [linearRecord({
        directions: { schema: 1, source: 'explicit', viewDirection: [0, 0, -1] } as never,
      })],
    })).toThrow(DimensionSnapshotValidationError);
  });

  it('rejects an unsupported schema version', () => {
    const malformed = {
      schemaVersion: 3,
      documentId: 'document-1',
      records: [],
    };

    expect(() => dimensionDocumentFromSnapshot(
      malformed as unknown as SnapshotDimensionDocument,
      { baseVersion: 0 },
    )).toThrow(/schemaVersion/);
  });

  it('migrates a schema v1 snapshot with unpinned labels', () => {
    const legacyRecord = {
      ...linearRecord({ id: 'legacy-linear', labelPinned: true }),
    } as Record<string, unknown>;
    delete legacyRecord.labelPinned;

    const restored = dimensionDocumentFromSnapshot({
      schemaVersion: 1,
      documentId: 'legacy-document',
      records: [legacyRecord],
    } as unknown as SnapshotDimensionDocument, {
      baseVersion: 4,
    });

    expect(restored.schemaVersion).toBe(2);
    expect(restored.records[0]).toMatchObject({
      id: 'legacy-linear',
      labelPinned: false,
    });
  });

  it('rejects duplicate record ids', () => {
    const malformed = {
      schemaVersion: 2,
      documentId: 'document-1',
      records: [
        linearRecord({ id: 'duplicate' }),
        linearRecord({ id: 'duplicate' }),
      ],
    } as SnapshotDimensionDocument;

    expect(() => dimensionDocumentFromSnapshot(
      malformed,
      { baseVersion: 0 },
    )).toThrow(/duplicate/);
  });

  it('rejects non-finite coordinates', () => {
    const malformed = {
      schemaVersion: 2,
      documentId: 'document-1',
      records: [
        linearRecord({
          a: {
            snapshot: [Number.NaN, 0, 0],
            accuracy: 'exact',
          },
        }),
      ],
    } as SnapshotDimensionDocument;

    expect(() => dimensionDocumentFromSnapshot(
      malformed,
      { baseVersion: 0 },
    )).toThrow(/record/);
  });

  it('rejects a record marked valid without resolved geometry', () => {
    const malformed = {
      schemaVersion: 2,
      documentId: 'document-1',
      records: [
        linearRecord({
          a: {
            snapshot: null,
            accuracy: 'exact',
          },
          validity: 'valid',
        }),
      ],
    } as SnapshotDimensionDocument;

    expect(() => dimensionDocumentFromSnapshot(
      malformed,
      { baseVersion: 0 },
    )).toThrow(/record/);
  });

  it('rejects an invalid external base version', () => {
    const snapshot = dimensionDocumentToSnapshot(emptyDimensionDocument());

    expect(() => dimensionDocumentFromSnapshot(
      snapshot,
      { baseVersion: -1 },
    )).toThrow(/baseVersion/);
  });
});
