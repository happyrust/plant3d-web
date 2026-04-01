import {
  buildWorkflowSnapshotReplayPayload,
  extractWorkflowModelRefnos,
} from './reviewRecordReplay';

import {
  reviewWorkflowSyncQuery,
  type WorkflowSyncActor,
  type WorkflowSyncQueryRequest,
  type WorkflowSyncResponse,
} from '@/api/reviewApi';

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
};

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

  if (records.length > 0 && options.importTools) {
    options.importTools(buildWorkflowSnapshotReplayPayload(records, comments));
    options.syncTools?.();
  }

  return {
    modelRefnos,
    recordCount: records.length,
    attachmentCount: data?.attachments?.length ?? 0,
  };
}
