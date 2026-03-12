import { describe, expect, it, vi } from 'vitest';

import {
  canFinalizeAtCurrentNode,
  canReturnAtCurrentNode,
  canSubmitAtCurrentNode,
  confirmCurrentDataSafely,
  finalizeTaskDecisionSafely,
  getSubmitActionLabel,
  mapWorkflowHistoryToTaskDetailItems,
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

  it('canReturnAtCurrentNode 仅在非 sj 节点允许驳回', () => {
    expect(canReturnAtCurrentNode(undefined)).toBe(false);
    expect(canReturnAtCurrentNode('sj')).toBe(false);
    expect(canReturnAtCurrentNode('jd')).toBe(true);
    expect(canReturnAtCurrentNode('sh')).toBe(true);
    expect(canReturnAtCurrentNode('pz')).toBe(true);
  });

  it('getSubmitActionLabel 返回与节点匹配的主操作文案', () => {
    expect(getSubmitActionLabel('sj')).toBe('提交到校核');
    expect(getSubmitActionLabel('jd')).toBe('提交到审核');
    expect(getSubmitActionLabel('sh')).toBe('提交到批准');
    expect(getSubmitActionLabel('pz')).toBe('最终批准');
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
});
