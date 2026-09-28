import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachEmbedPostMessageBridge, resolveEmbedBridgeTrust } from './embedPostMessageBridge';

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('attachEmbedPostMessageBridge', () => {
  let detach: (() => void) | undefined;

  afterEach(() => {
    detach?.();
    detach = undefined;
    vi.restoreAllMocks();
  });

  // D9（gen-model 修复计划 2026-09-28 T7，Q8=A）：pre_action 会自动落库、workflow_changed 会调 workflow/sync，
  // 不能让同页任意窗口触发——只认 trustedSource（父页面）与 trustedOrigins（referrer origin）。
  it('trustedSource 之外的窗口发来的 pre_action / workflow_changed 一律不受理、不回 ack', async () => {
    const parentPost = vi.fn();
    const parentWindow = { postMessage: parentPost } as unknown as Window;
    const strangerPost = vi.fn();
    const onPmsWorkflowPreAction = vi.fn().mockResolvedValue({ ok: true, action: 'return', saveOk: true });
    const onPmsWorkflowChanged = vi.fn().mockResolvedValue({ ok: true });

    detach = attachEmbedPostMessageBridge({
      onPmsWorkflowPreAction,
      onPmsWorkflowChanged,
      trustedSource: () => parentWindow,
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'pms.workflow_pre_action', formId: 'FORM-1', action: 'return', requestId: 'stranger-1' },
      origin: 'https://evil.example.test',
      source: { postMessage: strangerPost } as unknown as Window,
    }));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'pms.workflow_changed', formId: 'FORM-1', action: 'agree', requestId: 'stranger-2' },
      origin: 'https://evil.example.test',
      source: { postMessage: strangerPost } as unknown as Window,
    }));
    await settle();

    expect(onPmsWorkflowPreAction).not.toHaveBeenCalled();
    expect(onPmsWorkflowChanged).not.toHaveBeenCalled();
    expect(strangerPost).not.toHaveBeenCalled();

    // 父页面照常受理
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'pms.workflow_pre_action', formId: 'FORM-1', action: 'return', requestId: 'parent-1' },
      origin: 'https://pms.example.test',
      source: parentWindow,
    }));
    await settle();

    expect(onPmsWorkflowPreAction).toHaveBeenCalledTimes(1);
    expect(parentPost).toHaveBeenCalledWith(expect.objectContaining({
      type: 'plant3d.workflow_pre_action_acked',
      requestId: 'parent-1',
      ok: true,
    }), '*');
  });

  it('trustedOrigins 给了就按 origin 过滤', async () => {
    const postMessage = vi.fn();
    const onPmsWorkflowChanged = vi.fn().mockResolvedValue({ ok: true, taskId: 't-1' });

    detach = attachEmbedPostMessageBridge({
      onPmsWorkflowPreAction: vi.fn(),
      onPmsWorkflowChanged,
      trustedOrigins: ['https://pms.example.test'],
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'pms.workflow_changed', formId: 'FORM-2', action: 'agree', requestId: 'x-1' },
      origin: 'https://evil.example.test',
      source: { postMessage } as unknown as Window,
    }));
    await settle();
    expect(onPmsWorkflowChanged).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'pms.workflow_changed', formId: 'FORM-2', action: 'agree', requestId: 'x-2' },
      origin: 'https://pms.example.test',
      source: { postMessage } as unknown as Window,
    }));
    await settle();
    expect(onPmsWorkflowChanged).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'plant3d.workflow_synced',
      requestId: 'x-2',
      ok: true,
      taskId: 't-1',
    }), '*');
  });

  it('resolveEmbedBridgeTrust：嵌入态只认父窗口，referrer 可解析时再按其 origin 过滤', () => {
    const parent = {} as Window;
    const embedded = {
      parent,
      document: { referrer: 'https://pms.example.test/HD/Review.html?x=1' },
    } as unknown as Window;
    const trust = resolveEmbedBridgeTrust(embedded);
    expect(trust.trustedOrigins).toEqual(['https://pms.example.test']);
    expect(trust.trustedSource?.()).toBe(parent);

    const topLevel = { document: { referrer: '' } } as unknown as Window;
    (topLevel as unknown as { parent: Window }).parent = topLevel;
    const trustTop = resolveEmbedBridgeTrust(topLevel);
    expect(trustTop.trustedOrigins).toBeUndefined();
    expect(trustTop.trustedSource).toBeNull();
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
