import {
  getEmbedLandingPanelIds,
  type EmbedLandingState,
  type EmbedLandingTarget,
  type EmbedLandingTaskSummary,
  type EmbedRestoreStatus,
} from './embedRoleLanding';

import type { ReviewTask, WorkflowNode } from '@/types/auth';

type EmbedRestoreResult = Pick<
  EmbedLandingState,
  'target' | 'restoreStatus' | 'restoredTaskId' | 'restoredTaskSummary'
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

  const matchedTask = findTaskByFormId(options.designerTasks, normalizedFormId);
  return createRestoreResult(
    options.target,
    matchedTask ? 'matched' : 'missing',
    matchedTask,
    buildTaskSummary(matchedTask),
  );
}

export async function restoreEmbedWorkbenchContext(
  options: RestoreEmbedWorkbenchOptions,
): Promise<EmbedRestoreResult> {
  await options.loadReviewTasks();

  const result = resolveEmbedRestoreResult({
    target: options.target,
    formId: options.formId,
    reviewerTasks: options.reviewerTasks(),
    designerTasks: options.designerTasks(),
    allTasks: options.allTasks(),
  });

  const panelIds = getEmbedLandingPanelIds(options.target);
  for (const panelId of panelIds) {
    options.openPanel(panelId);
  }

  const primaryPanelId = panelIds[0];
  if (primaryPanelId) {
    options.activatePanel(primaryPanelId);
  }

  if (options.target === 'reviewer') {
    await options.setCurrentTask(result.restoredTask);
  } else {
    await options.setCurrentTask(null);
  }

  return result;
}
