/**
 * ReviewSnapshot —— 批注体系重构 M2 引入的中间数据层。
 *
 * 目的：把"平台内任务恢复 / workflow-sync 嵌入恢复 / 离线导入"三类入口
 * 统一到同一份语义结构上，让 viewer 与 UI 长期只消费这一层。
 *
 * 详情见：
 *   - `开发文档/三维校审/批注体系重构开发计划-2026-04-18.md` §5
 *   - `开发文档/三维校审/批注体系重构-补遗与术语规范-2026-04-18.md` §1/§3/§4
 *   - `开发文档/三维校审/批注体系重构-M2执行清单-2026-04-19.md`
 *
 * 设计约束（M2 阶段）：
 *   1. 字段为 superset，不强制依赖 M4 才会上线的 `annotationKey/workflowNode/reviewRound`，
 *      adapter 在缺字段时直接置为 `undefined`。
 *   2. `payload` 字段保留原始 record 的全部信息，避免在中间层丢字段。
 *   3. M2 处于 SHADOW 阶段，UI 仍走旧 payload；toolStoreAdapter 必须能从 snapshot
 *      还原与 `buildReviewRecordReplayPayload` 字节一致的输出。
 */

import type { AnnotationComment, ReviewAttachment, WorkflowNode } from '@/types/auth';

export type SnapshotSource =
  | 'task_records'
  | 'workflow_sync'
  | 'import_package';

export type SnapshotAnnotationType = 'text' | 'cloud' | 'rect' | 'obb';

export type SnapshotAnnotation = {
  annotationId: string;
  annotationType: SnapshotAnnotationType;
  taskId?: string;
  formId?: string;
  workflowNode?: WorkflowNode;
  reviewRound?: number;
  annotationKey?: string;
  /** 来源 record 的完整 payload，确保 toolStoreAdapter 不丢字段。 */
  payload: Record<string, unknown>;
}

export type SnapshotComment = {
  commentId: string;
  annotationId: string;
  annotationType: SnapshotAnnotationType;
  authorId?: string;
  authorName?: string;
  authorRole?: string;
  content: string;
  replyToId?: string;
  createdAt: number;
  annotationKey?: string;
  taskId?: string;
  formId?: string;
  workflowNode?: WorkflowNode;
  reviewRound?: number;
}

export type SnapshotMeasurementKind = 'distance' | 'angle' | 'unknown';

export type SnapshotMeasurement = {
  measurementId: string;
  kind: SnapshotMeasurementKind;
  payload: Record<string, unknown>;
}

export type ReviewSnapshotMeta = {
  sourceVersion: number;
  createdAt: number;
  /**
   * 兼容期评论投影索引：`${annotationType}:${annotationId}`。
   * 当某条 annotation 在原始 record 内持有 inline `comments` 时记录索引，
   * 避免 toolStoreAdapter 还原阶段重复挂载。
   */
  inlineCommentIndex?: readonly string[];
  /** 来源相关元数据，例如 workflow-sync 的 currentNode、taskStatus、formExists 等。 */
  raw?: Record<string, unknown>;
}

export type ReviewSnapshot = {
  source: SnapshotSource;
  taskId?: string;
  formId?: string;
  workflowNode?: WorkflowNode;
  taskStatus?: string;
  annotations: SnapshotAnnotation[];
  comments: SnapshotComment[];
  measurements: SnapshotMeasurement[];
  attachments: ReviewAttachment[];
  models: string[];
  meta: ReviewSnapshotMeta;
}

export type CreateEmptySnapshotOptions = {
  source: SnapshotSource;
  taskId?: string;
  formId?: string;
  workflowNode?: WorkflowNode;
  taskStatus?: string;
  sourceVersion?: number;
  createdAt?: number;
  raw?: Record<string, unknown>;
}

export const REVIEW_SNAPSHOT_DEFAULT_VERSION = 1;

export function createEmptyReviewSnapshot(
  opts: CreateEmptySnapshotOptions,
): ReviewSnapshot {
  return {
    source: opts.source,
    taskId: opts.taskId,
    formId: opts.formId,
    workflowNode: opts.workflowNode,
    taskStatus: opts.taskStatus,
    annotations: [],
    comments: [],
    measurements: [],
    attachments: [],
    models: [],
    meta: {
      sourceVersion: opts.sourceVersion ?? REVIEW_SNAPSHOT_DEFAULT_VERSION,
      createdAt: opts.createdAt ?? Date.now(),
      inlineCommentIndex: undefined,
      raw: opts.raw,
    },
  };
}

export function snapshotInlineCommentKey(
  annotationType: SnapshotAnnotationType,
  annotationId: string,
): string {
  return `${annotationType}:${annotationId}`;
}

export function isSnapshotEmpty(snapshot: ReviewSnapshot): boolean {
  return (
    snapshot.annotations.length === 0
    && snapshot.comments.length === 0
    && snapshot.measurements.length === 0
    && snapshot.attachments.length === 0
    && snapshot.models.length === 0
  );
}

/**
 * 将原始 `AnnotationComment`（来自 useToolStore / inline comments）适配为
 * `SnapshotComment`，保留运行时已有的最小字段集合，其余 M4 字段留空。
 */
export function liftAnnotationComment(
  raw: AnnotationComment,
  context: {
    annotationType: SnapshotAnnotationType;
    taskId?: string;
    formId?: string;
    workflowNode?: WorkflowNode;
    reviewRound?: number;
  },
): SnapshotComment {
  return {
    commentId: raw.id,
    annotationId: raw.annotationId,
    annotationType: context.annotationType,
    authorId: raw.authorId,
    authorName: raw.authorName,
    authorRole: raw.authorRole,
    content: raw.content,
    replyToId: raw.replyToId,
    createdAt: raw.createdAt,
    taskId: context.taskId,
    formId: context.formId,
    workflowNode: context.workflowNode,
    reviewRound: context.reviewRound,
  };
}
