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
): Promise<void> {
  if (!options.taskId || !options.canSubmit) return;

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
  } catch (e) {
    options.workflowError.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    options.workflowActionLoading.value = false;
  }
}
