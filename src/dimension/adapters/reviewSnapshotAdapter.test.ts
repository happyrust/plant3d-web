import { describe, expect, it } from 'vitest';

import {
  angularRecord,
  emptyDimensionDocument,
  linearRecord,
  projectedRecord,
  radialRecord,
} from '../domain/testFixtures';

import {
  dimensionDocumentFromSnapshot,
  dimensionDocumentToSnapshot,
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
      schemaVersion: 1,
      documentId: 'document-round-trip',
      records: state.records,
    });
    expect(Object.hasOwn(snapshot, 'baseVersion')).toBe(false);
    expect(dimensionDocumentFromSnapshot(snapshot, {
      taskId: 'task-1',
      formId: 'form-1',
      baseVersion: 7,
    })).toEqual(state);
  });

  it('rejects an unsupported schema version', () => {
    const malformed = {
      schemaVersion: 2,
      documentId: 'document-1',
      records: [],
    };

    expect(() => dimensionDocumentFromSnapshot(
      malformed as unknown as SnapshotDimensionDocument,
      { baseVersion: 0 },
    )).toThrow(/schemaVersion/);
  });

  it('rejects duplicate record ids', () => {
    const malformed = {
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
