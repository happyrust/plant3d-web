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
  /** 执行退回的节点；流转历史里没有 return 步时为 null，不拿 currentNode 顶替 */
  returnFromNode: WorkflowStep['node'] | null;
} {
  const latestReturnStep = getLatestReturnStep(task);

  return {
    latestReturnStep,
    returnReason: latestReturnStep?.comment || task.returnReason || task.reviewComment || null,
    returnNode: latestReturnStep?.node || task.currentNode || null,
    returnFromNode: latestReturnStep?.node ?? null,
  };
}

export function getCanonicalReturnedTaskView(task: ReviewTask, workflowHistory?: WorkflowStep[]): ReviewTask {
  if (!workflowHistory?.length) return task;

  return {
    ...task,
    workflowHistory,
  };
}

function isLatestSubmitNotEarlierThanLatestReturn(task: ReviewTask): boolean {
  const latestReturnStep = getLatestReturnStep(task);
  const latestSubmitStep = getLatestSubmitStep(task);
  return !!(
    latestSubmitStep
    && latestReturnStep
    && latestSubmitStep.timestamp >= latestReturnStep.timestamp
  );
}

export function isCanonicalReturnedTask(task: ReviewTask): boolean {
  if (task.status === 'rejected') return true;
  if (task.currentNode !== 'sj' || task.status !== 'draft') return false;

  if (isLatestSubmitNotEarlierThanLatestReturn(task)) return false;

  if (task.returnReason?.trim() || task.reviewComment?.trim()) return true;

  return !!getLatestReturnStep(task);
}

export function isDesignerResubmissionTask(task: ReviewTask): boolean {
  if (!isCanonicalReturnedTask(task)) return false;
  if (task.currentNode !== 'sj') return false;
  if (task.status !== 'draft' && task.status !== 'rejected') return false;
  if (isLatestSubmitNotEarlierThanLatestReturn(task)) return false;
  return true;
}

export function isRejectedDesignerTask(task: ReviewTask): boolean {
  return isCanonicalReturnedTask(task);
}

/** 已保存、还停在编制节点、没被退回过的草稿：设计端重开时可以直接「修改已保存的编校审单」 */
export function isSavedDesignerDraftTask(task: ReviewTask): boolean {
  return task.status === 'draft' && task.currentNode === 'sj' && !isCanonicalReturnedTask(task);
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

/**
 * 退回时间：优先取流转历史里最近的 return 步；外部流转只带了 returnReason、没写 return 步时
 * 回退到 updatedAt，并标 approximate，界面上要写「约」。
 */
export function getResubmissionReturnTimeInfo(task: ReviewTask): { timestamp: number | null; approximate: boolean } {
  const exact = getResubmissionLatestReturnTime(task.workflowHistory || []);
  if (exact) return { timestamp: exact, approximate: false };
  if (task.updatedAt) return { timestamp: task.updatedAt, approximate: true };
  return { timestamp: null, approximate: false };
}

/** 按退回时间倒序（口径同 getResubmissionReturnTimeInfo），时间相同保持原顺序 */
export function sortTasksByLatestReturn(tasks: ReviewTask[]): ReviewTask[] {
  return [...tasks].sort((a, b) => (
    (getResubmissionReturnTimeInfo(b).timestamp ?? 0) - (getResubmissionReturnTimeInfo(a).timestamp ?? 0)
  ));
}
