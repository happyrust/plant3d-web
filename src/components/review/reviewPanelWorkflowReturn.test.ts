import { describe, expect, it, vi } from 'vitest';

import type { WorkflowNode } from '@/types/auth';

function createReturnHandler(deps: {
  canReturn: boolean;
  taskId?: string;
  returnTargetNode: { value: WorkflowNode };
  returnReason: { value: string };
  returnTaskToNode: (taskId: string, targetNode: WorkflowNode, reason: string) => Promise<void>;
  refreshCurrentTask: (taskId: string) => Promise<void>;
  loadWorkflow: (taskId: string) => Promise<void>;
  showReturnDialog: { value: boolean };
  workflowActionLoading: { value: boolean };
  workflowError: { value: string | null };
}) {
  return async function handleReturnToNode() {
    if (!deps.taskId || !deps.canReturn) return;
    if (!deps.returnReason.value.trim()) return;
    deps.workflowActionLoading.value = true;
    deps.workflowError.value = null;
    try {
      await deps.returnTaskToNode(deps.taskId, deps.returnTargetNode.value, deps.returnReason.value.trim());
      await deps.refreshCurrentTask(deps.taskId);
      await deps.loadWorkflow(deps.taskId);
      deps.showReturnDialog.value = false;
      deps.returnReason.value = '';
      deps.returnTargetNode.value = 'sj';
    } catch (e) {
      deps.workflowError.value = e instanceof Error ? e.message : '驳回失败';
    } finally {
      deps.workflowActionLoading.value = false;
    }
  };
}

describe('ReviewPanel workflow return', () => {
  it('uses the selected target node from the dialog instead of always returning to sj', async () => {
    const returnTaskToNode = vi.fn(async () => {});
    const refreshCurrentTask = vi.fn(async () => {});
    const loadWorkflow = vi.fn(async () => {});
    const showReturnDialog = { value: true };
    const workflowActionLoading = { value: false };
    const workflowError = { value: 'stale' as string | null };
    const returnTargetNode = { value: 'jd' as WorkflowNode };
    const returnReason = { value: 'Need design rework' };

    await createReturnHandler({
      canReturn: true,
      taskId: 'task-1',
      returnTargetNode,
      returnReason,
      returnTaskToNode,
      refreshCurrentTask,
      loadWorkflow,
      showReturnDialog,
      workflowActionLoading,
      workflowError,
    })();

    expect(returnTaskToNode).toHaveBeenCalledWith('task-1', 'jd', 'Need design rework');
    expect(refreshCurrentTask).toHaveBeenCalledWith('task-1');
    expect(loadWorkflow).toHaveBeenCalledWith('task-1');
    expect(showReturnDialog.value).toBe(false);
    expect(returnReason.value).toBe('');
    expect(returnTargetNode.value).toBe('sj');
    expect(workflowActionLoading.value).toBe(false);
    expect(workflowError.value).toBeNull();
  });

  it('does not call returnTaskToNode when the reason is blank after trimming', async () => {
    const returnTaskToNode = vi.fn(async () => {});

    await createReturnHandler({
      canReturn: true,
      taskId: 'task-2',
      returnTargetNode: { value: 'jd' as WorkflowNode },
      returnReason: { value: '   ' },
      returnTaskToNode,
      refreshCurrentTask: vi.fn(async () => {}),
      loadWorkflow: vi.fn(async () => {}),
      showReturnDialog: { value: true },
      workflowActionLoading: { value: false },
      workflowError: { value: null },
    })();

    expect(returnTaskToNode).not.toHaveBeenCalled();
  });
});
