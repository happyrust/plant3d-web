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
 * 启用条件（任一即生效）：
 *   - `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ`：DUAL_READ 灰度阶段，store 与 inline 同跑；
 *   - `REVIEW_C_COMMENT_THREAD_STORE_CUTOVER`：CUTOVER 阶段，仅 store。
 *
 * 与 SHADOW 不同：thread store 的预填本身不影响渲染，但需要与 ReviewCommentsTimeline
 * 的 DUAL_READ/CUTOVER 严格联动，避免 store 数据陈旧。
 */
export function isReviewCommentThreadStoreActive(): boolean {
  return (
    isReviewFlagEnabled('REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ')
    || isReviewFlagEnabled('REVIEW_C_COMMENT_THREAD_STORE_CUTOVER')
  );
}

/**
 * 仅供测试使用。生产代码不应调用。
 */
export function __resetReviewSharedStores(): void {
  _threadStore = null;
  _eventLog = null;
}
