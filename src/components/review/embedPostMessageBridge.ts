import {
  isPmsWorkflowChanged,
  isPmsWorkflowPreAction,
  type Plant3dWorkflowPreActionAckedMessage,
  type Plant3dWorkflowSyncedMessage,
  type PmsWorkflowChangedMessage,
  type PmsWorkflowPreActionMessage,
} from './embedPostMessageMessages';

type BridgeOptions = {
  onPmsWorkflowPreAction: (msg: PmsWorkflowPreActionMessage) => Promise<Omit<Plant3dWorkflowPreActionAckedMessage, 'type' | 'requestId'>>;
  onPmsWorkflowChanged: (msg: PmsWorkflowChangedMessage) => Promise<{
    ok: boolean;
    taskId?: string;
    status?: string;
    currentNode?: string;
    error?: string;
  }>;
  trustedOrigins?: string[];
};

export function attachEmbedPostMessageBridge(options: BridgeOptions): () => void {
  const handler = async (event: MessageEvent) => {
    const source = event.source;
    if (!source || typeof (source as WindowProxy).postMessage !== 'function') return;

    if (options.trustedOrigins && options.trustedOrigins.length > 0
      && !options.trustedOrigins.includes(event.origin)) {
      return;
    }

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (isPmsWorkflowPreAction(data)) {
      const result = await options.onPmsWorkflowPreAction(data);
      const ack: Plant3dWorkflowPreActionAckedMessage = {
        type: 'plant3d.workflow_pre_action_acked',
        ...result,
        requestId: data.requestId,
      };
      (source as WindowProxy).postMessage(ack, '*');
      return;
    }

    if (isPmsWorkflowChanged(data)) {
      const result = await options.onPmsWorkflowChanged(data);
      const synced: Plant3dWorkflowSyncedMessage = {
        type: 'plant3d.workflow_synced',
        formId: data.formId,
        action: data.action,
        ok: result.ok,
        taskId: result.taskId,
        status: result.status,
        currentNode: result.currentNode,
        error: result.error,
        requestId: data.requestId,
      };
      (source as WindowProxy).postMessage(synced, '*');
      return;
    }
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
