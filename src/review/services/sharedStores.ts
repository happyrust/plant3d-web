/**
 * 共享单例：comment thread store + comment event log。
 *
 * 作用：让 restore 链路、未来的 ReviewCommentsTimeline 与 commentSyncService
 * 都消费同一份 store，避免每个组件各自实例化造成数据漂移。
 *
 * 设计原则：
 *   - lazy init：只有首次 get 时才创建；
 *   - 测试 / 排障可通过 `__resetReviewSharedStores()` 重置；
 *   - 不在模块加载阶段做任何副作用，便于在 SSR / 单测里安全 import。
 */

import type { AnnotationComment } from '@/types/auth';

import { buildCommentThreadKey } from '../domain/commentThread';
import { lowerSnapshotComment } from '../domain/reviewSnapshot';
import { isReviewFlagEnabled } from '../flags';

import {
  createCommentEventLog,
  type CommentEventLog,
} from './commentEventLog';
import {
  createCommentThreadStore,
  type CommentThreadStore,
} from './commentThreadStore';

let _threadStore: CommentThreadStore | null = null;
let _eventLog: CommentEventLog | null = null;

export function getReviewCommentThreadStore(): CommentThreadStore {
  if (!_threadStore) {
    _threadStore = createCommentThreadStore();
  }
  return _threadStore;
}

export function getReviewCommentEventLog(): CommentEventLog {
  if (!_eventLog) {
    _eventLog = createCommentEventLog();
  }
  return _eventLog;
}

/**
 * 当 thread store 被启用为评论真源时返回 true。
 *
 * CUTOVER 阶段（当前默认）：store 是唯一真源，inline 仅作兼容投影。
 * 可通过 localStorage `review.flag.REVIEW_C_COMMENT_THREAD_STORE_CUTOVER=0` 临时回退。
 */
export function isReviewCommentThreadStoreActive(): boolean {
  return isReviewFlagEnabled('REVIEW_C_COMMENT_THREAD_STORE_CUTOVER');
}

/**
 * 从 commentThreadStore 读取指定批注的评论，
 * 返回 AnnotationComment[] 格式（与 useToolStore.getAnnotationComments 兼容）。
 */
export function getCommentsFromStore(
  annotationType: 'text' | 'cloud' | 'rect' | 'obb',
  annotationId: string,
): AnnotationComment[] {
  const store = getReviewCommentThreadStore();
  const key = buildCommentThreadKey(annotationType, annotationId);
  const thread = store.getThread(key);
  if (!thread) return [];
  return thread.entries.map(lowerSnapshotComment);
}

/**
 * 仅供测试使用。生产代码不应调用。
 */
export function __resetReviewSharedStores(): void {
  _threadStore = null;
  _eventLog = null;
}
