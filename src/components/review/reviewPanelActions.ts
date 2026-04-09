import type {
  MeasurementRecord,
  XeokitAngleMeasurementRecord,
  XeokitDistanceMeasurementRecord,
} from '@/composables/useToolStore';
import type { ReviewTask, WorkflowNode, WorkflowStep } from '@/types/auth';

const WORKFLOW_NODE_ORDER: WorkflowNode[] = ['sj', 'jd', 'sh', 'pz'];

export function canFinalizeAtCurrentNode(currentNode?: WorkflowNode): boolean {
  return currentNode === 'pz';
}

export function canSubmitAtCurrentNode(currentNode?: WorkflowNode): boolean {
  return WORKFLOW_NODE_ORDER.includes(currentNode ?? 'sj');
}

export function canReturnAtCurrentNode(currentNode?: WorkflowNode): boolean {
  return WORKFLOW_NODE_ORDER.indexOf(currentNode ?? 'sj') > 0;
}

export function getSubmitActionLabel(currentNode?: WorkflowNode): string {
  switch (currentNode ?? 'sj') {
    case 'sj':
      return '提交到校核';
    case 'jd':
      return '提交到审核';
    case 'sh':
      return '提交到批准';
    case 'pz':
      return '最终批准';
  }
}

export function getWorkflowSubmitBridgeAction(currentNode?: WorkflowNode): 'active' | 'agree' {
  return (currentNode ?? 'sj') === 'sj' ? 'active' : 'agree';
}

export type TaskDetailHistoryItem = {
  action: string;
  userName: string;
  comment?: string;
  timestamp: number;
};

export function mapWorkflowHistoryToTaskDetailItems(history: WorkflowStep[]): TaskDetailHistoryItem[] {
  return history.map((item) => ({
    action: item.action,
    userName: item.operatorName || item.operatorId || '系统',
    comment: item.comment,
    timestamp: item.timestamp,
  }));
}

export type ReviewConfirmSnapshotPayload = {
  annotations: unknown[];
  cloudAnnotations: unknown[];
  rectAnnotations: unknown[];
  obbAnnotations: unknown[];
  measurements: unknown[];
};

type ReviewConfirmSnapshotRecordLike = {
  annotations?: unknown[];
  cloudAnnotations?: unknown[];
  rectAnnotations?: unknown[];
  obbAnnotations?: unknown[];
  measurements?: unknown[];
};

type ReviewConfirmSnapshotPayloadInput = ReviewConfirmSnapshotRecordLike & {
  xeokitDistanceMeasurements?: XeokitDistanceMeasurementRecord[];
  xeokitAngleMeasurements?: XeokitAngleMeasurementRecord[];
};

function convertXeokitMeasurementToClassic(
  measurement: XeokitDistanceMeasurementRecord | XeokitAngleMeasurementRecord,
): MeasurementRecord {
  if (measurement.kind === 'angle') {
    return {
      id: measurement.id,
      kind: 'angle',
      origin: measurement.origin,
      corner: measurement.corner,
      target: measurement.target,
      visible: measurement.visible,
      createdAt: measurement.createdAt,
    };
  }

  return {
    id: measurement.id,
    kind: 'distance',
    origin: measurement.origin,
    target: measurement.target,
    visible: measurement.visible,
    createdAt: measurement.createdAt,
  };
}

function dedupeSnapshotCollection(items: unknown[]): unknown[] {
  const keyedItems = new Map<string, unknown>();
  const anonymousItems = new Set<string>();
  const dedupedAnonymousItems: unknown[] = [];

  for (const item of items) {
    const itemId = getSnapshotItemId(item);
    if (itemId) {
      keyedItems.set(itemId, item);
      continue;
    }

    const itemKey = buildSnapshotItemKey(item);
    if (anonymousItems.has(itemKey)) continue;
    anonymousItems.add(itemKey);
    dedupedAnonymousItems.push(item);
  }

  return [...keyedItems.values(), ...dedupedAnonymousItems];
}

export function buildReviewConfirmSnapshotPayload(
  payload: ReviewConfirmSnapshotPayloadInput,
): ReviewConfirmSnapshotPayload {
  const xeokitMeasurements = [
    ...(payload.xeokitDistanceMeasurements ?? [])
      .filter((measurement) => !measurement.approximate)
      .map(convertXeokitMeasurementToClassic),
    ...(payload.xeokitAngleMeasurements ?? [])
      .filter((measurement) => !measurement.approximate)
      .map(convertXeokitMeasurementToClassic),
  ];

  return {
    annotations: [...(payload.annotations ?? [])],
    cloudAnnotations: [...(payload.cloudAnnotations ?? [])],
    rectAnnotations: [...(payload.rectAnnotations ?? [])],
    obbAnnotations: [...(payload.obbAnnotations ?? [])],
    measurements: dedupeSnapshotCollection([...(payload.measurements ?? []), ...xeokitMeasurements]),
  };
}

export function buildReviewConfirmSnapshotPayloadFromRecords(
  records: ReviewConfirmSnapshotRecordLike[]
): ReviewConfirmSnapshotPayload {
  return buildReviewConfirmSnapshotPayload({
    annotations: records.flatMap((record) => record.annotations ?? []),
    cloudAnnotations: records.flatMap((record) => record.cloudAnnotations ?? []),
    rectAnnotations: records.flatMap((record) => record.rectAnnotations ?? []),
    obbAnnotations: records.flatMap((record) => record.obbAnnotations ?? []),
    measurements: records.flatMap((record) => record.measurements ?? []),
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getSnapshotObjectSortKey(value: unknown): string {
  if (!isPlainObject(value)) return JSON.stringify(value);
  const id = typeof value.id === 'string' ? value.id : '';
  const createdAt = typeof value.createdAt === 'number' || typeof value.createdAt === 'string'
    ? String(value.createdAt)
    : '';
  const kind = typeof value.kind === 'string' ? value.kind : '';
  return `${id}|${createdAt}|${kind}|${JSON.stringify(value)}`;
}

function normalizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeSnapshotValue(item));
    if (normalized.every((item) => typeof item === 'string')) {
      return [...normalized].sort((a, b) => String(a).localeCompare(String(b)));
    }
    if (normalized.every((item) => isPlainObject(item))) {
      return [...normalized].sort((a, b) => getSnapshotObjectSortKey(a).localeCompare(getSnapshotObjectSortKey(b)));
    }
    return normalized;
  }
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, normalizeSnapshotValue(value[key])])
  );
}

export function buildReviewConfirmSnapshotKey(payload: ReviewConfirmSnapshotPayload): string {
  return JSON.stringify({
    annotations: normalizeSnapshotValue(payload.annotations),
    cloudAnnotations: normalizeSnapshotValue(payload.cloudAnnotations),
    rectAnnotations: normalizeSnapshotValue(payload.rectAnnotations),
    obbAnnotations: normalizeSnapshotValue(payload.obbAnnotations),
    measurements: normalizeSnapshotValue(payload.measurements),
  });
}

function buildSnapshotItemKey(item: unknown): string {
  return JSON.stringify(normalizeSnapshotValue(item));
}

function getSnapshotItemId(item: unknown): string | null {
  if (!isPlainObject(item)) return null;
  const id = item.id;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed || null;
}

function diffSnapshotCollection(current: unknown[], baseline: unknown[]): unknown[] {
  const baselineById = new Map<string, string>();
  const baselineWithoutId = new Set<string>();

  for (const item of baseline) {
    const itemId = getSnapshotItemId(item);
    const itemKey = buildSnapshotItemKey(item);
    if (itemId) {
      baselineById.set(itemId, itemKey);
      continue;
    }
    baselineWithoutId.add(itemKey);
  }

  const emittedWithId = new Set<string>();
  const emittedWithoutId = new Set<string>();

  return current.filter((item) => {
    const itemId = getSnapshotItemId(item);
    const itemKey = buildSnapshotItemKey(item);
    if (itemId) {
      if (baselineById.get(itemId) === itemKey) return false;
      const dedupeKey = `${itemId}|${itemKey}`;
      if (emittedWithId.has(dedupeKey)) return false;
      emittedWithId.add(dedupeKey);
      return true;
    }
    if (baselineWithoutId.has(itemKey)) return false;
    if (emittedWithoutId.has(itemKey)) return false;
    emittedWithoutId.add(itemKey);
    return true;
  });
}

export function buildUnsavedReviewConfirmPayload(
  current: ReviewConfirmSnapshotPayload,
  baseline: ReviewConfirmSnapshotPayload
): ReviewConfirmSnapshotPayload {
  return {
    annotations: diffSnapshotCollection(current.annotations, baseline.annotations),
    cloudAnnotations: diffSnapshotCollection(current.cloudAnnotations, baseline.cloudAnnotations),
    rectAnnotations: diffSnapshotCollection(current.rectAnnotations, baseline.rectAnnotations),
    obbAnnotations: diffSnapshotCollection(current.obbAnnotations, baseline.obbAnnotations),
    measurements: diffSnapshotCollection(current.measurements, baseline.measurements),
  };
}

export function hasReviewConfirmPayloadData(payload: ReviewConfirmSnapshotPayload): boolean {
  return payload.annotations.length > 0
    || payload.cloudAnnotations.length > 0
    || payload.rectAnnotations.length > 0
    || payload.obbAnnotations.length > 0
    || payload.measurements.length > 0;
}

type ConfirmCurrentDataOptions<TPayload> = {
  hasPendingData: boolean;
  payload: TPayload;
  addConfirmedRecord: (payload: TPayload) => Promise<string>;
  clearAll: () => void;
  resetNote: () => void;
};

export async function confirmCurrentDataSafely<TPayload>(
  options: ConfirmCurrentDataOptions<TPayload>
): Promise<boolean> {
  if (!options.hasPendingData) return false;
  await options.addConfirmedRecord(options.payload);
  options.clearAll();
  options.resetNote();
  return true;
}

type FinalizeTaskDecisionOptions = {
  updateTaskStatus: (
    taskId: string,
    status: ReviewTask['status'],
    comment?: string
  ) => Promise<void>;
  clearCurrentTask: () => void;
  taskId: string;
  status: 'approved' | 'rejected';
  comment?: string;
};

export async function finalizeTaskDecisionSafely(
  options: FinalizeTaskDecisionOptions
): Promise<void> {
  await options.updateTaskStatus(options.taskId, options.status, options.comment);
  options.clearCurrentTask();
}

type SubmitTaskToNextNodeSafelyOptions = {
  canSubmit: boolean;
  taskId?: string;
  submitComment: { value: string };
  showSubmitDialog: { value: boolean };
  workflowActionLoading: { value: boolean };
  workflowError: { value: string | null };
  submitTaskToNextNode: (taskId: string, comment?: string) => Promise<void>;
  refreshCurrentTask: (taskId: string) => Promise<void>;
  loadWorkflow: (taskId: string) => Promise<void>;
  emitToast: (payload: { message: string }) => void;
};

export async function submitTaskToNextNodeSafely(
  options: SubmitTaskToNextNodeSafelyOptions
): Promise<boolean> {
  if (!options.taskId || !options.canSubmit) return false;

  options.workflowActionLoading.value = true;
  options.workflowError.value = null;
  const trimmedComment = options.submitComment.value.trim();

  try {
    await options.submitTaskToNextNode(options.taskId, trimmedComment || undefined);
    await options.refreshCurrentTask(options.taskId);
    await options.loadWorkflow(options.taskId);
    options.emitToast({ message: '任务已提交到下一节点' });
    options.showSubmitDialog.value = false;
    options.submitComment.value = '';
    return true;
  } catch (e) {
    options.workflowError.value = e instanceof Error ? e.message : '提交失败';
    return false;
  } finally {
    options.workflowActionLoading.value = false;
  }
}
