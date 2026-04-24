/**
 * Comment Thread 领域类型 —— M3 评论真源解耦的基础。
 *
 * 设计要点：
 *   - 复用 M2 引入的 `SnapshotComment`，避免类型重复；
 *   - thread 内顺序按 `(createdAt ASC, commentId ASC)`，store 与 inline 投影
 *     使用相同排序规则；
 *   - 索引 key 为 `${annotationType}:${annotationId}`，与 M2
 *     `snapshotInlineCommentKey` 对齐，方便后续从 snapshot 直接构造 index。
 */

import {
  type SnapshotAnnotationType,
  type SnapshotComment,
} from '../domain/reviewSnapshot';

export type CommentThreadKey = `${SnapshotAnnotationType}:${string}`;

export type CommentThreadEntry = {
  /** Store 在 upsert 时填入；线程内稳定排序键。 */
  threadOrder: number;
} & SnapshotComment

export type CommentThread = {
  key: CommentThreadKey;
  annotationId: string;
  annotationType: SnapshotAnnotationType;
  entries: readonly CommentThreadEntry[];
}

export type CommentThreadIndex = {
  byKey: ReadonlyMap<CommentThreadKey, CommentThread>;
  size: number;
  totalEntries: number;
}

export function buildCommentThreadKey(
  annotationType: SnapshotAnnotationType,
  annotationId: string,
): CommentThreadKey {
  return `${annotationType}:${annotationId}` as CommentThreadKey;
}

export function compareCommentEntries(
  a: SnapshotComment,
  b: SnapshotComment,
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.commentId < b.commentId) return -1;
  if (a.commentId > b.commentId) return 1;
  return 0;
}

export type BuildCommentThreadIndexOptions = {
  /** 默认 true：稳定排序 entries；置 false 用于性能基线测试。 */
  sort?: boolean;
}

export function buildCommentThreadIndex(
  comments: readonly SnapshotComment[],
  options: BuildCommentThreadIndexOptions = {},
): CommentThreadIndex {
  const sort = options.sort !== false;
  const buckets = new Map<CommentThreadKey, CommentThreadEntry[]>();

  for (const comment of comments) {
    const key = buildCommentThreadKey(comment.annotationType, comment.annotationId);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push({ ...comment, threadOrder: 0 });
  }

  const byKey = new Map<CommentThreadKey, CommentThread>();
  let totalEntries = 0;
  for (const [key, bucket] of buckets.entries()) {
    if (sort) bucket.sort(compareCommentEntries);
    bucket.forEach((entry, idx) => {
      entry.threadOrder = idx;
    });
    const sample = bucket[0];
    byKey.set(key, {
      key,
      annotationId: sample.annotationId,
      annotationType: sample.annotationType,
      entries: bucket,
    });
    totalEntries += bucket.length;
  }

  return {
    byKey,
    size: byKey.size,
    totalEntries,
  };
}

export function emptyCommentThreadIndex(): CommentThreadIndex {
  return {
    byKey: new Map(),
    size: 0,
    totalEntries: 0,
  };
}
