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

type WorkflowBridgeAckMessage = {
  type: 'plant3d.workflow_action_ack';
  action: WorkflowSyncBridgeAction;
  success: boolean;
  error?: string;
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

function isAckMessage(data: unknown): data is WorkflowBridgeAckMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Partial<WorkflowBridgeAckMessage>;
  return msg.type === 'plant3d.workflow_action_ack' && typeof msg.action === 'string';
}

/**
 * Send a workflow action to the parent window and wait for an ack.
 * Returns 'bridged' if the parent acknowledged, 'timeout' if no ack
 * within the deadline, or 'unavailable' if the bridge is not available.
 */
export async function notifyParentWorkflowActionWithAck(
  payload: Omit<WorkflowSyncBridgeMessage, 'type'>,
  options: WorkflowBridgeOptions & { timeoutMs?: number } = {},
): Promise<'bridged' | 'timeout' | 'unavailable'> {
  const sent = notifyParentWorkflowAction(payload, options);
  if (!sent) return 'unavailable';

  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise<'bridged' | 'timeout'>((resolve) => {
    let settled = false;

    const onMessage = (event: MessageEvent) => {
      if (settled) return;
      if (!isAckMessage(event.data)) return;
      if (event.data.action !== payload.action) return;

      settled = true;
      window.removeEventListener('message', onMessage);
      resolve('bridged');
    };

    window.addEventListener('message', onMessage);

    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      console.warn(
        `[workflowBridge] No ack received for action=${payload.action} within ${timeoutMs}ms`,
      );
      resolve('timeout');
    }, timeoutMs);
  });
}
