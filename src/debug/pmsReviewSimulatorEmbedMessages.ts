import type { WorkflowMutationAction } from './pmsReviewSimulatorWorkflow';

export type EmbeddedWorkflowActionMessage = {
  type: 'plant3d.workflow_action';
  action: WorkflowMutationAction;
  formId?: string;
  taskId?: string;
  comments?: string;
  targetNode?: string;
  source?: string;
};

export type EmbeddedFormSavedMessage = {
  type: 'plant3d.form_saved';
  source?: string;
  formId: string | null;
  taskId: string;
  componentCount?: number;
  packageName?: string;
};

const WORKFLOW_MUTATION_ACTIONS: WorkflowMutationAction[] = ['active', 'agree', 'return', 'stop'];

function isWorkflowMutationAction(value: unknown): value is WorkflowMutationAction {
  return typeof value === 'string' && WORKFLOW_MUTATION_ACTIONS.includes(value as WorkflowMutationAction);
}

export function parseEmbeddedWorkflowActionMessage(data: unknown): EmbeddedWorkflowActionMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Partial<EmbeddedWorkflowActionMessage>;
  if (message.type !== 'plant3d.workflow_action') return null;
  if (!isWorkflowMutationAction(message.action)) return null;
  return {
    type: 'plant3d.workflow_action',
    action: message.action,
    formId: typeof message.formId === 'string' ? message.formId : undefined,
    taskId: typeof message.taskId === 'string' ? message.taskId : undefined,
    comments: typeof message.comments === 'string' ? message.comments : undefined,
    targetNode: typeof message.targetNode === 'string' ? message.targetNode : undefined,
    source: typeof message.source === 'string' ? message.source : undefined,
  };
}

export function parseEmbeddedFormSavedMessage(data: unknown): EmbeddedFormSavedMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Partial<EmbeddedFormSavedMessage>;
  if (message.type !== 'plant3d.form_saved') return null;
  const taskId = typeof message.taskId === 'string' ? message.taskId.trim() : '';
  if (!taskId) return null;
  const formId = typeof message.formId === 'string' && message.formId.trim().length > 0
    ? message.formId.trim()
    : null;
  return {
    type: 'plant3d.form_saved',
    source: typeof message.source === 'string' ? message.source : undefined,
    taskId,
    formId,
    componentCount: typeof message.componentCount === 'number' ? message.componentCount : undefined,
    packageName: typeof message.packageName === 'string' ? message.packageName : undefined,
  };
}
