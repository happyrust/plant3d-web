export type SimulatorPmsUser = 'SJ' | 'JH' | 'SH' | 'PZ';
export type WorkflowRole = 'sj' | 'jd' | 'sh' | 'pz';
export type SidePanelMode = 'initiate' | 'workflow' | 'readonly';
export type IframeSource = 'new' | 'task-view' | 'task-reopen' | 'last-form-reopen' | 'iframe-refresh-reopen';
export type WorkflowMutationAction = 'active' | 'agree' | 'return' | 'stop';

export type SimulatorActorIdentity = {
  userId: string;
  userName: string;
};

export type WorkflowRoleResolutionSource =
  | 'workflow-next-step'
  | 'explicit'
  | 'workflow-current-node'
  | 'task-node'
  | 'new-entry'
  | 'user-default';

export type WorkflowRoleResolution = {
  workflowRole: WorkflowRole;
  source: WorkflowRoleResolutionSource;
};

export type WorkflowAssignmentResolution = {
  defaultAssignedPmsUser: SimulatorPmsUser;
  matchesCurrentPmsUser: boolean;
};

export type TaskAssignmentResolution = {
  assignedUserId: string | null;
  source: 'requester' | 'checker' | 'reviewer' | 'approver' | 'none';
  matchesCurrentPmsUser: boolean;
};

export type WorkflowAccessDecisionSource =
  | 'new-entry'
  | 'task-terminal'
  | 'task-assignee'
  | 'default-assignee';

export type WorkflowAccessResolution = {
  canView: boolean;
  canMutateWorkflow: boolean;
  decisionSource: WorkflowAccessDecisionSource;
  reason: string;
};

export type WorkflowSyncNextStepPayload = {
  assigneeId: string;
  name?: string | null;
  roles: WorkflowRole;
};

type DeriveSimulatorSidePanelModeOptions = {
  passiveWorkflowMode: boolean;
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
  canMutateWorkflow: boolean;
  hasIframe: boolean;
  iframeSource: IframeSource | null;
  taskId: string | null;
  formId: string | null;
};

type SyncOnlyWorkflowActionOptions = {
  passiveWorkflowMode: boolean;
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
  sidePanelMode: SidePanelMode;
  action: WorkflowMutationAction;
};

type ResolveSimulatorWorkflowRoleOptions = {
  currentPmsUser: SimulatorPmsUser;
  explicitRole?: string | null;
  taskCurrentNode?: string | null;
  iframeSource?: IframeSource | null;
};

type BuildSimulatorAuthLoginRequestOptions = {
  projectId: string;
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
};

type BuildSimulatorEmbedUrlPayloadOptions = {
  projectId: string;
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
  preferredFormId?: string | null;
};

type BuildSimulatorWorkflowSyncPayloadOptions = {
  formId: string;
  token: string;
  action: WorkflowMutationAction | 'query';
  comments: string;
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
  nextStep?: WorkflowSyncNextStepPayload | null;
};

type BuildSimulatorRuntimeWorkflowRoleOptions = {
  currentPmsUser: SimulatorPmsUser;
  workflowNextStep?: string | null;
  workflowCurrentNode?: string | null;
  taskCurrentNode?: string | null;
  launchPlanRole?: string | null;
  iframeWorkflowRole?: WorkflowRole | string | null;
  iframeSource?: IframeSource | null;
  hasIframe: boolean;
};

const DEFAULT_WORKFLOW_ROLE_BY_USER: Record<SimulatorPmsUser, WorkflowRole> = {
  SJ: 'sj',
  JH: 'jd',
  SH: 'sh',
  PZ: 'pz',
};

const DEFAULT_PMS_USER_BY_WORKFLOW_ROLE: Record<WorkflowRole, SimulatorPmsUser> = {
  sj: 'SJ',
  jd: 'JH',
  sh: 'SH',
  pz: 'PZ',
};

function normalizeWorkflowRole(value?: string | null): WorkflowRole | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;

  if (normalized === 'sj' || normalized.includes('编制')) return 'sj';
  if (normalized === 'jd' || normalized.includes('校核') || normalized === 'jh') return 'jd';
  if (normalized === 'sh' || normalized.includes('审核')) return 'sh';
  if (normalized === 'pz' || normalized.includes('批准')) return 'pz';
  return null;
}

export function resolveSimulatorPmsUserIdentity(currentPmsUser: SimulatorPmsUser): SimulatorActorIdentity {
  return {
    userId: currentPmsUser,
    userName: currentPmsUser,
  };
}

export function resolveSimulatorWorkflowRole(options: ResolveSimulatorWorkflowRoleOptions): WorkflowRoleResolution {
  const explicitRole = normalizeWorkflowRole(options.explicitRole);
  if (explicitRole) {
    return {
      workflowRole: explicitRole,
      source: 'explicit',
    };
  }

  const taskRole = normalizeWorkflowRole(options.taskCurrentNode);
  if (taskRole) {
    return {
      workflowRole: taskRole,
      source: 'task-node',
    };
  }

  if (options.iframeSource === 'new') {
    return {
      workflowRole: 'sj',
      source: 'new-entry',
    };
  }

  return {
    workflowRole: DEFAULT_WORKFLOW_ROLE_BY_USER[options.currentPmsUser],
    source: 'user-default',
  };
}

export function deriveSimulatorSidePanelMode(options: DeriveSimulatorSidePanelModeOptions): SidePanelMode {
  if (!options.hasIframe) {
    return 'readonly';
  }

  if (options.iframeSource === 'new') {
    return 'initiate';
  }

  if (options.passiveWorkflowMode) {
    if (!options.canMutateWorkflow) {
      return 'readonly';
    }

    if (options.currentWorkflowRole === 'sj') {
      return 'initiate';
    }

    return options.formId ? 'workflow' : 'readonly';
  }

  if (!options.taskId) {
    return 'readonly';
  }

  if (!options.canMutateWorkflow) {
    return 'readonly';
  }

  if (options.currentWorkflowRole === 'sj') {
    return 'initiate';
  }

  return options.formId ? 'workflow' : 'readonly';
}

export function shouldUseSyncOnlyWorkflowAction(options: SyncOnlyWorkflowActionOptions): boolean {
  if (!options.passiveWorkflowMode) {
    return false;
  }

  if (options.sidePanelMode === 'readonly') {
    return false;
  }

  if (options.sidePanelMode === 'initiate') {
    return options.action === 'active' && options.currentWorkflowRole === 'sj';
  }

  return options.sidePanelMode === 'workflow';
}

export function buildSimulatorAuthLoginRequest(options: BuildSimulatorAuthLoginRequestOptions): {
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

export function buildSimulatorEmbedUrlPayload(options: BuildSimulatorEmbedUrlPayloadOptions): Record<string, unknown> {
  const actor = resolveSimulatorPmsUserIdentity(options.currentPmsUser);
  const payload: Record<string, unknown> = {
    project_id: options.projectId,
    user_id: actor.userId,
    role: options.currentWorkflowRole,
  };
  if (options.preferredFormId?.trim()) {
    payload.form_id = options.preferredFormId.trim();
  }
  return payload;
}

export function buildSimulatorWorkflowSyncPayload(options: BuildSimulatorWorkflowSyncPayloadOptions): {
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
  return payload;
}

export function resolveSimulatorWorkflowMutationTargetRole(options: {
  action: WorkflowMutationAction;
  currentWorkflowRole: WorkflowRole;
  targetNode?: string | null;
}): WorkflowRole | null {
  if (options.action === 'stop') {
    return null;
  }

  if (options.action === 'return') {
    return normalizeWorkflowRole(options.targetNode);
  }

  switch (options.currentWorkflowRole) {
    case 'sj':
      return 'jd';
    case 'jd':
      return 'sh';
    case 'sh':
      return 'pz';
    case 'pz':
      return null;
    default:
      return null;
  }
}

export function resolveSimulatorWorkflowAssignment(options: {
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
}): WorkflowAssignmentResolution {
  const defaultAssignedPmsUser = DEFAULT_PMS_USER_BY_WORKFLOW_ROLE[options.currentWorkflowRole];
  return {
    defaultAssignedPmsUser,
    matchesCurrentPmsUser: defaultAssignedPmsUser === options.currentPmsUser,
  };
}

export function resolveSimulatorTaskAssignment(options: {
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
  requesterId?: string | null;
  checkerId?: string | null;
  reviewerId?: string | null;
  approverId?: string | null;
}): TaskAssignmentResolution {
  const requesterId = String(options.requesterId || '').trim();
  const checkerId = String(options.checkerId || '').trim();
  const reviewerId = String(options.reviewerId || '').trim();
  const approverId = String(options.approverId || '').trim();

  if (options.currentWorkflowRole === 'sj') {
    return {
      assignedUserId: requesterId || null,
      source: requesterId ? 'requester' : 'none',
      matchesCurrentPmsUser: Boolean(requesterId) && requesterId === options.currentPmsUser,
    };
  }

  if (options.currentWorkflowRole === 'jd') {
    if (checkerId) {
      return {
        assignedUserId: checkerId,
        source: 'checker',
        matchesCurrentPmsUser: checkerId === options.currentPmsUser,
      };
    }
    return {
      assignedUserId: reviewerId || null,
      source: reviewerId ? 'reviewer' : 'none',
      matchesCurrentPmsUser: Boolean(reviewerId) && reviewerId === options.currentPmsUser,
    };
  }

  return {
    assignedUserId: approverId || null,
    source: approverId ? 'approver' : 'none',
    matchesCurrentPmsUser: Boolean(approverId) && approverId === options.currentPmsUser,
  };
}

export function resolveSimulatorWorkflowAccess(options: {
  iframeSource: IframeSource | null;
  taskStatus?: string | null;
  taskAssignedUserId: string | null;
  taskAssignmentSource: TaskAssignmentResolution['source'];
  matchesTaskAssignee: boolean;
  defaultAssignedPmsUser: SimulatorPmsUser;
  matchesDefaultAssignee: boolean;
}): WorkflowAccessResolution {
  if (options.iframeSource === 'new') {
    return {
      canView: true,
      canMutateWorkflow: true,
      decisionSource: 'new-entry',
      reason: '新增入口默认允许当前用户发起流程。',
    };
  }

  const taskStatus = String(options.taskStatus || '')
    .trim()
    .toLowerCase();
  if (taskStatus === 'cancelled' || taskStatus === 'approved') {
    return {
      canView: true,
      canMutateWorkflow: false,
      decisionSource: 'task-terminal',
      reason: taskStatus === 'cancelled' ? '当前单据已处于已取消终态，仅可查看。' : '当前单据已处于已完成终态，仅可查看。',
    };
  }

  if (options.taskAssignedUserId) {
    return {
      canView: true,
      canMutateWorkflow: options.matchesTaskAssignee,
      decisionSource: 'task-assignee',
      reason: options.matchesTaskAssignee
        ? `当前单据已明确指派给 ${options.taskAssignedUserId}（${options.taskAssignmentSource}），允许当前用户推进流程。`
        : `当前单据已明确指派给 ${options.taskAssignedUserId}（${options.taskAssignmentSource}），当前用户仅可查看。`,
    };
  }

  return {
    canView: true,
    canMutateWorkflow: options.matchesDefaultAssignee,
    decisionSource: 'default-assignee',
    reason: options.matchesDefaultAssignee
      ? '当前单据缺少真实任务指派，已回退到默认测试流转映射。'
      : `当前单据缺少真实任务指派，默认测试流转应由 ${options.defaultAssignedPmsUser} 处理，当前用户仅可查看。`,
  };
}

export function buildSimulatorRuntimeWorkflowRole(options: BuildSimulatorRuntimeWorkflowRoleOptions): WorkflowRoleResolution {
  const workflowNextStep = normalizeWorkflowRole(options.workflowNextStep);
  if (workflowNextStep) {
    return {
      workflowRole: workflowNextStep,
      source: 'workflow-next-step',
    };
  }

  const explicitRole = options.hasIframe
    ? normalizeWorkflowRole(options.launchPlanRole) || normalizeWorkflowRole(options.iframeWorkflowRole)
    : null;
  if (explicitRole) {
    return {
      workflowRole: explicitRole,
      source: 'explicit',
    };
  }

  const workflowCurrentNode = normalizeWorkflowRole(options.workflowCurrentNode);
  if (workflowCurrentNode) {
    return {
      workflowRole: workflowCurrentNode,
      source: 'workflow-current-node',
    };
  }

  const taskCurrentNode = normalizeWorkflowRole(options.taskCurrentNode);
  if (taskCurrentNode) {
    return {
      workflowRole: taskCurrentNode,
      source: 'task-node',
    };
  }

  return resolveSimulatorWorkflowRole({
    currentPmsUser: options.currentPmsUser,
    explicitRole,
    taskCurrentNode: null,
    iframeSource: options.iframeSource || null,
  });
}
