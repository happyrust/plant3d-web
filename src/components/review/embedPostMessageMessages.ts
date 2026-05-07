export type PmsWorkflowPreActionMessage = {
  type: 'pms.workflow_pre_action';
  formId: string;
  action: 'agree' | 'return' | 'redirect' | 'terminate';
  requestId?: string;
};

export type PmsWorkflowChangedMessage = {
  type: 'pms.workflow_changed';
  formId: string;
  action: 'agree' | 'return' | 'redirect' | 'terminate';
  targetNode?: string;
  comments?: string;
  pmsActor?: string;
  requestId?: string;
};

export type PmsInboundMessage = PmsWorkflowPreActionMessage | PmsWorkflowChangedMessage;

export type Plant3dWorkflowPreActionAckedMessage = {
  type: 'plant3d.workflow_pre_action_acked';
  ok: boolean;
  error?: string;
  requestId?: string;
};

export type Plant3dWorkflowSyncedMessage = {
  type: 'plant3d.workflow_synced';
  formId: string;
  action: string;
  ok: boolean;
  taskId?: string;
  status?: string;
  currentNode?: string;
  error?: string;
  requestId?: string;
};

export type Plant3dOutboundSyncMessage =
  | Plant3dWorkflowPreActionAckedMessage
  | Plant3dWorkflowSyncedMessage;

export function isPmsWorkflowPreAction(data: unknown): data is PmsWorkflowPreActionMessage {
  return !!data
    && typeof data === 'object'
    && (data as { type?: unknown }).type === 'pms.workflow_pre_action'
    && typeof (data as { formId?: unknown }).formId === 'string'
    && typeof (data as { action?: unknown }).action === 'string';
}

export function isPmsWorkflowChanged(data: unknown): data is PmsWorkflowChangedMessage {
  return !!data
    && typeof data === 'object'
    && (data as { type?: unknown }).type === 'pms.workflow_changed'
    && typeof (data as { formId?: unknown }).formId === 'string'
    && typeof (data as { action?: unknown }).action === 'string';
}
