import type { ReviewAnnotationCheckResult } from '@/api/reviewApi';

export type WorkflowVerifyDiagnostics = {
  blockCode?: string;
  actorId?: string;
  ownerId?: string;
  ownerSource?: string;
  expectedNextNode?: string;
  requestedNextStep?: {
    assigneeId?: string;
    name?: string;
    roles?: string;
  };
};

export type WorkflowVerifyStateSnapshot = {
  loading: boolean;
  lastAction: 'active' | 'agree' | 'return' | 'stop' | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  lastErrorCode: string | null;
  lastRecommendedAction: ReviewAnnotationCheckResult['recommendedAction'] | null;
  lastAt: number | null;
  lastDiagnostics: WorkflowVerifyDiagnostics | null;
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
    lastDiagnostics: null,
    lastAnnotationCheck: null,
  };
}

export function summarizeWorkflowVerifyDiagnostics(
  diagnostics: WorkflowVerifyDiagnostics | null
): string {
  if (!diagnostics) return '--';

  const requestedNextStep = diagnostics.requestedNextStep;
  const parts = [
    diagnostics.blockCode ? `block=${diagnostics.blockCode}` : '',
    diagnostics.actorId ? `actor=${diagnostics.actorId}` : '',
    diagnostics.ownerId
      ? `owner=${diagnostics.ownerId}${diagnostics.ownerSource ? `(${diagnostics.ownerSource})` : ''}`
      : '',
    diagnostics.expectedNextNode ? `expected_next=${diagnostics.expectedNextNode}` : '',
    requestedNextStep?.assigneeId || requestedNextStep?.roles
      ? `requested_next=${requestedNextStep.assigneeId || '--'}/${requestedNextStep.roles || '--'}`
      : '',
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' ｜ ') : '--';
}
