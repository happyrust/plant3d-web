import type {
  WorkflowAnnotationCommentData,
  WorkflowRecordData,
} from '@/api/reviewApi';

import { fromBackendRole, type AnnotationComment } from '@/types/auth';

type ReplayRecordLike = Pick<
  WorkflowRecordData,
  'annotations' | 'cloudAnnotations' | 'rectAnnotations' | 'obbAnnotations' | 'measurements'
>;

type AnnotationTypeKey = 'text' | 'cloud' | 'rect' | 'obb';

function normalizeAnnotationType(raw: string): AnnotationTypeKey | null {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'text' || normalized === 'cloud' || normalized === 'rect' || normalized === 'obb') {
    return normalized;
  }
  return null;
}

function parseWorkflowTimestamp(raw: string): number {
  const normalized = String(raw || '').trim();
  if (!normalized) return Date.now();
  const parsed = Date.parse(normalized.replace(' ', 'T'));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function normalizeWorkflowComment(raw: WorkflowAnnotationCommentData): AnnotationComment | null {
  const annotationType = normalizeAnnotationType(raw.annotationType);
  if (!annotationType || !raw.annotationId) return null;
  return {
    id: raw.id,
    annotationId: raw.annotationId,
    annotationType,
    authorId: raw.authorId,
    authorName: raw.authorName,
    authorRole: fromBackendRole(raw.authorRole),
    content: raw.content,
    replyToId: raw.replyToId,
    createdAt: parseWorkflowTimestamp(raw.createdAt),
  };
}

function attachCommentsToItems(
  items: unknown[],
  annotationType: AnnotationTypeKey,
  groupedComments: Map<string, AnnotationComment[]>,
): unknown[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    if (!id) return item;
    const comments = groupedComments.get(`${annotationType}:${id}`);
    if (!comments?.length) return item;
    return {
      ...record,
      comments,
    };
  });
}

export function mergeWorkflowCommentsIntoRecords(
  records: WorkflowRecordData[],
  comments: WorkflowAnnotationCommentData[] = [],
): ReplayRecordLike[] {
  const groupedComments = new Map<string, AnnotationComment[]>();
  for (const rawComment of comments) {
    const comment = normalizeWorkflowComment(rawComment);
    if (!comment) continue;
    const key = `${comment.annotationType}:${comment.annotationId}`;
    groupedComments.set(key, [...(groupedComments.get(key) ?? []), comment]);
  }

  return records.map((record) => ({
    ...record,
    annotations: attachCommentsToItems(record.annotations ?? [], 'text', groupedComments),
    cloudAnnotations: attachCommentsToItems(record.cloudAnnotations ?? [], 'cloud', groupedComments),
    rectAnnotations: attachCommentsToItems(record.rectAnnotations ?? [], 'rect', groupedComments),
    obbAnnotations: attachCommentsToItems(record.obbAnnotations ?? [], 'obb', groupedComments),
    measurements: record.measurements ?? [],
  }));
}

export function buildReviewRecordReplayPayload(records: ReplayRecordLike[]): string {
  return JSON.stringify({
    version: 5,
    measurements: records.flatMap((record) => record.measurements ?? []),
    annotations: records.flatMap((record) => record.annotations ?? []),
    obbAnnotations: records.flatMap((record) => record.obbAnnotations ?? []),
    cloudAnnotations: records.flatMap((record) => record.cloudAnnotations ?? []),
    rectAnnotations: records.flatMap((record) => record.rectAnnotations ?? []),
    dimensions: [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
  });
}

export function buildWorkflowSnapshotReplayPayload(
  records: WorkflowRecordData[],
  comments: WorkflowAnnotationCommentData[] = [],
): string {
  return buildReviewRecordReplayPayload(mergeWorkflowCommentsIntoRecords(records, comments));
}

export function extractWorkflowModelRefnos(models: (string | Record<string, unknown>)[] = []): string[] {
  const refnos = new Set<string>();
  for (const model of models) {
    if (typeof model === 'string') {
      const normalized = model.trim();
      if (normalized) refnos.add(normalized);
      continue;
    }
    if (!model || typeof model !== 'object') continue;
    const candidate = model.model_refno
      || model.modelRefno
      || model.refNo
      || model.refno;
    const normalized = typeof candidate === 'string' ? candidate.trim() : '';
    if (normalized) refnos.add(normalized);
  }
  return Array.from(refnos);
}
