import {
  getEmbedLandingPanelIdsWithOptions,
  type EmbedLandingTaskDraft,
  type EmbedLandingState,
  type EmbedLandingTarget,
  type EmbedLandingTaskSummary,
  type EmbedRestoreStatus,
} from './embedRoleLanding';
import { isCanonicalReturnedTask } from './reviewTaskFilters';

import type { ReviewTask, WorkflowNode } from '@/types/auth';

import { normalizeReviewDeliveryRefno } from '@/composables/useReviewDeliveryUnit';

const FORM_FOCUSED_TASK_LOAD_TIMEOUT_MS = 8_000;

export type EmbedRestoreMatchedSource = 'reviewer_tasks' | 'designer_tasks' | 'all_tasks' | 'form_loader' | null;
export type EmbedRestoreMissReason = 'no_form' | 'form_not_found' | 'not_returned' | null;

type EmbedRestoreResult = Pick<
  EmbedLandingState,
  'target' | 'restoreStatus' | 'restoredTaskId' | 'restoredTaskSummary' | 'restoredTaskDraft'
> & {
  restoredTask: ReviewTask | null;
  matchedSource: EmbedRestoreMatchedSource;
  missReason: EmbedRestoreMissReason;
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
  /**
   * 可选：当确定走「批注处理」流程时，由调用方负责关闭与之冲突的面板
   * （如「发起编校审」），保证设计端嵌入视角不会同时显示两类入口。
   */
  closePanel?: (panelId: string) => void;
  passiveWorkflowMode?: boolean;
  loadTaskByFormId?: (formId: string) => Promise<ReviewTask | null>;
  returnedDesignerTaskPanel?: 'designerCommentHandling' | 'review';
};

function normalizeFormId(formId?: string | null): string | null {
  const normalized = formId?.trim();
  return normalized || null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function findTaskByFormId(tasks: ReviewTask[], formId: string | null): ReviewTask | null {
  if (!formId) return null;
  return tasks.find((task) => normalizeFormId(task.formId) === formId) ?? null;
}

function findTaskByFormIdWithSource(
  candidates: { source: Exclude<EmbedRestoreMatchedSource, null>; tasks: ReviewTask[] }[],
  formId: string | null,
): { task: ReviewTask | null; source: EmbedRestoreMatchedSource } {
  if (!formId) return { task: null, source: null };
  for (const candidate of candidates) {
    const task = findTaskByFormId(candidate.tasks, formId);
    if (task) return { task, source: candidate.source };
  }
  return { task: null, source: null };
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
  const normalizedComponents = (task.components ?? []).map((component) => ({
    ...component,
    refNo: normalizeReviewDeliveryRefno(component.refNo),
  }));
  return {
    title: task.title || '',
    description: task.description || '',
    checkerId: task.checkerId || '',
    approverId: task.approverId || '',
    priority: task.priority || 'medium',
    dueDate: formatDueDateForDraft(task),
    components: [],
    draftComponents: normalizedComponents,
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
  meta: {
    matchedSource?: EmbedRestoreMatchedSource;
    missReason?: EmbedRestoreMissReason;
  } = {},
): EmbedRestoreResult {
  return {
    target,
    restoreStatus,
    restoredTask,
    restoredTaskId: restoredTask?.id ?? null,
    restoredTaskSummary,
    restoredTaskDraft: buildTaskDraft(restoredTask),
    matchedSource: meta.matchedSource ?? null,
    missReason: meta.missReason ?? (restoreStatus === 'no_form' ? 'no_form' : null),
  };
}

export function resolveEmbedRestoreResult(options: ResolveEmbedRestoreOptions): EmbedRestoreResult {
  const normalizedFormId = normalizeFormId(options.formId);
  if (!normalizedFormId) {
    return createRestoreResult(options.target, 'no_form', null, null, { missReason: 'no_form' });
  }

  if (options.target === 'reviewer') {
    const { task, source } = findTaskByFormIdWithSource([
      { source: 'reviewer_tasks', tasks: options.reviewerTasks },
      { source: 'all_tasks', tasks: options.allTasks },
    ], normalizedFormId);
    return createRestoreResult(
      options.target, task ? 'matched' : 'missing', task, null,
      { matchedSource: source, missReason: task ? null : 'form_not_found' },
    );
  }

  const { task, source } = findTaskByFormIdWithSource([
    { source: 'designer_tasks', tasks: options.designerTasks },
    { source: 'all_tasks', tasks: options.allTasks },
  ], normalizedFormId);
  return createRestoreResult(
    options.target, task ? 'matched' : 'missing', task, undefined,
    { matchedSource: source, missReason: task ? null : 'form_not_found' },
  );
}

export async function restoreEmbedWorkbenchContext(
  options: RestoreEmbedWorkbenchOptions,
): Promise<EmbedRestoreResult> {
  const normalizedFormId = normalizeFormId(options.formId);
  let formLoadedTask: ReviewTask | null = null;
  if (normalizedFormId && options.loadTaskByFormId) {
    formLoadedTask = await withTimeout(
      options.loadTaskByFormId(normalizedFormId),
      FORM_FOCUSED_TASK_LOAD_TIMEOUT_MS,
      () => null,
    );
  }

  // PMS embeds are form-focused. A broad role task list can be slow for users with
  // many pending items, so never block opening the current form on that list once
  // the URL already has a verified form id.
  if (normalizedFormId) {
    void options.loadReviewTasks();
  } else {
    await options.loadReviewTasks();
  }

  let result = resolveEmbedRestoreResult({
    target: options.target,
    formId: options.formId,
    reviewerTasks: options.reviewerTasks(),
    designerTasks: options.designerTasks(),
    allTasks: options.allTasks(),
  });

  if (result.restoreStatus === 'missing' && formLoadedTask) {
    result = createRestoreResult(options.target, 'matched', formLoadedTask, undefined, {
      matchedSource: 'form_loader',
      missReason: null,
    });
  }

  if (
    result.restoreStatus === 'missing'
    && normalizedFormId
    && options.loadTaskByFormId
  ) {
    const loadedTask = await options.loadTaskByFormId(normalizedFormId);
    if (loadedTask) {
      result = createRestoreResult(options.target, 'matched', loadedTask, undefined, {
        matchedSource: 'form_loader',
        missReason: null,
      });
    } else {
      result = {
        ...result,
        matchedSource: null,
        missReason: 'form_not_found',
      };
    }
  }

  const shouldOpenReturnedDesignerTaskPanel = options.target === 'designer'
    && !!result.restoredTask
    && isCanonicalReturnedTask(result.restoredTask);
  const panelIds = shouldOpenReturnedDesignerTaskPanel
    ? [options.returnedDesignerTaskPanel ?? 'designerCommentHandling']
    : getEmbedLandingPanelIdsWithOptions(options.target, {
      passiveWorkflowMode: options.passiveWorkflowMode,
    });
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
    await options.setCurrentTask(result.restoredTask ?? null);
  }

  return result;
}
