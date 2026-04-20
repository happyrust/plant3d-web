import {
  type ReviewSnapshot,
  createEmptyReviewSnapshot,
} from '../domain/reviewSnapshot';

export type BuildSnapshotFromImportPayloadOptions = {
  taskId?: string;
  formId?: string;
  workflowNode?: ReviewSnapshot['workflowNode'];
  taskStatus?: string;
  now?: () => number;
};

type ImportPayloadLike = {
  version?: unknown;
  measurements?: unknown[];
  annotations?: unknown[];
  obbAnnotations?: unknown[];
  cloudAnnotations?: unknown[];
  rectAnnotations?: unknown[];
  xeokitDistanceMeasurements?: unknown[];
  xeokitAngleMeasurements?: unknown[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : null;
}

function normalizeMeasurementKind(raw: unknown): 'distance' | 'angle' | 'unknown' {
  if (typeof raw !== 'string') return 'unknown';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'distance' || normalized === 'angle') return normalized;
  return 'unknown';
}

function pushAnnotations(
  snapshot: ReviewSnapshot,
  items: unknown[] | undefined,
  annotationType: 'text' | 'cloud' | 'rect' | 'obb',
  context: Pick<BuildSnapshotFromImportPayloadOptions, 'taskId' | 'formId' | 'workflowNode'>,
): void {
  if (!Array.isArray(items)) return;
  for (const raw of items) {
    const payload = asObject(raw);
    const annotationId = typeof payload?.id === 'string' ? payload.id : '';
    if (!payload || !annotationId) continue;
    snapshot.annotations.push({
      annotationId,
      annotationType,
      taskId: context.taskId,
      formId: context.formId,
      workflowNode: context.workflowNode,
      payload,
    });
  }
}

function pushMeasurements(
  snapshot: ReviewSnapshot,
  items: unknown[] | undefined,
  fallbackKind: 'distance' | 'angle' | 'unknown' = 'unknown',
): void {
  if (!Array.isArray(items)) return;
  for (const raw of items) {
    const payload = asObject(raw);
    const measurementId = typeof payload?.id === 'string' ? payload.id : '';
    if (!payload || !measurementId) continue;
    snapshot.measurements.push({
      measurementId,
      kind: normalizeMeasurementKind(payload.kind) === 'unknown'
        ? fallbackKind
        : normalizeMeasurementKind(payload.kind),
      payload,
    });
  }
}

export function buildSnapshotFromImportPayload(
  payload: ImportPayloadLike | null | undefined,
  options: BuildSnapshotFromImportPayloadOptions = {},
): ReviewSnapshot {
  const snapshot = createEmptyReviewSnapshot({
    source: 'import_package',
    taskId: options.taskId,
    formId: options.formId,
    workflowNode: options.workflowNode,
    taskStatus: options.taskStatus,
    createdAt: (options.now ?? Date.now)(),
    raw: payload && typeof payload === 'object'
      ? { version: (payload as Record<string, unknown>).version }
      : undefined,
  });

  if (!payload || typeof payload !== 'object') return snapshot;

  pushAnnotations(snapshot, payload.annotations, 'text', options);
  pushAnnotations(snapshot, payload.cloudAnnotations, 'cloud', options);
  pushAnnotations(snapshot, payload.rectAnnotations, 'rect', options);
  pushAnnotations(snapshot, payload.obbAnnotations, 'obb', options);
  pushMeasurements(snapshot, payload.measurements, 'unknown');
  pushMeasurements(snapshot, payload.xeokitDistanceMeasurements, 'distance');
  pushMeasurements(snapshot, payload.xeokitAngleMeasurements, 'angle');

  return snapshot;
}
