import type { ReviewAnnotationCheckResult } from '@/api/reviewApi';

export type WorkflowVerifyStateSnapshot = {
  loading: boolean;
  lastAction: 'active' | 'agree' | 'return' | 'stop' | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  lastErrorCode: string | null;
  lastRecommendedAction: ReviewAnnotationCheckResult['recommendedAction'] | null;
  lastAt: number | null;
  lastAnnotationCheck: ReviewAnnotationCheckResult | null;
};

export function beginWorkflowVerifyCycle(
  previous: WorkflowVerifyStateSnapshot,
  action: NonNullable<WorkflowVerifyStateSnapshot['lastAction']>,
): WorkflowVerifyStateSnapshot {
  return {
    ...previous,
    loading: true,
    lastAction: action,
    lastOk: null,
    lastMessage: null,
    lastErrorCode: null,
    lastRecommendedAction: null,
    lastAnnotationCheck: null,
  };
}
