import type {
  ReviewSnapshotMeasurementPayload,
  WorkflowAnnotationCommentData,
  WorkflowRecordData,
} from '@/api/reviewApi';
import type {
  MeasurementRecord,
  MeasurementPoint,
  XeokitAngleMeasurementRecord,
  XeokitDistanceMeasurementRecord,
} from '@/composables/useToolStore';

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

function injectFormIdIntoItems(items: unknown[], formId?: string): unknown[] {
  const normalizedFormId = typeof formId === 'string' ? formId.trim() : '';
  if (!normalizedFormId) return items;

  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    const currentFormId = typeof record.formId === 'string' ? record.formId.trim() : '';
    if (currentFormId) {
      if (currentFormId === record.formId) return item;
      return {
        ...record,
        formId: currentFormId,
      };
    }
    return {
      ...record,
      formId: normalizedFormId,
    };
  });
}

function dedupeReplayItems(items: unknown[]): unknown[] {
  const keyedItems = new Map<string, unknown>();
  const anonymousItems: unknown[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      anonymousItems.push(item);
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) {
      anonymousItems.push(item);
      continue;
    }
    keyedItems.set(id, item);
  }

  return [...keyedItems.values(), ...anonymousItems];
}

function isMeasurementPoint(value: unknown): value is MeasurementPoint {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.entityId === 'string'
    && Array.isArray(record.worldPos)
    && record.worldPos.length === 3
    && record.worldPos.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function normalizeReplayMeasurement(value: unknown): MeasurementRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const kind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';
  const origin = isMeasurementPoint(record.origin) ? record.origin : null;
  const target = isMeasurementPoint(record.target) ? record.target : null;
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
  const visible = record.visible !== false;
  const sourceAnnotationId = typeof record.sourceAnnotationId === 'string'
    ? record.sourceAnnotationId
    : undefined;
  const sourceAnnotationType = typeof record.sourceAnnotationType === 'string'
    ? record.sourceAnnotationType
    : undefined;
  const formId = typeof record.formId === 'string'
    ? record.formId.trim() || undefined
    : undefined;

  if (!id || !origin || !target) return null;

  if (kind === 'distance') {
    return {
      id,
      kind: 'distance',
      origin,
      target,
      visible,
      createdAt,
      sourceAnnotationId,
      sourceAnnotationType,
      formId,
    };
  }

  const corner = isMeasurementPoint(record.corner) ? record.corner : null;
  if (kind === 'angle' && corner) {
    return {
      id,
      kind: 'angle',
      origin,
      corner,
      target,
      visible,
      createdAt,
      sourceAnnotationId,
      sourceAnnotationType,
      formId,
    };
  }

  return null;
}

function toXeokitMeasurement(
  measurement: MeasurementRecord,
): XeokitDistanceMeasurementRecord | XeokitAngleMeasurementRecord {
  if (measurement.kind === 'angle') {
    return {
      id: measurement.id,
      kind: 'angle',
      origin: measurement.origin,
      corner: measurement.corner,
      target: measurement.target,
      visible: measurement.visible,
      approximate: false,
      createdAt: measurement.createdAt,
      sourceAnnotationId: measurement.sourceAnnotationId,
      sourceAnnotationType: measurement.sourceAnnotationType,
      formId: measurement.formId,
    };
  }

  return {
    id: measurement.id,
    kind: 'distance',
    origin: measurement.origin,
    target: measurement.target,
    visible: measurement.visible,
    approximate: false,
    createdAt: measurement.createdAt,
    sourceAnnotationId: measurement.sourceAnnotationId,
    sourceAnnotationType: measurement.sourceAnnotationType,
    formId: measurement.formId,
  };
}

function buildReplayMeasurements(measurements: ReviewSnapshotMeasurementPayload[]): {
  measurements: ReviewSnapshotMeasurementPayload[];
  xeokitDistanceMeasurements: XeokitDistanceMeasurementRecord[];
  xeokitAngleMeasurements: XeokitAngleMeasurementRecord[];
} {
  const fallbackMeasurements: ReviewSnapshotMeasurementPayload[] = [];
  const xeokitDistanceMeasurements: XeokitDistanceMeasurementRecord[] = [];
  const xeokitAngleMeasurements: XeokitAngleMeasurementRecord[] = [];

  for (const measurement of measurements) {
    const normalized = normalizeReplayMeasurement(measurement as unknown);
    if (!normalized) {
      fallbackMeasurements.push(measurement);
      continue;
    }

    const converted = toXeokitMeasurement(normalized);
    if (converted.kind === 'angle') {
      xeokitAngleMeasurements.push(converted);
      continue;
    }
    xeokitDistanceMeasurements.push(converted);
  }

  return {
    measurements: dedupeReplayItems(fallbackMeasurements) as ReviewSnapshotMeasurementPayload[],
    xeokitDistanceMeasurements: dedupeReplayItems(xeokitDistanceMeasurements) as XeokitDistanceMeasurementRecord[],
    xeokitAngleMeasurements: dedupeReplayItems(xeokitAngleMeasurements) as XeokitAngleMeasurementRecord[],
  };
}

export function mergeWorkflowCommentsIntoRecords(
  records: WorkflowRecordData[],
  comments: WorkflowAnnotationCommentData[] = [],
  formId?: string,
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
    annotations: injectFormIdIntoItems(
      attachCommentsToItems(record.annotations ?? [], 'text', groupedComments),
      formId,
    ),
    cloudAnnotations: injectFormIdIntoItems(
      attachCommentsToItems(record.cloudAnnotations ?? [], 'cloud', groupedComments),
      formId,
    ),
    rectAnnotations: injectFormIdIntoItems(
      attachCommentsToItems(record.rectAnnotations ?? [], 'rect', groupedComments),
      formId,
    ),
    obbAnnotations: injectFormIdIntoItems(
      attachCommentsToItems(record.obbAnnotations ?? [], 'obb', groupedComments),
      formId,
    ),
    measurements: injectFormIdIntoItems(record.measurements ?? [], formId),
  }));
}

export function buildReviewRecordReplayPayload(records: ReplayRecordLike[]): string {
  const replayMeasurements = buildReplayMeasurements(
    dedupeReplayItems(records.flatMap((record) => record.measurements ?? []))
  );
  const annotations = dedupeReplayItems(records.flatMap((record) => record.annotations ?? []));
  const obbAnnotations = dedupeReplayItems(records.flatMap((record) => record.obbAnnotations ?? []));
  const cloudAnnotations = dedupeReplayItems(records.flatMap((record) => record.cloudAnnotations ?? []));
  const rectAnnotations = dedupeReplayItems(records.flatMap((record) => record.rectAnnotations ?? []));
  return JSON.stringify({
    version: 5,
    measurements: replayMeasurements.measurements,
    annotations,
    obbAnnotations,
    cloudAnnotations,
    rectAnnotations,
    dimensions: [],
    xeokitDistanceMeasurements: replayMeasurements.xeokitDistanceMeasurements,
    xeokitAngleMeasurements: replayMeasurements.xeokitAngleMeasurements,
  });
}

export function buildWorkflowSnapshotReplayPayload(
  records: WorkflowRecordData[],
  comments: WorkflowAnnotationCommentData[] = [],
  formId?: string,
): string {
  return buildReviewRecordReplayPayload(mergeWorkflowCommentsIntoRecords(records, comments, formId));
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
