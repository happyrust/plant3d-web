import type { ReviewTask } from '@/types/auth';

export type SimulatorRole = 'SJ' | 'JH' | 'SH' | 'PZ';
export type SidePanelMode = 'initiate' | 'workflow' | 'readonly';
export type IframeSource = 'new' | 'task-view' | 'task-reopen' | 'last-form-reopen' | 'iframe-refresh-reopen';
export type WorkflowMutationAction = 'active' | 'agree' | 'return' | 'stop';

export type SimulatorTaskIdentity = Pick<
  ReviewTask,
  | 'requesterId'
  | 'requesterName'
  | 'checkerId'
  | 'checkerName'
  | 'approverId'
  | 'approverName'
  | 'reviewerId'
  | 'reviewerName'
>;

export type SimulatorActorIdentity = {
  userId: string;
  userName: string;
};

type DeriveSimulatorSidePanelModeOptions = {
  passiveWorkflowMode: boolean;
  currentRole: SimulatorRole;
  hasIframe: boolean;
  iframeSource: IframeSource | null;
  taskId: string | null;
  formId: string | null;
  currentNode: string | null;
};

type SyncOnlyWorkflowActionOptions = {
  passiveWorkflowMode: boolean;
  currentRole: SimulatorRole;
  sidePanelMode: SidePanelMode;
  action: WorkflowMutationAction;
};

function normalizeIdentityValue(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function pickActorIdentity(options: {
  primaryId?: string | null;
  primaryName?: string | null;
  fallbackId?: string | null;
  fallbackName?: string | null;
  defaultId: string;
}): SimulatorActorIdentity {
  const userId = normalizeIdentityValue(options.primaryId)
    || normalizeIdentityValue(options.fallbackId)
    || options.defaultId;
  const userName = normalizeIdentityValue(options.primaryName)
    || normalizeIdentityValue(options.fallbackName)
    || userId;
  return {
    userId,
    userName,
  };
}

export function resolveSimulatorActorIdentity(options: {
  currentRole: SimulatorRole;
  task?: SimulatorTaskIdentity | null;
}): SimulatorActorIdentity {
  const task = options.task || null;

  switch (options.currentRole) {
    case 'SJ':
      return pickActorIdentity({
        primaryId: task?.requesterId,
        primaryName: task?.requesterName,
        defaultId: 'SJ',
      });
    case 'JH':
      return pickActorIdentity({
        primaryId: task?.checkerId,
        primaryName: task?.checkerName,
        fallbackId: task?.reviewerId,
        fallbackName: task?.reviewerName,
        defaultId: 'JH',
      });
    case 'SH':
      return pickActorIdentity({
        primaryId: task?.approverId,
        primaryName: task?.approverName,
        defaultId: 'SH',
      });
    case 'PZ':
      return pickActorIdentity({
        primaryId: task?.approverId,
        primaryName: task?.approverName,
        defaultId: 'PZ',
      });
    default:
      return {
        userId: options.currentRole,
        userName: options.currentRole,
      };
  }
}

function shouldKeepDesignerInitiateInPassiveMode(options: DeriveSimulatorSidePanelModeOptions): boolean {
  if (!options.hasIframe || options.currentRole !== 'SJ') return false;
  if (options.iframeSource === 'new') return true;
  if (options.currentNode === 'sj') return true;
  if (!options.formId) return true;
  return false;
}

export function deriveSimulatorSidePanelMode(options: DeriveSimulatorSidePanelModeOptions): SidePanelMode {
  if (!options.hasIframe) {
    return 'readonly';
  }

  if (options.passiveWorkflowMode) {
    return shouldKeepDesignerInitiateInPassiveMode(options) ? 'initiate' : 'readonly';
  }

  if (options.iframeSource === 'new') {
    return 'initiate';
  }

  if (options.currentRole === 'SJ' && options.currentNode === 'sj') {
    return 'initiate';
  }

  if (!options.taskId) {
    return 'readonly';
  }

  if (options.currentRole === 'SJ' && !options.formId) {
    return 'initiate';
  }

  if (options.formId) {
    return 'workflow';
  }

  return 'readonly';
}

export function shouldUseSyncOnlyWorkflowAction(options: SyncOnlyWorkflowActionOptions): boolean {
  return options.passiveWorkflowMode
    && options.currentRole === 'SJ'
    && options.sidePanelMode === 'initiate'
    && options.action === 'active';
}
