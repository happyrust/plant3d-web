import type { ReviewTask, WorkflowStep } from '@/types/auth';

function getLatestReturnStep(task: ReviewTask): WorkflowStep | null {
  const history = task.workflowHistory || [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const step = history[index];
    if (step?.action === 'return') {
      return step;
    }
  }
  return null;
}

function getLatestSubmitStep(task: ReviewTask): WorkflowStep | null {
  const history = task.workflowHistory || [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const step = history[index];
    if (step?.action === 'submit') {
      return step;
    }
  }
  return null;
}

export function getCanonicalReturnedMetadata(task: ReviewTask): {
  latestReturnStep: WorkflowStep | null;
  returnReason: string | null;
  returnNode: WorkflowStep['node'] | ReviewTask['currentNode'] | null;
} {
  const latestReturnStep = getLatestReturnStep(task);

  return {
    latestReturnStep,
    returnReason: latestReturnStep?.comment || task.returnReason || task.reviewComment || null,
    returnNode: latestReturnStep?.node || task.currentNode || null,
  };
}

export function getCanonicalReturnedTaskView(task: ReviewTask, workflowHistory?: WorkflowStep[]): ReviewTask {
  if (!workflowHistory?.length) return task;

  return {
    ...task,
    workflowHistory,
  };
}

export function isCanonicalReturnedTask(task: ReviewTask): boolean {
  if (task.status === 'rejected') return true;
  if (task.currentNode !== 'sj' || task.status !== 'draft') return false;

  const latestReturnStep = getLatestReturnStep(task);
  const latestSubmitStep = getLatestSubmitStep(task);
  if (latestSubmitStep && latestReturnStep && latestSubmitStep.timestamp >= latestReturnStep.timestamp) {
    return false;
  }

  if (task.returnReason?.trim() || task.reviewComment?.trim()) return true;

  return !!latestReturnStep;
}

export function isDesignerResubmissionTask(task: ReviewTask): boolean {
  return isCanonicalReturnedTask(task) && task.currentNode === 'sj' && task.status === 'draft';
}

export function isRejectedDesignerTask(task: ReviewTask): boolean {
  return isCanonicalReturnedTask(task);
}

export function getDesignerTaskStatusBucket(task: ReviewTask): 'returned' | 'pending' | 'approved' | 'other' {
  if (isCanonicalReturnedTask(task)) return 'returned';
  if (task.status === 'submitted' || task.status === 'in_review') return 'pending';
  if (task.status === 'approved') return 'approved';
  return 'other';
}

export function getResubmissionSubmissionCount(history: WorkflowStep[]): number {
  return history.filter((item) => item.action === 'submit').length;
}

export function getResubmissionLatestReturnTime(history: WorkflowStep[]): number | null {
  const returnSteps = history.filter((item) => item.action === 'return');
  if (returnSteps.length === 0) return null;
  return Math.max(...returnSteps.map((item) => item.timestamp));
}
