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
    userName?: string;
    formId?: string;
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
  matchedSource?: string | null;
  missReason?: string | null;
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
  draftComponents: ReviewComponent[];
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

function normalizeVerifiedClaims(
  raw?: Partial<NonNullable<EmbedModeParams['verifiedClaims']>> | null,
): EmbedModeParams['verifiedClaims'] {
  if (!raw) return null;
  const projectId = normalizeEmbedValue(raw.projectId);
  const userId = normalizeEmbedValue(raw.userId);
  if (!projectId || !userId) return null;

  return {
    projectId,
    userId,
    userName: normalizeEmbedValue(raw.userName ?? null) || undefined,
    formId: normalizeEmbedValue(raw.formId ?? null) || undefined,
    role: normalizeEmbedRole(raw.role ?? null) || undefined,
    workflowMode: normalizeEmbedValue(raw.workflowMode ?? null) || undefined,
    exp: typeof raw.exp === 'number' ? raw.exp : 0,
    iat: typeof raw.iat === 'number' ? raw.iat : 0,
  };
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
    formId: launchFormId,
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

  const { userId, projectId, role } = params.verifiedClaims;
  const formId = getVerifiedEmbedFormId(params);
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
    formId: getVerifiedEmbedFormId(params),
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
    normalizedRole === 'jh' ||
    normalizedRole === 'sh' ||
    normalizedRole === 'pz' ||
    normalizedRole === 'admin'
  ) {
    return 'reviewer';
  }

  return null;
}

export function resolvePassiveEmbedViewTarget(options: {
  workflowRole?: string | null;
  passiveWorkflowMode?: boolean;
  formId?: string | null;
  restoredTaskSummary?: EmbedLandingTaskSummary | null;
}): EmbedLandingTarget | null {
  if (!options.passiveWorkflowMode) return null;
  if (normalizeEmbedRole(options.workflowRole) !== 'sj') return null;
  if (normalizeEmbedValue(options.formId ?? null)) return null;

  const currentNode = normalizeEmbedRole(options.restoredTaskSummary?.currentNode ?? null);
  if (!currentNode || currentNode === 'sj') return null;

  return 'reviewer';
}

/**
 * SJ 经 PMS 外部流程打开带 form_id 的单据时，所有批注处理统一在审核侧
 * ReviewPanel 内完成，不再出现「批注处理（DCH）」面板。
 * 详见 .plannotator/plan-sj-reject-ui.md §2 / §5 与
 * 开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md §13。
 *
 * 判定三件套：isPassiveWorkflowMode && workflowRole === 'sj' && 有 verifiedFormId。
 * 注意这只覆盖 SJ 一类的「权限/可见性收敛」（比如禁止新增证据 / 隐藏内部入口）；
 * 任意 reviewer 角色经外部流程聚焦到某个 form_id 的「跨单据批注不可见」规则
 * 使用更广义的 `isExternalFormFocusedMode`，见下方。
 */
export function isExternalSjFormFocusedMode(params: EmbedModeParams | null): boolean {
  if (!params) return false;
  if (!resolvePassiveWorkflowMode({ embedParams: params })) return false;
  const role = normalizeEmbedRole(params.verifiedClaims?.role)
    ?? normalizeEmbedRole(params.workflowRole);
  if (role !== 'sj') return false;
  return !!getVerifiedEmbedFormId(params);
}

/**
 * 「外部流程 + 已聚焦到某个 form_id」的广义判定：任意 reviewer 角色
 *（sj / jd / sh / pz）经 PMS / 嵌入入口打开带 form_id 的单据时返回 true。
 *
 * 产品规约：**不能跨 form_id 批注，看到的就是对应单据的数据**。任何
 * 显示批注的视图（卡片列表、批注表格）以及任何隐式打开旁路面板的入口
 * （ribbon `panel.designerCommentHandling` / `panel.resubmissionTasks` /
 * `panel.annotationTable` 等）在这个模式下都应当强制收敛到 review 面板，
 * 且只展示当前 form_id 的批注。
 *
 * 与 `isExternalSjFormFocusedMode` 的区别：本函数不限制 workflowRole，
 * 适用于「显示/收敛」语义；前者仅适用于「SJ 权限边界」语义（如禁止 SJ
 * 在外部模式下创建新证据 / 不发送内部 review action）。
 */
export function isExternalFormFocusedMode(params: EmbedModeParams | null): boolean {
  if (!params) return false;
  if (!resolvePassiveWorkflowMode({ embedParams: params })) return false;
  return !!getVerifiedEmbedFormId(params);
}

export function resolveExternalFormFocusedLandingTarget(options: {
  target: EmbedLandingTarget | null;
  workflowRole?: string | null;
  passiveWorkflowMode?: boolean;
  formId?: string | null;
}): EmbedLandingTarget | null {
  if (!options.target) return null;
  if (!options.passiveWorkflowMode) return options.target;
  if (options.target !== 'designer') return options.target;
  if (normalizeEmbedRole(options.workflowRole) !== 'sj') return options.target;
  if (!normalizeEmbedValue(options.formId ?? null)) return options.target;
  return 'reviewer';
}

export function getVerifiedEmbedProjectId(params: EmbedModeParams): string | null {
  return params.verifiedClaims?.projectId || params.projectId || null;
}

export function getVerifiedEmbedFormId(params: EmbedModeParams): string | null {
  return normalizeEmbedValue(params.verifiedClaims?.formId) || params.formId || null;
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
  options: { passiveWorkflowMode?: boolean; formId?: string | null; workflowRole?: string | null } = {},
): string[] {
  const effectiveTarget = resolveExternalFormFocusedLandingTarget({
    target,
    workflowRole: options.workflowRole,
    passiveWorkflowMode: options.passiveWorkflowMode,
    formId: options.formId,
  });
  if (effectiveTarget === 'designer') {
    return ['initiateReview'];
  }

  return ['review'];
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
  const formId = getVerifiedEmbedFormId(options.embedModeParams);
  const workflowRole = normalizeEmbedRole(options.embedModeParams.verifiedClaims?.role)
    || normalizeEmbedRole(options.embedModeParams.workflowRole);
  const effectiveTarget = resolveExternalFormFocusedLandingTarget({
    target: options.target,
    workflowRole,
    passiveWorkflowMode,
    formId,
  }) ?? options.target;
  const panelIds = getEmbedLandingPanelIdsWithOptions(effectiveTarget, {
    passiveWorkflowMode,
    formId,
    workflowRole,
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
        target: effectiveTarget,
        formId,
        primaryPanelId,
        visiblePanelIds: panelIds,
      } as EmbedLandingState))
    );
  }

  return {
    target: effectiveTarget,
    primaryPanelId,
    visiblePanelIds: panelIds,
  };
}

export function readPersistedEmbedModeParams(
  storageLike: Pick<Storage, 'getItem'> | undefined = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined,
): EmbedModeParams | null {
  if (!storageLike) return null;
  const raw = storageLike.getItem(EMBED_MODE_PARAMS_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<EmbedModeParams> & {
      verifiedClaims?: Partial<NonNullable<EmbedModeParams['verifiedClaims']>> | null;
      launchInput?: Partial<NonNullable<EmbedModeParams['launchInput']>> | null;
    };

    return buildPersistedEmbedModeParams({
      formId: normalizeEmbedValue(parsed.formId) || null,
      userToken: normalizeEmbedValue(parsed.userToken) || null,
      userId: normalizeEmbedValue(parsed.userId) || null,
      workflowRole: normalizeEmbedRole(parsed.workflowRole) || null,
      projectId: normalizeEmbedValue(parsed.projectId) || null,
      workflowMode: normalizeEmbedValue(parsed.workflowMode) || null,
      externalWorkflowMode: typeof parsed.externalWorkflowMode === 'boolean'
        ? parsed.externalWorkflowMode
        : null,
      isEmbedMode: !!(normalizeEmbedValue(parsed.formId) || normalizeEmbedValue(parsed.userToken)),
      launchInput: parsed.launchInput ? {
        formId: normalizeEmbedValue(parsed.launchInput.formId) || null,
        userId: normalizeEmbedValue(parsed.launchInput.userId) || null,
        workflowRole: normalizeEmbedRole(parsed.launchInput.workflowRole) || null,
        projectId: normalizeEmbedValue(parsed.launchInput.projectId) || null,
        workflowMode: normalizeEmbedValue(parsed.launchInput.workflowMode) || null,
      } : undefined,
      verifiedClaims: normalizeVerifiedClaims(parsed.verifiedClaims),
    });
  } catch {
    return null;
  }
}
