/**
 * 平台 API 契约 payload 构建模块
 *
 * 与 plant-model-gen/src/web_api/platform_api/types.rs 1:1 对齐。
 * 由 pmsReviewSimulatorWorkflow.ts（仿 PMS UI）和契约序列脚本共同 import，
 * 实现「一处定义，两处使用」，避免双份实现漂移。
 */

// ---------------------------------------------------------------------------
// 共享类型（与 types.rs 对齐）
// ---------------------------------------------------------------------------

export type SimulatorPmsUser = 'SJ' | 'JH' | 'SH' | 'PZ';
export type WorkflowRole = 'sj' | 'jd' | 'sh' | 'pz';
export type WorkflowMutationAction = 'active' | 'agree' | 'return' | 'stop';

export type SimulatorActorIdentity = {
  userId: string;
  userName: string;
};

export type WorkflowSyncNextStepPayload = {
  assigneeId: string;
  name?: string | null;
  roles: WorkflowRole;
};

// ---------------------------------------------------------------------------
// embed-url payload（对齐 EmbedUrlRequest）
// ---------------------------------------------------------------------------

export type BuildEmbedUrlPayloadOptions = {
  projectId: string;
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
  preferredFormId?: string | null;
  workflowMode?: string | null;
  token?: string | null;
  extraParameters?: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// workflow/sync payload（对齐 SyncWorkflowRequest）
// ---------------------------------------------------------------------------

export type BuildWorkflowSyncPayloadOptions = {
  formId: string;
  token: string;
  action: WorkflowMutationAction | 'query';
  comments: string;
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
  nextStep?: WorkflowSyncNextStepPayload | null;
  metadata?: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// cache/preload payload（对齐 CachePreloadRequest）
// ---------------------------------------------------------------------------

export type BuildCachePreloadPayloadOptions = {
  projectId: string;
  initiator: string;
  token: string;
};

// ---------------------------------------------------------------------------
// delete payload（对齐 DeleteReviewRequest）
// ---------------------------------------------------------------------------

export type BuildDeleteReviewPayloadOptions = {
  formIds: string[];
  operatorId: string;
  token: string;
};

// ---------------------------------------------------------------------------
// auth login payload
// ---------------------------------------------------------------------------

export type BuildAuthLoginRequestOptions = {
  projectId: string;
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
};

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

export function resolveSimulatorPmsUserIdentity(currentPmsUser: SimulatorPmsUser): SimulatorActorIdentity {
  return {
    userId: currentPmsUser,
    userName: currentPmsUser,
  };
}

// ---------------------------------------------------------------------------
// payload 构建函数
// ---------------------------------------------------------------------------

export function buildEmbedUrlPayload(options: BuildEmbedUrlPayloadOptions): Record<string, unknown> {
  const actor = resolveSimulatorPmsUserIdentity(options.currentPmsUser);
  const payload: Record<string, unknown> = {
    project_id: options.projectId,
    user_id: actor.userId,
    // workflow_role 是正式字段；旧 role 兼容由后端负责，前端不再双发。
    workflow_role: options.currentWorkflowRole,
  };
  if (options.preferredFormId?.trim()) {
    payload.form_id = options.preferredFormId.trim();
  }
  if (options.workflowMode?.trim()) {
    payload.workflow_mode = options.workflowMode.trim();
  }
  if (options.token?.trim()) {
    payload.token = options.token.trim();
  }
  if (options.extraParameters && Object.keys(options.extraParameters).length > 0) {
    payload.extra_parameters = options.extraParameters;
  }
  return payload;
}

export function buildWorkflowSyncPayload(options: BuildWorkflowSyncPayloadOptions): {
  form_id: string;
  token: string;
  action: WorkflowMutationAction | 'query';
  actor: {
    id: string;
    name: string;
    roles: WorkflowRole;
  };
  comments: string;
  next_step?: {
    assignee_id: string;
    name: string;
    roles: WorkflowRole;
  };
  metadata?: Record<string, unknown>;
} {
  const actor = resolveSimulatorPmsUserIdentity(options.currentPmsUser);
  const payload: {
    form_id: string;
    token: string;
    action: WorkflowMutationAction | 'query';
    actor: {
      id: string;
      name: string;
      roles: WorkflowRole;
    };
    comments: string;
    next_step?: {
      assignee_id: string;
      name: string;
      roles: WorkflowRole;
    };
    metadata?: Record<string, unknown>;
  } = {
    form_id: options.formId,
    token: options.token,
    action: options.action,
    actor: {
      id: actor.userId,
      name: actor.userName,
      roles: options.currentWorkflowRole,
    },
    comments: options.comments,
  };
  const nextStep = options.nextStep;
  if (options.action !== 'query' && nextStep?.assigneeId?.trim()) {
    payload.next_step = {
      assignee_id: nextStep.assigneeId.trim(),
      name: nextStep.name?.trim() || nextStep.assigneeId.trim(),
      roles: nextStep.roles,
    };
  }
  if (options.metadata && Object.keys(options.metadata).length > 0) {
    payload.metadata = options.metadata;
  }
  return payload;
}

export function buildAuthLoginRequest(options: BuildAuthLoginRequestOptions): {
  projectId: string;
  userId: string;
  role: WorkflowRole;
} {
  const actor = resolveSimulatorPmsUserIdentity(options.currentPmsUser);
  return {
    projectId: options.projectId,
    userId: actor.userId,
    role: options.currentWorkflowRole,
  };
}

export function buildCachePreloadPayload(options: BuildCachePreloadPayloadOptions): {
  project_id: string;
  initiator: string;
  token: string;
} {
  return {
    project_id: options.projectId,
    initiator: options.initiator,
    token: options.token,
  };
}

export function buildDeleteReviewPayload(options: BuildDeleteReviewPayloadOptions): {
  form_ids: string[];
  operator_id: string;
  token: string;
} {
  return {
    form_ids: options.formIds,
    operator_id: options.operatorId,
    token: options.token,
  };
}
