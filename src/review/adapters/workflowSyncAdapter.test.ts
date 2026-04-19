import { describe, expect, it } from 'vitest';

import { buildReplayPayloadFromSnapshot } from './toolStoreAdapter';
import {
  WORKFLOW_SYNC_SNAPSHOT_VERSION,
  buildSnapshotFromWorkflowSync,
} from './workflowSyncAdapter';

import type {
  WorkflowAnnotationCommentData,
  WorkflowRecordData,
  WorkflowSyncData,
} from '@/api/reviewApi';

import { buildWorkflowSnapshotReplayPayload } from '@/components/review/reviewRecordReplay';
import { UserRole } from '@/types/auth';

const FIXED_NOW = 1_700_000_000_000;

function makeRecord(partial: Partial<WorkflowRecordData> & { id: string }): WorkflowRecordData {
  return {
    taskId: 'task-1',
    type: 'batch',
    annotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    obbAnnotations: [],
    measurements: [],
    note: '',
    confirmedAt: '2026-04-19 00:00:00',
    ...partial,
  };
}

function makeTextItem(id: string) {
  return {
    id,
    entityId: `entity-${id}`,
    worldPos: [0, 0, 0],
    visible: true,
    glyph: 'M',
    title: `t-${id}`,
    description: '',
    createdAt: 1,
  };
}

function makeCloudItem(id: string) {
  return {
    id,
    objectIds: [],
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: `c-${id}`,
    description: '',
    createdAt: 1,
  };
}

function makeDistanceItem(id: string) {
  return {
    id,
    kind: 'distance',
    origin: { entityId: 'a', worldPos: [0, 0, 0] },
    target: { entityId: 'b', worldPos: [1, 1, 1] },
    visible: true,
    createdAt: 1,
  };
}

function makeAngleItem(id: string) {
  return {
    id,
    kind: 'angle',
    origin: { entityId: 'a', worldPos: [0, 0, 0] },
    corner: { entityId: 'b', worldPos: [1, 0, 0] },
    target: { entityId: 'c', worldPos: [1, 1, 0] },
    visible: true,
    createdAt: 1,
  };
}

function makeComment(
  partial: Partial<WorkflowAnnotationCommentData> & { id: string; annotationId: string; annotationType: string },
): WorkflowAnnotationCommentData {
  return {
    authorId: 'u-1',
    authorName: 'Alice',
    // 后端约定：'sh' 对应审核（REVIEWER），见 src/types/auth.ts backendRoleMapping
    authorRole: 'sh',
    content: 'opinion',
    createdAt: '2026-04-19 00:01:00',
    ...partial,
  };
}

describe('buildSnapshotFromWorkflowSync', () => {
  it('returns empty snapshot for null/undefined input but stamps source/version/now', () => {
    const snapshot = buildSnapshotFromWorkflowSync(undefined, { now: () => FIXED_NOW });
    expect(snapshot.source).toBe('workflow_sync');
    expect(snapshot.taskId).toBeUndefined();
    expect(snapshot.workflowNode).toBeUndefined();
    expect(snapshot.taskStatus).toBeUndefined();
    expect(snapshot.annotations).toEqual([]);
    expect(snapshot.comments).toEqual([]);
    expect(snapshot.measurements).toEqual([]);
    expect(snapshot.attachments).toEqual([]);
    expect(snapshot.models).toEqual([]);
    expect(snapshot.meta.sourceVersion).toBe(WORKFLOW_SYNC_SNAPSHOT_VERSION);
    expect(snapshot.meta.createdAt).toBe(FIXED_NOW);
    expect(snapshot.meta.raw).toBeUndefined();
  });

  it('captures meta.raw and normalizes workflowNode for workflow_sync data', () => {
    const data: WorkflowSyncData = {
      models: [],
      taskId: 'task-9',
      records: [],
      annotationComments: [],
      attachments: [],
      currentNode: 'jd',
      taskStatus: 'in_progress',
      formExists: true,
      formStatus: 'open',
      taskCreated: true,
      title: 'demo',
    };

    const snapshot = buildSnapshotFromWorkflowSync(data, { now: () => FIXED_NOW });
    expect(snapshot.taskId).toBe('task-9');
    expect(snapshot.workflowNode).toBe('jd');
    expect(snapshot.taskStatus).toBe('in_progress');
    expect(snapshot.meta.raw).toEqual({
      currentNode: 'jd',
      taskStatus: 'in_progress',
      formExists: true,
      formStatus: 'open',
      taskCreated: true,
      title: 'demo',
    });
  });

  it('drops illegal currentNode but keeps it inside meta.raw', () => {
    const data: WorkflowSyncData = {
      models: [],
      records: [],
      annotationComments: [],
      attachments: [],
      currentNode: 'unknown',
    };
    const snapshot = buildSnapshotFromWorkflowSync(data);
    expect(snapshot.workflowNode).toBeUndefined();
    expect(snapshot.meta.raw?.currentNode).toBe('unknown');
  });

  it('matches legacy buildWorkflowSnapshotReplayPayload byte-for-byte', () => {
    const records: WorkflowRecordData[] = [
      makeRecord({
        id: 'r0',
        annotations: [makeTextItem('t0a'), makeTextItem('t0b')],
        cloudAnnotations: [makeCloudItem('c0')],
        measurements: [makeDistanceItem('d0')],
      }),
      makeRecord({
        id: 'r1',
        annotations: [makeTextItem('t1')],
        measurements: [makeAngleItem('a1')],
      }),
    ];
    const comments: WorkflowAnnotationCommentData[] = [
      makeComment({ id: 'cm-1', annotationId: 't0a', annotationType: 'text' }),
      makeComment({ id: 'cm-2', annotationId: 'c0', annotationType: 'cloud' }),
    ];

    const data: WorkflowSyncData = {
      models: ['model-1', { model_refno: 'model-2' }, 'model-1'],
      records,
      annotationComments: comments,
      attachments: [
        { id: 'att-1', name: 'a.txt', url: '/a.txt', uploadedAt: 1 },
        { id: 'att-2', name: 'b.png', url: '/b.png', uploadedAt: 2 },
      ],
      currentNode: 'jd',
      taskStatus: 'in_progress',
    };

    const golden = buildWorkflowSnapshotReplayPayload(records, comments);

    const snapshot = buildSnapshotFromWorkflowSync(data, { now: () => FIXED_NOW });
    const adapted = buildReplayPayloadFromSnapshot(snapshot);

    expect(adapted).toBe(golden);

    expect(snapshot.attachments.map((a) => a.id)).toEqual(['att-1', 'att-2']);
    expect(snapshot.models).toEqual(['model-1', 'model-2']);
    expect(snapshot.comments).toHaveLength(2);
    expect(snapshot.comments[0]).toMatchObject({
      commentId: 'cm-1',
      annotationId: 't0a',
      annotationType: 'text',
      authorRole: UserRole.REVIEWER,
      taskId: 'task-1',
      workflowNode: 'jd',
    });

    expect(snapshot.meta.inlineCommentIndex).toEqual(['text:t0a', 'cloud:c0']);

    const textPayload = snapshot.annotations.find((a) => a.annotationId === 't0a')?.payload as
      | { comments?: unknown[] }
      | undefined;
    expect(textPayload?.comments).toBeDefined();
    expect(textPayload?.comments).toHaveLength(1);
  });

  it('keeps order across records and types when comments missing', () => {
    const records: WorkflowRecordData[] = [
      makeRecord({
        id: 'r0',
        annotations: [makeTextItem('t0')],
        cloudAnnotations: [makeCloudItem('c0')],
      }),
      makeRecord({
        id: 'r1',
        annotations: [makeTextItem('t1')],
      }),
    ];
    const data: WorkflowSyncData = {
      models: [],
      records,
      annotationComments: [],
      attachments: [],
    };

    const golden = buildWorkflowSnapshotReplayPayload(records, []);
    const snapshot = buildSnapshotFromWorkflowSync(data);
    const adapted = buildReplayPayloadFromSnapshot(snapshot);

    expect(adapted).toBe(golden);
    expect(
      snapshot.annotations.map((a) => `${a.annotationType}:${a.annotationId}`),
    ).toEqual(['text:t0', 'cloud:c0', 'text:t1']);
  });
});
