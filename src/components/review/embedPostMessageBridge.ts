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
  /** 只受理这些 origin 发来的消息；空 / 不传 = 不按 origin 过滤（仍受 `trustedSource` 约束）。 */
  trustedOrigins?: string[];
  /**
   * 只受理 `event.source` 是这个窗口的消息（嵌入态就是 `window.parent`——挂着 iframe 的 PMS 页面）。
   * `pre_action` 会自动落库未保存的确认记录、`workflow_changed` 会直接调 `workflow/sync`，不能让同页任意
   * iframe / 弹窗都能触发（gen-model docs/plans/2026-09-28-review-workflow-defects-fix-plan.md D9 / T7，Q8=A）。
   * 传 `null` / 不传 = 不按 source 过滤（单测与非嵌入场景）。
   */
  trustedSource?: (() => Window | MessageEventSource | null | undefined) | null;
};

/**
 * 嵌入页可信来源的缺省解法：origin 取 `document.referrer`（PMS 页面把 iframe 挂进来时浏览器会带上，
 * 拿不到就不按 origin 过滤），source 只认 `window.parent`。
 */
export function resolveEmbedBridgeTrust(windowLike: Window = window): Pick<BridgeOptions, 'trustedOrigins' | 'trustedSource'> {
  let trustedOrigins: string[] | undefined;
  try {
    const referrer = windowLike.document?.referrer?.trim();
    if (referrer) {
      const origin = new URL(referrer).origin;
      if (origin && origin !== 'null') trustedOrigins = [origin];
    }
  } catch {
    trustedOrigins = undefined;
  }
  const isEmbedded = !!windowLike.parent && windowLike.parent !== windowLike;
  return {
    trustedOrigins,
    trustedSource: isEmbedded ? () => windowLike.parent : null,
  };
}

export function attachEmbedPostMessageBridge(options: BridgeOptions): () => void {
  const handler = async (event: MessageEvent) => {
    const source = event.source;
    if (!source || typeof (source as WindowProxy).postMessage !== 'function') return;

    if (options.trustedOrigins && options.trustedOrigins.length > 0
      && !options.trustedOrigins.includes(event.origin)) {
      return;
    }

    const trustedSource = options.trustedSource?.();
    if (options.trustedSource && trustedSource && source !== trustedSource) {
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
