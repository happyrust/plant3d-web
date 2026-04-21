import type {
  MeasurementRecord,
  XeokitAngleMeasurementRecord,
  XeokitDistanceMeasurementRecord,
} from '@/composables/useToolStore';
import type { ReviewTask, WorkflowNode, WorkflowStep } from '@/types/auth';

import {
  getReviewAnnotationCheckFromError,
  getReviewApiErrorMessage,
  type ReviewAnnotationCheckResponse,
} from '@/api/reviewApi';

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

export function getDefaultReturnTargetNode(currentNode?: WorkflowNode): WorkflowNode {
  const idx = WORKFLOW_NODE_ORDER.indexOf(currentNode ?? 'sj');
  return idx > 0 ? WORKFLOW_NODE_ORDER[idx - 1] : 'sj';
}

export function getAvailableReturnNodes(currentNode?: WorkflowNode): WorkflowNode[] {
  const idx = WORKFLOW_NODE_ORDER.indexOf(currentNode ?? 'sj');
  return idx > 0 ? WORKFLOW_NODE_ORDER.slice(0, idx) : [];
}

export function getSubmitActionLabel(currentNode?: WorkflowNode): string {
  switch (currentNode ?? 'sj') {
    case 'sj':
      return '确认流转至校对';
    case 'jd':
      return '确认流转至审核';
    case 'sh':
      return '确认流转至批准';
    case 'pz':
      return '确认最终批准';
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
      sourceAnnotationId: measurement.sourceAnnotationId,
      sourceAnnotationType: measurement.sourceAnnotationType,
    };
  }

  return {
    id: measurement.id,
    kind: 'distance',
    origin: measurement.origin,
    target: measurement.target,
    visible: measurement.visible,
    createdAt: measurement.createdAt,
    sourceAnnotationId: measurement.sourceAnnotationId,
    sourceAnnotationType: measurement.sourceAnnotationType,
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

export function buildSubmitBlockingReviewConfirmPayload(
  current: ReviewConfirmSnapshotPayload,
  baseline: ReviewConfirmSnapshotPayload
): ReviewConfirmSnapshotPayload {
  const payload = buildUnsavedReviewConfirmPayload(current, baseline);
  return {
    ...payload,
    obbAnnotations: [],
  };
}

export function hasReviewConfirmPayloadData(payload: ReviewConfirmSnapshotPayload): boolean {
  return payload.annotations.length > 0
    || payload.cloudAnnotations.length > 0
    || payload.rectAnnotations.length > 0
    || payload.obbAnnotations.length > 0
    || payload.measurements.length > 0;
}

export function hasSubmitBlockingReviewConfirmPayloadData(
  payload: ReviewConfirmSnapshotPayload
): boolean {
  return payload.annotations.length > 0
    || payload.cloudAnnotations.length > 0
    || payload.rectAnnotations.length > 0
    || payload.measurements.length > 0;
}

function resolveReviewAnnotationCheckMessage(
  response: ReviewAnnotationCheckResponse['data'] | undefined,
  currentNode?: WorkflowNode,
  fallbackMessage = '批注检查失败，请稍后重试'
): string {
  if (response?.recommendedAction === 'return') {
    return response.message || '当前应驳回，不可直接流转到下一节点';
  }

  if (response?.recommendedAction === 'block') {
    return response.message || (
      currentNode === 'sj'
        ? '当前仍有未处理批注，请先处理并确认数据后再继续'
        : '当前仍有待确认批注，请逐条确认后再继续'
    );
  }

  return fallbackMessage;
}

export async function runReviewSubmitPreflight(options: {
  hasUnsavedBlockingData: boolean;
  taskId?: string;
  currentNode?: WorkflowNode;
  checkAnnotations: () => Promise<ReviewAnnotationCheckResponse>;
}): Promise<{ allowed: boolean; message?: string }> {
  if (options.hasUnsavedBlockingData) {
    return {
      allowed: false,
      message: '请先确认数据，再执行流转',
    };
  }

  if (!options.taskId) {
    return {
      allowed: false,
      message: '当前任务不存在，无法提交',
    };
  }

  try {
    const response = await options.checkAnnotations();
    if (response.success && response.data?.passed) {
      return { allowed: true };
    }

    return {
      allowed: false,
      message: resolveReviewAnnotationCheckMessage(
        response.data,
        options.currentNode,
        response.errorMessage || '批注检查失败，请稍后重试'
      ),
    };
  } catch (error) {
    return {
      allowed: false,
      message: resolveReviewSubmitErrorMessage(
        error,
        options.currentNode,
        '批注检查失败，请稍后重试'
      ),
    };
  }
}

export function resolveReviewSubmitErrorMessage(
  error: unknown,
  currentNode?: WorkflowNode,
  fallbackMessage = '提交流转失败'
): string {
  const annotationCheck = getReviewAnnotationCheckFromError(error);
  if (annotationCheck) {
    return resolveReviewAnnotationCheckMessage(annotationCheck, currentNode, fallbackMessage);
  }

  return getReviewApiErrorMessage(error, fallbackMessage);
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
  currentNode?: WorkflowNode;
  submitComment: { value: string };
  showSubmitDialog: { value: boolean };
  workflowActionLoading: { value: boolean };
  workflowError: { value: string | null };
  beforeSubmit?: () => Promise<{ allowed: boolean; message?: string }>;
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
    if (options.beforeSubmit) {
      const preflight = await options.beforeSubmit();
      if (!preflight.allowed) {
        options.workflowError.value = preflight.message || '提交流转前校验未通过';
        return false;
      }
    }

    await options.submitTaskToNextNode(options.taskId, trimmedComment || undefined);
    await options.refreshCurrentTask(options.taskId);
    await options.loadWorkflow(options.taskId);
    options.emitToast({ message: '已确认提交流转' });
    options.showSubmitDialog.value = false;
    options.submitComment.value = '';
    return true;
  } catch (e) {
    options.workflowError.value = resolveReviewSubmitErrorMessage(e, options.currentNode);
    return false;
  } finally {
    options.workflowActionLoading.value = false;
  }
}
