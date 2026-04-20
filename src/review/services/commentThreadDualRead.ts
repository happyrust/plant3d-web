/**
 * Inline comments ↔ thread store 双源同步 helper（M3 DUAL_READ 阶段）。
 *
 * 设计目的：
 *   - 把 `useToolStore` 内每个 annotation 上挂的 `comments: AnnotationComment[]`
 *     与 `commentThreadStore` 的对应 thread 做差异比较；
 *   - 在差异时把 inline 推入 store，并把差异摘要写入 commentEventLog 用于灰度告警；
 *   - 完全无 Vue 依赖，可在 composable / Pinia store / 单测中复用。
 *
 * 读路径行为：
 *   - DUAL_READ：UI 仍以 inline 为准，diff 仅写入 event log；
 *   - CUTOVER：UI 直接消费 store，inline 视为只读投影。
 *
 * 写路径行为：
 *   - DUAL_READ：在每次 inline 增 / 改 / 删后调用 `syncInlineToStore`，让 store 收敛；
 *   - CUTOVER：写路径直接调 `store.upsertComment` / `store.deleteComment`，inline 投影由
 *     专门的 `mirrorStoreToInline` 兼容写回（M3-T8 实现）。
 */

import {
  type CommentThreadIndex,
  type CommentThreadKey,
  buildCommentThreadKey,
} from '../domain/commentThread';
import {
  type SnapshotAnnotationType,
  type SnapshotComment,
  liftAnnotationComment,
} from '../domain/reviewSnapshot';

import type { CommentEventLog } from './commentEventLog';
import type { CommentThreadStore } from './commentThreadStore';
import type { AnnotationComment, WorkflowNode } from '@/types/auth';

export type InlineCommentContext = {
  taskId?: string;
  formId?: string;
  workflowNode?: WorkflowNode;
  reviewRound?: number;
}

export type CommentThreadDiff = {
  key: CommentThreadKey;
  inlineOnlyIds: readonly string[];
  storeOnlyIds: readonly string[];
  contentMismatchIds: readonly string[];
}

export function liftInlineCommentToSnapshot(
  comment: AnnotationComment,
  context: InlineCommentContext,
): SnapshotComment {
  return liftAnnotationComment(comment, {
    annotationType: comment.annotationType,
    taskId: context.taskId,
    formId: context.formId,
    workflowNode: context.workflowNode,
    reviewRound: context.reviewRound,
  });
}

export function diffInlineVsStore(
  annotationType: SnapshotAnnotationType,
  annotationId: string,
  inline: readonly AnnotationComment[],
  index: CommentThreadIndex,
): CommentThreadDiff {
  const key = buildCommentThreadKey(annotationType, annotationId);
  const thread = index.byKey.get(key);

  const inlineMap = new Map<string, AnnotationComment>();
  for (const c of inline) {
    if (c?.id) inlineMap.set(c.id, c);
  }
  const storeMap = new Map<string, SnapshotComment>();
  for (const c of thread?.entries ?? []) {
    storeMap.set(c.commentId, c);
  }

  const inlineOnly: string[] = [];
  const storeOnly: string[] = [];
  const mismatch: string[] = [];

  for (const [id, inlineEntry] of inlineMap) {
    const storeEntry = storeMap.get(id);
    if (!storeEntry) {
      inlineOnly.push(id);
      continue;
    }
    if (inlineEntry.content !== storeEntry.content
      || inlineEntry.createdAt !== storeEntry.createdAt
      || inlineEntry.replyToId !== storeEntry.replyToId) {
      mismatch.push(id);
    }
  }
  for (const id of storeMap.keys()) {
    if (!inlineMap.has(id)) storeOnly.push(id);
  }

  return {
    key,
    inlineOnlyIds: inlineOnly,
    storeOnlyIds: storeOnly,
    contentMismatchIds: mismatch,
  };
}

export type SyncInlineToStoreOptions = {
  store: CommentThreadStore;
  log?: CommentEventLog;
  context?: InlineCommentContext;
  /** 默认 true：把 inline 多出来或差异的条目 upsert 到 store。 */
  applyUpserts?: boolean;
  /** 默认 true：把 store 中多余条目 delete。 */
  applyDeletes?: boolean;
}

export type SyncInlineToStoreResult = {
  diff: CommentThreadDiff;
  changed: boolean;
}

export function syncInlineToStore(
  annotationType: SnapshotAnnotationType,
  annotationId: string,
  inline: readonly AnnotationComment[],
  options: SyncInlineToStoreOptions,
): SyncInlineToStoreResult {
  const diff = diffInlineVsStore(annotationType, annotationId, inline, options.store.getIndex());
  let changed = false;
  const applyUpserts = options.applyUpserts !== false;
  const applyDeletes = options.applyDeletes !== false;

  if (applyUpserts) {
    const inlineMap = new Map<string, AnnotationComment>();
    for (const c of inline) {
      if (c?.id) inlineMap.set(c.id, c);
    }
    for (const id of [...diff.inlineOnlyIds, ...diff.contentMismatchIds]) {
      const entry = inlineMap.get(id);
      if (!entry) continue;
      const result = options.store.upsertComment(
        liftInlineCommentToSnapshot(entry, options.context ?? {}),
      );
      if (result.changed) changed = true;
    }
  }

  if (applyDeletes) {
    for (const id of diff.storeOnlyIds) {
      const result = options.store.deleteComment(diff.key, id);
      if (result.changed) changed = true;
    }
  }

  if (options.log
    && (diff.inlineOnlyIds.length || diff.storeOnlyIds.length || diff.contentMismatchIds.length)) {
    options.log.push({
      kind: 'dual_read_diff',
      key: diff.key,
      payload: {
        inlineOnly: diff.inlineOnlyIds.length,
        storeOnly: diff.storeOnlyIds.length,
        mismatch: diff.contentMismatchIds.length,
        changed,
      },
    });
  }

  return { diff, changed };
}
