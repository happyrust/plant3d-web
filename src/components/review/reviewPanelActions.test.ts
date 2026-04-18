import { describe, expect, it, vi } from 'vitest';

import {
  buildReviewConfirmSnapshotPayload,
  canFinalizeAtCurrentNode,
  canReturnAtCurrentNode,
  canSubmitAtCurrentNode,
  confirmCurrentDataSafely,
  finalizeTaskDecisionSafely,
  getSubmitActionLabel,
  getWorkflowSubmitBridgeAction,
  mapWorkflowHistoryToTaskDetailItems,
  submitTaskToNextNodeSafely,
} from './reviewPanelActions';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('reviewPanelActions', () => {
  it('canFinalizeAtCurrentNode 仅在 pz 节点允许最终通过/驳回', () => {
    expect(canFinalizeAtCurrentNode(undefined)).toBe(false);
    expect(canFinalizeAtCurrentNode('sj')).toBe(false);
    expect(canFinalizeAtCurrentNode('jd')).toBe(false);
    expect(canFinalizeAtCurrentNode('sh')).toBe(false);
    expect(canFinalizeAtCurrentNode('pz')).toBe(true);
  });

  it('canSubmitAtCurrentNode 在四段工作流节点都允许执行提交动作', () => {
    expect(canSubmitAtCurrentNode(undefined)).toBe(true);
    expect(canSubmitAtCurrentNode('sj')).toBe(true);
    expect(canSubmitAtCurrentNode('jd')).toBe(true);
    expect(canSubmitAtCurrentNode('sh')).toBe(true);
    expect(canSubmitAtCurrentNode('pz')).toBe(true);
  });

  it('unknown workflow nodes do not expose the standard submit action', () => {
    expect(canSubmitAtCurrentNode('legacy' as never)).toBe(false);
  });

  it('canReturnAtCurrentNode 仅在非 sj 节点允许驳回', () => {
    expect(canReturnAtCurrentNode(undefined)).toBe(false);
    expect(canReturnAtCurrentNode('sj')).toBe(false);
    expect(canReturnAtCurrentNode('jd')).toBe(true);
    expect(canReturnAtCurrentNode('sh')).toBe(true);
    expect(canReturnAtCurrentNode('pz')).toBe(true);
  });

  it('unknown workflow nodes do not expose return actions either', () => {
    expect(canReturnAtCurrentNode('legacy' as never)).toBe(false);
  });

  it('getSubmitActionLabel 返回与节点匹配的主操作文案', () => {
    expect(getSubmitActionLabel('sj')).toBe('确认流转至校对');
    expect(getSubmitActionLabel('jd')).toBe('确认流转至审核');
    expect(getSubmitActionLabel('sh')).toBe('确认流转至批准');
    expect(getSubmitActionLabel('pz')).toBe('确认最终批准');
  });

  it('getWorkflowSubmitBridgeAction keeps SJ on active and later nodes on agree', () => {
    expect(getWorkflowSubmitBridgeAction(undefined)).toBe('active');
    expect(getWorkflowSubmitBridgeAction('sj')).toBe('active');
    expect(getWorkflowSubmitBridgeAction('jd')).toBe('agree');
    expect(getWorkflowSubmitBridgeAction('sh')).toBe('agree');
    expect(getWorkflowSubmitBridgeAction('pz')).toBe('agree');
  });

  it('mapWorkflowHistoryToTaskDetailItems 将工作流历史映射为详情面板可展示的数据', () => {
    const items = mapWorkflowHistoryToTaskDetailItems([
      {
        node: 'sh',
        action: 'submit',
        operatorId: 'reviewer-1',
        operatorName: '审核员小王',
        comment: '提交批准',
        timestamp: 1700000000000,
      },
      {
        node: 'pz',
        action: 'approve',
        operatorId: 'manager-1',
        operatorName: '项目负责人',
        comment: '同意',
        timestamp: 1700000001000,
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({ action: 'submit', userName: '审核员小王', comment: '提交批准' }),
      expect.objectContaining({ action: 'approve', userName: '项目负责人', comment: '同意' }),
    ]);
  });

  it('buildReviewConfirmSnapshotPayload 会把已完成 xeokit 测量并入 measurements，并过滤草稿近似值', () => {
    const payload = buildReviewConfirmSnapshotPayload({
      annotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      obbAnnotations: [],
      measurements: [
        {
          id: 'classic-distance',
          kind: 'distance',
          origin: { entityId: 'pipe-a', worldPos: [0, 0, 0] },
          target: { entityId: 'pipe-b', worldPos: [1, 0, 0] },
          visible: true,
          createdAt: 10,
        },
      ],
      xeokitDistanceMeasurements: [
        {
          id: 'xeokit-distance-draft',
          kind: 'distance',
          origin: { entityId: 'pipe-c', worldPos: [0, 0, 0] },
          target: { entityId: 'pipe-d', worldPos: [2, 0, 0] },
          visible: true,
          approximate: true,
          createdAt: 20,
        },
        {
          id: 'xeokit-distance-final',
          kind: 'distance',
          origin: { entityId: 'pipe-e', worldPos: [0, 0, 0] },
          target: { entityId: 'pipe-f', worldPos: [3, 0, 0] },
          visible: true,
          approximate: false,
          createdAt: 30,
        },
      ],
      xeokitAngleMeasurements: [
        {
          id: 'xeokit-angle-final',
          kind: 'angle',
          origin: { entityId: 'pipe-g', worldPos: [0, 0, 0] },
          corner: { entityId: 'pipe-h', worldPos: [1, 0, 0] },
          target: { entityId: 'pipe-i', worldPos: [1, 1, 0] },
          visible: true,
          approximate: false,
          createdAt: 40,
        },
      ],
    });

    expect(payload.measurements).toEqual([
      expect.objectContaining({ id: 'classic-distance', kind: 'distance' }),
      expect.objectContaining({ id: 'xeokit-distance-final', kind: 'distance' }),
      expect.objectContaining({ id: 'xeokit-angle-final', kind: 'angle' }),
    ]);
    expect(payload.measurements).not.toContainEqual(expect.objectContaining({ id: 'xeokit-distance-draft' }));
  });

  it('confirmCurrentDataSafely 应等待保存成功后再清理工具数据', async () => {
    const addDone = deferred<string>();
    const addConfirmedRecord = vi.fn(async () => addDone.promise);
    const clearAll = vi.fn();
    const resetNote = vi.fn();
    const payload = { note: 'n', annotations: [] };

    const running = confirmCurrentDataSafely({
      hasPendingData: true,
      payload,
      addConfirmedRecord,
      clearAll,
      resetNote,
    });

    expect(addConfirmedRecord).toHaveBeenCalledTimes(1);
    expect(clearAll).not.toHaveBeenCalled();
    expect(resetNote).not.toHaveBeenCalled();

    addDone.resolve('record-1');
    await running;

    expect(clearAll).toHaveBeenCalledTimes(1);
    expect(resetNote).toHaveBeenCalledTimes(1);
  });

  it('confirmCurrentDataSafely 保存失败时不应清理工具数据', async () => {
    const addConfirmedRecord = vi.fn(async () => {
      throw new Error('save failed');
    });
    const clearAll = vi.fn();
    const resetNote = vi.fn();

    await expect(
      confirmCurrentDataSafely({
        hasPendingData: true,
        payload: { note: '', annotations: [] },
        addConfirmedRecord,
        clearAll,
        resetNote,
      })
    ).rejects.toThrow('save failed');

    expect(clearAll).not.toHaveBeenCalled();
    expect(resetNote).not.toHaveBeenCalled();
  });

  it('finalizeTaskDecisionSafely 仅在状态更新成功后清理当前任务', async () => {
    const updateTaskStatus = vi.fn(async () => {});
    const clearCurrentTask = vi.fn();

    await finalizeTaskDecisionSafely({
      updateTaskStatus,
      clearCurrentTask,
      taskId: 't-1',
      status: 'approved',
      comment: 'ok',
    });

    expect(updateTaskStatus).toHaveBeenCalledWith('t-1', 'approved', 'ok');
    expect(clearCurrentTask).toHaveBeenCalledTimes(1);
  });

  it('finalizeTaskDecisionSafely 状态更新失败时不应清理当前任务', async () => {
    const updateTaskStatus = vi.fn(async () => {
      throw new Error('api failed');
    });
    const clearCurrentTask = vi.fn();

    await expect(
      finalizeTaskDecisionSafely({
        updateTaskStatus,
        clearCurrentTask,
        taskId: 't-2',
        status: 'rejected',
        comment: 'bad',
      })
    ).rejects.toThrow('api failed');

    expect(clearCurrentTask).not.toHaveBeenCalled();
  });

  it('submitTaskToNextNodeSafely 成功后关闭对话框并刷新任务与工作流', async () => {
    const submitTaskToNextNode = vi.fn(async () => {});
    const refreshCurrentTask = vi.fn(async () => {});
    const loadWorkflow = vi.fn(async () => {});
    const emitToast = vi.fn();
    const showSubmitDialog = { value: true };
    const submitComment = { value: '  ready to move  ' };
    const workflowActionLoading = { value: false };
    const workflowError = { value: 'stale' as string | null };

    await submitTaskToNextNodeSafely({
      canSubmit: true,
      taskId: 'task-1',
      submitComment,
      showSubmitDialog,
      workflowActionLoading,
      workflowError,
      submitTaskToNextNode,
      refreshCurrentTask,
      loadWorkflow,
      emitToast,
    });

    expect(submitTaskToNextNode).toHaveBeenCalledWith('task-1', 'ready to move');
    expect(refreshCurrentTask).toHaveBeenCalledWith('task-1');
    expect(loadWorkflow).toHaveBeenCalledWith('task-1');
    expect(emitToast).toHaveBeenCalledWith({ message: '已确认提交流转' });
    expect(showSubmitDialog.value).toBe(false);
    expect(submitComment.value).toBe('');
    expect(workflowError.value).toBeNull();
    expect(workflowActionLoading.value).toBe(false);
  });

  it('submitTaskToNextNodeSafely 失败时保留对话框并显示错误', async () => {
    const submitTaskToNextNode = vi.fn(async () => {
      throw new Error('submit failed');
    });
    const emitToast = vi.fn();
    const showSubmitDialog = { value: true };
    const submitComment = { value: 'keep this note' };
    const workflowActionLoading = { value: false };
    const workflowError = { value: null as string | null };

    await submitTaskToNextNodeSafely({
      canSubmit: true,
      taskId: 'task-2',
      submitComment,
      showSubmitDialog,
      workflowActionLoading,
      workflowError,
      submitTaskToNextNode,
      refreshCurrentTask: vi.fn(async () => {}),
      loadWorkflow: vi.fn(async () => {}),
      emitToast,
    });

    expect(workflowError.value).toBe('submit failed');
    expect(showSubmitDialog.value).toBe(true);
    expect(submitComment.value).toBe('keep this note');
    expect(emitToast).not.toHaveBeenCalled();
    expect(workflowActionLoading.value).toBe(false);
  });
});
