/**
 * `task_records` → `ReviewSnapshot` 适配器。
 *
 * 输入：`ConfirmedRecord[]`（即 `useReviewStore` 内的本地确认记录，亦即
 * `confirmedRecordsRestore` 当前直接喂给 `buildReviewRecordReplayPayload`
 * 的数据）。
 *
 * 设计要点：
 *   1. **不去重 / 不归一**：snapshot 是无损中间层；去重与 measurement 归一
 *      由 `toolStoreAdapter`（沿用旧 `buildReviewRecordReplayPayload`）负责，
 *      以便 SHADOW 阶段 payload 字节一致。
 *   2. **按 record 顺序、按类别串行追加**：保证 `filter(annotationType==='text')`
 *      的结果与 `records.flatMap(r => r.annotations)` 顺序一致。
 *   3. **inline comments 下沉**：`AnnotationRecord.comments` 写入 snapshot.comments，
 *      同时在 `meta.inlineCommentIndex` 留索引；payload 仍保留原 comments 字段，
 *      不影响 toolStoreAdapter 还原。
 */

import {
  type ReviewSnapshot,
  type SnapshotAnnotation,
  type SnapshotAnnotationType,
  type SnapshotMeasurementKind,
  createEmptyReviewSnapshot,
  liftAnnotationComment,
  snapshotInlineCommentKey,
} from '../domain/reviewSnapshot';

import type { ConfirmedRecord } from '@/composables/useReviewStore';
import type { SnapshotDimensionDocument } from '@/dimension';
import type { AnnotationComment, WorkflowNode } from '@/types/auth';

import {
  DimensionSnapshotValidationError,
  validateDimensionDocumentSnapshot,
} from '@/dimension';

export const REVIEW_RECORD_SNAPSHOT_VERSION = 1;

type AnnotationLike = {
  id?: unknown;
  comments?: AnnotationComment[];
  [key: string]: unknown;
}

type MeasurementLike = {
  id?: unknown;
  kind?: unknown;
  [key: string]: unknown;
}

export type BuildSnapshotFromTaskRecordsOptions = {
  taskId?: string;
  formId?: string;
  workflowNode?: WorkflowNode;
  taskStatus?: string;
  /** 注入式时间，便于测试与性能基线对照。 */
  now?: () => number;
}

export type TaskRecordSnapshotInput = ConfirmedRecord & Readonly<{
  dimensionDocument?: SnapshotDimensionDocument;
  dimensionDocumentVersion?: number;
}>;

export function buildSnapshotFromTaskRecords(
  records: readonly TaskRecordSnapshotInput[],
  options: BuildSnapshotFromTaskRecordsOptions = {},
): ReviewSnapshot {
  const snapshot = createEmptyReviewSnapshot({
    source: 'task_records',
    taskId: options.taskId,
    formId: options.formId,
    workflowNode: options.workflowNode,
    taskStatus: options.taskStatus,
    sourceVersion: REVIEW_RECORD_SNAPSHOT_VERSION,
    createdAt: (options.now ?? Date.now)(),
  });

  copyLatestDimensionDocument(snapshot, records);
  if (!records.length) return snapshot;

  const inlineKeys: string[] = [];

  for (const record of records) {
    const recordTaskId = record.taskId || options.taskId;
    const recordFormId = record.formId || options.formId;

    appendAnnotationGroup({
      snapshot,
      inlineKeys,
      items: record.annotations as readonly AnnotationLike[] | undefined,
      annotationType: 'text',
      taskId: recordTaskId,
      formId: recordFormId,
      workflowNode: options.workflowNode,
    });
    appendAnnotationGroup({
      snapshot,
      inlineKeys,
      items: record.cloudAnnotations as readonly AnnotationLike[] | undefined,
      annotationType: 'cloud',
      taskId: recordTaskId,
      formId: recordFormId,
      workflowNode: options.workflowNode,
    });
    appendAnnotationGroup({
      snapshot,
      inlineKeys,
      items: record.rectAnnotations as readonly AnnotationLike[] | undefined,
      annotationType: 'rect',
      taskId: recordTaskId,
      formId: recordFormId,
      workflowNode: options.workflowNode,
    });
    appendAnnotationGroup({
      snapshot,
      inlineKeys,
      items: (record.obbAnnotations ?? []) as readonly AnnotationLike[],
      annotationType: 'obb',
      taskId: recordTaskId,
      formId: recordFormId,
      workflowNode: options.workflowNode,
    });

    appendMeasurements(
      snapshot,
      record.measurements as readonly MeasurementLike[] | undefined,
      {
        taskId: recordTaskId,
        formId: recordFormId,
      },
    );
  }

  if (inlineKeys.length) {
    snapshot.meta.inlineCommentIndex = Object.freeze([...inlineKeys]);
  }

  return snapshot;
}

function copyLatestDimensionDocument(
  snapshot: ReviewSnapshot,
  records: readonly TaskRecordSnapshotInput[],
): void {
  let latest: {
    document: SnapshotDimensionDocument;
    version?: number;
    confirmedAt: number;
  } | undefined;
  for (const record of records) {
    if (record.dimensionDocument === undefined) continue;
    const document = validateDimensionDocumentSnapshot(record.dimensionDocument);
    const version = record.dimensionDocumentVersion;
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 0)) {
      throw new DimensionSnapshotValidationError(
        'dimensionDocumentVersion must be a non-negative safe integer',
      );
    }
    if (
      !latest
      || (version ?? -1) > (latest.version ?? -1)
      || (
        (version ?? -1) === (latest.version ?? -1)
        && record.confirmedAt >= latest.confirmedAt
      )
    ) {
      latest = { document, version, confirmedAt: record.confirmedAt };
    }
  }
  if (!latest) return;
  snapshot.dimensionDocument = latest.document;
  snapshot.dimensionDocumentVersion = latest.version;
}

type AppendAnnotationGroupOptions = {
  snapshot: ReviewSnapshot;
  inlineKeys: string[];
  items: readonly AnnotationLike[] | undefined;
  annotationType: SnapshotAnnotationType;
  taskId?: string;
  formId?: string;
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
      formId: opts.formId,
      workflowNode: opts.workflowNode,
      payload: withSnapshotContext(raw, {
        taskId: opts.taskId,
        formId: opts.formId,
      }),
    };
    opts.snapshot.annotations.push(annotation);

    const inlineComments = Array.isArray(raw.comments) ? raw.comments : null;
    if (inlineComments?.length) {
      opts.inlineKeys.push(snapshotInlineCommentKey(opts.annotationType, annotationId));
      for (const comment of inlineComments) {
        opts.snapshot.comments.push(
          liftAnnotationComment(comment, {
            annotationType: opts.annotationType,
            taskId: opts.taskId,
            formId: opts.formId,
            workflowNode: opts.workflowNode,
          }),
        );
      }
    }
  }
}

function normalizeKind(raw: unknown): SnapshotMeasurementKind {
  if (typeof raw !== 'string') return 'unknown';
  const kind = raw.trim().toLowerCase();
  if (
    kind === 'distance' ||
    kind === 'angle' ||
    kind === 'elevation_point' ||
    kind === 'elevation_delta'
  ) return kind;
  return 'unknown';
}

function appendMeasurements(
  snapshot: ReviewSnapshot,
  items: readonly MeasurementLike[] | undefined,
  context: { taskId?: string; formId?: string },
): void {
  if (!items?.length) return;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const measurementId = typeof raw.id === 'string' ? raw.id : '';
    if (!measurementId) continue;
    snapshot.measurements.push({
      measurementId,
      kind: normalizeKind(raw.kind),
      payload: withSnapshotContext(raw, {
        taskId: context.taskId,
        formId: context.formId,
      }) as import('@/api/reviewApi').ReviewSnapshotMeasurementPayload,
    });
  }
}

function normalizeOptionalContext(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function withSnapshotContext<T extends Record<string, unknown>>(
  raw: T,
  context: { taskId?: string; formId?: string },
): T {
  const currentTaskId = normalizeOptionalContext(raw.taskId);
  const currentFormId = normalizeOptionalContext(raw.formId);
  return {
    ...raw,
    ...(currentTaskId ? { taskId: currentTaskId } : context.taskId ? { taskId: context.taskId } : {}),
    ...(currentFormId ? { formId: currentFormId } : context.formId ? { formId: context.formId } : {}),
  };
}
