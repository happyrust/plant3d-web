import { describe, expect, it, vi } from 'vitest';

import { buildCommentThreadKey } from '../domain/commentThread';
import { createEmptyReviewSnapshot, type SnapshotComment } from '../domain/reviewSnapshot';

import { createCommentThreadStore } from './commentThreadStore';

function makeComment(
  partial: Partial<SnapshotComment> & { commentId: string; annotationId: string; createdAt: number },
): SnapshotComment {
  return {
    annotationType: 'text',
    content: '',
    ...partial,
  };
}

describe('createCommentThreadStore', () => {
  it('starts empty', () => {
    const store = createCommentThreadStore();
    const idx = store.getIndex();
    expect(idx.size).toBe(0);
    expect(idx.totalEntries).toBe(0);
    expect(store.getAllThreads()).toEqual([]);
  });

  it('mergeFromSnapshot rebuilds index, notifies once, then is idempotent', () => {
    const store = createCommentThreadStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const snapshot = createEmptyReviewSnapshot({ source: 'task_records' });
    snapshot.comments.push(
      makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1 }),
      makeComment({ commentId: 'c-2', annotationId: 'a-1', createdAt: 2 }),
      makeComment({ commentId: 'c-3', annotationId: 'a-2', annotationType: 'cloud', createdAt: 1 }),
    );

    expect(store.mergeFromSnapshot(snapshot).changed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(store.getIndex().size).toBe(2);
    expect(store.getIndex().totalEntries).toBe(3);
    expect(store.getThread(buildCommentThreadKey('text', 'a-1'))?.entries.map((e) => e.commentId)).toEqual([
      'c-1',
      'c-2',
    ]);

    // Same snapshot again → no change, no notify
    expect(store.mergeFromSnapshot(snapshot).changed).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('upsertComment inserts when commentId missing and notifies', () => {
    const store = createCommentThreadStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(
      store.upsertComment(makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1 })).changed,
    ).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(store.getIndex().totalEntries).toBe(1);
    expect(store.getThread(buildCommentThreadKey('text', 'a-1'))?.entries[0].commentId).toBe('c-1');
  });

  it('upsertComment replaces existing entry by commentId, notifies only when changed', () => {
    const store = createCommentThreadStore();
    store.upsertComment(makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'v1' }));

    const listener = vi.fn();
    store.subscribe(listener);

    expect(
      store.upsertComment(makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1, content: 'v1' })).changed,
    ).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    expect(
      store.upsertComment(makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 5, content: 'v2' })).changed,
    ).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getThread(buildCommentThreadKey('text', 'a-1'))?.entries[0].createdAt).toBe(5);
  });

  it('deleteComment removes entry and clears empty thread', () => {
    const store = createCommentThreadStore();
    store.upsertComment(makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1 }));
    store.upsertComment(makeComment({ commentId: 'c-2', annotationId: 'a-1', createdAt: 2 }));

    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.deleteComment(buildCommentThreadKey('text', 'a-1'), 'c-1').changed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getThread(buildCommentThreadKey('text', 'a-1'))?.entries.map((e) => e.commentId)).toEqual([
      'c-2',
    ]);

    expect(store.deleteComment(buildCommentThreadKey('text', 'a-1'), 'c-2').changed).toBe(true);
    expect(store.getThread(buildCommentThreadKey('text', 'a-1'))).toBeUndefined();
    expect(store.getIndex().totalEntries).toBe(0);
  });

  it('deleteComment on missing entry does nothing', () => {
    const store = createCommentThreadStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.deleteComment(buildCommentThreadKey('text', 'a-x'), 'missing').changed).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('clear() empties the store and notifies once', () => {
    const store = createCommentThreadStore();
    store.upsertComment(makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1 }));

    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.clear().changed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getIndex().totalEntries).toBe(0);

    expect(store.clear().changed).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribe returns unsubscribe handle', () => {
    const store = createCommentThreadStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.upsertComment(makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 1 }));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.upsertComment(makeComment({ commentId: 'c-2', annotationId: 'a-1', createdAt: 2 }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
