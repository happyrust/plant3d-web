import { describe, expect, it } from 'vitest';

import { buildCommentThreadKey } from '../domain/commentThread';

import { createCommentEventLog } from './commentEventLog';
import {
  diffInlineVsStore,
  liftInlineCommentToSnapshot,
  syncInlineToStore,
} from './commentThreadDualRead';
import { createCommentThreadStore } from './commentThreadStore';

import type { SnapshotComment } from '../domain/reviewSnapshot';

import { UserRole, type AnnotationComment } from '@/types/auth';

function makeInline(
  partial: Partial<AnnotationComment> & { id: string; annotationId: string; createdAt: number; content: string },
): AnnotationComment {
  return {
    annotationType: 'text',
    authorId: 'u-1',
    authorName: 'Alice',
    authorRole: UserRole.REVIEWER,
    ...partial,
  };
}

function makeStored(
  partial: Partial<SnapshotComment> & { commentId: string; annotationId: string; createdAt: number; content: string },
): SnapshotComment {
  return {
    annotationType: 'text',
    ...partial,
  };
}

describe('liftInlineCommentToSnapshot', () => {
  it('maps annotation comment to snapshot comment with context', () => {
    const inline = makeInline({ id: 'c-1', annotationId: 'a-1', createdAt: 100, content: 'hello' });
    const lifted = liftInlineCommentToSnapshot(inline, {
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
      replyToId: undefined,
      createdAt: 100,
      taskId: 'task-1',
      formId: undefined,
      workflowNode: 'jd',
      reviewRound: 2,
    });
  });
});

describe('diffInlineVsStore', () => {
  it('returns empty diff when both sides identical', () => {
    const store = createCommentThreadStore();
    store.upsertComment(makeStored({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'x' }));

    const diff = diffInlineVsStore(
      'text',
      'a-1',
      [makeInline({ id: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'x' })],
      store.getIndex(),
    );
    expect(diff).toEqual({
      key: buildCommentThreadKey('text', 'a-1'),
      inlineOnlyIds: [],
      storeOnlyIds: [],
      contentMismatchIds: [],
    });
  });

  it('detects inline-only ids', () => {
    const store = createCommentThreadStore();
    const diff = diffInlineVsStore(
      'text',
      'a-1',
      [makeInline({ id: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'x' })],
      store.getIndex(),
    );
    expect(diff.inlineOnlyIds).toEqual(['c-1']);
    expect(diff.storeOnlyIds).toEqual([]);
    expect(diff.contentMismatchIds).toEqual([]);
  });

  it('detects store-only ids', () => {
    const store = createCommentThreadStore();
    store.upsertComment(makeStored({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'x' }));
    const diff = diffInlineVsStore('text', 'a-1', [], store.getIndex());
    expect(diff.storeOnlyIds).toEqual(['c-1']);
    expect(diff.inlineOnlyIds).toEqual([]);
    expect(diff.contentMismatchIds).toEqual([]);
  });

  it('detects content mismatch by content / createdAt / replyToId', () => {
    const store = createCommentThreadStore();
    store.upsertComment(makeStored({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'old' }));
    const diff = diffInlineVsStore(
      'text',
      'a-1',
      [makeInline({ id: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'new' })],
      store.getIndex(),
    );
    expect(diff.contentMismatchIds).toEqual(['c-1']);

    store.upsertComment(makeStored({ commentId: 'c-2', annotationId: 'a-1', createdAt: 1, content: 'a' }));
    const diff2 = diffInlineVsStore(
      'text',
      'a-1',
      [
        makeInline({ id: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'old' }),
        makeInline({ id: 'c-2', annotationId: 'a-1', createdAt: 2, content: 'a' }),
      ],
      store.getIndex(),
    );
    expect(diff2.contentMismatchIds.sort()).toEqual(['c-2']);

    store.upsertComment(
      makeStored({ commentId: 'c-3', annotationId: 'a-1', createdAt: 1, content: 'r', replyToId: 'c-1' }),
    );
    const diff3 = diffInlineVsStore(
      'text',
      'a-1',
      [
        makeInline({ id: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'old' }),
        makeInline({ id: 'c-2', annotationId: 'a-1', createdAt: 2, content: 'a' }),
        makeInline({ id: 'c-3', annotationId: 'a-1', createdAt: 1, content: 'r', replyToId: 'c-2' }),
      ],
      store.getIndex(),
    );
    expect(diff3.contentMismatchIds).toContain('c-3');
  });
});

describe('syncInlineToStore', () => {
  it('upserts inline-only & mismatch entries and deletes store-only ones', () => {
    const store = createCommentThreadStore();
    store.upsertComment(makeStored({ commentId: 'gone', annotationId: 'a-1', createdAt: 1, content: 'gone' }));
    store.upsertComment(makeStored({ commentId: 'mismatch', annotationId: 'a-1', createdAt: 1, content: 'old' }));
    store.upsertComment(makeStored({ commentId: 'same', annotationId: 'a-1', createdAt: 1, content: 'same' }));

    const log = createCommentEventLog();
    const result = syncInlineToStore(
      'text',
      'a-1',
      [
        makeInline({ id: 'mismatch', annotationId: 'a-1', createdAt: 1, content: 'new' }),
        makeInline({ id: 'same', annotationId: 'a-1', createdAt: 1, content: 'same' }),
        makeInline({ id: 'fresh', annotationId: 'a-1', createdAt: 2, content: 'fresh' }),
      ],
      { store, log },
    );

    expect(result.changed).toBe(true);
    expect(result.diff.inlineOnlyIds).toEqual(['fresh']);
    expect(result.diff.contentMismatchIds).toEqual(['mismatch']);
    expect(result.diff.storeOnlyIds).toEqual(['gone']);

    const thread = store.getThread(buildCommentThreadKey('text', 'a-1'));
    const ids = thread?.entries.map((e) => e.commentId).sort();
    expect(ids).toEqual(['fresh', 'mismatch', 'same']);

    expect(log.size()).toBe(1);
    expect(log.snapshot()[0]).toMatchObject({
      kind: 'dual_read_diff',
      key: 'text:a-1',
    });
  });

  it('skips deletes when applyDeletes=false', () => {
    const store = createCommentThreadStore();
    store.upsertComment(makeStored({ commentId: 'keep-store', annotationId: 'a-1', createdAt: 1, content: 'keep' }));

    syncInlineToStore('text', 'a-1', [], { store, applyDeletes: false });
    expect(store.getThread(buildCommentThreadKey('text', 'a-1'))?.entries.map((e) => e.commentId)).toEqual([
      'keep-store',
    ]);
  });

  it('skips upserts when applyUpserts=false', () => {
    const store = createCommentThreadStore();
    syncInlineToStore(
      'text',
      'a-1',
      [makeInline({ id: 'fresh', annotationId: 'a-1', createdAt: 1, content: 'x' })],
      { store, applyUpserts: false },
    );
    expect(store.getThread(buildCommentThreadKey('text', 'a-1'))).toBeUndefined();
  });

  it('does not push event log when there is no diff', () => {
    const store = createCommentThreadStore();
    store.upsertComment(makeStored({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'x' }));
    const log = createCommentEventLog();
    const result = syncInlineToStore(
      'text',
      'a-1',
      [makeInline({ id: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'x' })],
      { store, log },
    );
    expect(result.changed).toBe(false);
    expect(log.size()).toBe(0);
  });
});
