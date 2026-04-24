/**
 * Comment Thread Store —— M3 评论真源解耦的存储层。
 *
 * 设计要点：
 *   - 函数式工厂：`createCommentThreadStore()` 返回对外 API，便于在 Vue
 *     composition 与单测中复用。
 *   - 真源：`CommentThreadIndex`（不可变 snapshot），所有写入操作返回
 *     `{ changed }`，未变化时 listener 不会被触发。
 *   - 与 M2 衔接：`mergeFromSnapshot(reviewSnapshot)` 直接消费 `SnapshotComment[]`
 *     重建 index；该 API 是 restore 链路初始化 store 的入口。
 *
 * 不在本阶段引入：
 *   - WebSocket 实时推送（由 M5/F `commentSyncService` 接管）；
 *   - 评论编辑/删除走后端 API（仍由现有 `reviewApi` 负责，M3 只完成读路径解耦）；
 *   - Vue reactive：本 store 暴露 plain getter，调用方按需用 `ref`/`shallowRef` 包装。
 */

import {
  type CommentThread,
  type CommentThreadEntry,
  type CommentThreadIndex,
  type CommentThreadKey,
  buildCommentThreadIndex,
  emptyCommentThreadIndex,
} from '../domain/commentThread';

import type { ReviewSnapshot, SnapshotComment } from '../domain/reviewSnapshot';

export type CommentThreadStoreListener = () => void;

export type CommentThreadStore = {
  getIndex(): CommentThreadIndex;
  getThread(key: CommentThreadKey): CommentThread | undefined;
  getAllThreads(): readonly CommentThread[];
  mergeFromSnapshot(snapshot: ReviewSnapshot): { changed: boolean };
  mergeComments(comments: readonly SnapshotComment[]): { changed: boolean };
  upsertComment(comment: SnapshotComment): { changed: boolean };
  deleteComment(key: CommentThreadKey, commentId: string): { changed: boolean };
  clear(): { changed: boolean };
  subscribe(listener: CommentThreadStoreListener): () => void;
}

export function createCommentThreadStore(): CommentThreadStore {
  let index: CommentThreadIndex = emptyCommentThreadIndex();
  let fingerprint = '';
  const listeners = new Set<CommentThreadStoreListener>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function setIndex(next: CommentThreadIndex): boolean {
    const nextFingerprint = computeIndexFingerprint(next);
    if (nextFingerprint === fingerprint) return false;
    index = next;
    fingerprint = nextFingerprint;
    return true;
  }

  return {
    getIndex() {
      return index;
    },
    getThread(key) {
      return index.byKey.get(key);
    },
    getAllThreads() {
      return Array.from(index.byKey.values());
    },
    mergeFromSnapshot(snapshot) {
      return this.mergeComments(snapshot.comments);
    },
    mergeComments(comments) {
      const next = buildCommentThreadIndex(comments);
      const changed = setIndex(next);
      if (changed) notify();
      return { changed };
    },
    upsertComment(comment) {
      const all: SnapshotComment[] = [];
      let replaced = false;
      for (const thread of index.byKey.values()) {
        for (const entry of thread.entries) {
          if (entry.commentId === comment.commentId
            && entry.annotationType === comment.annotationType
            && entry.annotationId === comment.annotationId) {
            all.push(comment);
            replaced = true;
            continue;
          }
          all.push(entry);
        }
      }
      if (!replaced) all.push(comment);

      const next = buildCommentThreadIndex(all);
      const changed = setIndex(next);
      if (changed) notify();
      return { changed };
    },
    deleteComment(key, commentId) {
      const thread = index.byKey.get(key);
      if (!thread) return { changed: false };
      const remaining: SnapshotComment[] = [];
      for (const t of index.byKey.values()) {
        if (t.key === key) {
          for (const entry of t.entries) {
            if (entry.commentId !== commentId) remaining.push(entry);
          }
        } else {
          remaining.push(...t.entries);
        }
      }
      const next = buildCommentThreadIndex(remaining);
      const changed = setIndex(next);
      if (changed) notify();
      return { changed };
    },
    clear() {
      const empty = emptyCommentThreadIndex();
      const changed = setIndex(empty);
      if (changed) notify();
      return { changed };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function computeIndexFingerprint(index: CommentThreadIndex): string {
  if (index.totalEntries === 0) return '0:';
  const parts: string[] = [`${index.size}:${index.totalEntries}`];
  // 按 key 字典序遍历，确保稳定指纹
  const keys = Array.from(index.byKey.keys()).sort();
  for (const key of keys) {
    const thread = index.byKey.get(key)!;
    parts.push(key);
    for (const entry of thread.entries) {
      parts.push(`${entry.commentId}@${entry.createdAt}#${entry.threadOrder}`);
    }
  }
  return parts.join('|');
}

export type { CommentThreadEntry };
