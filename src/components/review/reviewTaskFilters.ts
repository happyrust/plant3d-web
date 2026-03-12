import type { ReviewTask, WorkflowStep } from '@/types/auth';

export function isDesignerResubmissionTask(task: ReviewTask): boolean {
  return task.currentNode === 'sj' && task.status === 'draft' && !!task.returnReason?.trim();
}

export function getDesignerTaskStatusBucket(task: ReviewTask): 'returned' | 'pending' | 'approved' | 'other' {
  if (isDesignerResubmissionTask(task)) return 'returned';
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
