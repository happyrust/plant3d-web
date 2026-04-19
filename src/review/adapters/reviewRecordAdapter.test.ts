import { describe, expect, it } from 'vitest';

import {
  REVIEW_RECORD_SNAPSHOT_VERSION,
  buildSnapshotFromTaskRecords,
} from './reviewRecordAdapter';

import type { ConfirmedRecord } from '@/composables/useReviewStore';
import type {
  AnnotationRecord,
  CloudAnnotationRecord,
  RectAnnotationRecord,
  ObbAnnotationRecord,
  DistanceMeasurementRecord,
  AngleMeasurementRecord,
  MeasurementPoint,
} from '@/composables/useToolStore';

import { UserRole, type AnnotationComment } from '@/types/auth';

const FIXED_NOW = 1_700_000_000_000;

function makeTextAnnotation(
  id: string,
  comments?: AnnotationComment[],
): AnnotationRecord {
  return {
    id,
    entityId: `entity-${id}`,
    worldPos: [0, 0, 0],
    visible: true,
    glyph: 'M',
    title: `t-${id}`,
    description: `d-${id}`,
    createdAt: 1,
    comments,
  };
}

function makeCloudAnnotation(id: string): CloudAnnotationRecord {
  return {
    id,
    objectIds: [],
    anchorWorldPos: [1, 2, 3],
    visible: true,
    title: `cloud-${id}`,
    description: '',
    createdAt: 1,
  };
}

function makeRectAnnotation(id: string): RectAnnotationRecord {
  return {
    id,
    objectIds: [],
    obb: {
      center: [0, 0, 0],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      halfSize: [1, 1, 1],
      corners: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    },
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: `rect-${id}`,
    description: '',
    createdAt: 1,
  };
}

function makeObbAnnotation(id: string): ObbAnnotationRecord {
  return {
    id,
    objectIds: [],
    obb: {
      center: [0, 0, 0],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      halfSize: [1, 1, 1],
      corners: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    },
    labelWorldPos: [0, 0, 0],
    anchor: { kind: 'top_center' },
    visible: true,
    title: `obb-${id}`,
    description: '',
    createdAt: 1,
  };
}

function makePoint(entityId: string): MeasurementPoint {
  return { entityId, worldPos: [0, 0, 0] };
}

function makeDistance(id: string): DistanceMeasurementRecord {
  return {
    id,
    kind: 'distance',
    origin: makePoint('a'),
    target: makePoint('b'),
    visible: true,
    createdAt: 1,
  };
}

function makeAngle(id: string): AngleMeasurementRecord {
  return {
    id,
    kind: 'angle',
    origin: makePoint('a'),
    corner: makePoint('b'),
    target: makePoint('c'),
    visible: true,
    createdAt: 1,
  };
}

function makeRecord(partial: Partial<ConfirmedRecord> & { id: string }): ConfirmedRecord {
  return {
    type: 'batch',
    annotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    obbAnnotations: [],
    measurements: [],
    confirmedAt: 0,
    note: '',
    ...partial,
  };
}

describe('buildSnapshotFromTaskRecords', () => {
  it('returns an empty snapshot for empty input but stamps source/version/now', () => {
    const snapshot = buildSnapshotFromTaskRecords([], {
      taskId: 'task-1',
      now: () => FIXED_NOW,
    });

    expect(snapshot.source).toBe('task_records');
    expect(snapshot.taskId).toBe('task-1');
    expect(snapshot.annotations).toEqual([]);
    expect(snapshot.comments).toEqual([]);
    expect(snapshot.measurements).toEqual([]);
    expect(snapshot.meta.sourceVersion).toBe(REVIEW_RECORD_SNAPSHOT_VERSION);
    expect(snapshot.meta.createdAt).toBe(FIXED_NOW);
    expect(snapshot.meta.inlineCommentIndex).toBeUndefined();
  });

  it('flattens annotations across categories preserving order', () => {
    const r0 = makeRecord({
      id: 'r0',
      taskId: 'task-1',
      annotations: [makeTextAnnotation('t0a'), makeTextAnnotation('t0b')],
      cloudAnnotations: [makeCloudAnnotation('c0')],
      rectAnnotations: [makeRectAnnotation('rc0')],
      obbAnnotations: [makeObbAnnotation('o0')],
    });
    const r1 = makeRecord({
      id: 'r1',
      taskId: 'task-1',
      annotations: [makeTextAnnotation('t1')],
      cloudAnnotations: [makeCloudAnnotation('c1')],
    });

    const snapshot = buildSnapshotFromTaskRecords([r0, r1], {
      taskId: 'task-1',
      now: () => FIXED_NOW,
    });

    const ids = snapshot.annotations.map((a) => `${a.annotationType}:${a.annotationId}`);
    expect(ids).toEqual([
      'text:t0a',
      'text:t0b',
      'cloud:c0',
      'rect:rc0',
      'obb:o0',
      'text:t1',
      'cloud:c1',
    ]);
    expect(snapshot.annotations.every((a) => a.taskId === 'task-1')).toBe(true);
    expect(snapshot.annotations[0].payload).toMatchObject({ id: 't0a', glyph: 'M' });
  });

  it('ignores items without a string id', () => {
    const r0 = makeRecord({
      id: 'r0',
      annotations: [
        makeTextAnnotation('t0'),
        { ...makeTextAnnotation(''), id: '' },
      ],
      measurements: [makeDistance('m0'), { ...makeDistance(''), id: '' }],
    });

    const snapshot = buildSnapshotFromTaskRecords([r0]);
    expect(snapshot.annotations.map((a) => a.annotationId)).toEqual(['t0']);
    expect(snapshot.measurements.map((m) => m.measurementId)).toEqual(['m0']);
  });

  it('lifts inline annotation comments and records inline index', () => {
    const comment: AnnotationComment = {
      id: 'cm-1',
      annotationId: 't0',
      annotationType: 'text',
      authorId: 'u-1',
      authorName: 'Alice',
      authorRole: UserRole.REVIEWER,
      content: 'review opinion',
      createdAt: 1_700_000_001,
    };
    const r0 = makeRecord({
      id: 'r0',
      taskId: 'task-1',
      annotations: [makeTextAnnotation('t0', [comment])],
      cloudAnnotations: [makeCloudAnnotation('c0')],
    });

    const snapshot = buildSnapshotFromTaskRecords([r0], {
      taskId: 'task-1',
      workflowNode: 'jd',
    });

    expect(snapshot.comments).toHaveLength(1);
    expect(snapshot.comments[0]).toMatchObject({
      commentId: 'cm-1',
      annotationId: 't0',
      annotationType: 'text',
      authorId: 'u-1',
      authorRole: UserRole.REVIEWER,
      taskId: 'task-1',
      workflowNode: 'jd',
    });
    expect(snapshot.meta.inlineCommentIndex).toEqual(['text:t0']);

    expect(snapshot.annotations[0].payload.comments).toEqual([comment]);
  });

  it('normalizes measurement kind and preserves payload', () => {
    const distance = makeDistance('d-1');
    const angle = makeAngle('a-1');
    const r0 = makeRecord({
      id: 'r0',
      measurements: [distance, angle],
    });

    const snapshot = buildSnapshotFromTaskRecords([r0]);
    expect(snapshot.measurements).toEqual([
      { measurementId: 'd-1', kind: 'distance', payload: { ...distance } },
      { measurementId: 'a-1', kind: 'angle', payload: { ...angle } },
    ]);
  });

  it('inherits taskId from per-record when options.taskId is missing', () => {
    const r0 = makeRecord({
      id: 'r0',
      taskId: 'inner-task',
      annotations: [makeTextAnnotation('t0')],
    });
    const snapshot = buildSnapshotFromTaskRecords([r0]);
    expect(snapshot.annotations[0].taskId).toBe('inner-task');
  });
});
