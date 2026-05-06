import { readPersistedEmbedModeParams } from './embedRoleLanding';
import { resolvePassiveWorkflowMode } from './workflowMode';

type WorkflowSyncBridgeAction = 'active' | 'agree' | 'return' | 'stop';

export type WorkflowSyncBridgeMessage = {
  type: 'plant3d.workflow_action';
  action: WorkflowSyncBridgeAction;
  taskId?: string;
  formId?: string;
  comments?: string;
  targetNode?: string;
  source?: string;
};

type WorkflowBridgeParent = {
  postMessage: (message: WorkflowSyncBridgeMessage, targetOrigin: string) => void;
};

type WorkflowBridgeWindow = {
  parent?: WorkflowBridgeParent | null;
};

type WorkflowBridgeOptions = {
  windowLike?: WorkflowBridgeWindow | null;
  passiveWorkflowMode?: boolean;
};

function getRuntimeWindow(): WorkflowBridgeWindow | null {
  return typeof window === 'undefined' ? null : window;
}

function isSameWindow(windowLike: WorkflowBridgeWindow, parent: WorkflowBridgeParent | null | undefined): boolean {
  return parent === windowLike;
}

export function isParentWorkflowBridgeAvailable(options: WorkflowBridgeOptions = {}): boolean {
  const windowLike = options.windowLike ?? getRuntimeWindow();
  if (!windowLike?.parent || isSameWindow(windowLike, windowLike.parent)) return false;

  const passiveWorkflowMode = options.passiveWorkflowMode
    ?? resolvePassiveWorkflowMode({ embedParams: readPersistedEmbedModeParams() });
  return passiveWorkflowMode;
}

export function notifyParentWorkflowAction(
  payload: Omit<WorkflowSyncBridgeMessage, 'type'>,
  options: WorkflowBridgeOptions = {},
): boolean {
  const windowLike = options.windowLike ?? getRuntimeWindow();
  if (!windowLike?.parent || !isParentWorkflowBridgeAvailable({ ...options, windowLike })) {
    return false;
  }

  windowLike.parent.postMessage({
    type: 'plant3d.workflow_action',
    ...payload,
  }, '*');
  return true;
}
