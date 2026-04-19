import { describe, expect, it } from 'vitest';

import {
  buildCommentThreadIndex,
  buildCommentThreadKey,
  compareCommentEntries,
  emptyCommentThreadIndex,
} from './commentThread';

import type { SnapshotComment } from './reviewSnapshot';

function makeComment(partial: Partial<SnapshotComment> & { commentId: string; annotationId: string; createdAt: number }): SnapshotComment {
  return {
    annotationType: 'text',
    content: '',
    ...partial,
  };
}

describe('buildCommentThreadKey', () => {
  it('joins type and id with colon', () => {
    expect(buildCommentThreadKey('text', 'a-1')).toBe('text:a-1');
    expect(buildCommentThreadKey('cloud', 'c-1')).toBe('cloud:c-1');
    expect(buildCommentThreadKey('rect', 'r-1')).toBe('rect:r-1');
    expect(buildCommentThreadKey('obb', 'o-1')).toBe('obb:o-1');
  });
});

describe('compareCommentEntries', () => {
  it('orders by createdAt ASC primarily', () => {
    expect(
      compareCommentEntries(
        { commentId: 'a', annotationId: 'x', annotationType: 'text', content: '', createdAt: 1 },
        { commentId: 'b', annotationId: 'x', annotationType: 'text', content: '', createdAt: 2 },
      ),
    ).toBeLessThan(0);
  });

  it('falls back to commentId when createdAt ties', () => {
    expect(
      compareCommentEntries(
        { commentId: 'a', annotationId: 'x', annotationType: 'text', content: '', createdAt: 1 },
        { commentId: 'b', annotationId: 'x', annotationType: 'text', content: '', createdAt: 1 },
      ),
    ).toBeLessThan(0);
    expect(
      compareCommentEntries(
        { commentId: 'b', annotationId: 'x', annotationType: 'text', content: '', createdAt: 1 },
        { commentId: 'b', annotationId: 'x', annotationType: 'text', content: '', createdAt: 1 },
      ),
    ).toBe(0);
  });
});

describe('buildCommentThreadIndex', () => {
  it('returns empty index for empty input', () => {
    const index = buildCommentThreadIndex([]);
    expect(index.size).toBe(0);
    expect(index.totalEntries).toBe(0);
    expect(index.byKey.size).toBe(0);

    const blank = emptyCommentThreadIndex();
    expect(blank.size).toBe(0);
    expect(blank.byKey.size).toBe(0);
  });

  it('groups comments by (annotationType, annotationId) and sorts entries within thread', () => {
    const comments: SnapshotComment[] = [
      makeComment({ commentId: 'c-2', annotationId: 'a-1', createdAt: 200 }),
      makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 100 }),
      makeComment({ commentId: 'c-3', annotationId: 'a-2', annotationType: 'cloud', createdAt: 50 }),
    ];
    const index = buildCommentThreadIndex(comments);

    expect(index.size).toBe(2);
    expect(index.totalEntries).toBe(3);

    const text = index.byKey.get('text:a-1');
    expect(text).toBeDefined();
    expect(text?.entries.map((e) => e.commentId)).toEqual(['c-1', 'c-2']);
    expect(text?.entries.map((e) => e.threadOrder)).toEqual([0, 1]);

    const cloud = index.byKey.get('cloud:a-2');
    expect(cloud).toBeDefined();
    expect(cloud?.entries.map((e) => e.commentId)).toEqual(['c-3']);
  });

  it('preserves insertion order when sort=false (for perf baseline scenarios)', () => {
    const comments: SnapshotComment[] = [
      makeComment({ commentId: 'c-2', annotationId: 'a-1', createdAt: 200 }),
      makeComment({ commentId: 'c-1', annotationId: 'a-1', createdAt: 100 }),
    ];
    const index = buildCommentThreadIndex(comments, { sort: false });
    expect(index.byKey.get('text:a-1')?.entries.map((e) => e.commentId)).toEqual(['c-2', 'c-1']);
  });

  it('keeps original SnapshotComment fields untouched on entries', () => {
    const comment = makeComment({
      commentId: 'c-1',
      annotationId: 'a-1',
      createdAt: 1,
      content: 'hello',
      authorId: 'u-1',
    });
    const index = buildCommentThreadIndex([comment]);
    const entry = index.byKey.get('text:a-1')?.entries[0];
    expect(entry?.content).toBe('hello');
    expect(entry?.authorId).toBe('u-1');
    expect(entry?.threadOrder).toBe(0);
  });
});
