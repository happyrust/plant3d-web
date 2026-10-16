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
import { applyAnnotationReviewStatesToToolStore } from '@/composables/useAnnotationReviewStateSync';
import { buildSnapshotFromWorkflowSync } from '@/review/adapters/workflowSyncAdapter';
import {
  getReviewCommentEventLog,
  getReviewCommentThreadStore,
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

  const normalizeRefno = (value: string) => value.trim().replace(/\//g, '_');
  const existingByRefno = new Map<string, ReviewTask['components'][number]>();
  for (const comp of task.components || []) {
    const key = comp?.refNo ? normalizeRefno(comp.refNo) : '';
    if (key && !existingByRefno.has(key)) {
      existingByRefno.set(key, comp);
    }
  }

  const mergedComponents = modelRefnos.map((refno, index) => {
    const existing = existingByRefno.get(normalizeRefno(refno));
    if (existing) {
      return existing;
    }
    return {
      id: `form-model-${index + 1}-${refno}`,
      name: refno,
      refNo: refno,
      type: 'BRAN',
    };
  });

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
  const resolveKey = (att: ReviewAttachment | null | undefined) =>
    String(att?.id || att?.url || '').trim();
  for (const attachment of task.attachments || []) {
    const key = resolveKey(attachment);
    if (key) {
      merged.set(key, attachment);
    }
  }
  for (const attachment of attachments) {
    const key = resolveKey(attachment);
    if (!key) continue;
    const existing = merged.get(key);
    merged.set(key, existing ? {
      ...existing,
      ...attachment,
      type: attachment.type || existing.type,
      size: attachment.size || existing.size,
      mimeType: attachment.mimeType || existing.mimeType,
      uploadedAt: attachment.uploadedAt ?? existing.uploadedAt,
    } : attachment);
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

    try {
      const snapshot = buildSnapshotFromWorkflowSync(data);
      if (snapshot.comments.length > 0) {
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
      }
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[review thread store] workflow_sync merge failed', err);
      }
    }

    options.importTools(legacyPayload);
    if (Array.isArray(data?.annotationStates) && data.annotationStates.length > 0) {
      applyAnnotationReviewStatesToToolStore(data.annotationStates);
    }
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
