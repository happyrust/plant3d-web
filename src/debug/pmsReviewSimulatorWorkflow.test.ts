import { describe, expect, it } from 'vitest';

import {
  buildSimulatorAuthLoginRequest,
  buildSimulatorEmbedUrlPayload,
  buildSimulatorRuntimeWorkflowRole,
  resolveSimulatorWorkflowMutationTargetRole,
  buildSimulatorWorkflowSyncPayload,
  deriveSimulatorSidePanelMode,
  resolveSimulatorPmsUserIdentity,
  resolveSimulatorWorkflowAccess,
  resolveSimulatorTaskAssignment,
  resolveSimulatorWorkflowAssignment,
  resolveSimulatorWorkflowRole,
  shouldUseSyncOnlyWorkflowAction,
} from './pmsReviewSimulatorWorkflow';

describe('resolveSimulatorPmsUserIdentity', () => {
  it('始终返回当前 PMS 用户本身作为 user_id / user_name', () => {
    expect(resolveSimulatorPmsUserIdentity('JH')).toEqual({
      userId: 'JH',
      userName: 'JH',
    });

    expect(resolveSimulatorPmsUserIdentity('SH')).toEqual({
      userId: 'SH',
      userName: 'SH',
    });
  });
});

describe('resolveSimulatorWorkflowRole', () => {
  it('优先使用外部显式传入的工作流角色', () => {
    expect(resolveSimulatorWorkflowRole({
      currentPmsUser: 'JH',
      explicitRole: 'jd',
      taskCurrentNode: 'sj',
      iframeSource: 'new',
    })).toEqual({
      workflowRole: 'jd',
      source: 'explicit',
    });
  });

  it('其次使用任务当前节点作为工作流角色', () => {
    expect(resolveSimulatorWorkflowRole({
      currentPmsUser: 'SJ',
      taskCurrentNode: 'sh',
      iframeSource: 'task-view',
    })).toEqual({
      workflowRole: 'sh',
      source: 'task-node',
    });
  });

  it('新增入口默认回到 sj 发起角色', () => {
    expect(resolveSimulatorWorkflowRole({
      currentPmsUser: 'JH',
      iframeSource: 'new',
    })).toEqual({
      workflowRole: 'sj',
      source: 'new-entry',
    });
  });

  it('在缺少显式 role 与任务节点时，最后才按 PMS 用户做兜底映射', () => {
    expect(resolveSimulatorWorkflowRole({
      currentPmsUser: 'PZ',
      iframeSource: 'task-reopen',
    })).toEqual({
      workflowRole: 'pz',
      source: 'user-default',
    });
  });
});

describe('deriveSimulatorSidePanelMode', () => {
  it('被判定为 sj 工作流角色时，即使当前 PMS 用户不是 SJ，也保持发起态', () => {
    expect(deriveSimulatorSidePanelMode({
      passiveWorkflowMode: false,
      currentPmsUser: 'JH',
      currentWorkflowRole: 'sj',
      canMutateWorkflow: true,
      hasIframe: true,
      iframeSource: 'task-view',
      taskId: 'task-1',
      formId: null,
    })).toBe('initiate');
  });

  it('非 sj 工作流角色在带 form_id 的已打开上下文中进入流程态', () => {
    expect(deriveSimulatorSidePanelMode({
      passiveWorkflowMode: false,
      currentPmsUser: 'SH',
      currentWorkflowRole: 'jd',
      canMutateWorkflow: true,
      hasIframe: true,
      iframeSource: 'task-view',
      taskId: 'task-1',
      formId: 'FORM-1',
    })).toBe('workflow');
  });

  it('外部流程模式下，sj 仍保持发起态，非 sj 命中目标用户时进入流程态', () => {
    expect(deriveSimulatorSidePanelMode({
      passiveWorkflowMode: true,
      currentPmsUser: 'SJ',
      currentWorkflowRole: 'sj',
      canMutateWorkflow: true,
      hasIframe: true,
      iframeSource: 'new',
      taskId: null,
      formId: null,
    })).toBe('initiate');

    expect(deriveSimulatorSidePanelMode({
      passiveWorkflowMode: true,
      currentPmsUser: 'JH',
      currentWorkflowRole: 'jd',
      canMutateWorkflow: true,
      hasIframe: true,
      iframeSource: 'task-view',
      taskId: 'task-1',
      formId: 'FORM-1',
    })).toBe('workflow');
  });

  it('已有单据若当前用户不是目标处理人，则只能进入只读态', () => {
    expect(deriveSimulatorSidePanelMode({
      passiveWorkflowMode: false,
      currentPmsUser: 'JH',
      currentWorkflowRole: 'jd',
      canMutateWorkflow: false,
      hasIframe: true,
      iframeSource: 'task-view',
      taskId: 'task-1',
      formId: 'FORM-1',
    })).toBe('readonly');
  });
});

describe('shouldUseSyncOnlyWorkflowAction', () => {
  it('外部流程模式下，sj active 通过 workflow/sync 驱动', () => {
    expect(shouldUseSyncOnlyWorkflowAction({
      passiveWorkflowMode: true,
      currentPmsUser: 'JH',
      currentWorkflowRole: 'sj',
      sidePanelMode: 'initiate',
      action: 'active',
    })).toBe(true);
  });

  it('外部流程模式下，非 sj 的流程动作同样通过 workflow/sync 驱动', () => {
    expect(shouldUseSyncOnlyWorkflowAction({
      passiveWorkflowMode: true,
      currentPmsUser: 'SJ',
      currentWorkflowRole: 'jd',
      sidePanelMode: 'workflow',
      action: 'agree',
    })).toBe(true);
  });

  it('外部流程模式下，readonly 只读态不会放行动作', () => {
    expect(shouldUseSyncOnlyWorkflowAction({
      passiveWorkflowMode: true,
      currentPmsUser: 'SH',
      currentWorkflowRole: 'sh',
      sidePanelMode: 'readonly',
      action: 'agree',
    })).toBe(false);
  });

  it('内部流程模式下不走 sync-only', () => {
    expect(shouldUseSyncOnlyWorkflowAction({
      passiveWorkflowMode: false,
      currentPmsUser: 'SJ',
      currentWorkflowRole: 'sj',
      sidePanelMode: 'initiate',
      action: 'active',
    })).toBe(false);
  });
});


describe('request payload builders', () => {
  it('auth token 请求应始终使用当前 PMS 用户作为 user_id、使用当前工作流角色作为 role', () => {
    expect(buildSimulatorAuthLoginRequest({
      projectId: 'AvevaMarineSample',
      currentPmsUser: 'JH',
      currentWorkflowRole: 'jd',
    })).toEqual({
      projectId: 'AvevaMarineSample',
      userId: 'JH',
      role: 'jd',
    });
  });

  it('embed-url payload 应带当前 PMS 用户与本单据 workflow_role，并在有 form_id 时附带 form_id', () => {
    expect(buildSimulatorEmbedUrlPayload({
      projectId: 'AvevaMarineSample',
      currentPmsUser: 'SH',
      currentWorkflowRole: 'sh',
      preferredFormId: 'FORM-123',
    })).toEqual({
      project_id: 'AvevaMarineSample',
      user_id: 'SH',
      workflow_role: 'sh',
      form_id: 'FORM-123',
    });
  });

  it('workflow/sync payload 应把 actor.id/name 绑定到当前 PMS 用户，roles 绑定到当前工作流角色', () => {
    expect(buildSimulatorWorkflowSyncPayload({
      formId: 'FORM-123',
      token: 'TOKEN-1',
      action: 'agree',
      comments: '同意',
      currentPmsUser: 'PZ',
      currentWorkflowRole: 'pz',
    })).toEqual({
      form_id: 'FORM-123',
      token: 'TOKEN-1',
      action: 'agree',
      actor: {
        id: 'PZ',
        name: 'PZ',
        roles: 'pz',
      },
      comments: '同意',
    });
  });

  it('workflow/sync mutation payload 在存在 next_step 时应附带目标节点与处理人', () => {
    expect(buildSimulatorWorkflowSyncPayload({
      formId: 'FORM-123',
      token: 'TOKEN-1',
      action: 'active',
      comments: '送审',
      currentPmsUser: 'SJ',
      currentWorkflowRole: 'sj',
      nextStep: {
        assigneeId: 'JH',
        name: 'JH',
        roles: 'jd',
      },
    })).toEqual({
      form_id: 'FORM-123',
      token: 'TOKEN-1',
      action: 'active',
      actor: {
        id: 'SJ',
        name: 'SJ',
        roles: 'sj',
      },
      comments: '送审',
      next_step: {
        assignee_id: 'JH',
        name: 'JH',
        roles: 'jd',
      },
    });
  });
});

describe('resolveSimulatorWorkflowMutationTargetRole', () => {
  it('active / agree 应按当前工作流角色推导下一节点', () => {
    expect(resolveSimulatorWorkflowMutationTargetRole({
      action: 'active',
      currentWorkflowRole: 'sj',
    })).toBe('jd');

    expect(resolveSimulatorWorkflowMutationTargetRole({
      action: 'agree',
      currentWorkflowRole: 'jd',
    })).toBe('sh');
  });

  it('return 应优先使用显式 targetNode，stop 不生成 next_step', () => {
    expect(resolveSimulatorWorkflowMutationTargetRole({
      action: 'return',
      currentWorkflowRole: 'sh',
      targetNode: 'sj',
    })).toBe('sj');

    expect(resolveSimulatorWorkflowMutationTargetRole({
      action: 'stop',
      currentWorkflowRole: 'pz',
    })).toBeNull();
  });
});


describe('buildSimulatorRuntimeWorkflowRole', () => {
  it('外部流程 next_step 存在时，应优先使用 next_step 作为当前工作流角色', () => {
    expect(buildSimulatorRuntimeWorkflowRole({
      currentPmsUser: 'JH',
      workflowNextStep: 'sh',
      workflowCurrentNode: 'jd',
      taskCurrentNode: 'sh',
      launchPlanRole: 'sj',
      iframeWorkflowRole: 'jd',
      iframeSource: 'task-view',
      hasIframe: true,
    })).toEqual({
      workflowRole: 'sh',
      source: 'workflow-next-step',
    });
  });

  it('无 next_step 时，应优先使用显式 role，而不是 workflow current_node 或内部 taskCurrentNode', () => {
    expect(buildSimulatorRuntimeWorkflowRole({
      currentPmsUser: 'SH',
      workflowCurrentNode: 'jd',
      taskCurrentNode: 'pz',
      launchPlanRole: 'pz',
      iframeWorkflowRole: 'sh',
      iframeSource: 'task-reopen',
      hasIframe: true,
    })).toEqual({
      workflowRole: 'pz',
      source: 'explicit',
    });
  });

  it('无 next_step 且无显式 role 时，使用 workflow current_node 作为外部流程当前节点', () => {
    expect(buildSimulatorRuntimeWorkflowRole({
      currentPmsUser: 'SH',
      workflowCurrentNode: 'sh',
      taskCurrentNode: 'jd',
      launchPlanRole: null,
      iframeWorkflowRole: null,
      iframeSource: 'task-reopen',
      hasIframe: true,
    })).toEqual({
      workflowRole: 'sh',
      source: 'workflow-current-node',
    });
  });

  it('仅在缺少外部流程节点时，才回退到内部 taskCurrentNode', () => {
    expect(buildSimulatorRuntimeWorkflowRole({
      currentPmsUser: 'JH',
      taskCurrentNode: 'jd',
      launchPlanRole: null,
      iframeWorkflowRole: null,
      iframeSource: 'task-view',
      hasIframe: true,
    })).toEqual({
      workflowRole: 'jd',
      source: 'task-node',
    });
  });

  it('无 iframe 上下文时，不应被历史 launch token role 污染，而应回退到新增入口或用户兜底', () => {
    expect(buildSimulatorRuntimeWorkflowRole({
      currentPmsUser: 'JH',
      launchPlanRole: 'sh',
      iframeWorkflowRole: null,
      iframeSource: 'new',
      hasIframe: false,
    })).toEqual({
      workflowRole: 'sj',
      source: 'new-entry',
    });
  });
});

describe('resolveSimulatorWorkflowAssignment', () => {
  it('按当前工作流角色给出默认测试用户，并判断当前用户是否命中默认指派', () => {
    expect(resolveSimulatorWorkflowAssignment({
      currentPmsUser: 'JH',
      currentWorkflowRole: 'jd',
    })).toEqual({
      defaultAssignedPmsUser: 'JH',
      matchesCurrentPmsUser: true,
    });

    expect(resolveSimulatorWorkflowAssignment({
      currentPmsUser: 'SJ',
      currentWorkflowRole: 'jd',
    })).toEqual({
      defaultAssignedPmsUser: 'JH',
      matchesCurrentPmsUser: false,
    });
  });

  it('工作流角色动态变化时，默认测试用户也随之变化', () => {
    expect(resolveSimulatorWorkflowAssignment({
      currentPmsUser: 'PZ',
      currentWorkflowRole: 'sh',
    })).toEqual({
      defaultAssignedPmsUser: 'SH',
      matchesCurrentPmsUser: false,
    });
  });
});

describe('resolveSimulatorTaskAssignment', () => {
  it('按当前工作流角色解析任务真实指派对象', () => {
    expect(resolveSimulatorTaskAssignment({
      currentPmsUser: 'JH',
      currentWorkflowRole: 'jd',
      checkerId: 'proofreader_001',
      reviewerId: 'reviewer_legacy',
    })).toEqual({
      assignedUserId: 'proofreader_001',
      source: 'checker',
      matchesCurrentPmsUser: false,
    });

    expect(resolveSimulatorTaskAssignment({
      currentPmsUser: 'SJ',
      currentWorkflowRole: 'sj',
      requesterId: 'SJ',
    })).toEqual({
      assignedUserId: 'SJ',
      source: 'requester',
      matchesCurrentPmsUser: true,
    });
  });

  it('校核缺少 checkerId 时回退 reviewerId；审核/批准统一看 approverId', () => {
    expect(resolveSimulatorTaskAssignment({
      currentPmsUser: 'JH',
      currentWorkflowRole: 'jd',
      reviewerId: 'reviewer_legacy',
    })).toEqual({
      assignedUserId: 'reviewer_legacy',
      source: 'reviewer',
      matchesCurrentPmsUser: false,
    });

    expect(resolveSimulatorTaskAssignment({
      currentPmsUser: 'SH',
      currentWorkflowRole: 'sh',
      approverId: 'manager_001',
    })).toEqual({
      assignedUserId: 'manager_001',
      source: 'approver',
      matchesCurrentPmsUser: false,
    });
  });
});

describe('resolveSimulatorWorkflowAccess', () => {
  it('新增入口始终允许当前用户发起流程', () => {
    expect(resolveSimulatorWorkflowAccess({
      iframeSource: 'new',
      taskAssignedUserId: null,
      taskAssignmentSource: 'none',
      matchesTaskAssignee: false,
      defaultAssignedPmsUser: 'SJ',
      matchesDefaultAssignee: false,
    })).toEqual({
      canView: true,
      canMutateWorkflow: true,
      decisionSource: 'new-entry',
      reason: '新增入口默认允许当前用户发起流程。',
    });
  });

  it('已有单据在存在真实任务指派时，优先按真实任务指派决定是否可推进流程', () => {
    expect(resolveSimulatorWorkflowAccess({
      iframeSource: 'task-view',
      taskStatus: 'in_review',
      taskAssignedUserId: 'proofreader_001',
      taskAssignmentSource: 'checker',
      matchesTaskAssignee: false,
      defaultAssignedPmsUser: 'JH',
      matchesDefaultAssignee: true,
    })).toEqual({
      canView: true,
      canMutateWorkflow: false,
      decisionSource: 'task-assignee',
      reason: '当前单据已明确指派给 proofreader_001（checker），当前用户仅可查看。',
    });
  });

  it('已有单据缺少真实任务指派时，回退按默认测试流转映射判断', () => {
    expect(resolveSimulatorWorkflowAccess({
      iframeSource: 'task-view',
      taskStatus: 'submitted',
      taskAssignedUserId: null,
      taskAssignmentSource: 'none',
      matchesTaskAssignee: false,
      defaultAssignedPmsUser: 'SH',
      matchesDefaultAssignee: true,
    })).toEqual({
      canView: true,
      canMutateWorkflow: true,
      decisionSource: 'default-assignee',
      reason: '当前单据缺少真实任务指派，已回退到默认测试流转映射。',
    });
  });

  it('已取消或已完成的单据应直接只读，不能继续推进流程', () => {
    expect(resolveSimulatorWorkflowAccess({
      iframeSource: 'task-view',
      taskStatus: 'cancelled',
      taskAssignedUserId: 'SH',
      taskAssignmentSource: 'approver',
      matchesTaskAssignee: true,
      defaultAssignedPmsUser: 'SH',
      matchesDefaultAssignee: true,
    })).toEqual({
      canView: true,
      canMutateWorkflow: false,
      decisionSource: 'task-terminal',
      reason: '当前单据已处于已取消终态，仅可查看。',
    });

    expect(resolveSimulatorWorkflowAccess({
      iframeSource: 'task-view',
      taskStatus: 'approved',
      taskAssignedUserId: 'PZ',
      taskAssignmentSource: 'approver',
      matchesTaskAssignee: true,
      defaultAssignedPmsUser: 'PZ',
      matchesDefaultAssignee: true,
    })).toEqual({
      canView: true,
      canMutateWorkflow: false,
      decisionSource: 'task-terminal',
      reason: '当前单据已处于已完成终态，仅可查看。',
    });
  });
});
