import { resolvePassiveWorkflowMode } from './workflowMode';

import type { ReviewAttachment, ReviewComponent, ReviewTask, WorkflowNode } from '@/types/auth';

export type EmbedModeParams = {
  formId: string | null;
  userToken: string | null;
  userId: string | null;
  userRole: string | null;
  projectId: string | null;
  workflowMode?: string | null;
  externalWorkflowMode?: boolean | null;
  isEmbedMode: boolean;
  verifiedClaims?: {
    projectId: string;
    userId: string;
    formId: string;
    role?: string;
    exp: number;
    iat: number;
  } | null;
};

export type EmbedLandingTarget = 'designer' | 'reviewer';
export type EmbedRestoreStatus = 'matched' | 'missing' | 'no_form';
export type EmbedLandingTaskSummary = {
  title: string;
  status: ReviewTask['status'];
  currentNode: WorkflowNode;
};
export type EmbedLandingState = {
  target: EmbedLandingTarget;
  formId: string | null;
  primaryPanelId: string;
  visiblePanelIds: string[];
  restoreStatus?: EmbedRestoreStatus;
  restoredTaskId?: string | null;
  restoredTaskSummary?: EmbedLandingTaskSummary | null;
  restoredTaskDraft?: EmbedLandingTaskDraft | null;
};

export const EMBED_LANDING_STATE_STORAGE_KEY = 'embed_landing_state';
export const EMBED_MODE_PARAMS_STORAGE_KEY = 'embed_mode_params';
export const EMBED_LANDING_STATE_UPDATED_EVENT = 'plant3d:embed-landing-state-updated';

export type EmbedLandingTaskDraft = {
  title: string;
  description: string;
  checkerId: string;
  approverId: string;
  priority: ReviewTask['priority'];
  dueDate: string;
  components: ReviewComponent[];
  attachments: ReviewAttachment[];
  taskId: string | null;
  formId: string | null;
};

function normalizeEmbedRole(role?: string | null): string | null {
  const normalized = role?.trim().toLowerCase();
  return normalized || null;
}

export function resolveEmbedLandingTargetFromRole(role?: string | null): EmbedLandingTarget | null {
  const normalizedRole = normalizeEmbedRole(role);
  if (!normalizedRole) return null;

  if (normalizedRole === 'sj' || normalizedRole === 'designer') {
    return 'designer';
  }

  if (
    normalizedRole === 'jd' ||
    normalizedRole === 'jh' ||
    normalizedRole === 'sh' ||
    normalizedRole === 'pz' ||
    normalizedRole === 'proofreader' ||
    normalizedRole === 'reviewer' ||
    normalizedRole === 'manager' ||
    normalizedRole === 'admin'
  ) {
    return 'reviewer';
  }

  return null;
}

export function resolveEmbedLandingTarget(params: {
  isEmbedMode: boolean;
  isDesigner: boolean;
  isReviewer: boolean;
}): EmbedLandingTarget | null {
  if (!params.isEmbedMode) return null;
  if (params.isDesigner) return 'designer';
  if (params.isReviewer) return 'reviewer';
  return null;
}

export function getEmbedLandingPanelIds(target: EmbedLandingTarget): string[] {
  return getEmbedLandingPanelIdsWithOptions(target, {});
}

export function getEmbedLandingPanelIdsWithOptions(
  target: EmbedLandingTarget,
  options: { passiveWorkflowMode?: boolean } = {},
): string[] {
  return target === 'designer'
    ? (options.passiveWorkflowMode ? ['initiateReview'] : ['initiateReview', 'myTasks'])
    : ['review', 'reviewerTasks'];
}

export function applyEmbedLandingState<TPanel extends { api: { setActive: () => void } }>(options: {
  ensurePanel: (panelId: string) => TPanel | undefined;
  activatePanel: (panelId: string) => void;
  sessionStorageLike?: Pick<Storage, 'setItem' | 'removeItem'>;
  embedModeParams: EmbedModeParams;
  target: EmbedLandingTarget;
  switchProjectById?: (projectId: string) => boolean;
  passiveWorkflowMode?: boolean;
}) {
  // 如果有 projectId，优先准备项目上下文，但不改变 reviewer/designer 工作台落点
  if (options.embedModeParams.projectId && options.switchProjectById) {
    options.switchProjectById(options.embedModeParams.projectId);
  }

  const passiveWorkflowMode = options.passiveWorkflowMode
    ?? resolvePassiveWorkflowMode({ embedParams: options.embedModeParams });
  const panelIds = getEmbedLandingPanelIdsWithOptions(options.target, {
    passiveWorkflowMode,
  });
  const primaryPanelId = panelIds[0];
  if (!primaryPanelId) return null;

  const panel = options.ensurePanel(primaryPanelId);
  if (panel) {
    panel.api.setActive();
  } else {
    options.activatePanel(primaryPanelId);
  }

  const storage = options.sessionStorageLike;
  if (storage) {
    storage.setItem(EMBED_MODE_PARAMS_STORAGE_KEY, JSON.stringify(options.embedModeParams));
    storage.setItem(
      EMBED_LANDING_STATE_STORAGE_KEY,
      JSON.stringify(({
        target: options.target,
        formId: options.embedModeParams.formId,
        primaryPanelId,
        visiblePanelIds: panelIds,
      } as EmbedLandingState))
    );
  }

  return {
    target: options.target,
    primaryPanelId,
    visiblePanelIds: panelIds,
  };
}
