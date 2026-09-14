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
      xeokitDistanceMeasurements: [{
        id: 'dist-1',
        origin: { entityId: 'a', worldPos: [0, 0, 0] },
        target: { entityId: 'b', worldPos: [1, 0, 0] },
        visible: true,
        createdAt: 1,
      }],
      xeokitAngleMeasurements: [{
        id: 'angle-1',
        origin: { entityId: 'a', worldPos: [0, 0, 0] },
        corner: { entityId: 'b', worldPos: [1, 0, 0] },
        target: { entityId: 'c', worldPos: [1, 1, 0] },
        visible: true,
        createdAt: 2,
      }],
    };

    const snapshot = buildSnapshotFromImportPayload(payload);
    const replay = JSON.parse(buildReplayPayloadFromImportSnapshot(snapshot));

    expect(replay).toMatchObject({
      version: 7,
      annotations: [{ id: 'text-1', title: 'text' }],
      obbAnnotations: [{ id: 'obb-1', title: 'obb' }],
      cloudAnnotations: [{
        id: 'cloud-1',
        title: 'cloud',
        bindings: [{ refno: 'REF/A', role: 'member', noun: 'PIPE', createdAt: 1 }],
      }],
      rectAnnotations: [{ id: 'rect-1', title: 'rect' }],
      legacyMeasurements: [{ id: 'legacy-m', kind: 'legacy' }],
    });
    expect(replay.measurements).toEqual([
      expect.objectContaining({
        id: 'dist-1',
        kind: 'distance',
        source: 'replay',
        approximate: true,
        provenance: expect.objectContaining({ accuracyClass: 'legacy-unknown' }),
      }),
      expect.objectContaining({
        id: 'angle-1',
        kind: 'angle',
        source: 'replay',
        approximate: true,
        provenance: expect.objectContaining({ accuracyClass: 'legacy-unknown' }),
      }),
    ]);
    expect(replay).not.toHaveProperty('xeokitDistanceMeasurements');
    expect(replay).not.toHaveProperty('xeokitAngleMeasurements');
  });

  it('import_package 链路整对象透传云线空间范围体四字段，显式 null 与未知版本都不丢', () => {
    const regionFields = {
      regionV1: {
        version: 1, space: 'world', origin: 'legacy-snapshot', kind: 'obb-union',
        source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null },
        boxes: [{ id: 'legacy-snapshot:0', memberRefno: null, center: [1, 1, 1], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [1, 1, 1] }],
      },
      presentationV1: { version: 1, algorithm: 'legacy-v0', contour: 'screen-rect', paddingPx: 14, wavelengthPx: 52, amplitudePx: 4, phaseAnchor: null },
      viewpointV1: null,
      labelLayoutV1: { version: 1, anchor: { kind: 'contour-bounds', uv: [1, 0], labelPoint: 'top-left' }, offsetPx: { x: 18, y: 0 } },
    };
    const payload = {
      version: 7,
      measurements: [],
      annotations: [],
      cloudAnnotations: [
        { id: 'cloud-region', title: 'cloud', ...regionFields },
        { id: 'cloud-future', title: 'cloud', regionV1: { version: 9, kind: 'mesh', payload: [1, 2, 3] } },
      ],
      rectAnnotations: [],
      obbAnnotations: [],
    };

    const replay = JSON.parse(buildReplayPayloadFromImportSnapshot(buildSnapshotFromImportPayload(payload)));

    expect(replay.cloudAnnotations).toEqual([
      expect.objectContaining({ id: 'cloud-region', ...regionFields }),
      expect.objectContaining({ id: 'cloud-future', regionV1: { version: 9, kind: 'mesh', payload: [1, 2, 3] } }),
    ]);
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
