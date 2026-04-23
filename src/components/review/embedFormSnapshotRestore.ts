import {
  buildWorkflowSnapshotReplayPayload,
  extractWorkflowModelRefnos,
} from './reviewRecordReplay';

import type { ReviewAttachment, ReviewTask } from '@/types/auth';

import {
  normalizeReviewAttachment,
  reviewWorkflowSyncQuery,
  type WorkflowSyncActor,
  type WorkflowSyncQueryRequest,
  type WorkflowSyncResponse,
} from '@/api/reviewApi';
import { buildSnapshotFromWorkflowSync } from '@/review/adapters/workflowSyncAdapter';
import { runWorkflowSyncShadow } from '@/review/services/reviewSnapshotService';
import {
  getReviewCommentEventLog,
  getReviewCommentThreadStore,
  isReviewCommentThreadStoreActive,
} from '@/review/services/sharedStores';

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

export type EmbedFormSnapshotContextOptions = EmbedFormSnapshotRestoreOptions & {
  task?: ReviewTask | null;
  updateTask?: (task: ReviewTask) => Promise<void> | void;
};

export type EmbedFormSnapshotContextResult = EmbedFormSnapshotRestoreResult & {
  task: ReviewTask | null;
};

function mergeSnapshotModelRefnosIntoTask(
  task: ReviewTask,
  modelRefnos: string[],
): ReviewTask {
  if (!modelRefnos.length) return task;

  const mergedComponents = modelRefnos.map((refno, index) => ({
    id: `form-model-${index + 1}-${refno}`,
    name: refno,
    refNo: refno,
    type: 'BRAN',
  }));

  return {
    ...task,
    components: mergedComponents,
  };
}

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
    const legacyPayload = buildWorkflowSnapshotReplayPayload(records, comments, options.formId);
    const shadowResult = runWorkflowSyncShadow({ legacyPayload, data });

    if (isReviewCommentThreadStoreActive()) {
      try {
        const snapshot = shadowResult?.snapshot ?? buildSnapshotFromWorkflowSync(data);
        const merge = getReviewCommentThreadStore().mergeFromSnapshot(snapshot);
        if (merge.changed) {
          getReviewCommentEventLog().push({
            kind: 'snapshot_merged',
            key: 'workflow_sync',
            payload: {
              formId: options.formId,
              comments: snapshot.comments.length,
              annotations: snapshot.annotations.length,
            },
          });
        }
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.warn('[review/M3 thread store] workflow_sync merge failed', err);
        }
      }
    }

    options.importTools(legacyPayload);
    options.syncTools?.();
  }

  if (typeof console !== 'undefined') {
    console.info('[embed][form-restore] workflow snapshot resolved', {
      formId: options.formId,
      taskId: data?.taskId || null,
      modelCount: modelRefnos.length,
      modelRefnos,
      recordCount: records.length,
      attachmentCount: attachments.length,
    });
  }

  return {
    modelRefnos,
    recordCount: records.length,
    attachmentCount: attachments.length,
    attachments,
  };
}

export async function restoreEmbedFormSnapshotContext(
  options: EmbedFormSnapshotContextOptions,
): Promise<EmbedFormSnapshotContextResult> {
  const snapshot = await restoreEmbedFormSnapshot(options);
  let nextTask = options.task ?? null;

  if (nextTask && snapshot.modelRefnos.length > 0) {
    nextTask = mergeSnapshotModelRefnosIntoTask(nextTask, snapshot.modelRefnos);
    if (typeof console !== 'undefined') {
      console.info('[embed][form-restore] task components replaced from workflow snapshot', {
        formId: options.formId,
        taskId: nextTask.id,
        componentCount: nextTask.components.length,
        componentRefnos: nextTask.components.map((component) => component.refNo),
      });
    }
    await options.updateTask?.(nextTask);
  }

  if (nextTask && snapshot.attachments.length > 0) {
    nextTask = mergeSnapshotAttachmentsIntoTask(nextTask, snapshot.attachments);
    await options.updateTask?.(nextTask);
  }

  return {
    ...snapshot,
    task: nextTask,
  };
}
