import {
  getEmbedLandingPanelIdsWithOptions,
  type EmbedLandingTaskDraft,
  type EmbedLandingState,
  type EmbedLandingTarget,
  type EmbedLandingTaskSummary,
  type EmbedRestoreStatus,
} from './embedRoleLanding';

import type { ReviewTask, WorkflowNode } from '@/types/auth';

import { normalizeReviewDeliveryRefno } from '@/composables/useReviewDeliveryUnit';

type EmbedRestoreResult = Pick<
  EmbedLandingState,
  'target' | 'restoreStatus' | 'restoredTaskId' | 'restoredTaskSummary' | 'restoredTaskDraft'
> & {
  restoredTask: ReviewTask | null;
};

type ResolveEmbedRestoreOptions = {
  target: EmbedLandingTarget;
  formId: string | null;
  reviewerTasks: ReviewTask[];
  designerTasks: ReviewTask[];
  allTasks: ReviewTask[];
};

type RestoreEmbedWorkbenchOptions = {
  target: EmbedLandingTarget;
  formId: string | null;
  loadReviewTasks: () => Promise<void>;
  reviewerTasks: () => ReviewTask[];
  designerTasks: () => ReviewTask[];
  allTasks: () => ReviewTask[];
  setCurrentTask: (task: ReviewTask | null) => Promise<void>;
  openPanel: (panelId: string) => void;
  activatePanel: (panelId: string) => void;
  passiveWorkflowMode?: boolean;
};

function normalizeFormId(formId?: string | null): string | null {
  const normalized = formId?.trim();
  return normalized || null;
}

function findTaskByFormId(tasks: ReviewTask[], formId: string | null): ReviewTask | null {
  if (!formId) return null;
  return tasks.find((task) => normalizeFormId(task.formId) === formId) ?? null;
}

function buildTaskSummary(task: ReviewTask | null): EmbedLandingTaskSummary | null {
  if (!task) return null;
  return {
    title: task.title || '-',
    status: task.status,
    currentNode: (task.currentNode || 'sj') as WorkflowNode,
  };
}

function formatDueDateForDraft(task: ReviewTask | null): string {
  if (!task?.dueDate) return '';
  const date = new Date(task.dueDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function buildTaskDraft(task: ReviewTask | null): EmbedLandingTaskDraft | null {
  if (!task) return null;
  return {
    title: task.title || '',
    description: task.description || '',
    checkerId: task.checkerId || '',
    approverId: task.approverId || '',
    priority: task.priority || 'medium',
    dueDate: formatDueDateForDraft(task),
    components: (task.components ?? []).map((component) => ({
      ...component,
      refNo: normalizeReviewDeliveryRefno(component.refNo),
    })),
    attachments: [...(task.attachments ?? [])],
    taskId: task.id ?? null,
    formId: task.formId ?? null,
  };
}

function createRestoreResult(
  target: EmbedLandingTarget,
  restoreStatus: EmbedRestoreStatus,
  restoredTask: ReviewTask | null,
  restoredTaskSummary: EmbedLandingTaskSummary | null = buildTaskSummary(restoredTask),
): EmbedRestoreResult {
  return {
    target,
    restoreStatus,
    restoredTask,
    restoredTaskId: restoredTask?.id ?? null,
    restoredTaskSummary,
    restoredTaskDraft: buildTaskDraft(restoredTask),
  };
}

export function resolveEmbedRestoreResult(options: ResolveEmbedRestoreOptions): EmbedRestoreResult {
  const normalizedFormId = normalizeFormId(options.formId);
  if (!normalizedFormId) {
    return createRestoreResult(options.target, 'no_form', null, null);
  }

  if (options.target === 'reviewer') {
    const matchedTask = findTaskByFormId(options.reviewerTasks, normalizedFormId)
      ?? findTaskByFormId(options.allTasks, normalizedFormId);
    return createRestoreResult(options.target, matchedTask ? 'matched' : 'missing', matchedTask, null);
  }

  const matchedTask = findTaskByFormId(options.designerTasks, normalizedFormId)
    ?? findTaskByFormId(options.allTasks, normalizedFormId);
  return createRestoreResult(options.target, matchedTask ? 'matched' : 'missing', matchedTask);
}

export async function restoreEmbedWorkbenchContext(
  options: RestoreEmbedWorkbenchOptions,
): Promise<EmbedRestoreResult> {
  const panelIds = getEmbedLandingPanelIdsWithOptions(options.target, {
    passiveWorkflowMode: options.passiveWorkflowMode,
  });
  for (const panelId of panelIds) {
    options.openPanel(panelId);
  }

  const primaryPanelId = panelIds[0];
  if (primaryPanelId) {
    options.activatePanel(primaryPanelId);
  }

  await options.loadReviewTasks();

  const result = resolveEmbedRestoreResult({
    target: options.target,
    formId: options.formId,
    reviewerTasks: options.reviewerTasks(),
    designerTasks: options.designerTasks(),
    allTasks: options.allTasks(),
  });

  if (options.target === 'reviewer') {
    await options.setCurrentTask(result.restoredTask);
  } else {
    // 设计端：如果匹配到了已有任务，也绑定 currentTask，以触发确认记录加载与批注回放
    await options.setCurrentTask(result.restoredTask ?? null);
  }

  return result;
}
