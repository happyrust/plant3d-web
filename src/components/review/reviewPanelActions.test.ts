import { describe, expect, it, vi } from 'vitest';

import {
  canFinalizeAtCurrentNode,
  confirmCurrentDataSafely,
  finalizeTaskDecisionSafely,
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
