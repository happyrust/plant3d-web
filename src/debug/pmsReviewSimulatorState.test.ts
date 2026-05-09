import { describe, expect, it } from 'vitest';

import {
  beginWorkflowVerifyCycle,
  summarizeWorkflowVerifyDiagnostics,
  type WorkflowVerifyStateSnapshot,
} from './pmsReviewSimulatorState';

describe('beginWorkflowVerifyCycle', () => {
  it('开始新一轮动作时应清空上一次 recommendedAction 与 annotationCheck', () => {
    const previous: WorkflowVerifyStateSnapshot = {
      loading: false,
      lastAction: 'return',
      lastOk: false,
      lastMessage: 'workflow/verify 拦截：当前应驳回',
      lastErrorCode: 'ANNOTATION_CHECK_FAILED',
      lastRecommendedAction: 'return',
      lastAt: 1710000000000,
      lastDiagnostics: {
        blockCode: 'OWNER_MISMATCH',
        actorId: 'SH',
        ownerId: 'JH',
        ownerSource: 'checker',
        expectedNextNode: 'sh',
        requestedNextStep: {
          assigneeId: 'PZ',
          name: 'PZ',
          roles: 'pz',
        },
      },
      lastAnnotationCheck: {
        passed: false,
        recommendedAction: 'return',
        currentNode: 'sh',
        summary: {
          total: 1,
          open: 0,
          pendingReview: 0,
          approved: 0,
          rejected: 1,
        },
        blockers: [],
        message: '当前应驳回',
      },
    };

    expect(beginWorkflowVerifyCycle(previous, 'agree')).toEqual({
      loading: true,
      lastAction: 'agree',
      lastOk: null,
      lastMessage: null,
      lastErrorCode: null,
      lastRecommendedAction: null,
      lastAt: 1710000000000,
      lastDiagnostics: null,
      lastAnnotationCheck: null,
    });
  });
});

describe('summarizeWorkflowVerifyDiagnostics', () => {
  it('把结构化 verify 诊断字段格式化为可展示摘要', () => {
    expect(summarizeWorkflowVerifyDiagnostics({
      blockCode: 'OWNER_MISMATCH',
      actorId: 'SH',
      ownerId: 'JH',
      ownerSource: 'checker',
      expectedNextNode: 'sh',
      requestedNextStep: {
        assigneeId: 'PZ',
        name: 'PZ',
        roles: 'pz',
      },
    })).toBe('block=OWNER_MISMATCH ｜ actor=SH ｜ owner=JH(checker) ｜ expected_next=sh ｜ requested_next=PZ/pz');
  });

  it('没有结构化字段时返回占位符', () => {
    expect(summarizeWorkflowVerifyDiagnostics(null)).toBe('--');
  });
});
