/**
 * `workflow_sync` → `ReviewSnapshot` 适配器。
 *
 * 输入：`WorkflowSyncData`（即 `WorkflowSyncResponse.data`，可能为 undefined）。
 *
 * 设计要点：
 *   1. 复用 `mergeWorkflowCommentsIntoRecords` 拼装 inline 评论，确保 SHADOW
 *      阶段 toolStoreAdapter 还原的 payload 与现行 `buildWorkflowSnapshotReplayPayload`
 *      字节一致。
 *   2. 同时把评论独立沉到 `snapshot.comments`，为 M3 评论解耦提供数据基础。
 *   3. `WorkflowSyncData.currentNode` 仅在落到 `sj/jd/sh/pz` 枚举时写入
 *      `snapshot.workflowNode`，其余信息（formExists/formStatus 等）保留在
 *      `meta.raw` 内。
 *   4. `attachments` / `models` 透传；`models` 字符串化以便后续与 `extractWorkflowModelRefnos`
 *      行为收敛。
 */

import {
  type ReviewSnapshot,
  type SnapshotAnnotation,
  type SnapshotAnnotationType,
  type SnapshotComment,
  type SnapshotMeasurementKind,
  createEmptyReviewSnapshot,
  snapshotInlineCommentKey,
} from '../domain/reviewSnapshot';

import {
  type WorkflowAnnotationCommentData,
  type WorkflowRecordData,
  type WorkflowSyncData,
} from '@/api/reviewApi';
import {
  mergeWorkflowCommentsIntoRecords,
} from '@/components/review/reviewRecordReplay';
import {
  fromBackendRole,
  type AnnotationComment,
  type ReviewAttachment,
  type WorkflowNode,
} from '@/types/auth';

export const WORKFLOW_SYNC_SNAPSHOT_VERSION = 1;

const WORKFLOW_NODE_VALUES: ReadonlySet<WorkflowNode> = new Set([
  'sj',
  'jd',
  'sh',
  'pz',
]);

const ANNOTATION_TYPE_VALUES: ReadonlySet<SnapshotAnnotationType> = new Set([
  'text',
  'cloud',
  'rect',
  'obb',
]);

type AnnotationLike = {
  id?: unknown;
  comments?: unknown;
  [key: string]: unknown;
}

type MeasurementLike = {
  id?: unknown;
  kind?: unknown;
  [key: string]: unknown;
}

export type BuildSnapshotFromWorkflowSyncOptions = {
  /** 注入式时间，便于测试与性能基线对照。 */
  now?: () => number;
}

export function buildSnapshotFromWorkflowSync(
  data: WorkflowSyncData | undefined | null,
  options: BuildSnapshotFromWorkflowSyncOptions = {},
): ReviewSnapshot {
  const workflowNode = normalizeWorkflowNode(data?.currentNode);

  const records: WorkflowRecordData[] = Array.isArray(data?.records) ? data!.records : [];
  const rawComments: WorkflowAnnotationCommentData[] = Array.isArray(data?.annotationComments)
    ? data!.annotationComments
    : [];

  const inferredTaskId = pickTaskId(data, records);

  const snapshot = createEmptyReviewSnapshot({
    source: 'workflow_sync',
    taskId: inferredTaskId,
    workflowNode,
    taskStatus: typeof data?.taskStatus === 'string' ? data.taskStatus : undefined,
    sourceVersion: WORKFLOW_SYNC_SNAPSHOT_VERSION,
    createdAt: (options.now ?? Date.now)(),
    raw: data
      ? {
        currentNode: data.currentNode,
        taskStatus: data.taskStatus,
        formExists: data.formExists,
        formStatus: data.formStatus,
        taskCreated: data.taskCreated,
        title: data.title,
      }
      : undefined,
  });

  if (!data) return snapshot;

  // 直接调用现有 merge，保证 inline payload.comments 顺序与旧路径一致
  const mergedRecords = mergeWorkflowCommentsIntoRecords(records, rawComments);

  const inlineKeys: string[] = [];

  for (let recordIndex = 0; recordIndex < mergedRecords.length; recordIndex += 1) {
    const merged = mergedRecords[recordIndex];
    const sourceRecord = records[recordIndex];
    const recordTaskId = typeof sourceRecord?.taskId === 'string' ? sourceRecord.taskId : snapshot.taskId;

    appendAnnotationGroup({
      snapshot,
      inlineKeys,
      items: merged.annotations as readonly AnnotationLike[] | undefined,
      annotationType: 'text',
      taskId: recordTaskId,
      workflowNode,
    });
    appendAnnotationGroup({
      snapshot,
      inlineKeys,
      items: merged.cloudAnnotations as readonly AnnotationLike[] | undefined,
      annotationType: 'cloud',
      taskId: recordTaskId,
      workflowNode,
    });
    appendAnnotationGroup({
      snapshot,
      inlineKeys,
      items: merged.rectAnnotations as readonly AnnotationLike[] | undefined,
      annotationType: 'rect',
      taskId: recordTaskId,
      workflowNode,
    });
    appendAnnotationGroup({
      snapshot,
      inlineKeys,
      items: merged.obbAnnotations as readonly AnnotationLike[] | undefined,
      annotationType: 'obb',
      taskId: recordTaskId,
      workflowNode,
    });

    appendMeasurements(snapshot, merged.measurements as readonly MeasurementLike[] | undefined);
  }

  // 独立 comment 投影：从原始 annotationComments 解析，让 M3 thread store 可以直接消费
  for (const raw of rawComments) {
    const lifted = liftWorkflowComment(raw, {
      taskId: snapshot.taskId,
      workflowNode,
    });
    if (lifted) snapshot.comments.push(lifted);
  }

  if (inlineKeys.length) {
    snapshot.meta.inlineCommentIndex = Object.freeze([...inlineKeys]);
  }

  snapshot.attachments.push(...normalizeAttachments(data.attachments));
  snapshot.models.push(...normalizeModelRefnos(data.models));

  return snapshot;
}

type AppendAnnotationGroupOptions = {
  snapshot: ReviewSnapshot;
  inlineKeys: string[];
  items: readonly AnnotationLike[] | undefined;
  annotationType: SnapshotAnnotationType;
  taskId?: string;
  workflowNode?: WorkflowNode;
}

function appendAnnotationGroup(opts: AppendAnnotationGroupOptions): void {
  if (!opts.items?.length) return;
  for (const raw of opts.items) {
    if (!raw || typeof raw !== 'object') continue;
    const annotationId = typeof raw.id === 'string' ? raw.id : '';
    if (!annotationId) continue;

    const annotation: SnapshotAnnotation = {
      annotationId,
      annotationType: opts.annotationType,
      taskId: opts.taskId,
      workflowNode: opts.workflowNode,
      payload: { ...raw },
    };
    opts.snapshot.annotations.push(annotation);

    const inline = Array.isArray(raw.comments) ? raw.comments : null;
    if (inline?.length) {
      opts.inlineKeys.push(snapshotInlineCommentKey(opts.annotationType, annotationId));
    }
  }
}

function appendMeasurements(
  snapshot: ReviewSnapshot,
  items: readonly MeasurementLike[] | undefined,
): void {
  if (!items?.length) return;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const measurementId = typeof raw.id === 'string' ? raw.id : '';
    if (!measurementId) continue;
    snapshot.measurements.push({
      measurementId,
      kind: normalizeMeasurementKind(raw.kind),
      payload: { ...raw },
    });
  }
}

function normalizeMeasurementKind(raw: unknown): SnapshotMeasurementKind {
  if (typeof raw !== 'string') return 'unknown';
  const kind = raw.trim().toLowerCase();
  if (kind === 'distance' || kind === 'angle') return kind;
  return 'unknown';
}

function normalizeWorkflowNode(node: unknown): WorkflowNode | undefined {
  if (typeof node !== 'string') return undefined;
  const normalized = node.trim().toLowerCase();
  return WORKFLOW_NODE_VALUES.has(normalized as WorkflowNode)
    ? (normalized as WorkflowNode)
    : undefined;
}

function pickTaskId(
  data: WorkflowSyncData | undefined | null,
  records: readonly WorkflowRecordData[],
): string | undefined {
  if (typeof data?.taskId === 'string' && data.taskId.length > 0) return data.taskId;
  for (const record of records) {
    if (typeof record.taskId === 'string' && record.taskId.length > 0) return record.taskId;
  }
  return undefined;
}

function normalizeAttachments(items: unknown): ReviewAttachment[] {
  if (!Array.isArray(items)) return [];
  const out: ReviewAttachment[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const att = item as ReviewAttachment;
    if (typeof att.id === 'string' && typeof att.name === 'string') {
      out.push(att);
    }
  }
  return out;
}

function normalizeModelRefnos(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const refs = new Set<string>();
  for (const item of items) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) refs.add(trimmed);
      continue;
    }
    if (item && typeof item === 'object') {
      const candidate = (item as Record<string, unknown>).model_refno
        ?? (item as Record<string, unknown>).modelRefno
        ?? (item as Record<string, unknown>).refNo
        ?? (item as Record<string, unknown>).refno;
      if (typeof candidate === 'string' && candidate.trim()) {
        refs.add(candidate.trim());
      }
    }
  }
  return Array.from(refs);
}

type LiftWorkflowCommentContext = {
  taskId?: string;
  formId?: string;
  workflowNode?: WorkflowNode;
}

function liftWorkflowComment(
  raw: WorkflowAnnotationCommentData,
  context: LiftWorkflowCommentContext,
): SnapshotComment | null {
  const annotationType = normalizeAnnotationType(raw.annotationType);
  if (!annotationType || !raw.annotationId) return null;
  return {
    commentId: raw.id,
    annotationId: raw.annotationId,
    annotationType,
    authorId: raw.authorId,
    authorName: raw.authorName,
    authorRole: ((): AnnotationComment['authorRole'] | undefined => {
      const mapped = fromBackendRole(raw.authorRole);
      return mapped;
    })(),
    content: raw.content,
    replyToId: raw.replyToId,
    createdAt: parseWorkflowTimestamp(raw.createdAt),
    taskId: context.taskId,
    formId: context.formId,
    workflowNode: context.workflowNode,
  };
}

function normalizeAnnotationType(raw: unknown): SnapshotAnnotationType | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return ANNOTATION_TYPE_VALUES.has(normalized as SnapshotAnnotationType)
    ? (normalized as SnapshotAnnotationType)
    : null;
}

function parseWorkflowTimestamp(raw: string | undefined): number {
  const normalized = String(raw || '').trim();
  if (!normalized) return Date.now();
  const parsed = Date.parse(normalized.replace(' ', 'T'));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}
