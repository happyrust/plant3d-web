/**
 * Comment Event Log —— M3 DUAL_READ 阶段的诊断信道。
 *
 * 来源：批注体系重构补遗 §8 的 "client-side event log 前置" 要求。
 *
 * 用途：
 *   - 在 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` 灰度阶段，把 inline 真源与
 *     thread store 真源在每个评论生命周期事件（add/update/delete/restore）上
 *     的差异写入环形 buffer，供排障与告警；
 *   - CUTOVER 后保留作为通用前端审计；
 *   - 不持久化，进程退出即丢，避免影响线上数据契约。
 *
 * 设计：
 *   - 容量固定（默认 500 条），新写入覆盖最旧条目；
 *   - O(1) 写入；快照按 chronological 顺序返回最新 N 条；
 *   - 不依赖 Vue / 任何 reactivity，便于在多入口复用。
 */

export type CommentEventKind =
  | 'snapshot_merged'
  | 'thread_upsert'
  | 'thread_delete'
  | 'thread_clear'
  | 'dual_read_diff'
  | 'restore_skipped';

export type CommentEventEntry = {
  kind: CommentEventKind;
  at: number;
  /** 评论或线程标识，便于检索（可空）。 */
  key?: string;
  payload?: Record<string, unknown>;
}

export type CommentEventLog = {
  push(entry: Omit<CommentEventEntry, 'at'> & { at?: number }): void;
  snapshot(limit?: number): readonly CommentEventEntry[];
  size(): number;
  clear(): void;
  capacity(): number;
}

export const DEFAULT_COMMENT_EVENT_LOG_CAPACITY = 500;

export type CreateCommentEventLogOptions = {
  capacity?: number;
  now?: () => number;
}

export function createCommentEventLog(
  options: CreateCommentEventLogOptions = {},
): CommentEventLog {
  const capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_COMMENT_EVENT_LOG_CAPACITY));
  const now = options.now ?? (() => Date.now());

  const buffer: CommentEventEntry[] = new Array(capacity);
  let head = 0;     // 下一次写入位置
  let count = 0;    // 当前条目数（≤ capacity）

  return {
    push(entry) {
      buffer[head] = {
        kind: entry.kind,
        at: entry.at ?? now(),
        key: entry.key,
        payload: entry.payload,
      };
      head = (head + 1) % capacity;
      if (count < capacity) count += 1;
    },
    snapshot(limit) {
      if (count === 0) return [];
      const total = count;
      const want = Math.max(0, Math.min(limit ?? total, total));
      if (want === 0) return [];
      const start = (head - total + capacity) % capacity;
      const out: CommentEventEntry[] = [];
      // 取 chronological 末尾 `want` 条
      for (let i = total - want; i < total; i += 1) {
        const idx = (start + i) % capacity;
        out.push(buffer[idx]);
      }
      return out;
    },
    size() {
      return count;
    },
    clear() {
      head = 0;
      count = 0;
    },
    capacity() {
      return capacity;
    },
  };
}
