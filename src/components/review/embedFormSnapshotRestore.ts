import {
  buildWorkflowSnapshotReplayPayload,
  extractWorkflowModelRefnos,
} from './reviewRecordReplay';

import {
  normalizeReviewAttachment,
  reviewWorkflowSyncQuery,
  type WorkflowSyncActor,
  type WorkflowSyncQueryRequest,
  type WorkflowSyncResponse,
} from '@/api/reviewApi';
import type { ReviewAttachment, ReviewTask } from '@/types/auth';

export type EmbedFormSnapshotRestoreOptions = {
  formId: string;
  token: string;
  actor: WorkflowSyncActor;
  request?: (request: WorkflowSyncQueryRequest) => Promise<WorkflowSyncResponse>;
  importTools?: (payload: string) => void;
  syncTools?: () => void;
};

export type EmbedFormSnapshotRestoreResult = {
  modelRefnos: string[];
  recordCount: number;
  attachmentCount: number;
  attachments: ReviewAttachment[];
};

export function mergeSnapshotAttachmentsIntoTask(
  task: ReviewTask,
  attachments: ReviewAttachment[],
): ReviewTask {
  if (!attachments.length) return task;
  const merged = new Map<string, ReviewAttachment>();
  for (const attachment of task.attachments || []) {
    if (attachment?.id) {
      merged.set(String(attachment.id), attachment);
    }
  }
  for (const attachment of attachments) {
    if (attachment?.id) {
      merged.set(String(attachment.id), attachment);
    }
  }
  return {
    ...task,
    attachments: [...merged.values()],
  };
}

export async function restoreEmbedFormSnapshot(
  options: EmbedFormSnapshotRestoreOptions,
): Promise<EmbedFormSnapshotRestoreResult> {
  const request = options.request ?? reviewWorkflowSyncQuery;
  const response = await request({
    formId: options.formId,
    token: options.token,
    actor: options.actor,
  });
  const data = response.data;
  const modelRefnos = extractWorkflowModelRefnos(data?.models ?? []);
  const records = data?.records ?? [];
  const comments = data?.annotationComments ?? [];
  const attachments = Array.isArray(data?.attachments)
    ? data.attachments.map((attachment) => normalizeReviewAttachment(attachment as Record<string, unknown>))
    : [];

  if (options.importTools) {
    options.importTools(buildWorkflowSnapshotReplayPayload(records, comments));
    options.syncTools?.();
  }

  return {
    modelRefnos,
    recordCount: records.length,
    attachmentCount: attachments.length,
    attachments,
  };
}
