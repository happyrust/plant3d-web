import { describe, expect, it } from 'vitest';

import {
  REVIEW_SNAPSHOT_DEFAULT_VERSION,
  createEmptyReviewSnapshot,
  isSnapshotEmpty,
  liftAnnotationComment,
  lowerSnapshotComment,
  snapshotInlineCommentKey,
} from './reviewSnapshot';

import type { AnnotationComment } from '@/types/auth';

import { UserRole } from '@/types/auth';

describe('createEmptyReviewSnapshot', () => {
  it('produces empty arrays and default meta', () => {
    const snapshot = createEmptyReviewSnapshot({
      source: 'task_records',
      taskId: 'task-001',
      createdAt: 1_700_000_000,
    });

    expect(snapshot.source).toBe('task_records');
    expect(snapshot.taskId).toBe('task-001');
    expect(snapshot.formId).toBeUndefined();
    expect(snapshot.workflowNode).toBeUndefined();
    expect(snapshot.taskStatus).toBeUndefined();
    expect(snapshot.annotations).toEqual([]);
    expect(snapshot.comments).toEqual([]);
    expect(snapshot.measurements).toEqual([]);
    expect(snapshot.attachments).toEqual([]);
    expect(snapshot.models).toEqual([]);
    expect(snapshot.meta.sourceVersion).toBe(REVIEW_SNAPSHOT_DEFAULT_VERSION);
    expect(snapshot.meta.createdAt).toBe(1_700_000_000);
    expect(snapshot.meta.inlineCommentIndex).toBeUndefined();
    expect(snapshot.meta.raw).toBeUndefined();
  });

  it('respects custom sourceVersion and raw', () => {
    const snapshot = createEmptyReviewSnapshot({
      source: 'workflow_sync',
      formId: 'form-9',
      workflowNode: 'jd',
      taskStatus: 'in_progress',
      sourceVersion: 7,
      raw: { currentNode: 'jd', formExists: true },
    });

    expect(snapshot.source).toBe('workflow_sync');
    expect(snapshot.formId).toBe('form-9');
    expect(snapshot.workflowNode).toBe('jd');
    expect(snapshot.taskStatus).toBe('in_progress');
    expect(snapshot.meta.sourceVersion).toBe(7);
    expect(snapshot.meta.raw).toEqual({ currentNode: 'jd', formExists: true });
  });
});

describe('snapshotInlineCommentKey', () => {
  it('joins type and id with colon', () => {
    expect(snapshotInlineCommentKey('text', 'a-1')).toBe('text:a-1');
    expect(snapshotInlineCommentKey('cloud', 'c-1')).toBe('cloud:c-1');
    expect(snapshotInlineCommentKey('rect', 'r-1')).toBe('rect:r-1');
    expect(snapshotInlineCommentKey('obb', 'o-1')).toBe('obb:o-1');
  });
});

describe('isSnapshotEmpty', () => {
  it('returns true for a freshly created snapshot', () => {
    const snapshot = createEmptyReviewSnapshot({ source: 'task_records' });
    expect(isSnapshotEmpty(snapshot)).toBe(true);
  });

  it('returns false when annotations / comments / measurements / models / attachments populated', () => {
    const baseline = createEmptyReviewSnapshot({ source: 'task_records' });

    expect(
      isSnapshotEmpty({
        ...baseline,
        annotations: [
          { annotationId: 'a', annotationType: 'text', payload: {} },
        ],
      }),
    ).toBe(false);

    expect(
      isSnapshotEmpty({
        ...baseline,
        comments: [
          {
            commentId: 'c',
            annotationId: 'a',
            annotationType: 'text',
            content: 'x',
            createdAt: 1,
          },
        ],
      }),
    ).toBe(false);

    expect(
      isSnapshotEmpty({
        ...baseline,
        measurements: [{ measurementId: 'm', kind: 'distance', payload: {} }],
      }),
    ).toBe(false);

    expect(
      isSnapshotEmpty({
        ...baseline,
        models: ['model-1'],
      }),
    ).toBe(false);

    expect(
      isSnapshotEmpty({
        ...baseline,
        attachments: [
          {
            id: 'att-1',
            name: 'a.txt',
            url: '/a.txt',
            uploadedAt: 1,
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('liftAnnotationComment', () => {
  const raw: AnnotationComment = {
    id: 'c-1',
    annotationId: 'a-1',
    annotationType: 'text',
    authorId: 'u-1',
    authorName: 'Alice',
    authorRole: UserRole.REVIEWER,
    content: 'hello',
    replyToId: 'c-0',
    createdAt: 1_700_000_001,
  };

  it('preserves identity fields and copies context', () => {
    const lifted = liftAnnotationComment(raw, {
      annotationType: 'text',
      taskId: 'task-1',
      workflowNode: 'jd',
      reviewRound: 2,
    });

    expect(lifted).toEqual({
      commentId: 'c-1',
      annotationId: 'a-1',
      annotationType: 'text',
      authorId: 'u-1',
      authorName: 'Alice',
      authorRole: UserRole.REVIEWER,
      content: 'hello',
      replyToId: 'c-0',
      createdAt: 1_700_000_001,
      taskId: 'task-1',
      formId: undefined,
      workflowNode: 'jd',
      reviewRound: 2,
    });
  });
});

describe('lowerSnapshotComment', () => {
  it('converts SnapshotComment back to AnnotationComment', () => {
    const snapshot = {
      commentId: 'c-1',
      annotationId: 'a-1',
      annotationType: 'text' as const,
      authorId: 'u-1',
      authorName: 'Alice',
      authorRole: UserRole.REVIEWER,
      content: 'hello',
      replyToId: 'c-0',
      createdAt: 1_700_000_001,
      taskId: 'task-1',
      formId: 'form-1',
      workflowNode: 'jd' as const,
      reviewRound: 2,
    };

    const lowered = lowerSnapshotComment(snapshot);

    expect(lowered).toEqual({
      id: 'c-1',
      annotationId: 'a-1',
      annotationType: 'text',
      authorId: 'u-1',
      authorName: 'Alice',
      authorRole: UserRole.REVIEWER,
      content: 'hello',
      replyToId: 'c-0',
      createdAt: 1_700_000_001,
    });
  });

  it('handles missing optional fields with defaults', () => {
    const snapshot = {
      commentId: 'c-2',
      annotationId: 'a-2',
      annotationType: 'cloud' as const,
      content: 'note',
      createdAt: 1_700_000_002,
    };

    const lowered = lowerSnapshotComment(snapshot);

    expect(lowered.id).toBe('c-2');
    expect(lowered.authorId).toBe('');
    expect(lowered.authorName).toBe('');
    expect(lowered.authorRole).toBe('viewer');
    expect(lowered.replyToId).toBeUndefined();
  });

  it('roundtrips with liftAnnotationComment', () => {
    const original: AnnotationComment = {
      id: 'c-3',
      annotationId: 'a-3',
      annotationType: 'rect',
      authorId: 'u-2',
      authorName: 'Bob',
      authorRole: UserRole.DESIGNER,
      content: 'fix this',
      createdAt: 1_700_000_003,
    };

    const lifted = liftAnnotationComment(original, { annotationType: 'rect' });
    const lowered = lowerSnapshotComment(lifted);

    expect(lowered.id).toBe(original.id);
    expect(lowered.annotationId).toBe(original.annotationId);
    expect(lowered.annotationType).toBe(original.annotationType);
    expect(lowered.authorId).toBe(original.authorId);
    expect(lowered.authorName).toBe(original.authorName);
    expect(lowered.content).toBe(original.content);
    expect(lowered.createdAt).toBe(original.createdAt);
  });
});
