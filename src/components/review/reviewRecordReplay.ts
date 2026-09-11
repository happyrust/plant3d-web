import type {
  ReviewSnapshotMeasurementPayload,
  WorkflowAnnotationCommentData,
  WorkflowRecordData,
} from '@/api/reviewApi';
import type {
  ElevationDeltaMeasurementRecord,
  ElevationPointMeasurementRecord,
  MeasurementRecord,
  MeasurementPoint,
} from '@/composables/useToolStore';

import {
  fromClassicMeasurement,
  isUnifiedMeasurementRecord,
  normalizeUnifiedMeasurementRecord,
  type UnifiedMeasurementRecord,
} from '@/composables/unifiedMeasurement';
import { isComputationProvenance } from '@/measurement/domain/computationProvenance';
import { fromBackendRole, type AnnotationComment } from '@/types/auth';

type ReplayRecordLike = Pick<
  WorkflowRecordData,
  'annotations' | 'cloudAnnotations' | 'rectAnnotations' | 'obbAnnotations' | 'measurements'
> & {
  id?: unknown;
  taskId?: unknown;
  formId?: unknown;
  confirmedAt?: unknown;
};

export type ReviewRecordReplayOptions = {
  formId?: string | null;
  taskId?: string | null;
};

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

function normalizeOptionalContext(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function getRecordFormId(record: ReplayRecordLike, options: ReviewRecordReplayOptions): string | undefined {
  return normalizeOptionalContext(record.formId) ?? normalizeOptionalContext(options.formId);
}

function getRecordTaskId(record: ReplayRecordLike, options: ReviewRecordReplayOptions): string | undefined {
  return normalizeOptionalContext(record.taskId) ?? normalizeOptionalContext(options.taskId);
}

function injectContextIntoItems(
  items: unknown[],
  context: { formId?: string; taskId?: string },
): unknown[] {
  if (!context.formId && !context.taskId) return items;

  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    const currentFormId = normalizeOptionalContext(record.formId);
    const currentTaskId = normalizeOptionalContext(record.taskId);
    const nextFormId = currentFormId ?? context.formId;
    const nextTaskId = currentTaskId ?? context.taskId;
    if (
      nextFormId === record.formId
      && nextTaskId === record.taskId
    ) {
      return item;
    }
    return {
      ...record,
      ...(nextFormId ? { formId: nextFormId } : {}),
      ...(nextTaskId ? { taskId: nextTaskId } : {}),
    };
  });
}

function parseReplayRecordTimestamp(record: ReplayRecordLike): number {
  const raw = record.confirmedAt;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw.replace(' ', 'T'));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

function normalizeReplayRecords(
  records: ReplayRecordLike[],
  options: ReviewRecordReplayOptions,
): ReplayRecordLike[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const diff = parseReplayRecordTimestamp(a.record) - parseReplayRecordTimestamp(b.record);
      return diff === 0 ? a.index - b.index : diff;
    })
    .map(({ record }) => {
      const context = {
        formId: getRecordFormId(record, options),
        taskId: getRecordTaskId(record, options),
      };
      return {
        ...record,
        annotations: injectContextIntoItems(record.annotations ?? [], context),
        cloudAnnotations: injectContextIntoItems(record.cloudAnnotations ?? [], context),
        rectAnnotations: injectContextIntoItems(record.rectAnnotations ?? [], context),
        obbAnnotations: injectContextIntoItems(record.obbAnnotations ?? [], context),
        measurements: injectContextIntoItems(record.measurements ?? [], context) as ReviewSnapshotMeasurementPayload[],
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
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    ? record.createdAt
    : 0;
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
  const taskId = typeof record.taskId === 'string'
    ? record.taskId.trim() || undefined
    : undefined;
  const provenance = isComputationProvenance(record.provenance)
    ? record.provenance
    : undefined;

  if (!id) return null;

  if (kind === 'distance') {
    const origin = isMeasurementPoint(record.origin) ? record.origin : null;
    const target = isMeasurementPoint(record.target) ? record.target : null;
    if (!origin || !target) return null;
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
      taskId,
      provenance,
    };
  }

  if (kind === 'elevation_point') {
    const point = isMeasurementPoint(record.point) ? record.point : null;
    const absoluteElevation = typeof record.absoluteElevation === 'number' ? record.absoluteElevation : null;
    const datumElevation = typeof record.datumElevation === 'number' ? record.datumElevation : 0;
    if (!point || absoluteElevation === null) return null;
    const normalized: ElevationPointMeasurementRecord = {
      id,
      kind: 'elevation_point',
      point,
      absoluteElevation,
      datumElevation,
      relativeElevation: typeof record.relativeElevation === 'number'
        ? record.relativeElevation
        : absoluteElevation - datumElevation,
      visible,
      createdAt,
      sourceAnnotationId,
      sourceAnnotationType,
      formId,
      taskId,
      provenance,
    };
    return normalized;
  }

  if (kind === 'angle') {
    const origin = isMeasurementPoint(record.origin) ? record.origin : null;
    const corner = isMeasurementPoint(record.corner) ? record.corner : null;
    const target = isMeasurementPoint(record.target) ? record.target : null;
    if (!origin || !corner || !target) return null;
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
      taskId,
      provenance,
    };
  }

  if (kind === 'elevation_delta') {
    const origin = isMeasurementPoint(record.origin) ? record.origin : null;
    const target = isMeasurementPoint(record.target) ? record.target : null;
    if (!origin || !target) return null;
    const originElevation = typeof record.originElevation === 'number' ? record.originElevation : null;
    const targetElevation = typeof record.targetElevation === 'number' ? record.targetElevation : null;
    const datumElevation = typeof record.datumElevation === 'number' ? record.datumElevation : 0;
    if (originElevation === null || targetElevation === null) return null;
    const normalized: ElevationDeltaMeasurementRecord = {
      id,
      kind: 'elevation_delta',
      origin,
      target,
      originElevation,
      targetElevation,
      deltaElevation: typeof record.deltaElevation === 'number'
        ? record.deltaElevation
        : targetElevation - originElevation,
      datumElevation,
      visible,
      createdAt,
      sourceAnnotationId,
      sourceAnnotationType,
      formId,
      taskId,
      provenance,
    };
    return normalized;
  }

  return null;
}

function buildReplayMeasurements(measurements: ReviewSnapshotMeasurementPayload[]): {
  measurements: UnifiedMeasurementRecord[];
  legacyMeasurements: ReviewSnapshotMeasurementPayload[];
} {
  const unifiedMeasurements: UnifiedMeasurementRecord[] = [];
  const legacyMeasurements: ReviewSnapshotMeasurementPayload[] = [];

  for (const measurement of measurements) {
    if (isUnifiedMeasurementRecord(measurement)) {
      unifiedMeasurements.push(normalizeUnifiedMeasurementRecord(measurement));
      continue;
    }
    const normalized = normalizeReplayMeasurement(measurement as unknown);
    if (!normalized) {
      legacyMeasurements.push(measurement);
      continue;
    }
    unifiedMeasurements.push({
      ...fromClassicMeasurement(normalized),
      source: 'replay',
    });
  }

  return {
    measurements: dedupeReplayItems(unifiedMeasurements) as UnifiedMeasurementRecord[],
    legacyMeasurements: dedupeReplayItems(legacyMeasurements) as ReviewSnapshotMeasurementPayload[],
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
    annotations: injectContextIntoItems(
      attachCommentsToItems(record.annotations ?? [], 'text', groupedComments),
      { formId, taskId: normalizeOptionalContext(record.taskId) },
    ),
    cloudAnnotations: injectContextIntoItems(
      attachCommentsToItems(record.cloudAnnotations ?? [], 'cloud', groupedComments),
      { formId, taskId: normalizeOptionalContext(record.taskId) },
    ),
    rectAnnotations: injectContextIntoItems(
      attachCommentsToItems(record.rectAnnotations ?? [], 'rect', groupedComments),
      { formId, taskId: normalizeOptionalContext(record.taskId) },
    ),
    obbAnnotations: injectContextIntoItems(
      attachCommentsToItems(record.obbAnnotations ?? [], 'obb', groupedComments),
      { formId, taskId: normalizeOptionalContext(record.taskId) },
    ),
    measurements: injectContextIntoItems(
      record.measurements ?? [],
      { formId, taskId: normalizeOptionalContext(record.taskId) },
    ) as ReviewSnapshotMeasurementPayload[],
  }));
}

export function buildReviewRecordReplayPayload(
  records: ReplayRecordLike[],
  options: ReviewRecordReplayOptions = {},
): string {
  const normalizedRecords = normalizeReplayRecords(records, options);
  const replayMeasurements = buildReplayMeasurements(
    dedupeReplayItems(normalizedRecords.flatMap((record) => record.measurements ?? []))
  );
  const annotations = dedupeReplayItems(normalizedRecords.flatMap((record) => record.annotations ?? []));
  const obbAnnotations = dedupeReplayItems(normalizedRecords.flatMap((record) => record.obbAnnotations ?? []));
  const cloudAnnotations = dedupeReplayItems(normalizedRecords.flatMap((record) => record.cloudAnnotations ?? []));
  const rectAnnotations = dedupeReplayItems(normalizedRecords.flatMap((record) => record.rectAnnotations ?? []));
  return JSON.stringify({
    version: 7,
    measurements: replayMeasurements.measurements,
    legacyMeasurements: replayMeasurements.legacyMeasurements,
    annotations,
    obbAnnotations,
    cloudAnnotations,
    rectAnnotations,
  });
}

export function buildWorkflowSnapshotReplayPayload(
  records: WorkflowRecordData[],
  comments: WorkflowAnnotationCommentData[] = [],
  formId?: string,
): string {
  return buildReviewRecordReplayPayload(
    mergeWorkflowCommentsIntoRecords(records, comments, formId),
    { formId },
  );
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
