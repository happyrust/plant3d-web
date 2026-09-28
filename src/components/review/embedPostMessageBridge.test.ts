import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachEmbedPostMessageBridge } from './embedPostMessageBridge';

describe('attachEmbedPostMessageBridge', () => {
  let detach: (() => void) | undefined;

  afterEach(() => {
    detach?.();
    detach = undefined;
    vi.restoreAllMocks();
  });

  it('PMS pre_action ack 会透传 action-aware workflow verify 结果', async () => {
    const postMessage = vi.fn();
    const onPmsWorkflowPreAction = vi.fn().mockResolvedValue({
      ok: true,
      action: 'return',
      saveOk: true,
      verifyPassed: true,
      recommendedAction: 'proceed',
      message: '验证通过',
      annotationCheck: {
        passed: true,
        summary: {
          total: 1,
          open: 1,
          pendingReview: 0,
          approved: 0,
          rejected: 0,
        },
        blockers: [],
      },
    });

    detach = attachEmbedPostMessageBridge({
      onPmsWorkflowPreAction,
      onPmsWorkflowChanged: vi.fn(),
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'pms.workflow_pre_action',
        formId: 'FORM-248',
        action: 'return',
        requestId: 'req-1',
      },
      origin: 'https://pms.example.test',
      source: { postMessage } as unknown as Window,
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(onPmsWorkflowPreAction).toHaveBeenCalledWith({
      type: 'pms.workflow_pre_action',
      formId: 'FORM-248',
      action: 'return',
      requestId: 'req-1',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'plant3d.workflow_pre_action_acked',
      ok: true,
      action: 'return',
      saveOk: true,
      verifyPassed: true,
      recommendedAction: 'proceed',
      message: '验证通过',
      annotationCheck: {
        passed: true,
        summary: {
          total: 1,
          open: 1,
          pendingReview: 0,
          approved: 0,
          rejected: 0,
        },
        blockers: [],
      },
      requestId: 'req-1',
    }, '*');
  });
});
