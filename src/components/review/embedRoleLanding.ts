import { resolvePassiveWorkflowMode } from './workflowMode';

import type { ReviewAttachment, ReviewComponent, ReviewTask, WorkflowNode } from '@/types/auth';

export type EmbedModeParams = {
  formId: string | null;
  userToken: string | null;
  userId: string | null;
  workflowRole: string | null;
  projectId: string | null;
  workflowMode?: string | null;
  externalWorkflowMode?: boolean | null;
  isEmbedMode: boolean;
  launchInput?: {
    formId: string | null;
    userId: string | null;
    workflowRole: string | null;
    projectId: string | null;
    workflowMode: string | null;
  };
  verifiedClaims?: {
    projectId: string;
    userId: string;
    formId: string;
    userName?: string;
    role?: string;
    workflowMode?: string;
    exp: number;
    iat: number;
  } | null;
};

export type TrustedEmbedIdentity = {
  userId: string;
  workflowRole: string | null;
  formId: string;
  projectId: string;
  workflowMode: string | null;
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

function normalizeEmbedValue(value?: string | null): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function readEmbedModeParamsFromSearch(search: string): EmbedModeParams {
  const urlParams = new URLSearchParams(search);
  const launchFormId = normalizeEmbedValue(urlParams.get('form_id'));
  const userToken = normalizeEmbedValue(urlParams.get('user_token'));
  const launchUserId = normalizeEmbedValue(urlParams.get('user_id'));
  const launchWorkflowRole = normalizeEmbedRole(urlParams.get('workflow_role'))
    || normalizeEmbedRole(urlParams.get('role'))
    || normalizeEmbedRole(urlParams.get('user_role'));
  const launchProjectId = normalizeEmbedValue(urlParams.get('project_id'));
  const workflowMode = normalizeEmbedValue(urlParams.get('workflow_mode'));
  const tokenPrimary = !!userToken;

  return {
    formId: tokenPrimary ? null : launchFormId,
    userToken,
    userId: tokenPrimary ? null : launchUserId,
    workflowRole: tokenPrimary ? null : launchWorkflowRole,
    projectId: tokenPrimary ? null : launchProjectId,
    workflowMode,
    isEmbedMode: !!(launchFormId || userToken),
    launchInput: {
      formId: launchFormId,
      userId: launchUserId,
      workflowRole: launchWorkflowRole,
      projectId: launchProjectId,
      workflowMode,
    },
    verifiedClaims: null,
  };
}

export function resolveTrustedEmbedIdentity(params: EmbedModeParams): TrustedEmbedIdentity | null {
  if (!params.isEmbedMode || !params.verifiedClaims) return null;

  const { userId, formId, projectId, role } = params.verifiedClaims;
  if (!userId || !formId || !projectId) return null;
  const trustedRole = normalizeEmbedRole(role);
  if (!trustedRole) return null;

  return {
    userId,
    workflowRole: trustedRole,
    formId,
    projectId,
    workflowMode: normalizeEmbedValue(params.verifiedClaims.workflowMode) || null,
  };
}

export function buildPersistedEmbedModeParams(params: EmbedModeParams): EmbedModeParams {
  if (!params.userToken) return params;

  return {
    ...params,
    formId: params.verifiedClaims?.formId || params.formId || null,
    userId: params.verifiedClaims?.userId || params.userId || null,
    workflowRole: normalizeEmbedRole(params.verifiedClaims?.role) || null,
    projectId: params.verifiedClaims?.projectId || params.projectId || null,
    workflowMode: normalizeEmbedValue(params.verifiedClaims?.workflowMode) || params.workflowMode || null,
    launchInput: params.launchInput
      ? {
        formId: params.launchInput.formId,
        userId: null,
        workflowRole: null,
        projectId: null,
        workflowMode: params.launchInput.workflowMode,
      }
      : undefined,
  };
}

export function resolveEmbedLandingTargetFromRole(role?: string | null): EmbedLandingTarget | null {
  const normalizedRole = normalizeEmbedRole(role);
  if (!normalizedRole) return null;

  if (normalizedRole === 'sj') {
    return 'designer';
  }

  if (
    normalizedRole === 'jd' ||
    normalizedRole === 'sh' ||
    normalizedRole === 'pz' ||
    normalizedRole === 'admin'
  ) {
    return 'reviewer';
  }

  return null;
}

export function getVerifiedEmbedProjectId(params: EmbedModeParams): string | null {
  return params.verifiedClaims?.projectId || params.projectId || null;
}

export function getVerifiedEmbedFormId(params: EmbedModeParams): string | null {
  return params.verifiedClaims?.formId || params.formId || null;
}

export function getVerifiedEmbedWorkflowMode(params: EmbedModeParams): string | null {
  return normalizeEmbedValue(params.verifiedClaims?.workflowMode) || params.workflowMode || null;
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
  void options;
  return target === 'designer'
    ? ['initiateReview']
    : ['review'];
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
  const projectId = getVerifiedEmbedProjectId(options.embedModeParams);
  if (projectId && options.switchProjectById) {
    options.switchProjectById(projectId);
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
    storage.setItem(
      EMBED_MODE_PARAMS_STORAGE_KEY,
      JSON.stringify(buildPersistedEmbedModeParams(options.embedModeParams))
    );
    storage.setItem(
      EMBED_LANDING_STATE_STORAGE_KEY,
      JSON.stringify(({
        target: options.target,
        formId: getVerifiedEmbedFormId(options.embedModeParams),
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
