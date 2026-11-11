import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetUpdateToLatestStateForTests,
  interpretUpdateReceipt,
  isUpdateToLatestBusy,
  setUpdateToLatestState,
  updateToLatestView,
} from './updateToLatestState';

describe('interpretUpdateReceipt（update/execute 的回执对这一个库意味着什么）', () => {
  it('新排了批次 / 并进了已有的批次：排上了，带上任务号和会话范围', () => {
    expect(interpretUpdateReceipt(1112, {
      enqueued: [{ task_id: 'batch-1', dbnum: 1112, intent: 'apply_window', start_sesno: 738, end_sesno: 748 }],
    })).toEqual({ phase: 'queued', taskIds: ['batch-1'], message: '已排队：会话 738→748' });
    expect(interpretUpdateReceipt(1112, {
      merged: [{ task_id: 'batch-9', dbnum: 1112 }, { task_id: 'batch-x', dbnum: 8000 }],
    })).toEqual({ phase: 'queued', taskIds: ['batch-9'], message: '已排队' });
  });

  it('这个库已经在后端的队列里（已覆盖）：不算失败，没有任务号，跟着水位看', () => {
    expect(interpretUpdateReceipt(1112, { already_covered: [1112] }))
      .toEqual({ phase: 'queued', taskIds: [], message: '这个库已经在后端的队列里，做完会提示' });
  });

  it('被阻断：把后端给的原因原样说出来', () => {
    expect(interpretUpdateReceipt(1112, { blocked: [{ dbnum: 1112, reason: '同号多文件：ams1112_0001 / ams1112_0002' }] }))
      .toEqual({ phase: 'rejected', taskIds: [], message: '后端拒绝：同号多文件：ams1112_0001 / ams1112_0002' });
  });

  it('不在后端的更新范围里（告警点名这个库）：没有受理，带上告警原文', () => {
    const receipt = { scanned: 5, enqueued: [], warnings: ['dbnum=1112: 在执行范围内，但本次扫描没有找到它的候选文件'] };
    expect(interpretUpdateReceipt(1112, receipt)).toEqual({
      phase: 'rejected', taskIds: [], message: '后端没有受理：dbnum=1112: 在执行范围内，但本次扫描没有找到它的候选文件',
    });
    // 告警点名的是 1112，不是 11 / 111：不能按前缀算到别的库头上
    expect(interpretUpdateReceipt(11, receipt)).toEqual({ phase: 'rejected', taskIds: [], message: '后端没有为这个库排任何批次' });
    expect(interpretUpdateReceipt(111, receipt).message).toBe('后端没有为这个库排任何批次');
  });

  it('后端说已经是最新：没有可做的', () => {
    expect(interpretUpdateReceipt(8000, { up_to_date: 1 })).toEqual({ phase: 'up_to_date', taskIds: [], message: '后端说这个库已经是最新' });
    expect(interpretUpdateReceipt(8000, { status: 'up_to_date' })).toEqual({ phase: 'up_to_date', taskIds: [], message: '后端说这个库已经是最新' });
  });

  it('读透形态的回执（没有任务号）：模型刷新已排队', () => {
    expect(interpretUpdateReceipt(7997, { status: 'model_refresh_queued' }))
      .toEqual({ phase: 'queued', taskIds: [], message: '已排队模型刷新，做完会提示' });
  });

  it('回执里什么都没有：按没有受理算，不假装排上了', () => {
    expect(interpretUpdateReceipt(1112, {})).toEqual({ phase: 'rejected', taskIds: [], message: '后端没有为这个库排任何批次' });
    expect(interpretUpdateReceipt(1112, { unselected: [1112] }).phase).toBe('rejected');
  });
});

describe('updateToLatestView（行上的「更新」按钮怎么画）', () => {
  beforeEach(() => __resetUpdateToLatestStateForTests());

  it('没发起过：没有东西', () => {
    expect(updateToLatestView(1112)).toBeNull();
  });

  it.each([
    ['requesting', '正在请求后端…'],
    ['queued', '已排队：会话 738→748'],
    ['running', '模型生成 3/10'],
  ] as const)('%s：忙，按钮写「更新中」，提示里是进度', (phase, message) => {
    const state = setUpdateToLatestState(1112, { phase, message, taskIds: [] });
    expect(isUpdateToLatestBusy(state)).toBe(true);
    expect(updateToLatestView(1112)).toEqual({ busy: true, label: '更新中', title: `库 1112 更新到最新：${message}` });
  });

  it.each([
    ['rejected', '后端拒绝：库不在更新范围里'],
    ['failed', '更新请求失败：HTTP 500'],
    ['done', '更新完成'],
    ['up_to_date', '后端说这个库已经是最新'],
  ] as const)('%s：不忙，按钮恢复，提示里留着结果', (phase, message) => {
    const state = setUpdateToLatestState(1112, { phase, message, taskIds: [] });
    expect(isUpdateToLatestBusy(state)).toBe(false);
    expect(updateToLatestView(1112)).toEqual({ busy: false, label: '更新', title: `库 1112 上一次更新到最新：${message}` });
  });

  it('各库各记各的', () => {
    setUpdateToLatestState(1112, { phase: 'running', message: 'x', taskIds: ['t'] });
    expect(updateToLatestView(8000)).toBeNull();
  });
});
