import type { ReviewTask, WorkflowNode } from '@/types/auth';

export function canFinalizeAtCurrentNode(currentNode?: WorkflowNode): boolean {
  return currentNode === 'pz';
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
