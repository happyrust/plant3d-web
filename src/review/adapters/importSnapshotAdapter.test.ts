import { describe, expect, it } from 'vitest';

import { buildSnapshotFromImportPayload } from './importSnapshotAdapter';
import { buildReplayPayloadFromImportSnapshot } from './toolStoreAdapter';

describe('buildSnapshotFromImportPayload', () => {
  it('builds import_package snapshot and preserves import payload categories', () => {
    const payload = {
      version: 5,
      measurements: [{ id: 'legacy-m', kind: 'legacy' }],
      annotations: [{ id: 'text-1', title: 'text' }],
      cloudAnnotations: [{
        id: 'cloud-1',
        title: 'cloud',
        bindings: [{ refno: 'REF/A', role: 'member', noun: 'PIPE', createdAt: 1 }],
      }],
      rectAnnotations: [{ id: 'rect-1', title: 'rect' }],
      obbAnnotations: [{ id: 'obb-1', title: 'obb' }],
      xeokitDistanceMeasurements: [{ id: 'dist-1', visible: true }],
      xeokitAngleMeasurements: [{ id: 'angle-1', visible: true }],
    };

    const snapshot = buildSnapshotFromImportPayload(payload, {
      taskId: 'task-import',
      formId: 'FORM-IMPORT',
      workflowNode: 'jd',
      taskStatus: 'draft',
      now: () => 123,
    });

    expect(snapshot.source).toBe('import_package');
    expect(snapshot.taskId).toBe('task-import');
    expect(snapshot.formId).toBe('FORM-IMPORT');
    expect(snapshot.workflowNode).toBe('jd');
    expect(snapshot.taskStatus).toBe('draft');
    expect(snapshot.meta.createdAt).toBe(123);
    expect(snapshot.meta.raw).toEqual({ version: 5 });
    expect(snapshot.annotations.map((item) => `${item.annotationType}:${item.annotationId}`)).toEqual([
      'text:text-1',
      'cloud:cloud-1',
      'rect:rect-1',
      'obb:obb-1',
    ]);
    expect(snapshot.measurements.map((item) => `${item.kind}:${item.measurementId}`)).toEqual([
      'unknown:legacy-m',
      'distance:dist-1',
      'angle:angle-1',
    ]);
  });

  it('round-trips snapshot back to original import payload shape', () => {
    const payload = {
      version: 5,
      measurements: [{ id: 'legacy-m', kind: 'legacy' }],
      annotations: [{ id: 'text-1', title: 'text' }],
      cloudAnnotations: [{
        id: 'cloud-1',
        title: 'cloud',
        bindings: [{ refno: 'REF/A', role: 'member', noun: 'PIPE', createdAt: 1 }],
      }],
      rectAnnotations: [{ id: 'rect-1', title: 'rect' }],
      obbAnnotations: [{ id: 'obb-1', title: 'obb' }],
      xeokitDistanceMeasurements: [{ id: 'dist-1', visible: true }],
      xeokitAngleMeasurements: [{ id: 'angle-1', visible: true }],
    };

    const snapshot = buildSnapshotFromImportPayload(payload);

    expect(buildReplayPayloadFromImportSnapshot(snapshot)).toBe(JSON.stringify({
      version: 6,
      measurements: [{ id: 'legacy-m', kind: 'legacy' }],
      annotations: [{ id: 'text-1', title: 'text' }],
      obbAnnotations: [{ id: 'obb-1', title: 'obb' }],
      cloudAnnotations: [{
        id: 'cloud-1',
        title: 'cloud',
        bindings: [{ refno: 'REF/A', role: 'member', noun: 'PIPE', createdAt: 1 }],
      }],
      rectAnnotations: [{ id: 'rect-1', title: 'rect' }],
      xeokitDistanceMeasurements: [{ id: 'dist-1', visible: true }],
      xeokitAngleMeasurements: [{ id: 'angle-1', visible: true }],
      xeokitElevationPointMeasurements: [],
      xeokitElevationDeltaMeasurements: [],
    }));
  });

  it('copies a dimension document without restoring the removed legacy dimensions field', () => {
    const dimensionDocument = {
      schemaVersion: 2 as const,
      documentId: 'imported-dimension-document',
      records: [],
    };
    const snapshot = buildSnapshotFromImportPayload({
      version: 6,
      dimensionDocument,
      dimensionDocumentVersion: 3,
    });

    expect(snapshot.dimensionDocument).toEqual(dimensionDocument);
    expect(snapshot.dimensionDocumentVersion).toBe(3);
    const replay = JSON.parse(
      buildReplayPayloadFromImportSnapshot(snapshot),
    ) as Record<string, unknown>;
    expect(replay).not.toHaveProperty('dimensions');
    expect(replay).not.toHaveProperty('dimensionDocument');
  });
});
