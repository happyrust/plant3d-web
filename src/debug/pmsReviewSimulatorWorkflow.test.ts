import { describe, expect, it } from 'vitest';

import {
  deriveSimulatorSidePanelMode,
  resolveSimulatorActorIdentity,
  shouldUseSyncOnlyWorkflowAction,
} from './pmsReviewSimulatorWorkflow';

describe('deriveSimulatorSidePanelMode', () => {
  it('keeps SJ in initiate mode for passive workflow when opening from 新增', () => {
    expect(deriveSimulatorSidePanelMode({
      passiveWorkflowMode: true,
      currentRole: 'SJ',
      hasIframe: true,
      iframeSource: 'new',
      taskId: null,
      formId: null,
      currentNode: null,
    })).toBe('initiate');
  });

  it('keeps SJ in initiate mode for passive workflow when current node is sj', () => {
    expect(deriveSimulatorSidePanelMode({
      passiveWorkflowMode: true,
      currentRole: 'SJ',
      hasIframe: true,
      iframeSource: 'task-view',
      taskId: 'task-1',
      formId: 'FORM-1',
      currentNode: 'sj',
    })).toBe('initiate');
  });

  it('keeps non-SJ readonly in passive workflow even when form_id exists', () => {
    expect(deriveSimulatorSidePanelMode({
      passiveWorkflowMode: true,
      currentRole: 'JH',
      hasIframe: true,
      iframeSource: 'task-view',
      taskId: 'task-1',
      formId: 'FORM-1',
      currentNode: 'jd',
    })).toBe('readonly');
  });
});

describe('shouldUseSyncOnlyWorkflowAction', () => {
  it('uses sync-only active for SJ initiate action in passive workflow', () => {
    expect(shouldUseSyncOnlyWorkflowAction({
      passiveWorkflowMode: true,
      currentRole: 'SJ',
      sidePanelMode: 'initiate',
      action: 'active',
    })).toBe(true);
  });

  it('does not use sync-only path for reviewer agree action', () => {
    expect(shouldUseSyncOnlyWorkflowAction({
      passiveWorkflowMode: true,
      currentRole: 'JH',
      sidePanelMode: 'readonly',
      action: 'agree',
    })).toBe(false);
  });

  it('does not use sync-only path for internal workflow mode', () => {
    expect(shouldUseSyncOnlyWorkflowAction({
      passiveWorkflowMode: false,
      currentRole: 'SJ',
      sidePanelMode: 'initiate',
      action: 'active',
    })).toBe(false);
  });
});

describe('resolveSimulatorActorIdentity', () => {
  it('对 JH 优先使用任务上的 checkerId/checkerName 作为真实 actor', () => {
    expect(resolveSimulatorActorIdentity({
      currentRole: 'JH',
      task: {
        requesterId: 'SJ',
        requesterName: 'SJ',
        checkerId: 'proofreader_001',
        checkerName: '张校对员',
        approverId: 'manager_001',
        approverName: '陈经理',
        reviewerId: 'proofreader_001',
        reviewerName: '张校对员',
      },
    })).toEqual({
      userId: 'proofreader_001',
      userName: '张校对员',
    });
  });

  it('对 JH 在缺少 checkerId 时回退到 reviewerId', () => {
    expect(resolveSimulatorActorIdentity({
      currentRole: 'JH',
      task: {
        requesterId: 'SJ',
        requesterName: 'SJ',
        reviewerId: 'reviewer_legacy',
        reviewerName: '旧校核人',
      },
    })).toEqual({
      userId: 'reviewer_legacy',
      userName: '旧校核人',
    });
  });

  it('对 SH/PZ 使用任务上的 approverId 作为真实 actor', () => {
    expect(resolveSimulatorActorIdentity({
      currentRole: 'SH',
      task: {
        requesterId: 'SJ',
        requesterName: 'SJ',
        approverId: 'manager_001',
        approverName: '陈经理',
        reviewerId: 'proofreader_001',
        reviewerName: '张校对员',
      },
    })).toEqual({
      userId: 'manager_001',
      userName: '陈经理',
    });

    expect(resolveSimulatorActorIdentity({
      currentRole: 'PZ',
      task: {
        requesterId: 'SJ',
        requesterName: 'SJ',
        approverId: 'manager_001',
        approverName: '陈经理',
        reviewerId: 'proofreader_001',
        reviewerName: '张校对员',
      },
    })).toEqual({
      userId: 'manager_001',
      userName: '陈经理',
    });
  });

  it('缺少任务上下文时回退到固定角色账号', () => {
    expect(resolveSimulatorActorIdentity({
      currentRole: 'JH',
      task: null,
    })).toEqual({
      userId: 'JH',
      userName: 'JH',
    });
  });
});
