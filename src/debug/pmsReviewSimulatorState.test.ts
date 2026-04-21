import { describe, expect, it } from 'vitest';

import {
  beginWorkflowVerifyCycle,
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
      lastAnnotationCheck: null,
    });
  });
});
