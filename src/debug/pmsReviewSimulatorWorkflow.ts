import {
  buildAuthLoginRequest as _buildAuthLoginRequest,
  buildEmbedUrlPayload as _buildEmbedUrlPayload,
  buildWorkflowSyncPayload as _buildWorkflowSyncPayload,
  resolveSimulatorPmsUserIdentity as _resolveSimulatorPmsUserIdentity,
  type BuildAuthLoginRequestOptions,
  type BuildEmbedUrlPayloadOptions,
  type BuildWorkflowSyncPayloadOptions,
  type SimulatorActorIdentity,
  type SimulatorPmsUser,
  type WorkflowMutationAction,
  type WorkflowRole,
  type WorkflowSyncNextStepPayload,
} from './pmsPlatformContractPayloads';

export type { SimulatorActorIdentity, SimulatorPmsUser, WorkflowMutationAction, WorkflowRole, WorkflowSyncNextStepPayload };
export type SidePanelMode = 'initiate' | 'workflow' | 'readonly';
export type IframeSource = 'new' | 'task-view' | 'task-reopen' | 'last-form-reopen' | 'iframe-refresh-reopen';

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
  | 'workflow-next-step'
  | 'task-current-node'
  | 'workflow-unresolved';

export type WorkflowAccessResolution = {
  canView: boolean;
  canMutateWorkflow: boolean;
  decisionSource: WorkflowAccessDecisionSource;
  reason: string;
};

const SIMULATOR_INBOX_TASK_STATUSES = new Set(['submitted', 'in_review', 'approved', 'rejected']);

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

type BuildSimulatorEmbedUrlPayloadOptions = BuildEmbedUrlPayloadOptions;
type BuildSimulatorWorkflowSyncPayloadOptions = BuildWorkflowSyncPayloadOptions;
type BuildSimulatorAuthLoginRequestOptions = BuildAuthLoginRequestOptions;

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
  if (normalized === 'jd' || normalized.includes('校对')) return 'jd';
  // jh：常见 HumanCode / 外链写法，收件为审核节点 sh（与 backendRoleMapping 一致）
  if (normalized === 'jh' || normalized === 'sh' || normalized.includes('审核')) return 'sh';
  if (normalized.includes('校核')) return 'jd';
  if (normalized === 'pz' || normalized.includes('批准')) return 'pz';
  return null;
}

export const resolveSimulatorPmsUserIdentity = _resolveSimulatorPmsUserIdentity;

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

export const buildSimulatorAuthLoginRequest = _buildAuthLoginRequest;

export const buildSimulatorEmbedUrlPayload = _buildEmbedUrlPayload;

export const buildSimulatorWorkflowSyncPayload = _buildWorkflowSyncPayload;

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
  currentPmsUserId: string;
  currentPmsWorkflowRole: WorkflowRole | null;
  workflowNextStepUserId: string | null;
  workflowNextStepRole: WorkflowRole | null;
  taskCurrentNode?: string | null;
  taskAssignedUserId?: string | null;
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

  const taskCurrentNode = normalizeWorkflowRole(options.taskCurrentNode);
  const taskAssignedUserId = options.taskAssignedUserId?.trim() || '';
  const currentPmsUserId = options.currentPmsUserId.trim();

  if (!options.workflowNextStepRole || !options.workflowNextStepUserId) {
    if (taskCurrentNode && taskAssignedUserId) {
      const matchesTaskCurrentNode =
        options.currentPmsWorkflowRole === taskCurrentNode
        && currentPmsUserId.length > 0
        && currentPmsUserId === taskAssignedUserId;

      return {
        canView: true,
        canMutateWorkflow: matchesTaskCurrentNode,
        decisionSource: 'task-current-node',
        reason: matchesTaskCurrentNode
          ? `workflow next_step 缺失，已回退到任务当前节点与指派（${taskAssignedUserId} / ${taskCurrentNode}），允许当前用户执行对应操作。`
          : `workflow next_step 缺失，当前仅能按任务当前节点与指派判断（${taskAssignedUserId} / ${taskCurrentNode}）；当前用户仅可查看。`,
      };
    }

    return {
      canView: true,
      canMutateWorkflow: false,
      decisionSource: 'workflow-unresolved',
      reason: '当前单据缺少 workflow next_step 指定的处理角色或处理人，仅可查看。',
    };
  }

  const matchesNextStep =
    options.currentPmsWorkflowRole === options.workflowNextStepRole
    && currentPmsUserId.length > 0
    && currentPmsUserId === options.workflowNextStepUserId;

  return {
    canView: true,
    canMutateWorkflow: matchesNextStep,
    decisionSource: 'workflow-next-step',
    reason: matchesNextStep
      ? `当前 PMS 入口角色和用户已命中 workflow next_step（${options.workflowNextStepUserId} / ${options.workflowNextStepRole}），允许当前用户执行对应操作。`
      : `当前 PMS 入口角色和用户未命中 workflow next_step（${options.workflowNextStepUserId} / ${options.workflowNextStepRole}），当前用户仅可查看。`,
  };
}

export function resolveSimulatorInboxTaskVisibility(options: {
  currentPmsUser: SimulatorPmsUser;
  taskStatus?: string | null;
  taskCurrentNode?: string | null;
  requesterId?: string | null;
  checkerId?: string | null;
  reviewerId?: string | null;
  approverId?: string | null;
}): boolean {
  const taskRole = normalizeWorkflowRole(options.taskCurrentNode);
  if (!taskRole) {
    return true;
  }

  const taskAssignment = resolveSimulatorTaskAssignment({
    currentPmsUser: options.currentPmsUser,
    currentWorkflowRole: taskRole,
    requesterId: options.requesterId,
    checkerId: options.checkerId,
    reviewerId: options.reviewerId,
    approverId: options.approverId,
  });

  if (taskRole === 'sj') {
    return taskAssignment.assignedUserId
      ? taskAssignment.matchesCurrentPmsUser
      : true;
  }

  const taskStatus = String(options.taskStatus || '')
    .trim()
    .toLowerCase();
  if (!SIMULATOR_INBOX_TASK_STATUSES.has(taskStatus)) {
    return false;
  }

  return taskAssignment.assignedUserId
    ? taskAssignment.matchesCurrentPmsUser
    : true;
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
